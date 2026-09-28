/**
 * Jobs del sistema de la familia de espacios (API.md 7.19 `System`).
 *
 * ============================================================================
 * POR QUÉ EXISTE `POST /api/v1/system/jobs/expire-reservations`
 * ============================================================================
 * BR-RES-004 dice que un `PENDING` vence si `now > start_at + 30 min` sin
 * check-in, y un `CONFIRMED` vence si `now > end_at` sin check-in. Quien aplica esa
 * regla es un proceso de fondo (`worker/scheduler.ts` en DESIGN.md 2.2), que en
 * este despliegue todavía no existe.
 *
 * ============================================================================
 * LA LÓGICA NO DEPENDE DEL TRANSPORTE
 * ============================================================================
 * La regla vive en `ReservationsService.expireOverdueReservations(nowIso?)`, que
 * recibe el instante por parámetro y no sabe nada de HTTP. Este router sólo la
 * invoca. Dos consecuencias: el worker futuro puede llamarla sin HTTP, y un test
 * puede simular el paso del tiempo sin esperar (ver `tests/reservations.spec.ts`).
 *
 * ============================================================================
 * CABLEADO EN `modules/index.ts`
 * ============================================================================
 * Montado como `{ name: 'system-jobs', path: '/system/jobs', router: systemJobsRouter }`.
 * Se declara AL FINAL del array de módulos: el módulo `system` ya está montado en
 * `/` y sólo tiene rutas literales (`/health`, `/meta/*`), así que no intercepta
 * este prefijo.
 *
 * Mientras el worker de fondo no exista, este router es la única forma de
 * disparar la expiración: sin él, una reserva `CONFIRMED` cuyo `end_at` ya pasó
 * seguiría bloqueando la silla indefinidamente.
 *
 * El prefijo es `/system/jobs`. El endpoint exige rol ADMIN/OWNER además del
 * permiso, porque dispara un proceso que muta reservas de TODO el negocio: es la
 * forma más prudente de exponer un job manual.
 */
import { Router } from 'express';

import { PERMISSION, Role } from '../../shared/domain/index.js';
import { asyncHandler, sendSuccess } from '../../shared/http/index.js';
import {
  authenticate,
  requirePermission,
  requireRoles,
  validate,
  type RequestWithAuth,
} from '../../shared/middleware/index.js';
import { getReservationsService } from '../spaces/spaces.provider.js';
import { expireJobBodySchema, type ExpireJobBody } from './reservations.schemas.js';

/** Petición del job: los `validated` los publica el middleware `validate`. */
type JobRequest = RequestWithAuth & { readonly validated?: { readonly body?: unknown } };

/** Router de `/api/v1/system/jobs`. */
export const systemJobsRouter: Router = Router();

/**
 * `POST /api/v1/system/jobs/expire-reservations` — ejecuta la expiración.
 *
 * Cuerpo opcional:
 *  - `now`: instante de referencia. Permite probar la caducidad sin esperar; en
 *    producción se omite y se usa el reloj del servidor.
 *  - `limit`: tope de reservas procesadas por ejecución (por defecto 200).
 *
 * Idempotente: la segunda ejecución seguida devuelve `expired: 0`, porque las
 * reservas ya marcadas `EXPIRED` ya no están en `PENDING` ni en `CONFIRMED`.
 */
systemJobsRouter.post(
  '/expire-reservations',
  authenticate,
  requirePermission(PERMISSION.RESERVATIONS_UPDATE),
  requireRoles(Role.ADMIN, Role.OWNER),
  validate({ body: expireJobBodySchema }),
  asyncHandler(async (req: JobRequest, res): Promise<void> => {
    const body = (req.validated?.body ?? { limit: 200 }) as ExpireJobBody;
    const result = getReservationsService().expireOverdueReservations(body.now ?? undefined, body.limit);
    sendSuccess(res, result, { appliedRules: ['BR-RES-004'] });
  }),
);
