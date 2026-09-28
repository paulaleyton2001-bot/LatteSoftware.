/**
 * Logger base de la aplicación (pino).
 *
 * NIVEL: `env.logLevel`.
 *
 * REDACCIÓN OBLIGATORIA: la lista de `redact` es la barrera que impide que un
 * token, una contraseña o un número de tarjeta llegue al disco o a la consola.
 * Los campos marcados se sustituyen por `[REDACTED]` y **nunca** se
 * registran. La lista cubre el contrato de datos del proyecto (API.md 6.3,
 * DESIGN.md 4.1 y 4.6):
 *  - credenciales: `req.headers.authorization`, `password`, `*.password`
 *  - hashes y tokens: `password_hash`, `token`, `accessToken`, `refreshToken`
 *  - pago: `cardNumber`, `cvv`
 */
import pino, { type Logger, type LoggerOptions } from 'pino';

import { env } from '../../config/index.js';

/** Valor con el que se sustituye todo dato sensible. */
export const REDACTED = '[REDACTED]';

/**
 * Rutas de campos sensibles. Sintaxis de pino:
 *  `a.b` = campo anidado; `a.*` = cualquier clave bajo `a`.
 */
export const REDACT_PATHS: readonly string[] = [
  // Cabeceras de autenticación y cookies de sesión.
  'req.headers.authorization',
  'req.headers.Authorization',
  'res.headers["set-cookie"]',
  'res.headers["Set-Cookie"]',
  'headers.authorization',
  'headers.Authorization',
  // Credenciales.
  'password',
  '*.password',
  'password_hash',
  '*.password_hash',
  'passwordHash',
  '*.passwordHash',
  'passwordResetTokenHash',
  '*.passwordResetTokenHash',
  // Tokens de sesión.
  'token',
  '*.token',
  'token_hash',
  '*.token_hash',
  'tokenHash',
  '*.tokenHash',
  'accessToken',
  '*.accessToken',
  'access_token',
  '*.access_token',
  'refreshToken',
  '*.refreshToken',
  'refresh_token',
  '*.refresh_token',
  'authorization',
  // Datos de tarjeta.
  'cardNumber',
  '*.cardNumber',
  'card_number',
  '*.card_number',
  'cvv',
  '*.cvv',
  'cvc',
  '*.cvc',
  'securityCode',
  '*.securityCode',
];

const redactConfig: NonNullable<LoggerOptions['redact']> = {
  paths: [...REDACT_PATHS],
  censor: REDACTED,
  remove: false,
};

const baseFields = {
  service: env.appName,
  env: env.appEnv,
  version: env.appVersion,
  pid: process.pid,
} as const;

/** Logger raíz. Los child de request añaden `requestId` y `reqId`. */
export const logger: Logger = pino({
  level: env.logLevel,
  redact: redactConfig,
  base: baseFields,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/** Reexportado para que los tests puedan tipar sus dobles. */
export type { Logger };
