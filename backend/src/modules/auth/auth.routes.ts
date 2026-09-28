/**
 * Rutas de `/api/v1/auth` (API.md 7.1).
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): declara método, path,
 * middlewares y handler. No lee `req.body` sin validar, no decide permisos de
 * negocio y no importa repositorios.
 *
 * ============================== SEGURIDAD ===================================
 *  - Públicas: `register`, `login`, `refresh`, `forgot-password`,
 *    `reset-password` (API.md 2). No llevan `authenticate`; el service resuelve
 *    el caso "existe un token opcional" cuando procede.
 *  - Autenticadas: el resto, con `authenticate` delante. Sin credencial, 401
 *    `MISSING_TOKEN` (BR-SEC-005).
 *  - `PATCH /me` exige además `auth:profile:update`, que el cliente tiene con
 *    marca `P` en la matriz: el middleware resuelve el permiso y el service
 *    resuelve el alcance (sólo el propio registro).
 *  - `forgot-password` y `reset-password` llevan un SEGUNDO límite de tasa,
 *    propio y más estricto (`passwordResetRateLimit`), además del límite general
 *    de `/auth/*` que `modules/index.ts` ya monta. No se relaja ningún límite.
 *  - El orden de la cadena es siempre `authenticate -> requirePermission ->
 *    validate -> handler`: primero identidad, luego autorización, y sólo después
 *    la forma de la petición. Así un `CUSTOMER` recibe 403 y no 400 por un campo
 *    mal formado.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { asyncHandler } from '../../shared/http/index.js';
import {
  authenticate,
  passwordResetRateLimit,
  requirePermission,
  validate,
} from '../../shared/middleware/index.js';
import { getContainer } from '../../config/container.js';
import { AuthController } from './auth.controller.js';
import {
  changePasswordBodySchema,
  forgotPasswordBodySchema,
  loginBodySchema,
  logoutAllBodySchema,
  refreshBodySchema,
  registerBodySchema,
  resetPasswordBodySchema,
  sessionParamsSchema,
  sessionsQuerySchema,
  updateProfileBodySchema,
  SESSION_SORT_COLUMNS,
  SESSION_SORT_DEFAULT,
} from './auth.schemas.js';

/** Controller único del módulo, construido por el contenedor. */
const controller = new AuthController(getContainer().services.auth);

/** Router del módulo. Se monta bajo `/api/v1/auth` (ver `modules/index.ts`). */
export const authRouter: Router = Router();

// ---------------------------------------------------------------------------
// Públicas (API.md 2)
// ---------------------------------------------------------------------------

/** `POST /api/v1/auth/register` — alta de cliente (201). */
authRouter.post('/register', validate({ body: registerBodySchema }), controller.register);

/** `POST /api/v1/auth/login` — autenticación (200). */
authRouter.post('/login', validate({ body: loginBodySchema }), controller.login);

/** `POST /api/v1/auth/refresh` — rotación del refresh token (200). */
authRouter.post('/refresh', validate({ body: refreshBodySchema }), controller.refresh);

/**
 * `POST /api/v1/auth/forgot-password` — solicita el enlace de reseteo.
 * Límite reforzado de una hora: es la vía para enumerar cuentas.
 */
authRouter.post(
  '/forgot-password',
  passwordResetRateLimit,
  validate({ body: forgotPasswordBodySchema }),
  controller.forgotPassword,
);

/**
 * `POST /api/v1/auth/reset-password` — aplica el enlace de reseteo.
 * Comparte contador con `forgot-password`: rebotar entre las dos no aumenta el
 * presupuesto del atacante.
 */
authRouter.post(
  '/reset-password',
  passwordResetRateLimit,
  validate({ body: resetPasswordBodySchema }),
  controller.resetPassword,
);

// ---------------------------------------------------------------------------
// Autenticadas
// ---------------------------------------------------------------------------

/** `POST /api/v1/auth/logout` — revoca la sesión actual (200, idempotente). */
authRouter.post('/logout', authenticate, controller.logout);

/**
 * `POST /api/v1/auth/logout-all` — revoca todas las sesiones (200).
 * El cuerpo es opcional: si no se envía, `validate` deja pasar `undefined`.
 */
authRouter.post('/logout-all', authenticate, validate({ body: logoutAllBodySchema }), controller.logoutAll);

/** `POST /api/v1/auth/change-password` — cambio de contraseña propia (200). */
authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordBodySchema }),
  controller.changePassword,
);

/** `GET /api/v1/auth/me` — perfil del actor con roles y permisos (200). */
authRouter.get('/me', authenticate, asyncHandler(controller.me));

/** `PATCH /api/v1/auth/me` — nombre, teléfono y foto (200). */
authRouter.patch(
  '/me',
  authenticate,
  requirePermission(PERMISSION.AUTH_PROFILE_UPDATE),
  validate({ body: updateProfileBodySchema }),
  controller.updateProfile,
);

/** `GET /api/v1/auth/sessions` — sesiones activas del actor (200, paginado). */
authRouter.get(
  '/sessions',
  authenticate,
  validate({
    query: sessionsQuerySchema,
    sortable: {
      allowedColumns: SESSION_SORT_COLUMNS,
      defaultColumn: SESSION_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.listSessions,
);

/** `DELETE /api/v1/auth/sessions/:id` — revoca una sesión propia (200). */
authRouter.delete(
  '/sessions/:id',
  authenticate,
  validate({ params: sessionParamsSchema }),
  controller.revokeSession,
);
