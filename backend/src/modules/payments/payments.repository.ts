/**
 * Contrato de persistencia de pagos (`payments` y `payment_refunds`).
 *
 * Es una INTERFAZ y no una clase: el service depende de este contrato, nunca de
 * SQLite (DESIGN.md 3.1, regla P3). La implementación vive en
 * `payments.repository.sqlite.ts`, único fichero del módulo con SQL de pagos.
 *
 * ============================================================================
 * LO QUE ESTE MÓDULO NO ES
 * ============================================================================
 * NO hay pasarela de pagos. El negocio cobra en el local, en efectivo o con
 * datáfono, y el cajero registra el cobro a mano. Por eso este contrato no
 * tiene NINGÚN método que hable con un tercero: ni `charge`, ni `capture`, ni
 * `refundRemote`, ni `verifyWebhook`. Todo lo que hay es lectura y escritura
 * local, y el cobro es un `INSERT` + un `UPDATE` del pedido en la misma
 * transacción.
 *
 * `provider` y `provider_reference` existen porque el ESQUEMA los tiene, y sólo
 * admiten `CASH_REGISTRY` (la caja) y `CARD_TERMINAL` (el datáfono):
 * `provider_reference` es el número de aprobación que anota el cajero, NO un PAN
 * (BR-SEC-006).
 */
import type { Db } from '../../shared/database/connection.js';
import type { PaymentMethod, PaymentProvider, PaymentStatus } from '../../shared/domain/index.js';
import type {
  PaymentRefundRow,
  PaymentRow,
  PaymentSort,
  PaymentSortColumn,
  PaymentTotalsRow,
} from './payments.types.js';

// Reexportadas para que el repositorio SQLite y el service hablen el vocabulario
// del contrato sin llegar a `*.types` (criterio de `users`, `customers`, `catalog`).
export type { PaymentRow, PaymentSort, PaymentSortColumn, PaymentTotalsRow };

/** Filtros de `GET /api/v1/payments`. `businessId` sale SIEMPRE del token. */
export interface PaymentListFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: PaymentSort;
  readonly orderId?: number;
  readonly method?: PaymentMethod;
  readonly provider?: PaymentProvider;
  readonly status?: PaymentStatus;
  readonly from?: string;
  readonly to?: string;
  readonly referenceNumber?: string;
  /**
   * Forzado por el service a `actor.id` cuando el actor no tiene
   * `payments:read:any` (BR-SEC-008 y DESIGN.md 9.3).
   */
  readonly customerId?: number;
}

/**
 * Ajustes del negocio que influyen en la pantalla de cobro.
 *
 * No hay `payment_providers_enabled` en el esquema, así que la disponibilidad se
 * deduce de lo que sí existe: `tip_enabled` y `currency_code`.
 */
export interface PaymentBusinessSettingsRow {
  readonly id: number;
  readonly currency_code: string;
  readonly currency_symbol: string;
  readonly tip_enabled: 0 | 1;
  readonly default_tips_bp: string;
}

/** Datos insertados en `payments`. El estado inicial es SIEMPRE `PENDING`. */
export interface NewPaymentRecord {
  readonly businessId: number;
  readonly orderId: number | null;
  readonly paymentNumber: string;
  readonly method: PaymentMethod;
  readonly provider: PaymentProvider | null;
  /** Referencia opaca del cajero. NO es un PAN (BR-SEC-006). */
  readonly providerReference: string | null;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly referenceNumber: string | null;
  readonly receiptNumber: string | null;
  readonly notes: string | null;
  readonly processedBy: number | null;
  readonly customerId: number | null;
  /**
   * JSON sanitizado. NUNCA contiene PAN, CVV ni tokens (BR-SEC-006): sólo la
   * clave de idempotencia y códigos de referencia.
   */
  readonly metadata: Record<string, unknown> | null;
}

/** Campos actualizables de `payments`. */
export interface PaymentPatch {
  readonly status?: PaymentStatus;
  readonly approvedAt?: string | null;
  readonly failedAt?: string | null;
  readonly failureReason?: string | null;
  readonly receiptNumber?: string | null;
  readonly notes?: string | null;
  readonly providerReference?: string | null;
}

/** Datos insertados en `payment_refunds` (tabla inmutable). */
export interface NewRefundRecord {
  readonly paymentId: number;
  readonly orderId: number | null;
  readonly amountMinor: number;
  readonly reason: string;
  readonly refundedBy: number | null;
  readonly providerReference: string | null;
}

/** Cabecera de pedido que el cobro necesita leer y actualizar. */
export interface PaymentOrderRow {
  readonly id: number;
  readonly business_id: number;
  readonly status: string;
  readonly total_minor: number;
  readonly paid_minor: number;
  readonly balance_minor: number;
  readonly customer_id: number | null;
  readonly type: string;
  readonly deleted_at: string | null;
}

