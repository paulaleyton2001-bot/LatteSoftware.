/**
 * Rutas de las sedes: `/api/v1/locations` (API.md 7.5).
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): declara método, path,
 * middlewares y handler. No lee `req.body` sin validar, no decide permisos de
 * negocio y no importa repositorios.
 *
 * ============================== SEGURIDAD ===================================
 *  - `GET /` y `GET /:id` son PÚBLICOS con `optionalAuthenticate`: el cliente
 *    necesita elegir sede para reservar antes de tener sesión, y la sede sólo
 *    expone nombre, dirección, teléfono y estado. Un token INVÁLIDO sigue siendo
 *    `401` (`optionalAuthenticate` verifica si viene alguno), así que la puerta
 *    pública no abre la puerta de escritura.
 *  - `POST /`, `PATCH /:id` y `DELETE /:id` exigen las claves REALES de
 *    `shared/domain/permissions.ts`: `locations:create` y `locations:update`. No
 *    existe `locations:manage` ni `locations:delete` en DESIGN.md 9.2 y no se
 *    inventa ninguna: la baja lógica de una sede es una edición de
 *    configuración, luego usa `locations:update`.
 *  - `DELETE` y `PATCH` comparten `/:id`, así que `validate({ params })` es
 *    idéntico en las dos y sólo se declara una vez.
 *  - El orden de la cadena es siempre `authenticate -> requirePermission ->
 *    validate -> handler`: primero identidad, luego autorización, y sólo después
 *    la forma de la petición.
 */
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { PERMISSION } from '../../shared/domain/index.js';
import { ERROR_CODE, RateLimitError } from '../../shared/errors/index.js';
import { sendError } from '../../shared/http/index.js';
import {
  authenticate,
  optionalAuthenticate,
  requirePermission,
  validate,
} from '../../shared/middleware/index.js';
import { isRateLimitingEnabled } from '../../shared/middleware/rate-limit.js';
import { LocationsController } from './locations.controller.js';
import { getLocationsServices } from './locations.container.js';
import {
  LOCATION_SORT_COLUMNS,
  LOCATION_SORT_DEFAULT,
  createLocationBodySchema,
  listLocationsQuerySchema,
  locationIdParamsSchema,
  updateLocationBodySchema,
} from './locations.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const services = getLocationsServices();

const controller = new LocationsController(services.locations);

/**
 * Límite de tasa de las lecturas PÚBLICAS de sedes.
 *
 * Es público, así que su presupuesto es más corto que el del global. Hereda el
 * interruptor global de los tests para que una suite que dispare peticiones en
 * bucle no se encuentre con un 429 inesperado.
 */
const publicLocationsRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req): string => ipKeyGenerator(req.ip ?? '0.0.0.0'),
  skip: (): boolean => !isRateLimitingEnabled(),
  handler: (req, res, _next, optionsUsed) => {
    const retryAfterSeconds = Math.max(1, Math.ceil((optionsUsed.windowMs ?? 60_000) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendError(
      res,
      new RateLimitError('Demasiadas consultas de sedes. Inténtelo de nuevo en unos segundos.', {
        details: {
          code: ERROR_CODE.RATE_LIMIT,
          limit: optionsUsed.limit,
          windowMs: optionsUsed.windowMs,
          retryAfterSeconds,
          path: req.path,
        },
      }),
    );
  },
});

/** Router de sedes. Se monta bajo `/api/v1/locations`. */
export const locationsRouter: Router = Router();

/** `GET /api/v1/locations` — PÚBLICA. Sólo sedes activas por defecto. */
locationsRouter.get(
  '/',
  publicLocationsRateLimit,
  optionalAuthenticate,
  validate({
    query: listLocationsQuerySchema,
    sortable: {
      allowedColumns: LOCATION_SORT_COLUMNS,
      defaultColumn: LOCATION_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  controller.list,
);

/** `POST /api/v1/locations` — `locations:create` (201). */
locationsRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.LOCATIONS_CREATE),
  validate({ body: createLocationBodySchema }),
  controller.create,
);

/**
 * `GET /api/v1/locations/:id` — PÚBLICA. Sede con sus zonas y `stats`.
 */
locationsRouter.get(
  '/:id',
  publicLocationsRateLimit,
  optionalAuthenticate,
  validate({ params: locationIdParamsSchema }),
  controller.getById,
);

/** `PATCH /api/v1/locations/:id` — `locations:update`. */
locationsRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.LOCATIONS_UPDATE),
  validate({ params: locationIdParamsSchema, body: updateLocationBodySchema }),
  controller.update,
);

/**
 * `DELETE /api/v1/locations/:id` — `locations:update`. Baja lógica.
 *
 * `409 LOCATION_HAS_ACTIVE_ZONES` si la sede tiene zonas (BR-LOC-001).
 * DESVIACIÓN DOCUMENTADA: la tabla de endpoints de API.md 7.5 no lista este
 * `DELETE`, pero la introducción de la sección 7 cuenta "DELETE de ... locales".
 */
locationsRouter.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.LOCATIONS_UPDATE),
  validate({ params: locationIdParamsSchema }),
  controller.remove,
);
