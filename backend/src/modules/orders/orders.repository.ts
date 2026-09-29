/**
 * Contrato de persistencia de pedidos (tablas `orders`, `order_items`,
 * `order_item_addons` y `order_status_history`).
 *
 * Es una INTERFAZ y no una clase: el service depende de este contrato, nunca de
 * SQLite (DESIGN.md 3.1, regla P3). La implementación vive en
 * `orders.repository.sqlite.ts`, único fichero del módulo con SQL de pedidos.
 *
 * REGLAS QUE RESPETA:
 *  - Ningún método abre ni cierra transacción: la abre el service con
 *    `runInTransactionSync` (DESIGN.md 8.2). Todos aceptan la conexión como
 *    último parámetro para poder participar de la transacción abierta por otro
 *    módulo (el de pagos actualiza `orders.paid_minor` en la suya).
 *  - Ningún método calcula un total: la aritmética vive en `order-pricing.ts`,
 *    que es pura y testeable sin base de datos.
 *  - Un método = una cosa. Nada de "insertAndRecalculateAndAudit".
 */
import type { Db } from '../../shared/database/connection.js';
import type {
  OrderChannel,
  OrderItemStatus,
  OrderStatus,
  OrderType,
} from '../../shared/domain/index.js';
import type {
  OrderItemAddonRow,
  OrderItemRow,
  OrderRow,
  OrderSort,
  OrderSortColumn,
  OrderStatusHistoryRow,
  OrderSummaryRow,
} from './orders.types.js';

// Reexportadas para que el repositorio SQLite hable el vocabulario del contrato
// sin llegar a `*.types` (mismo criterio que `users`, `customers` y `catalog`).
export type {
  OrderItemAddonRow,
  OrderItemRow,
  OrderRow,
  OrderSort,
  OrderSortColumn,
  OrderStatusHistoryRow,
  OrderSummaryRow,
};

/** Filtros de `GET /api/v1/orders`. `businessId` sale SIEMPRE del token. */
export interface OrderListFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: OrderSort;
  readonly status?: OrderStatus;
  readonly type?: OrderType;
  readonly chairId?: number;
  readonly locationId?: number;
  /**
   * Forzado por el service a `actor.id` cuando el actor no tiene
   * `orders:read:any` (BR-SEC-008 y DESIGN.md 9.3).
   */
  readonly customerId?: number;
  readonly createdBy?: number;
  /** Búsqueda por `order_number` o `customer_notes`. `LIKE` parametrizado. */
  readonly q?: string;
  /** `true` = sólo pedidos con saldo pendiente. */
  readonly hasUnpaidBalance?: boolean;
  readonly from?: string;
  readonly to?: string;
}

/** Datos insertados en `orders`. Los totales empiezan en 0 (paso 1 de §8.5). */
export interface NewOrderRecord {
  readonly businessId: number;
  readonly locationId: number | null;
  readonly orderNumber: string;
  readonly type: OrderType;
  readonly status: OrderStatus;
  readonly customerId: number | null;
  readonly chairId: number | null;
  readonly reservationId: number | null;
  readonly rentalId: number | null;
  readonly tableLabel: string | null;
  readonly channel: OrderChannel;
  readonly createdBy: number | null;
  readonly couponCode: string | null;
  readonly notes: string | null;
  readonly customerNotes: string | null;
  /** `placed_at`. `null` mientras el pedido es `DRAFT` (BR-ORDER-002). */
  readonly placedAt: string | null;
  readonly createdAt: string;
}

/** Cifras del pedido, ya calculadas por `order-pricing.ts`. */
export interface OrderTotalsRecord {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  readonly totalMinor: number;
}

/** Campos actualizables de `orders` que no son cifras. */
export interface OrderHeaderPatch {
  readonly chairId?: number | null;
  readonly rentalId?: number | null;
  readonly tableLabel?: string | null;
  readonly locationId?: number | null;
  readonly notes?: string | null;
  readonly customerNotes?: string | null;
  readonly couponCode?: string | null;
}

