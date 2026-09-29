/**
 * Controller del módulo `orders` (API.md 7.12).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: no calcula precios, no valida stock, no comprueba
 *    transiciones. Traduce `req` -> tipos del service y la respuesta -> el
 *    envoltorio de API.md 3.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`, que es el
 *    único que decide el status y el `code`.
 *  - No escribe SQL ni toca la base de datos.
 *  - `businessId` sale SIEMPRE del token (`authenticate` ya lo resolvió): nunca
 *    del body ni de la query (API.md 2).
 *  - El `customerId` que llega del body NUNCA se pasa tal cual para un
 *    `CUSTOMER`: el service lo fuerza al del token, y aquí no hay ninguna lógica
 *    que pueda saltarse esa garantía.
 */
import type { Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { OrdersRequestContext, OrdersService } from './orders.service.js';
import {
  ORDERS_SORT_COLUMNS,
  ORDERS_SORT_DEFAULT,
  type AddOrderItemsBody,
  type CancelOrderBody,
  type ChangeOrderStatusBody,
  type ConfirmOrderBody,
  type CreateOrderBody,
  type ListOrdersQuery,
  type UpdateOrderBody,
  type UpdateOrderItemBody,
} from './orders.schemas.js';
import type { OrderSortColumn } from './orders.types.js';

/** `req` con actor y cuerpo/query/params validados. */
type OrderRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_COLUMNS: readonly OrderSortColumn[] = ORDERS_SORT_COLUMNS;

/** Contexto de auditoría de la petición. */
function contextOf(req: OrderRequest): OrdersRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Controller de pedidos. */
export class OrdersController {
  public constructor(private readonly orders: OrdersService) {}

  /** `GET /api/v1/orders` — listado paginado por `created_at desc`. */
  public list = async (req: OrderRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListOrdersQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? ORDERS_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as OrderSortColumn)
      : (ORDERS_SORT_DEFAULT as OrderSortColumn);

    const page = this.orders.list(
      {
        businessId: requireAuth(req).businessId,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        sort: { column, direction: req.validated?.sort?.direction ?? 'DESC' },
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.chairId === undefined ? {} : { chairId: query.chairId }),
        ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
        ...(query.createdBy === undefined ? {} : { createdBy: query.createdBy }),
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.hasUnpaidBalance === undefined
          ? {}
          : { hasUnpaidBalance: query.hasUnpaidBalance }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
      },
      contextOf(req),
    );
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      { countsByStatus: page.countsByStatus, totals: page.totals },
    );
  };

  /** `POST /api/v1/orders` — creación completa (201). */
  public create = async (req: OrderRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateOrderBody;
    const result = this.orders.create(body, contextOf(req));
    sendCreated(res, result.order, {
      warnings: result.warnings,
      appliedRules: result.appliedRules,
      ...(result.paymentNumber === null
        ? {}
        : { paymentNumber: result.paymentNumber, changeDueMinor: result.changeDueMinor }),
    });
  };

  /** `GET /api/v1/orders/:id` — pedido con líneas, pagos y descuentos. */
  public getById = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.orders.getById(params.id, contextOf(req)));
  };

  /** `PATCH /api/v1/orders/:id` — edición de cabecera, cupón o líneas. */
  public update = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as UpdateOrderBody;
    sendSuccess(res, this.orders.update(params.id, body, contextOf(req)));
  };

  /** `POST /api/v1/orders/:id/items` — añade líneas (201). */
  public addItems = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as AddOrderItemsBody;
    sendCreated(res, this.orders.addItems(params.id, body, contextOf(req)));
  };

  /** `PATCH /api/v1/orders/items/:itemId` — edita una línea. */
  public updateItem = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { itemId: number };
    const body = req.validated?.body as UpdateOrderItemBody;
    sendSuccess(res, this.orders.updateItem(params.itemId, body, contextOf(req)));
  };

  /** `DELETE /api/v1/orders/items/:itemId` — quita una línea. */
  public removeItem = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { itemId: number };
    const body = (req.validated?.body ?? {}) as { reason?: string };
    sendSuccess(res, this.orders.removeItem(params.itemId, body, contextOf(req)));
  };

  /** `POST /api/v1/orders/:id/status` — transición de estado. */
  public changeStatus = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as ChangeOrderStatusBody;
    sendSuccess(res, this.orders.changeStatus(params.id, body, contextOf(req)));
  };

  /** `POST /api/v1/orders/:id/confirm` — atajo de la transición a `CONFIRMED`. */
  public confirm = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = (req.validated?.body ?? {}) as ConfirmOrderBody;
    sendSuccess(
      res,
      this.orders.confirm(
        params.id,
        { reservePayment: body.reservePayment === true, ...(body.notes === undefined ? {} : { notes: body.notes }) },
        contextOf(req),
      ),
    );
  };

  /** `POST /api/v1/orders/:id/cancel` — cancelación con reembolso opcional. */
  public cancel = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as CancelOrderBody;
    sendSuccess(res, this.orders.cancel(params.id, body, contextOf(req)));
  };

  /** `POST /api/v1/orders/:id/assign-chair` — mueve el pedido a otra silla. */
  public assignChair = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as { chairId: number };
    const result = this.orders.assignChair(params.id, body.chairId, contextOf(req));
    sendSuccess(res, { ...result.order, previousChairId: result.previousChairId });
  };

  /** `GET /api/v1/orders/:id/receipt` — comprobante imprimible. */
  public getReceipt = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.orders.getReceipt(params.id, contextOf(req)), {
      appliedRules: ['BR-ORDER-018'],
    });
  };

  /** `GET /api/v1/orders/:id/history` — historial de estados. */
  public getHistory = async (req: OrderRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const direction = req.validated?.sort?.direction ?? 'DESC';
    const page = this.orders.getHistory(
      params.id,
      {
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        direction,
      },
      contextOf(req),
    );
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };
}
