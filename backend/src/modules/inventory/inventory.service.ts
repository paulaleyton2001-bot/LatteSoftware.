/**
 * Servicio de inventario: casos de uso de `/api/v1/inventory/*` (API.md 7.15).
 *
 * ============================== LA REGLA CENTRAL ============================
 * **Todo cambio de saldo es un movimiento, y ambos van en la MISMA
 * transacción.** No existe ningún camino de código que escriba `current_stock`
 * sin insertar antes el `inventory_movements` que lo justifica
 * (BR-INV-001, BR-INV-005, BR-INV-010). Para que eso sea verdad por
 * construcción y no por disciplina:
 *
 *  1. `setCurrentStock` del repositorio NO es público para los casos de uso: sólo
 *     lo llama {@link InventoryService.applyMovement}, que es el único que
 *     inserta la fila del movimiento, y siempre antes.
 *  2. `balance_after` lo calcula este service a partir del saldo que acaba de
 *     leer DENTRO de la transacción, no con un `SELECT` posterior: si otro
 *     escritor se intercalara, el histórico mentiría.
 *  3. El orden dentro de la transacción es: leer saldo -> validar -> escribir
 *     movimiento -> actualizar saldo. Si el `UPDATE` fallara, el `throw` revierte
 *     el movimiento; nunca queda un movimiento sin saldo que lo respalde.
 *
 * ========================== OTRAS REGLAS QUE APLICA =========================
 *  - **BR-INV-002**: `current_stock < 0` es `422 NEGATIVE_STOCK_BLOCKED` salvo
 *    que `businesses.allow_negative_stock = 1`.
 *  - **BR-INV-007**: un movimiento manual sobre un ítem con `is_tracked = 0` es
 *    `422 ITEM_NOT_TRACKED`: un producto que no descuenta stock no admite
 *    movimientos manuales que sí lomodifyarían.
 *  - **Signo por tipo**: `PURCHASE` suma, `WASTE`/`SALE`/`RETURN` restan,
 *    `RELEASE` suma (BR-INV-004) y `ADJUSTMENT` admite ambos sentidos. Un signo
 *    incorrecto es `422 MOVEMENT_SIGN_INVALID`: escribir un `WASTE` de +3
 *    significaría tirar café y reponerlo a la vez.
 *  - **BR-INV-006**: la alerta es `current_stock <= umbral efectivo`, donde el
 *    umbral es `min_stock` o, si es 0, el del negocio. La severidad se ordena de
 *    la más grave: `NEGATIVE` (< 0), `OUT` (= 0), `LOW` (0 < x <= umbral).
 *  - `is_tracked = 0` significa que el producto NO descuenta stock: no genera
 *    alertas ni admite movimientos.
 *  - **BR-SEC-007**: todo cambio de stock deja fila en `audit_logs`.
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import {
  AuditAction,
  AuditEntityType,
  InventoryReferenceType,
  MovementType,
  type UserContext,
} from '../../shared/domain/index.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import type {
  InventoryItemFilter,
  InventoryItemPatch,
  InventoryRepository,
  MovementListFilter,
  NewInventoryItemRecord,
  NewMovementRecord,
  StockAlertFilter,
  SupplierFilter,
} from './inventory.repository.js';
import type {
  AdjustmentResult,
  InventoryItemDetailView,
  InventoryItemRow,
  InventoryItemStats,
  InventoryItemView,
  InventoryMovementJoinedRow,
  InventoryMovementView,
  InventoryTotals,
  MovementResult,
  MovementTotals,
  StockAlertSeverity,
  StockAlertView,
  SupplierSummaryView,
} from './inventory.types.js';
import { StockAlertSeverity as Severity } from './inventory.types.js';

/**
 * Umbral de stock bajo por defecto si `businesses` no estuviera sembrada.
 * Coincide con el DEFAULT de la tabla (`low_stock_alert_threshold = 5`).
 */
const FALLBACK_LOW_STOCK_THRESHOLD = 5;

/** Movimientos que genera el flujo de pedidos y NO admits alta manual. */
const ORDER_DRIVEN_MOVEMENTS: readonly MovementType[] = Object.freeze([
  MovementType.SALE,
  MovementType.RESERVATION,
  MovementType.RELEASE,
]);

/**
 * Signo que admite cada tipo de movimiento.
 *
 * `null` = ambos sentidos (sólo `ADJUSTMENT`: es el movimiento de corrección y
 * por definición puede subir o bajar). El resto tiene un sentido único, y
 * respetarlo evita que un `WASTE` con cantidad positiva aumente el stock.
 */
type MovementSign = 'POSITIVE' | 'NEGATIVE' | 'BOTH';

const MOVEMENT_SIGN: ReadonlyMap<MovementType, MovementSign> = new Map<MovementType, MovementSign>([
  [MovementType.PURCHASE, 'POSITIVE'],
  [MovementType.SALE, 'NEGATIVE'],
  [MovementType.ADJUSTMENT, 'BOTH'],
  [MovementType.WASTE, 'NEGATIVE'],
  [MovementType.RETURN, 'NEGATIVE'],
  [MovementType.RESERVATION, 'NEGATIVE'],
  [MovementType.RELEASE, 'POSITIVE'],
]);

