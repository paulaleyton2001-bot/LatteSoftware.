/**
 * Controller del módulo `inventory` (API.md 7.15).
 *
 * Traduce `req` ya validado a los tipos del service y da forma a la respuesta.
 * No decide nada de negocio: ni el signo del movimiento, ni si el stock puede
 * quedar negativo, ni el umbral de alerta. Eso es del service, que es donde están
 * los ajustes del negocio.
 */
import type { Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { InventoryRequestContext, InventoryService } from './inventory.service.js';
import type {
  InventoryItemFilter,
  InventoryItemSortColumn,
  MovementListFilter,
  MovementSortColumn,
  StockAlertFilter,
  SupplierFilter,
} from './inventory.repository.js';
import type { AlertSortColumn } from './inventory.types.js';
import {
  ALERT_SORT_DEFAULT,
  INVENTORY_ITEM_SORT_DEFAULT,
  MOVEMENT_SORT_DEFAULT,
} from './inventory.schemas.js';
import type {
  AdjustInventoryItemBody,
  CreateInventoryItemBody,
  CreateInventoryMovementBody,
  DeleteInventoryItemBody,
  ListInventoryAlertsQuery,
  ListInventoryItemsQuery,
  ListInventoryMovementsQuery,
  ListInventorySuppliersQuery,
  UpdateInventoryItemBody,
} from './inventory.schemas.js';

/** `req` con actor y cuerpo/query/params validados. */
type InventoryRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const ITEM_SORT_COLUMNS: readonly InventoryItemSortColumn[] = [
  'name',
  'current_stock',
  'updated_at',
  'cost_minor',
];
const MOVEMENT_SORT_COLUMNS: readonly MovementSortColumn[] = ['created_at', 'quantity'];
const ALERT_SORT_COLUMNS: readonly AlertSortColumn[] = ['current_stock', 'name'];

/** Contexto de auditoría de la petición. */
function contextOf(req: InventoryRequest): InventoryRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Controller de inventario. */
export class InventoryController {
  public constructor(private readonly inventory: InventoryService) {}

  // ==========================================================================
  // Ítems
  // ==========================================================================

  /** `GET /api/v1/inventory/items` — listado con totales de `meta`. */
  public listItems = async (req: InventoryRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListInventoryItemsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? INVENTORY_ITEM_SORT_DEFAULT;
    const column = (ITEM_SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as InventoryItemSortColumn)
      : (INVENTORY_ITEM_SORT_DEFAULT as InventoryItemSortColumn);

    const filter: Omit<InventoryItemFilter, 'businessId' | 'businessThreshold'> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: { column, direction: req.validated?.sort?.direction ?? 'ASC' },
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.productId === undefined ? {} : { productId: query.productId }),
      ...(query.ingredientId === undefined ? {} : { ingredientId: query.ingredientId }),
      ...(query.supplier === undefined ? {} : { supplier: query.supplier }),
      ...(query.locationStorage === undefined ? {} : { locationStorage: query.locationStorage }),
      ...(query.isTracked === undefined ? {} : { isTracked: query.isTracked }),
      ...(query.isLowStock === undefined ? {} : { isLowStock: query.isLowStock }),
      includeInactive: query.includeInactive === true,
    };

    const page = this.inventory.listItems(filter, contextOf(req));
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      { totals: page.totals },
    );
  };

  /**
   * `POST /api/v1/inventory/items` — alta (201).
   * `meta.initialMovementId` identifica el movimiento `ADJUSTMENT` de apertura.
   */
  public createItem = async (req: InventoryRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateInventoryItemBody;
    const result = this.inventory.createItem(
      {
        ...(body.productId === undefined ? {} : { productId: body.productId }),
        ...(body.ingredientId === undefined ? {} : { ingredientId: body.ingredientId }),
        name: body.name,
        ...(body.sku === undefined ? {} : { sku: body.sku }),
        unit: body.unit,
        currentStock: body.currentStock,
        ...(body.minStock === undefined ? {} : { minStock: body.minStock }),
        maxStock: body.maxStock,
        costMinor: body.costMinor,
        ...(body.supplier === undefined ? {} : { supplier: body.supplier }),
        ...(body.locationStorage === undefined ? {} : { locationStorage: body.locationStorage }),
        isTracked: body.isTracked,
      },
      contextOf(req),
    );
    sendCreated(res, result.item, {
      ...(result.initialMovementId === null ? {} : { initialMovementId: result.initialMovementId }),
      appliedRules: ['BR-INV-001', 'BR-INV-010'],
    });
  };

  /** `GET /api/v1/inventory/items/:id` — el ítem con movimientos y estadísticas. */
  public getItem = async (req: InventoryRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.inventory.getItem(params.id, contextOf(req)));
  };

  /** `PATCH /api/v1/inventory/items/:id` — ficha del ítem, nunca el saldo. */
  public updateItem = async (req: InventoryRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as UpdateInventoryItemBody;
    sendSuccess(
      res,
      this.inventory.updateItem(
        params.id,
        {
          ...(body.currentStock === undefined ? {} : { currentStock: body.currentStock }),
          ...(body.productId === undefined ? {} : { productId: body.productId }),
          ...(body.ingredientId === undefined ? {} : { ingredientId: body.ingredientId }),
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.sku === undefined ? {} : { sku: body.sku }),
          ...(body.unit === undefined ? {} : { unit: body.unit }),
          ...(body.minStock === undefined ? {} : { minStock: body.minStock }),
          ...(body.maxStock === undefined ? {} : { maxStock: body.maxStock }),
          ...(body.costMinor === undefined ? {} : { costMinor: body.costMinor }),
          ...(body.supplier === undefined ? {} : { supplier: body.supplier }),
          ...(body.locationStorage === undefined ? {} : { locationStorage: body.locationStorage }),
          ...(body.isTracked === undefined ? {} : { isTracked: body.isTracked }),
        },
        contextOf(req),
      ),
    );
  };

  /** `DELETE /api/v1/inventory/items/:id` — baja lógica, el histórico se conserva. */
  public removeItem = async (req: InventoryRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = (req.validated?.body ?? {}) as DeleteInventoryItemBody;
    sendSuccess(
      res,
      this.inventory.removeItem(
        params.id,
        { reason: body.reason ?? 'BAJA DE INVENTARIO', force: body.force === true },
        contextOf(req),
      ),
    );
  };

  /**
   * `POST /api/v1/inventory/items/:id/adjust` — corrección del saldo (201).
   * Genera un movimiento `ADJUSTMENT`; nunca un `UPDATE` silencioso (BR-INV-005).
   */
  public adjustItem = async (req: InventoryRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as AdjustInventoryItemBody;
    sendCreated(
      res,
      this.inventory.adjustItem(
        params.id,
        {
          ...(body.newQuantity === undefined ? {} : { newQuantity: body.newQuantity }),
          ...(body.deltaQuantity === undefined ? {} : { deltaQuantity: body.deltaQuantity }),
          reason: body.reason,
          ...(body.unitCostMinor === undefined ? {} : { unitCostMinor: body.unitCostMinor }),
          referenceType: body.referenceType,
          ...(body.referenceId === undefined ? {} : { referenceId: body.referenceId }),
        },
        contextOf(req),
      ),
      { appliedRules: ['BR-INV-001', 'BR-INV-002', 'BR-INV-005', 'BR-INV-010'] },
    );
  };

  // ==========================================================================
  // Movimientos
  // ==========================================================================

  /** `GET /api/v1/inventory/movements` — histórico paginado con totales. */
  public listMovements = async (req: InventoryRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListInventoryMovementsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? MOVEMENT_SORT_DEFAULT;
    const column = (MOVEMENT_SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as MovementSortColumn)
      : (MOVEMENT_SORT_DEFAULT as MovementSortColumn);

    const filter: Omit<MovementListFilter, 'businessId'> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: { column, direction: req.validated?.sort?.direction ?? 'DESC' },
      ...(query.itemId === undefined ? {} : { itemId: query.itemId }),
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.referenceType === undefined ? {} : { referenceType: query.referenceType }),
      ...(query.referenceId === undefined ? {} : { referenceId: query.referenceId }),
      ...(query.performedBy === undefined ? {} : { performedBy: query.performedBy }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
    };

    const page = this.inventory.listMovements(filter, contextOf(req));
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      { totals: page.totals },
    );
  };

  /**
   * `POST /api/v1/inventory/movements` — alta manual (201).
   * El saldo y el movimiento se escriben en la MISMA transacción (BR-INV-010).
   */
  public createMovement = async (req: InventoryRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateInventoryMovementBody;
    sendCreated(
      res,
      this.inventory.createMovement(
        {
          inventoryItemId: body.inventoryItemId,
          movementType: body.movementType,
          quantity: body.quantity,
          ...(body.unitCostMinor === undefined ? {} : { unitCostMinor: body.unitCostMinor }),
          ...(body.referenceType === undefined ? {} : { referenceType: body.referenceType }),
          ...(body.referenceId === undefined ? {} : { referenceId: body.referenceId }),
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        },
        contextOf(req),
      ),
      { appliedRules: ['BR-INV-001', 'BR-INV-002', 'BR-INV-010'] },
    );
  };

  // ==========================================================================
  // Alertas y proveedores
  // ==========================================================================

  /** `GET /api/v1/inventory/alerts` — ítems en alerta con su severidad. */
  public listAlerts = async (req: InventoryRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListInventoryAlertsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? ALERT_SORT_DEFAULT;
    const column = (ALERT_SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as AlertSortColumn)
      : (ALERT_SORT_DEFAULT as AlertSortColumn);

    const filter: Omit<StockAlertFilter, 'businessId' | 'businessThreshold'> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: { column, direction: req.validated?.sort?.direction ?? 'ASC' },
      includeNegative: query.includeNegative !== false,
      ...(query.supplier === undefined ? {} : { supplier: query.supplier }),
      ...(query.locationStorage === undefined ? {} : { locationStorage: query.locationStorage }),
      ...(query.severity === undefined ? {} : { severity: query.severity }),
    };

    const page = this.inventory.listAlerts(filter, contextOf(req));
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      { countsBySeverity: page.countsBySeverity },
    );
  };

  /** `GET /api/v1/inventory/suppliers` — agrupación por proveedor. */
  public listSuppliers = async (req: InventoryRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListInventorySuppliersQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };

    const filter: Omit<SupplierFilter, 'businessId' | 'businessThreshold'> = {
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      ...(query.q === undefined ? {} : { q: query.q }),
    };

    const page = this.inventory.listSuppliers(filter, contextOf(req));
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };
}
