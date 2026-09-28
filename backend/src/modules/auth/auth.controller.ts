/**
 * Controller del módulo `auth`: adapta HTTP ⇄ servicio (DESIGN.md 3.2).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: no compara contraseñas, no revisa estados, no
 *    calcula TTLs. Traduce `req` -> tipos del service y la respuesta -> el
 *    envoltorio de API.md 3.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`, que es el
 *    único que decide el status y el `code`.
 *  - No escribe SQL ni toca la base de datos.
 *  - Construye el `AuthRequestContext` (actor, IP, user agent, `device_info`,
 *    `sid`) UNA vez, para que los 12 endpoints no repitan esa lectura.
 */
import type { Response } from 'express';

import { AUTH, MAX_DEVICE_INFO_LENGTH } from '../../config/index.js';
import type { UserContext } from '../../shared/domain/index.js';
import { AuthenticationError } from '../../shared/errors/index.js';
import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { currentSessionId, requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest, type RequestAuditMeta } from '../../shared/services/index.js';
import { FORGOT_PASSWORD_MESSAGE, type AuthService, type AuthRequestContext } from './auth.service.js';
import type { SessionContext } from './token.service.js';
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  RefreshBody,
  RegisterBody,
  ResetPasswordBody,
  UpdateProfileBody,
} from './auth.schemas.js';
import { SESSION_SORT_DEFAULT } from './auth.schemas.js';
import type { AuthResult, IssuedTokens, ProfilePatch, UserProfile } from './auth.types.js';

/**
 * `req` con la salida de `validate` y el actor resuelto por `authenticate`.
 *
 * `pagination` y `sort` los rellena el middleware `validate` cuando el endpoint
 * declara `sortable`; son opcionales porque no todos los endpoints lo hacen.
 */
type AuthenticatedRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Petición con actor, validada por el middleware. */
export type AuthRequest = AuthenticatedRequest;

/** `device_info` acotado a la longitud de la columna (DESIGN.md 4.1). */
function readDeviceInfo(headers: Readonly<Record<string, string | readonly string[] | undefined>>): string | null {
  const raw = headers['user-agent'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value.length > MAX_DEVICE_INFO_LENGTH ? value.slice(0, MAX_DEVICE_INFO_LENGTH) : value;
}

/** `data` de login, registro y refresh (API.md 7.1). */
function authPayload(result: AuthResult): Record<string, unknown> {
  return {
    user: result.user,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.refreshToken,
    tokenType: result.tokens.tokenType,
    expiresIn: result.tokens.expiresIn,
    sessionId: result.tokens.sessionId,
  };
}

/** `data` de refresh y de `change-password`: sólo tokens, sin el usuario. */
function tokensPayload(tokens: IssuedTokens): Record<string, unknown> {
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    tokenType: tokens.tokenType,
    expiresIn: tokens.expiresIn,
    sessionId: tokens.sessionId,
  };
}

/**
 * Controller de autenticación.
 *
 * Las dependencias llegan por constructor (`config/container.ts`): no hay
 * singletons de repositorio ni de service (DESIGN.md 3.3, punto 5).
 */
export class AuthController {
  public constructor(private readonly auth: AuthService) {}

  // ==========================================================================
  // Contexto de petición
  // ==========================================================================

  /**
   * Arma el contexto que consume el service.
   *
   * `actor` es `null` en los endpoints públicos. `sessionId` es el `sid` del
   * access token, que `authenticate` ya verificó y adjuntó a la petición: sin
   * él, `logout` no sabría qué sesión revocar.
   */
  private contextOf(req: AuthRequest, options: { readonly requireActor?: boolean } = {}): AuthRequestContext {
    const actor: UserContext | null = req.auth ?? null;
    if (options.requireActor === true && actor === null) {
      throw new AuthenticationError('No se recibió el token de autenticación', {
        details: { code: 'MISSING_TOKEN' },
      });
    }
    const request: RequestAuditMeta = auditMetaFromRequest(req);
    const session: SessionContext = {
      deviceInfo: readDeviceInfo(req.headers),
      ipAddress: request.ipAddress,
    };
    return {
      actor,
      // La identidad de negocio sale del token; en endpoints públicos, del
      // singleton por defecto (BR-SEC-008 y DESIGN.md 4.2).
      businessId: actor?.businessId ?? AUTH.DEFAULT_BUSINESS_ID,
      request,
      session,
      sessionId: currentSessionId(req),
    };
  }

  // ==========================================================================
  // Endpoints
  // ==========================================================================

