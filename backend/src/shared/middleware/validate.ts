/**
 * Middleware de validación con zod.
 *
 * REGLAS DEL CONTRATO (API.md 1 y 3.2):
 *  - Los campos desconocidos se RECHAZAN con 400 `VALIDATION_ERROR`
 *    (`.strict()` en todos los esquemas de body, query y params).
 *  - `error.details` es SIEMPRE un `array` de `{ path, message, code }`.
 *  - `businessId` nunca se acepta desde body ni query: sale del access token.
 *    Cualquier intento produce 400 en el campo que lo traiga.
 *
 * En Express 5 `req.query` es un getter de sólo lectura: por eso el resultado
 * validado NO se reescribe sobre `req`, sino que se publica en
 * `req.validated`, que es un campo propio y tipado.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, type ZodType } from 'zod';

import { ValidationError } from '../errors/index.js';
import {
  buildListQuerySchema,
  parsePagination,
  parseSort,
  type SortSpec,
} from '../http/pagination.js';

/** Detalle de validación con `code` estable (API.md 3.2). */
export interface ValidationDetail {
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

/** Datos ya validados, disponibles para el handler. */
export interface ValidatedRequest {
  readonly body: unknown;
  readonly query: unknown;
  readonly params: unknown;
  /** Paginación normalizada si el endpoint la pidió. */
  readonly pagination?: { readonly page: number; readonly pageSize: number; readonly limit: number; readonly offset: number };
  /** Orden validado contra la allowlist, si el endpoint la pidió. */
  readonly sort?: SortSpec;
}

/** `Request` con la salida de `validate`. */
export interface RequestWithValidated extends Request {
  validated?: ValidatedRequest;
}

/** Campos que nunca pueden venir del cliente (API.md 2). */
const FORBIDDEN_BODY_FIELDS = ['businessId', 'business_id'] as const;

/**
 * Traduce los códigos de zod 4 a los códigos estables del contrato.
 * Los ejemplos de API.md 3.2 usan `TOO_SMALL` e `INVALID_FORMAT`.
 */
const ZOD_CODE_MAP: Readonly<Record<string, string>> = {
  invalid_type: 'INVALID_TYPE',
  too_small: 'TOO_SMALL',
  too_big: 'TOO_BIG',
  invalid_format: 'INVALID_FORMAT',
  invalid_value: 'INVALID_VALUE',
  invalid_key: 'INVALID_KEY',
  invalid_union: 'INVALID_UNION',
  invalid_element: 'INVALID_ELEMENT',
  not_finite: 'NOT_FINITE',
  no_constraints: 'INVALID_VALUE',
  custom: 'CUSTOM',
  invalid_string: 'INVALID_FORMAT',
  invalid_date: 'INVALID_FORMAT',
};

/** Convierte `issue.path` (`['items', 0, 'quantity']`) en `items[0].quantity`. */
export function formatPath(path: readonly PropertyKey[]): string {
  let result = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      result += `[${segment}]`;
      continue;
    }
    result += result.length === 0 ? String(segment) : `.${String(segment)}`;
  }
  return result;
}

/** Normaliza un `ZodError` de zod 4 al `details` del contrato. */
export function toValidationDetails(error: z.ZodError): ValidationDetail[] {
  const details: ValidationDetail[] = [];
  for (const issue of error.issues) {
    const code = ZOD_CODE_MAP[issue.code] ?? issue.code.toUpperCase();

    // `unrecognized_keys` no fija `path`: la clave desconocida va en `keys`.
    if (issue.code === 'unrecognized_keys' && 'keys' in issue && Array.isArray(issue.keys)) {
      for (const key of issue.keys) {
        details.push({
          path: String(key),
          message: `El campo "${String(key)}" no está permitido en esta petición`,
          code: 'UNKNOWN_FIELD',
        });
      }
      continue;
    }

    details.push({ path: formatPath(issue.path), message: issue.message, code });
  }
  return details;
}

/** Ejecuta un esquema y lanza `ValidationError` con el `details` del contrato. */
export function parseOrThrow<T>(schema: ZodType<T>, value: unknown, source: 'body' | 'query' | 'params'): T {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }
  const details = toValidationDetails(result.error);
  throw new ValidationError(
    source === 'body'
      ? 'El cuerpo de la petición contiene campos inválidos'
      : source === 'query'
        ? 'La query contiene parámetros inválidos'
        : 'Los parámetros de la ruta son inválidos',
    { details: details.length > 0 ? details : [{ path: source, message: 'Petición inválida', code: 'INVALID_VALUE' }] },
  );
}

