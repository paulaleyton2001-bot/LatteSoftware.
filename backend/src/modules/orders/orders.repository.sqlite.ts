/**
 * Implementación SQLite del repositorio de pedidos.
 *
 * ÚNICO fichero con SQL de `orders`, `order_items`, `order_item_addons` y
 * `order_status_history` (DESIGN.md 3.2). Todas las consultas van con
 * parámetros `?`; la entrada del cliente NUNCA se concatena en el texto SQL.
 *
 * ============================ CINCO DETALLES QUE IMPORTAN ===================
 * 1. **`chairs` no tiene `business_id`.** El aislamiento de una silla se hace
 *    SIEMPRE por el `JOIN` con `zones` (`zones.business_id`), igual que hace
 *    `spaces.repository.sqlite.ts`. No existe aquí ninguna consulta que lea una
 *    silla sin ese JOIN: sería una fuga entre negocios.
 * 2. **`item_count` por subconsulta escalar, no por `JOIN` + `GROUP BY`.** Un
 *    `LEFT JOIN order_items` multiplicaría las filas del listado y obligaría a
 *    agrupar por todas las columnas de `orders`; una subconsulta correlacionada
 *    da el mismo número con una consulta legible y sin cambiar la paginación.
 * 3. **Firmas de estado y sus timestamps van en la misma sentencia.** El CHECK
 *    `ck_orders_completed_at` exige `completed_at IS NOT NULL` cuando el estado
 *    es `COMPLETED`; escribirlos por separado abriría una ventana en la que el
 *    UPDATE del estado es rechazado por el CHECK.
 * 4. **`LIKE` parametrizado y escapado** en la búsqueda por `order_number` y
 *    `customer_notes`: buscar "100%" no debe devolver todos los pedidos.
 * 5. **`updateTotals` no lee nada.** El total llega ya calculado por
 *    `order-pricing.ts`: si el repositorio lo recalculara, la aritmética dejaría
 *    de ser pura y dejaría de ser testeable sin base de datos.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import { isEnumValue, OrderStatus } from '../../shared/domain/index.js';
import type {
  NewOrderItemAddonRecord,
  NewOrderItemRecord,
  NewOrderRecord,
  OrderAggregateTotalsRow,
  OrderBusinessSettingsRow,
  OrderChairRef,
  OrderChairRow,
  OrderCustomerRow,
  OrderHeaderPatch,
  OrderHistoryFilter,
  OrderItemAddonRow,
  OrderItemPatch,
  OrderItemRow,
  OrderListFilter,
  OrderReceiptContextRow,
  OrderRow,
  OrdersRepository,
  OrderSnapshotRow,
  OrderSortColumn,
  OrderStatusHistoryRow,
  OrderStatusTimestamps,
  OrderTotalsRecord,
  OrderSummaryRow,
} from './orders.repository.js';

/** Columnas base de `orders`, con los dos JOIN de presentación. */
const ORDER_COLUMNS = `
  o.id, o.business_id, o.location_id, o.order_number, o.type, o.status, o.customer_id,
  o.chair_id, o.reservation_id, o.rental_id, o.table_label, o.channel, o.created_by,
  o.subtotal_minor, o.discount_minor, o.tax_minor, o.service_fee_minor, o.total_minor,
  o.paid_minor, o.balance_minor, o.coupon_code, o.notes, o.customer_notes,
  o.placed_at, o.confirmed_at, o.preparing_at, o.ready_at, o.completed_at,
  o.cancelled_at, o.cancel_reason, o.created_at, o.updated_at, o.deleted_at,
  ch.code AS chair_code,
  cu.full_name AS customer_name
`;

/** `FROM` con los LEFT JOIN de presentación. */
const ORDER_FROM = `
  FROM orders o
  LEFT JOIN chairs ch ON ch.id = o.chair_id
  LEFT JOIN users  cu ON cu.id = o.customer_id
`;

/**
 * Allowlist de columnas ordenables: clave = salida de `parseSort`,
 * valor = columna real. Una allowlist por construcción, sin concatenar entrada.
 */
const SORT_SQL: Readonly<Record<OrderSortColumn, string>> = Object.freeze({
  created_at: 'o.created_at',
  placed_at: 'o.placed_at',
  total_minor: 'o.total_minor',
  order_number: 'o.order_number',
  completed_at: 'o.completed_at',
});

