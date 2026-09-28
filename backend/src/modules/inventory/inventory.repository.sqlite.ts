/**
 * Implementación SQLite del repositorio de inventario.
 *
 * ÚNICO fichero del módulo con SQL. Reglas:
 *  - Todo va con parámetros `?`; `q` y los filtros de supplier usan `LIKE`
 *    PARAMETRIZADO y con los comodines escapados.
 *  - La columna de `ORDER BY` sale de una allowlist interna.
 *  - `balance_after` NUNCA se recalcula en una consulta: lo calcula el service a
 *    partir del saldo que acaba de leer, dentro de la misma transacción en la que
 *    se inserta la fila del movimiento (BR-INV-010). Recalcularlo aquí con
 *    `current_stock + quantity` sería correcto en un único escritor, pero en un
 *    `SELECT` posterior ya no lo sería, y `balance_after` es un hecho histórico,
 *    no una proyección.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import type {
  AlertSeverityCountsRow,
  InventoryItemFilter,
  InventoryItemPatch,
  InventoryItemSortColumn,
  InventoryRepository,
  InventoryStatsRow,
  InventoryTotalsRow,
  MovementFilter,
  MovementListFilter,
  MovementSortColumn,
  MovementTotalsRow,
  NewInventoryItemRecord,
  NewMovementRecord,
  StockAlertFilter,
  SupplierFilter,
} from './inventory.repository.js';
import type {
  AlertSortColumn,
  InventoryBusinessRow,
  InventoryIngredientRef,
  InventoryItemRow,
  InventoryMovementJoinedRow,
  InventoryProductRef,
  SupplierAggregateRow,
} from './inventory.types.js';

/** Columnas de `inventory_items`. */
const ITEM_COLUMNS = `
  ii.id, ii.business_id, ii.product_id, ii.ingredient_id, ii.name, ii.sku, ii.unit,
  ii.current_stock, ii.min_stock, ii.max_stock, ii.cost_minor, ii.supplier,
  ii.location_storage, ii.is_tracked, ii.created_at, ii.updated_at, ii.deleted_at
`;

/** Columnas de `inventory_movements` unidas al nombre y la unidad del ítem. */
const MOVEMENT_COLUMNS = `
  m.id, m.business_id, m.inventory_item_id, m.movement_type, m.quantity,
  m.balance_after, m.unit_cost_minor, m.reference_type, m.reference_id, m.reason,
  m.performed_by, m.created_at,
  ii.name AS inventory_item_name, ii.unit AS unit
`;

/** Columnas ordenables de ítems: allowlist por construcción. */
const ITEM_SORT_SQL: Readonly<Record<InventoryItemSortColumn, string>> = Object.freeze({
  name: 'ii.name',
  current_stock: 'ii.current_stock',
  updated_at: 'ii.updated_at',
  cost_minor: 'ii.cost_minor',
});

/** Columnas ordenables de movimientos. */
const MOVEMENT_SORT_SQL: Readonly<Record<MovementSortColumn, string>> = Object.freeze({
  created_at: 'm.created_at',
  quantity: 'm.quantity',
});

/** Columnas ordenables de alertas. */
const ALERT_SORT_SQL: Readonly<Record<AlertSortColumn, string>> = Object.freeze({
  current_stock: 'ii.current_stock',
  name: 'ii.name',
});

/**
 * Escapa los comodines de `LIKE` en el texto buscado por el cliente.
 *
 * Sin esto, `q = "50%"` traería el catálogo entero: el `%` que el cliente
 * escribe se interpretaría como comodín. Se escapan `%`, `_` y el propio
 * carácter de escape `\`, y todas las consultas que usan `LIKE` declaran
 * `ESCAPE '\\'`.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Expresión del umbral efectivo de un ítem, tal y como la define BR-INV-006:
 * `min_stock`, y si es 0, el `low_stock_alert_threshold` del negocio.
 *
 * Es un fragmento de SQL INTERNO, sin parámetros del cliente: el único valor que
 * se inyecta es `?businessThreshold`, siempre como parámetro.
 */
const EFFECTIVE_THRESHOLD_SQL =
  'CASE WHEN ii.min_stock > 0 THEN ii.min_stock ELSE ? END';