/** Movimientos que exigen `reason` (CHECK `ck_inventory_movements_reason`). */
/** Tipos que SÍ admite un alta manual. */
const MANUAL_MOVEMENT_TYPES: readonly MovementType[] = Object.freeze([
  MovementType.PURCHASE,
  MovementType.ADJUSTMENT,
  MovementType.WASTE,
  MovementType.RETURN,
]);

/** Tipos que exigen `reason` (CHECK `ck_inventory_movements_reason`). */
const REASON_REQUIRED_MOVEMENTS: readonly MovementType[] = Object.freeze([
  MovementType.WASTE,
  MovementType.ADJUSTMENT,
]);

/** Movimientos recientes que bloquean una baja sin `force` (API.md 7.15). */
const RECENT_MOVEMENTS_WINDOW_DAYS = 30;

/** Movimientos recientes que devuelve el detalle de un ítem (API.md 7.15). */
const RECENT_MOVEMENTS_LIMIT = 20;

/** Motivo del movimiento de apertura que genera el alta de un ítem. */
const INITIAL_STOCK_REASON = 'INITIAL';

/** Contexto de petición para auditoría y negocio. */
export interface InventoryRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Entradas de los casos de uso. */
export interface CreateInventoryItemInput {
  readonly productId?: number | null;
  readonly ingredientId?: number | null;
  readonly name: string;
  readonly sku?: string | null;
  readonly unit: string;
  readonly currentStock: number;
  readonly minStock?: number;
  readonly maxStock: number;
  readonly costMinor: number;
  readonly supplier?: string | null;
  readonly locationStorage?: string | null;
  readonly isTracked: boolean;
}

