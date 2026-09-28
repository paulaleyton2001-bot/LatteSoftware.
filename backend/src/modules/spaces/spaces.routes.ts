/**
 * Rutas de zonas y sillas: dos routers para un solo módulo (API.md 7.6 y 7.7).
 *
 * `zones` y `chairs` son el MISMO dominio (las sillas viven dentro de una zona),
 * así que comparten service y repositorios, pero son dos prefijos distintos en el
 * contrato y por eso son dos `Router` exportados desde aquí. `modules/index.ts`
 * monta los dos:
 *
 *   { name: 'zones', path: '/zones', router: zonesRouter }
 *   { name: 'chairs', path: '/chairs', router: chairsRouter }
 *
 * ============================== SEGURIDAD ===================================
 *  - Todas exigen `authenticate`: sin credencial, 401 `MISSING_TOKEN`
 *    (BR-SEC-005).
 *  - Todas exigen además su permiso de DESIGN.md 9.2. Los roles nunca se
 *    escriben a mano: salen de `shared/domain/permissions.ts`, y el middleware los
 *    contrasta contra `role_permissions` en la base de datos.
 *  - El ALCANCE lo resuelve el service, no el middleware. `chairs:read` lo tiene un
 *    `CUSTOMER` con marca `P`: puede leer el mapa, no editarlo. Un `CUSTOMER` que
 *    intente crear una silla recibe 403 aquí, antes de tocar la base de datos.
 *  - El orden de la cadena es siempre `authenticate -> requirePermission ->
 *    validate -> handler`: primero la identidad, luego la autorización y sólo
 *    después la forma de la petición. Así un `CUSTOMER` recibe 403 y no 400 por un
 *    campo mal formado (API.md 2).
 *
 * ============================== ORDEN DE RUTAS ==============================
 * Express enruta por ORDEN DE DECLARACIÓN, no por especificidad. Por eso
 * `GET /chairs/map` se declara ANTES que `GET /chairs/:id`: si se invirtiera,
 * `map` se interpretaría como un id y devolvería 400.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { asyncHandler } from '../../shared/http/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { SpacesController } from './spaces.controller.js';
import { getSpacesService } from './spaces.provider.js';
import {
  CHAIR_HISTORY_SORT_COLUMNS,
  CHAIR_HISTORY_SORT_DEFAULT,
  CHAIR_SORT_COLUMNS,
  CHAIR_SORT_DEFAULT,
  ZONE_SORT_COLUMNS,
  ZONE_SORT_DEFAULT,
  blockChairBodySchema,
  chairAvailabilityQuerySchema,
  chairHistoryQuerySchema,
  chairIdParamsSchema,
  chairMapQuerySchema,
  completeMaintenanceBodySchema,
  createChairBodySchema,
  createZoneBodySchema,
  deleteChairBodySchema,
  listChairsQuerySchema,
  listZonesQuerySchema,
  maintenanceChairBodySchema,
  reorderZonesBodySchema,
  setChairStatusBodySchema,
  updateChairBodySchema,
  updateZoneBodySchema,
  zoneIdParamsSchema,
} from './spaces.schemas.js';

/** Controller único del módulo, construido por el proveedor de composición. */
const controller = new SpacesController(getSpacesService());

/** Router de `/api/v1/zones`. */
export const zonesRouter: Router = Router();

/** Router de `/api/v1/chairs`. */
export const chairsRouter: Router = Router();

// ---------------------------------------------------------------------------
// Zonas (API.md 7.6)
// ---------------------------------------------------------------------------

/** `GET /zones` — `zones:read`. */
zonesRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.ZONES_READ),
  validate({
    query: listZonesQuerySchema,
    sortable: { allowedColumns: ZONE_SORT_COLUMNS, defaultColumn: ZONE_SORT_DEFAULT, defaultOrder: 'asc' },
  }),
  controller.listZones,
);

/**
 * `POST /zones/reorder` se declara ANTES que `POST /:id/...` por claridad de
 * lectura, aunque no hay colisión real: `reorder` no puede ser un id.
 */
zonesRouter.post(
  '/reorder',
  authenticate,
  requirePermission(PERMISSION.ZONES_UPDATE),
  validate({ body: reorderZonesBodySchema }),
  controller.reorderZones,
);

/** `POST /zones` — `zones:create`. */
zonesRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.ZONES_CREATE),
  validate({ body: createZoneBodySchema }),
  controller.createZone,
);

