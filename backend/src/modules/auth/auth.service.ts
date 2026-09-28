/**
 * Servicio de autenticación: casos de uso de `/api/v1/auth/*`.
 *
 * ============================== CAPAS =======================================
 * Este service NO conoce Express, ni zod, ni SQLite. Recibe entradas ya
 * tipadas, decide, orquesta la transacción y devuelve DTOs. El SQL vive en
 * `auth.repository.sqlite.ts` y las dependencias llegan por constructor desde
 * `config/container.ts` (DESIGN.md 3.1 y 3.6).
 *
 * ========================== REGLAS QUE IMPLEMENTA ===========================
 *  - BR-SEC-002: access JWT HS256 + refresh opaco hasheado y rotado.
 *  - BR-SEC-003: cambio de contraseña y `logout-all` revocan TODAS las sesiones.
 *  - BR-SEC-004: `BLOCKED`/`INACTIVE` no autentican y revocan sus sesiones.
 *  - BR-SEC-007: toda acción sensible deja fila en `audit_logs`.
 *  - BR-SEC-010: el email se normaliza a minúsculas en TODAS las entradas.
 *  - Anti-enumeración (DESIGN.md 11.1): login inexistente y login con contraseña
 *    incorrecta devuelven EXACTAMENTE el mismo mensaje y código, y el primero
 *    ejecuta además un `compare` bcrypt señuelo para que el tiempo no delate la
 *    existencia de la cuenta. Igual con `forgot-password`, que responde 200
 *    exista o no el email.
 *  - Reuso de refresh token (DESIGN.md 11.2, paso 3): revoca TODAS las sesiones
 *    del usuario y registra `REFRESH_TOKEN_REUSE`.
 *
 * ===================== TRANSACCIONES ========================================
 * `better-sqlite3` es síncrono, así que todo caso de uso que escribe más de una
 * tabla se ejecuta dentro de `runInTransactionSync` (DESIGN.md 8.2). NUNCA se
 * hace `await` dentro: el lock de escritura quedaría retenido durante el salto al
 * event loop.
 *
 * ============ UNA REGLA QUE NO SE PUEDE OLVIDAR: LA AUDITORÍA FALLIDA ========
 * Un intento que termina en error se rechaza con `throw`, y ese `throw` hace
 * `ROLLBACK` de la transacción abierta. Si la fila de auditoría se escribiera
 * DENTRO de esa transacción, desaparecería justo cuando más falta hace: un login
 * fallido y un `REFRESH_TOKEN_REUSE` (que además revoca sesiones) deben quedar
 * registrados aunque la operación se rechace.
 *
 * Por eso los caminos de error llaman a {@link AuthService.auditRechazo}, que
 * abre su PROPIA transacción y la confirma antes de propagar el error. Es
 * deliberado que esa escritura no sea atómica con nada: no hay nada que
 * revertir, y perderla sería perder la evidencia.
 */
