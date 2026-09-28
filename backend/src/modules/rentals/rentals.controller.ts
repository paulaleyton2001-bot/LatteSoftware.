/**
 * Controller de alquileres (API.md 7.9).
 *
 * REGLAS (DESIGN.md 3.2): traduce `req` ya validado, no decide negocio, no toca la
 * base de datos y no captura errores. El importe, los minutos facturados y el
 * overage los calcula `RentalsService` con `rental-pricing.ts`; aquí sólo se copia
 * de la respuesta del service al envoltorio de API.md 3.
 */
import type { Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { RentalsRequestContext, RentalsService } from './rentals.service.js';
import type { RentalListFilter } from './rentals.repository.js';
import {
  ACTIVE_RENTAL_SORT_COLUMNS,
  ACTIVE_RENTAL_SORT_DEFAULT,
  RENTAL_SORT_COLUMNS,
  RENTAL_SORT_DEFAULT,
  type CompleteRentalBody,
  type CreateRentalBody,
  type ExtendRentalBody,
  type ListActiveRentalsQuery,
  type ListRentalsQuery,
  type RentalByChairParams,
  type RentalIdParams,
} from './rentals.schemas.js';

/** `req` con actor y cuerpo/query/params ya validados. */
type RentalsRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_ALLOWED: readonly string[] = RENTAL_SORT_COLUMNS;
const ACTIVE_SORT_ALLOWED: readonly string[] = ACTIVE_RENTAL_SORT_COLUMNS;

/** Contexto de auditoría de la petición. */
function contextOf(req: RentalsRequest): RentalsRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Controller de alquileres. */
export class RentalsController {
  public constructor(private readonly rentals: RentalsService) {}

  /** `GET /rentals` — listado paginado. Un CUSTOMER sólo ve los suyos. */
  public list = async (req: RentalsRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListRentalsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? RENTAL_SORT_DEFAULT;
    const filter = {
      businessId: requireAuth(req).businessId,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: {
        column: SORT_ALLOWED.includes(requested) ? requested : RENTAL_SORT_DEFAULT,
        direction: req.validated?.sort?.direction ?? 'DESC',
      },
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.chairId === undefined ? {} : { chairId: query.chairId }),
      ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
      ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.reservationId === undefined ? {} : { reservationId: query.reservationId }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    } satisfies RentalListFilter;
    const page = this.rentals.list(filter, contextOf(req));
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      { countsByStatus: page.countsByStatus },
    );
  };

  /**
   * `GET /rentals/active` — sólo `ACTIVE`/`EXTENDED`.
   *
   * Se declara ANTES que `/:id`: `active` no es un id.
   */
  public listActive = async (req: RentalsRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListActiveRentalsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? ACTIVE_RENTAL_SORT_DEFAULT;
    const filter = {
      businessId: requireAuth(req).businessId,
      ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
      ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
    } satisfies Partial<RentalListFilter>;
    const column = ACTIVE_SORT_ALLOWED.includes(requested) ? requested : ACTIVE_RENTAL_SORT_DEFAULT;
    // El alcance por cliente lo resuelve el service ANTES de paginar, así que el
    // `total` que se devuelve es el de lo que el actor puede ver.
    const items = this.rentals.listActive(
      {
        ...filter,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        sort: { column, direction: req.validated?.sort?.direction ?? 'ASC' },
      },
      contextOf(req),
    );
    sendPaginated(res, items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: items.length,
    });
  };

  /**
   * `GET /rentals/chair/:chairId/active` — alquiler vivo de una silla.
   *
   * `data: null` con `200` si no hay alquiler: no es un 404, porque la silla existe
   * y lo que falta es el alquiler (API.md 7.9).
   */
  public getActiveByChair = async (req: RentalsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as RentalByChairParams;
    sendSuccess(res, this.rentals.getActiveByChair(params.chairId, contextOf(req)));
  };

  /** `POST /rentals` — alquiler walk-in (201). */
  public create = async (req: RentalsRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateRentalBody;
    const result = this.rentals.openWalkIn(
      {
        chairId: body.chairId,
        plannedMinutes: body.plannedMinutes,
        customerId: body.customerId ?? null,
        reservationId: body.reservationId ?? null,
        notes: body.notes ?? null,
      },
      contextOf(req),
    );
    sendCreated(res, result, {
      appliedRules: ['BR-RENTAL-001', 'BR-RENTAL-003', 'BR-RENTAL-007'],
      // `order` es `null` hasta que exista el módulo de pedidos. El total ya está
      // escrito y congelado en `chair_rentals`; lo que falta es la factura.
      order: null,
    });
  };

  /** `GET /rentals/:id` — detalle con extensiones, cobro y reserva. */
  public getById = async (req: RentalsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as RentalIdParams;
    sendSuccess(res, this.rentals.getById(params.id, contextOf(req)));
  };

  /** `POST /rentals/:id/extend` — extensión con recálculo y registro. */
  public extend = async (req: RentalsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as RentalIdParams;
    const body = req.validated?.body as ExtendRentalBody;
    const result = this.rentals.extend(
      params.id,
      { additionalMinutes: body.additionalMinutes, reason: body.reason ?? null },
      contextOf(req),
    );
    sendSuccess(res, result, { appliedRules: ['BR-RENTAL-011'] });
  };

  /** `POST /rentals/:id/complete` — cierre y cobro con overage. */
  public complete = async (req: RentalsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as RentalIdParams;
    const body = (req.validated?.body ?? {}) as CompleteRentalBody;
    const result = this.rentals.complete(
      params.id,
      {
        endAt: body?.endAt ?? null,
        waiveOvertime: body?.waiveOvertime === true,
        waiveReason: body?.waiveReason ?? null,
      },
      contextOf(req),
    );
    sendSuccess(res, result, {
      appliedRules: ['BR-RENTAL-001', 'BR-RENTAL-002', 'BR-RENTAL-003', 'BR-RENTAL-004', 'BR-RENTAL-008'],
    });
  };
}
