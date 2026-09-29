/**
 * Tipos del módulo `orders` (tablas `orders`, `order_items`, `order_item_addons`
 * y `order_status_history`).
 *
 * Son tipos PUROS: no importan `express`, `zod` ni el driver de base de datos
 * (DESIGN.md 3.3, P2). Los esquemas viven en `orders.schemas.ts` y los
 * controllers traducen `req` -> estos tipos.
 *
 * REGLA DE ORO: todo campo `*Minor` es un entero en centavos (BR-MONEY-001) y
 * `quantity` es un `number` que puede ser fraccional (pesajes).
 */
import type {
  OrderChannel,
  OrderItemStatus,
  OrderStatus,
  OrderType,
} from '../../shared/domain/index.js';

/** Columnas ordenables de `GET /api/v1/orders`. */
export type OrderSortColumn =
  | 'created_at'
  | 'placed_at'
  | 'total_minor'
  | 'order_number'
  | 'completed_at';

/** Orden ya validado por el middleware `validate`. */
export interface OrderSort {
  readonly column: OrderSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** Fila cruda de `orders`. */
export interface OrderRow {
  readonly id: number;
  readonly business_id: number;
  readonly location_id: number | null;
  readonly order_number: string;
  readonly type: OrderType;
  readonly status: OrderStatus;
  readonly customer_id: number | null;
  readonly chair_id: number | null;
  readonly reservation_id: number | null;
  readonly rental_id: number | null;
  readonly table_label: string | null;
  readonly channel: OrderChannel;
  readonly created_by: number | null;
  readonly subtotal_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly service_fee_minor: number;
  readonly total_minor: number;
  readonly paid_minor: number;
  readonly balance_minor: number;
  readonly coupon_code: string | null;
  readonly notes: string | null;
  readonly customer_notes: string | null;
  readonly placed_at: string | null;
  readonly confirmed_at: string | null;
  readonly preparing_at: string | null;
  readonly ready_at: string | null;
  readonly completed_at: string | null;
  readonly cancelled_at: string | null;
  readonly cancel_reason: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  /** JOIN `chairs.code`: identificador visible de la silla. */
  readonly chair_code: string | null;
  /** JOIN `users.full_name`: nombre del cliente del pedido. */
  readonly customer_name: string | null;
}

/** Fila de `orders` del LISTADO, con el número de líneas resuelto. */
export interface OrderSummaryRow extends OrderRow {
  /** Número de líneas del pedido (`order_items` no canceladas). */
  readonly item_count: number;
}

/** Fila de `order_items`, tal y como sale de SQLite. */
export interface OrderItemRow {
  readonly id: number;
  readonly order_id: number;
  readonly product_id: number | null;
  readonly variant_id: number | null;
  /** Snapshot INMUTABLE del nombre al momento de la venta (BR-PRICE-004). */
  readonly name_snapshot: string;
  readonly sku_snapshot: string | null;
  /** Snapshot del precio unitario ya con variante, antes de multiplicar. */
  readonly unit_price_minor: number;
  readonly quantity: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly line_total_minor: number;
  readonly notes: string | null;
  readonly status: OrderItemStatus;
  readonly preparation_minutes: number;
  readonly created_at: string;
  readonly updated_at: string;
  /** JOIN `product_variants.name`, sólo para presentar. */
  readonly variant_name: string | null;
  /** JOIN `products.category_id`, para el ámbito de los descuentos. */
  readonly category_id: number | null;
}

/** Fila de `order_item_addons` (tabla histórica, sin `updated_at`). */
export interface OrderItemAddonRow {
  readonly id: number;
  readonly order_item_id: number;
  readonly product_addon_id: number | null;
  /** Snapshot del nombre del complemento (BR-PRICE-004). */
  readonly name_snapshot: string;
  /** Snapshot del precio unitario del complemento. */
  readonly price_minor: number;
  readonly quantity: number;
  readonly created_at: string;
}

/** Fila de `order_status_history` (append-only). */
export interface OrderStatusHistoryRow {
  readonly id: number;
  readonly order_id: number;
  readonly from_status: OrderStatus | null;
  readonly to_status: OrderStatus;
  readonly changed_by: number | null;
  readonly reason: string | null;
  readonly created_at: string;
  /** JOIN `users.full_name`: quién hizo el cambio. */
  readonly changed_by_name: string | null;
}

// --------------------------------------------------------------------------
// Vistas de API
// --------------------------------------------------------------------------

/** Complemento de una línea de pedido (API.md 6.3). */
export interface OrderItemAddonView {
  readonly id: number;
  readonly productAddonId: number | null;
  readonly nameSnapshot: string;
  readonly priceMinor: number;
  readonly quantity: number;
}

/** Línea de pedido con sus complementos. */
export interface OrderItemView {
  readonly id: number;
  readonly productId: number | null;
  readonly variantId: number | null;
  readonly variantName: string | null;
  readonly nameSnapshot: string;
  readonly skuSnapshot: string | null;
  readonly unitPriceMinor: number;
  readonly quantity: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly lineTotalMinor: number;
  readonly notes: string | null;
  readonly status: OrderItemStatus;
  readonly preparationMinutes: number;
  readonly addons: readonly OrderItemAddonView[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Resumen de la línea de un pago aplicada al pedido. */
export interface OrderPaymentView {
  readonly id: number;
  readonly paymentNumber: string;
  readonly method: string;
  readonly provider: string | null;
  readonly status: string;
  readonly amountMinor: number;
  readonly refundedMinor: number;
  readonly approvedAt: string | null;
}

/** Descuento aplicado a un pedido, para explicarlo en la respuesta. */
export interface AppliedDiscountView {
  readonly discountId: number;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly value: number;
  readonly amountMinor: number;
}

/** Reembolso de un pago, para el detalle del pedido y el recibo. */
export interface OrderRefundView {
  readonly id: number;
  readonly amountMinor: number;
  readonly reason: string;
  readonly createdAt: string;
}

/** `Order` completo (API.md 6.3). */
export interface OrderView {
  readonly id: number;
  readonly orderNumber: string;
  readonly type: OrderType;
  readonly status: OrderStatus;
  readonly channel: OrderChannel;
  readonly locationId: number | null;
  readonly customerId: number | null;
  readonly customerName: string | null;
  readonly chairId: number | null;
  readonly chairCode: string | null;
  readonly reservationId: number | null;
  readonly rentalId: number | null;
  readonly tableLabel: string | null;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly balanceMinor: number;
  readonly couponCode: string | null;
  readonly notes: string | null;
  readonly customerNotes: string | null;
  readonly items: readonly OrderItemView[];
  readonly placedAt: string | null;
  readonly confirmedAt: string | null;
  readonly preparingAt: string | null;
  readonly readyAt: string | null;
  readonly completedAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Totales del pedido, agrupados como en el recibo y en el detalle. */
export interface OrderTotalsView {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly balanceMinor: number;
  /** `true` si el precio del catálogo ya incluía impuesto (BR-TAX-003). */
  readonly taxInclusive: boolean;
  /**
   * Impuesto CONTENIDO en el precio cuando `taxInclusive = 1`. Sólo
   * informativo: no altera ningún total almacenado.
   */
  readonly taxIncludedMinor: number;
  /** Efectivo a devolver en el cobro, si lo hubo (BR-MONEY-009). */
  readonly changeDueMinor: number;
  /** Propina: NO forma parte de `totalMinor` (BR-MONEY-009). */
  readonly tipMinor: number;
}

/** `GET /api/v1/orders` — resumen sin líneas (API.md 7.12). */
export interface OrderSummaryView {
  readonly id: number;
  readonly orderNumber: string;
  readonly type: OrderType;
  readonly status: OrderStatus;
  readonly channel: OrderChannel;
  readonly customerId: number | null;
  readonly customerName: string | null;
  readonly chairId: number | null;
  readonly chairCode: string | null;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly balanceMinor: number;
  readonly itemCount: number;
  readonly placedAt: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

/** `GET /api/v1/orders/:id` — pedido con todo lo relacionado. */
export interface OrderDetailView extends OrderView {
  readonly payments: readonly OrderPaymentView[];
  readonly refunds: readonly { readonly id: number; readonly amountMinor: number; readonly reason: string; readonly createdAt: string }[];
  readonly chair: { readonly id: number; readonly code: string; readonly name: string | null; readonly zoneName: string } | null;
  readonly reservation: { readonly id: number; readonly code: string; readonly status: string; readonly startAt: string; readonly endAt: string } | null;
  readonly rental: { readonly id: number; readonly code: string; readonly status: string; readonly totalMinor: number } | null;
  readonly customer: { readonly id: number; readonly fullName: string; readonly phone: string | null; readonly email: string } | null;
  readonly totals: OrderTotalsView;
  readonly appliedDiscounts: readonly AppliedDiscountView[];
}

/** `GET /api/v1/orders/:id/history` — una entrada del historial. */
export interface OrderHistoryView {
  readonly id: number;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly changedBy: number | null;
  readonly changedByName: string | null;
  readonly reason: string | null;
  readonly createdAt: string;
}

/** `GET /api/v1/orders/:id/receipt` — comprobante imprimible. */
export interface OrderReceiptView {
  readonly orderNumber: string;
  readonly type: OrderType;
  readonly status: OrderStatus;
  readonly business: {
    readonly name: string;
    readonly legalName: string | null;
    readonly taxId: string | null;
    readonly addressLine1: string | null;
    readonly city: string | null;
    readonly currencyCode: string;
    readonly currencySymbol: string;
  };
  readonly customer: { readonly fullName: string; readonly phone: string | null } | null;
  readonly items: readonly {
    readonly name: string;
    readonly variantName: string | null;
    readonly unitPriceMinor: number;
    readonly quantity: number;
    readonly addons: readonly { readonly name: string; readonly priceMinor: number; readonly quantity: number }[];
    readonly discountMinor: number;
    readonly taxMinor: number;
    readonly lineTotalMinor: number;
    readonly notes: string | null;
  }[];
  readonly totals: OrderTotalsView;
  readonly payments: readonly { readonly paymentNumber: string; readonly method: string; readonly amountMinor: number; readonly approvedAt: string | null }[];
  readonly refunds: readonly { readonly amountMinor: number; readonly reason: string; readonly createdAt: string }[];
  readonly chair: { readonly code: string; readonly name: string | null; readonly zoneName: string | null } | null;
  readonly rental: { readonly code: string; readonly startAt: string; readonly endAt: string; readonly billedMinutes: number; readonly extraMinutesMinor: number } | null;
  readonly placedAt: string | null;
  readonly completedAt: string | null;
  /** Reservado para el futuro: hoy la impresión es responsabilidad del cliente. */
  readonly printedAt: null;
}

/** Página de pedidos. */
export interface OrderPage {
  readonly items: readonly OrderSummaryView[];
  readonly total: number;
  /** `meta.countsByStatus` de API.md 7.12. */
  readonly countsByStatus: Readonly<Record<OrderStatus, number>>;
  /** `meta.totals` de API.md 7.12. */
  readonly totals: {
    readonly grossMinor: number;
    readonly netMinor: number;
    readonly unpaidMinor: number;
  };
}
