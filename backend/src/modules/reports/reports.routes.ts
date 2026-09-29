/**
 * Rutas de `/api/v1/reports` (API.md 7.16).
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): método, path,
 * middlewares y handler. Nada de lógica de negocio ni de SQL.
 *
 * ============================== SEGURIDAD ===================================
 *  - Permisos: `reports:read` para los once GET y `reports:export` para el
 *    `POST /export`. Son las dos claves REALES de
 *    `shared/domain/permissions.ts`.
 *
 * ====================== DESVIACIÓN DE LA MATRIZ DE RBAC ======================
 * La matriz de DESIGN.md 9.3 concede `reports:read` también a `CASHIER`. Este
 * módulo NO se fía de esa fila: un cajero no necesita la foto de ventas, el
 * margen por producto ni la valorización del inventario de la empresa, y esos
 * datos son exactamente los que un tercero querría ver. Por eso, ADEMÁS del
 * permiso, los doce endpoints exigen `requireRoles(MANAGER, ADMIN, OWNER)`.
 *
 * El orden importa y está elegido a propósito: `requirePermission` va PRIMERO,
 * así que un `CUSTOMER` (que no tiene el permiso) recibe 403 con
 * `details.code = 'INSUFFICIENT_PERMISSIONS'` y `details.required =
 * 'reports:read'`, que es el error útil; un `CASHIER` (que sí lo tiene según la
 * matriz, pero no el rol) recibe `INSUFFICIENT_ROLE`. Los dos son 403 y los dos
 * dicen qué falta.
 *
 * Si la matriz de `database/seeds/roles-permissions.seed.ts` se cambia para
 * quitar `reports:read` al cajero, `requireRoles` de aquí sobra y se puede
 * borrar: es una defensa por capas, no un sustituto.
 * El cliente que quiere SU historial ya tiene `GET /customers/:id/orders`, que
 * además le filtra por su propio id.
 *  - Orden de la cadena: `authenticate -> requirePermission -> requireRoles ->
 *    validate -> handler`. Así un usuario sin acceso recibe 403 y no 400 por un
 *    campo mal formado.
 *  - El `POST /export` lleva un límite de tasa PROPIO (10 por hora) además del
 *    global: es la única forma de que un ADMIN autorizado extraiga el histórico
 *    entero de ventas, así que un presupuesto corto es la defensa razonable.
 *
 * ============================== ORDEN DE RUTAS =============================
 * Todas las rutas son LITERALES: no hay ningún `/:id` en este módulo, así que
 * el orden de declaración no importa. Aun así se agrupan primero las de resumen
 * y al final la exportación, que es la única con cuerpo.
 */
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { PERMISSION, Role } from '../../shared/domain/index.js';
import { ERROR_CODE, RateLimitError } from '../../shared/errors/index.js';
import { sendError } from '../../shared/http/index.js';
import { authenticate, requirePermission, requireRoles, validate } from '../../shared/middleware/index.js';
import { isRateLimitingEnabled } from '../../shared/middleware/rate-limit.js';
import { getReportsServices } from './reports.container.js';
import { ReportsController } from './reports.controller.js';
import {
  chairOccupancyQuerySchema,
  customersQuerySchema,
  dashboardQuerySchema,
  exportBodySchema,
  inventoryQuerySchema,
  ordersSummaryQuerySchema,
  productRevenueQuerySchema,
  rentalRevenueQuerySchema,
  salesByDayQuerySchema,
  salesByHourQuerySchema,
  salesQuerySchema,
  topProductsQuerySchema,
} from './reports.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const controller = new ReportsController(getReportsServices().reports);

/**
 * Rol mínimo para CUALQUIER reporte.
 *
 * Ver la nota de desviación de la matriz en la cabecera del fichero. Se
 * construye UNA vez y se comparte entre las doce rutas: la lista de roles es
 * la misma en todas y tenerla en un solo sitio deja claro que la política es
 * única, no una decisión ruta por ruta.
 */
const reportRoles = requireRoles(Role.MANAGER, Role.ADMIN, Role.OWNER);

/**
 * Límite de tasa PROPIO de la exportación: 10 por hora (API.md 7.16).
 *
 * Hereda el interruptor global de los tests (`isRateLimitingEnabled`) para que
 * una suite que exporte en bucle no se encuentre con un 429 inesperado.
 */
const exportRateLimit = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req): string => ipKeyGenerator(req.ip ?? '0.0.0.0'),
  skip: (): boolean => !isRateLimitingEnabled(),
  handler: (req, res, _next, optionsUsed) => {
    const retryAfterSeconds = Math.max(1, Math.ceil((optionsUsed.windowMs ?? 3_600_000) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendError(
      res,
      new RateLimitError('Demasiadas exportaciones. Inténtelo de nuevo en una hora.', {
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

/** Router de reportes. Se monta bajo `/api/v1/reports`. */
export const reportsRouter: Router = Router();

/** `GET /api/v1/reports/dashboard` — `reports:read`. */
reportsRouter.get(
  '/dashboard',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: dashboardQuerySchema }),
  controller.dashboard,
);

/** `GET /api/v1/reports/sales` — `reports:read`. */
reportsRouter.get(
  '/sales',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: salesQuerySchema }),
  controller.sales,
);

/** `GET /api/v1/reports/sales-by-hour` — `reports:read`. */
reportsRouter.get(
  '/sales-by-hour',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: salesByHourQuerySchema }),
  controller.salesByHour,
);

/** `GET /api/v1/reports/sales-by-day` — `reports:read`. */
reportsRouter.get(
  '/sales-by-day',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: salesByDayQuerySchema }),
  controller.salesByDay,
);

/** `GET /api/v1/reports/top-products` — `reports:read`. */
reportsRouter.get(
  '/top-products',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: topProductsQuerySchema }),
  controller.topProducts,
);

/** `GET /api/v1/reports/product-revenue` — `reports:read`. */
reportsRouter.get(
  '/product-revenue',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: productRevenueQuerySchema }),
  controller.productRevenue,
);

/** `GET /api/v1/reports/chair-occupancy` — `reports:read`. */
reportsRouter.get(
  '/chair-occupancy',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: chairOccupancyQuerySchema }),
  controller.chairOccupancy,
);

/** `GET /api/v1/reports/rental-revenue` — `reports:read`. */
reportsRouter.get(
  '/rental-revenue',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: rentalRevenueQuerySchema }),
  controller.rentalRevenue,
);

/** `GET /api/v1/reports/customers` — `reports:read`. */
reportsRouter.get(
  '/customers',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: customersQuerySchema }),
  controller.customers,
);

/** `GET /api/v1/reports/inventory` — `reports:read`. */
reportsRouter.get(
  '/inventory',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: inventoryQuerySchema }),
  controller.inventory,
);

/** `GET /api/v1/reports/orders-summary` — `reports:read`. */
reportsRouter.get(
  '/orders-summary',
  authenticate,
  requirePermission(PERMISSION.REPORTS_READ),
  reportRoles,
  validate({ query: ordersSummaryQuerySchema }),
  controller.ordersSummary,
);

/**
 * `POST /api/v1/reports/export` — `reports:export`.
 *
 * Única ruta con cuerpo y única respuesta sin envoltorio JSON. Su límite de tasa
 * propio está declarado arriba, en este mismo fichero, para que quien lo lea
 * vea la defensa junto a la ruta que protege.
 */
reportsRouter.post(
  '/export',
  authenticate,
  requirePermission(PERMISSION.REPORTS_EXPORT),
  reportRoles,
  exportRateLimit,
  validate({ body: exportBodySchema }),
  controller.export,
);