/** `WHERE` compartido por `listItems` y `countItems`. */
function buildItemWhere(
  filter: Omit<InventoryItemFilter, 'limit' | 'offset' | 'sort'>,
): { sql: string; params: unknown[] } {
  const clauses: string[] = ['ii.business_id = ?', 'ii.deleted_at IS NULL'];
  const params: unknown[] = [filter.businessId];

  if (filter.q !== undefined) {
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push("(ii.name LIKE ? ESCAPE '\\' OR IFNULL(ii.sku, '') LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (filter.productId !== undefined) {
    clauses.push('ii.product_id = ?');
    params.push(filter.productId);
  }
  if (filter.ingredientId !== undefined) {
    clauses.push('ii.ingredient_id = ?');
    params.push(filter.ingredientId);
  }
  if (filter.supplier !== undefined) {
    clauses.push('ii.supplier = ?');
    params.push(filter.supplier);
  }
  if (filter.locationStorage !== undefined) {
    clauses.push('ii.location_storage = ?');
    params.push(filter.locationStorage);
  }
  if (filter.isTracked !== undefined) {
    clauses.push('ii.is_tracked = ?');
    params.push(filter.isTracked ? 1 : 0);
  }
  if (filter.isLowStock !== undefined) {
    const threshold = filter.businessThreshold;
    if (filter.isLowStock) {
      clauses.push('ii.is_tracked = 1');
      clauses.push(`ii.current_stock <= ${EFFECTIVE_THRESHOLD_SQL}`);
      params.push(threshold);
    } else {
      clauses.push(`ii.current_stock > ${EFFECTIVE_THRESHOLD_SQL}`);
      params.push(threshold);
    }
  }

  return { sql: clauses.join(' AND '), params };
}

/** `WHERE` de `GET /inventory/alerts` (BR-INV-006). */
function buildAlertWhere(
  filter: Omit<StockAlertFilter, 'limit' | 'offset' | 'sort'>,
): { sql: string; params: unknown[] } {
  const clauses: string[] = [
    'ii.business_id = ?',
    'ii.deleted_at IS NULL',
    // Sólo los ítems SEGUIDOS generan alerta: un producto que no descuenta
    // stock no puede quedarse "sin existencias" (BR-INV-006).
    'ii.is_tracked = 1',
    `ii.current_stock <= ${EFFECTIVE_THRESHOLD_SQL}`,
  ];
  const params: unknown[] = [filter.businessId, filter.businessThreshold];

  if (filter.supplier !== undefined) {
    clauses.push('ii.supplier = ?');
    params.push(filter.supplier);
  }
  if (filter.locationStorage !== undefined) {
    clauses.push('ii.location_storage = ?');
    params.push(filter.locationStorage);
  }
  if (filter.includeNegative !== true) {
    clauses.push('ii.current_stock >= 0');
  }
  if (filter.severity !== undefined) {
    // La precedencia es de la más grave a la menos grave, y coincide con la del
    // service: `NEGATIVE` (< 0) manda sobre `OUT` (= 0), que manda sobre `LOW`.
    if (filter.severity === 'NEGATIVE') {
      clauses.push('ii.current_stock < 0');
    } else if (filter.severity === 'OUT') {
      clauses.push('ii.current_stock = 0');
    } else {
      clauses.push('ii.current_stock > 0');
    }
  }

  return { sql: clauses.join(' AND '), params };
}

/** `WHERE` de `GET /inventory/movements`. */
function buildMovementWhere(filter: MovementFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = ['m.business_id = ?'];
  const params: unknown[] = [filter.businessId];

  if (filter.itemId !== undefined) {
    clauses.push('m.inventory_item_id = ?');
    params.push(filter.itemId);
  }
  if (filter.type !== undefined) {
    clauses.push('m.movement_type = ?');
    params.push(filter.type);
  }
  if (filter.referenceType !== undefined) {
    clauses.push('m.reference_type = ?');
    params.push(filter.referenceType);
  }
  if (filter.referenceId !== undefined) {
    clauses.push('m.reference_id = ?');
    params.push(filter.referenceId);
  }
  if (filter.performedBy !== undefined) {
    clauses.push('m.performed_by = ?');
    params.push(filter.performedBy);
  }
  if (filter.from !== undefined) {
    clauses.push('m.created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('m.created_at < ?');
    params.push(filter.to);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de inventario sobre `better-sqlite3`. */
export class SqliteInventoryRepository implements InventoryRepository {
  // ---------------------------------------------------------------- negocio
  public findBusinessSettings(businessId: number, db: Db = getConnection()): InventoryBusinessRow | null {
    const row = db
      .prepare(
        `SELECT id, allow_negative_stock, low_stock_alert_threshold
           FROM businesses
          WHERE id = ?`,
      )
      .get(businessId) as InventoryBusinessRow | undefined;
    return row ?? null;
  }

  // ------------------------------------------------------------------ ítems
  public listItems(filter: InventoryItemFilter, db: Db = getConnection()): readonly InventoryItemRow[] {
    const where = buildItemWhere(filter);
    const column = ITEM_SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${ITEM_COLUMNS}
           FROM inventory_items ii
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, ii.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as InventoryItemRow[];
  }

  public countItems(
    filter: Omit<InventoryItemFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildItemWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM inventory_items ii WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findItemById(id: number, businessId: number, db: Db = getConnection()): InventoryItemRow | null {
    const row = db
      .prepare(
        `SELECT ${ITEM_COLUMNS}
           FROM inventory_items ii
          WHERE ii.id = ?
            AND ii.business_id = ?
            AND ii.deleted_at IS NULL`,
      )
      .get(id, businessId) as InventoryItemRow | undefined;
    return row ?? null;
  }

  public totals(
    filter: Omit<InventoryItemFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): InventoryTotalsRow {
    const where = buildItemWhere(filter);
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN ii.is_tracked = 1 THEN 1 ELSE 0 END), 0) AS items_tracked,
           COALESCE(SUM(ii.current_stock * ii.cost_minor), 0) AS value_minor,
           COALESCE(SUM(CASE WHEN ii.is_tracked = 1
                              AND ii.current_stock <= ${EFFECTIVE_THRESHOLD_SQL}
                             THEN 1 ELSE 0 END), 0) AS low_stock_count,
           COALESCE(SUM(CASE WHEN ii.current_stock < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_count
         FROM inventory_items ii
        WHERE ${where.sql}`,
      )
      .get(filter.businessThreshold, ...where.params) as InventoryTotalsRow | undefined;
    return (
      row ?? { items_tracked: 0, value_minor: 0, low_stock_count: 0, negative_stock_count: 0 }
    );
  }

  public stats(itemId: number, db: Db = getConnection()): InventoryStatsRow {
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN m.quantity > 0 THEN m.quantity ELSE 0 END), 0) AS total_in,
           COALESCE(SUM(CASE WHEN m.quantity < 0 THEN -m.quantity ELSE 0 END), 0) AS total_out,
           COALESCE(
             (SELECT CAST(SUM(m2.quantity * IFNULL(m2.unit_cost_minor, 0)) / SUM(m2.quantity) AS INTEGER)
                FROM inventory_movements m2
               WHERE m2.inventory_item_id = m.inventory_item_id
                 AND m2.quantity > 0
                 AND m2.unit_cost_minor IS NOT NULL),
             0
           ) AS average_cost_minor
         FROM inventory_movements m
        WHERE m.inventory_item_id = ?`,
      )
      .get(itemId) as InventoryStatsRow | undefined;
    return row ?? { total_in: 0, total_out: 0, average_cost_minor: 0 };
  }

  public findItemIdBySku(
    sku: string,
    businessId: number,
    excludeId: number | null,
    db: Db = getConnection(),
  ): number | null {
    const row = (
      excludeId === null
        ? db
            .prepare(
              `SELECT id FROM inventory_items
                WHERE sku = ? AND business_id = ? AND deleted_at IS NULL`,
            )
            .get(sku, businessId)
        : db
            .prepare(
              `SELECT id FROM inventory_items
                WHERE sku = ? AND business_id = ? AND id <> ? AND deleted_at IS NULL`,
            )
            .get(sku, businessId, excludeId)
    ) as { id: number } | undefined;
    return row?.id ?? null;
  }

  public findProductRef(productId: number, db: Db = getConnection()): InventoryProductRef | null {
    const row = db
      .prepare(
        `SELECT id, name, sku FROM products
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(productId) as InventoryProductRef | undefined;
    return row ?? null;
  }

  public findIngredientRef(
    ingredientId: number,
    db: Db = getConnection(),
  ): InventoryIngredientRef | null {
    const row = db
      .prepare(
        `SELECT id, name, unit FROM ingredients
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(ingredientId) as InventoryIngredientRef | undefined;
    return row ?? null;
  }

  public productExists(productId: number, businessId: number, db: Db = getConnection()): boolean {
    const row = db
      .prepare(
        `SELECT 1 AS present FROM products
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(productId, businessId) as { present: number } | undefined;
    return row !== undefined;
  }

  public ingredientExists(ingredientId: number, businessId: number, db: Db = getConnection()): boolean {
    const row = db
      .prepare(
        `SELECT 1 AS present FROM ingredients
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(ingredientId, businessId) as { present: number } | undefined;
    return row !== undefined;
  }

  public insertItem(record: NewInventoryItemRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO inventory_items (
             business_id, product_id, ingredient_id, name, sku, unit, current_stock,
             min_stock, max_stock, cost_minor, supplier, location_storage, is_tracked
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.productId,
          record.ingredientId,
          record.name,
          record.sku,
          record.unit,
          record.currentStock,
          record.minStock,
          record.maxStock,
          record.costMinor,
          record.supplier,
          record.locationStorage,
          record.isTracked ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // Los índices PARCIALES `ux_inventory_product` y `ux_inventory_ingredient`
      // garantizan un único ítem por producto y por insumo: un segundo intento
      // es 409, no un 500 (BR-INV-009).
      throw translateUniqueConstraint(error, {
        code: 'INVENTORY_ITEM_EXISTS',
        message: 'Ese producto o insumo ya tiene un ítem de inventario en este negocio',
        index: 'ux_inventory_product',
      });
    }
  }

  public updateItem(id: number, patch: InventoryItemPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.name !== undefined) push('name', patch.name);
    if (patch.sku !== undefined) push('sku', patch.sku);
    if (patch.unit !== undefined) push('unit', patch.unit);
    if (patch.minStock !== undefined) push('min_stock', patch.minStock);
    if (patch.maxStock !== undefined) push('max_stock', patch.maxStock);
    if (patch.costMinor !== undefined) push('cost_minor', patch.costMinor);
    if (patch.supplier !== undefined) push('supplier', patch.supplier);
    if (patch.locationStorage !== undefined) push('location_storage', patch.locationStorage);
    if (patch.isTracked !== undefined) push('is_tracked', patch.isTracked ? 1 : 0);

    if (assignments.length === 0) {
      return;
    }
    params.push(id);
    try {
      db.prepare(`UPDATE inventory_items SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'INVENTORY_SKU_TAKEN',
        message: 'Ya existe un ítem de inventario con ese SKU',
        field: 'sku',
      });
    }
  }

  public softDeleteItem(id: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare('UPDATE inventory_items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
      deletedAt,
      id,
    );
  }

  public setCurrentStock(id: number, currentStock: number, db: Db = getConnection()): void {
    db.prepare('UPDATE inventory_items SET current_stock = ? WHERE id = ?').run(currentStock, id);
  }

  public countMovementsSince(itemId: number, since: string, db: Db = getConnection()): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM inventory_movements
          WHERE inventory_item_id = ?
            AND created_at >= ?`,
      )
      .get(itemId, since) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  // ------------------------------------------------------------- movimientos
  public insertMovement(record: NewMovementRecord, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `INSERT INTO inventory_movements (
           business_id, inventory_item_id, movement_type, quantity, balance_after,
           unit_cost_minor, reference_type, reference_id, reason, performed_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.businessId,
        record.inventoryItemId,
        record.movementType,
        record.quantity,
        record.balanceAfter,
        record.unitCostMinor,
        record.referenceType,
        record.referenceId,
        record.reason,
        record.performedBy,
      );
    return Number(result.lastInsertRowid);
  }

  public findMovementById(id: number, db: Db = getConnection()): InventoryMovementJoinedRow | null {
    const row = db
      .prepare(
        `SELECT ${MOVEMENT_COLUMNS}
           FROM inventory_movements m
           JOIN inventory_items ii ON ii.id = m.inventory_item_id
          WHERE m.id = ?`,
      )
      .get(id) as InventoryMovementJoinedRow | undefined;
    return row ?? null;
  }

  public listMovements(
    filter: MovementListFilter,
    db: Db = getConnection(),
  ): readonly InventoryMovementJoinedRow[] {
    const where = buildMovementWhere(filter);
    const column = MOVEMENT_SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${MOVEMENT_COLUMNS}
           FROM inventory_movements m
           JOIN inventory_items ii ON ii.id = m.inventory_item_id
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, m.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as InventoryMovementJoinedRow[];
  }

  public countMovements(filter: MovementFilter, db: Db = getConnection()): number {
    const where = buildMovementWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM inventory_movements m WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public movementTotals(filter: MovementFilter, db: Db = getConnection()): MovementTotalsRow {
    const where = buildMovementWhere(filter);
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN m.quantity > 0 THEN m.quantity ELSE 0 END), 0) AS quantity_in,
           COALESCE(SUM(CASE WHEN m.quantity < 0 THEN -m.quantity ELSE 0 END), 0) AS quantity_out,
           COALESCE(SUM(CASE WHEN m.quantity > 0
                              THEN m.quantity * IFNULL(m.unit_cost_minor, 0) ELSE 0 END), 0) AS value_in_minor,
           COALESCE(SUM(CASE WHEN m.quantity < 0
                              THEN -m.quantity * IFNULL(m.unit_cost_minor, 0) ELSE 0 END), 0) AS value_out_minor
         FROM inventory_movements m
        WHERE ${where.sql}`,
      )
      .get(...where.params) as MovementTotalsRow | undefined;
    return row ?? { quantity_in: 0, quantity_out: 0, value_in_minor: 0, value_out_minor: 0 };
  }

  public listRecentMovements(
    itemId: number,
    limit: number,
    db: Db = getConnection(),
  ): readonly InventoryMovementJoinedRow[] {
    return db
      .prepare(
        `SELECT ${MOVEMENT_COLUMNS}
           FROM inventory_movements m
           JOIN inventory_items ii ON ii.id = m.inventory_item_id
          WHERE m.inventory_item_id = ?
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT ?`,
      )
      .all(itemId, limit) as InventoryMovementJoinedRow[];
  }

  public lastMovementAt(businessId: number, db: Db = getConnection()): string | null {
    const row = db
      .prepare(
        'SELECT MAX(created_at) AS value FROM inventory_movements WHERE business_id = ?',
      )
      .get(businessId) as { value: string | null } | undefined;
    return row?.value ?? null;
  }

  // ---------------------------------------------------------------- alertas
  public listAlerts(filter: StockAlertFilter, db: Db = getConnection()): readonly InventoryItemRow[] {
    const where = buildAlertWhere(filter);
    const column = ALERT_SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${ITEM_COLUMNS}
           FROM inventory_items ii
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, ii.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as InventoryItemRow[];
  }

  public countAlerts(
    filter: Omit<StockAlertFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildAlertWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM inventory_items ii WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public countAlertsBySeverity(
    filter: Omit<StockAlertFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): AlertSeverityCountsRow {
    const where = buildAlertWhere(filter);
    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN ii.current_stock < 0 THEN 1 ELSE 0 END), 0) AS negative_count,
           COALESCE(SUM(CASE WHEN ii.current_stock = 0 THEN 1 ELSE 0 END), 0) AS out_count,
           COALESCE(SUM(CASE WHEN ii.current_stock > 0 THEN 1 ELSE 0 END), 0) AS low_count
         FROM inventory_items ii
        WHERE ${where.sql}`,
      )
      .get(...where.params) as AlertSeverityCountsRow | undefined;
    return row ?? { negative_count: 0, out_count: 0, low_count: 0 };
  }

  // ------------------------------------------------------------ proveedores
  public listSuppliers(filter: SupplierFilter, db: Db = getConnection()): readonly SupplierAggregateRow[] {
    const clauses = [
      'ii.business_id = ?',
      'ii.deleted_at IS NULL',
      "ii.supplier IS NOT NULL",
      "ii.supplier <> ''",
    ];
    const params: unknown[] = [filter.businessId];
    if (filter.q !== undefined) {
      clauses.push("ii.supplier LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(filter.q)}%`);
    }
    const where = clauses.join(' AND ');

    return db
      .prepare(
        `SELECT ii.supplier AS name,
                COUNT(*) AS item_count,
                COALESCE(SUM(ii.current_stock), 0) AS total_stock,
                COALESCE(SUM(ii.current_stock * ii.cost_minor), 0) AS total_value_minor,
                COALESCE(SUM(CASE WHEN ii.is_tracked = 1
                                  AND ii.current_stock <= ${EFFECTIVE_THRESHOLD_SQL}
                                 THEN 1 ELSE 0 END), 0) AS low_stock_count
           FROM inventory_items ii
          WHERE ${where}
          GROUP BY ii.supplier
          ORDER BY name ASC
          LIMIT ? OFFSET ?`,
      )
      // El `?` de `EFFECTIVE_THRESHOLD_SQL` está en el SELECT, que en SQLite va
      // ANTES del WHERE: es el primer parámetro del TEXTO de la consulta, y
      // better-sqlite3 los empareja en ese orden.
      .all(filter.businessThreshold, ...params, filter.limit, filter.offset) as SupplierAggregateRow[];
  }

  public countSuppliers(
    filter: Omit<SupplierFilter, 'limit' | 'offset'>,
    db: Db = getConnection(),
  ): number {
    const clauses = [
      'ii.business_id = ?',
      'ii.deleted_at IS NULL',
      "ii.supplier IS NOT NULL",
      "ii.supplier <> ''",
    ];
    const params: unknown[] = [filter.businessId];
    if (filter.q !== undefined) {
      clauses.push("ii.supplier LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(filter.q)}%`);
    }
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM (SELECT ii.supplier FROM inventory_items ii WHERE ${clauses.join(' AND ')} GROUP BY ii.supplier)`,
      )
      .get(...params) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}