/** Fila mínima del cupón de un reembolso, para el informe. */
export interface RefundAggregateRow {
  readonly total_refunded: number;
}
  /** Repositorio de pagos. */
export interface PaymentsRepository {  // --- Ajustes del negocio -------------------------------------------------

  /** `currency_code`, `tip_enabled` y `default_tips_bp` de `businesses`. */
  findBusinessSettings(businessId: number, db?: Db): PaymentBusinessSettingsRow | null;

  // --- Lecturas ------------------------------------------------------------

  /** Pago por id, acotado al negocio. `null` si no existe o es de otro negocio. */
  findById(id: number, businessId: number, db?: Db): PaymentRow | null;
  /**
   * Pago por clave de idempotencia (BR-PAY-001).
   *
   * Se ejecuta DENTRO de la transacción que va a insertar, antes del `INSERT`, y
   * también después de una violación de `ux_payments_idempotency` para recuperar
   * el pago ganador. Es la única forma de que dos reintentos simultáneos no
   * cobren dos veces.
   */
  findByIdempotencyKey(key: string, businessId: number, db?: Db): PaymentRow | null;
  /** Listado paginado con el número de pedido y las personas unidas. */
  list(filter: PaymentListFilter, db?: Db): readonly PaymentRow[];
  /** Total de pagos que satisfacen el filtro, sin paginar. */
  count(filter: Omit<PaymentListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Agregados de importes del filtro COMPLETO, para `meta.totals`. */
  totals(filter: Omit<PaymentListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): PaymentTotalsRow;
  /** Reembolsos de un pago, en orden cronológico. */
  listRefunds(paymentId: number, db?: Db): readonly PaymentRefundRow[];
  /** Reembolsos de un pedido, para el detalle y el recibo. */
  listRefundsByOrder(orderId: number, db?: Db): readonly PaymentRefundRow[];
  /** Pagos de un pedido, del más reciente al más antiguo. */
  listByOrder(orderId: number, db?: Db): readonly PaymentRow[];
  /** Suma de `amount_minor` APROBADOS menos reembolsados (BR-MONEY-006). */
  settledMinor(orderId: number, db?: Db): number;

  // --- Pedido --------------------------------------------------------------

  /** Pedido del cobro, acotado al negocio. `null` si no existe o está borrado. */
  findOrder(orderId: number, businessId: number, db?: Db): PaymentOrderRow | null;
  /**
   * Escribe `paid_minor` y `balance_minor` con valores YA calculados.
   *
   * El total NO se lee aquí: lo pasa el service dentro de la transacción, que es
   * donde se sabe, y así los dos campos quedan SIEMPRE coherentes entre sí
   * (BR-MONEY-006).
   */
  updateOrderPaid(orderId: number, totalMinor: number, paidMinor: number, db?: Db): void;
  /**
   * Cambia el estado del pedido escribiendo su `status` y el `completed_at`
   * juntos, porque `ck_orders_completed_at` exige que no sea NULL cuando el
   * estado es `COMPLETED`.
   */
  updateOrderStatus(orderId: number, status: string, completedAt: string | null, db?: Db): void;
  /** Inserta la fila de historial del pedido (BR-ORDER-013). */
  insertOrderStatusHistory(
    record: {
      readonly orderId: number;
      readonly fromStatus: string;
      readonly toStatus: string;
      readonly changedBy: number | null;
      readonly reason: string | null;
    },
    db?: Db,
  ): number;
  /** Inserta el canje de un cupón aplicado por el cobro. No se usa en v1. */
  insertOrderNote(orderId: number, note: string, db?: Db): void;

  // --- Escrituras ----------------------------------------------------------

  /** Inserta el pago en `PENDING` y devuelve su id. */
  insert(record: NewPaymentRecord, db?: Db): number;
  /** Actualiza sólo los campos presentes. */
  update(id: number, patch: PaymentPatch, db?: Db): void;
  /**
   * Recalcula `refunded_minor` a partir de la SUMA de `payment_refunds`.
   *
   * `refunded_minor` es un campo DENORMALIZADO y NUNCA se escribe desde la API
   * (BR-PAY-012): la API escribe el reembolso y este método lo deriva. El CHECK
   * `ck_payments_refunded` es la garantía final de que no supere el importe.
   */
  recomputeRefundedMinor(paymentId: number, db?: Db): number;
  /** Inserta un reembolso. La tabla es inmutable: nunca se actualiza. */
  insertRefund(record: NewRefundRecord, db?: Db): number;
}
