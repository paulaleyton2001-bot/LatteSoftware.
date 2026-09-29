/**
 * Controller del módulo `payments` (API.md 7.13).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: no calcula el cambio, no valida el método, no
 *    comprueba el saldo. Traduce `req` -> tipos del service y la respuesta -> el
 *    envoltorio de API.md 3.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`.
 *  - No escribe SQL ni toca la base de datos.
 *  - `businessId` sale SIEMPRE del token: nunca del body ni de la query (API.md 2).
 *  - La cabecera `Idempotency-Key` se lee AQUÍ, en el borde, porque es parte de la
 *    FORMA de la petición (API.md 1 la lista junto a `Authorization`): si falta o
 *    no es una clave válida, es un `400 VALIDATION_ERROR` y no llega al service.
 *    La comprobación de que la clave NO esté repetida es del service, que es
 *    donde vive `ux_payments_idempotency`.
 */
import type { Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { ValidationError } from '../../shared/errors/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { PaymentsRequestContext, PaymentsService } from './payments.service.js';
import {
  IDEMPOTENCY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  PAYMENTS_SORT_COLUMNS,
  PAYMENTS_SORT_DEFAULT,
  type ListPaymentsQuery,
  type RefundPaymentBody,
  type RegisterPaymentBody,
} from './payments.schemas.js';
import type { PaymentSortColumn } from './payments.types.js';

/** `req` con actor y cuerpo/query/params validados. */
type PaymentRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
  /** Cabeceras en minúsculas, tal y como las normaliza Node. */
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_COLUMNS: readonly PaymentSortColumn[] = PAYMENTS_SORT_COLUMNS;

/** Contexto de auditoría de la petición. */
function contextOf(req: PaymentRequest): PaymentsRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/**
 * Lee y valida la cabecera `Idempotency-Key` (BR-PAY-001).
 *
 * Sin ella el cobro NO se registra: un reintento por red sin clave cobraría dos
 * veces, y un pago duplicado es una pérdida invisible mientras que un pedido
 * duplicado es un ingreso visible y se nota en caja.
 */
function requireIdempotencyKey(req: PaymentRequest): string {
  const raw = req.headers[IDEMPOTENCY_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError('El cobro requiere la cabecera Idempotency-Key', {
      details: [
        {
          path: 'Idempotency-Key',
          message:
            'Indique un Idempotency-Key (UUID v4) para que un reintento no cobre dos veces',
          code: 'IDEMPOTENCY_KEY_REQUIRED',
        },
      ],
    });
  }
  const key = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new ValidationError('El cobro requiere la cabecera Idempotency-Key', {
      details: [
        {
          path: 'Idempotency-Key',
          message: 'La clave debe ser un UUID v4',
          code: 'INVALID_FORMAT',
        },
      ],
    });
  }
  return key;
}

/** Controller de pagos. */
export class PaymentsController {
  public constructor(private readonly payments: PaymentsService) {}

  /** `GET /api/v1/payments` — listado paginado por `created_at desc`. */
  public list = async (req: PaymentRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListPaymentsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? PAYMENTS_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as PaymentSortColumn)
      : (PAYMENTS_SORT_DEFAULT as PaymentSortColumn);

    const page = this.payments.list(
      {
        businessId: requireAuth(req).businessId,
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        sort: { column, direction: req.validated?.sort?.direction ?? 'DESC' },
        ...(query.orderId === undefined ? {} : { orderId: query.orderId }),
        ...(query.method === undefined ? {} : { method: query.method }),
        ...(query.provider === undefined ? {} : { provider: query.provider }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.referenceNumber === undefined ? {} : { referenceNumber: query.referenceNumber }),
      },
      contextOf(req),
    );
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      { totals: page.totals },
    );
  };

  /**
   * `GET /api/v1/payments/methods` — métodos de cobro habilitados.
   *
   * Ruta LITERAL declarada antes que `/:id` (API.md 2: `methods` no es un id).
   */
  public listMethods = async (req: PaymentRequest, res: Response): Promise<void> => {
    sendSuccess(res, this.payments.listMethods(contextOf(req)), {
      appliedRules: ['BR-PAY-003'],
    });
  };

  /** `GET /api/v1/payments/:id` — pago con pedido, reembolsos y personas. */
  public getById = async (req: PaymentRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.payments.getById(params.id, contextOf(req)));
  };

  /**
   * `POST /api/v1/payments` — registra el cobro (201).
   *
   * Devuelve `200` con `meta.idempotent = true` cuando la clave ya existía: el
   * mismo pago, sin cobrar de nuevo (BR-PAY-001).
   */
  public register = async (req: PaymentRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as RegisterPaymentBody;
    const idempotencyKey = requireIdempotencyKey(req);
    const result = this.payments.register(
      {
        orderId: body.orderId,
        method: body.method,
        amountMinor: body.amountMinor,
        provider: body.provider ?? null,
        providerReference: body.providerReference ?? null,
        referenceNumber: body.referenceNumber ?? null,
        receiptNumber: body.receiptNumber ?? null,
        notes: body.notes ?? null,
        receivedMinor: body.receivedMinor ?? null,
        tipMinor: body.tipMinor ?? 0,
        idempotencyKey,
      },
      contextOf(req),
    );
    const meta = {
      idempotent: result.idempotent,
      changeDueMinor: result.changeDueMinor,
      orderCompleted: result.orderCompleted,
      appliedRules: ['BR-PAY-001', 'BR-MONEY-006', 'BR-MONEY-007'],
    };
    if (result.idempotent) {
      sendSuccess(res, result.payment, meta);
      return;
    }
    sendCreated(res, result.payment, meta);
  };

  /** `POST /api/v1/payments/:id/refund` — reembolso total o parcial (201). */
  public refund = async (req: PaymentRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as RefundPaymentBody;
    sendCreated(
      res,
      this.payments.refund(
        params.id,
        {
          amountMinor: body.amountMinor,
          reason: body.reason,
          providerReference: body.providerReference ?? null,
          notifyCustomer: body.notifyCustomer,
        },
        contextOf(req),
      ),
      { appliedRules: ['BR-PAY-006', 'BR-PAY-012'] },
    );
  };
}
