/**
 * Rutas de pedidos (API.md 7.12).
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): declara método, path,
 * middlewares y handler. No lee `req.body` sin validar, no decide permisos de
 * negocio y no importa repositorios.
 *
 * ============================== ORDEN DE RUTAS =============================
 * Express enruta por FORMA de ruta, no por nombre: `/items/:itemId` y
 * `/:id/items` tienen tres y dos segmentos respectivamente y nunca colisionan, y
 * `/:id/receipt` (dos segmentos) se declara antes que `/:id` (uno) para que sea
 * evidente el orden de declaración.
 *
 * =============================== SEGURIDAD ================================
 *  - Todas exigen `authenticate`: no hay ni un endpoint de pedido público.
 *  - Los permisos usan las claves REALES de `shared/domain/permissions.ts`
 *    (`orders:read`, `orders:create`, `orders:update`, `orders:cancel`,
 *    `orders:status:update`, `orders:receipt:read`).
 *  - El ALCANCE (un `CUSTOMER` sólo ve lo suyo) NO lo resuelve el middleware:
 *    `requirePermission` resuelve acceso al recurso, el service resuelve el
 *    alcance (DESIGN.md 9.3, la `P` de la matriz).
 *  - El orden de la cadena es siempre `authenticate -> requirePermission ->
 *    validate -> handler`: primero identidad, luego autorización, y sólo después
 *    la forma de la petición. Así un `CUSTOMER` recibe 403 y no 400 por un campo
 *    mal formado.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { OrdersController } from './orders.controller.js';
import { getOrdersServices } from './orders.container.js';
import {
  ORDERS_SORT_COLUMNS,
  ORDERS_SORT_DEFAULT,
  addOrderItemsBodySchema,
  assignChairBodySchema,
  cancelOrderBodySchema,
  changeOrderStatusBodySchema,
  confirmOrderBodySchema,
  createOrderBodySchema,
  listOrdersQuerySchema,
  orderHistoryQuerySchema,
  orderIdParamsSchema,
  orderItemParamsSchema,
  orderReceiptQuerySchema,
  removeOrderItemBodySchema,
  updateOrderBodySchema,
  updateOrderItemBodySchema,
} from './orders.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const services = getOrdersServices();

const controller = new OrdersController(services.orders);

/** Router de pedidos. Se monta bajo `/api/v1/orders`. */
export const ordersRouter: Router = Router();

/** `GET /api/v1/orders` — `orders:read`. */
ordersRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.ORDERS_READ),
  validate({
    query: listOrdersQuerySchema,
    sortable: {
      allowedColumns: ORDERS_SORT_COLUMNS,
      defaultColumn: ORDERS_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.list,
);

/** `POST /api/v1/orders` — `orders:create` (201). El precio lo pone el servidor. */
ordersRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.ORDERS_CREATE),
  validate({ body: createOrderBodySchema }),
  controller.create,
);

// --- Líneas (`/items/:itemId`): rutas de un sub-recurso de la colección) ----

/** `PATCH /api/v1/orders/items/:itemId` — `orders:update`. */
ordersRouter.patch(
  '/items/:itemId',
  authenticate,
  requirePermission(PERMISSION.ORDERS_UPDATE),
  validate({ params: orderItemParamsSchema, body: updateOrderItemBodySchema }),
  controller.updateItem,
);

/** `DELETE /api/v1/orders/items/:itemId` — `orders:update`. */
ordersRouter.delete(
  '/items/:itemId',
  authenticate,
  requirePermission(PERMISSION.ORDERS_UPDATE),
  validate({ params: orderItemParamsSchema, body: removeOrderItemBodySchema }),
  controller.removeItem,
);

// --- Acciones sobre el pedido ----------------------------------------------

/** `POST /api/v1/orders/:id/items` — `orders:update` (201). */
ordersRouter.post(
  '/:id/items',
  authenticate,
  requirePermission(PERMISSION.ORDERS_UPDATE),
  validate({ params: orderIdParamsSchema, body: addOrderItemsBodySchema }),
  controller.addItems,
);

/** `POST /api/v1/orders/:id/status` — `orders:status:update`. */
ordersRouter.post(
  '/:id/status',
  authenticate,
  requirePermission(PERMISSION.ORDERS_STATUS_UPDATE),
  validate({ params: orderIdParamsSchema, body: changeOrderStatusBodySchema }),
  controller.changeStatus,
);

/** `POST /api/v1/orders/:id/confirm` — `orders:status:update`. */
ordersRouter.post(
  '/:id/confirm',
  authenticate,
  requirePermission(PERMISSION.ORDERS_STATUS_UPDATE),
  validate({ params: orderIdParamsSchema, body: confirmOrderBodySchema }),
  controller.confirm,
);

/** `POST /api/v1/orders/:id/cancel` — `orders:cancel`. */
ordersRouter.post(
  '/:id/cancel',
  authenticate,
  requirePermission(PERMISSION.ORDERS_CANCEL),
  validate({ params: orderIdParamsSchema, body: cancelOrderBodySchema }),
  controller.cancel,
);

/** `POST /api/v1/orders/:id/assign-chair` — `orders:update`. */
ordersRouter.post(
  '/:id/assign-chair',
  authenticate,
  requirePermission(PERMISSION.ORDERS_UPDATE),
  validate({ params: orderIdParamsSchema, body: assignChairBodySchema }),
  controller.assignChair,
);

/** `GET /api/v1/orders/:id/receipt` — `orders:receipt:read`. */
ordersRouter.get(
  '/:id/receipt',
  authenticate,
  requirePermission(PERMISSION.ORDERS_RECEIPT_READ),
  validate({ params: orderIdParamsSchema, query: orderReceiptQuerySchema }),
  controller.getReceipt,
);

/** `GET /api/v1/orders/:id/history` — `orders:read`. */
ordersRouter.get(
  '/:id/history',
  authenticate,
  requirePermission(PERMISSION.ORDERS_READ),
  validate({
    params: orderIdParamsSchema,
    query: orderHistoryQuerySchema,
    sortable: { allowedColumns: ['created_at'], defaultColumn: 'created_at', defaultOrder: 'desc' },
  }),
  controller.getHistory,
);

// --- Lectura y edición del pedido ------------------------------------------

/** `GET /api/v1/orders/:id` — `orders:read`. */
ordersRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.ORDERS_READ),
  validate({ params: orderIdParamsSchema }),
  controller.getById,
);

/** `PATCH /api/v1/orders/:id` — `orders:update`. */
ordersRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.ORDERS_UPDATE),
  validate({ params: orderIdParamsSchema, body: updateOrderBodySchema }),
  controller.update,
);
