/**
 * Esquemas zod del módulo `auth` (API.md 7.1).
 *
 * TODOS son `.strict()`: un campo desconocido es `400 VALIDATION_ERROR`, no se
 * ignora en silencio (API.md 1). Los esquemas NO contienen reglas de negocio:
 * la política de contraseñas y la comparación de `confirmPassword` las resuelve
 * el service, que es donde viven las decisiones del dominio.
 */
import { z } from 'zod';

import { AUTH } from '../../config/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import {
  emailField,
  fullNameField,
  loginPasswordField,
  passwordField,
  phoneField,
  photoUrlField,
  resourceIdField,
} from '../../shared/validation/index.js';

/** `POST /auth/register` (API.md 7.1). */
export const registerBodySchema = z
  .object({
    email: emailField,
    password: passwordField,
    fullName: fullNameField,
    phone: phoneField,
  })
  .strict();

/** `POST /auth/login`. `deviceInfo` e `ipAddress` salen de la petición. */
export const loginBodySchema = z
  .object({
    email: emailField,
    password: loginPasswordField,
  })
  .strict();

/** `POST /auth/refresh`. */
export const refreshBodySchema = z
  .object({
    refreshToken: z
      .string({ error: 'El token de refresco es obligatorio' })
      .min(AUTH.REFRESH_TOKEN_MIN_LENGTH, 'El token de refresco no tiene el formato esperado')
      .max(AUTH.REFRESH_TOKEN_MAX_LENGTH, 'El token de refresco es demasiado largo'),
  })
  .strict();

/** `POST /auth/forgot-password`. */
export const forgotPasswordBodySchema = z
  .object({
    email: emailField,
  })
  .strict();

/** `POST /auth/reset-password`. */
export const resetPasswordBodySchema = z
  .object({
    token: z
      .string({ error: 'El token es obligatorio' })
      .min(AUTH.REFRESH_TOKEN_MIN_LENGTH, 'El token no tiene el formato esperado')
      .max(AUTH.REFRESH_TOKEN_MAX_LENGTH, 'El token es demasiado largo'),
    password: passwordField,
    confirmPassword: passwordField,
  })
  .strict();

/** `POST /auth/change-password`. */
export const changePasswordBodySchema = z
  .object({
    currentPassword: loginPasswordField,
    newPassword: passwordField,
    confirmPassword: passwordField,
    /**
     * Mantiene la sesión actual rotando su refresh token. Por defecto `true`
     * (API.md 7.1): tras cambiar la contraseña no se deja al usuario sin sesión
     * en el dispositivo desde el que la cambió.
     */
    keepCurrentSession: z.boolean().default(true),
  })
  .strict();

/** `POST /auth/logout-all`. El cuerpo es opcional: puede no enviarse. */
export const logoutAllBodySchema = z
  .object({
    currentPassword: loginPasswordField.optional(),
  })
  .strict()
  .optional();

/**
 * `PATCH /auth/me`.
 *
 * Sólo nombre, teléfono y foto. NO se acepta `email`, `roles`, `status` ni
 * `password`: el correo exige verificación, los roles y el estado son
 * administrativos (`PATCH /users/:id`) y la contraseña tiene su propio endpoint
 * que exige la actual. Un intento devuelve 400 con el detalle del campo.
 */
export const updateProfileBodySchema = z
  .object({
    fullName: fullNameField.optional(),
    phone: phoneField,
    photoUrl: photoUrlField,
  })
  .strict()
  .refine(
    (body) => Object.keys(body).length > 0,
    'Debe enviar al menos un campo para actualizar',
  );

/**
 * `GET /auth/sessions`.
 *
 * `sort` se limita a `createdAt`: el contrato menciona también `lastUsedAt`,
 * pero el esquema congelado (`refresh_tokens`) no tiene esa columna, así que
 * ordenarla por ella no es posible sin una migración. Un valor distinto da
 * `400 INVALID_SORT_FIELD`.
 */
export const sessionsQuerySchema = buildListQuerySchema();

/** Columnas permitidas como orden en `GET /auth/sessions`. */
export const SESSION_SORT_COLUMNS = ['created_at'] as const;

/** Orden por defecto: más reciente primero. */
export const SESSION_SORT_DEFAULT = 'created_at';

/** `DELETE /auth/sessions/:id`. */
export const sessionParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** Tipos inferidos, para el controller. */
export type RegisterBody = z.infer<typeof registerBodySchema>;
export type LoginBody = z.infer<typeof loginBodySchema>;
export type RefreshBody = z.infer<typeof refreshBodySchema>;
export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;
export type ChangePasswordBody = z.infer<typeof changePasswordBodySchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;
export type SessionParams = z.infer<typeof sessionParamsSchema>;
