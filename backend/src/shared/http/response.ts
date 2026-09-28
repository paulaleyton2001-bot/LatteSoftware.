/**
 * Envoltorio de respuesta (API.md sección 3).
 *
 * Éxito  -> `{ success: true, data, meta? }`
 * Error  -> `{ success: false, error: { code, message, details? }, requestId }`
 *
 * Invariantes:
 *  - `meta.requestId` está SIEMPRE presente en el éxito (API.md 3.1).
 *  - `requestId` en el error va **fuera** de `error`, a nivel raíz (API.md 3.2).
 *  - El stack trace nunca se serializa. En producción, los errores no
 *    operativos se sustituyen por un mensaje genérico.
 */
import type { Response } from 'express';

import { env } from '../../config/index.js';
import { ERROR_CODE, GENERIC_PRODUCTION_MESSAGE, isAppError, type ErrorCode } from '../errors/index.js';

/** Datos de paginación de `meta` en listados. */
export interface PaginationMeta {
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

/**
 * Contenido de `meta`. Siempre incluye `requestId`; el resto es opcional y
 * sólo se emite si el endpoint lo provee.
 */
export interface SuccessMeta {
  readonly requestId?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly total?: number;
  /** Reportes y mapa: instante de generación del payload. */
  readonly generatedAt?: string;
  /** Marca de tiempo de la respuesta. */
  readonly timestamp?: string;
  /** Avisos no bloqueantes, p. ej. campos ignorados. */
  readonly warnings?: readonly string[];
  /** Identificadores de reglas de negocio aplicadas. */
  readonly appliedRules?: readonly string[];
  readonly [key: string]: unknown;
}

/** Forma exacta del envoltorio de éxito. */
export interface SuccessEnvelope<T> {
  readonly success: true;
  readonly data: T;
  readonly meta: SuccessMeta;
}

/** Un detalle de validación: `{ path, message, code }` (API.md 3.2). */
export interface ValidationDetail {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

/** Forma exacta del envoltorio de error. */
export interface ErrorEnvelope {
  readonly success: false;
  readonly error: {
    readonly code: ErrorCode;
    readonly message: string;
    readonly details?: unknown;
  };
  readonly requestId: string;
}

/** Lee el `requestId` que dejó el middleware de contexto. */
export function getRequestId(res: Response): string {
  const locals: unknown = res.locals;
  if (typeof locals === 'object' && locals !== null && 'requestId' in locals) {
    const value = (locals as { requestId: unknown }).requestId;
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return 'unknown';
}

/** Emite un 200 con el envoltorio de éxito. `meta.requestId` se inyecta solo. */
export function sendSuccess<T>(res: Response, data: T, meta: SuccessMeta = {}): void {
  const envelope: SuccessEnvelope<T> = {
    success: true,
    data,
    meta: { ...meta, requestId: getRequestId(res) },
  };
  res.status(200).json(envelope);
}

/** Emite un 201 con el envoltorio de éxito. */
export function sendCreated<T>(res: Response, data: T, meta: SuccessMeta = {}): void {
  const envelope: SuccessEnvelope<T> = {
    success: true,
    data,
    meta: { ...meta, requestId: getRequestId(res) },
  };
  res.status(201).json(envelope);
}

/** Emite un 200 con `meta` de listado: `{ page, pageSize, total, requestId }`. */
export function sendPaginated<T>(
  res: Response,
  data: readonly T[],
  pagination: PaginationMeta,
  meta: SuccessMeta = {},
): void {
  sendSuccess(res, data, {
    ...meta,
    page: pagination.page,
    pageSize: pagination.pageSize,
    total: pagination.total,
  });
}

/** Emite un 204 sin cuerpo. Sólo para borrados sin contenido de respuesta. */
export function sendNoContent(res: Response): void {
  res.status(204).end();
}

/**
 * Construye el envoltorio de error a partir de una excepción.
 *
 * - Error de aplicación: se respeta `code`, `httpStatus` y el mensaje.
 * - Error no controlado: `INTERNAL_ERROR` con mensaje genérico en producción.
 * - En producción, un error **no operativo** nunca expone su mensaje real ni
 *   sus `details` (pueden contener SQL o rutas del sistema de ficheros).
 */
export function buildErrorEnvelope(err: unknown, res: Response): ErrorEnvelope {
  const requestId = getRequestId(res);

  if (isAppError(err)) {
    const safe = env.isProduction && !err.isOperational;
    if (safe) {
      return {
        success: false,
        error: {
          code: err.code,
          message: safeMessageFor(err.code),
        },
        requestId,
      };
    }
    return {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(err.details === undefined ? {} : { details: err.details }),
      },
      requestId,
    };
  }

  return {
    success: false,
    error: {
      code: ERROR_CODE.INTERNAL,
      message: env.isProduction
        ? GENERIC_PRODUCTION_MESSAGE[ERROR_CODE.INTERNAL]
        : 'Error interno del servidor',
    },
    requestId,
  };
}

/** Mensaje seguro para un código no operativo en producción. */
function safeMessageFor(code: ErrorCode): string {
  if (code === ERROR_CODE.SERVICE_UNAVAILABLE) {
    return GENERIC_PRODUCTION_MESSAGE[ERROR_CODE.SERVICE_UNAVAILABLE];
  }
  if (code === ERROR_CODE.DATABASE) {
    return GENERIC_PRODUCTION_MESSAGE[ERROR_CODE.DATABASE];
  }
  return GENERIC_PRODUCTION_MESSAGE[ERROR_CODE.INTERNAL];
}

/**
 * Traduce cualquier excepción a la respuesta de error y la envía.
 *
 * El estado HTTP se toma de `err.httpStatus` si el error es de aplicación y
 * del código si no lo es. Nunca devuelve HTML.
 */
export function sendError(res: Response, err: unknown, httpStatus?: number): void {
  const envelope = buildErrorEnvelope(err, res);
  const status =
    httpStatus ??
    (isAppError(err)
      ? err.httpStatus
      : envelope.error.code === ERROR_CODE.SERVICE_UNAVAILABLE
        ? 503
        : 500);

  if (res.headersSent) {
    // El cliente ya recibió cabeceras (p. ej. SSE o streaming): sólo se corta
    // la conexión. No se intenta escribir un segundo cuerpo.
    res.end();
    return;
  }

  if (envelope.error.code === ERROR_CODE.RATE_LIMIT) {
    const details = envelope.error.details;
    if (isRetryAfterPayload(details) && res.getHeader('Retry-After') === undefined) {
      res.setHeader('Retry-After', String(details.retryAfterSeconds));
    }
  }
  if (envelope.error.code === ERROR_CODE.SERVICE_UNAVAILABLE && res.getHeader('Retry-After') === undefined) {
    res.setHeader('Retry-After', '30');
  }

  res.status(status).json(envelope);
}

/** `true` si `details` lleva los campos de un 429. */
function isRetryAfterPayload(details: unknown): details is { retryAfterSeconds: number } {
  return (
    typeof details === 'object' &&
    details !== null &&
    'retryAfterSeconds' in details &&
    typeof (details as { retryAfterSeconds: unknown }).retryAfterSeconds === 'number'
  );
}