/** Número de líneas NO canceladas: lo que el cajero ve como "ítems del pedido". */
const ITEM_COUNT_SQL = `
  (SELECT COUNT(*) FROM order_items oi
    WHERE oi.order_id = o.id AND oi.status <> 'CANCELLED') AS item_count
`;

/** Columnas de `order_items`, con la variante y la categoría unidas. */
const ORDER_ITEM_COLUMNS = `
  oi.id, oi.order_id, oi.product_id, oi.variant_id, oi.name_snapshot, oi.sku_snapshot,
  oi.unit_price_minor, oi.quantity, oi.discount_minor, oi.tax_minor, oi.line_total_minor,
  oi.notes, oi.status, oi.preparation_minutes, oi.created_at, oi.updated_at,
  pv.name AS variant_name,
  p.category_id AS category_id
`;

/** `FROM` de `order_items` con la variante y el producto unidos. */
const ORDER_ITEM_FROM = `
  FROM order_items oi
  LEFT JOIN product_variants pv ON pv.id = oi.variant_id
  LEFT JOIN products         p  ON p.id  = oi.product_id
`;

/** Escapa los comodines de `LIKE` en el texto buscado por el cliente. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** `WHERE` compartido por `list`, `count`, `countByStatus` y `aggregateTotals`. */
function buildWhere(filter: Omit<OrderListFilter, 'limit' | 'offset' | 'sort'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = ['o.business_id = ?', 'o.deleted_at IS NULL'];
  const params: unknown[] = [filter.businessId];

  if (filter.status !== undefined) {
    clauses.push('o.status = ?');
    params.push(filter.status);
  }
  if (filter.type !== undefined) {
    clauses.push('o.type = ?');
    params.push(filter.type);
  }
  if (filter.chairId !== undefined) {
    clauses.push('o.chair_id = ?');
    params.push(filter.chairId);
  }
  if (filter.locationId !== undefined) {
    clauses.push('o.location_id = ?');
    params.push(filter.locationId);
  }
  if (filter.customerId !== undefined) {
    clauses.push('o.customer_id = ?');
    params.push(filter.customerId);
  }
  if (filter.createdBy !== undefined) {
    clauses.push('o.created_by = ?');
    params.push(filter.createdBy);
  }
  if (filter.hasUnpaidBalance === true) {
    clauses.push('o.balance_minor > 0');
  }
  if (filter.q !== undefined) {
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push("(o.order_number LIKE ? ESCAPE '\\' OR o.customer_notes LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (filter.from !== undefined) {
    clauses.push('o.created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('o.created_at < ?');
    params.push(filter.to);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de pedidos sobre `better-sqlite3`. */
export class SqliteOrdersRepository implements OrdersRepository {
  // --- Ajustes del negocio -------------------------------------------------

  public findBusinessSettings(
    businessId: number,
    db: Db = getConnection(),
  ): OrderBusinessSettingsRow | null {
    const row = db
      .prepare(
        `SELECT id, name, legal_name, tax_id, address_line1, city, currency_code,
                currency_symbol, tax_rate_bp, tax_inclusive, service_fee_bp,
                allow_negative_stock, order_prefix, tip_enabled
           FROM businesses
          WHERE id = ?`,
      )
      .get(businessId) as OrderBusinessSettingsRow | undefined;
    return row ?? null;
  }

  // --- Lecturas ------------------------------------------------------------

  public findById(id: number, businessId: number, db: Db = getConnection()): OrderRow | null {
    const row = db
      .prepare(
        `SELECT ${ORDER_COLUMNS} ${ORDER_FROM}
          WHERE o.id = ? AND o.business_id = ? AND o.deleted_at IS NULL`,
      )
      .get(id, businessId) as OrderRow | undefined;
    return row ?? null;
  }

  public list(filter: OrderListFilter, db: Db = getConnection()): readonly OrderSummaryRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${ORDER_COLUMNS}, ${ITEM_COUNT_SQL} ${ORDER_FROM}
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, o.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as OrderSummaryRow[];
  }

  public count(
    filter: Omit<OrderListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM orders o WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public countByStatus(
    filter: Omit<OrderListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): readonly { readonly status: OrderStatus; readonly total: number }[] {
    const where = buildWhere(filter);
    return db
      .prepare(
        `SELECT o.status AS status, COUNT(*) AS total
           FROM orders o
          WHERE ${where.sql}
          GROUP BY o.status`,
      )
      .all(...where.params) as { status: OrderStatus; total: number }[];
  }

  public aggregateTotals(
    filter: Omit<OrderListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): OrderAggregateTotalsRow {
    const where = buildWhere(filter);
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(o.total_minor), 0) AS gross_minor,
                COALESCE(SUM(o.paid_minor), 0)  AS net_minor,
                COALESCE(SUM(CASE WHEN o.balance_minor > 0 THEN o.balance_minor ELSE 0 END), 0)
                  AS unpaid_minor
           FROM orders o
          WHERE ${where.sql}`,
      )
      .get(...where.params) as OrderAggregateTotalsRow | undefined;
    return row ?? { gross_minor: 0, net_minor: 0, unpaid_minor: 0 };
  }

  public listItems(orderId: number, db: Db = getConnection()): readonly OrderItemRow[] {
    return db
      .prepare(
        `SELECT ${ORDER_ITEM_COLUMNS} ${ORDER_ITEM_FROM}
          WHERE oi.order_id = ?
          ORDER BY oi.id ASC`,
      )
      .all(orderId) as OrderItemRow[];
  }

  public findItemById(itemId: number, db: Db = getConnection()): OrderItemRow | null {
    const row = db
      .prepare(
        `SELECT ${ORDER_ITEM_COLUMNS} ${ORDER_ITEM_FROM}
          WHERE oi.id = ?`,
      )
      .get(itemId) as OrderItemRow | undefined;
    return row ?? null;
  }

  public listItemAddons(orderItemId: number, db: Db = getConnection()): readonly OrderItemAddonRow[] {
    return db
      .prepare(
        `SELECT id, order_item_id, product_addon_id, name_snapshot, price_minor, quantity, created_at
           FROM order_item_addons
          WHERE order_item_id = ?
          ORDER BY id ASC`,
      )
      .all(orderItemId) as OrderItemAddonRow[];
  }

  /**
   * Complementos de N líneas en UNA consulta.
   *
   * El recibo y el detalle necesitan los complementos de todas las líneas del
   * pedido; pedirlos línea a línea sería un N+1 sobre la respuesta que el cajero
   * ve en la caja. Un array vacío evita incluso el `IN ()` degenerado.
   */
  public listAddonsForItems(
    orderItemIds: readonly number[],
    db: Db = getConnection(),
  ): readonly OrderItemAddonRow[] {
    if (orderItemIds.length === 0) {
      return [];
    }
    const placeholders = orderItemIds.map(() => '?').join(', ');
    return db
      .prepare(
        `SELECT id, order_item_id, product_addon_id, name_snapshot, price_minor, quantity, created_at
           FROM order_item_addons
          WHERE order_item_id IN (${placeholders})
          ORDER BY id ASC`,
      )
      .all(...orderItemIds) as OrderItemAddonRow[];
  }

  public listHistory(filter: OrderHistoryFilter, db: Db = getConnection()): readonly OrderStatusHistoryRow[] {
    return db
      .prepare(
        `SELECT h.id, h.order_id, h.from_status, h.to_status, h.changed_by, h.reason, h.created_at,
                u.full_name AS changed_by_name
           FROM order_status_history h
           LEFT JOIN users u ON u.id = h.changed_by
          WHERE h.order_id = ?
          ORDER BY h.created_at ${filter.direction}, h.id ${filter.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(filter.orderId, filter.limit, filter.offset) as OrderStatusHistoryRow[];
  }

  public countHistory(orderId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COUNT(*) AS total FROM order_status_history WHERE order_id = ?')
      .get(orderId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findSnapshot(orderId: number, businessId: number, db: Db = getConnection()): OrderSnapshotRow | null {
    const row = db
      .prepare(
        `SELECT id, business_id, customer_id, subtotal_minor
           FROM orders
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL`,
      )
      .get(orderId, businessId) as OrderSnapshotRow | undefined;
    return row ?? null;
  }

  public findChairForOrder(orderId: number, db: Db = getConnection()): OrderChairRow | null {
    const row = db
      .prepare(
        `SELECT ch.id, ch.code, ch.name, z.name AS zone_name, ch.status
           FROM orders o
           JOIN chairs ch ON ch.id = o.chair_id
           JOIN zones  z  ON z.id  = ch.zone_id
          WHERE o.id = ?`,
      )
      .get(orderId) as OrderChairRow | undefined;
    return row ?? null;
  }

  public findCustomerForOrder(orderId: number, db: Db = getConnection()): OrderCustomerRow | null {
    const row = db
      .prepare(
        `SELECT u.id, u.full_name, u.phone, u.email
           FROM orders o
           JOIN users u ON u.id = o.customer_id
          WHERE o.id = ?`,
      )
      .get(orderId) as OrderCustomerRow | undefined;
    return row ?? null;
  }

  /**
   * Contexto del recibo en UNA consulta.
   *
   * El recibo se construye SOLO con snapshots y valores almacenados
   * (BR-ORDER-018): no consulta el catálogo, así que un producto que subió de
   * precio o se borró no altera el comprobante de una venta ya emitida.
   */
  public findReceiptContext(
    orderId: number,
    businessId: number,
    db: Db = getConnection(),
  ): OrderReceiptContextRow | null {
    const row = db
      .prepare(
        `SELECT b.name      AS business_name,
                b.legal_name AS business_legal_name,
                b.tax_id     AS business_tax_id,
                b.address_line1 AS business_address_line1,
                b.city       AS business_city,
                b.currency_code  AS business_currency_code,
                b.currency_symbol AS business_currency_symbol,
                ch.id        AS chair_id,
                ch.code      AS chair_code,
                ch.name      AS chair_name,
                z.name       AS chair_zone_name,
                r.id         AS reservation_id,
                r.code       AS reservation_code,
                r.status     AS reservation_status,
                r.start_at   AS reservation_start_at,
                r.end_at     AS reservation_end_at,
                rt.id        AS rental_id,
                rt.code      AS rental_code,
                rt.status    AS rental_status,
                rt.start_at  AS rental_start_at,
                rt.end_at    AS rental_end_at,
                rt.billed_minutes     AS rental_billed_minutes,
                rt.extra_minutes_minor AS rental_extra_minutes_minor,
                rt.total_minor AS rental_total_minor
           FROM orders o
           JOIN      businesses b  ON b.id  = o.business_id
           LEFT JOIN chairs    ch ON ch.id = o.chair_id
           LEFT JOIN zones     z  ON z.id  = ch.zone_id
           LEFT JOIN chair_reservations r  ON r.id  = o.reservation_id
           LEFT JOIN chair_rentals       rt ON rt.id = o.rental_id
          WHERE o.id = ? AND o.business_id = ? AND o.deleted_at IS NULL`,
      )
      .get(orderId, businessId) as OrderReceiptContextRow | undefined;
    return row ?? null;
  }

  /**
   * Silla por id, acotada al negocio por el `JOIN` con `zones`.
   *
   * `chairs` NO tiene `business_id` (ver `spaces.repository.ts`): la única forma
   * de no filtrar entre negocios es pasar por `zones.business_id`.
   */
  public findChairById(
    chairId: number,
    businessId: number,
    db: Db = getConnection(),
  ): OrderChairRef | null {
    const row = db
      .prepare(
        `SELECT ch.id, ch.code, ch.name, z.name AS zone_name, ch.status, ch.zone_id,
                z.business_id, ch.is_active, ch.is_bookable, ch.price_per_hour_minor, ch.deleted_at
           FROM chairs ch
           JOIN zones z ON z.id = ch.zone_id
          WHERE ch.id = ? AND z.business_id = ?`,
      )
      .get(chairId, businessId) as OrderChairRef | undefined;
    return row ?? null;
  }

  // --- Escrituras ----------------------------------------------------------

  public insert(record: NewOrderRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO orders
             (business_id, location_id, order_number, type, status, customer_id, chair_id,
              reservation_id, rental_id, table_label, channel, created_by, coupon_code,
              notes, customer_notes, placed_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.locationId,
          record.orderNumber,
          record.type,
          record.status,
          record.customerId,
          record.chairId,
          record.reservationId,
          record.rentalId,
          record.tableLabel,
          record.channel,
          record.createdBy,
          record.couponCode,
          record.notes,
          record.customerNotes,
          record.placedAt,
          record.createdAt,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // `ux_orders_order_number` es la garantía final de BR-ORDER-001: aunque la
      // secuenciafinde un hueco, dos procesos concurrentes no pueden cobrar el
      // mismo número.
      throw translateUniqueConstraint(error, {
        code: 'ORDER_NUMBER_TAKEN',
        message: 'Ya existe un pedido con ese número',
        field: 'orderNumber',
        index: 'ux_orders_order_number',
      });
    }
  }

  /**
   * Escribe las cifras ya calculadas por `order-pricing.ts`.
   *
   * `balance_minor` se calcula con el total NUEVO pasado como parámetro, NO con
   * la columna `total_minor` de la misma fila: en SQLite todas las expresiones
   * del `SET` ven los valores ANTIGUOS, así que `total_minor - paid_minor` usaría
   * el total previo y dejaría el saldo en 0 o en un número que no cuadra con el
   * total que se acaba de escribir. Es un error silencioso (el CHECK `>= 0` no lo
   * detecta) y dejaría el cobro de todo el pedido roto.
   */
  public updateTotals(orderId: number, totals: OrderTotalsRecord, db: Db = getConnection()): void {
    db.prepare(
      `UPDATE orders
          SET subtotal_minor = ?, discount_minor = ?, tax_minor = ?,
              service_fee_minor = ?, total_minor = ?,
              balance_minor = ? - paid_minor
        WHERE id = ?`,
    ).run(
      totals.subtotalMinor,
      totals.discountMinor,
      totals.taxMinor,
      totals.serviceFeeMinor,
      totals.totalMinor,
      totals.totalMinor,
      orderId,
    );
  }

  public updateHeader(orderId: number, patch: OrderHeaderPatch, db: Db = getConnection()): void {
    // Sólo se escriben los campos presentes: un PATCH parcial no borra el resto.
    // Los nombres de columna salen de una lista cerrada, nunca del cliente.
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.chairId !== undefined) {
      assignments.push('chair_id = ?');
      params.push(patch.chairId);
    }
    if (patch.rentalId !== undefined) {
      assignments.push('rental_id = ?');
      params.push(patch.rentalId);
    }
    if (patch.tableLabel !== undefined) {
      assignments.push('table_label = ?');
      params.push(patch.tableLabel);
    }
    if (patch.locationId !== undefined) {
      assignments.push('location_id = ?');
      params.push(patch.locationId);
    }
    if (patch.notes !== undefined) {
      assignments.push('notes = ?');
      params.push(patch.notes);
    }
    if (patch.customerNotes !== undefined) {
      assignments.push('customer_notes = ?');
      params.push(patch.customerNotes);
    }
    if (patch.couponCode !== undefined) {
      assignments.push('coupon_code = ?');
      params.push(patch.couponCode);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(orderId);
    db.prepare(`UPDATE orders SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  }

  public updateStatus(
    orderId: number,
    status: OrderStatus,
    timestamps: OrderStatusTimestamps,
    db: Db = getConnection(),
  ): void {
    if (!isEnumValue(OrderStatus, status)) {
      throw new Error(`Estado de pedido no válido: ${String(status)}`);
    }
    const assignments: string[] = ['status = ?'];
    const params: unknown[] = [status];
    if (timestamps.confirmedAt !== undefined) {
      assignments.push('confirmed_at = ?');
      params.push(timestamps.confirmedAt);
    }
    if (timestamps.preparingAt !== undefined) {
      assignments.push('preparing_at = ?');
      params.push(timestamps.preparingAt);
    }
    if (timestamps.readyAt !== undefined) {
      assignments.push('ready_at = ?');
      params.push(timestamps.readyAt);
    }
    if (timestamps.completedAt !== undefined) {
      assignments.push('completed_at = ?');
      params.push(timestamps.completedAt);
    }
    if (timestamps.cancelledAt !== undefined) {
      assignments.push('cancelled_at = ?');
      params.push(timestamps.cancelledAt);
    }
    if (timestamps.cancelReason !== undefined) {
      assignments.push('cancel_reason = ?');
      params.push(timestamps.cancelReason);
    }
    params.push(orderId);
    db.prepare(`UPDATE orders SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  }

  public updatePaidAndBalance(
    orderId: number,
    totalMinor: number,
    paidMinor: number,
    db: Db = getConnection(),
  ): void {
    db.prepare(
      `UPDATE orders
          SET paid_minor = ?, balance_minor = ? - ?
        WHERE id = ?`,
    ).run(paidMinor, totalMinor, paidMinor, orderId);
  }

  public updateCoupon(
    orderId: number,
    couponCode: string | null,
    discountMinor: number,
    db: Db = getConnection(),
  ): void {
    // `coupon_code` y `discount_minor` van juntos: un cupón visible sin importe, o
    // un importe sin el código que lo-justifica, serían dos estados imposibles.
    db.prepare('UPDATE orders SET coupon_code = ?, discount_minor = ? WHERE id = ?').run(
      couponCode,
      discountMinor,
      orderId,
    );
  }

  public softDelete(orderId: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare('UPDATE orders SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
      deletedAt,
      orderId,
    );
  }

  public insertItem(record: NewOrderItemRecord, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `INSERT INTO order_items
           (order_id, product_id, variant_id, name_snapshot, sku_snapshot, unit_price_minor,
            quantity, line_total_minor, notes, status, preparation_minutes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.orderId,
        record.productId,
        record.variantId,
        record.nameSnapshot,
        record.skuSnapshot,
        record.unitPriceMinor,
        record.quantity,
        record.lineTotalMinor,
        record.notes,
        record.status,
        record.preparationMinutes,
      );
    return Number(result.lastInsertRowid);
  }

  public updateItem(itemId: number, patch: OrderItemPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.quantity !== undefined) {
      assignments.push('quantity = ?');
      params.push(patch.quantity);
    }
    if (patch.unitPriceMinor !== undefined) {
      assignments.push('unit_price_minor = ?');
      params.push(patch.unitPriceMinor);
    }
    if (patch.lineTotalMinor !== undefined) {
      assignments.push('line_total_minor = ?');
      params.push(patch.lineTotalMinor);
    }
    if (patch.notes !== undefined) {
      assignments.push('notes = ?');
      params.push(patch.notes);
    }
    if (patch.status !== undefined) {
      assignments.push('status = ?');
      params.push(patch.status);
    }
    if (patch.preparationMinutes !== undefined) {
      assignments.push('preparation_minutes = ?');
      params.push(patch.preparationMinutes);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(itemId);
    db.prepare(`UPDATE order_items SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  }

  public updateItemAmounts(
    itemId: number,
    discountMinor: number,
    taxMinor: number,
    db: Db = getConnection(),
  ): void {
    db.prepare('UPDATE order_items SET discount_minor = ?, tax_minor = ? WHERE id = ?').run(
      discountMinor,
      taxMinor,
      itemId,
    );
  }

  public deleteItem(itemId: number, db: Db = getConnection()): number {
    // Los complementos caen por `ON DELETE CASCADE` de `order_item_addons`.
    const result = db.prepare('DELETE FROM order_items WHERE id = ?').run(itemId);
    return result.changes;
  }

  public countActiveItems(orderId: number, db: Db = getConnection()): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total FROM order_items WHERE order_id = ? AND status <> 'CANCELLED'`,
      )
      .get(orderId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public insertItemAddon(record: NewOrderItemAddonRecord, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `INSERT INTO order_item_addons
           (order_item_id, product_addon_id, name_snapshot, price_minor, quantity)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.orderItemId,
        record.productAddonId,
        record.nameSnapshot,
        record.priceMinor,
        record.quantity,
      );
    return Number(result.lastInsertRowid);
  }

  public deleteItemAddons(orderItemId: number, db: Db = getConnection()): number {
    const result = db.prepare('DELETE FROM order_item_addons WHERE order_item_id = ?').run(orderItemId);
    return result.changes;
  }

  public insertStatusHistory(
    record: {
      readonly orderId: number;
      readonly fromStatus: OrderStatus | null;
      readonly toStatus: OrderStatus;
      readonly changedBy: number | null;
      readonly reason: string | null;
    },
    db: Db = getConnection(),
  ): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          record.orderId,
          record.fromStatus,
          record.toStatus,
          record.changedBy,
          record.reason,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // `ck_order_history_reason` exige `reason` en `CANCELLED` y `REFUNDED`.
      // Traducirlo aquí da un 422 legible en lugar de un 500 con el texto del
      // driver, que es lo que el contrato prohíbe (API.md 4).
      if (typeof error === 'object' && error !== null && 'code' in error) {
        const code: unknown = (error as { code: unknown }).code;
        const message = error instanceof Error ? error.message : '';
        if (code === 'SQLITE_CONSTRAINT_CHECK' && message.includes('ck_order_history_reason')) {
          throw new Error(
            'El motivo es obligatorio para registrar una cancelación o un reembolso del pedido',
          );
        }
      }
      throw error;
    }
  }
}
