/**
 * Rutas de `/api/v1/reservations` (API.md 7.8).
 *
 * ============================== SEGURIDAD ===================================
 *  - Todas exigen `authenticate` (BR-SEC-005).
 *  - Cada endpoint exige SU permiso de DESIGN.md 9.2. Matriz con marca `P` para
 *    `CUSTOMER` en `reservations:read`, `create`, `update` y `cancel`: puede usar
 *    esos endpoints, y el SERVICE acota cada uno a sus propias reservas. Un
 *    `CUSTOMER` que intente `check-in` o `extend` no tiene el permiso y recibe 403
 *    aquí, sin tocar la base de datos (API.md 7.8 y matriz 9.3).
 *  - `GET /` usa `reservations:read` (no `read:any`) a propósito: el mismo endpoint
 *    sirve al cliente (que ve sólo lo suyo, por filtro forzado en el service) y al
 *    personal (que ve todo). Si se exigiera `read:any`, el cliente no podría
 *    siquiera listar sus propias reservas.
 *  - Orden: `authenticate -> requirePermission -> validate -> handler`.
 *
 * ============================== ORDEN DE RUTAS ==============================
 * `GET /quote` se declara ANTES que `GET /:id`: Express enruta por orden de
 * declaración y `quote` no es un id numérico.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { asyncHandler } from '../../shared/http/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { ReservationsController } from './reservations.controller.js';
import { getReservationsService } from '../spaces/spaces.provider.js';
import {
  RESERVATION_SORT_COLUMNS,
  RESERVATION_SORT_DEFAULT,
  cancelReservationBodySchema,
  checkInReservationBodySchema,
  completeReservationBodySchema,
  createReservationBodySchema,
  extendReservationBodySchema,
  listReservationsQuerySchema,
  quoteReservationQuerySchema,
  reservationIdParamsSchema,
} from './reservations.schemas.js';

/** Controller único del módulo, construido por el proveedor de composición. */
const controller = new ReservationsController(getReservationsService());

/** Router de `/api/v1/reservations`. */
export const reservationsRouter: Router = Router();

/**
 * `GET /reservations/quote` — `reservations:read`. ANTES que `/:id`.
 *
 * Sólo lectura: no abre transacción de escritura y no puede crear nada.
 */
reservationsRouter.get(
  '/quote',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_READ),
  validate({ query: quoteReservationQuerySchema }),
  asyncHandler(controller.quote),
);

/** `GET /reservations` — `reservations:read` (acotado por el service). */
reservationsRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_READ),
  validate({
    query: listReservationsQuerySchema,
    sortable: {
      allowedColumns: RESERVATION_SORT_COLUMNS,
      defaultColumn: RESERVATION_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.list,
);

/** `POST /reservations` — `reservations:create`. */
reservationsRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_CREATE),
  validate({ body: createReservationBodySchema }),
  controller.create,
);

/** `GET /reservations/:id` — `reservations:read`. */
reservationsRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_READ),
  validate({ params: reservationIdParamsSchema }),
  asyncHandler(controller.getById),
);

/** `POST /reservations/:id/confirm` — `reservations:update`. */
reservationsRouter.post(
  '/:id/confirm',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_UPDATE),
  validate({ params: reservationIdParamsSchema }),
  asyncHandler(controller.confirm),
);

/** `POST /reservations/:id/cancel` — `reservations:cancel`. `STAFF` no puede. */
reservationsRouter.post(
  '/:id/cancel',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_CANCEL),
  validate({ params: reservationIdParamsSchema, body: cancelReservationBodySchema }),
  controller.cancel,
);

/** `POST /reservations/:id/check-in` — `reservations:checkin` (STAFF+). */
reservationsRouter.post(
  '/:id/check-in',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_CHECKIN),
  validate({ params: reservationIdParamsSchema, body: checkInReservationBodySchema }),
  controller.checkIn,
);

/** `POST /reservations/:id/extend` — `reservations:extend` (CASHIER+). */
reservationsRouter.post(
  '/:id/extend',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_EXTEND),
  validate({ params: reservationIdParamsSchema, body: extendReservationBodySchema }),
  controller.extend,
);

/** `POST /reservations/:id/complete` — `reservations:checkin` (mismo permiso). */
reservationsRouter.post(
  '/:id/complete',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_CHECKIN),
  validate({ params: reservationIdParamsSchema, body: completeReservationBodySchema }),
  asyncHandler(controller.complete),
);
