/**
 * Rutas de descuentos (API.md 7.14).
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): declara método, path,
 * middlewares y handler. No lee `req.body` sin validar, no decide permisos de
 * negocio y no importa repositorios.
 *
 * ============================== ORDEN DE RUTAS =============================
 * Express enruta en orden de declaración, y `/validate` y `/mine` (un segmento)
 * tienen la misma forma que `/:id`. Por eso las rutas LITERALES se declaran
 * ANTES que `/:id`: si se invirtieran, un `POST /discounts/validate` caería en
 * `/:id` y fallaría con "el identificador debe ser un número entero".
 *
 * =============================== SEGURIDAD ================================
 *  - `GET /` y `GET /:id` exigen `discounts:read`. La matriz de RBAC da ese
 *    permiso también a `CUSTOMER`, así que el service añade el filtro de alcance
 *    (los descuentos de gestión son de la casa); ver `DiscountsService`.
 *  - `POST /validate` y `GET /mine` sólo exigen autenticación: son consultas de
 *    un cliente sobre sus propios cupones, no administración de campañas.
 *  - El orden de la cadena es siempre `authenticate -> requirePermission ->
 *    validate -> handler`.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { DiscountsController } from './discounts.controller.js';
import { getDiscountsServices } from './discounts.container.js';
import {
  DISCOUNTS_SORT_COLUMNS,
  DISCOUNTS_SORT_DEFAULT,
  createDiscountBodySchema,
  discountIdParamsSchema,
  listDiscountsQuerySchema,
  listMyDiscountsQuerySchema,
  updateDiscountBodySchema,
  validateDiscountBodySchema,
} from './discounts.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const services = getDiscountsServices();

const controller = new DiscountsController(services.discounts);

/** Router de descuentos. Se monta bajo `/api/v1/discounts`. */
export const discountsRouter: Router = Router();

/** `GET /api/v1/discounts` — `discounts:read`. */
discountsRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.DISCOUNTS_READ),
  validate({
    query: listDiscountsQuerySchema,
    sortable: {
      allowedColumns: DISCOUNTS_SORT_COLUMNS,
      defaultColumn: DISCOUNTS_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.list,
);

/**
 * `POST /api/v1/discounts/validate` — `discounts:validate`.
 * Ruta LITERAL declarada antes de `/:id` (ver la nota de orden de este fichero).
 */
discountsRouter.post(
  '/validate',
  authenticate,
  requirePermission(PERMISSION.DISCOUNTS_VALIDATE),
  validate({ body: validateDiscountBodySchema }),
  controller.validate,
);

/** `GET /api/v1/discounts/mine` — sólo autenticación: son los cupones propios. */
discountsRouter.get(
  '/mine',
  authenticate,
  validate({
    query: listMyDiscountsQuerySchema,
    sortable: {
      allowedColumns: DISCOUNTS_SORT_COLUMNS,
      defaultColumn: DISCOUNTS_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  controller.listMine,
);

/** `POST /api/v1/discounts` — `discounts:create` (201). */
discountsRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.DISCOUNTS_CREATE),
  validate({ body: createDiscountBodySchema }),
  controller.create,
);

/** `GET /api/v1/discounts/:id` — `discounts:read`. */
discountsRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.DISCOUNTS_READ),
  validate({ params: discountIdParamsSchema }),
  controller.getById,
);

/** `PATCH /api/v1/discounts/:id` — `discounts:update`. */
discountsRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.DISCOUNTS_UPDATE),
  validate({ params: discountIdParamsSchema, body: updateDiscountBodySchema }),
  controller.update,
);

/** `DELETE /api/v1/discounts/:id` — `discounts:delete` (204, soft delete). */
discountsRouter.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.DISCOUNTS_DELETE),
  validate({ params: discountIdParamsSchema }),
  controller.remove,
);
