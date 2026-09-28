/**
 * Esquemas zod del módulo `customers` (API.md 7.3).
 *
 * `.strict()` en todos. Los endpoints de historial de cliente
 * (`/:id/orders`, `/:id/reservations`, `/:id/rentals`, `/:id/payments`) NO tienen
 * esquema todavía: dependen de los módulos de pedidos, pagos y alquileres, que
 * aún no existen. Registrarlos ahora devolvería 500 al cliente, así que las
 * rutas están pendientes (ver `customers.routes.ts`).
 */
import { z } from 'zod';

import { UserStatus } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import {
  fullNameField,
  phoneField,
  photoUrlField,
  resourceIdField,
  searchQueryField,
} from '../../shared/validation/index.js';

/** `GET /customers` (API.md 7.3). */
export const listCustomersQuerySchema = buildListQuerySchema({
  q: searchQueryField,
  status: z.enum(UserStatus).optional(),
  hasOrders: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((value) => value === true || value === 'true')
    .optional(),
  createdFrom: z
    .string()
    .datetime({ offset: true, message: 'Debe ser un instante ISO-8601' })
    .optional(),
  createdTo: z.string().datetime({ offset: true, message: 'Debe ser un instante ISO-8601' }).optional(),
});

/** `GET /customers/:id` · `PATCH /customers/:id`. */
export const customerIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/**
 * `PATCH /customers/:id` (API.md 7.3).
 *
 * El email SÍ se acepta en el esquema porque un operador puede cambiarlo; el
 * service es quien lo rechaza cuando el actor es el propio cliente, que necesita
 * verificación (API.md 7.3: "Un cliente solo puede editar su propio registro y no
 * puede cambiar su email").
 */
export const updateCustomerBodySchema = z
  .object({
    fullName: fullNameField.optional(),
    phone: phoneField,
    photoUrl: photoUrlField,
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: 'Debe ser un correo electrónico válido' }).max(254))
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** Columnas permitidas como orden en `GET /customers` (API.md 7.3). */
export const CUSTOMER_SORT_COLUMNS = ['created_at', 'full_name', 'last_order_at'] as const;

/** Orden por defecto: los clientes más recientes primero. */
export const CUSTOMER_SORT_DEFAULT = 'created_at';

/** Tipos inferidos, para el controller. */
export type ListCustomersQuery = z.infer<typeof listCustomersQuerySchema>;
export type CustomerIdParams = z.infer<typeof customerIdParamsSchema>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerBodySchema>;
