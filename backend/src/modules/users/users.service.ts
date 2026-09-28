/**
 * Servicio de usuarios: casos de uso de `/api/v1/users/*` (API.md 7.2).
 *
 * Aquí viven las REGLAS DE NEGOCIO del directorio:
 *  - BR-RBAC-003: nadie se quita a sí mismo el rol `OWNER`; si el sistema tiene
 *    un único `OWNER`, quitarlo o borrarlo es `422 LAST_OWNER_PROTECTED`.
 *  - BR-RBAC-004: un `MANAGER` no puede crear ni editar usuarios con rol
 *    `ADMIN` u `OWNER`. (En la matriz `users:create` ya esexclusive de
 *    ADMIN/OWNER, pero la regla se comprueba igualmente: el permiso puede
 *    cambiar y la regla de negocio no debe depender de él.)
 *  - BR-RBAC-007: cambiar los roles revoca los refresh tokens, para que el
 *    cambio de permisos surta efecto en el siguiente refresh y no 15 minutos
 *    después.
 *  - BR-SEC-004: pasar a `BLOCKED` o `INACTIVE` revoca todas las sesiones.
 *  - BR-SEC-007: todo cambio deja fila en `audit_logs` con antes y después.
 *
 * DECISIÓN DE DISEÑO DOCUMENTADA (no está en DESIGN.md ni en API.md)
 *  `ADMIN` y `OWNER` son roles de administración superior: un `ADMIN` no puede
 *  borrar a otro `ADMIN` ni quitarle su rol (403 `ADMIN_ROLE_PROTECTED`); sólo
 *  un `OWNER` puede. Sin esta regla, un `ADMIN` con `users:delete` podría dejar
 *  el despliegue sin nadie capaz de administrar usuarios, y un `ADMIN` podría
 *  degradar a otro `ADMIN` hasta dejar el sistema ingobernable. El borrado del
 *  último `OWNER` sigue protegido por BR-RBAC-003 en todos los casos.
 *
 * Este service no conoce Express, ni zod, ni SQL (DESIGN.md 3.1).
 */
import { AUTH } from '../../config/index.js';
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { AuditAction, AuditEntityType, Role, UserStatus } from '../../shared/domain/index.js';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import { randomToken } from '../../shared/utils/random.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import type { UserContext } from '../../shared/domain/index.js';
import { assertPasswordPolicy, hashPassword } from '../auth/password.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { UsersRepository } from './users.repository.js';
import type {
  AdminPasswordResetResult,
  AdminUserView,
  AssignRoleResult,
  CreateUserInput,
  CreateUserResult,
  DeleteUserResult,
  RemoveRoleResult,
  UpdateUserInput,
  UserListFilter,
  UserPage,
} from './users.types.js';

/** Roles que sólo un `OWNER` puede conceder, quitar o borrar. */
const ELEVATED_ROLES: readonly Role[] = [Role.OWNER];

