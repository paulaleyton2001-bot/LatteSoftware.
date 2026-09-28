/**
 * DTOs de dominio del módulo `inventory` (API.md 7.15).
 *
 * Tipos PUROS: sin `express`, sin `zod`, sin el driver de base de datos.
 *
 * ============================== CONVENCIONES ===============================
 *  - `currentStock`, `minStock`, `maxStock` y `quantity` son `number` y pueden
 *    ser FRACCIONALES (`0.5` kg de café): la tabla los declara `REAL` y así los
 *    respeta BR-MONEY-001, que sólo prohíbe `REAL` para importes.
 *  - `costMinor` y `unitCostMinor` son INTEGERS en centavos (BR-MONEY-001).
 *  - `balanceAfter` es el saldo ya actualizado: se escribe en la misma
 *    transacción que el `UPDATE` del saldo (BR-INV-010), así que por
 *    construcción nunca puede desincronizarse del histórico.
 */
import type { InventoryReferenceType, InventoryUnit, MovementType } from '../../shared/domain/index.js';

/** Crea un objeto frozen con clave igual a valor, y su tipo unión. */
function enumOf<const T extends readonly string[]>(values: T): Readonly<Record<T[number], T[number]>> {
  const result: Record<string, string> = {};
  for (const value of values) {
    result[value] = value;
  }
  return Object.freeze(result) as Readonly<Record<T[number], T[number]>>;
}

/**
 * Gravedad de una alerta de stock (API.md 7.15).
 *
 * Vive aquí y no en `shared/domain/enums.ts` porque no es un enum de la base de
 * datos (`inventory_movements.movement_type` no lo almacena): es una proyección
 * derivada del saldo y del umbral, que se calcula en cada lectura. Cuando se
 * incorpore a `GET /api/v1/meta/enums` habrá que subirlo al módulo de dominio
 * compartido.
 */
export const StockAlertSeverity = enumOf(['NEGATIVE', 'OUT', 'LOW'] as const);
export type StockAlertSeverity = (typeof StockAlertSeverity)[keyof typeof StockAlertSeverity];

/** Columnas ordenables de `GET /api/v1/inventory/items`. */
export type InventoryItemSortColumn = 'name' | 'current_stock' | 'updated_at' | 'cost_minor';

/** Columnas ordenables de `GET /api/v1/inventory/movements`. */
export type MovementSortColumn = 'created_at' | 'quantity';

/** Columnas ordenables de `GET /api/v1/inventory/alerts`. */
export type AlertSortColumn = 'current_stock' | 'name';

