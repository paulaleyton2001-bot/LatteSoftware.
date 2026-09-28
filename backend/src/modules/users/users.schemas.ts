/**
 * Esquemas zod del módulo `users` (API.md 7.2).
 *
 * `.strict()` en todos: un campo desconocido es 400. `businessId` además lo
 * rechaza el middleware `validate` en cualquier cuerpo (API.md 2).
 */
import { z } from 'zod';

import { PAGINATION } from '../../config/index.js';
import { Role, UserStatus } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import {
  emailField,
  fullNameField,
  passwordField,
  phoneField,
  photoUrlField,
  reasonField,
  resourceIdField,
  searchQueryField,
} from '../../shared/validation/index.js';

/** `GET /users` (API.md 7.2). */
export const listUsersQuerySchema = buildListQuerySchema({
  role: z.enum(Role).optional(),
  status: z.enum(UserStatus).optional(),
  q: searchQueryField,
  isStaff: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

/**
 * `POST /users` (API.md 7.2).
 *
 * `password` es opcional: si no llega, el service genera una aleatoria que nadie
 * conoce y devuelve un token de un solo uso para que el usuario elija la suya.
 */
export const createUserBodySchema = z
  .object({
    email: emailField,
    password: passwordField.optional(),
    fullName: fullNameField,
    phone: phoneField,
    photoUrl: photoUrlField,
    roles: z.array(z.enum(Role)).min(1, 'Debe indicar al menos un rol').max(6),
    sendInvitation: z.boolean().default(false),
  })
  .strict();

/**
 * `PATCH /users/:id` (API.md 7.2).
 *
 * NO admite `password`: la contraseña tiene su propio endpoint administrativo
 * (`POST /users/:id/reset-password`), que además revoca las sesiones.
 */
export const updateUserBodySchema = z
  .object({
    fullName: fullNameField.optional(),
    phone: phoneField,
    photoUrl: photoUrlField,
    email: emailField.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** `POST /users/:id/roles` (API.md 7.2). */
export const assignRoleBodySchema = z
  .object({
    roleId: resourceIdField,
  })
  .strict();

/** `PATCH /users/:id/status` (API.md 7.2). */
export const updateUserStatusBodySchema = z
  .object({
    status: z.enum(UserStatus),
    /** Obligatorio si el estado es `BLOCKED` (API.md 7.2). */
    reason: reasonField,
  })
  .strict()
  .refine(
    (body) => body.status !== UserStatus.BLOCKED || (body.reason !== undefined && body.reason.length > 0),
    'Debe indicar el motivo del bloqueo',
  );

/** `POST /users/:id/reset-password` (API.md 7.2). */
export const adminResetPasswordBodySchema = z
  .object({
    /**
     * `true` (por defecto): el token viaja por correo y la API no lo devuelve.
     * `false`: la API devuelve `meta.resetToken` una única vez, para que el
     * administrador se lo pase al usuario. En NINGÚN caso se devuelve una
     * contraseña.
     */
    sendEmail: z.boolean().default(true),
  })
  .strict()
  .optional();

/** `GET /users/:id` · `PATCH` · `DELETE` · acciones sobre un usuario. */
export const userIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** `DELETE /users/:id/roles/:roleId`. */
export const userRoleParamsSchema = z
  .object({
    id: resourceIdField,
    roleId: resourceIdField,
  })
  .strict();

/** Columnas permitidas como orden en `GET /users` (API.md 7.2). */
export const USER_SORT_COLUMNS = ['created_at', 'full_name', 'last_login_at'] as const;

/** Orden por defecto: los usuarios más recientes primero. */
export const USER_SORT_DEFAULT = 'created_at';

/** Paginación por defecto de los listados de usuarios. */
export const USER_PAGE_SIZE_DEFAULT = PAGINATION.DEFAULT_PAGE_SIZE;

/** Tipos inferidos, para el controller. */
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type CreateUserBody = z.infer<typeof createUserBodySchema>;
export type UpdateUserBody = z.infer<typeof updateUserBodySchema>;
export type AssignRoleBody = z.infer<typeof assignRoleBodySchema>;
export type UpdateUserStatusBody = z.infer<typeof updateUserStatusBodySchema>;
export type AdminResetPasswordBody = z.infer<typeof adminResetPasswordBodySchema>;
export type UserIdParams = z.infer<typeof userIdParamsSchema>;
export type UserRoleParams = z.infer<typeof userRoleParamsSchema>;
