/**
 * Rutas de `/api/v1/inventory` (API.md 7.15).
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): método, path,
 * middlewares y handler. Nada de lógica de negocio ni de SQL.
 *
 * ============================== SEGURIDAD ===================================
 *  - Permisos: `inventory:read` (leer ítems y alertas), `inventory:write`
 *    (crear y editar ítems), `inventory:adjust` (movimientos y ajustes) e
 *    `inventory:movements:read` (leer el histórico). Son las cuatro claves
 *    reales de `shared/domain/permissions.ts`; separarlas permite que un cajero
 *    consulte existencias y alertas sin poder corregirlas.
 *  - Orden de la cadena: `authenticate -> requirePermission -> validate ->
 *    handler`. Así un `CUSTOMER` recibe 403 y no 400 por un campo mal formado.
 *  - El Borrado (`DELETE /items/:id`) lleva cuerpo con `reason` obligatorio, tal
 *    y como lo define API.md 7.15. Un `DELETE` con cuerpo es inusual, pero es lo
 *    que el contrato pide para que la baja quede justificada en la auditoría.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { getInventoryServices } from './inventory.container.js';
import { InventoryController } from './inventory.controller.js';
import {
  ALERT_SORT_COLUMNS,
  ALERT_SORT_DEFAULT,
  INVENTORY_ITEM_SORT_COLUMNS,
  INVENTORY_ITEM_SORT_DEFAULT,
  MOVEMENT_SORT_COLUMNS,
  MOVEMENT_SORT_DEFAULT,
  SUPPLIER_SORT_COLUMNS,
  SUPPLIER_SORT_DEFAULT,
  adjustInventoryItemBodySchema,
  createInventoryItemBodySchema,
  createInventoryMovementBodySchema,
  deleteInventoryItemBodySchema,
  inventoryItemIdParamsSchema,
  listInventoryAlertsQuerySchema,
  listInventoryItemsQuerySchema,
  listInventoryMovementsQuerySchema,
  listInventorySuppliersQuerySchema,
  updateInventoryItemBodySchema,
} from './inventory.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const controller = new InventoryController(getInventoryServices().inventory);

/** Router de inventario. Se monta bajo `/api/v1/inventory`. */
export const inventoryRouter: Router = Router();

// ---------------------------------------------------------------------------
// Rutas literales: se declaran ANTES que `/items/:id` para que Express no las
// interprete como un id de ítem.
// ---------------------------------------------------------------------------

/** `GET /api/v1/inventory/movements` — `inventory:movements:read`. */
inventoryRouter.get(
  '/movements',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_MOVEMENTS_READ),
  validate({
    query: listInventoryMovementsQuerySchema,
    sortable: {
      allowedColumns: MOVEMENT_SORT_COLUMNS,
      defaultColumn: MOVEMENT_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.listMovements,
);

/**
 * `POST /api/v1/inventory/movements` — `inventory:adjust`.
 * El saldo y el movimiento se escriben en la MISMA transacción (BR-INV-010).
 */
inventoryRouter.post(
  '/movements',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_ADJUST),
  validate({ body: createInventoryMovementBodySchema }),
  controller.createMovement,
);

/** `GET /api/v1/inventory/alerts` — `inventory:read`. */
inventoryRouter.get(
  '/alerts',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_READ),
  validate({
    query: listInventoryAlertsQuerySchema,
    sortable: {
      allowedColumns: ALERT_SORT_COLUMNS,
      defaultColumn: ALERT_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  controller.listAlerts,
);

/** `GET /api/v1/inventory/suppliers` — `inventory:read`. */
inventoryRouter.get(
  '/suppliers',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_READ),
  validate({
    query: listInventorySuppliersQuerySchema,
    sortable: {
      allowedColumns: SUPPLIER_SORT_COLUMNS,
      defaultColumn: SUPPLIER_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  controller.listSuppliers,
);

// ---------------------------------------------------------------------------
// Ítems
// ---------------------------------------------------------------------------

/** `GET /api/v1/inventory/items` — `inventory:read`. */
inventoryRouter.get(
  '/items',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_READ),
  validate({
    query: listInventoryItemsQuerySchema,
    sortable: {
      allowedColumns: INVENTORY_ITEM_SORT_COLUMNS,
      defaultColumn: INVENTORY_ITEM_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  controller.listItems,
);

/** `POST /api/v1/inventory/items` — `inventory:write` (201). */
inventoryRouter.post(
  '/items',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_WRITE),
  validate({ body: createInventoryItemBodySchema }),
  controller.createItem,
);

/** `GET /api/v1/inventory/items/:id` — `inventory:read`. */
inventoryRouter.get(
  '/items/:id',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_READ),
  validate({ params: inventoryItemIdParamsSchema }),
  controller.getItem,
);

/** `PATCH /api/v1/inventory/items/:id` — `inventory:write`. */
inventoryRouter.patch(
  '/items/:id',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_WRITE),
  validate({ params: inventoryItemIdParamsSchema, body: updateInventoryItemBodySchema }),
  controller.updateItem,
);

/** `DELETE /api/v1/inventory/items/:id` — `inventory:write` (soft delete). */
inventoryRouter.delete(
  '/items/:id',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_WRITE),
  validate({ params: inventoryItemIdParamsSchema, body: deleteInventoryItemBodySchema }),
  controller.removeItem,
);

/** `POST /api/v1/inventory/items/:id/adjust` — `inventory:adjust` (201). */
inventoryRouter.post(
  '/items/:id/adjust',
  authenticate,
  requirePermission(PERMISSION.INVENTORY_ADJUST),
  validate({ params: inventoryItemIdParamsSchema, body: adjustInventoryItemBodySchema }),
  controller.adjustItem,
);
