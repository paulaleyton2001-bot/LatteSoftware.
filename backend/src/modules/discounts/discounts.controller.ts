/**
 * Controller del módulo `discounts` (API.md 7.14).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: no valida ventanas, no calcula importes, no
 *    comprueba límites. Traduce `req` -> tipos del service y la respuesta -> el
 *    envoltorio de API.md 3.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`, que es el
 *    único que decide el status y el `code`.
 *  - No escribe SQL ni toca la base de datos.
 *  - `businessId` sale SIEMPRE del token (`authenticate` ya lo resolvió): nunca
 *    del body ni de la query (API.md 2).
 */
import type { Response } from 'express';

import { sendCreated, sendNoContent, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type {
  CreateDiscountBody,
  ListDiscountsQuery,
  ListMyDiscountsQuery,
  UpdateDiscountBody,
  ValidateDiscountBody,
} from './discounts.schemas.js';
import { DISCOUNTS_SORT_COLUMNS, DISCOUNTS_SORT_DEFAULT } from './discounts.schemas.js';
import {
  toValidationInput,
  type DiscountsRequestContext,
  type DiscountsService,
} from './discounts.service.js';
import type {
  DiscountSortColumn,
  DiscountValidationInput,
} from './discounts.types.js';

/** `req` con actor y cuerpo/query/params validados. */
type DiscountRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_COLUMNS: readonly DiscountSortColumn[] = DISCOUNTS_SORT_COLUMNS;

/** Contexto de auditoría de la petición. */
function contextOf(req: DiscountRequest): DiscountsRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Controller de descuentos. */
export class DiscountsController {
  public constructor(private readonly discounts: DiscountsService) {}

  /** `GET /api/v1/discounts` — listado paginado por `created_at desc`. */
  public list = async (req: DiscountRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListDiscountsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? DISCOUNTS_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as DiscountSortColumn)
      : (DISCOUNTS_SORT_DEFAULT as DiscountSortColumn);
    const context = contextOf(req);

    const page = this.discounts.list(
      {
        businessId: context.actor.businessId,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        sort: { column, direction: req.validated?.sort?.direction ?? 'DESC' },
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.appliesTo === undefined ? {} : { appliesTo: query.appliesTo }),
        ...(query.isExpired === undefined ? {} : { isExpired: query.isExpired }),
        // `isActive` explícito manda sobre `includeInactive`, igual que en el
        // catálogo: un filtro concreto nunca se ignora en favor del interruptor.
        includeInactive: query.isActive === undefined ? (query.includeInactive === true) : false,
      },
      context,
    );
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /** `GET /api/v1/discounts/mine` — cupones del cliente autenticado. */
  public listMine = async (req: DiscountRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListMyDiscountsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? DISCOUNTS_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as DiscountSortColumn)
      : (DISCOUNTS_SORT_DEFAULT as DiscountSortColumn);
    const page = this.discounts.listMine(
      {
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        includeExpired: query.includeExpired === true,
        includeUsed: query.includeUsed !== false,
        sort: { column, direction: req.validated?.sort?.direction ?? 'ASC' },
      },
      contextOf(req),
    );
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /**
   * `POST /api/v1/discounts/validate` — previsualización, siempre 200.
   *
   * Con `orderId` el servidor lee el subtotal REAL y las líneas REALES del pedido
   * (BR-DISC-001); con `subtotalMinor` usa lo que envía el cliente, que es una
   * estimación. Nunca escribe nada.
   */
  public validate = async (req: DiscountRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as ValidateDiscountBody;
    const context = contextOf(req);
    const customerId = body.customerId ?? context.actor.id;

    if (body.orderId !== undefined) {
      const snapshot = this.discounts.orderSnapshot(body.orderId, context.actor.businessId);
      if (snapshot === null) {
        throw new NotFoundError('El pedido no existe', {
          details: { id: body.orderId, type: 'order', field: 'orderId' },
        });
      }
      // El subtotal y las líneas son del SERVIDOR: el `subtotalMinor` del body,
      // si viene junto, se ignora cuando hay `orderId` (BR-DISC-001).
      const input: DiscountValidationInput = {
        code: body.code,
        subtotalMinor: snapshot.subtotalMinor,
        customerId: customerId ?? snapshot.customerId,
        lines: snapshot.lines,
      };
      sendSuccess(res, this.discounts.validate(input, context), {
        appliedRules: ['BR-DISC-001', 'BR-DISC-002'],
      });
      return;
    }

    const input = toValidationInput(body, body.subtotalMinor ?? 0, customerId);
    sendSuccess(res, this.discounts.validate(input, context), {
      appliedRules: input.lines.length > 0 ? ['BR-DISC-001', 'BR-DISC-002'] : ['BR-DISC-001'],
    });
  };

  /** `GET /api/v1/discounts/:id` — detalle con categoría, producto y stats. */
  public getById = async (req: DiscountRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.discounts.getById(params.id, contextOf(req)));
  };

  /** `POST /api/v1/discounts` — alta (201). */
  public create = async (req: DiscountRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateDiscountBody;
    sendCreated(res, this.discounts.create(body, contextOf(req)));
  };

  /** `PATCH /api/v1/discounts/:id` — edición parcial. */
  public update = async (req: DiscountRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as UpdateDiscountBody;
    sendSuccess(res, this.discounts.update(params.id, body, contextOf(req)));
  };

  /**
   * `DELETE /api/v1/discounts/:id` — baja lógica.
   *
   * Responde 204 sin cuerpo, que es lo que fija API.md 7 para los borrados de
   * descuentos (a diferencia de categorías o productos, que también devuelven el
   * resumen del borrado).
   */
  public remove = async (req: DiscountRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    this.discounts.remove(params.id, contextOf(req));
    sendNoContent(res);
  };
}
