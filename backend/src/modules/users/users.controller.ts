/**
 * Controller del módulo `users` (API.md 7.2).
 *
 * Adapta HTTP ⇄ service. No decide permisos (los resuelve `requirePermission` en
 * las rutas) ni reglas de negocio (las resuelve `UsersService`). Sólo traduce
 * el `req` ya validado a los tipos del service y da forma a la respuesta.
 */
import type { Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { UsersService, UsersRequestContext } from './users.service.js';
import type { UserListFilter, UserSortColumn } from './users.repository.js';
import { USER_SORT_DEFAULT } from './users.schemas.js';
import type {
  AdminResetPasswordBody,
  AssignRoleBody,
  CreateUserBody,
  ListUsersQuery,
  UpdateUserBody,
  UpdateUserStatusBody,
  UserIdParams,
  UserRoleParams,
} from './users.schemas.js';

/** `req` con actor y cuerpo/query/params validados. */
type UsersRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas aquí para acotar la salida de `parseSort`. */
const SORT_COLUMNS: readonly UserSortColumn[] = ['created_at', 'full_name', 'last_login_at'];

/** Contexto de auditoría de la petición. */
function contextOf(req: UsersRequest): UsersRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Controller del directorio de usuarios. */
export class UsersController {
  public constructor(private readonly users: UsersService) {}

  /** `GET /users` — listado paginado. */
  public list = async (req: UsersRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListUsersQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requestedColumn = req.validated?.sort?.column ?? USER_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requestedColumn)
      ? (requestedColumn as UserSortColumn)
      : (USER_SORT_DEFAULT as UserSortColumn);

    const filter: UserListFilter = {
      ...(query.role === undefined ? {} : { role: query.role }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.isStaff === undefined ? {} : { isStaff: query.isStaff }),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: { column, direction: req.validated?.sort?.direction ?? 'DESC' },
    };

    const page = this.users.list(filter);
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /** `GET /users/:id` — usuario con roles y permisos. */
  public getById = async (req: UsersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as UserIdParams;
    sendSuccess(res, this.users.getById(params.id));
  };

  /**
   * `POST /users` — 201 con el usuario creado.
   *
   * `meta.temporaryPassword` aparece sólo si el admin no envió contraseña: es la
   * única vez que esa cadena existe fuera del servidor.
   */
  public create = async (req: UsersRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateUserBody;
    const result = this.users.create(
      {
        email: body.email,
        ...(body.password === undefined ? {} : { password: body.password }),
        fullName: body.fullName,
        ...(body.phone === undefined ? {} : { phone: body.phone }),
        ...(body.photoUrl === undefined ? {} : { photoUrl: body.photoUrl }),
        roles: body.roles,
        sendInvitation: body.sendInvitation,
      },
      contextOf(req),
    );
    sendCreated(
      res,
      result.user,
      result.temporaryPassword === null
        ? {}
        : { temporaryPassword: result.temporaryPassword, temporaryPasswordExpiresIn: 900 },
    );
  };

  /** `PATCH /users/:id` — 200 con el usuario actualizado. */
  public update = async (req: UsersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as UserIdParams;
    const body = req.validated?.body as UpdateUserBody;
    const updated = this.users.update(
      params.id,
      {
        ...(body.fullName === undefined ? {} : { fullName: body.fullName }),
        ...(body.phone === undefined ? {} : { phone: body.phone }),
        ...(body.photoUrl === undefined ? {} : { photoUrl: body.photoUrl }),
        ...(body.email === undefined ? {} : { email: body.email }),
      },
      contextOf(req),
    );
    sendSuccess(res, updated);
  };

  /** `DELETE /users/:id` — 200 con `{ id, deletedAt, revokedSessions }`. */
  public remove = async (req: UsersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as UserIdParams;
    const result = this.users.remove(params.id, contextOf(req));
    sendSuccess(res, {
      id: result.id,
      deletedAt: result.deletedAt,
      revokedSessions: result.revokedSessions,
    });
  };

  /** `POST /users/:id/roles` — 200 con `{ user, assignedRoles }`. */
  public assignRole = async (req: UsersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as UserIdParams;
    const body = req.validated?.body as AssignRoleBody;
    const result = this.users.assignRole(params.id, body.roleId, contextOf(req));
    sendSuccess(res, {
      user: result.user,
      assignedRoles: result.assignedRoles,
      revokedSessions: result.revokedSessions,
    });
  };

  /** `DELETE /users/:id/roles/:roleId` — 200 con `{ userId, roleId, removedAt }`. */
  public removeRole = async (req: UsersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as UserRoleParams;
    const result = this.users.removeRole(params.id, params.roleId, contextOf(req));
    sendSuccess(res, {
      userId: result.userId,
      roleId: result.roleId,
      removedAt: result.removedAt,
      revokedSessions: result.revokedSessions,
    });
  };

  /** `PATCH /users/:id/status` — 200 con el usuario actualizado. */
  public changeStatus = async (req: UsersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as UserIdParams;
    const body = req.validated?.body as UpdateUserStatusBody;
    const updated = this.users.changeStatus(
      params.id,
      body.status,
      body.reason ?? null,
      contextOf(req),
    );
    sendSuccess(res, updated);
  };

  /**
   * `POST /users/:id/reset-password` — 200 con `{ userId, sessionsRevoked }`.
   *
   * `meta.resetToken` se devuelve SÓLO con `sendEmail: false`. Nunca se devuelve
   * una contraseña: quien llama no la conoce y no puede conocerla.
   */
  public adminResetPassword = async (req: UsersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as UserIdParams;
    const body = req.validated?.body as AdminResetPasswordBody;
    const result = this.users.adminResetPassword(params.id, body?.sendEmail !== false, contextOf(req));
    sendSuccess(
      res,
      { userId: result.userId, sessionsRevoked: result.revokedSessions },
      result.resetToken === null
        ? {}
        : { resetToken: result.resetToken, resetTokenExpiresAt: result.expiresAt },
    );
  };
}
