/**
 * Contrato de persistencia del módulo `inventory`.
 *
 * Es una INTERFAZ (DESIGN.md 3.1, P3): el service nunca ve SQLite. El SQL vive
 * en `inventory.repository.sqlite.ts`.
 *
 * ============================ GARANTÍA CENTRAL ==============================
 * Los métodos de movimiento NO son "aplicar saldo" sueltos: cada uno actualiza
 * `current_stock` Y escribe la fila de `inventory_movements` con el
 * `balance_after` ya calculado, y ambos lo hace el service DENTRO de una única
 * `runInTransactionSync`. La tabla se declara INMUTABLE a propósito
 * (`0001_init.sql`): el saldo se corrige con un `ADJUSTMENT`, nunca editando el
 * histórico (BR-INV-001, BR-INV-005).
 *
 * ====================== LECTURAS DE OTRAS TABLAS ===========================
 * `findProductRef` y `findIngredientRef` comprueban que el origen del ítem
 * exista. Son lecturas de UNA fila sobre tablas de las que `inventory_items` ya
 * tiene clave foránea, y evitan que este módulo dependa del de catálogo: cada
 * módulo es dueño de sus datos y ambos son consistentes porque escriben en la
 * misma transacción de la misma base.
 */
import type { Db } from '../../shared/database/connection.js';
import type { InventoryReferenceType, MovementType } from '../../shared/domain/index.js';
import type {
  AlertSort,
  InventoryBusinessRow,
  InventoryIngredientRef,
  InventoryItemRow,
  InventoryItemSortColumn,
  InventoryMovementJoinedRow,
  InventoryProductRef,
  InventorySort,
  MovementFilter,
  MovementSort,
  MovementSortColumn,
  SupplierAggregateRow,
} from './inventory.types.js';

export type {
  AlertSort,
  InventoryItemSortColumn,
  InventorySort,
  MovementFilter,
  MovementSort,
  MovementSortColumn,
};

/** Filtros de `GET /api/v1/inventory/items`. */
export interface InventoryItemFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: InventorySort;
  /** `q`: busca por nombre o SKU. `LIKE` parametrizado y escapado. */
  readonly q?: string;
  readonly productId?: number;
  readonly ingredientId?: number;
  readonly supplier?: string;
  readonly locationStorage?: string;
  readonly isTracked?: boolean;
  /** `true` = sólo los que están en alerta; lo decide el service. */
  readonly isLowStock?: boolean;
  /** Umbral efectivo del negocio, para el filtro `isLowStock`. */
  readonly businessThreshold: number;
  readonly includeInactive?: boolean;
}

/** Filtros de `GET /api/v1/inventory/alerts`. */
export interface StockAlertFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: AlertSort;
  readonly businessThreshold: number;
  readonly supplier?: string;
  readonly locationStorage?: string;
  readonly includeNegative: boolean;
  /** `true` = sólo este estado de alerta. */
  readonly severity?: 'NEGATIVE' | 'OUT' | 'LOW';
}

/** Filtros de `GET /api/v1/inventory/suppliers`. */
export interface SupplierFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly q?: string;
  readonly businessThreshold: number;
}

/** Filtros de `GET /api/v1/inventory/movements` con paginación y orden. */
export interface MovementListFilter extends MovementFilter {
  readonly limit: number;
  readonly offset: number;
  readonly sort: MovementSort;
}

/** Datos insertados en `inventory_items`. */
export interface NewInventoryItemRecord {
  readonly businessId: number;
  readonly productId: number | null;
  readonly ingredientId: number | null;
  readonly name: string;
  readonly sku: string | null;
  readonly unit: string;
  readonly currentStock: number;
  readonly minStock: number;
  readonly maxStock: number;
  readonly costMinor: number;
  readonly supplier: string | null;
  readonly locationStorage: string | null;
  readonly isTracked: boolean;
}

/** Campos actualizables de `inventory_items`. `currentStock` NO está. */
export interface InventoryItemPatch {
  readonly name?: string;
  readonly sku?: string | null;
  readonly unit?: string;
  readonly minStock?: number;
  readonly maxStock?: number;
  readonly costMinor?: number;
  readonly supplier?: string | null;
  readonly locationStorage?: string | null;
  readonly isTracked?: boolean;
}

/** Datos insertados en `inventory_movements`. */
export interface NewMovementRecord {
  readonly businessId: number;
  readonly inventoryItemId: number;
  readonly movementType: MovementType;
  /** Con signo. Nunca 0 (CHECK `quantity != 0`). */
  readonly quantity: number;
  /** Saldo DESPUÉS de aplicar el movimiento, ya calculado por el service. */
  readonly balanceAfter: number;
  readonly unitCostMinor: number | null;
  readonly referenceType: InventoryReferenceType | null;
  readonly referenceId: number | null;
  readonly reason: string | null;
  readonly performedBy: number | null;
}

/** Totales agregados de `GET /inventory/items`. */
export interface InventoryTotalsRow {
  readonly items_tracked: number;
  readonly value_minor: number;
  readonly low_stock_count: number;
  readonly negative_stock_count: number;
}

