/**
 * Rutas de `/api/v1/rentals` (API.md 7.9).
 *
 * ============================== SEGURIDAD ===================================
 *  - Todas exigen `authenticate` (BR-SEC-005) y su permiso de DESIGN.md 9.2.
 *  - `rentals:create`, `rentals:extend` y `rentals:complete` NO están en la
 *    matriz para `CUSTOMER` ni para `STAFF`: abrir, extender y cerrar un alquiler
 *    son operaciones de sala, y el cliente sólo puede LEER los suyos
 *    (`rentals:read` con marca `P`; el service le fuerza el filtro por su id).
 *  - Orden: `authenticate -> requirePermission -> validate -> handler`.
 *
 * ============================== ORDEN DE RUTAS ==============================
 * Las tres rutas literales se declaran ANTES que `/:id`, porque Express enruta por
 * orden de declaración: `/active` y `/chair/:chairId/active` se interpretarían
 * como ids si se invirtieran.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { asyncHandler } from '../../shared/http/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { RentalsController } from './rentals.controller.js';
import { getRentalsService } from '../spaces/spaces.provider.js';
import {
  ACTIVE_RENTAL_SORT_COLUMNS,
  ACTIVE_RENTAL_SORT_DEFAULT,
  RENTAL_SORT_COLUMNS,
  RENTAL_SORT_DEFAULT,
  completeRentalBodySchema,
  createRentalBodySchema,
  extendRentalBodySchema,
  listActiveRentalsQuerySchema,
  listRentalsQuerySchema,
  rentalByChairParamsSchema,
  rentalIdParamsSchema,
} from './rentals.schemas.js';

/** Controller único del módulo, construido por el proveedor de composición. */
const controller = new RentalsController(getRentalsService());

/** Router de `/api/v1/rentals`. */
export const rentalsRouter: Router = Router();

/**
 * `GET /rentals/active` — `rentals:read`. ANTES que `/:id`.
 *
 * Es el panel de sala: quién está sentado ahora, cuánto lleva y cuánto le queda.
 */
rentalsRouter.get(
  '/active',
  authenticate,
  requirePermission(PERMISSION.RENTALS_READ),
  validate({
    query: listActiveRentalsQuerySchema,
    sortable: {
      allowedColumns: ACTIVE_RENTAL_SORT_COLUMNS,
      defaultColumn: ACTIVE_RENTAL_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  asyncHandler(controller.listActive),
);

/** `GET /rentals/chair/:chairId/active` — `rentals:read`. */
rentalsRouter.get(
  '/chair/:chairId/active',
  authenticate,
  requirePermission(PERMISSION.RENTALS_READ),
  validate({ params: rentalByChairParamsSchema }),
  asyncHandler(controller.getActiveByChair),
);

/** `GET /rentals` — `rentals:read` (acotado por el service). */
rentalsRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.RENTALS_READ),
  validate({
    query: listRentalsQuerySchema,
    sortable: { allowedColumns: RENTAL_SORT_COLUMNS, defaultColumn: RENTAL_SORT_DEFAULT, defaultOrder: 'desc' },
  }),
  controller.list,
);

/** `POST /rentals` — `rentals:create` (STAFF+). Alquiler walk-in. */
rentalsRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.RENTALS_CREATE),
  validate({ body: createRentalBodySchema }),
  controller.create,
);

/** `GET /rentals/:id` — `rentals:read`. */
rentalsRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.RENTALS_READ),
  validate({ params: rentalIdParamsSchema }),
  asyncHandler(controller.getById),
);

/** `POST /rentals/:id/extend` — `rentals:extend` (CASHIER+). */
rentalsRouter.post(
  '/:id/extend',
  authenticate,
  requirePermission(PERMISSION.RENTALS_EXTEND),
  validate({ params: rentalIdParamsSchema, body: extendRentalBodySchema }),
  controller.extend,
);

/** `POST /rentals/:id/complete` — `rentals:complete` (CASHIER+). */
rentalsRouter.post(
  '/:id/complete',
  authenticate,
  requirePermission(PERMISSION.RENTALS_COMPLETE),
  validate({ params: rentalIdParamsSchema, body: completeRentalBodySchema }),
  asyncHandler(controller.complete),
);
