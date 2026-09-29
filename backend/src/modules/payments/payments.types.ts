/**
 * Tipos del módulo `payments` (tablas `payments` y `payment_refunds`).
 *
 * ============================================================================
 * DECISIÓN DEL CLIENTE: NO HAY PASARELA DE PAGOS
 * ============================================================================
 * El negocio cobra TODO en el local: efectivo en la caja o tarjeta en el
 * datáfono, y el cajero registra el pago a mano. En consecuencia:
 *
 *  - Los únicos métodos admitidos son `CASH` y `CARD`. Ni transferencia, ni
 *    pago en línea, ni pasarela externa. NO existe `PaymentProvider` como
 *    abstracción: el enum del esquema sólo se usa con dos valores fijos,
 *    `CASH_REGISTRY` (la caja) y `CARD_TERMINAL` (el datáfono).
 *  - El registro del pago es LOCAL, Síncrono y SIN llamadas de red. No hay
 *    adapter, ni cliente HTTP, ni webhook, ni cola de reintentos.
 *  - `provider_reference` NO es un PAN. Es el número de aprobación o los últimos
 *    cuatro dígitos que ANOTA el cajero, y se documenta como referencia opaca
 *    (BR-SEC-006 prohíbe guardar el número completo de tarjeta, el CVV o
 *    cualquier token de proveedor en cualquier campo).
 *
 * Este fichero de tipos es, además, la prueba de que la decisión está tomada: no
 * hay ninguna constante de proveedor externa en él.
 */
import type { PaymentMethod, PaymentProvider, PaymentStatus } from '../../shared/domain/index.js';

/** Columnas ordenables de `GET /api/v1/payments`. */
export type PaymentSortColumn = 'created_at' | 'amount_minor' | 'approved_at';