/** Orden ya validado por el middleware `validate`. */
export interface InventorySort {
  readonly column: InventoryItemSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

export interface MovementSort {
  readonly column: MovementSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

export interface AlertSort {
  readonly column: AlertSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

// --------------------------------------------------------------------------
// Filas de la base de datos
// --------------------------------------------------------------------------

/** Fila de `inventory_items`. */
export interface InventoryItemRow {
  readonly id: number;
  readonly business_id: number;
  readonly product_id: number | null;
  readonly ingredient_id: number | null;
  readonly name: string;
  readonly sku: string | null;
  readonly unit: string;
  readonly current_stock: number;
  readonly min_stock: number;
  readonly max_stock: number;
  readonly cost_minor: number;
  readonly supplier: string | null;
  readonly location_storage: string | null;
  readonly is_tracked: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

/** Fila de `inventory_movements`. */
export interface InventoryMovementRow {
  readonly id: number;
  readonly business_id: number;
  readonly inventory_item_id: number;
  readonly movement_type: string;
  readonly quantity: number;
  readonly balance_after: number;
  readonly unit_cost_minor: number | null;
  readonly reference_type: string | null;
  readonly reference_id: number | null;
  readonly reason: string | null;
  readonly performed_by: number | null;
  readonly created_at: string | null;
}

/** Fila de `inventory_movements` unida al nombre y la unidad del ítem. */
export type InventoryMovementJoinedRow = InventoryMovementRow & {
  readonly inventory_item_name: string;
  readonly unit: string;
};

/** Fila de `businesses` con los dos ajustes que decide el inventario. */
export interface InventoryBusinessSettingsRow {
  readonly id: number;
  readonly allow_negative_stock: 0 | 1;
  readonly low_stock_alert_threshold: number;
}

/** Referencia mínima a un producto ligado a un ítem de inventario. */
export interface InventoryProductRef {
  readonly id: number;
  readonly name: string;
  readonly sku: string | null;
}

/** Referencia mínima a un insumo ligado a un ítem de inventario. */
export interface InventoryIngredientRef {
  readonly id: number;
  readonly name: string;
  readonly unit: string;
}

// --------------------------------------------------------------------------
// Vistas de la API
// --------------------------------------------------------------------------

/** `InventoryItem` de API.md 6.3, con los derivados calculados. */
export interface InventoryItemView {
  readonly id: number;
  readonly productId: number | null;
  readonly ingredientId: number | null;
  readonly name: string;
  readonly sku: string | null;
  readonly unit: InventoryUnit;
  readonly currentStock: number;
  readonly minStock: number;
  readonly maxStock: number;
  readonly costMinor: number;
  readonly supplier: string | null;
  readonly locationStorage: string | null;
  readonly isTracked: boolean;
  /** `current_stock <= lowStockThreshold` con el ítem SEGUIDO (BR-INV-006). */
  readonly isLowStock: boolean;
  /** Umbral EFECTIVO: `min_stock`, o el del negocio si `min_stock = 0`. */
  readonly lowStockThreshold: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `GET /inventory/items/:id`: el ítem con su origen y sus últimos movimientos. */
export interface InventoryItemDetailView extends InventoryItemView {
  readonly product: InventoryProductRef | null;
  readonly ingredient: InventoryIngredientRef | null;
  readonly recentMovements: readonly InventoryMovementView[];
  readonly stats: InventoryItemStats;
}

/** Estadísticas agregadas de un ítem. */
export interface InventoryItemStats {
  /** Suma de las cantidades POSITIVAS de todos los movimientos. */
  readonly totalIn: number;
  /** Suma de las cantidades NEGATIVAS, en valor absoluto. */
  readonly totalOut: number;
  /** Costo medio ponderado de las entradas, en centavos. */
  readonly averageCostMinor: number;
}

/** `InventoryMovement` de API.md 6.3. */
export interface InventoryMovementView {
  readonly id: number;
  readonly inventoryItemId: number;
  readonly inventoryItemName: string;
  readonly unit: InventoryUnit;
  readonly movementType: MovementType;
  /** Con signo: positivo suma, negativo resta. */
  readonly quantity: number;
  /** Saldo DESPUÉS de aplicar este movimiento (BR-INV-010). */
  readonly balanceAfter: number;
  readonly unitCostMinor: number | null;
  readonly referenceType: InventoryReferenceType | null;
  readonly referenceId: number | null;
  readonly reason: string | null;
  readonly performedBy: number | null;
  readonly createdAt: string;
}

/** `GET /inventory/alerts`: un ítem por debajo del umbral. */
export interface StockAlertView {
  readonly itemId: number;
  readonly name: string;
  readonly sku: string | null;
  readonly unit: InventoryUnit;
  readonly currentStock: number;
  readonly minStock: number;
  readonly lowStockThreshold: number;
  /** Cuánto falta para llegar al umbral. Nunca negativo. */
  readonly deficitQuantity: number;
  readonly supplier: string | null;
  readonly locationStorage: string | null;
  readonly severity: StockAlertSeverity;
  readonly isTracked: boolean;
  readonly updatedAt: string;
}

/** `GET /inventory/suppliers`: un proveedor con su agregación. */
export interface SupplierSummaryView {
  readonly name: string;
  readonly itemCount: number;
  readonly totalStock: number;
  /** Valor del inventario a coste, en centavos. */
  readonly totalValueMinor: number;
  readonly lowStockCount: number;
  readonly lastMovementAt: string | null;
}

/** Totales de `meta` en `GET /inventory/items`. */
export interface InventoryTotals {
  readonly itemsTracked: number;
  readonly valueMinor: number;
  readonly lowStockCount: number;
  readonly negativeStockCount: number;
}

/** Totales de `meta` en `GET /inventory/movements`. */
export interface MovementTotals {
  readonly quantityIn: number;
  readonly quantityOut: number;
  readonly netQuantity: number;
  readonly valueInMinor: number;
  readonly valueOutMinor: number;
}

/** Resultado de `POST /inventory/movements` (API.md 7.15). */
export interface MovementResult {
  readonly item: InventoryItemView;
  readonly movement: InventoryMovementView;
}

/**
 * Resultado de `POST /inventory/items/:id/adjust`. Además del movimiento expone
 * si el ítem ha quedado en alerta, para que la UI pueda avisar sin una segunda
 * llamada a `GET /inventory/alerts`.
 */
export interface AdjustmentResult extends MovementResult {
  readonly isLowStock: boolean;
}

/** Fila agrupada por proveedor, tal y como la devuelve el repositorio. */
export interface SupplierAggregateRow {
  readonly name: string;
  readonly item_count: number;
  readonly total_stock: number;
  readonly total_value_minor: number;
  readonly low_stock_count: number;
}

/** Fila de `businesses` para los agregados del módulo. */
export type InventoryBusinessRow = InventoryBusinessSettingsRow;

/** Detalle de un movimiento filtrado por tipo. */
export interface MovementFilter {
  readonly businessId: number;
  readonly itemId?: number;
  readonly type?: MovementType;
  readonly referenceType?: InventoryReferenceType;
  readonly referenceId?: number;
  readonly performedBy?: number;
  readonly from?: string;
  readonly to?: string;
}
