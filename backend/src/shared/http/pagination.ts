/**
 * Paginación, orden y filtros de listado (API.md sección 5.1).
 *
 * `page` (1-based, >= 1, tope 10 000) y `pageSize` (1..100) construyen
 * `LIMIT`/`OFFSET`. El orden (`sort` + `order`) NUNCA se interpola sin
 * validar contra la allowlist del endpoint: un valor fuera de la lista produce
 * `400 VALIDATION_ERROR` con `code: 'INVALID_SORT_FIELD'`.
 */
import { z } from 'zod';

import { PAGINATION } from '../../config/index.js';
import { ValidationError } from '../errors/index.js';

/** Detalle de error de validación con `code` estable (API.md 3.2). */
export interface ValidationDetail {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

/** Construye un `ValidationError` con `details` en el formato del contrato. */
export function validationError(details: readonly ValidationDetail[]): ValidationError {
  return new ValidationError(undefined, { details: [...details] });
}

/**
 * Entero de query. Acepta el string habitual de la URL y también un número ya
 * parseado, para que `parsePagination` sea idempotente y se pueda llamar tanto
 * con el query crudo de Express como con el resultado del esquema zod.
 */
const positiveIntFromQuery = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isInteger(value) && value >= 1, {
    message: 'Debe ser un entero mayor o igual a 1',
  });

/**
 * Campos de paginación y orden, como forma reutilizable de zod.
 *
 * Se exporta aparte porque los esquemas de query de listado deben ser
 * `.strict()` (los campos desconocidos se rechazan) y, a la vez, admitir
 * `page`, `pageSize`, `sort` y `order`. `buildListQuerySchema` los combina sin
 * que cada endpoint tenga que acordarse.
 */
export const PAGINATION_QUERY_SHAPE = {
  page: positiveIntFromQuery
    .refine((value) => value <= PAGINATION.MAX_PAGE, `Debe ser menor o igual a ${PAGINATION.MAX_PAGE}`)
    .optional(),
  pageSize: positiveIntFromQuery
    .refine((value) => value <= PAGINATION.MAX_PAGE_SIZE, {
      message: `Debe estar entre ${PAGINATION.MIN_PAGE_SIZE} y ${PAGINATION.MAX_PAGE_SIZE}`,
    })
    .optional(),
  sort: z.string().min(1).max(64).optional(),
  order: z.enum(['asc', 'desc']).optional(),
} as const;

/** Forma de zod admitida por {@link buildListQuerySchema}. */
export type ListQueryExtras = z.ZodRawShape;

/**
 * Construye el esquema de query de un listado: paginación + orden + los campos
 * propios del endpoint, todo `.strict()`.
 *
 * El parámetro de extras es GENÉRICO a propósito. Con el tipo plano
 * `ListQueryExtras` (= `z.ZodRawShape`, un índice de firmas) el tipo inferido del
 * esquema se reduce a la forma de paginación y se pierden los campos propios
 * del endpoint: `z.infer<typeof esquema>` no tendría `role` ni `q`, y el
 * controller tendría que castear a ciegas. Con `T extends z.ZodRawShape` la
 * inferencia conserva cada clave.
 *
 * @example
 * const schema = buildListQuerySchema({ status: z.enum(['DRAFT', 'PENDING']) });
 * validate({ query: schema, sortable: { allowedColumns: ['created_at'], ... } });
 */
export function buildListQuerySchema<T extends z.ZodRawShape = Record<string, never>>(
  extras: T = {} as T,
) {
  return z.object({ ...PAGINATION_QUERY_SHAPE, ...extras }).strict();
}

/** Esquema base de query de listado, reutilizable y extensible por endpoint. */
export const paginationQuerySchema = buildListQuerySchema();

/** Parámetros de paginación ya normalizados. */
export interface Pagination {
  readonly page: number;
  readonly pageSize: number;
  readonly limit: number;
  readonly offset: number;
}

/** Orden ya validado contra la allowlist del endpoint. */
export interface SortSpec {
  readonly column: string;
  readonly direction: 'ASC' | 'DESC';
  /** Segundo criterio de desempate: siempre `id`, para orden estable. */
  readonly tieBreaker: string;
}

/** Texto de query ya parseado, sin valores repetidos. */
export type QueryRecord = Record<string, unknown>;

/**
 * Claves de paginación y orden. `parsePagination` sólo mira estas cuatro.
 *
 * Motivo: `parsePagination` recibe la query CRUDA de Express, que incluye los
 * filtros propios del endpoint (`role`, `q`, `status`...). Si validara el objeto
 * entero contra el esquema base, que es `.strict()`, cualquier listado con
 * filtros recibiría un `400 INVALID_QUERY_PARAMETER` con "Unrecognized key". La
 * validación de los campos propios la hace el esquema del endpoint (que es
 * `.strict()` de verdad, API.md 1); aquí sólo se extrae la paginación.
 */
const PAGINATION_KEYS = ['page', 'pageSize', 'sort', 'order'] as const;

