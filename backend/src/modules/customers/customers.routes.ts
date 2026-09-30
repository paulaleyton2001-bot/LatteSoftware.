/**
 * Rutas de `/api/v1/customers` (API.md 7.3).
 *
 * IMPLEMENTADO (4 endpoints): `GET /`, `GET /me`, `GET /:id`, `PATCH /:id`.
 *
 * ---------------------------------------------------------------------------
 * `GET /me` PARA CUENTAS DE PERSONAL
 * ---------------------------------------------------------------------------
 * `GET /me` responde 200 para TODO usuario autenticado: el id sale del token y,
 * si ese usuario no tiene ficha de cliente (no tiene rol `CUSTOMER`), la
 * respuesta lo dice con `hasCustomerProfile: false` en lugar de un 404. Antes
 * devolvía «El cliente no existe», que era falso: el usuario existe, lo que no
 * existe es su ficha en el directorio. Ver `CustomersService.me`.
 *
 * ---------------------------------------------------------------------------
 * NO IMPLEMENTADO: LOS CUATRO RECURSOS DEL CLIENTE (API.md 7.3)
 * ---------------------------------------------------------------------------
 * `GET /:id/orders`, `/:id/reservations`, `/:id/rentals` y `/:id/payments` están
 * declarados en API.md 7.3 y NO existen en este router. Es una brecha
 * conocida y documentada, no un descuido de este módulo.
 *
 * Los módulos que los producirían SÍ existen ya (`orders`, `reservations`,
 * `rentals`, `payments`), pero cada uno expone su recurso con su propio
 * contrato de filtros, estados y forma de respuesta, y el repositorio de
 * clientes no tiene agregados para ellos. Montarlos aquí exigiría decidir qué
 * proyección se devuelve y con qué paginación, es decir, inventar un contrato
 * que API.md no define con ese detalle.
 *
 * HOY el cliente llega a su historial por los listados de cada módulo, que ya
 * fuerzan su alcance: `GET /orders?customerId=<otro>` devuelve 200 con la lista
 * VACÍA, porque `OrdersService.scopedFilter` sobrescribe el filtro con el id
 * del token. El mismo patrón sirve para reservas y alquileres.
 *
 * Cuando se implementen, estas cuatro rutas se añaden aquí con el permiso
 * `customers:read`, `validate({ query })` y el filtro de propietario en el SQL.
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
 * `GET /customers/me` — perfil del actor autenticado.
 * `autenticado` (no `customers:read`): es el propio perfil, y por eso NO lleva
 * permiso: el alcance lo da el propio hecho de ser el actor.
 *
 * No valida `query` a propósito: `customerId`/`id` en la query se IGNORAN, porque
 * el id sale siempre del token. Aceptarlos y validarlos daría la impresión de que
 * filtran algo; ignorarlos hace explícito que el alcance es el actor.
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