/** Contexto de la petición para auditoría. */
export interface UsersRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Servicio del directorio de usuarios. */
export class UsersService {
  public constructor(
    private readonly repository: UsersRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /** `GET /users` — listado paginado con filtros de rol, estado, texto e isStaff. */
  public list(filter: UserListFilter): UserPage {
    const items = this.repository.list(filter);
    const total = this.repository.count(filter);
    return { items, total };
  }

  /**
   * `GET /users/:id` — usuario con roles y permisos.
   *
   * 404 si no existe. Un `CUSTOMER` ni siquiera llega aquí: `requirePermission`
   * lo rechaza con 403 antes (BR-SEC-012: en `/users/*` la respuesta es 403, no
   * 404, para que el cliente no dude de si el recurso existe).
   */
  public getById(id: number): AdminUserView {
    return this.requireUser(id);
  }

  // ==========================================================================
  // Alta
  // ==========================================================================

  /**
   * `POST /users` — alta de un usuario con uno o varios roles.
   *
   * Si no llega contraseña se genera una aleatoria de 32 bytes: nadie la
   * conoce, así que el usuario no puede autenticarse hasta que la cambie, y no
   * existe ninguna contraseña weak en el sistema. El panel recibe un token de un
   * solo uso (`meta.resetToken`) para entregárselo, nunca la contraseña.
   */
  public create(input: CreateUserInput, context: UsersRequestContext): CreateUserResult {
    this.assertMayGrantRoles(input.roles, context.actor);

    if (input.password !== undefined && input.password !== null) {
      assertPasswordPolicy(input.password, 'password');
    }

    const email = input.email.trim().toLowerCase();
    const temporaryPassword = input.password === undefined || input.password === null
      ? randomToken(AUTH.RESET_TOKEN_BYTES)
      : null;
    const passwordHash = hashPassword(temporaryPassword ?? (input.password as string));

    return runInTransactionSync(() => {
      if (this.repository.findIdByEmail(email) !== null) {
        throw new ConflictError('Ya existe una cuenta con ese correo electrónico', {
          details: { code: 'EMAIL_TAKEN', field: 'email' },
        });
      }

      const userId = this.repository.insert({
        email,
        passwordHash,
        fullName: input.fullName.trim(),
        phone: input.phone ?? null,
        photoUrl: input.photoUrl ?? null,
        isStaff: false,
      });

      for (const roleName of input.roles) {
        const role = this.repository.findRoleByName(roleName);
        if (role === null) {
          throw new BusinessRuleError(`El rol ${roleName} no existe`, {
            details: { code: 'ROLE_NOT_FOUND', role: roleName },
          });
        }
        this.repository.assignRole(userId, role.id);
      }
      this.repository.syncIsStaff(userId);

      const user = this.requireUser(userId);
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.user,
        entityId: userId,
        actor: this.actorOf(context),
        request: context.request,
        afterData: {
          id: userId,
          email,
          fullName: user.fullName,
          roles: [...user.roles],
          isStaff: user.isStaff,
          // Ni la contraseña ni su hash: sólo el hecho de que se generó una.
          temporaryPasswordGenerated: temporaryPassword !== null,
        },
      });

      return { user, temporaryPassword };
    });
  }

  // ==========================================================================
  // Edición
  // ==========================================================================

  /**
   * `PATCH /users/:id` — nombre, teléfono, foto y email.
   *
   * Cambiar el email revalida el `UNIQUE`: dos usuarios con el mismo correo
   * romperían el login. El email NO se cambia por esta vía si el usuario es un
   * `CUSTOMER` que edita su propio registro: eso lo hace `PATCH /customers/:id`
   * con verificación previa.
   */
  public update(id: number, input: UpdateUserInput, context: UsersRequestContext): AdminUserView {
    return runInTransactionSync(() => {
      const before = this.requireUser(id);
      const email = input.email === undefined ? undefined : input.email.trim().toLowerCase();

      if (email !== undefined && email !== before.email) {
        const owner = this.repository.findIdByEmail(email);
        if (owner !== null && owner !== id) {
          throw new ConflictError('Ya existe una cuenta con ese correo electrónico', {
            details: { code: 'EMAIL_TAKEN', field: 'email' },
          });
        }
      }

      this.repository.update(id, {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName.trim() }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.photoUrl === undefined ? {} : { photoUrl: input.photoUrl }),
        ...(email === undefined ? {} : { email }),
      });

      const after = this.requireUser(id);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.user,
        entityId: id,
        actor: this.actorOf(context),
        request: context.request,
        beforeData: this.auditView(before),
        afterData: this.auditView(after),
      });
      return after;
    });
  }

  // ==========================================================================
  // Soft delete
  // ==========================================================================

  /**
   * `DELETE /users/:id` — baja lógica + revocación de sesiones.
   *
   * Reglas, en el orden en que se comprueban:
   *  1. No se puede borrar a uno mismo (`422 SELF_DELETE_FORBIDDEN`): un
   *     administrador que se borra deja su propia sesión apuntando a un usuario
   *     inexistente y, además, el panel se queda sin actor.
   *  2. No se puede borrar a un `ADMIN` si el actor no es `OWNER`
   *     (`403 ADMIN_ROLE_PROTECTED`).
   *  3. No se puede borrar al último `OWNER` (`422 LAST_OWNER_PROTECTED`).
   *
   * El histórico (pedidos, pagos, auditoría) se conserva: por eso es un soft
   * delete y no un `DELETE`.
   */
  public remove(id: number, context: UsersRequestContext): DeleteUserResult {
    const now = nowIso();
    const actor = context.actor;

    return runInTransactionSync(() => {
      const before = this.requireUser(id);

      if (id === actor.id) {
        throw new BusinessRuleError('No puede eliminar su propia cuenta', {
          details: { code: 'SELF_DELETE_FORBIDDEN' },
        });
      }

      const isOwner = actor.roles.includes(Role.OWNER);
      const targetRoles = before.roles;

      if (!isOwner && targetRoles.includes(Role.ADMIN)) {
        throw new AuthorizationError(
          'Sólo un propietario puede eliminar a un administrador',
          { details: { code: 'ADMIN_ROLE_PROTECTED', required: Role.OWNER } },
        );
      }

      const ownerRole = this.repository.findRoleByName(Role.OWNER);
      if (ownerRole !== null && targetRoles.includes(Role.OWNER)) {
        this.assertNotLastOwner(ownerRole.id, id);
      }

      this.repository.softDelete(id, now);
      const revokedSessions = this.repository.revokeAllSessions(id, now);

      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.user,
        entityId: id,
        actor: this.actorOf(context),
        request: context.request,
        beforeData: this.auditView(before),
        afterData: { id, deletedAt: now, status: UserStatus.INACTIVE, revokedSessions },
      });

      return { id, deletedAt: now, revokedSessions };
    });
  }

  // ==========================================================================
  // Roles
  // ==========================================================================

  /**
   * `POST /users/:id/roles` — asigna un rol.
   *
   * Revoca los refresh tokens del usuario (BR-RBAC-007) para que los permisos
   * cambien en el siguiente refresh. Un `409 ROLE_ALREADY_ASSIGNED` si lo tenía.
   */
  public assignRole(userId: number, roleId: number, context: UsersRequestContext): AssignRoleResult {
    const now = nowIso();
    const role = this.repository.findRoleById(roleId);
    if (role === null) {
      throw new BusinessRuleError('El rol indicado no existe', {
        details: { code: 'ROLE_NOT_FOUND', roleId },
      });
    }
    this.assertMayGrantRoles([role.name], context.actor);

    return runInTransactionSync(() => {
      const before = this.requireUser(userId);
      if (this.repository.hasRole(userId, roleId)) {
        throw new ConflictError('El usuario ya tiene ese rol', {
          details: { code: 'ROLE_ALREADY_ASSIGNED', role: role.name },
        });
      }

      this.repository.assignRole(userId, roleId);
      this.repository.syncIsStaff(userId);
      const revokedSessions = this.repository.revokeAllSessions(userId, now);
      const after = this.requireUser(userId);

      this.audit.record({
        action: AuditAction.ROLE_CHANGE,
        entityType: AuditEntityType.user,
        entityId: userId,
        actor: this.actorOf(context),
        request: context.request,
        beforeData: { roles: [...before.roles], isStaff: before.isStaff },
        afterData: {
          roles: [...after.roles],
          isStaff: after.isStaff,
          added: role.name,
          revokedSessions,
        },
      });

      return { user: after, assignedRoles: after.roles, revokedSessions };
    });
  }

  /**
   * `DELETE /users/:id/roles/:roleId` — quita un rol.
   *
   *  - `422 SELF_ROLE_REMOVAL_FORBIDDEN`: nadie se quita a sí mismo un rol que
   *    usa para administrar (BR-RBAC-003 habla del `OWNER`; aquí se extiende a
   *    `ADMIN` y `OWNER` porque un administrador que se degrada a sí mismo
   *    desaparece del panel sin previo aviso).
   *  - `422 LAST_OWNER_PROTECTED`: si quitan el `OWNER` al último propietario.
   */
  public removeRole(
    userId: number,
    roleId: number,
    context: UsersRequestContext,
  ): RemoveRoleResult {
    const now = nowIso();
    const role = this.repository.findRoleById(roleId);
    if (role === null) {
      throw new NotFoundError('El rol indicado no existe', {
        details: { id: roleId, type: 'role' },
      });
    }
    this.assertMayGrantRoles([role.name], context.actor);

    return runInTransactionSync(() => {
      const before = this.requireUser(userId);
      if (!this.repository.hasRole(userId, roleId)) {
        throw new NotFoundError('El usuario no tiene ese rol', {
          details: { id: userId, type: 'user_role', role: role.name },
        });
      }

      const isSelf = userId === context.actor.id;
      if (isSelf && ELEVATED_ROLES.includes(role.name)) {
        throw new BusinessRuleError('No puede quitarse a sí mismo un rol de administración superior', {
          details: { code: 'SELF_ROLE_REMOVAL_FORBIDDEN', role: role.name },
        });
      }

      if (role.name === Role.OWNER) {
        this.assertNotLastOwner(roleId, userId);
      }

      this.repository.removeRole(userId, roleId);
      this.repository.syncIsStaff(userId);
      const revokedSessions = this.repository.revokeAllSessions(userId, now);
      const after = this.requireUser(userId);

      this.audit.record({
        action: AuditAction.ROLE_CHANGE,
        entityType: AuditEntityType.user,
        entityId: userId,
        actor: this.actorOf(context),
        request: context.request,
        beforeData: { roles: [...before.roles], isStaff: before.isStaff },
        afterData: {
          roles: [...after.roles],
          isStaff: after.isStaff,
          removed: role.name,
          revokedSessions,
        },
      });

      return { userId, roleId, removedAt: now, revokedSessions };
    });
  }

  // ==========================================================================
  // Estado
  // ==========================================================================

  /**
   * `PATCH /users/:id/status` — activar, inactivar o bloquear.
   *
   *  - `422 SELF_DEACTIVATION_FORBIDDEN`: uno mismo no se desactiva ni se bloquea.
   *  - `422 LAST_OWNER_PROTECTED`: el último `OWNER` no puede quedar ni
   *    inactivo ni bloqueado.
   *  - Pasar a `BLOCKED`/`INACTIVE` revoca todas las sesiones (BR-SEC-004).
   */
  public changeStatus(
    userId: number,
    status: UserStatus,
    reason: string | null,
    context: UsersRequestContext,
  ): AdminUserView {
    const now = nowIso();

    return runInTransactionSync(() => {
      const before = this.requireUser(userId);

      if (userId === context.actor.id && status !== UserStatus.ACTIVE) {
        throw new BusinessRuleError('No puede desactivar ni bloquear su propia cuenta', {
          details: { code: 'SELF_DEACTIVATION_FORBIDDEN' },
        });
      }

      const ownerRole = this.repository.findRoleByName(Role.OWNER);
      if (ownerRole !== null && before.roles.includes(Role.OWNER) && status !== UserStatus.ACTIVE) {
        this.assertNotLastOwner(ownerRole.id, userId);
      }

      this.repository.updateStatus(userId, status);
      const revokedSessions =
        status === UserStatus.ACTIVE ? 0 : this.repository.revokeAllSessions(userId, now);
      const after = this.requireUser(userId);

      this.audit.record({
        action: AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.user,
        entityId: userId,
        actor: this.actorOf(context),
        request: context.request,
        beforeData: { status: before.status },
        afterData: { status, reason, revokedSessions },
      });

      return after;
    });
  }

  // ==========================================================================
  // Reseteo administrativo de contraseña
  // ==========================================================================

  /**
   * `POST /users/:id/reset-password` — el administrador restablece el acceso de
   * un usuario SIN conocer nunca su contraseña.
   *
   * Qué hace, exactamente:
   *  1. Sustituye `password_hash` por el de una contraseña aleatoria de 32
   *     bytes. Como nadie la conoce, el usuario no puede entrar con ella ni
   *     adivinarla; y como es aleatoria, no es una contraseña débil.
   *  2. Emite un token de reseteo de un solo uso, igual que el flujo público
   *     `forgot-password`, y guarda su SHA-256.
   *  3. Revoca todas las sesiones del usuario.
   *
   * La API devuelve `meta.resetToken` SÓLO si el administrador pidió
   * `sendEmail: false` (no hay proveedor de correo en esta fase). La contraseña
   * temporal NO se devuelve nunca: quien llama no puede conocerla.
   */
  public adminResetPassword(
    userId: number,
    sendEmail: boolean,
    context: UsersRequestContext,
  ): AdminPasswordResetResult {
    const now = nowIso();

    return runInTransactionSync(() => {
      const before = this.requireUser(userId);

      const temporaryPassword = randomToken(AUTH.RESET_TOKEN_BYTES);
      this.repository.updatePassword(userId, hashPassword(temporaryPassword));
      this.repository.clearPasswordReset(userId);

      const reset = this.tokens.issuePasswordResetToken();
      this.repository.setPasswordReset(userId, reset.tokenHash, reset.expiresAt);
      const revokedSessions = this.repository.revokeAllSessions(userId, now);

      this.audit.record({
        action: AuditAction.PASSWORD_RESET,
        entityType: AuditEntityType.user,
        entityId: userId,
        actor: this.actorOf(context),
        request: context.request,
        beforeData: { status: before.status, roles: [...before.roles] },
        afterData: {
          passwordResetByAdmin: true,
          revokedSessions,
          resetExpiresAt: reset.expiresAt,
          sendEmail,
        },
      });

      if (!sendEmail) {
        logger.info(
          { userId, requestId: context.request.requestId, expiresAt: reset.expiresAt },
          'reseteo administrativo: token de un solo uso emitido (SOLO desarrollo, sin proveedor de correo)',
        );
      }

      return {
        userId,
        revokedSessions,
        resetToken: sendEmail ? null : reset.token,
        expiresAt: sendEmail ? null : reset.expiresAt,
      };
    });
  }

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  /** Usuario obligatorio: 404 si no existe. */
  private requireUser(id: number): AdminUserView {
    const user = this.repository.findById(id);
    if (user === null) {
      throw new NotFoundError('El usuario no existe', { details: { id, type: 'user' } });
    }
    return user;
  }

  /** Proyección del usuario para el audit log: sin hash ni tokens. */
  private auditView(user: AdminUserView): Record<string, unknown> {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      status: user.status,
      isStaff: user.isStaff,
      roles: [...user.roles],
    };
  }

  /** Actor normalizado para el audit service. */
  private actorOf(context: UsersRequestContext): { id: number; email: string; businessId: number } {
    return {
      id: context.actor.id,
      email: context.actor.email,
      businessId: context.actor.businessId,
    };
  }

  /**
   * BR-RBAC-003/004: sólo un `OWNER` concede, quita o borra roles elevados.
   * `MANAGER` queda excluido por el mismo motivo aunque el middleware le dejara
   * pasar: la regla de negocio no depende de la matriz.
   */
  private assertMayGrantRoles(roles: readonly Role[], actor: UserContext): void {
    if (actor.roles.includes(Role.OWNER)) {
      return;
    }
    const elevated = roles.filter((role) => ELEVATED_ROLES.includes(role));
    if (elevated.length > 0) {
      throw new AuthorizationError('Sólo un propietario puede conceder este rol', {
        details: { code: 'ELEVATED_ROLE_PROTECTED', required: Role.OWNER, roles: elevated },
      });
    }
  }

  /**
   * El último `OWNER` no puede perder su rol ni quedar inactivo o bloqueado.
   * `countUsersWithRole` cuenta usuarios NO borrados: un `OWNER` dado de baja ya
   * no protege el despliegue, y bloquearlo sería dejar el sistema sin dueño.
   */
  private assertNotLastOwner(roleId: number, userId: number): void {
    const count = this.repository.countUsersWithRole(roleId);
    if (count <= 1) {
      throw new BusinessRuleError('No se puede modificar el último propietario del sistema', {
        details: { code: 'LAST_OWNER_PROTECTED', userId },
      });
    }
  }
}
