/**
 * Contexto de petición: `requestId` de correlación.
 *
 * - Genera un UUID v4, o adopta el `X-Request-Id` entrante si el cliente lo
 *   manda (API.md 1: "Todo request acepta X-Request-Id y siempre responde con
 *   el mismo valor").
 * - Lo expone en `res.locals.requestId`, en la cabecera de respuesta y en cada
 *   línea de log (vía `pino-http` con `customProps`).
 * - Un `requestId` entrante se sanea: sólo se acepta `[A-Za-z0-9_.:-]`, con un
 *   tope de 128 caracteres, para que un cliente no pueda inyectar saltos de
 *   línea en los logs ni una cabecera gigante.
 */
import type { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER } from '../../config/index.js';
import { logger } from '../logger/index.js';
import { randomUuid } from '../utils/random.js';

/** Cabecera de respuesta con la correlación. */
export const RESPONSE_REQUEST_ID_HEADER = 'X-Request-Id';

/** Caracteres admitidos en un `requestId` entrante. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9_.:-]+$/;

/** Longitud máxima de un `requestId`. */
const MAX_REQUEST_ID_LENGTH = 128;

/** Lee un `requestId` entrante ya saneado, o `null` si no es válido. */
export function readIncomingRequestId(req: Request): string | null {
  const raw = req.headers[REQUEST_ID_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REQUEST_ID_LENGTH) {
    return null;
  }
  return SAFE_REQUEST_ID.test(trimmed) ? trimmed : null;
}

/** `requestId` ya resuelto en la respuesta, o `null`. */
export function currentRequestId(res: Response): string | null {
  const locals: unknown = res.locals;
  if (typeof locals === 'object' && locals !== null && 'requestId' in locals) {
    const value = (locals as { requestId: unknown }).requestId;
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

/**
 * Middleware de contexto. Debe montarse **antes** de `pino-http` para que
 * `genReqId` pueda reutilizar el identificador.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const requestId = readIncomingRequestId(req) ?? randomUuid();
  res.locals['requestId'] = requestId;
  res.setHeader(RESPONSE_REQUEST_ID_HEADER, requestId);
  next();
}

/**
 * Forma mínima que necesita este módulo: una petición con su respuesta
 * asociada. Se declara estructuralmente para que sirva tanto el `Request` de
 * Express como el `IncomingMessage` de `node:http` que entrega `pino-http`.
 */
export interface RequestWithResponse {
  readonly res?: unknown;
}

/**
 * `genReqId` y `customProps` de `pino-http`: reutilizan el `requestId` de
 * `res.locals` para que cada línea de log lleve la correlación, y no el id
 * interno de pino.
 */
export function resolveRequestIdFromResponse(req: RequestWithResponse): string {
  const response: unknown = req.res;
  if (typeof response === 'object' && response !== null && 'locals' in response) {
    const value = (response as { locals: unknown }).locals;
    if (typeof value === 'object' && value !== null && 'requestId' in value) {
      const requestId = (value as { requestId: unknown }).requestId;
      if (typeof requestId === 'string' && requestId.length > 0) {
        return requestId;
      }
    }
  }
  return randomUuid();
}

/**
 * Al cierre de la respuesta, registra la línea de acceso con duración.
 * Es un `res.on('finish')`: no añade latencia y no puede fallar.
 *
 * Usa `req.originalUrl` y no `req.path` porque Express reescribe `req.url` al
 * entrar en un router montado con `app.use('/api/v1', router)` y lo restaura al
 * salir. Leyendo `req.path` dentro del callback, la ruta salía truncada
 * (`/health` en lugar de `/api/v1/health`).
 */
export function logRequestCompletion(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level](
      {
        requestId: resolveRequestIdFromResponse(req),
        method: req.method,
        path: req.originalUrl.split('?')[0] ?? req.originalUrl,
        status: res.statusCode,
        durationMs,
        ip: req.ip,
      },
      'petición completada',
    );
  });
  next();
}
