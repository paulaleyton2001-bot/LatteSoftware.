/**
 * PUNTO DE EXTENSIÓN DE MÓDULOS.
 *
 * Cada módulo de negocio (auth, users, customers, business, locations, zones,
 * chairs, reservations, rentals, categories, products, orders, payments,
 * discounts, inventory, notifications, reports) se monta aquí, y sólo aquí.
 * `app.ts` no conoce los módulos: llama a `createApiV1Router()`. La auditoría no
 * aparece en la lista porque no es un módulo HTTP: es un repositorio compartido
 * (`shared/database/audit.repository.ts`) que los services escriben, no un prefijo.
 *
 * ===================== CÓMO AÑADIR UN MÓDULO =====================
 *  1. `src/modules/<nombre>/<nombre>.routes.ts` con su `Router`.
 *  2. Sus handlers usan `asyncHandler` y responden con `sendSuccess` /
 *     `sendCreated` / `sendPaginated` / `sendError` (API.md 3).
 *  3. Validación con `validate({ body, query, params })`: esquemas `.strict()`.
 *  4. Autorización con `authenticate`, `requirePermission('modulo:accion')` y,
 *     si hace falta, `requireRole(Role.X)`. Las claves de permiso salen de
 *     `shared/domain/permissions.ts` (`PERMISSION.USERS_READ`), nunca de un
 *     string suelto.
 *  5. Registrar el router en el array `MODULE_ROUTERS` de este fichero. Si el
 *     módulo se monta en `/auth`, recibe automáticamente el límite de tasa
 *     estricto; no hay que configurarlo a mano.
 *  6. Si el módulo necesita tablas nuevas, crear `000N_<nombre>.sql` en
 *     `src/database/migrations/` y su `.down.sql`.
 *
 * Módulos montados (20 prefijos): `system` (salud y metadatos), `auth`, `users`,
 * `customers`, `business`, `locations`, `zones`, `chairs`, `reservations`,
 * `rentals`, `categories`, `products`, `menu` (público), `inventory`, `orders`,
 * `payments`, `discounts`, `notifications`, `reports` y `system/jobs`. Los de
 * negocio siguen la misma estructura interna: `*.routes.ts` delgado,
 * `*.controller.ts` que traduce HTTP, `*.service.ts` con la lógica de negocio,
 * `*.repository.ts` como contrato y `*.repository.sqlite.ts` como único fichero
 * con SQL.
 *
 * Dos módulos aportan MÁS DE UN preijo porque el contrato los publica así, y son
 * prefijos distintos aunque compartan service y repositorios:
 *  - `spaces`: `zones` y `chairs` (una silla vive dentro de una zona).
 *  - `catalog`: `categories` y `products`, más `menu` como proyección PÚBLICA de
 *    lectura (sin credencial, con su propio límite de tasa).
 *
 * ============================ ORDEN DE MONTAJE ============================
 * El orden de este array es el orden en que Express enruta, así que:
 *  1. `system` va en `/` y sólo declara rutas literales (`/health`, `/meta/*`),
 *     nunca un `/:id`, así que no se come los prefijos siguientes.
 *  2. Los 18 prefijos de negocio son TODOS literales y disjuntos entre sí, así
 *     que el orden relativo entre ellos es de lectura, no de seguridad: se
 *     agrupan por dominio (identidad, tenancy, espacios, agenda, catálogo,
 *     operación, analítica). La única exigencia real es la del punto 3.
 *  3. `system/jobs` se monta al final porque comparte el prefijo `/system` con el
 *     módulo `system`, que ya está montado en `/`.
 */
import { Router } from 'express';