/** `GET /zones/:id` — `zones:read`. */
zonesRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.ZONES_READ),
  validate({ params: zoneIdParamsSchema }),
  asyncHandler(controller.getZone),
);

/** `PATCH /zones/:id` — `zones:update`. */
zonesRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.ZONES_UPDATE),
  validate({ params: zoneIdParamsSchema, body: updateZoneBodySchema }),
  controller.updateZone,
);

/** `DELETE /zones/:id` — `zones:delete`. Soft delete. */
zonesRouter.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.ZONES_DELETE),
  validate({ params: zoneIdParamsSchema }),
  controller.deleteZone,
);

// ---------------------------------------------------------------------------
// Sillas (API.md 7.7)
// ---------------------------------------------------------------------------

/**
 * `GET /chairs/map` — `chairs:map`. ANTES de `/:id` a propósito (ver cabecera).
 * Sin paginación: el mapa se pinta entero (BR-CHAIR-006).
 */
chairsRouter.get(
  '/map',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_MAP),
  validate({ query: chairMapQuerySchema }),
  controller.getMap,
);

/** `GET /chairs` — `chairs:read`. */
chairsRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_READ),
  validate({
    query: listChairsQuerySchema,
    sortable: { allowedColumns: CHAIR_SORT_COLUMNS, defaultColumn: CHAIR_SORT_DEFAULT, defaultOrder: 'asc' },
  }),
  controller.listChairs,
);

/** `POST /chairs` — `chairs:create`. */
chairsRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_CREATE),
  validate({ body: createChairBodySchema }),
  controller.createChair,
);

/** `GET /chairs/:id/availability` — `chairs:read`. ANTES que `/:id`. */
chairsRouter.get(
  '/:id/availability',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_READ),
  validate({ params: chairIdParamsSchema, query: chairAvailabilityQuerySchema }),
  asyncHandler(controller.availability),
);

/** `GET /chairs/:id/history` — `chairs:history:read` (CASHIER+). */
chairsRouter.get(
  '/:id/history',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_HISTORY_READ),
  validate({
    params: chairIdParamsSchema,
    query: chairHistoryQuerySchema,
    sortable: {
      allowedColumns: CHAIR_HISTORY_SORT_COLUMNS,
      defaultColumn: CHAIR_HISTORY_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  asyncHandler(controller.history),
);

/** `PATCH /chairs/:id/status` — `chairs:status:update`. */
chairsRouter.patch(
  '/:id/status',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_STATUS_UPDATE),
  validate({ params: chairIdParamsSchema, body: setChairStatusBodySchema }),
  controller.setChairStatus,
);

/** `POST /chairs/:id/block` — `chairs:status:update`. */
chairsRouter.post(
  '/:id/block',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_STATUS_UPDATE),
  validate({ params: chairIdParamsSchema, body: blockChairBodySchema }),
  controller.blockChair,
);

/** `POST /chairs/:id/unblock` — `chairs:status:update`. Sin cuerpo. */
chairsRouter.post(
  '/:id/unblock',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_STATUS_UPDATE),
  validate({ params: chairIdParamsSchema }),
  asyncHandler(controller.unblockChair),
);

/** `POST /chairs/:id/maintenance` — `chairs:status:update`. */
chairsRouter.post(
  '/:id/maintenance',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_STATUS_UPDATE),
  validate({ params: chairIdParamsSchema, body: maintenanceChairBodySchema }),
  controller.maintenanceChair,
);

/** `POST /chairs/:id/complete-maintenance` — `chairs:status:update`. Cuerpo opcional. */
chairsRouter.post(
  '/:id/complete-maintenance',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_STATUS_UPDATE),
  validate({ params: chairIdParamsSchema, body: completeMaintenanceBodySchema }),
  asyncHandler(controller.completeMaintenance),
);

/** `GET /chairs/:id` — `chairs:read`. */
chairsRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_READ),
  validate({ params: chairIdParamsSchema }),
  asyncHandler(controller.getChair),
);

/** `PATCH /chairs/:id` — `chairs:update`. */
chairsRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_UPDATE),
  validate({ params: chairIdParamsSchema, body: updateChairBodySchema }),
  controller.updateChair,
);

/** `DELETE /chairs/:id` — `chairs:delete`. Exige `reason` (API.md 7.7). */
chairsRouter.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CHAIRS_DELETE),
  validate({ params: chairIdParamsSchema, body: deleteChairBodySchema }),
  controller.deleteChair,
);
