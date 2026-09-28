/**
 * PUNTO DE EXTENSIÓN DE MÓDULOS.
 *
 * Cada módulo de negocio (auth, users, customers, business, locations, zones,
 * chairs, reservations, rentals, categories, products, orders, payments,
 * discounts, inventory, notifications, reports, audit) se montará aquí, y sólo
 * aquí. `app.ts` no conoce los módulos: llama a `createApiV1Router()`.
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
 * Módulos montados: `system` (salud y metadatos), `auth`, `users` y
 * `customers`. Cada uno de los tres últimos sigue la misma estructura interna:
 * `*.routes.ts` delgado, `*.controller.ts` que traduce HTTP, `*.service.ts` con
 * la lógica de negocio, `*.repository.ts` como contrato y
 * `*.repository.sqlite.ts` como único fichero con SQL.
 */
import { Router } from 'express';

import { API_PREFIX } from '../config/index.js';
import { authRateLimit, isAuthPath } from '../shared/middleware/rate-limit.js';
import { authRouter } from './auth/auth.routes.js';
import { customersRouter } from './customers/customers.routes.js';
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
