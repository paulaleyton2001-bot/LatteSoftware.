/**
 * Esquemas zod del módulo `locations` (API.md 7.5 + el `DELETE` que la
 * introducción de la sección 7 ya cuenta).
 *
 * TODOS son `.strict()`: un campo desconocido es `400 VALIDATION_ERROR` con
 * `code: 'UNKNOWN_FIELD'`, no se ignora en silencio (API.md 1).
 *
 * ============================ DÓNDE VIVE QUÉ ==============================
 *  - Los esquemas NO contienen reglas de negocio: que el nombre esté libre, que
 *    la sede no tenga zonas activas o que se pueda desactivar con pedidos vivos
 *    lo resuelve el service, que es donde están los datos ya conocidos.
 *  - Lo que SÍ vive aquí es la FORMA: longitudes, tipos y formatos.
 */
import { z } from 'zod';

import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField, searchQueryField } from '../../shared/validation/index.js';

/** Booleanos de query: `true`/`false` y también `"true"`/`"false"`. */
const booleanQueryField = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Nombre de sede: 1..150. */
const locationNameField = z
  .string({ error: 'El nombre de la sede es obligatorio' })
  .trim()
  .min(1, 'El nombre de la sede no puede estar vacío')
  .max(150, 'El nombre de la sede no puede superar 150 caracteres');

/** Dirección: texto libre, 300 caracteres (API.md 7.5). */
const addressField = z
  .string({ error: 'La dirección debe ser texto' })
  .trim()
  .max(300, 'La dirección no puede superar 300 caracteres')
  .nullable()
  .optional();

/** Teléfono: 40 caracteres (API.md 7.5). */
const phoneField = z
  .string({ error: 'El teléfono debe ser texto' })
  .trim()
  .min(3, 'El teléfono es demasiado corto')
  .max(40, 'El teléfono no puede superar 40 caracteres')
  .nullable()
  .optional();

// --------------------------------------------------------------------------
// 7.5 Sedes
// --------------------------------------------------------------------------

/** `GET /api/v1/locations`. */
export const listLocationsQuerySchema = buildListQuerySchema({
  isActive: booleanQueryField.optional(),
  q: searchQueryField,
});

/** `POST /api/v1/locations`. */
export const createLocationBodySchema = z
  .object({
    name: locationNameField,
    address: addressField,
    phone: phoneField,
    isActive: z.boolean().default(true),
  })
  .strict();

/** `PATCH /api/v1/locations/:id`. Exige al menos un campo. */
export const updateLocationBodySchema = z
  .object({
    name: locationNameField.optional(),
    address: addressField,
    phone: phoneField,
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** `GET /api/v1/locations/:id`. */
export const locationIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** Columnas ordenables de `GET /api/v1/locations` (API.md 7.5). */
export const LOCATION_SORT_COLUMNS = ['name', 'created_at', 'updated_at'] as const;
export const LOCATION_SORT_DEFAULT = 'name';

// --------------------------------------------------------------------------
// Tipos inferidos, para los controllers
// --------------------------------------------------------------------------

export type ListLocationsQuery = z.infer<typeof listLocationsQuerySchema>;
export type CreateLocationBody = z.infer<typeof createLocationBodySchema>;
export type UpdateLocationBody = z.infer<typeof updateLocationBodySchema>;
