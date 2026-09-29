/**
 * Rutas de la bandeja de notificaciones: `/api/v1/notifications` (API.md 7.17).
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): declara método, path,
 * middlewares y handler. No lee `req.body` sin validar, no decide permisos de
 * negocio y no importa repositorios.
 *
 * ============================== SEGURIDAD ===================================
 *  - TODAS exigen `authenticate` + `notifications:read`, que es el permiso real
 *    de DESIGN.md 9.2. No existe `notifications:manage` y no se inventa.
 *  - **El alcance lo resuelve el service, no el middleware** (RBAC `P`): un
 *    `CUSTOMER` puede pedir `/notifications` porque tiene el permiso, y lo que ve
 *    son SUS notificaciones. Un `?userId=` ajeno es `404` para el cliente
 *    (BR-SEC-011) y se honra para el personal.
 *  - `PUT /preferences` exige `notifications:update_preferences`, que también
 *    tiene todo el mundo con marca `P`: sólo cambia las preferencias propias,
 *    porque el `user_id` sale del token.
 *  - El orden de la cadena es siempre `authenticate -> requirePermission ->
 *    validate -> handler`.
 *
 * ============================== ORDEN DE RUTAS =============================
 * Express enruta en orden de declaración y `/unread-count`, `/preferences` y
 * `/read-all` son rutas LITERALES con la misma forma que un `/:id`. Por eso se
 * declaran TODAS ANTES que `/:id/read`: si se invirtieran, `GET
 * /notifications/preferences` caería en un id y fallaría con "el identificador
 * debe ser un número entero".
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import {
  authenticate,
  requirePermission,
  validate,
} from '../../shared/middleware/index.js';
import { NotificationsController } from './notifications.controller.js';
import { getNotificationsServices } from './notifications.container.js';
import {
  NOTIFICATION_SORT_COLUMNS,
  NOTIFICATION_SORT_DEFAULT,
  listNotificationsQuerySchema,
  notificationIdParamsSchema,
  readAllNotificationsBodySchema,
  updateNotificationPreferencesBodySchema,
} from './notifications.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const services = getNotificationsServices();

const controller = new NotificationsController(services.inbox);

/** Router de notificaciones. Se monta bajo `/api/v1/notifications`. */
export const notificationsRouter: Router = Router();

/**
 * `GET /api/v1/notifications` — `notifications:read`.
 *
 * Orden por defecto: `created_at DESC` (lo más reciente primero), que es como se
 * pinta una bandeja. `meta.unreadCount` acompaña al listado.
 */
notificationsRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.NOTIFICATIONS_READ),
  validate({
    query: listNotificationsQuerySchema,
    sortable: {
      allowedColumns: NOTIFICATION_SORT_COLUMNS,
      defaultColumn: NOTIFICATION_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.list,
);

/** `GET /api/v1/notifications/unread-count` — `notifications:read`. Agregación. */
notificationsRouter.get(
  '/unread-count',
  authenticate,
  requirePermission(PERMISSION.NOTIFICATIONS_READ),
  controller.unreadCount,
);

/** `GET /api/v1/notifications/preferences` — `notifications:read`. Crea si falta. */
notificationsRouter.get(
  '/preferences',
  authenticate,
  requirePermission(PERMISSION.NOTIFICATIONS_READ),
  controller.getPreferences,
);

/** `PUT /api/v1/notifications/preferences` — `notifications:update_preferences`. */
notificationsRouter.put(
  '/preferences',
  authenticate,
  requirePermission(PERMISSION.NOTIFICATIONS_UPDATE_PREFERENCES),
  validate({ body: updateNotificationPreferencesBodySchema }),
  controller.updatePreferences,
);

/** `POST /api/v1/notifications/read-all` — `notifications:read`. */
notificationsRouter.post(
  '/read-all',
  authenticate,
  requirePermission(PERMISSION.NOTIFICATIONS_READ),
  validate({ body: readAllNotificationsBodySchema }),
  controller.readAll,
);

/**
 * `POST /api/v1/notifications/:id/read` — `notifications:read`.
 * Idempotente; `404` si la notificación no es del actor.
 */
notificationsRouter.post(
  '/:id/read',
  authenticate,
  requirePermission(PERMISSION.NOTIFICATIONS_READ),
  validate({ params: notificationIdParamsSchema }),
  controller.markRead,
);
