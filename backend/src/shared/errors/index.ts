/** Jerarquía de errores de la aplicación. */
export {
  AppError,
  AuthenticationError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  DatabaseError,
  InternalError,
  NotFoundError,
  PaymentError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  isAppError,
  isSafeToExpose,
  type AppErrorOptions,
  type ErrorDetails,
} from './app-error.js';

export {
  AUTH_DETAIL_CODE,
  CONFLICT_DETAIL_CODE,
  DEFAULT_ERROR_MESSAGE,
  ERROR_CODE,
  GENERIC_PRODUCTION_MESSAGE,
  type AuthDetailCode,
  type ConflictDetailCode,
  type ErrorCode,
} from './codes.js';