export interface UpdateInventoryItemInput {
  readonly currentStock?: number;
  readonly productId?: number;
  readonly ingredientId?: number;
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

export interface CreateMovementInput {
  readonly inventoryItemId: number;
  readonly movementType: MovementType;
  readonly quantity: number;
  readonly unitCostMinor?: number | null;
  readonly referenceType?: InventoryReferenceType | null;
  readonly referenceId?: number | null;
  readonly reason?: string | null;
}

export interface AdjustItemInput {
  readonly newQuantity?: number;
  readonly deltaQuantity?: number;
  readonly reason: string;
  readonly unitCostMinor?: number | null;
  readonly referenceType: InventoryReferenceType;
  readonly referenceId?: number | null;
}

/** Página de ítems con sus totales de `meta`. */
export interface InventoryPage {
  readonly items: readonly InventoryItemView[];
  readonly total: number;
  readonly totals: InventoryTotals;
}

/** Página de movimientos con sus totales de `meta`. */
export interface MovementPage {
  readonly items: readonly InventoryMovementView[];
  readonly total: number;
  readonly totals: MovementTotals;
}

/** Página de alertas con el conteo por severidad de `meta`. */
export interface AlertPage {
  readonly items: readonly StockAlertView[];
  readonly total: number;
  readonly countsBySeverity: Readonly<Record<StockAlertSeverity, number>>;
}

/** Ajustes del negocio que condicionan el movimiento. */
interface BusinessRules {
  readonly allowNegativeStock: boolean;
  readonly lowStockThreshold: number;
}

/** Servicio de inventario. */
export class InventoryService {
  public constructor(
    private readonly repository: InventoryRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /** `GET /api/v1/inventory/items` — listado con `isLowStock` calculado. */
  public listItems(
    filter: Omit<InventoryItemFilter, 'businessId' | 'businessThreshold'>,
    context: InventoryRequestContext,
  ): InventoryPage {
    const businessId = context.actor.businessId;
    const rules = this.rulesOf(businessId);
    const safeFilter: InventoryItemFilter = {
      ...filter,
      businessId,
      businessThreshold: rules.lowStockThreshold,
      includeInactive: filter.includeInactive === true,
    };
    const rows = this.repository.listItems(safeFilter);
    return {
      items: rows.map((row) => this.toItemView(row, rules)),
      total: this.repository.countItems(safeFilter),
      totals: this.toTotals(this.repository.totals(safeFilter)),
    };
  }

  /** `GET /api/v1/inventory/items/:id` — el ítem con origen, movimientos y stats. */
  public getItem(id: number, context: InventoryRequestContext): InventoryItemDetailView {
    const businessId = context.actor.businessId;
    const rules = this.rulesOf(businessId);
    const row = this.requireItem(id, businessId);
    return {
      ...this.toItemView(row, rules),
      product: row.product_id === null ? null : this.repository.findProductRef(row.product_id),
      ingredient:
        row.ingredient_id === null ? null : this.repository.findIngredientRef(row.ingredient_id),
      recentMovements: this.repository
        .listRecentMovements(id, RECENT_MOVEMENTS_LIMIT)
        .map((movement) => this.toMovementView(movement)),
      stats: this.toStats(this.repository.stats(id)),
    };
  }

  /**
   * `GET /api/v1/inventory/movements` — histórico con rango por defecto de 30
   * días y los totales de entrada y salida.
   */
  public listMovements(
    filter: Omit<MovementListFilter, 'businessId'>,
    context: InventoryRequestContext,
  ): MovementPage {
    const businessId = context.actor.businessId;
    const range = this.resolveRange(filter.from, filter.to);
    const safeFilter: MovementListFilter = {
      ...filter,
      businessId,
      from: range.from,
      to: range.to,
    };
    const rows = this.repository.listMovements(safeFilter);
    const aggregate = this.repository.movementTotals(safeFilter);
    return {
      items: rows.map((row) => this.toMovementView(row)),
      total: this.repository.countMovements(safeFilter),
      totals: {
        quantityIn: aggregate.quantity_in,
        quantityOut: aggregate.quantity_out,
        netQuantity: aggregate.quantity_in - aggregate.quantity_out,
        valueInMinor: aggregate.value_in_minor,
        valueOutMinor: aggregate.value_out_minor,
      },
    };
  }

  /**
   * `GET /api/v1/inventory/alerts` — ítems por debajo del umbral (BR-INV-006).
   *
   * El filtro SQL ya restringe a `is_tracked = 1` y `current_stock <= umbral`;
   * aquí sólo se proyecta la vista con `severity` y `deficitQuantity`.
   */
  public listAlerts(
    filter: Omit<StockAlertFilter, 'businessId' | 'businessThreshold'>,
    context: InventoryRequestContext,
  ): AlertPage {
    const businessId = context.actor.businessId;
    const rules = this.rulesOf(businessId);
    const safeFilter: StockAlertFilter = {
      ...filter,
      businessId,
      businessThreshold: rules.lowStockThreshold,
      includeNegative: filter.includeNegative !== false,
    };
    const rows = this.repository.listAlerts(safeFilter);
    const counts = this.repository.countAlertsBySeverity(safeFilter);
    return {
      items: rows.map((row) => this.toAlertView(row, rules)),
      total: this.repository.countAlerts(safeFilter),
      // El desglose se cuenta sobre TODAS las alertas del filtro, no sólo sobre
      // la página devuelta: un `total: 40` con `countsBySeverity.LOW: 3` sería un
      // `meta` inútil para el panel de avisos.
      countsBySeverity: {
        NEGATIVE: counts.negative_count,
        OUT: counts.out_count,
        LOW: counts.low_count,
      },
    };
  }

  /** `GET /api/v1/inventory/suppliers` — agrupación por proveedor. */
  public listSuppliers(
    filter: Omit<SupplierFilter, 'businessId' | 'businessThreshold'>,
    context: InventoryRequestContext,
  ): { readonly items: readonly SupplierSummaryView[]; readonly total: number } {
    const businessId = context.actor.businessId;
    const rules = this.rulesOf(businessId);
    const safeFilter: SupplierFilter = { ...filter, businessId, businessThreshold: rules.lowStockThreshold };
    const lastMovement = this.repository.lastMovementAt(businessId);
    return {
      items: this.repository.listSuppliers(safeFilter).map((row) => ({
        name: row.name,
        itemCount: row.item_count,
        totalStock: row.total_stock,
        totalValueMinor: row.total_value_minor,
        lowStockCount: row.low_stock_count,
        lastMovementAt: lastMovement,
      })),
      total: this.repository.countSuppliers(safeFilter),
    };
  }

  // ==========================================================================
  // Escrituras: ítems
  // ==========================================================================

  /**
   * `POST /api/v1/inventory/items` — alta.
   *
   * El `currentStock` inicial NO es un `UPDATE` silencioso: genera un movimiento
   * `ADJUSTMENT` con `reason: 'INITIAL'`, que es exactamente lo que exige
   * API.md 7.15 y lo que BR-INV-001 impone. El `meta.initialMovementId` permite
   * al cliente mostrarlo o corregirlo después.
   */
  public createItem(
    input: CreateInventoryItemInput,
    context: InventoryRequestContext,
  ): { readonly item: InventoryItemView; readonly initialMovementId: number | null } {
    const businessId = context.actor.businessId;
    const rules = this.rulesOf(businessId);
    const { productId, ingredientId } = this.resolveSource(input, businessId);
    this.assertSkuAvailable(input.sku ?? null, businessId, null);
    // Un alta con existencias negativas tiene el mismo tratamiento que un
    // movimiento negativo: misma regla, mismo 422.
    if (input.currentStock < 0 && !rules.allowNegativeStock) {
      throw this.negativeStockError(0, input.currentStock, businessId);
    }

    return runInTransactionSync(() => {
      const record: NewInventoryItemRecord = {
        businessId,
        productId,
        ingredientId,
        name: input.name,
        sku: input.sku ?? null,
        unit: input.unit,
        currentStock: 0,
        // Sin `minStock` explícito se usa el umbral del negocio: es lo que espera
        // quien crea un ítem y no piensa en alertas.
        minStock: input.minStock ?? rules.lowStockThreshold,
        maxStock: input.maxStock,
        costMinor: input.costMinor,
        supplier: input.supplier ?? null,
        locationStorage: input.locationStorage ?? null,
        isTracked: input.isTracked,
      };
      const id = this.repository.insertItem(record);

      let initialMovementId: number | null = null;
      if (input.currentStock !== 0) {
        // El ítem nace en 0 y la cantidad inicial se mueve: así el histórico
        // empieza con un movimiento explicable, no con un saldo que nadie escribió.
        const written = this.writeMovement({
          businessId,
          itemId: id,
          movementType: MovementType.ADJUSTMENT,
          quantity: input.currentStock,
          unitCostMinor: input.costMinor > 0 ? input.costMinor : null,
          referenceType: InventoryReferenceType.MANUAL,
          referenceId: null,
          reason: INITIAL_STOCK_REASON,
          performedBy: context.actor.id,
        });
        initialMovementId = written.id;
      }

      const after = this.requireItem(id, businessId);
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.inventory_item,
        entityId: id,
        actor: context.actor,
        request: context.request,
        afterData: {
          resource: 'inventory_item',
          ...this.itemAuditFields(after),
          initialStock: input.currentStock,
          initialMovementId,
        },
      });
      return { item: this.toItemView(after, rules), initialMovementId };
    });
  }

