/**
 * Catálogo de códigos de error (API.md sección 4).
 *
 * `ErrorCode` es el `error.code` que viaja al cliente: es **estable** entre
 * versiones y el frontend ramifica por él. `ErrorMessageCode` es el valor que
 * va dentro de `error.details.code`: distingue causas del mismo código HTTP.
 */
export const ERROR_CODE = {
  VALIDATION: 'VALIDATION_ERROR',
  AUTHENTICATION: 'AUTHENTICATION_ERROR',
  AUTHORIZATION: 'AUTHORIZATION_ERROR',
  NOT_FOUND: 'NOT_FOUND_ERROR',
  CONFLICT: 'CONFLICT_ERROR',
  BUSINESS_RULE: 'BUSINESS_RULE_ERROR',
  PAYMENT: 'PAYMENT_ERROR',
  RATE_LIMIT: 'RATE_LIMIT_ERROR',
  DATABASE: 'DATABASE_ERROR',
  INTERNAL: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];

/** Causas de `AUTHENTICATION_ERROR` (API.md 2). */
export const AUTH_DETAIL_CODE = {
  MISSING_TOKEN: 'MISSING_TOKEN',
  INVALID_TOKEN: 'INVALID_TOKEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_REVOKED: 'TOKEN_REVOKED',
  TOKEN_REUSE: 'TOKEN_REUSE',
  WRONG_TOKEN_TYPE: 'WRONG_TOKEN_TYPE',
} as const;

export type AuthDetailCode = (typeof AUTH_DETAIL_CODE)[keyof typeof AUTH_DETAIL_CODE];

/** Causas de `CONFLICT_ERROR` (API.md 4). */
export const CONFLICT_DETAIL_CODE = {
  DUPLICATE: 'DUPLICATE',
  INVALID_ORDER_TRANSITION: 'INVALID_ORDER_TRANSITION',
  INVALID_RESERVATION_TRANSITION: 'INVALID_RESERVATION_TRANSITION',
  CHAIR_OCCUPIED: 'CHAIR_OCCUPIED',
  CHAIR_ALREADY_RESERVED: 'CHAIR_ALREADY_RESERVED',
  ORDER_IMMUTABLE: 'ORDER_IMMUTABLE',
  RESOURCE_BUSY: 'RESOURCE_BUSY',
} as const;

export type ConflictDetailCode = (typeof CONFLICT_DETAIL_CODE)[keyof typeof CONFLICT_DETAIL_CODE];

/** Mensajes por defecto, en español y sin información técnica. */
export const DEFAULT_ERROR_MESSAGE = {
  [ERROR_CODE.VALIDATION]: 'La solicitud contiene campos inválidos',
  [ERROR_CODE.AUTHENTICATION]: 'No se pudo autenticar la solicitud',
  [ERROR_CODE.AUTHORIZATION]: 'No tiene permisos para realizar esta acción',
  [ERROR_CODE.NOT_FOUND]: 'El recurso solicitado no existe',
  [ERROR_CODE.CONFLICT]: 'La operación entra en conflicto con el estado actual del recurso',
  [ERROR_CODE.BUSINESS_RULE]: 'La operación viola una regla de negocio',
  [ERROR_CODE.PAYMENT]: 'El pago no pudo ser procesado',
  [ERROR_CODE.RATE_LIMIT]: 'Demasiadas solicitudes, inténtelo de nuevo más tarde',
  [ERROR_CODE.DATABASE]: 'No se pudo completar la operación sobre la base de datos',
  [ERROR_CODE.INTERNAL]: 'Error interno del servidor',
  [ERROR_CODE.SERVICE_UNAVAILABLE]: 'Servicio no disponible',
} as const;

/** Mensaje genérico para 500/503 en producción. Sin detalles técnicos. */
export const GENERIC_PRODUCTION_MESSAGE = {
  [ERROR_CODE.INTERNAL]: 'Ocurrió un error inesperado. Inténtelo de nuevo más tarde.',
  [ERROR_CODE.DATABASE]: 'Ocurrió un error inesperado. Inténtelo de nuevo más tarde.',
  [ERROR_CODE.SERVICE_UNAVAILABLE]: 'Servicio no disponible temporalmente',
} as const;
