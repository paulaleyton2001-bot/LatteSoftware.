/** Capa HTTP compartida: envoltorio de respuesta, paginación y async handler. */
export {
  buildErrorEnvelope,
  getRequestId,
  sendCreated,
  sendError,
  sendNoContent,
  sendPaginated,
  sendSuccess,
  type ErrorEnvelope,
  type PaginationMeta,
  type SuccessEnvelope,
  type SuccessMeta,
  type ValidationDetail,
} from './response.js';

export {
  PAGINATION_QUERY_SHAPE,
  buildLimitOffset,
  buildListQuerySchema,
  buildOrderByClause,
  paginationMeta,
  paginationQuerySchema,
  parseDateRange,
  parsePagination,
  parseSort,
  validationError,
  type DateRange,
  type Pagination,
  type QueryRecord,
  type ListQueryExtras,
  type SortSpec,
} from './pagination.js';

export {
  asyncHandler,
  type AsyncRequestHandler,
  type SyncRequestHandler,
} from './async-handler.js';
