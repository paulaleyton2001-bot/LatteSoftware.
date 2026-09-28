/**
 * Manejador de errores: TRADUCE CUALQUIER EXCEPCIÓN A LA RESPUESTA.
 *
 * Debe ser el ÚLTIMO middleware del stack (API.md 8.1, punto 6):
 *  - Un `AppError` conserva `code`, `httpStatus`, mensaje y `details`.
 *  - Un error no controlado se convierte en 500 `INTERNAL_ERROR`.
 *  - En producción (`APP_ENV=production`) el mensaje de un error **no
 *    operativo** es genérico y NUNCA incluye stack trace, SQL ni rutas del
 *    sistema de ficheros. El stack se registra sólo en el log del servidor.
 *  - La respuesta es siempre JSON con el envoltorio de API.md 3.2. Nunca HTML.
 *
 * Además, dos traducciones evitan 500 falsos, que son el peor resultado posible
 * para un error causado por el cliente:
 *  - Una violación de `CHECK` o de FK en SQLite se expresa como 422 con el código
 *    de dominio equivalente.
 *  - Un cuerpo malformado (JSON inválido, demasiado grande o con una codificación
 *    no admitida) se expresa como `400 VALIDATION_ERROR`, que es lo que dice
 *    API.md 4, y no como un 500 que culpa al servidor de lo que hizo el cliente.
 */
import type { ErrorRequestHandler } from 'express';

import { env } from '../../config/index.js';
import { BusinessRuleError, ERROR_CODE, ValidationError, isAppError } from '../errors/index.js';
import { buildErrorEnvelope } from '../http/response.js';
import { logger } from '../logger/index.js';
import { resolveRequestIdFromResponse } from './request-context.js';

/** Mensaje de un error desconocido, sin assume nada de su forma. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Código de error de better-sqlite3, si lo hay. */
function sqliteCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Traduce violaciones de restricciones de SQLite a errores de dominio.
 *
 * `SQLITE_CONSTRAINT_FOREIGNKEY` y los demás `SQLITE_CONSTRAINT_*` son fallos
 * de lógica del service, no un ataque del cliente: se expresan como 422 con el
 * código estable que la API ya define. El detalle técnico (nombre del CHECK,
 * tabla, columnas) se queda en `cause` y sólo se registra en el log.
 */
function translateConstraint(error: unknown): unknown {
  const code = sqliteCode(error);
  if (code === undefined || !code.startsWith('SQLITE_CONSTRAINT')) {
    return error;
  }
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return new BusinessRuleError('La operación referencia un registro que no existe', {
      details: { code: 'FK_VIOLATION' },
      cause: error,
    });
  }
  return new BusinessRuleError('La operación viola una restricción de integridad', {
    details: { code: 'DB_CONSTRAINT_VIOLATION' },
    cause: error,
  });
}

/** Traduce errores del parser de cuerpos a 400 VALIDATION_ERROR. */
function translateBodyParser(error: unknown): unknown {
  const type = (error as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !type.startsWith('entity.')) {
    return error;
  }
  if (type === 'entity.parse.failed') {
    // JSON sintácticamente inválido. `express.json()` lanza un `SyntaxError` con
    // `status: 400`, pero sin esto llegaría como 500 INTERNAL_ERROR: un cliente
    // que manda un cuerpo malformado no es un fallo del servidor, y API.md 4 lo
    // clasifica como `400 VALIDATION_ERROR`. El mensaje del driver NUNCA se
    // reenvía: incluiría un fragmento del cuerpo recibido.
    return new ValidationError('El cuerpo de la petición no es JSON válido', {
      details: [{ path: 'body', message: 'No se pudo interpretar el cuerpo como JSON', code: 'INVALID_JSON' }],
      cause: error,
    });
  }
  // `entity.too.large` (supera JSON_BODY_LIMIT) y los errores de charset o de
  // codificación también son culpa de la petición, no del servidor.
  return new ValidationError('El cuerpo de la petición no se puede procesar', {
    details: [
      {
        path: 'body',
        message:
          type === 'entity.too.large'
            ? 'El cuerpo de la petición supera el tamaño máximo permitido'
            : 'El cuerpo de la petición usa una codificación no admitida',
        code: type === 'entity.too.large' ? 'BODY_TOO_LARGE' : 'UNSUPPORTED_ENCODING',
      },
    ],
    cause: error,
  });
}

/** Middleware terminal de errores. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    // Si ya se enviaron cabeceras el cuerpo no se puede reescribir: se delega
    // en Express para que destruya la conexión.
    next(err);
    return;
  }

  const translated = translateBodyParser(translateConstraint(err));
  const requestId = resolveRequestIdFromResponse(req);
  const isApp = isAppError(translated);
  const status = isApp ? translated.httpStatus : 500;
  const code = isApp ? translated.code : ERROR_CODE.INTERNAL;

  const context = {
    requestId,
    method: req.method,
    path: req.path,
    status,
    code,
    // El stack se registra sólo fuera de producción; dentro, `message` ya es
    // un texto genérico y el stack nunca sale del servidor.
    ...(env.isProduction ? {} : { stack: err instanceof Error ? err.stack : undefined }),
  };

  if (isApp && translated.isOperational) {
    logger.warn({ ...context, message: translated.message }, 'error de aplicación');
  } else {
    logger.error({ ...context, message: messageOf(err) }, 'error no controlado');
  }

  const envelope = buildErrorEnvelope(translated, res);
  res.status(status).json(envelope);
};