/** Timestamps de estado que la máquina de estados puede escribir (paso 2 de §6.1). */
export interface OrderStatusTimestamps {
  readonly confirmedAt?: string | null;
  readonly preparingAt?: string | null;
  readonly readyAt?: string | null;
  readonly completedAt?: string | null;
  readonly cancelledAt?: string | null;
  readonly cancelReason?: string | null;
}

/** Datos insertados en `order_items`, con TODOS sus snapshots. */
export interface NewOrderItemRecord {
  readonly orderId: number;
  readonly productId: number | null;
  readonly variantId: number | null;
  readonly nameSnapshot: string;
  readonly skuSnapshot: string | null;
  readonly unitPriceMinor: number;
  readonly quantity: number;
  readonly lineTotalMinor: number;
  readonly notes: string | null;
  readonly status: OrderItemStatus;
  readonly preparationMinutes: number;
}

/** Campos actualizables de `order_items`. */
export interface OrderItemPatch {
  readonly quantity?: number;
  readonly unitPriceMinor?: number;
  readonly lineTotalMinor?: number;
  readonly notes?: string | null;
  readonly status?: OrderItemStatus;
  readonly preparationMinutes?: number;
}

/** Snapshot de complemento congelado (BR-PRICE-004). */
export interface NewOrderItemAddonRecord {
  readonly orderItemId: number;
  readonly productAddonId: number | null;
  readonly nameSnapshot: string;
  readonly priceMinor: number;
  readonly quantity: number;
}

/** Filtros de `GET /api/v1/orders/:id/history`. */
export interface OrderHistoryFilter {
  readonly orderId: number;
  readonly limit: number;
  readonly offset: number;
  readonly direction: 'ASC' | 'DESC';
}

/** Ajustes del negocio que el cálculo de un pedido necesita. */
export interface OrderBusinessSettingsRow {
  readonly id: number;
  readonly name: string;
  readonly legal_name: string | null;
  readonly tax_id: string | null;
  readonly address_line1: string | null;
  readonly city: string | null;
  readonly currency_code: string;
  readonly currency_symbol: string;
  readonly tax_rate_bp: number;
  readonly tax_inclusive: 0 | 1;
  readonly service_fee_bp: number;
  readonly allow_negative_stock: 0 | 1;
  readonly order_prefix: string;
  readonly tip_enabled: 0 | 1;
}

/** Totales agregados de un listado de pedidos (`meta.totals`). */
export interface OrderAggregateTotalsRow {
  readonly gross_minor: number;
  readonly net_minor: number;
  readonly unpaid_minor: number;
}

/** Instantánea mínima de un pedido para el módulo de descuentos. */
export interface OrderSnapshotRow {
  readonly id: number;
  readonly business_id: number;
  readonly customer_id: number | null;
  readonly subtotal_minor: number;
}

/** Repositorio de pedidos. */
export interface OrdersRepository {
  // --- Ajustes del negocio -------------------------------------------------

  /**
   * `tax_rate_bp`, `tax_inclusive`, `service_fee_bp`, `allow_negative_stock`,
   * `order_prefix` y los datos de cabecera del recibo. `null` si `businesses`
   * no está sembrada: entonces el service usa los valores por defecto de la
   * tabla y lo deja registrado en el log.
   */
  findBusinessSettings(businessId: number, db?: Db): OrderBusinessSettingsRow | null;

  // --- Lecturas ------------------------------------------------------------

