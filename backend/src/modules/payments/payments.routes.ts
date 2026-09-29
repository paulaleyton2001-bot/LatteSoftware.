/**
 * Rutas de pagos (API.md 7.13).
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): declara método, path,
 * middlewares y handler. No lee `req.body` sin validar, no decide permisos de
 * negocio y no importa repositorios.
 *
 * ============================== ORDEN DE RUTAS =============================
 * `/methods` (un segmento) tiene la misma forma que `/:id`, así que la ruta
 * LITERAL se declara ANTES que la parametrizada: si se invirtiera, un
 * `GET /payments/methods` caería en `/:id` y fallaría con "el identificador debe
 * ser un número entero".
 *
 * =============================== SEGURIDAD ================================
 *  - `payments:create` lo tienen CASHIER, MANAGER, ADMIN y OWNER. Un `CUSTOMER`
 *    recibe 403, nunca 404.
 *  - `payments:refund` es MANAGER+ (DESIGN.md 9.3). Es la única forma de mover
 *    dinero hacia atrás, así que el permiso es alto a propósito.
 *  - El alcance (un `CUSTOMER` sólo ve sus pagos) lo resuelve el service, no el
 *    middleware: `requirePermission` decide acceso al recurso, el service decide
 *    el ámbito (DESIGN.md 9.3, la `P` de la matriz).
 *  - `POST /` exige la cabecera `Idempotency-Key`; sin ella es `400`, y la
 *    comprobación de repetición es del service (`ux_payments_idempotency`).
 *
 * ========================== DECISIÓN DEL NEGOCIO ==========================
 * No hay pasarela de pagos. Los únicos métodos que este router acepta son `CASH`
 * (caja) y `CARD` (datáfono), y ninguna petición sale a la red.
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { PaymentsController } from './payments.controller.js';
import { getPaymentsServices } from './payments.container.js';
import {
  PAYMENTS_SORT_COLUMNS,
  PAYMENTS_SORT_DEFAULT,
  listPaymentsQuerySchema,
  paymentIdParamsSchema,
  refundPaymentBodySchema,
  registerPaymentBodySchema,
} from './payments.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const services = getPaymentsServices();

const controller = new PaymentsController(services.payments);

/** Router de pagos. Se monta bajo `/api/v1/payments`. */
export const paymentsRouter: Router = Router();

/** `GET /api/v1/payments` — `payments:read`. */
paymentsRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.PAYMENTS_READ),
  validate({
    query: listPaymentsQuerySchema,
    sortable: {
      allowedColumns: PAYMENTS_SORT_COLUMNS,
      defaultColumn: PAYMENTS_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.list,
);

/**
 * `GET /api/v1/payments/methods` — `payments:read`.
 * Ruta LITERAL declarada antes que `/:id` (ver la nota de orden de este fichero).
 */
paymentsRouter.get(
  '/methods',
  authenticate,
  requirePermission(PERMISSION.PAYMENTS_READ),
  controller.listMethods,
);

/**
 * `POST /api/v1/payments` — `payments:create` (201, o 200 si es idempotente).
 *
 * La cabecera `Idempotency-Key` se valida en el controller, no aquí: es parte de
 * la forma de la petición y su error es un `400 VALIDATION_ERROR` con el nombre
 * de la cabecera, igual que el de un campo del cuerpo.
 */
paymentsRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.PAYMENTS_CREATE),
  validate({ body: registerPaymentBodySchema }),
  controller.register,
);

/** `GET /api/v1/payments/:id` — `payments:read`. */
paymentsRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.PAYMENTS_READ),
  validate({ params: paymentIdParamsSchema }),
  controller.getById,
);

/** `POST /api/v1/payments/:id/refund` — `payments:refund` (MANAGER+). */
paymentsRouter.post(
  '/:id/refund',
  authenticate,
  requirePermission(PERMISSION.PAYMENTS_REFUND),
  validate({ params: paymentIdParamsSchema, body: refundPaymentBodySchema }),
  controller.refund,
);
