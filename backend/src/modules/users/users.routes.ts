/**
 * Rutas de `/api/v1/users` (API.md 7.2).
 *
 * TODOS los endpoints exigen `authenticate` + un permiso `users:*`, y el
 * permiso se comprueba contra `role_permissions` en la base de datos, nunca contra
 * una matriz en el código (`shared/middleware/authorize.ts`). Un `CUSTOMER` que
 * llame a cualquiera de ellos recibe 403 con `details.required` (BR-SEC-012).
 *
 * Este router NO se monta bajo `/auth`, así que no lleva el límite de tasa
 * estricto de autenticación: hereda el global, que es el que corresponde a la
 * administración.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { asyncHandler } from '../../shared/http/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { getContainer } from '../../config/container.js';
import { UsersController } from './users.controller.js';
import {
  USER_SORT_COLUMNS,
  USER_SORT_DEFAULT,
  adminResetPasswordBodySchema,
  assignRoleBodySchema,
  createUserBodySchema,
  listUsersQuerySchema,
  updateUserBodySchema,
  updateUserStatusBodySchema,
  userIdParamsSchema,
  userRoleParamsSchema,
} from './users.schemas.js';

/** Controller único del módulo, construido por el contenedor. */
const controller = new UsersController(getContainer().services.users);

/** Router del módulo. Se monta bajo `/api/v1/users`. */
export const usersRouter: Router = Router();

/**
 * `GET /users` — `users:read`.
 * El orden se valida contra `USER_SORT_COLUMNS` y `parseSort` añade el
 * desempate por `id`, así que la paginación nunca duplica ni omite filas.
 */
usersRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.USERS_READ),
  validate({
    query: listUsersQuerySchema,
    sortable: {
      allowedColumns: USER_SORT_COLUMNS,
      defaultColumn: USER_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.list,
);

/** `POST /users` — `users:create`. */
usersRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.USERS_CREATE),
  validate({ body: createUserBodySchema }),
  controller.create,
);

/**
 * Rutas parametrizadas. Se declaran DESPUÉS de `/` para que Express no las
 * confunda con la raíz del recurso.
 */

/** `GET /users/:id` — `users:read`. */
usersRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.USERS_READ),
  validate({ params: userIdParamsSchema }),
  asyncHandler(controller.getById),
);

/** `PATCH /users/:id` — `users:update`. */
usersRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.USERS_UPDATE),
  validate({ params: userIdParamsSchema, body: updateUserBodySchema }),
  controller.update,
);

/** `DELETE /users/:id` — `users:delete` (soft delete). */
usersRouter.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.USERS_DELETE),
  validate({ params: userIdParamsSchema }),
  controller.remove,
);

/** `POST /users/:id/roles` — `users:roles:assign`. */
usersRouter.post(
  '/:id/roles',
  authenticate,
  requirePermission(PERMISSION.USERS_ROLES_ASSIGN),
  validate({ params: userIdParamsSchema, body: assignRoleBodySchema }),
  controller.assignRole,
);

/** `DELETE /users/:id/roles/:roleId` — `users:roles:assign`. */
usersRouter.delete(
  '/:id/roles/:roleId',
  authenticate,
  requirePermission(PERMISSION.USERS_ROLES_ASSIGN),
  validate({ params: userRoleParamsSchema }),
  controller.removeRole,
);

/** `PATCH /users/:id/status` — `users:status:update`. */
usersRouter.patch(
  '/:id/status',
  authenticate,
  requirePermission(PERMISSION.USERS_STATUS_UPDATE),
  validate({ params: userIdParamsSchema, body: updateUserStatusBodySchema }),
  controller.changeStatus,
);

/** `POST /users/:id/reset-password` — `users:password:reset`. */
usersRouter.post(
  '/:id/reset-password',
  authenticate,
  requirePermission(PERMISSION.USERS_PASSWORD_RESET),
  validate({ params: userIdParamsSchema, body: adminResetPasswordBodySchema }),
  controller.adminResetPassword,
);