import { AUTH, env } from '../../config/index.js';
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { AuditAction, AuditEntityType, Role, UserStatus } from '../../shared/domain/index.js';
import {
  AUTH_DETAIL_CODE,
  AuthenticationError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import type { UserContext } from '../../shared/domain/index.js';
import type { AuthRepository, SessionSort } from './auth.repository.js';
import type {
  AuthResult,
  ChangePasswordInput,
  ForgotPasswordInput,
  IssuedTokens,
  LoginInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
  RevokeSessionResult,
  SessionView,
  UserProfile,
} from './auth.types.js';
import { assertPasswordPolicy, burnTimingForUnknownUser, hashPassword, verifyPassword } from './password.service.js';
import type { SessionContext, TokenService } from './token.service.js';

/** Mensaje único de credenciales incorrectas. NUNCA depende de qué falló. */
const GENERIC_CREDENTIALS_MESSAGE = 'Correo o contraseña incorrectos';

/**
 * Detalle de `forgot-password`, idéntico exista o no la cuenta (API.md 7.1).
 * Se exporta para que el controller lo devuelva en `meta.message`: el mensaje y
 * la decisión anti-enumeración tienen que salir del MISMO sitio.
 */
export const FORGOT_PASSWORD_MESSAGE = 'Si la cuenta existe, enviamos el enlace de restablecimiento';

/** Columnas ordenables de `GET /auth/sessions`. */
const SESSION_SORT_COLUMNS = ['created_at'] as const;

/** Orden por defecto del listado de sesiones. */
const SESSION_DEFAULT_SORT = 'created_at';

/** `details.code` de un token de reseteo inválido (API.md 4). */
const INVALID_RESET_TOKEN = 'INVALID_RESET_TOKEN';

/** Contexto de auditoría de una petición: actor, red y requestId. */
export interface AuthRequestContext {
  /** Actor autenticado. `null` en endpoints públicos (register, login...). */
  readonly actor: UserContext | null;
  /**
   * `businessId` con el que se firma el access token y se escribe `audit_logs`.
   *
   * Sale del access token cuando ya hay actor (BR-SEC-008: la identidad de
   * negocio NUNCA se acepta del cuerpo ni de la query) y del negocio singleton
   * por defecto cuando la petición aún no está autenticada, como un registro de
   * cliente nuevo o un login.
   */
  readonly businessId: number;
  /** IP y user agent de la petición, para `audit_logs`. */
  readonly request: RequestAuditMeta;
  /** `deviceInfo` y `ip_address` que se guardan con la sesión. */
  readonly session: SessionContext;
  /** `sid` del access token: la sesión actual, si la hay. */
  readonly sessionId: number | null;
}

/** Paginación del listado de sesiones, ya normalizada. */
export interface SessionsPage {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly items: readonly SessionView[];
}

/** Resultado de un cambio o reseteo de contraseña. */
export interface PasswordChangeResult {
  readonly sessionsRevoked: number;
  /** Tokens nuevos de la sesión conservada. `null` si se cerró todas. */
  readonly tokens: IssuedTokens | null;
}

/**
 * Servicio de autenticación.
 *
 * Las dependencias se inyectan por constructor (DESIGN.md 3.6): no hay
 * `getAuthRepository()` global ni singletons mutables de repositorio.
 */
export class AuthService {
  public constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // REGISTRO
  // ==========================================================================

  /**
   * `POST /auth/register` — alta de cliente.
   *
   * El usuario recibe el rol `CUSTOMER` y `is_staff = 0`. La fila de `users` y
   * la de `user_roles` se crean en la MISMA transacción: un cliente sin rol
   * `CUSTOMER` no podría autenticarse con permisos de cliente ni aparecer en
   * `/customers`, así que media fila es un estado inconsistente.
   *
   * No existe tabla `customers` (DESIGN.md 4.7: 34 tablas, ninguna de
   * clientes); un cliente ES un `users` con rol `CUSTOMER`. Por eso "crear el
   * registro de customers" es, exactamente, asignar ese rol.
   */
  public register(input: RegisterInput, context: AuthRequestContext): AuthResult {
    const now = nowIso();
    assertPasswordPolicy(input.password, 'password');

    return runInTransactionSync(() => {
      // El email ya viene normalizado por el esquema zod; se normaliza otra vez
      // porque el service es la única frontera de confianza (BR-SEC-010).
      const email = input.email.trim().toLowerCase();
      if (this.repository.findCredentialByEmail(email) !== null) {
        throw new ConflictError('Ya existe una cuenta con ese correo electrónico', {
          details: { code: 'EMAIL_TAKEN', field: 'email' },
        });
      }

      const customerRoleId = this.repository.findRoleIdByName(Role.CUSTOMER);
      if (customerRoleId === null) {
        // Sin roles sembrados no hay forma de crear una cuenta utilizable: es un
        // problema de despliegue, no de la petición.
        throw new BusinessRuleError('El sistema no está configurado: ejecuta la semilla de roles', {
          details: { code: 'RBAC_NOT_SEEDED' },
        });
      }

      const userId = this.repository.insertUser({
        email,
        passwordHash: hashPassword(input.password),
        fullName: input.fullName.trim(),
        phone: input.phone ?? null,
        photoUrl: null,
        isStaff: false,
      });
      this.repository.assignRole(userId, customerRoleId);

      const refresh = this.tokens.issueRefreshToken(userId, now, context.session);
      this.repository.touchLastLogin(userId, now);

      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.user,
        entityId: userId,
        actor: { id: userId, email, businessId: context.businessId },
        request: context.request,
        // `afterData` sin el hash: el sanean del audit service lo borraría, pero
        // ni siquiera se intenta enviar.
        afterData: { id: userId, email, fullName: input.fullName, roles: [Role.CUSTOMER] },
      });

      const user = this.requireProfile(userId);
      return {
        user,
        tokens: this.buildTokens(user, refresh.token, refresh.id, context.businessId),
      };
    });
  }

  // ==========================================================================
  // LOGIN
  // ==========================================================================

  /**
   * `POST /auth/login`.
   *
   * Anti-enumeración: email inexistente y contraseña incorrecta producen el
   * MISMO `AuthenticationError` (mismo mensaje y mismo `details.code`) y el
   * primero gasta el mismo coste bcrypt que el segundo (DESIGN.md 11.1).
   * `BLOCKED`/`INACTIVE` sí tienen código propio: lo permite API.md 7.1 y son
   * estados que el usuario necesita conocer para contactar con el negocio.
   */
  public login(input: LoginInput, context: AuthRequestContext): AuthResult {
    const now = nowIso();
    const email = input.email.trim().toLowerCase();

    // ── Fase 1: resolver y verificar. Sólo lectura, fuera de transacción ──────
    // Las comprobaciones que pueden terminar en error NO van dentro de una
    // transacción: su auditoría tiene que sobrevivir al `ROLLBACK` que provoca el
    // propio rechazo (ver la nota de cabecera de este fichero).
    const user = this.repository.findCredentialByEmail(email);

    if (user === null) {
      // Coste de un login real para que el tiempo de respuesta no revele que
      // la cuenta no existe (DESIGN.md 11.1).
      burnTimingForUnknownUser(input.password);
      this.auditRechazo(
        {
          action: AuditAction.LOGIN_FAILED,
          entityType: AuditEntityType.user,
          actor: { id: null, email, businessId: context.businessId },
          request: context.request,
          afterData: { reason: 'UNKNOWN_EMAIL' },
        },
      );
      throw invalidCredentials();
    }

    if (!verifyPassword(input.password, user.passwordHash)) {
      this.auditRechazo({
        action: AuditAction.LOGIN_FAILED,
        entityType: AuditEntityType.user,
        entityId: user.id,
        actor: { id: user.id, email: user.email, businessId: context.businessId },
        request: context.request,
        afterData: { reason: 'INVALID_PASSWORD' },
      });
      throw invalidCredentials();
    }

    // BR-SEC-004: un usuario bloqueado o inactivo no autentica; y si tenía
    // sesiones, se revocan.
    if (user.status !== UserStatus.ACTIVE) {
      const revokedSessions = runInTransactionSync(() => {
        const count = this.tokens.revokeAllSessions(user.id, now);
        this.audit.record({
          action: AuditAction.LOGIN_FAILED,
          entityType: AuditEntityType.user,
          entityId: user.id,
          actor: { id: user.id, email: user.email, businessId: context.businessId },
          request: context.request,
          afterData: { reason: `STATUS_${user.status}`, revokedSessions: count },
        });
        return count;
      });
      throw new AuthorizationError(
        user.status === UserStatus.BLOCKED
          ? 'La cuenta está bloqueada. Contacte con el negocio.'
          : 'La cuenta está inactiva. Contacte con el negocio.',
        {
          details: {
            // El código de wire de API.md 7.1 coincide con el valor del enum.
            code: user.status === UserStatus.BLOCKED ? UserStatus.BLOCKED : UserStatus.INACTIVE,
            revokedSessions,
          },
        },
      );
    }

    // ── Fase 2: emitir la sesión, en transacción ───────────────────────────
    return runInTransactionSync(() => {
      // Se relee el usuario DENTRO de la transacción: entre la fase 1 y aquí
      // otro proceso pudo bloquearlo, y no queremos abrir una sesión a un
      // usuario que ya no está activo.
      const current = this.repository.findCredentialById(user.id);
      if (current === null) {
        throw new AuthenticationError('El token no corresponde a un usuario válido', {
          details: { code: AUTH_DETAIL_CODE.INVALID_TOKEN },
        });
      }
      if (current.status !== UserStatus.ACTIVE) {
        throw new AuthorizationError('La cuenta ya no está activa', {
          details: {
            code:
              current.status === UserStatus.BLOCKED ? UserStatus.BLOCKED : UserStatus.INACTIVE,
          },
        });
      }

      const refresh = this.tokens.issueRefreshToken(current.id, now, context.session);
      this.repository.touchLastLogin(current.id, now);

      this.audit.record({
        action: AuditAction.LOGIN,
        entityType: AuditEntityType.user,
        entityId: current.id,
        actor: { id: current.id, email: current.email, businessId: context.businessId },
        request: context.request,
        afterData: { sessionId: refresh.id, device: context.session.deviceInfo },
      });

      const profile = this.requireProfile(current.id);
      return {
        user: profile,
        tokens: this.buildTokens(profile, refresh.token, refresh.id, context.businessId),
      };
    });
  }

  // ==========================================================================
  // REFRESH CON ROTACIÓN
  // ==========================================================================

  /**
   * `POST /auth/refresh` — rota el refresh token (DESIGN.md 11.2, pasos 1-8).
   *
   * Un token ya revocado que se presenta de nuevo es un indicio de robo: se
   * revocan TODAS las sesiones del usuario y se registra `REFRESH_TOKEN_REUSE`,
   * que es la única forma de que el atacante con la copia stale unable a iniciar
   * sesión (el token nuevo sigue vivo) y el legítimo quede fuera hasta que
   * vuelva a autenticarse.
   */
  public refresh(input: RefreshInput, context: AuthRequestContext): {
    readonly tokens: IssuedTokens;
    readonly user: UserProfile;
  } {
    const now = nowIso();
    const tokenHash = this.tokens.hashRefreshToken(input.refreshToken);

    // ── Fase 1: localizar la sesión (sólo lectura) ───────────────────────────
    const record = this.repository.findRefreshTokenByHash(tokenHash);
    if (record === null) {
      // Ni siquiera hay usuario al que atribuir el intento: 401 y basta.
      throw new AuthenticationError('El token de refresco no es válido', {
        details: { code: AUTH_DETAIL_CODE.INVALID_TOKEN },
      });
    }

    // ── REUSO: el token ya fue rotado o revocado ────────────────────────────
    // Va FUERA de la transacción de éxito porque la respuesta es un error: si
    // se escribiera dentro, el `ROLLBACK` borraría la revocación de la familia
    // y el registro `REFRESH_TOKEN_REUSE`, y el robo quedaría sin consecuencia.
    if (record.revokedAt !== null) {
      const revoked = runInTransactionSync(() => {
        const count = this.tokens.revokeAllSessions(record.userId, now);
        this.audit.record({
          action: AuditAction.REFRESH_TOKEN_REUSE,
          entityType: AuditEntityType.user,
          entityId: record.userId,
          actor: { id: record.userId, email: null, businessId: context.businessId },
          request: context.request,
          beforeData: { sessionId: record.id, replacedById: record.replacedById },
          afterData: { revokedSessions: count, reason: 'REFRESH_TOKEN_REUSE' },
        });
        return count;
      });
      logger.warn(
        { userId: record.userId, sessionId: record.id, revokedSessions: revoked },
        'posible robo de refresh token: se revocan todas las sesiones del usuario',
      );
      throw new AuthenticationError('El token de refresco ya se usó. Se han cerrado todas las sesiones.', {
        details: { code: AUTH_DETAIL_CODE.TOKEN_REUSE, revokedSessions: revoked },
      });
    }

    // ── EXPIRADO ───────────────────────────────────────────────────────────
    if (Date.parse(record.expiresAt) <= Date.parse(now)) {
      runInTransactionSync(() => {
        this.tokens.revokeSession(record.id, now);
      });
      throw new AuthenticationError('El token de refresco ha expirado', {
        details: { code: AUTH_DETAIL_CODE.TOKEN_EXPIRED },
      });
    }

    // ── Fase 2: rotar, en transacción ───────────────────────────────────────
    return runInTransactionSync(() => {
      const user = this.repository.findCredentialById(record.userId);
      if (user === null) {
        this.tokens.revokeAllSessions(record.userId, now);
        throw new AuthenticationError('El token de refresco no es válido', {
          details: { code: AUTH_DETAIL_CODE.INVALID_TOKEN },
        });
      }
      if (user.status !== UserStatus.ACTIVE) {
        const revoked = this.tokens.revokeAllSessions(user.id, now);
        throw new AuthorizationError('La cuenta ya no está activa', {
          details: {
            code: user.status === UserStatus.BLOCKED ? UserStatus.BLOCKED : UserStatus.INACTIVE,
            revokedSessions: revoked,
          },
        });
      }

      // Primero la nueva, después se revoca la anterior: `replaced_by_id` la
      // referencia y necesita conocer su id.
      const refresh = this.tokens.issueRefreshToken(user.id, now, {
        deviceInfo: record.deviceInfo,
        ipAddress: context.session.ipAddress ?? record.ipAddress,
      });
      this.tokens.rotateSession(record.id, now, refresh.id);

      const profile = this.requireProfile(user.id);
      return {
        user: profile,
        tokens: this.buildTokens(profile, refresh.token, refresh.id, context.businessId),
      };
    });
  }

  // ==========================================================================
  // LOGOUT
  // ==========================================================================

  /**
   * `POST /auth/logout` — revoca la sesión actual (`sid` del access token).
   *
   * Idempotente (API.md 7.1): si ya estaba revocada, responde 200 igual con
   * `revokedSessions: 0`. Un token sin `sid` (emitido antes de esta versión o por
   * una migración) revoca todas las sesiones del usuario: es lo único seguro.
   */
  public logout(context: AuthRequestContext): number {
    const now = nowIso();
    const actor = this.requireActor(context);

    return runInTransactionSync(() => {
      const revoked =
        context.sessionId === null
          ? this.tokens.revokeAllSessions(actor.id, now)
          : this.tokens.revokeSession(context.sessionId, now) ? 1 : 0;

      this.audit.record({
        action: AuditAction.LOGOUT,
        entityType: AuditEntityType.user,
        entityId: actor.id,
        actor: { id: actor.id, email: actor.email, businessId: actor.businessId },
        request: context.request,
        afterData: { sessionId: context.sessionId, revokedSessions: revoked },
      });
      return revoked;
    });
  }

  /**
   * `POST /auth/logout-all` — revoca todas las sesiones (BR-SEC-003).
   *
   * `currentPassword` es opcional: si viene, se verifica y un fallo es 403, para
   * que un token robado no pueda cerrar todas las sesiones de un usuario.
   */
  public logoutAll(
    input: { readonly currentPassword?: string | null },
    context: AuthRequestContext,
  ): number {
    const now = nowIso();
    const actor = this.requireActor(context);

    if (input.currentPassword !== undefined && input.currentPassword !== null) {
      const user = this.repository.findCredentialById(actor.id);
      if (user === null || !verifyPassword(input.currentPassword, user.passwordHash)) {
        this.audit.record({
          action: AuditAction.LOGOUT,
          entityType: AuditEntityType.user,
          entityId: actor.id,
          actor: { id: actor.id, email: actor.email, businessId: actor.businessId },
          request: context.request,
          afterData: { reason: 'LOGOUT_ALL_INVALID_PASSWORD' },
        });
        throw new AuthorizationError('La contraseña actual no es correcta', {
          details: { code: 'INVALID_CREDENTIALS' },
        });
      }
    }

    return runInTransactionSync(() => {
      const revoked = this.tokens.revokeAllSessions(actor.id, now);
      this.audit.record({
        action: AuditAction.LOGOUT,
        entityType: AuditEntityType.user,
        entityId: actor.id,
        actor: { id: actor.id, email: actor.email, businessId: actor.businessId },
        request: context.request,
        afterData: { revokedSessions: revoked, scope: 'ALL' },
      });
      return revoked;
    });
  }

  // ==========================================================================
  // RECUPERACIÓN DE CONTRASEÑA
  // ==========================================================================

  /**
   * `POST /auth/forgot-password` (DESIGN.md 11.8).
   *
   * SIEMPRE responde con el mismo mensaje, exista o no la cuenta. La existencia
   * de un correo no es información pública: al revés de un login, aquí la
   * diferencia se nota en la bandeja de entrada.
   *
   * El enlace con el token SÓLO se registra en desarrollo. En producción el
   * token viaja por el proveedor de correo, y ni el log ni la auditoría lo
   * guardan jamás (BR-SEC-001).
   */
  public requestPasswordReset(input: ForgotPasswordInput, context: AuthRequestContext): void {
    const email = input.email.trim().toLowerCase();

    runInTransactionSync(() => {
      const user = this.repository.findCredentialByEmail(email);
      if (user === null) {
        // Mismo trabajo aproximado que un acierto: se genera un token y se
        // descarta, para que la respuesta no dependa de si la cuenta existe.
        this.tokens.issuePasswordResetToken();
        logger.info(
          { email, requestId: context.request.requestId },
          'forgot-password: correo sin cuenta; se responde igual',
        );
        return;
      }

      const reset = this.tokens.issuePasswordResetToken();
      this.repository.setPasswordReset(user.id, reset.tokenHash, reset.expiresAt);

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.user,
        entityId: user.id,
        actor: { id: user.id, email: user.email, businessId: context.businessId },
        request: context.request,
        // Ni el token ni su hash: sólo el hecho de que se solicited.
        afterData: { passwordResetRequested: true, expiresAt: reset.expiresAt },
      });

      if (!env.isProduction) {
        logger.info(
          {
            userId: user.id,
            requestId: context.request.requestId,
            // El token SOLO se registra fuera de producción: es el sustituto del
            // correo, que aún no existe en esta fase.
            resetUrl: `${env.security.resetPasswordLinkBaseUrl}?token=${reset.token}`,
            expiresAt: reset.expiresAt,
          },
          'forgot-password: enlace de restablecimiento (SOLO desarrollo)',
        );
      }
    });
  }

  /**
   * `POST /auth/reset-password` (DESIGN.md 11.8).
   *
   * El token es de un solo uso: se anula al aplicarlo. Como la contraseña cambia,
   * se revocan TODAS las sesiones (BR-SEC-003). Todo en una transacción: o se
   * cambia la contraseña y se cierran las sesiones, o no ocurre nada.
   */
  public resetPassword(input: ResetPasswordInput, context: AuthRequestContext): number {
    const now = nowIso();
    this.assertPasswordConfirmation(input.password, input.confirmPassword);
    assertPasswordPolicy(input.password, 'password');

    const tokenHash = this.tokens.hashRefreshToken(input.token);

    return runInTransactionSync(() => {
      const userId = this.repository.findUserIdByPasswordResetHash(tokenHash);
      if (userId === null) {
        // No existe, expiró o ya se usó: mensaje idéntico en los tres casos, que
        // es la información que el atacante no debe distinguir.
        throw new ValidationError('El enlace de restablecimiento no es válido o ha expirado', {
          details: [{ path: 'token', message: 'Solicite un nuevo enlace de restablecimiento', code: INVALID_RESET_TOKEN }],
        });
      }

      const user = this.repository.findCredentialById(userId);
      if (user === null) {
        throw new ValidationError('El enlace de restablecimiento no es válido o ha expirado', {
          details: [{ path: 'token', message: 'Solicite un nuevo enlace de restablecimiento', code: INVALID_RESET_TOKEN }],
        });
      }

      this.repository.updatePassword(user.id, hashPassword(input.password));
      this.repository.clearPasswordReset(user.id);
      const revoked = this.tokens.revokeAllSessions(user.id, now);

      this.audit.record({
        action: AuditAction.PASSWORD_RESET,
        entityType: AuditEntityType.user,
        entityId: user.id,
        actor: { id: user.id, email: user.email, businessId: context.businessId },
        request: context.request,
        beforeData: { passwordReset: 'pending' },
        afterData: { passwordReset: 'consumed', revokedSessions: revoked, at: now },
      });

      return revoked;
    });
  }

  /**
   * `POST /auth/change-password`.
   *
   * Exige la contraseña actual. Con `keepCurrentSession` (por defecto `true`) se
   * revocan TODAS las sesiones y se rota la del dispositivo actual, de forma que
   * el usuario no se queda sin sesión tras cambiar su propia contraseña
   * (BR-SEC-003). Con `false` se cierran todas, incluida la actual.
   */
  public changePassword(input: ChangePasswordInput, context: AuthRequestContext): PasswordChangeResult {
    const now = nowIso();
    const actor = this.requireActor(context);
    this.assertPasswordConfirmation(input.newPassword, input.confirmPassword);
    assertPasswordPolicy(input.newPassword, 'newPassword');

    // ── Fase 1 (fuera de transacción): validar la contraseña actual ──────────
    // El rechazo va con su auditoría en transacción propia: ver la nota de
    // cabecera sobre por qué la auditoría de un rechazo no puede vivir dentro
    // de la transacción que se va a revertir.
    const user = this.repository.findCredentialById(actor.id);
    if (user === null) {
      throw new AuthenticationError('El token no corresponde a un usuario válido', {
        details: { code: AUTH_DETAIL_CODE.INVALID_TOKEN },
      });
    }
    if (!verifyPassword(input.currentPassword, user.passwordHash)) {
      this.auditRechazo({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.user,
        entityId: user.id,
        actor: { id: actor.id, email: user.email, businessId: actor.businessId },
        request: context.request,
        afterData: { passwordChange: 'REJECTED_INVALID_CURRENT' },
      });
      throw new AuthenticationError('La contraseña actual no es correcta', {
        details: { code: AUTH_DETAIL_CODE.INVALID_CREDENTIALS, field: 'currentPassword' },
      });
    }
    if (verifyPassword(input.newPassword, user.passwordHash)) {
      throw new BusinessRuleError('La nueva contraseña debe ser distinta de la actual', {
        details: { code: 'PASSWORD_SAME_AS_CURRENT', field: 'newPassword' },
      });
    }

    // ── Fase 2: cambiar la contraseña y revocar sesiones, en transacción ────
    return runInTransactionSync(() => {
      // Se relee dentro de la transacción: si otro dispositivo cambió la
      // contraseña entre las dos fases, la validación de la fase 1 ya no vale.
      const current = this.repository.findCredentialById(actor.id);
      if (current === null || !verifyPassword(input.currentPassword, current.passwordHash)) {
        throw new BusinessRuleError(
          'La contraseña actual no es correcta: ha cambiado desde que la validé',
          { details: { code: 'PASSWORD_CHANGED_CONCURRENTLY', field: 'currentPassword' } },
        );
      }

      this.repository.updatePassword(current.id, hashPassword(input.newPassword));
      const revoked = this.tokens.revokeAllSessions(current.id, now);

      let tokens: IssuedTokens | null = null;
      if (input.keepCurrentSession) {
        const refresh = this.tokens.issueRefreshToken(current.id, now, context.session);
        const profile = this.requireProfile(current.id);
        tokens = this.buildTokens(profile, refresh.token, refresh.id, context.businessId);
      }

      this.audit.record({
        action: AuditAction.PASSWORD_RESET,
        entityType: AuditEntityType.user,
        entityId: current.id,
        actor: { id: actor.id, email: current.email, businessId: actor.businessId },
        request: context.request,
        afterData: {
          passwordChanged: true,
          revokedSessions: revoked,
          keepCurrentSession: input.keepCurrentSession,
        },
      });

      return { sessionsRevoked: revoked, tokens };
    });
  }

  // ==========================================================================
  // PERFIL Y SESIONES
  // ==========================================================================

  /** `GET /auth/me` — perfil del actor con roles y permisos (BR-RBAC-005). */
  public me(actor: UserContext): UserProfile {
    return this.requireProfile(actor.id);
  }

  /**
   * `PATCH /auth/me` — nombre, teléfono y foto.
   *
   * El email, los roles y el estado NO se cambian por aquí: son
   * administrativos (`PATCH /users/:id`) y el email exige verificación.
   */
  public updateProfile(
    patch: { readonly fullName?: string; readonly phone?: string | null; readonly photoUrl?: string | null },
    context: AuthRequestContext,
  ): UserProfile {
    const actor = this.requireActor(context);

    return runInTransactionSync(() => {
      const before = this.requireProfile(actor.id);
      this.repository.updateProfile(actor.id, patch);
      const after = this.requireProfile(actor.id);

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.user,
        entityId: actor.id,
        actor: { id: actor.id, email: actor.email, businessId: actor.businessId },
        request: context.request,
        beforeData: pickProfileFields(before),
        afterData: pickProfileFields(after),
      });

      return after;
    });
  }

  /** `GET /auth/sessions` — sesiones activas del actor, con la actual marcada. */
  public listSessions(
    page: number,
    pageSize: number,
    sort: { readonly column: string; readonly direction: 'ASC' | 'DESC' },
    context: AuthRequestContext,
  ): SessionsPage {
    const actor = this.requireActor(context);
    // El repositorio recibe una columna ya validada contra la allowlist; aquí se
    // vuelve a acotar porque el service es la frontera de confianza.
    const column = (SESSION_SORT_COLUMNS as readonly string[]).includes(sort.column)
      ? (sort.column as SessionSort['column'])
      : (SESSION_DEFAULT_SORT as SessionSort['column']);

    const total = this.repository.countActiveSessions(actor.id);
    const rows = this.repository.listActiveSessions({
      userId: actor.id,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      sort: { column, direction: sort.direction },
    });

    return {
      page,
      pageSize,
      total,
      items: rows.map((row) => ({
        id: row.id,
        deviceInfo: row.deviceInfo,
        ipAddress: row.ipAddress,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        isCurrent: row.id === context.sessionId,
      })),
    };
  }

  /**
   * `DELETE /auth/sessions/:id` — revoca una sesión propia.
   *
   * Sólo sesiones del propio actor: si el id es de otro usuario se responde 404
   * (no se revela que existe). La sesión actual NO se puede revocar aquí; para
   * eso está `POST /auth/logout`, que además registra el evento.
   *
   * Idempotente: si ya estaba revocada devuelve 200 con
   * `meta.warnings: ['ALREADY_REVOKED']` (API.md 7.1).
   */
  public revokeSession(sessionId: number, context: AuthRequestContext): RevokeSessionResult {
    const now = nowIso();
    const actor = this.requireActor(context);

    if (context.sessionId !== null && sessionId === context.sessionId) {
      throw new BusinessRuleError('No se puede revocar la sesión actual desde aquí', {
        details: { code: 'CURRENT_SESSION', hint: 'Use POST /api/v1/auth/logout' },
      });
    }

    return runInTransactionSync(() => {
      const record = this.repository.findRefreshTokenByIdForUser(sessionId, actor.id);
      if (record === null) {
        throw new NotFoundError('La sesión no existe', {
          details: { id: sessionId, type: 'refresh_token' },
        });
      }

      const alreadyRevoked = record.revokedAt !== null;
      if (!alreadyRevoked) {
        this.tokens.revokeSession(sessionId, now);
      }

      this.audit.record({
        action: AuditAction.LOGOUT,
        entityType: AuditEntityType.user,
        entityId: actor.id,
        actor: { id: actor.id, email: actor.email, businessId: actor.businessId },
        request: context.request,
        afterData: { sessionId, alreadyRevoked },
      });

      return { revokedAt: now, alreadyRevoked };
    });
  }

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  /**
   * Escribe la auditoría de un intento RECHAZADO en su propia transacción.
   *
   * Existe por la razón de la cabecera del fichero: el `throw` que sigue
   * revierte la transacción del caso de uso, y una fila escrita dentro de ella
   * desaparecería. Aquí la escritura se confirma y LUEGO se propaga el error.
   */
  private auditRechazo(entry: Parameters<AuditService['record']>[0]): void {
    runInTransactionSync(() => {
      this.audit.record(entry);
    });
  }

  /** Verifica que `password` y `confirmPassword` coinciden (API.md 7.1). */
  private assertPasswordConfirmation(password: string, confirmPassword: string): void {
    if (password !== confirmPassword) {
      throw new ValidationError('Las contraseñas no coinciden', {
        details: [
          {
            path: 'confirmPassword',
            message: 'La confirmación no coincide con la contraseña',
            code: 'PASSWORD_MISMATCH',
          },
        ],
      });
    }
  }

  /** Actor obligatorio: los endpoints autenticados ya lo garantizan. */
  private requireActor(context: AuthRequestContext): UserContext {
    if (context.actor === null) {
      throw new AuthenticationError('No se recibió el token de autenticación', {
        details: { code: AUTH_DETAIL_CODE.MISSING_TOKEN },
      });
    }
    return context.actor;
  }

  /** Perfil obligatorio: 404 si el usuario desapareció entre el token y ahora. */
  private requireProfile(id: number): UserProfile {
    const profile = this.repository.findProfileById(id);
    if (profile === null) {
      throw new NotFoundError('El usuario no existe', { details: { id, type: 'user' } });
    }
    return profile;
  }

  /** Empaqueta el access token y el refresh token en la forma del contrato. */
  private buildTokens(
    profile: UserProfile,
    refreshToken: string,
    sessionId: number,
    businessId: number,
  ): IssuedTokens {
    return {
      accessToken: this.tokens.signAccessToken({
        userId: profile.id,
        email: profile.email,
        roles: profile.roles,
        businessId,
        sessionId,
      }),
      refreshToken,
      tokenType: AUTH.BEARER,
      expiresIn: this.tokens.accessTokenTtlSeconds,
      sessionId,
    };
  }
}

/** Error de credenciales inválidas: el MISMO para email inexistente y contraseña. */
function invalidCredentials(): AuthenticationError {
  return new AuthenticationError(GENERIC_CREDENTIALS_MESSAGE, {
    details: { code: AUTH_DETAIL_CODE.INVALID_CREDENTIALS },
  });
}

/** Campos del perfil que van al audit log. Nunca el hash ni tokens. */
function pickProfileFields(profile: UserProfile): Record<string, unknown> {
  return {
    id: profile.id,
    email: profile.email,
    fullName: profile.fullName,
    phone: profile.phone,
    photoUrl: profile.photoUrl,
    status: profile.status,
    roles: [...profile.roles],
  };
}
