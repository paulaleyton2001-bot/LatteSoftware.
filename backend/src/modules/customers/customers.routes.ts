/**
 * Rutas de `/api/v1/customers` (API.md 7.3).
 *
 * IMPLEMENTADO (4 endpoints): `GET /`, `GET /me`, `GET /:id`, `PATCH /:id`.
 *
 * ---------------------------------------------------------------------------
 * PENDIENTE, Y POR QUÉ NO SE REGISTRAN TODAVÍA
 * ---------------------------------------------------------------------------
 * `GET /:id/orders`, `/:id/reservations`, `/:id/rentals` y `/:id/payments` NO
 * existen en este router. Los datos sí están en el esquema (`orders`,
 * `chair_reservations`, `chair_rentals`, `payments`) y el repositorio ya calcula
 * los agregados que usan, pero la forma de cada recurso (estados, filtros,
 * permissions por endpoint) la fija el módulo correspondiente
 * (`orders`, `reservations`, `rentals`, `payments`), que aún no existe.
 *
 * Registrarlas ahora devolvería un 500 o, peor, una respuesta con un contrato
 * inventado que el frontend terminaría consumiendo. El orden de aparición
 * importa: cuando lleguen esos módulos, estas cuatro rutas se añaden aquí con el
 * permiso `customers:read` y su `validate({ query })` correspondiente.
 * ---------------------------------------------------------------------------
 */
import { Router } from 'express';

import { PERMISSION } from '../../shared/domain/index.js';
import { asyncHandler } from '../../shared/http/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { getContainer } from '../../config/container.js';
import { CustomersController } from './customers.controller.js';
import {
  CUSTOMER_SORT_COLUMNS,
  CUSTOMER_SORT_DEFAULT,
  customerIdParamsSchema,
  listCustomersQuerySchema,
  updateCustomerBodySchema,
} from './customers.schemas.js';

/** Controller único del módulo, construido por el contenedor. */
const controller = new CustomersController(getContainer().services.customers);

/** Router del módulo. Se monta bajo `/api/v1/customers`. */
export const customersRouter: Router = Router();

/** `GET /customers` — `customers:read`. Sólo operadores (ver el service). */
customersRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.CUSTOMERS_READ),
  validate({
    query: listCustomersQuerySchema,
    sortable: {
      allowedColumns: CUSTOMER_SORT_COLUMNS,
      defaultColumn: CUSTOMER_SORT_DEFAULT,
      defaultOrder: 'desc',
    },
  }),
  controller.list,
);

/**
 * `GET /customers/me` — ficha del cliente autenticado.
 * `autenticado` (no `customers:read`): es el propio perfil, y por eso NO lleva
 * permiso: el alcance lo da el propio hecho de ser el actor.
 */
customersRouter.get('/me', authenticate, asyncHandler(controller.me));

/** `GET /customers/:id` — `customers:read`. */
customersRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CUSTOMERS_READ),
  validate({ params: customerIdParamsSchema }),
  asyncHandler(controller.getById),
);

/** `PATCH /customers/:id` — `customers:update`. */
customersRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CUSTOMERS_UPDATE),
  validate({ params: customerIdParamsSchema, body: updateCustomerBodySchema }),
  controller.update,
);