import { API_PREFIX } from '../config/index.js';
import { authRateLimit, isAuthPath } from '../shared/middleware/rate-limit.js';
import { authRouter } from './auth/auth.routes.js';
import { businessRouter } from './business/business.routes.js';
import { categoriesRouter, menuRouter, productsRouter } from './catalog/catalog.routes.js';
import { customersRouter } from './customers/customers.routes.js';
import { discountsRouter } from './discounts/discounts.routes.js';
import { inventoryRouter } from './inventory/inventory.routes.js';
import { locationsRouter } from './locations/locations.routes.js';
import { notificationsRouter } from './notifications/notifications.routes.js';
import { ordersRouter } from './orders/orders.routes.js';
import { paymentsRouter } from './payments/payments.routes.js';
import { rentalsRouter } from './rentals/rentals.routes.js';
import { reportsRouter } from './reports/reports.routes.js';
import { systemJobsRouter } from './reservations/reservations.jobs.js';
import { reservationsRouter } from './reservations/reservations.routes.js';
import { chairsRouter, zonesRouter } from './spaces/spaces.routes.js';
import { systemRouter } from './system/system.routes.js';
import { usersRouter } from './users/users.routes.js';

/** Descripción de un módulo montado bajo `/api/v1`. */
export interface ModuleRegistration {
  /** Nombre del módulo, tal y como aparece en el árbol de rutas. */
  readonly name: string;
  /** Prefijo relativo a `/api/v1`, p. ej. `/chairs`. */
  readonly path: string;
  /** Router ya construido con sus middlewares. */
  readonly router: Router;
}

/**
 * Módulos montados. Para añadir uno, basta una entrada más: el orden importa
 * porque Express enruta por prefijo, así que los prefijos literales (`/meta`,
 * `/health`) deben declararse antes que los parametrizados.
 */
export const MODULE_ROUTERS: readonly ModuleRegistration[] = Object.freeze([
  { name: 'system', path: '/', router: systemRouter },
  { name: 'auth', path: '/auth', router: authRouter },
  { name: 'users', path: '/users', router: usersRouter },
  { name: 'customers', path: '/customers', router: customersRouter },
  { name: 'business', path: '/business', router: businessRouter },
  { name: 'locations', path: '/locations', router: locationsRouter },
  { name: 'zones', path: '/zones', router: zonesRouter },
  { name: 'chairs', path: '/chairs', router: chairsRouter },
  { name: 'reservations', path: '/reservations', router: reservationsRouter },
  { name: 'rentals', path: '/rentals', router: rentalsRouter },
  { name: 'categories', path: '/categories', router: categoriesRouter },
  { name: 'products', path: '/products', router: productsRouter },
  { name: 'menu', path: '/menu', router: menuRouter },
  { name: 'inventory', path: '/inventory', router: inventoryRouter },
  { name: 'orders', path: '/orders', router: ordersRouter },
  { name: 'payments', path: '/payments', router: paymentsRouter },
  { name: 'discounts', path: '/discounts', router: discountsRouter },
  { name: 'notifications', path: '/notifications', router: notificationsRouter },
  { name: 'reports', path: '/reports', router: reportsRouter },
  { name: 'system-jobs', path: '/system/jobs', router: systemJobsRouter },
]);

/** Opciones de {@link createApiV1Router}. */
export interface ApiV1RouterOptions {
  /**
   * No montar los límites de tasa (global y de autenticación). Sólo para tests
   * que disparan peticiones en bucle y no quieren un 429 inesperado; el test que
   * verifica el rate limit los deja activos a propósito.
   */
  readonly disableRateLimit?: boolean;
}

/**
 * Construye el router de la API v1 con todos los módulos registrados.
 * `app.ts` lo monta en `API_PREFIX` una sola vez.
 */
export function createApiV1Router(options: ApiV1RouterOptions = {}): Router {
  const router = Router();
  const limited = options.disableRateLimit !== true;
  for (const module of MODULE_ROUTERS) {
    // El límite estricto de autenticación se aplica por ruta, no por
    // configuración: basta con montar el módulo en `/auth` y queda protegido
    // contra fuerza bruta sin que el autor del módulo tenga que acordarse.
    if (limited && isAuthPath(module.path)) {
      router.use(module.path, authRateLimit);
    }
    router.use(module.path, module.router);
  }
  return router;
}

/** Rutas públicas de la API, para el log de arranque. */
export function publicRouteSummary(): string[] {
  return MODULE_ROUTERS.map((module) => `${API_PREFIX}${module.path}`);
}