  /** `POST /auth/register` -> 201 con usuario y tokens. */
  public register = async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as RegisterBody;
    const result = this.auth.register(
      { email: body.email, password: body.password, fullName: body.fullName, phone: body.phone },
      this.contextOf(req),
    );
    sendCreated(res, authPayload(result));
  };

  /** `POST /auth/login` -> 200 con usuario y tokens. */
  public login = async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as LoginBody;
    const result = this.auth.login(
      { email: body.email, password: body.password },
      this.contextOf(req),
    );
    sendSuccess(res, authPayload(result));
  };

  /** `POST /auth/refresh` -> 200 con el par de tokens rotado. */
  public refresh = async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as RefreshBody;
    const result = this.auth.refresh({ refreshToken: body.refreshToken }, this.contextOf(req));
    sendSuccess(res, tokensPayload(result.tokens));
  };

  /**
   * `POST /auth/logout` -> 200, `data: null`.
   * Idempotente: `revokedSessions` puede ser 0 sin que sea un error.
   */
  public logout = async (req: AuthRequest, res: Response): Promise<void> => {
    const revoked = this.auth.logout(this.contextOf(req, { requireActor: true }));
    sendSuccess(res, null, { revokedSessions: revoked });
  };

  /** `POST /auth/logout-all` -> 200, `data: null`, con el total revocado. */
  public logoutAll = async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as { currentPassword?: string } | undefined;
    const revoked = this.auth.logoutAll(
      { currentPassword: body?.currentPassword ?? null },
      this.contextOf(req, { requireActor: true }),
    );
    sendSuccess(res, null, { revokedSessions: revoked });
  };

  /**
   * `POST /auth/forgot-password` -> 200 SIEMPRE (API.md 7.1).
   * El mensaje es idéntico exista o no la cuenta: el service decide, el
   * controller sólo formatea.
   */
  public forgotPassword = async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as ForgotPasswordBody;
    this.auth.requestPasswordReset({ email: body.email }, this.contextOf(req));
    sendSuccess(res, null, { message: FORGOT_PASSWORD_MESSAGE });
  };

  /**
   * `POST /auth/reset-password` -> 200, `data: null`.
   * `meta.sessionsRevoked` informa de cuántas sesiones se cerraron (BR-SEC-003).
   */
  public resetPassword = async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as ResetPasswordBody;
    const sessionsRevoked = this.auth.resetPassword(
      { token: body.token, password: body.password, confirmPassword: body.confirmPassword },
      this.contextOf(req),
    );
    sendSuccess(res, null, { sessionsRevoked });
  };

  /**
   * `POST /auth/change-password` -> 200.
   *
   * Con `keepCurrentSession` (por defecto `true`) devuelve el par de tokens
   * nuevo: la sesión actual se rota en lugar de cerrarse, para que el usuario no
   * se quede fuera del dispositivo desde el que cambió su contraseña. Con
   * `false`, `data` es `null` y todas las sesiones quedan revocadas.
   */
  public changePassword = async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as ChangePasswordBody;
    const result = this.auth.changePassword(
      {
        currentPassword: body.currentPassword,
        newPassword: body.newPassword,
        confirmPassword: body.confirmPassword,
        keepCurrentSession: body.keepCurrentSession,
      },
      this.contextOf(req, { requireActor: true }),
    );
    if (result.tokens === null) {
      sendSuccess(res, null, { sessionsRevoked: result.sessionsRevoked });
      return;
    }
    sendSuccess(res, tokensPayload(result.tokens), { sessionsRevoked: result.sessionsRevoked });
  };

  /** `GET /auth/me` -> 200 con el perfil y los permisos resueltos. */
  public me = async (req: AuthRequest, res: Response): Promise<void> => {
    const actor = requireAuth(req);
    const profile: UserProfile = this.auth.me(actor);
    sendSuccess(res, profile);
  };

  /** `PATCH /auth/me` -> 200 con el perfil actualizado. */
  public updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as UpdateProfileBody;
    const patch: ProfilePatch = {
      ...(body.fullName === undefined ? {} : { fullName: body.fullName }),
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.photoUrl === undefined ? {} : { photoUrl: body.photoUrl }),
    };
    const profile = this.auth.updateProfile(patch, this.contextOf(req, { requireActor: true }));
    sendSuccess(res, profile);
  };

  /** `GET /auth/sessions` -> 200 paginado con la sesión actual marcada. */
  public listSessions = async (req: AuthRequest, res: Response): Promise<void> => {
    const validated = req.validated;
    const page = validated?.pagination?.page ?? 1;
    const pageSize = validated?.pagination?.pageSize ?? 20;
    const sort = validated?.sort;
    const result = this.auth.listSessions(
      page,
      pageSize,
      {
        column: sort?.column ?? SESSION_SORT_DEFAULT,
        direction: sort?.direction === 'ASC' ? 'ASC' : 'DESC',
      },
      this.contextOf(req, { requireActor: true }),
    );
    sendPaginated(res, result.items, { page: result.page, pageSize: result.pageSize, total: result.total });
  };

  /**
   * `DELETE /auth/sessions/:id` -> 200, `data: null`.
   * `meta.warnings: ['ALREADY_REVOKED']` si la sesión ya estaba cerrada
   * (API.md 6.4: las acciones son idempotentes en lectura de estado).
   */
  public revokeSession = async (req: AuthRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const result = this.auth.revokeSession(params.id, this.contextOf(req, { requireActor: true }));
    const meta: Record<string, unknown> = { revokedAt: result.revokedAt };
    if (result.alreadyRevoked) {
      meta['warnings'] = ['ALREADY_REVOKED'];
    }
    sendSuccess(res, null, meta);
  };
}
