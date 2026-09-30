/**
 * Controller del módulo `customers` (API.md 7.3).
 *
 * Traduce `req` ya validado a los tipos del service y da forma a la respuesta.
 * No decide alcance (lo decide `CustomersService`) ni escribe SQL.
 */
import type { Response } from 'express';

import { sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { CustomersRequestContext, CustomersService } from './customers.service.js';
import type { CustomerListFilter, CustomerSortColumn } from './customers.repository.js';
import { CUSTOMER_SORT_DEFAULT } from './customers.schemas.js';
import type { CustomerIdParams, ListCustomersQuery, UpdateCustomerBody } from './customers.schemas.js';

/** `req` con actor y cuerpo/query/params validados. */
type CustomersRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_COLUMNS: readonly CustomerSortColumn[] = ['created_at', 'full_name', 'last_order_at'];

/** Contexto de auditoría de la petición. */
function contextOf(req: CustomersRequest): CustomersRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Controller del directorio de clientes. */
export class CustomersController {
  public constructor(private readonly customers: CustomersService) {}

  /** `GET /customers` — listado paginado (sólo operadores). */
  public list = async (req: CustomersRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListCustomersQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? CUSTOMER_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as CustomerSortColumn)
      : (CUSTOMER_SORT_DEFAULT as CustomerSortColumn);

    const filter: CustomerListFilter = {
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.hasOrders === undefined ? {} : { hasOrders: query.hasOrders }),
      ...(query.createdFrom === undefined ? {} : { createdFrom: query.createdFrom }),
      ...(query.createdTo === undefined ? {} : { createdTo: query.createdTo }),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: { column, direction: req.validated?.sort?.direction ?? 'DESC' },
    };

    const page = this.customers.list(filter, contextOf(req));
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /**
   * `GET /customers/me` — perfil del actor con `hasCustomerProfile`.
   *
   * El id se toma del token (`contextOf(req).actor.id`): aquí no se lee ningún
   * parámetro, query ni campo del body, así que no hay forma de pedir la ficha de
   * otro usuario por esta vía.
   *
   * Se declara ANTES de `/:id`: Express enruta por orden de declaración y `me`
   * no es un id numérico.
   */
  public me = async (req: CustomersRequest, res: Response): Promise<void> => {
    sendSuccess(res, this.customers.me(contextOf(req)));
  };

  /** `GET /customers/:id` — ficha de un cliente con estadísticas. */
  public getById = async (req: CustomersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as CustomerIdParams;
    sendSuccess(res, this.customers.getById(params.id, contextOf(req)));
  };

  /** `PATCH /customers/:id` — edición por el propio cliente o por un operador. */
  public update = async (req: CustomersRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as CustomerIdParams;
    const body = req.validated?.body as UpdateCustomerBody;
    const updated = this.customers.update(
      params.id,
      {
        ...(body.fullName === undefined ? {} : { fullName: body.fullName }),
        ...(body.phone === undefined ? {} : { phone: body.phone }),
        ...(body.photoUrl === undefined ? {} : { photoUrl: body.photoUrl }),
        ...(body.email === undefined ? {} : { email: body.email }),
      },
      contextOf(req),
    );
    sendSuccess(res, updated);
  };
}