/** Orden ya validado por el middleware `validate`. */
export interface PaymentSort {
  readonly column: PaymentSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** Fila cruda de `payments`. */
export interface PaymentRow {
  readonly id: number;
  readonly business_id: number;
  readonly order_id: number | null;
  readonly payment_number: string;
  readonly method: PaymentMethod;
  readonly provider: PaymentProvider | null;
  /**
   * Referencia opaca que anota el cajero. NO es un PAN: en `CARD` es el número
   * de aprobación del datáfono o los últimos cuatro dígitos, y en `CASH` suele
   * ser el número del recibo de la caja.
   */
  readonly provider_reference: string | null;
  readonly status: PaymentStatus;
  readonly amount_minor: number;
  readonly refunded_minor: number;
  readonly currency_code: string;
  readonly reference_number: string | null;
  readonly receipt_number: string | null;
  readonly notes: string | null;
  readonly processed_by: number | null;
  readonly customer_id: number | null;
  readonly approved_at: string | null;
  readonly failed_at: string | null;
  readonly failure_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /**
   * JSON sanitizado escrito por este módulo.
   *
   * NUNCA contiene PAN, CVV ni token de proveedor (BR-SEC-006/BR-PAY-007): sólo
   * la clave de idempotencia, el efectivo recibido, el cambio, la propina y el
   * canal. Se lee para el reintento idempotente, que tiene que volver a mostrar
   * al cajero el cambio que entregó la primera vez.
   */
  readonly metadata: string | null;
  /** JOIN `orders.order_number`: qué pedido se cobró. */
  readonly order_number: string | null;
  /** JOIN `users.full_name`: quién cobró. */
  readonly processed_by_name: string | null;
  /** JOIN `users.full_name`: a quién se cobró. */
  readonly customer_name: string | null;
}

/** Fila de `payment_refunds` (tabla inmutable). */
export interface PaymentRefundRow {
  readonly id: number;
  readonly payment_id: number;
  readonly order_id: number | null;
  readonly amount_minor: number;
  readonly reason: string;
  readonly refunded_by: number | null;
  readonly provider_reference: string | null;
  readonly created_at: string;
  /** JOIN `users.full_name`: quién ordenó el reembolso. */
  readonly refunded_by_name: string | null;
}

/** `Payment` tal y como lo ve el cliente (API.md 6.3). */
export interface PaymentView {
  readonly id: number;
  readonly paymentNumber: string;
  readonly orderId: number | null;
  readonly method: PaymentMethod;
  readonly provider: PaymentProvider | null;
  readonly providerReference: string | null;
  readonly status: PaymentStatus;
  readonly amountMinor: number;
  readonly refundedMinor: number;
  readonly currencyCode: string;
  readonly referenceNumber: string | null;
  readonly receiptNumber: string | null;
  readonly notes: string | null;
  readonly approvedAt: string | null;
  readonly failedAt: string | null;
  readonly failureReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `GET /api/v1/payments` — resumen con el número de pedido. */
export interface PaymentSummaryView extends PaymentView {
  readonly orderNumber: string | null;
  readonly processedByUser: { readonly id: number; readonly fullName: string } | null;
  readonly customer: { readonly id: number; readonly fullName: string } | null;
}

/** `GET /api/v1/payments/:id` — pago con pedido, reembolsos y personas. */
export interface PaymentDetailView extends PaymentSummaryView {
  readonly order: { readonly id: number; readonly orderNumber: string; readonly totalMinor: number; readonly balanceMinor: number } | null;
  readonly refunds: readonly {
    readonly id: number;
    readonly amountMinor: number;
    readonly reason: string;
    readonly refundedBy: number | null;
    readonly createdAt: string;
  }[];
}

/** Página de pagos con sus agregados de `meta.totals`. */
export interface PaymentPage {
  readonly items: readonly PaymentSummaryView[];
  readonly total: number;
  readonly totals: {
    readonly approvedMinor: number;
    readonly refundedMinor: number;
    readonly netMinor: number;
    /** Desglose por método. Sólo `CASH` y `CARD` pueden tener importe. */
    readonly byMethod: Readonly<Record<PaymentMethod, number>>;
  };
}

/** Agregados de un filtro de pagos, para `meta.totals`. */
export interface PaymentTotalsRow {
  readonly approved_minor: number;
  readonly refunded_minor: number;
  readonly approved_cash: number;
  readonly approved_card: number;
}

/**
 * Método de pago que describe `GET /api/v1/payments/methods`.
 *
 * `enabled` se calcula leyendo `businesses` (`tip_enabled`, `currency_code`) y la
 * disponibilidad real del cobro en el local. No hay adaptadores que consultar:
 * los dos métodos existen siempre porque no dependen de un tercero.
 */
export interface PaymentMethodView {
  readonly method: PaymentMethod;
  readonly enabled: boolean;
  /** Etiqueta legible para la pantalla de cobro. */
  readonly label: string;
  /**
   * Referencia que el cajero DEBE anotar. En `CARD` es el número de aprobación
   * del datáfono: sin ella la conciliación bancaria del día no se puede hacer.
   */
  readonly requiresReference: boolean;
  /** `true` si admite pagos parciales (abono y luego el resto). */
  readonly allowsPartial: boolean;
  /**
   * `true` si admite entregar de más. Sólo `CASH`: la diferencia es CAMBIO y se
   * devuelve al cliente (BR-MONEY-007/008). Un pago con datáfono no puede
   * "devolver cambio" porque el dinero ya entró en la cuenta.
   */
  readonly allowsOverpayment: boolean;
  readonly minAmountMinor: number;
  readonly maxAmountMinor: number | null;
  /** Explicación de por qué está deshabilitado, o `null` si lo está habilitado. */
  readonly disabledReason: string | null;
}

/** `POST /api/v1/payments` — cobro. */
export interface RegisterPaymentInput {
  readonly orderId: number;
  readonly method: PaymentMethod;
  readonly amountMinor: number;
  readonly provider: PaymentProvider | null;
  /** Referencia que anota el cajero. NO es un PAN (BR-SEC-006). */
  readonly providerReference: string | null;
  readonly referenceNumber: string | null;
  readonly receiptNumber: string | null;
  readonly notes: string | null;
  /**
   * `CASH`: efectivo entregado. Puede ser MAYOR que el importe: la diferencia es
   * cambio. `CARD`: el importe autorizad en el datáfono, que es exacto.
   */
  readonly receivedMinor: number | null;
  /** `Idempotency-Key` del header. OBLIGATORIA (BR-PAY-001). */
  readonly idempotencyKey: string;
}

/** Respuesta de `POST /api/v1/payments`. */
export interface RegisterPaymentResult {
  readonly payment: PaymentView;
  /** `true` si el pedido quedó completamente pagado y pasó a `COMPLETED`. */
  readonly orderCompleted: boolean;
  /** Efectivo a devolver al cliente. Siempre 0 con `CARD` (BR-PAY-009). */
  readonly changeDueMinor: number;
  /**
   * Propina: NO entra en `orders.total_minor` (BR-MONEY-009). Se devuelve
   * aparte para que la caja la sugiera y el total siga siendo contable.
   */
  readonly tipMinor: number;
  /** `true` si la clave de idempotencia ya existía y se devolvió el mismo pago. */
  readonly idempotent: boolean;
}

/** `POST /api/v1/payments/:id/refund` — reembolso total o parcial. */
export interface RefundResult {
  readonly payment: PaymentView;
  readonly refund: { readonly id: number; readonly amountMinor: number; readonly reason: string; readonly createdAt: string };
  /** Saldo del pedido tras el reembolso. */
  readonly remainingBalanceMinor: number;
}
