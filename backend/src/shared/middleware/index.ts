/** Middlewares compartidos. El orden de montaje vive en `src/app.ts`. */
export {
  RESPONSE_REQUEST_ID_HEADER,
  currentRequestId,
  logRequestCompletion,
  readIncomingRequestId,
  requestContext,
  resolveRequestIdFromResponse,
} from './request-context.js';

export {
  basePaginationQuery,
  buildListQuerySchema,
  formatPath,
  parseOrThrow,
  toValidationDetails,
  validate,
  type RequestWithValidated,
  type ValidateOptions,
  type ValidatedRequest,
  type ValidationDetail,
} from './validate.js';

export {
  authenticate,
  currentSessionId,
  extractBearerToken,
  hasAuth,
  optionalAuthenticate,
  requireAuth,
  type RequestWithAuth,
} from './authenticate.js';

export {
  hasAnyRole,
  hasPermission,
  hasRole,
  requirePermission,
  requireRole,
  requireRoles,
  toRole,
} from './authorize.js';

export { errorHandler } from './error-handler.js';
export { notFound } from './not-found.js';
export {
  authRateLimit,
  globalRateLimit,
  isAuthPath,
  isPasswordResetPath,
  isRateLimitingEnabled,
  passwordResetRateLimit,
  setRateLimitingEnabled,
} from './rate-limit.js';
export { corsMiddleware, jsonBody, securityHeaders } from './security.js';