  /** Pedido por id, acotado al negocio y no borrado lógicamente. */
  findById(id: number, businessId: number, db?: Db): OrderRow | null;
  /** Listado paginado, con el conteo de líneas resuelto por subconsulta. */
  list(filter: OrderListFilter, db?: Db): readonly OrderSummaryRow[];
  /** Total de pedidos que satisfacen el filtro, sin paginar. */
  count(filter: Omit<OrderListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Conteos por estado del filtro COMPLETO, para `meta.countsByStatus`. */
  countByStatus(
    filter: Omit<OrderListFilter, 'limit' | 'offset' | 'sort'>,
    db?: Db,
  ): readonly { readonly status: OrderStatus; readonly total: number }[];
  /** Agregados de importes del filtro COMPLETO, para `meta.totals`. */
  aggregateTotals(
    filter: Omit<OrderListFilter, 'limit' | 'offset' | 'sort'>,
    db?: Db,
  ): OrderAggregateTotalsRow;
  /** Líneas del pedido, con variante y categoría unidas. */
  listItems(orderId: number, db?: Db): readonly OrderItemRow[];
  /** Línea por id. `null` si no existe. */
  findItemById(itemId: number, db?: Db): OrderItemRow | null;
  /** Complementos de una línea, con su snapshot. */
  listItemAddons(orderItemId: number, db?: Db): readonly OrderItemAddonRow[];
  /** Complementos de varias líneas de golpe: evita el N+1 del pedido. */
  listAddonsForItems(orderItemIds: readonly number[], db?: Db): readonly OrderItemAddonRow[];
  /** Historial de estados paginado (BR-ORDER-013). */
  listHistory(filter: OrderHistoryFilter, db?: Db): readonly OrderStatusHistoryRow[];
  /** Total de entradas del historial. */
  countHistory(orderId: number, db?: Db): number;
  /** Instantánea mínima para la cotización de cupones. */
  findSnapshot(orderId: number, businessId: number, db?: Db): OrderSnapshotRow | null;
  /** Silla del pedido, con su zona, para el detalle y el recibo. */
  findChairForOrder(orderId: number, db?: Db): OrderChairRow | null;
  /** Datos del recibo: negocio, silla, reserva y alquiler del pedido. */
  findReceiptContext(
    orderId: number,
    businessId: number,
    db?: Db,
  ): OrderReceiptContextRow | null;
  /**
   * Silla por id, acotada al negocio POR EL `JOIN` CON `zones`.
   *
   * `chairs` no tiene `business_id` (ver el tsdoc de `spaces.repository.ts`): la
   * única forma de no leer una silla de otro negocio es pasar por
   * `zones.business_id`. Por eso el `OrderChairRow` de aquí incluye
   * `business_id`, cosa que el `ChairRow` del módulo de espacios no lleva.
   */
  findChairById(chairId: number, businessId: number, db?: Db): OrderChairRef | null;
  /** Cliente del pedido, para el detalle. `null` si el pedido no tiene cliente. */
  findCustomerForOrder(orderId: number, db?: Db): OrderCustomerRow | null;

  // --- Escrituras ----------------------------------------------------------

  /** Inserta la cabecera del pedido y devuelve su id. */
  insert(record: NewOrderRecord, db?: Db): number;
  /** Escribe las cifras ya calculadas por `order-pricing.ts`. */
  updateTotals(orderId: number, totals: OrderTotalsRecord, db?: Db): void;
  /** Actualiza campos de cabecera que no son cifras. */
  updateHeader(orderId: number, patch: OrderHeaderPatch, db?: Db): void;
  /**
   * Cambia el estado y sus TIMESTAMPS en la misma sentencia.
   *
   * `ck_orders_completed_at` exige `completed_at IS NOT NULL` cuando el estado
   * es `COMPLETED`, así que los dos van juntos por diseño: no hay forma de
   * dejar un pedido entregado sin fecha de entrega.
   */
  updateStatus(
    orderId: number,
    status: OrderStatus,
    timestamps: OrderStatusTimestamps,
    db?: Db,
  ): void;
  /**
   * Recalcula `paid_minor` y `balance_minor` a partir del total actual.
   *
   * El total NO se lee de aquí: lo pasa el llamante ya calculado dentro de la
   * transacción, para que `paid_minor` y `balance_minor` se escriban SIEMPRE
   * coherentes entre sí (BR-MONEY-006).
   */
  updatePaidAndBalance(orderId: number, totalMinor: number, paidMinor: number, db?: Db): void;
  /** Fija `coupon_code` y el descuento ya aplicado, de forma atómica. */
  updateCoupon(orderId: number, couponCode: string | null, discountMinor: number, db?: Db): void;
  /** Marca `deleted_at` (BR-ORDER-016: sólo ADMIN/OWNER y pedidos no cobrados). */
  softDelete(orderId: number, deletedAt: string, db?: Db): void;

  /** Inserta una línea con sus snapshots y devuelve su id. */
  insertItem(record: NewOrderItemRecord, db?: Db): number;
  /** Actualiza sólo los campos presentes de una línea. */
  updateItem(itemId: number, patch: OrderItemPatch, db?: Db): void;
  /** Escribe el descuento y el impuesto PRORRATEADOS de una línea. */
  updateItemAmounts(itemId: number, discountMinor: number, taxMinor: number, db?: Db): void;
  /** Elimina una línea. Los complementos caen por `ON DELETE CASCADE`. */
  deleteItem(itemId: number, db?: Db): number;
  /** Número de líneas NO canceladas del pedido (`meta.itemCount`). */
  countActiveItems(orderId: number, db?: Db): number;

  /** Inserta un complemento con su snapshot. */
  insertItemAddon(record: NewOrderItemAddonRecord, db?: Db): number;
  /** Elimina todos los complementos de una línea (al reemplazarlos). */
  deleteItemAddons(orderItemId: number, db?: Db): number;

  /**
   * Inserta una fila de `order_status_history` (BR-ORDER-013).
   *
   * `from_status = null` marca la CREACIÓN del pedido, no una transición.
   * `reason` es obligatorio en `CANCELLED` y `REFUNDED` por el CHECK
   * `ck_order_history_reason`.
   */
  insertStatusHistory(
    record: {
      readonly orderId: number;
      readonly fromStatus: OrderStatus | null;
      readonly toStatus: OrderStatus;
      readonly changedBy: number | null;
      readonly reason: string | null;
    },
    db?: Db,
  ): number;
}

/** Silla del pedido con su zona, para el detalle y el recibo. */
export interface OrderChairRow {
  readonly id: number;
  readonly code: string;
  readonly name: string | null;
  readonly zone_name: string | null;
  readonly status: string;
}

/**
 * Silla con su negocio resuelto, para VALIDAR un pedido.
 *
 * `chairs` no tiene `business_id`: el aislamiento se hace por
 * `chairs.zone_id -> zones.business_id`, igual que en el módulo de espacios. Por
 * eso aquí sí viene `business_id`, y por eso toda lectura de silla de este
 * módulo pasa por el `JOIN` con `zones`.
 */
export interface OrderChairRef extends OrderChairRow {
  readonly business_id: number;
  readonly zone_id: number;
  readonly price_per_hour_minor: number;
  readonly is_active: 0 | 1;
  readonly is_bookable: 0 | 1;
  readonly deleted_at: string | null;
}

/** Cliente del pedido, para el detalle y el recibo. */
export interface OrderCustomerRow {
  readonly id: number;
  readonly full_name: string;
  readonly phone: string | null;
  readonly email: string;
}

/**
 * Contexto del recibo, en UNA consulta.
 *
 * El recibo se construye SOLO con snapshots y valores almacenados
 * (BR-ORDER-018), así que no consulta el catálogo. Estas cuatro son las únicas
 * entidades que necesita: negocio, silla, reserva y alquiler.
 */
export interface OrderReceiptContextRow {
  readonly business_name: string;
  readonly business_legal_name: string | null;
  readonly business_tax_id: string | null;
  readonly business_address_line1: string | null;
  readonly business_city: string | null;
  readonly business_currency_code: string;
  readonly business_currency_symbol: string;
  readonly chair_id: number | null;
  readonly chair_code: string | null;
  readonly chair_name: string | null;
  readonly chair_zone_name: string | null;
  readonly reservation_id: number | null;
  readonly reservation_code: string | null;
  readonly reservation_status: string | null;
  readonly reservation_start_at: string | null;
  readonly reservation_end_at: string | null;
  readonly rental_id: number | null;
  readonly rental_code: string | null;
  readonly rental_status: string | null;
  readonly rental_start_at: string | null;
  readonly rental_end_at: string | null;
  readonly rental_billed_minutes: number | null;
  readonly rental_extra_minutes_minor: number | null;
  readonly rental_total_minor: number | null;
}