/** Opciones del middleware de validación. */
export interface ValidateOptions {
  readonly body?: ZodType<unknown>;
  readonly query?: ZodType<unknown>;
  readonly params?: ZodType<unknown>;
  /**
   * Allowlist de columnas por las que se permite ordenar. Si se define
   * `query`, el parser de orden exige además estos parámetros.
   */
  readonly sortable?: {
    readonly allowedColumns: readonly string[];
    readonly defaultColumn: string;
    readonly defaultOrder: 'asc' | 'desc';
  };
  /** Suelta la validación de los parámetros de paginación al esquema de query. */
  readonly skipPagination?: boolean;
}

/**
 * Valida `body`, `query` y `params` y publica el resultado en `req.validated`.
 *
 * Los esquemas deben ser `.strict()`: los campos desconocidos se rechazan, no
 * se ignoran en silencio.
 */
export function validate(options: ValidateOptions): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const validated: {
        body: unknown;
        query: unknown;
        params: unknown;
        pagination?: { page: number; pageSize: number; limit: number; offset: number };
        sort?: SortSpec;
      } = {
        body: req.body,
        query: req.query,
        params: req.params,
      };

      if (options.body !== undefined) {
        validated.body = parseOrThrow(options.body, req.body, 'body');
        // `businessId` es la identidad de negocio y sale del token (API.md 2).
        assertNoBusinessIdInBody(validated.body);
      }
      if (options.params !== undefined) {
        validated.params = parseOrThrow(options.params, req.params, 'params');
      }
      if (options.query !== undefined) {
        validated.query = parseOrThrow(options.query, req.query, 'query');
      }

      // IMPORTANTE: la paginación y el orden se calculan sobre el query CRUDO
      // de Express, no sobre `validated.query`. El esquema ya transformó
      // `page` y `pageSize` de string a número, y volver a validarlos exigiría
      // que aceptaran números.
      const queryRecord: Record<string, unknown> = toQueryRecord(req.query);
      if (options.sortable !== undefined && options.skipPagination !== true) {
        validated.pagination = parsePagination(queryRecord);
        validated.sort = parseSort(
          queryRecord,
          options.sortable.allowedColumns,
          options.sortable.defaultColumn,
          options.sortable.defaultOrder,
        );
      } else if (options.sortable !== undefined) {
        validated.sort = parseSort(
          queryRecord,
          options.sortable.allowedColumns,
          options.sortable.defaultColumn,
          options.sortable.defaultOrder,
        );
      }

      (req as RequestWithValidated).validated = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Convierte el query validado a un registro plano sin `any`. */
function toQueryRecord(query: unknown): Record<string, unknown> {
  if (typeof query === 'object' && query !== null && !Array.isArray(query)) {
    return { ...(query as Record<string, unknown>) };
  }
  return {};
}

/** Rechaza `businessId` en el cuerpo: la identidad sale del token. */
function assertNoBusinessIdInBody(body: unknown): void {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return;
  }
  const record: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const field of FORBIDDEN_BODY_FIELDS) {
    if (Object.hasOwn(record, field)) {
      throw new ValidationError('El cuerpo de la petición contiene campos inválidos', {
        details: [
          {
            path: field,
            message: 'La identidad del negocio sale del token de autenticación, no del cuerpo',
            code: 'UNKNOWN_FIELD',
          },
        ],
      });
    }
  }
}

/**
 * Esquema base de query con paginación, orden y campos extra del endpoint.
 * `.strict()`: los campos desconocidos se rechazan.
 *
 * @example
 * validate({
 *   query: buildListQuerySchema({ status: z.enum(['DRAFT', 'PENDING']) }),
 *   sortable: { allowedColumns: ['created_at', 'total_minor'], defaultColumn: 'created_at', defaultOrder: 'desc' },
 * });
 */
export const basePaginationQuery = buildListQuerySchema;

/** Reexportado por comodidad: los endpoints suelen combinar esto con zod. */
export { z };

/** Reexportado: construir el esquema de query de un listado. */
export { buildListQuerySchema };