/** Totales agregados de `GET /inventory/movements`. */
export interface MovementTotalsRow {
  readonly quantity_in: number;
  readonly quantity_out: number;
  readonly value_in_minor: number;
  readonly value_out_minor: number;
}

/** Estadísticas de un ítem: entradas, salidas y costo medio. */
export interface InventoryStatsRow {
  readonly total_in: number;
  readonly total_out: number;
  readonly average_cost_minor: number;
}

/** Recuento de movimientos recientes, para el borrado con `force`. */
export interface RecentMovementCountRow {
  readonly total: number;
}

/** Conteo de alertas por severidad, para `meta.countsBySeverity`. */
export interface AlertSeverityCountsRow {
  readonly negative_count: number;
  readonly out_count: number;
  readonly low_count: number;
}

/** Repositorio de inventario. */
export interface InventoryRepository {
  // --- Ajustes del negocio -------------------------------------------------
  /**
   * `allow_negative_stock` y `low_stock_alert_threshold` del negocio. `null` si
   * `businesses` está vacía: entonces el service opera con los valores por
   * defecto del contrato y lo deja registrado en el log.
   */
  findBusinessSettings(businessId: number, db?: Db): InventoryBusinessRow | null;

  // --- Ítems: lecturas -----------------------------------------------------
  listItems(filter: InventoryItemFilter, db?: Db): readonly InventoryItemRow[];
  countItems(filter: Omit<InventoryItemFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  findItemById(id: number, businessId: number, db?: Db): InventoryItemRow | null;
  totals(
    filter: Omit<InventoryItemFilter, 'limit' | 'offset' | 'sort'>,
    db?: Db,
  ): InventoryTotalsRow;
  stats(itemId: number, db?: Db): InventoryStatsRow;
  /** SKU ya usado por otro ítem del negocio, para el 409 `INVENTORY_SKU_TAKEN`. */
  findItemIdBySku(sku: string, businessId: number, excludeId: number | null, db?: Db): number | null;
  /** Producto ligado al ítem, o `null` si el ítem no viene de un producto. */
  findProductRef(productId: number, db?: Db): InventoryProductRef | null;
  /** Insumo ligado al ítem, o `null` si el ítem no viene de un insumo. */
  findIngredientRef(ingredientId: number, db?: Db): InventoryIngredientRef | null;
  /** `true` si el producto existe y no está borrado lógicamente. */
  productExists(productId: number, businessId: number, db?: Db): boolean;
  /** `true` si el insumo existe y no está borrado lógicamente. */
  ingredientExists(ingredientId: number, businessId: number, db?: Db): boolean;

  // --- Ítems: escrituras ---------------------------------------------------
  insertItem(record: NewInventoryItemRecord, db?: Db): number;
  updateItem(id: number, patch: InventoryItemPatch, db?: Db): void;
  softDeleteItem(id: number, deletedAt: string, db?: Db): void;
  /**
   * Fija `current_stock` a un valor absoluto. NUNCA se llama sin un movimiento
   * `ADJUSTMENT` que lo justifique: el service los escribe en la misma
   * transacción (BR-INV-001, BR-INV-005).
   */
  setCurrentStock(id: number, currentStock: number, db?: Db): void;
  /** Movimientos desde `since` (ISO). Para el 422 `ITEM_HAS_MOVEMENTS`. */
  countMovementsSince(itemId: number, since: string, db?: Db): number;

  // --- Movimientos ---------------------------------------------------------
  insertMovement(record: NewMovementRecord, db?: Db): number;
  findMovementById(id: number, db?: Db): InventoryMovementJoinedRow | null;
  listMovements(filter: MovementListFilter, db?: Db): readonly InventoryMovementJoinedRow[];
  countMovements(filter: MovementFilter, db?: Db): number;
  movementTotals(filter: MovementFilter, db?: Db): MovementTotalsRow;
  /** Últimos movimientos de un ítem (los 20 del detalle, API.md 7.15). */
  listRecentMovements(itemId: number, limit: number, db?: Db): readonly InventoryMovementJoinedRow[];
  /** Fecha del último movimiento del negocio, para `GET /inventory/suppliers`. */
  lastMovementAt(businessId: number, db?: Db): string | null;

  // --- Alertas y proveedores -----------------------------------------------
  listAlerts(filter: StockAlertFilter, db?: Db): readonly InventoryItemRow[];
  countAlerts(filter: Omit<StockAlertFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /**
   * Alertas por severidad sobre el FILTER COMPLETO, no sobre la página. El panel
   * de avisos necesita el desglose entero aunque se pida `pageSize = 10`.
   */
  countAlertsBySeverity(
    filter: Omit<StockAlertFilter, 'limit' | 'offset' | 'sort'>,
    db?: Db,
  ): AlertSeverityCountsRow;
  listSuppliers(filter: SupplierFilter, db?: Db): readonly SupplierAggregateRow[];
  countSuppliers(filter: Omit<SupplierFilter, 'limit' | 'offset'>, db?: Db): number;
}
