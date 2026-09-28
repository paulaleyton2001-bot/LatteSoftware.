/**
 * Jerarquía de errores tipados de la aplicación.
 *
 * Contrato (API.md 3.2 y 4):
 *  - `code` es estable: el frontend ramifica por él.
 *  - El código HTTP y el `code` siempre coinciden.
 *  - `isOperational` distingue un error previsto (mensaje apto para el usuario
 *    final) de un fallo inesperado (nunca se filtra al cliente en producción).
 *  - El stack trace NUNCA se serializa dentro de la respuesta.
 */
import {
  DEFAULT_ERROR_MESSAGE,
  ERROR_CODE,
  GENERIC_PRODUCTION_MESSAGE,
  type ErrorCode,
} from './codes.js';

/** Detalle estructurado admitido en `error.details` (API.md 3.2). */
export type ErrorDetails = unknown;

/** Opciones comunes al construir un error de aplicación. */
export interface AppErrorOptions {
  /** Datos estructurados para la UI: objeto, array de rutas o array de ítems. */
  readonly details?: ErrorDetails;
  /** Error original, sólo para el log del servidor. Nunca se envía al cliente. */
  readonly cause?: unknown;
  /** Sobrescribe el mensaje por defecto. Debe estar en español y ser accionable. */
  readonly message?: string;
}

/**
 * Error base de la aplicación. Todo error lanzado deliberadamente por un
 * service, middleware o repositorio debe heredar de esta clase.
 */
export class AppError extends Error {
  /** Código estable de API (`error.code`). */
  public readonly code: ErrorCode;

  /** Estado HTTP asociado. Siempre coherente con `code`. */
  public readonly httpStatus: number;

  /** Datos estructurados para el cliente. Puede ser objeto o array. */
  public readonly details: ErrorDetails | undefined;

  /**
   * `true` = error previsto por el dominio, su mensaje puede mostrarse al
   * usuario final. `false` = fallo inesperado; en producción se sustituye por
   * un mensaje genérico.
   */
  public readonly isOperational: boolean;

  public constructor(
    code: ErrorCode,
    httpStatus: number,
    message?: string,
    options: AppErrorOptions = {},
  ) {
    super(message ?? DEFAULT_ERROR_MESSAGE[code], { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = options.details;
    this.isOperational = true;
    // Necesario para que `instanceof` sea fiable con herencia de clases.
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, new.target);
  }
}

/** 400 VALIDATION_ERROR. Fallo de esquema zod o campo desconocido. */
export class ValidationError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.VALIDATION, 400, message, options);
  }
}

/** 401 AUTHENTICATION_ERROR. Token ausente, inválido, expirado o revocado. */
export class AuthenticationError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.AUTHENTICATION, 401, message, options);
  }
}

/** 403 AUTHORIZATION_ERROR. Autenticado pero sin permiso. Nunca 404 por eso. */
export class AuthorizationError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.AUTHORIZATION, 403, message, options);
  }
}

/** 404 NOT_FOUND_ERROR. Inexistente, soft-deleted o fuera del negocio del token. */
export class NotFoundError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.NOT_FOUND, 404, message, options);
  }
}

/** 409 CONFLICT_ERROR. Unicidad, transición repetida, silla ocupada, SQLITE_BUSY. */
export class ConflictError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.CONFLICT, 409, message, options);
  }
}

/**
 * 422 BUSINESS_RULE_ERROR. La petición es válida pero viola una regla de
 * negocio. `details.code` debe ser el identificador estable de la regla
 * (p. ej. `PRODUCT_UNAVAILABLE`) y `details.ruleId` el de DESIGN.md.
 */
export class BusinessRuleError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.BUSINESS_RULE, 422, message, options);
  }
}

/** 402 PAYMENT_ERROR. Rechazo del proveedor, sin datos sensibles. */
export class PaymentError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.PAYMENT, 402, message, options);
  }
}

/** 429 RATE_LIMIT_ERROR. Se acompaña de la cabecera `Retry-After`. */
export class RateLimitError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.RATE_LIMIT, 429, message, options);
  }
}

/** 500 DATABASE_ERROR. Fallo de integridad o de la capa de persistencia. */
export class DatabaseError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.DATABASE, 500, message, options);
  }
}

/** 500 INTERNAL_ERROR. Excepción no controlada. No operativo. */
export class InternalError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.INTERNAL, 500, message, options);
    // Un error interno nunca es un fallo previsto del dominio: en producción
    // su mensaje se sustituye por el genérico.
    Object.defineProperty(this, 'isOperational', { value: false, enumerable: true });
  }

  /** Mensaje seguro para producción. */
  public get safeMessage(): string {
    return GENERIC_PRODUCTION_MESSAGE[ERROR_CODE.INTERNAL];
  }
}

/** 503 SERVICE_UNAVAILABLE. Dependencia caída. Nunca 500 por base de datos. */
export class ServiceUnavailableError extends AppError {
  public constructor(message?: string, options: AppErrorOptions = {}) {
    super(ERROR_CODE.SERVICE_UNAVAILABLE, 503, message, options);
    Object.defineProperty(this, 'isOperational', { value: false, enumerable: true });
  }

  public get safeMessage(): string {
    return GENERIC_PRODUCTION_MESSAGE[ERROR_CODE.SERVICE_UNAVAILABLE];
  }
}

/**
 * Guarda de tipos: `error instanceof AppError`.
 *
 * `isOperational` es `false` sólo en `InternalError` y
 * `ServiceUnavailableError`; ambos exponen `safeMessage` con el texto que se
 * envía al cliente en producción.
 */
export function isAppError(error: unknown): error is AppError {
  if (error instanceof AppError) return true;
  // Defensa en profundidad: errores serializados o de otro realm de VM.
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'httpStatus' in error &&
    'isOperational' in error &&
    error instanceof Error
  );
}

/** `true` si el error puede mostrarse al usuario final sin sanitizar. */
export function isSafeToExpose(error: unknown): boolean {
  return isAppError(error) && error.isOperational;
}