  /**
   * `PATCH /api/v1/inventory/items/:id` — edición de la ficha.
   *
   * `currentStock`, `productId` e `ingredientId` son `422 FIELD_NOT_EDITABLE`:
   * el saldo sólo se cambia con un movimiento (BR-INV-005) y el origen del ítem
   * es inmutable porque los índices parciales lo usan como identidad.
   */
  public updateItem(
    id: number,
    input: UpdateInventoryItemInput,
    context: InventoryRequestContext,
  ): InventoryItemView {
    const businessId = context.actor.businessId;
    const rules = this.rulesOf(businessId);

    for (const field of ['currentStock', 'productId', 'ingredientId'] as const) {
      if (input[field] !== undefined) {
        throw new BusinessRuleError(`El campo "${field}" no se puede editar`, {
          details: {
            code: 'FIELD_NOT_EDITABLE',
            field,
            hint:
              field === 'currentStock'
                ? 'Use POST /api/v1/inventory/items/:id/adjust para cambiar el saldo'
                : 'El origen del ítem de inventario es inmutable',
          },
        });
      }
    }
    this.assertSkuAvailable(input.sku ?? null, businessId, id);

    return runInTransactionSync(() => {
      const before = this.requireItem(id, businessId);
      const patch: InventoryItemPatch = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.sku === undefined ? {} : { sku: input.sku }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.minStock === undefined ? {} : { minStock: input.minStock }),
        ...(input.maxStock === undefined ? {} : { maxStock: input.maxStock }),
        ...(input.costMinor === undefined ? {} : { costMinor: input.costMinor }),
        ...(input.supplier === undefined ? {} : { supplier: input.supplier }),
        ...(input.locationStorage === undefined ? {} : { locationStorage: input.locationStorage }),
        ...(input.isTracked === undefined ? {} : { isTracked: input.isTracked }),
      };
      this.repository.updateItem(id, patch);
      const after = this.requireItem(id, businessId);

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.inventory_item,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'inventory_item', ...this.itemAuditFields(before) },
        afterData: { resource: 'inventory_item', ...this.itemAuditFields(after) },
      });
      return this.toItemView(after, rules);
    });
  }

  /**
   * `DELETE /api/v1/inventory/items/:id` — baja lógica.
   *
   * Los movimientos NO se borran: el histórico se conserva íntegro y sigue
   * apuntando al ítem (API.md 7.15). Si hubo movimientos en los últimos 30 días
   * hace falta `force = true`, porque dar de baja un ítem que se movió hace una
   * semana deja el histórico sin解释 su por qué.
   */
  public removeItem(
    id: number,
    input: { readonly reason: string; readonly force: boolean },
    context: InventoryRequestContext,
  ): { readonly id: number; readonly deletedAt: string; readonly reason: string } {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      const before = this.requireItem(id, businessId);
      const since = new Date(
        Date.now() - RECENT_MOVEMENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      ).toISOString();
      const recent = this.repository.countMovementsSince(id, since);
      if (recent > 0 && input.force !== true) {
        throw new BusinessRuleError(
          `El ítem tiene ${recent} movimiento(s) en los últimos ${RECENT_MOVEMENTS_WINDOW_DAYS} días`,
          {
            details: {
              code: 'ITEM_HAS_MOVEMENTS',
              id,
              recentMovements: recent,
              windowDays: RECENT_MOVEMENTS_WINDOW_DAYS,
              hint: 'Repita la petición con force = true si la baja es intencionada',
            },
          },
        );
      }

      const deletedAt = nowIso();
      this.repository.softDeleteItem(id, deletedAt);
      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.inventory_item,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'inventory_item', ...this.itemAuditFields(before) },
        afterData: { resource: 'inventory_item', id, deletedAt, reason: input.reason, recentMovements: recent },
      });
      return { id, deletedAt, reason: input.reason };
    });
  }

  /**
   * `POST /api/v1/inventory/items/:id/adjust` — corrección de saldo.
   *
   * Exactamente uno de `newQuantity` (saldo absoluto) o `deltaQuantity`
   * (variación). El resultado es SIEMPRE un movimiento `ADJUSTMENT` con
   * `reference_type = MANUAL` y `reason` obligatorio (BR-INV-005), nunca un
   * `UPDATE` de la fila.
   */
  public adjustItem(
    id: number,
    input: AdjustItemInput,
    context: InventoryRequestContext,
  ): AdjustmentResult {
    const businessId = context.actor.businessId;
    const rules = this.rulesOf(businessId);
    const hasNew = input.newQuantity !== undefined;
    const hasDelta = input.deltaQuantity !== undefined;
    if (hasNew === hasDelta) {
      throw new ValidationError('Indique el saldo final o la variación, pero no las dos', {
        details: [
          {
            path: hasNew ? 'newQuantity' : 'deltaQuantity',
            message: 'Envíe exactamente uno de newQuantity o deltaQuantity',
            code: 'INVALID_ADJUSTMENT',
          },
        ],
      });
    }

    return runInTransactionSync(() => {
      const before = this.requireItem(id, businessId);
      this.assertTracked(before);
      const quantity = hasNew ? (input.newQuantity as number) - before.current_stock : (input.deltaQuantity as number);
      if (quantity === 0) {
        throw new ValidationError('El ajuste no cambia el saldo', {
          details: [{ path: 'deltaQuantity', message: 'La variación no puede ser cero', code: 'INVALID_ADJUSTMENT' }],
        });
      }

      const written = this.writeMovement({
        businessId,
        itemId: id,
        movementType: MovementType.ADJUSTMENT,
        quantity,
        unitCostMinor: input.unitCostMinor ?? null,
        referenceType: input.referenceType,
        referenceId: input.referenceId ?? null,
        reason: input.reason,
        performedBy: context.actor.id,
      });
      const movement = this.requireMovement(written.id);

      const after = this.requireItem(id, businessId);
      const view = this.toItemView(after, rules);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.inventory_item,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: {
          resource: 'inventory_item',
          currentStock: before.current_stock,
          movementId: written.id,
        },
        afterData: {
          resource: 'inventory_movement',
          movementId: written.id,
          movementType: MovementType.ADJUSTMENT,
          quantity,
          balanceAfter: after.current_stock,
          reason: input.reason,
        },
      });
      return { item: view, movement: this.toMovementView(movement), isLowStock: view.isLowStock };
    });
  }

  // ==========================================================================
  // Escrituras: movimientos
  // ==========================================================================

  /**
   * `POST /api/v1/inventory/movements` — alta manual de movimiento.
   *
   * Rechazos, todos `422` (API.md 7.15):
   *  - `MOVEMENT_TYPE_NOT_MANUAL`: `SALE`, `RESERVATION` y `RELEASE` los genera
   *    el flujo de pedidos; admitirlos a mano rompería la secuencia
   *    `RESERVATION -> (SALE | RELEASE)` de BR-INV-004.
   *  - `ITEM_NOT_TRACKED`: BR-INV-007.
   *  - `REASON_REQUIRED`: `WASTE` y `ADJUSTMENT` (CHECK de la tabla).
   *  - `MOVEMENT_SIGN_INVALID`: el signo no corresponde al tipo.
   *  - `NEGATIVE_STOCK_BLOCKED`: BR-INV-002.
   */
  public createMovement(input: CreateMovementInput, context: InventoryRequestContext): MovementResult {
    const businessId = context.actor.businessId;
    const rules = this.rulesOf(businessId);
    this.assertManualType(input.movementType);
    this.assertMovementSign(input.movementType, input.quantity);
    if (REASON_REQUIRED_MOVEMENTS.includes(input.movementType) && (input.reason ?? '') === '') {
      throw new BusinessRuleError('Este tipo de movimiento exige un motivo', {
        details: {
          code: 'REASON_REQUIRED',
          field: 'reason',
          movementType: input.movementType,
        },
      });
    }

    return runInTransactionSync(() => {
      const before = this.requireItem(input.inventoryItemId, businessId);
      this.assertTracked(before);
      const written = this.writeMovement({
        businessId,
        itemId: before.id,
        movementType: input.movementType,
        quantity: input.quantity,
        unitCostMinor: input.unitCostMinor ?? null,
        referenceType: input.referenceType ?? InventoryReferenceType.MANUAL,
        referenceId: input.referenceId ?? null,
        reason: input.reason ?? null,
        performedBy: context.actor.id,
      });
      const movement = this.requireMovement(written.id);

      const after = this.requireItem(before.id, businessId);
      const view = this.toItemView(after, rules);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.inventory_item,
        entityId: before.id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'inventory_item', currentStock: before.current_stock },
        afterData: {
          resource: 'inventory_movement',
          movementId: written.id,
          movementType: input.movementType,
          quantity: input.quantity,
          balanceAfter: after.current_stock,
          reason: input.reason ?? null,
        },
      });
      return { item: view, movement: this.toMovementView(movement) };
    });
  }

  // ==========================================================================
  // Núcleo: el único camino que mueve saldo
  // ==========================================================================

  /**
   * Escribe el movimiento y actualiza el saldo, en la transacción abierta.
   *
   * Es el ÚNICO método del service que llama a `setCurrentStock`, y por diseño
   * es `private`: nadie más del módulo puede dejar el saldo sin su movimiento.
   * El orden es movimiento -> saldo; si el segundo falla, el `throw` revierte
   * el primero (BR-INV-010).
   */
  private writeMovement(params: {
    readonly businessId: number;
    readonly itemId: number;
    readonly movementType: MovementType;
    readonly quantity: number;
    readonly unitCostMinor: number | null;
    readonly referenceType: InventoryReferenceType | null;
    readonly referenceId: number | null;
    readonly reason: string | null;
    readonly performedBy: number | null;
  }): { readonly id: number; readonly balanceAfter: number } {
    const current = this.repository.findItemById(params.itemId, params.businessId);
    if (current === null) {
      throw new NotFoundError('El ítem de inventario no existe', {
        details: { id: params.itemId, type: 'inventory_item' },
      });
    }
    if (current.is_tracked === 0) {
      throw new BusinessRuleError('El ítem no tiene seguimiento de stock', {
        details: {
          code: 'ITEM_NOT_TRACKED',
          ruleId: 'BR-INV-007',
          id: current.id,
          hint: 'Un producto con is_tracked = 0 no genera movimientos',
        },
      });
    }

    const balanceAfter = roundStock(current.current_stock + params.quantity);
    this.assertNotNegative(balanceAfter, current.current_stock, params.businessId);

    const record: NewMovementRecord = {
      businessId: params.businessId,
      inventoryItemId: params.itemId,
      movementType: params.movementType,
      quantity: params.quantity,
      balanceAfter,
      unitCostMinor: params.unitCostMinor,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      reason: params.reason,
      performedBy: params.performedBy,
    };
    const id = this.repository.insertMovement(record);
    this.repository.setCurrentStock(params.itemId, balanceAfter);
    return { id, balanceAfter };
  }

  // ==========================================================================
  // Auxiliares: validación
  // ==========================================================================

  /** Ajustes del negocio, con valores por defecto si `businesses` no existe. */
  private rulesOf(businessId: number): BusinessRules {
    const row = this.repository.findBusinessSettings(businessId);
    if (row === null) {
      logger.warn(
        { businessId },
        'inventario: el negocio no está sembrado; se usan los valores por defecto de la tabla',
      );
      return { allowNegativeStock: false, lowStockThreshold: FALLBACK_LOW_STOCK_THRESHOLD };
    }
    return {
      allowNegativeStock: row.allow_negative_stock === 1,
      lowStockThreshold: row.low_stock_alert_threshold,
    };
  }

  /** Movimiento obligatorio, ya unido al nombre y la unidad de su ítem. */
  private requireMovement(id: number): InventoryMovementJoinedRow {
    const row = this.repository.findMovementById(id);
    if (row === null) {
      throw new NotFoundError('El movimiento de inventario no existe', {
        details: { id, type: 'inventory_movement' },
      });
    }
    return row;
  }

  private requireItem(id: number, businessId: number): InventoryItemRow {
    const row = this.repository.findItemById(id, businessId);
    if (row === null) {
      throw new NotFoundError('El ítem de inventario no existe', {
        details: { id, type: 'inventory_item' },
      });
    }
    return row;
  }

  /**
   * BR-INV-008: exactamente uno de `productId` / `ingredientId`, y debe existir.
   * Los dos a la vez o ninguno son `422 INVENTORY_SOURCE_REQUIRED`, no 400: la
   * forma de la petición es válida, lo que falla es la regla de negocio.
   */
  private resolveSource(
    input: Pick<CreateInventoryItemInput, 'productId' | 'ingredientId'>,
    businessId: number,
  ): { readonly productId: number | null; readonly ingredientId: number | null } {
    const productId = input.productId ?? null;
    const ingredientId = input.ingredientId ?? null;
    if (productId === null && ingredientId === null) {
      throw new BusinessRuleError('Indique el producto o el insumo que controla este ítem', {
        details: {
          code: 'INVENTORY_SOURCE_REQUIRED',
          ruleId: 'BR-INV-008',
          field: 'productId',
        },
      });
    }
    if (productId !== null && ingredientId !== null) {
      throw new BusinessRuleError('Un ítem de inventario no puede seguir a un producto y a un insumo a la vez', {
        details: { code: 'INVENTORY_SOURCE_REQUIRED', ruleId: 'BR-INV-008', field: 'ingredientId' },
      });
    }
    if (productId !== null && !this.repository.productExists(productId, businessId)) {
      throw new NotFoundError('El producto no existe', {
        details: { id: productId, type: 'product', field: 'productId' },
      });
    }
    if (ingredientId !== null && !this.repository.ingredientExists(ingredientId, businessId)) {
      throw new NotFoundError('El insumo no existe', {
        details: { id: ingredientId, type: 'ingredient', field: 'ingredientId' },
      });
    }
    return { productId, ingredientId };
  }

  /** El SKU, si se envía, debe estar libre en el negocio. */
  private assertSkuAvailable(sku: string | null, businessId: number, excludeId: number | null): void {
    if (sku === null) {
      return;
    }
    const owner = this.repository.findItemIdBySku(sku, businessId, excludeId);
    if (owner !== null) {
      throw new ConflictError('Ya existe un ítem de inventario con ese SKU', {
        details: { code: 'INVENTORY_SKU_TAKEN', field: 'sku' },
      });
    }
  }

  /** BR-INV-007: sin seguimiento no hay movimientos. */
  private assertTracked(item: InventoryItemRow): void {
    if (item.is_tracked === 0) {
      throw new BusinessRuleError('El ítem no tiene seguimiento de stock', {
        details: {
          code: 'ITEM_NOT_TRACKED',
          ruleId: 'BR-INV-007',
          id: item.id,
          hint: 'Active isTracked en el ítem antes de registrar movimientos',
        },
      });
    }
  }

  /** `SALE`, `RESERVATION` y `RELEASE` los genera el flujo de pedidos. */
  private assertManualType(movementType: MovementType): void {
    if (ORDER_DRIVEN_MOVEMENTS.includes(movementType)) {
      throw new BusinessRuleError(
        `Un movimiento de tipo ${movementType} sólo lo genera el flujo de pedidos`,
        {
          details: {
            code: 'MOVEMENT_TYPE_NOT_MANUAL',
            movementType,
            ruleId: 'BR-INV-004',
            allowed: MANUAL_MOVEMENT_TYPES,
          },
        },
      );
    }
  }

  /** El signo de la cantidad tiene que corresponder al tipo de movimiento. */
  private assertMovementSign(movementType: MovementType, quantity: number): void {
    // Un tipo ausente en el mapa se trataría como flexible; el `Map` es
    // exhaustivo sobre `MovementType`, así que sólo faltaría un tipo nuevo.
    const sign = MOVEMENT_SIGN.get(movementType) ?? 'BOTH';
    if (sign === 'BOTH') {
      return;
    }
    if (sign === 'POSITIVE' && quantity > 0) {
      return;
    }
    if (sign === 'NEGATIVE' && quantity < 0) {
      return;
    }
    const expected = sign === 'POSITIVE' ? 'positiva (suma stock)' : 'negativa (resta stock)';
    throw new BusinessRuleError(
      `Un movimiento de tipo ${movementType} debe tener una cantidad ${expected}`,
      {
        details: {
          code: 'MOVEMENT_SIGN_INVALID',
          movementType,
          quantity,
          expectedSign: sign === 'POSITIVE' ? 'POSITIVE' : 'NEGATIVE',
        },
      },
    );
  }

  /** BR-INV-002: sin stock negativo salvo permiso del negocio. */
  private assertNotNegative(balanceAfter: number, currentStock: number, businessId: number): void {
    if (balanceAfter >= 0) {
      return;
    }
    if (this.rulesOf(businessId).allowNegativeStock) {
      return;
    }
    throw this.negativeStockError(currentStock, balanceAfter, businessId);
  }

  /** Error único de stock negativo, con los datos que la UI necesita. */
  private negativeStockError(currentStock: number, requested: number, businessId: number): BusinessRuleError {
    return new BusinessRuleError(
      'La operación dejaría el stock en negativo y el negocio no permite existencias negativas',
      {
        details: {
          code: 'NEGATIVE_STOCK_BLOCKED',
          ruleId: 'BR-INV-002',
          businessId,
          currentStock,
          requestedQuantity: requested,
          available: currentStock,
          hint: 'Registre una compra o un ajuste antes de vender por debajo del stock',
        },
      },
    );
  }

  /**
   * Rango por defecto del histórico: los últimos 30 días (API.md 7.15), y
   * `400 RANGE_TOO_LARGE` si el rango pedido supera los 366 días.
   */
  private resolveRange(from: string | undefined, to: string | undefined): { from: string; to: string } {
    const MAX_RANGE_DAYS = 366;
    const toIso = to ?? nowIso();
    const fromIso = from ?? new Date(Date.parse(toIso) - 30 * 24 * 60 * 60 * 1000).toISOString();
    const fromMs = Date.parse(fromIso);
    const toMs = Date.parse(toIso);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
      throw new ValidationError('El rango de fechas no es válido', {
        details: [{ path: Number.isNaN(fromMs) ? 'from' : 'to', message: 'Instante ISO-8601 inválido', code: 'INVALID_FORMAT' }],
      });
    }
    if (fromMs > toMs) {
      throw new ValidationError('El rango de fechas es inválido', {
        details: [
          { path: 'from', message: '`from` debe ser anterior a `to`', code: 'INVALID_DATE_RANGE' },
        ],
      });
    }
    if ((toMs - fromMs) / (24 * 60 * 60 * 1000) > MAX_RANGE_DAYS) {
      throw new ValidationError('El rango de fechas es demasiado amplio', {
        details: [
          {
            path: 'from',
            message: `El rango no puede superar ${MAX_RANGE_DAYS} días`,
            code: 'RANGE_TOO_LARGE',
          },
        ],
      });
    }
    return { from: fromIso, to: toIso };
  }

  // ==========================================================================
  // Auxiliares: proyección
  // ==========================================================================

  /** Umbral efectivo de un ítem (BR-INV-006). */
  private thresholdOf(row: InventoryItemRow, rules: BusinessRules): number {
    return row.min_stock > 0 ? row.min_stock : rules.lowStockThreshold;
  }

  private isLowStockOf(row: InventoryItemRow, rules: BusinessRules): boolean {
    // Un ítem sin seguimiento nunca está "en alerta": no se puede quedarse sin
    // existencias porque no las tiene (BR-INV-006 exige `is_tracked = 1`).
    return row.is_tracked === 1 && row.current_stock <= this.thresholdOf(row, rules);
  }

  private toItemView(row: InventoryItemRow, rules: BusinessRules): InventoryItemView {
    return {
      id: row.id,
      productId: row.product_id,
      ingredientId: row.ingredient_id,
      name: row.name,
      sku: row.sku,
      unit: row.unit as InventoryItemView['unit'],
      currentStock: row.current_stock,
      minStock: row.min_stock,
      maxStock: row.max_stock,
      costMinor: row.cost_minor,
      supplier: row.supplier,
      locationStorage: row.location_storage,
      isTracked: row.is_tracked === 1,
      isLowStock: this.isLowStockOf(row, rules),
      lowStockThreshold: this.thresholdOf(row, rules),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toMovementView(row: InventoryMovementJoinedRow): InventoryMovementView {
    return {
      id: row.id,
      inventoryItemId: row.inventory_item_id,
      inventoryItemName: row.inventory_item_name,
      unit: row.unit as InventoryMovementView['unit'],
      movementType: row.movement_type as InventoryMovementView['movementType'],
      quantity: row.quantity,
      balanceAfter: row.balance_after,
      unitCostMinor: row.unit_cost_minor,
      referenceType: row.reference_type as InventoryMovementView['referenceType'],
      referenceId: row.reference_id,
      reason: row.reason,
      performedBy: row.performed_by,
      // `created_at` es NOT NULL en la tabla; el `| null` del tipo de la fila
      // refleja sólo lo que devuelve el driver, nunca un valor real.
      createdAt: row.created_at ?? nowIso(),
    };
  }

  /**
   * Severidad de la alerta, de la más grave a la menos:
   * `NEGATIVE` (< 0), `OUT` (= 0), `LOW` (0 < x <= umbral). API.md 7.15.
   */
  private toAlertView(row: InventoryItemRow, rules: BusinessRules): StockAlertView {
    const threshold = this.thresholdOf(row, rules);
    const severity: StockAlertSeverity =
      row.current_stock < 0 ? Severity.NEGATIVE : row.current_stock === 0 ? Severity.OUT : Severity.LOW;
    return {
      itemId: row.id,
      name: row.name,
      sku: row.sku,
      unit: row.unit as StockAlertView['unit'],
      currentStock: row.current_stock,
      minStock: row.min_stock,
      lowStockThreshold: threshold,
      // Nunca negativo: `deficitQuantity` es "cuánto falta", no "cuánto sobra".
      deficitQuantity: Math.max(0, roundStock(threshold - row.current_stock)),
      supplier: row.supplier,
      locationStorage: row.location_storage,
      severity,
      isTracked: row.is_tracked === 1,
      updatedAt: row.updated_at,
    };
  }

  private toTotals(row: {
    readonly items_tracked: number;
    readonly value_minor: number;
    readonly low_stock_count: number;
    readonly negative_stock_count: number;
  }): InventoryTotals {
    return {
      itemsTracked: row.items_tracked,
      valueMinor: row.value_minor,
      lowStockCount: row.low_stock_count,
      negativeStockCount: row.negative_stock_count,
    };
  }

  private toStats(row: {
    readonly total_in: number;
    readonly total_out: number;
    readonly average_cost_minor: number;
  }): InventoryItemStats {
    return { totalIn: row.total_in, totalOut: row.total_out, averageCostMinor: row.average_cost_minor };
  }

  private itemAuditFields(row: InventoryItemRow): Record<string, unknown> {
    return {
      id: row.id,
      name: row.name,
      sku: row.sku,
      productId: row.product_id,
      ingredientId: row.ingredient_id,
      unit: row.unit,
      currentStock: row.current_stock,
      minStock: row.min_stock,
      maxStock: row.max_stock,
      costMinor: row.cost_minor,
      supplier: row.supplier,
      locationStorage: row.location_storage,
      isTracked: row.is_tracked === 1,
    };
  }
}

/**
 * Redondea un saldo de stock a 6 decimales.
 *
 * El stock es `REAL` y admite fracciones (`0.5` kg), pero se accumulates por
 * sumas: sin redondear, `0.1 + 0.2` dejaría un saldo con 17 decimales que se
 * compararía mal con el umbral y se mostraría en pantalla como `0.30000000000004`.
 * 6 decimales es más que suficiente para un peso de café y elimina la deriva.
 */
function roundStock(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export { INITIAL_STOCK_REASON, ORDER_DRIVEN_MOVEMENTS, RECENT_MOVEMENTS_LIMIT, RECENT_MOVEMENTS_WINDOW_DAYS };
