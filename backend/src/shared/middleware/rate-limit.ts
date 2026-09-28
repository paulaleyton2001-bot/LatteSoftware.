/**
 * Límite de tasa (API.md 4: 429 RATE_LIMIT_ERROR).
 *
 * Dos límites, ambos configurables por entorno:
 *  - Global: `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` (300 req/min por
 *    defecto).
 *  - Endpoints de autenticación `/api/v1/auth/*`: `AUTH_RATE_LIMIT_MAX`
 *    (20 req/min por defecto), porque son el objetivo natural de un ataque de
 *    fuerza bruta sobre contraseñas.
 *
 * Y un tercero, más estricto y con ventana de una hora, para la RECUPERACIÓN DE
 * CONTRASEÑA (`AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS` /
 * `AUTH_PASSWORD_RATE_LIMIT_MAX`): son las rutas que permiten enumerar cuentas
 * o usar al backend para martillear un correo, así que van separadas del resto
 * de `/auth/*` y no comparten su contador. Se montan por ruta en
 * `modules/auth/auth.routes.ts`; aquí sólo se definen.
 *
 * `standardHeaders: true` publica `RateLimit-Limit`, `RateLimit-Remaining` y
 * `RateLimit-Reset`; además se añade `Retry-After` en segundos, que el
 * contrato exige para el 429. La respuesta usa el envoltorio de error de
 * API.md 3.2 con `details = { limit, windowMs, retryAfterSeconds }`.
 */
import rateLimit, { ipKeyGenerator, type Options } from 'express-rate-limit';
import type { Request, RequestHandler, Response } from 'express';

import { env } from '../../config/index.js';
import { PASSWORD_RESET_PATHS } from '../../config/constants.js';
import { ERROR_CODE, RateLimitError } from '../errors/index.js';
import { sendError } from '../http/response.js';

/** Prefijo de los endpoints con límite estricto. */
const AUTH_PATH_PREFIX = '/api/v1/auth';

/**
 * Interruptor global de los límites de tasa.
 *
 * `express-rate-limit` evalúa `skip` en CADA petición, así que un interruptor
 * leído en ese momento permite que `createApp({ disableRateLimit: true })` apague
 * también los limitadores montados por ruta (`/auth/*` y la recuperación de
 * contraseña), que si no seguirían activos y harían fallar los tests que
 * disparan peticiones en bucle. `createApp` es quien lo fija; los tests no lo
 * tocan directamente.
 */
let rateLimitingEnabled = true;

/**
 * Activa o desactiva TODOS los limitadores de la aplicación.
 * Lo llama `createApp`; en producción siempre queda activado.
 */
export function setRateLimitingEnabled(enabled: boolean): void {
  rateLimitingEnabled = enabled;
}

/** `true` si los limitadores están activos. */
export function isRateLimitingEnabled(): boolean {
  return rateLimitingEnabled;
}

/** `skip` común: desactiva el limitador mientras el interruptor esté apagado. */
const skipWhenDisabled = (): boolean => !rateLimitingEnabled;

/**
 * Clave de la IP normalizada.
 *
 * `ipKeyGenerator` es obligatorio: sin él, un usuario de IPv6 podría evadir el
 * límite cambiando de subred dentro del /64 que agrupa IPv6
 * (ERR_ERL_KEY_GEN_IPV6). `req.ip` ya respeta `trust proxy`.
 */
function keyByIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? '0.0.0.0');
}

/**
 * Convierte el `retryAfter` de express-rate-limit a número de segundos.
 *
 * Si la librería no lo aporta, se usa la ventana DEL LIMITADOR QUE DISPARÓ, no la
 * del global: con una ventana de una hora (recuperación de contraseña) un
 * `Retry-After: 60` sería mentira y el cliente reintentaría 60 veces por
 * segundo.
 */
function resolveRetryAfterSeconds(optionsUsed: Options): number {
  const value = optionsUsed.retryAfter;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.ceil(value);
  }
  const windowMs = optionsUsed.windowMs;
  if (typeof windowMs === 'number' && Number.isFinite(windowMs) && windowMs > 0) {
    return Math.max(1, Math.ceil(windowMs / 1000));
  }
  return Math.max(1, Math.ceil(env.rateLimit.windowMs / 1000));
}

/**
 * Emite el 429 con el envoltorio del contrato y las cabeceras obligatorias.
 *
 * `limit` y `windowMs` se leen del `optionsUsed` del limitador que ha
 * disparado, no de `env`: así el 429 de recuperación de contraseña publica sus
 * propios valores y no los del límite global.
 */
function sendRateLimitExceeded(
  req: Request,
  res: Response,
  optionsUsed: Options,
): void {
  const retryAfterSeconds = resolveRetryAfterSeconds(optionsUsed);
  res.setHeader('Retry-After', String(retryAfterSeconds));
  sendError(
    res,
    new RateLimitError('Demasiadas solicitudes. Inténtelo de nuevo en unos segundos.', {
      details: {
        code: ERROR_CODE.RATE_LIMIT,
        limit: optionsUsed.limit,
        windowMs: optionsUsed.windowMs,
        retryAfterSeconds,
        path: req.path,
      },
    }),
  );
}

/** Límite global. Se aplica a todas las peticiones de la API. */
export const globalRateLimit: RequestHandler = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIp,
  skip: skipWhenDisabled,
  handler: (req, res, _next, optionsUsed) => {
    sendRateLimitExceeded(req, res, optionsUsed);
  },
});

/** Límite estricto para `/api/v1/auth/*`. */
export const authRateLimit: RequestHandler = rateLimit({
  windowMs: env.rateLimit.windowMs,
  limit: env.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIp,
  skip: skipWhenDisabled,
  handler: (req, res, _next, optionsUsed) => {
    sendRateLimitExceeded(req, res, optionsUsed);
  },
});

/**
 * Límite reforzado de recuperación de contraseña
 * (`forgot-password` / `reset-password`).
 *
 * Ventana de una hora y máximo muy bajo. Comparte contador entre las dos rutas
 * a propósito: un atacante que rebota entre ellas no multiplica su presupuesto.
 */
export const passwordResetRateLimit: RequestHandler = rateLimit({
  windowMs: env.rateLimit.passwordWindowMs,
  limit: env.rateLimit.passwordMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByIp,
  skip: skipWhenDisabled,
  handler: (req, res, _next, optionsUsed) => {
    sendRateLimitExceeded(req, res, optionsUsed);
  },
});

/** `true` si la ruta es una de recuperación de contraseña. */
export function isPasswordResetPath(path: string): boolean {
  return PASSWORD_RESET_PATHS.some((candidate) => path === candidate || path.endsWith(candidate));
}

/** `true` si la ruta cae bajo el prefijo de autenticación. */
export function isAuthPath(path: string): boolean {
  return path === AUTH_PATH_PREFIX || path.startsWith(`${AUTH_PATH_PREFIX}/`);
}
