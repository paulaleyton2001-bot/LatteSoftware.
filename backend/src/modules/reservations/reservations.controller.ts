/**
 * Controller de reservas (API.md 7.8).
 *
 * REGLAS (DESIGN.md 3.2): traduce `req` ya validado a los tipos del service y da
 * forma a la respuesta. No decide negocio, no toca la base de datos, no captura
 * errores y NO calcula importes: el `code`, la duración y el precio los produce el
 * service, que es el único que conoce la máquina de estados y la fórmula de
 * alquiler.
 *
 * Los avisos que se añaden aquí son de CONTRATO, no de negocio:
 *  - `COUPON_NOT_APPLIED` / `ORDER_NOT_CREATED`: campos que el contrato acepta y
 *    que este módulo no puede cumplir todavía porque no existen los módulos de
 *    descuentos y de pedidos. Se dicen en voz alta en vez de ignorarlos en
 *    silencio, que es lo que API.md 1 prohíbe.
 */
import type { Response } from 'express';

import { ReservationSource } from '../../shared/domain/index.js';
import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type {
  ReservationsRequestContext,
  ReservationsService,
} from './reservations.service.js';
import { RESERVATION_APPLIED_RULES } from './reservations.service.js';
import type { ReservationListFilter } from './reservations.repository.js';
import {
  RESERVATION_SORT_COLUMNS,
  RESERVATION_SORT_DEFAULT,
  type CancelReservationBody,
  type CheckInReservationBody,
  type CompleteReservationBody,
  type CreateReservationBody,
  type ExtendReservationBody,
  type ListReservationsQuery,
  type QuoteReservationQuery,
  type ReservationIdParams,
} from './reservations.schemas.js';

/** `req` con actor y cuerpo/query/params ya validados. */
type ReservationsRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_ALLOWED: readonly string[] = RESERVATION_SORT_COLUMNS;

/** Contexto de auditoría de la petición. */
function contextOf(req: ReservationsRequest): ReservationsRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Controller de reservas. */
export class ReservationsController {
  public constructor(private readonly reservations: ReservationsService) {}

  /** `GET /reservations` — listado paginado. Un CUSTOMER sólo ve los suyos. */
  public list = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListReservationsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? RESERVATION_SORT_DEFAULT;
    const filter = {
      businessId: requireAuth(req).businessId,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: {
        column: SORT_ALLOWED.includes(requested) ? requested : RESERVATION_SORT_DEFAULT,
        direction: req.validated?.sort?.direction ?? 'DESC',
      },
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      ...(query.chairId === undefined ? {} : { chairId: query.chairId }),
      ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
      ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
      ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.code === undefined ? {} : { code: query.code }),
    } satisfies ReservationListFilter;
    const page = this.reservations.list(filter, contextOf(req));
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      { countsByStatus: page.countsByStatus },
    );
  };

  /**
   * `GET /reservations/quote` — cotización SIN ESCRIBIR NADA.
   *
   * Se declara antes que `/:id` en el router: `quote` no es un id.
   */
  public quote = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as QuoteReservationQuery;
    const quote = this.reservations.quote(
      { chairId: query.chairId, startAt: query.startAt, endAt: query.endAt },
      contextOf(req),
    );
    // Si el cliente mandó un cupón, se dice que no se aplicó: el módulo de
    // descuentos todavía no existe y callarlo sería mentir sobre el total.
    const warnings = query.applyCouponCode === undefined ? [] : ['COUPON_NOT_APPLIED'];
    sendSuccess(res, quote, {
      ...(warnings.length === 0 ? {} : { warnings }),
      appliedRules: quote.appliedRules,
    });
  };

  /** `POST /reservations` — alta (201). Aquí es donde vive el 409 de solapamiento. */
  public create = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateReservationBody;
    const actor = requireAuth(req);
    const source: ReservationSource = body.source ?? defaultSourceOf(actor.roles);
    const created = this.reservations.create(
      {
        chairId: body.chairId,
        startAt: body.startAt,
        endAt: body.endAt,
        customerId: body.customerId ?? null,
        notes: body.notes ?? null,
        source,
        sendNotification: body.sendNotification,
      },
      contextOf(req),
    );
    sendCreated(res, created, {
      appliedRules: RESERVATION_APPLIED_RULES,
      ...(body.createOrder ? { warnings: ['ORDER_NOT_CREATED'] } : {}),
    });
  };

  /** `GET /reservations/:id` — detalle. */
  public getById = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ReservationIdParams;
    sendSuccess(res, this.reservations.getById(params.id, contextOf(req)));
  };

  /** `POST /reservations/:id/confirm` — `PENDING -> CONFIRMED`. */
  public confirm = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ReservationIdParams;
    sendSuccess(res, this.reservations.confirm(params.id, contextOf(req)), {
      appliedRules: ['BR-RES-002'],
    });
  };

  /** `POST /reservations/:id/cancel` — cancelación con motivo obligatorio. */
  public cancel = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ReservationIdParams;
    const body = req.validated?.body as CancelReservationBody;
    const cancelled = this.reservations.cancel(params.id, body.reason, contextOf(req));
    sendSuccess(res, cancelled, {
      refund: null,
      ...(body.notifyCustomer ? { warnings: ['NOTIFICATION_QUEUED'] } : {}),
    });
  };

  /** `POST /reservations/:id/check-in` — `CONFIRMED -> ACTIVE`, crea el alquiler. */
  public checkIn = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ReservationIdParams;
    const body = req.validated?.body as CheckInReservationBody;
    const result = this.reservations.checkIn(
      params.id,
      {
        actualStartAt: body?.actualStartAt ?? null,
        notes: body?.notes ?? null,
      },
      contextOf(req),
    );
    sendSuccess(res, result, {
      appliedRules: ['BR-RES-009', 'BR-RENTAL-003'],
      // `order` es `null` hasta que exista el módulo de pedidos: el alquiler ya
      // está facturándose en `chair_rentals`, lo que falta es la factura.
      order: null,
    });
  };

  /** `POST /reservations/:id/extend` — extiende la ventana reservada. */
  public extend = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ReservationIdParams;
    const body = req.validated?.body as ExtendReservationBody;
    sendSuccess(res, this.reservations.extend(params.id, body.newEndAt, contextOf(req)), {
      appliedRules: ['BR-RES-010', 'BR-RENTAL-001'],
    });
  };

  /** `POST /reservations/:id/complete` — `ACTIVE -> COMPLETED`, cierra el alquiler. */
  public complete = async (req: ReservationsRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ReservationIdParams;
    const body = req.validated?.body as CompleteReservationBody;
    const result = this.reservations.complete(
      params.id,
      { endAt: body?.endAt ?? null, reportIssue: body?.reportIssue ?? null },
      contextOf(req),
    );
    sendSuccess(res, result, {
      appliedRules: ['BR-RENTAL-001', 'BR-RENTAL-002', 'BR-RENTAL-003', 'BR-RENTAL-004'],
    });
  };
}

/** Origen por defecto de la reserva según el rol del actor (API.md 7.8). */
function defaultSourceOf(roles: readonly string[]): ReservationSource {
  if (roles.includes('ADMIN') || roles.includes('OWNER') || roles.includes('MANAGER')) {
    return ReservationSource.ADMIN;
  }
  if (roles.includes('CUSTOMER')) {
    return ReservationSource.CUSTOMER;
  }
  return ReservationSource.STAFF;
}