/** Esquema de los cuatro campos de paginación, sin campos extra. */
const PAGINATION_ONLY_SCHEMA = z.object(PAGINATION_QUERY_SHAPE).strict();

/** Normaliza `page`/`pageSize` y calcula `LIMIT`/`OFFSET`. */
export function parsePagination(query: QueryRecord): Pagination {
  const picked: Record<string, unknown> = {};
  for (const key of PAGINATION_KEYS) {
    const value = query[key];
    if (value !== undefined) {
      picked[key] = value;
    }
  }

  const parsed = PAGINATION_ONLY_SCHEMA.safeParse(picked);
  if (!parsed.success) {
    throw validationError(
      parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join('.') : 'query',
        message: issue.message,
        code: 'INVALID_QUERY_PARAMETER',
      })),
    );
  }

  const page = parsed.data.page ?? PAGINATION.DEFAULT_PAGE;
  const pageSize = parsed.data.pageSize ?? PAGINATION.DEFAULT_PAGE_SIZE;
  return {
    page,
    pageSize,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
}

/**
 * Valida `sort` contra la allowlist del endpoint y normaliza `order`.
 *
 * La allowlist se compara sin distinguir mayúsculas porque el contrato de
 * API usa `camelCase` en la query y `snake_case` en la base de datos.
 *
 * @param allowedColumns Columnas permitidas, p. ej. `['created_at','total_minor']`.
 * @param defaultColumn  Columna usada si el cliente no envía `sort`.
 * @param defaultOrder   Orden por defecto del recurso.
 */
export function parseSort(
  query: QueryRecord,
  allowedColumns: readonly string[],
  defaultColumn: string,
  defaultOrder: 'asc' | 'desc',
  tieBreaker = 'id',
): SortSpec {
  const rawSort = query['sort'];
  const rawOrder = query['order'];

  let order: 'ASC' | 'DESC';
  if (rawOrder === undefined || rawOrder === null || rawOrder === '') {
    order = defaultOrder === 'asc' ? 'ASC' : 'DESC';
  } else {
    const normalized = String(rawOrder).toLowerCase();
    if (normalized !== 'asc' && normalized !== 'desc') {
      invalidOrder();
    }
    order = normalized === 'asc' ? 'ASC' : 'DESC';
  }

  if (rawSort === undefined || rawSort === null || rawSort === '') {
    return { column: defaultColumn, direction: order, tieBreaker };
  }

  const requested = String(rawSort);
  const match = allowedColumns.find(
    (column) => column.toLowerCase() === requested.toLowerCase(),
  );
  if (match === undefined) {
    throw validationError([
      {
        path: 'sort',
        message: `No se permite ordenar por "${requested}"`,
        code: 'INVALID_SORT_FIELD',
      },
    ]);
  }

  return { column: match, direction: order, tieBreaker };
}

function invalidOrder(): never {
  throw validationError([
    { path: 'order', message: 'Debe ser "asc" o "desc"', code: 'INVALID_ORDER_VALUE' },
  ]);
}

/** Cláusulas `ORDER BY` ya interpoladas desde una allowlist validada. */
export function buildOrderByClause(sort: SortSpec): string {
  return `ORDER BY ${sort.column} ${sort.direction}, ${sort.tieBreaker} ${sort.direction}`;
}

/**
 * `LIMIT ? OFFSET ?` con parámetros, para que nunca se interpole texto.
 * Devuelve el objeto de parámetros listo para `better-sqlite3`.
 */
export function buildLimitOffset(
  pagination: Pagination,
): { readonly limit: number; readonly offset: number; readonly sql: string } {
  return {
    limit: pagination.limit,
    offset: pagination.offset,
    sql: 'LIMIT ? OFFSET ?',
  };
}

/**
 * `meta` de listado a partir del total contado (API.md 3.1):
 * `{ page, pageSize, total, requestId }`.
 */
export function paginationMeta(pagination: Pagination, total: number) {
  return { page: pagination.page, pageSize: pagination.pageSize, total };
}

/** Filtro de fecha por rango, resuelto en UTC (API.md 5.2). */
export interface DateRange {
  readonly from: string;
  readonly to: string;
}

/** Lee `from`/`to` de la query y valida el rango. */
export function parseDateRange(
  query: QueryRecord,
  defaults: { readonly from: string; readonly to: string },
): DateRange {
  const rawFrom = query['from'];
  const rawTo = query['to'];
  const from = typeof rawFrom === 'string' && rawFrom.length > 0 ? rawFrom : defaults.from;
  const to = typeof rawTo === 'string' && rawTo.length > 0 ? rawTo : defaults.to;

  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw validationError([
      {
        path: Number.isNaN(fromMs) ? 'from' : 'to',
        message: 'Debe ser un instante ISO-8601 UTC',
        code: 'INVALID_FORMAT',
      },
    ]);
  }
  if (fromMs > toMs) {
    throw validationError([
      { path: 'from', message: 'El rango de fechas es inválido', code: 'INVALID_DATE_RANGE' },
    ]);
  }
  return { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() };
}
