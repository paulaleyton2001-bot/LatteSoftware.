/**
 * Rutas de la configuración del negocio: `/api/v1/business` (API.md 7.4) más el
 * endpoint auxiliar `GET /api/v1/business/status`.
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): declara método, path,
 * middlewares y handler. No lee `req.body` sin validar, no decide permisos de
 * negocio y no importa repositorios.
 *
 * ============================== SEGURIDAD ===================================
 *  - `GET /` y `GET /status` son PÚBLICOS con `optionalAuthenticate`: el cliente
 *    móvil los necesita antes de iniciar sesión para pintar precios y si el
 *    local está abierto. Sin token, la respuesta es la proyección sin datos
 *    fiscales; con token y `business:read`, la configuración completa. Un token
 *    INVÁLIDO sigue siendo `401` (`optionalAuthenticate` verifica si viene
 *    alguno), así que la puerta pública no abre la puerta autenticada.
 *  - `GET /hours` y `GET /holidays` exigen `business:read`: son configuración de
 *    gestión.
 *  - `PATCH /`, `PUT /hours`, `POST|DELETE /holidays` exigen sus permisos reales
 *    de `shared/domain/permissions.ts` (`business:update`,
 *    `business:hours:update`, `business:holidays:manage`). El enunciado
 *    mencionaba `business:manage`, clave que NO existe: el catálogo real es una
 *    clave por acción, y es el que se usa.
 *  - Los dos endpoints públicos llevan un límite de tasa PROPIO, más corto que
 *    el global: son la única defensa de una ruta sin credencial.
 *  - El orden de la cadena es siempre `authenticate -> requirePermission ->
 *    validate -> handler`: primero identidad, luego autorización, y sólo después
 *    la forma de la petición. Así un `CUSTOMER` recibe 403 y no 400 por un campo
 *    mal formado.
 *
 * ============================== ORDEN DE RUTAS =============================
 * Express enruta en orden de declaración. `/status` es una ruta LITERAL de un
 * segmento, igual que `/:id` lo sería: por eso se declara ANTES de cualquier
 * ruta parametrizada. Aquí sólo hay una, pero la convención se deja escrita para
 * que quien añada `/:id` no la mount al revés.
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
import { BusinessController } from './business.controller.js';
import { getBusinessServices } from './business.container.js';
import {
  businessHolidayIdParamsSchema,
  createBusinessHolidayBodySchema,
  listBusinessHolidaysQuerySchema,
  replaceBusinessHoursBodySchema,
  updateBusinessBodySchema,
} from './business.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const services = getBusinessServices();

const controller = new BusinessController(services.business);

/**
 * Límite de tasa de las lecturas PÚBLICAS del negocio.
 *
 * Es público y devuelve configuración del negocio, así que su presupuesto es más
 * corto que el del global. Hereda el interruptor global de los tests
 * (`isRateLimitingEnabled`) para que una suite que dispare peticiones en bucle
 * no se encuentre con un 429 inesperado.
 */
const publicBusinessRateLimit = rateLimit({
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
      new RateLimitError('Demasiadas consultas de la configuración. Inténtelo de nuevo en unos segundos.', {
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

/** Router de la configuración del negocio. Se monta bajo `/api/v1/business`. */
export const businessRouter: Router = Router();

/**
 * `GET /api/v1/business` — PÚBLICA.
 *
 * Proyección pública sin token, configuración completa con `business:read`.
 */
businessRouter.get('/', publicBusinessRateLimit, optionalAuthenticate, controller.get);

/**
 * `GET /api/v1/business/status` — PÚBLICA. ¿Está el local abierto ahora?
 *
 * DESVIACIÓN DOCUMENTADA: `docs/API.md` NO define este endpoint; hay que añadir
 * una sección para él (ver el informe de entrega).
 */
businessRouter.get('/status', publicBusinessRateLimit, optionalAuthenticate, controller.status);

/**
 * `PATCH /api/v1/business` — `business:update`.
 *
 * `id` no es un campo admitido: mandarlo es `400 UNKNOWN_FIELD` y no un cambio
 * de identidad. Cambiar `currencyCode` con pedidos ya creados es
 * `409 CURRENCY_CHANGE_BLOCKED` (decisión documentada en el service).
 */
businessRouter.patch(
  '/',
  authenticate,
  requirePermission(PERMISSION.BUSINESS_UPDATE),
  validate({ body: updateBusinessBodySchema }),
  controller.update,
);

/** `GET /api/v1/business/hours` — `business:read`. Siempre siete días. */
businessRouter.get(
  '/hours',
  authenticate,
  requirePermission(PERMISSION.BUSINESS_READ),
  controller.getHours,
);

/** `PUT /api/v1/business/hours` — `business:hours:update`. Reemplaza la semana. */
businessRouter.put(
  '/hours',
  authenticate,
  requirePermission(PERMISSION.BUSINESS_HOURS_UPDATE),
  validate({ body: replaceBusinessHoursBodySchema }),
  controller.replaceHours,
);

/** `GET /api/v1/business/holidays` — `business:read`. */
businessRouter.get(
  '/holidays',
  authenticate,
  requirePermission(PERMISSION.BUSINESS_READ),
  validate({
    query: listBusinessHolidaysQuerySchema,
    sortable: { allowedColumns: ['holiday_date'], defaultColumn: 'holiday_date', defaultOrder: 'desc' },
  }),
  controller.listHolidays,
);

/** `POST /api/v1/business/holidays` — `business:holidays:manage` (201). */
businessRouter.post(
  '/holidays',
  authenticate,
  requirePermission(PERMISSION.BUSINESS_HOLIDAYS_MANAGE),
  validate({ body: createBusinessHolidayBodySchema }),
  controller.createHoliday,
);

/** `DELETE /api/v1/business/holidays/:id` — `business:holidays:manage`. */
businessRouter.delete(
  '/holidays/:id',
  authenticate,
  requirePermission(PERMISSION.BUSINESS_HOLIDAYS_MANAGE),
  validate({ params: businessHolidayIdParamsSchema }),
  controller.deleteHoliday,
);
