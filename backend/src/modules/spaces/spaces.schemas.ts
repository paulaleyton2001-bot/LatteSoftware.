/**
 * Esquemas zod de zonas y sillas (API.md 7.6 y 7.7).
 *
 * TODOS `.strict()`: un campo desconocido es `400 VALIDATION_ERROR` con
 * `UNKNOWN_FIELD`, nunca se ignora en silencio (API.md 1 y 11.6). `businessId`
 * además lo rechaza el middleware `validate` en cualquier cuerpo (API.md 2).
 *
 * ============================ CAMPOS QUE NO SE ACEPTAN ============================
 *  - `POST/PATCH /zones`: `capacity` es DERIVADO de las sillas (BR-CHAIR-005). Se
 *    acepta en el esquema para poder responder 422 `CAPACITY_IS_DERIVED` en
 *    lugar de un 400 que no explica el motivo.
 *  - `POST /chairs`: `status` NO existe. Una silla nace `AVAILABLE` siempre
 *    (BR-CHAIR-002): se rechaza en el esquema, no en el service.
 *  - `PATCH /chairs/:id`: `status` SÍ se acepta en el esquema porque el service
 *    debe responder 422 `FIELD_NOT_EDITABLE` (API.md 7.7) en vez de un 400 genérico.
 *    `code` también, por el mismo motivo (BR-CHAIR-008).
 *  - `durationMinutes`, `pricePerHourMinor` y `rentalTotalMinor` no se aceptan
 *    nunca en una reserva: los calcula el servidor (BR-ORDER-014, BR-RES-006).
 */
import { z } from 'zod';

import { PAGINATION } from '../../config/index.js';
import { ChairKind, ChairStatus, ReservationStatus } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField, searchQueryField } from '../../shared/validation/index.js';

// --------------------------------------------------------------------------
// Atómicos reutilizables
// --------------------------------------------------------------------------

/** Booleano de query: acepta `true`/`false` y los strings de una URL. */
const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** `features` de una silla (API.md 7.7). Etiqueta cerrada: no texto libre. */
export const CHAIR_FEATURES = ['wifi', 'outlet', 'view', 'accessible', 'tv', 'quiet'] as const;
export type ChairFeature = (typeof CHAIR_FEATURES)[number];

const featuresField = z.array(z.enum(CHAIR_FEATURES)).max(CHAIR_FEATURES.length, 'Demasiadas características');

/** Código de zona: corto y en mayúsculas, como la señalética de la cafetería. */
const zoneCodeField = z
  .string({ error: 'El código de la zona es obligatorio' })
  .trim()
  .min(1, 'El código de la zona no puede estar vacío')
  .max(8, 'El código de la zona no puede superar 8 caracteres')
  .regex(/^[A-Z0-9]+$/, 'El código de la zona sólo admite letras mayúsculas y dígitos');

/** Color de leyenda: `#RRGGBB` (mismo CHECK que el DDL). */
const colorHexField = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'El color debe tener el formato #RRGGBB');

/** Capacidad: 1..50 personas (un `AREA` puede ser 8, un salón grande más). */
const capacityField = z.coerce
  .number({ error: 'La capacidad debe ser un número' })
  .int('La capacidad debe ser un número entero')
  .min(1, 'La capacidad debe ser al menos 1')
  .max(50, 'La capacidad no puede superar 50 personas');

/** Coordenadas de la grilla del mapa: 0..1000 celdas. */
const gridAxisField = z.coerce
  .number({ error: 'La coordenada del mapa debe ser un número' })
  .int('La coordenada del mapa debe ser un número entero')
  .min(0, 'La coordenada del mapa no puede ser negativa')
  .max(1000, 'La coordenada del mapa no puede superar 1000');

/** Tamaño en celdas: 1..20. */
const gridSizeField = z.coerce
  .number({ error: 'El tamaño en el mapa debe ser un número' })
  .int('El tamaño en el mapa debe ser un número entero')
  .min(1, 'El tamaño en el mapa debe ser al menos 1')
  .max(20, 'El tamaño en el mapa no puede superar 20 celdas');

/** Rotación: sólo los cuatro múltiplos de 90 que admite el CHECK del DDL. */
const rotationField = z.coerce
  .number({ error: 'La rotación debe ser un número' })
  .int('La rotación debe ser un número entero')
  .refine(
    (value) => value === 0 || value === 90 || value === 180 || value === 270,
    'La rotación sólo admite 0, 90, 180 o 270 grados',
  );

/** Precio por hora en centavos: entero, nunca `float` (BR-MONEY-001). */
const priceMinorField = z.coerce
  .number({ error: 'El precio debe ser un número de centavos' })
  .int('El precio debe ser un entero de centavos')
  .min(0, 'El precio no puede ser negativo');

/** Motivo de una acción operativa (bloqueo, mantenimiento, baja). */
const actionReasonField = z
  .string()
  .trim()
  .min(1, 'El motivo es obligatorio')
  .max(300, 'El motivo no puede superar 300 caracteres');

/** Notas internas. `null` las borra. */
const notesField = z.string().trim().max(500, 'Las notas no pueden superar 500 caracteres').nullable();

// --------------------------------------------------------------------------
// Zonas (API.md 7.6)
// --------------------------------------------------------------------------

/** `GET /zones` (API.md 7.6). `locationId` es el filtro principal y obligatorio. */
export const listZonesQuerySchema = buildListQuerySchema({
  locationId: resourceIdField,
  isActive: boolQuery.optional(),
  includeInactive: boolQuery.optional(),
  q: searchQueryField,
});

/** `POST /zones` (API.md 7.6). */
export const createZoneBodySchema = z
  .object({
    locationId: resourceIdField,
    name: z
      .string({ error: 'El nombre de la zona es obligatorio' })
      .trim()
      .min(1, 'El nombre de la zona es obligatorio')
      .max(100, 'El nombre de la zona no puede superar 100 caracteres'),
    code: zoneCodeField.optional(),
    colorHex: colorHexField.default('#6B7280'),
    /** Aceptado sólo para poder avisar de que es derivado (BR-CHAIR-005). */
    capacity: z.coerce.number().int().min(0).max(1000).optional(),
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

/** `PATCH /zones/:id` (API.md 7.6). Sin `capacity`: es de sólo lectura. */
export const updateZoneBodySchema = z
  .object({
    name: z.string().trim().min(1, 'El nombre de la zona es obligatorio').max(100).optional(),
    code: zoneCodeField.nullable(),
    colorHex: colorHexField,
    sortOrder: z.coerce.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean(),
    /** Derivado: se acepta para responder 422 y no un 400 sin explicación. */
    capacity: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** `POST /zones/reorder` (API.md 7.6). Puede ser parcial. */
export const reorderZonesBodySchema = z
  .object({
    locationId: resourceIdField,
    items: z
      .array(
        z
          .object({
            id: resourceIdField,
            sortOrder: z.coerce.number().int().min(0).max(10_000),
          })
          .strict(),
      )
      .min(1, 'Debe indicar al menos una zona')
      .max(200, 'No se pueden reordenar más de 200 zonas de una vez'),
  })
  .strict();

/** `GET /zones/:id` · `PATCH` · `DELETE` · acciones. */
export const zoneIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** Columnas permitidas como orden en `GET /zones` (API.md 7.6). */
export const ZONE_SORT_COLUMNS = ['sort_order', 'name', 'capacity', 'created_at'] as const;
export const ZONE_SORT_DEFAULT = 'sort_order';

// --------------------------------------------------------------------------
// Sillas (API.md 7.7)
// --------------------------------------------------------------------------

/** `GET /chairs` (API.md 7.7). */
export const listChairsQuerySchema = buildListQuerySchema({
  locationId: resourceIdField.optional(),
  zoneId: resourceIdField.optional(),
  status: z.enum(ChairStatus).optional(),
  kind: z.enum(ChairKind).optional(),
  q: searchQueryField,
  isBookable: boolQuery.optional(),
  includeInactive: boolQuery.optional(),
});

/**
 * `GET /chairs/map` (API.md 7.7, BR-CHAIR-006).
 *
 * Sin paginación a propósito: el mapa se pinta entero, así que paginarlo
 * obligaría al cliente a pedir páginas y a recomputar los contadores.
 */
export const chairMapQuerySchema = z
  .object({
    locationId: resourceIdField,
    zoneId: resourceIdField.optional(),
    includeInactive: boolQuery.optional(),
  })
  .strict();

/** `POST /chairs` (API.md 7.7). Sin `status`: una silla nace `AVAILABLE`. */
export const createChairBodySchema = z
  .object({
    zoneId: resourceIdField,
    code: z
      .string({ error: 'El código de la silla es obligatorio' })
      .trim()
      .min(2, 'El código debe tener al menos 2 caracteres')
      .max(30, 'El código no puede superar 30 caracteres')
      .regex(/^[A-Z0-9-]+$/, 'El código sólo admite mayúsculas, dígitos y guiones'),
    // `.nullable().optional()`: API.md 7.7 los marca como opcionales y `null`
    // significa "sin valor". Sin `.optional()` el esquema los exigiría presentes
    // y un `POST` mínimo (`zoneId` + `code`) sería un 400.
    name: z.string().trim().max(100, 'El nombre no puede superar 100 caracteres').nullable().optional(),
    numberLabel: z.string().trim().max(20, 'La etiqueta no puede superar 20 caracteres').nullable().optional(),
    kind: z.enum(ChairKind).default(ChairKind.CHAIR),
    capacity: capacityField.default(1),
    /** Si se omite, hereda `businesses.chair_default_price_minor` (BR-CHAIR-002). */
    pricePerHourMinor: priceMinorField.optional(),
    gridX: gridAxisField.default(0),
    gridY: gridAxisField.default(0),
    mapWidth: gridSizeField.default(1),
    mapHeight: gridSizeField.default(1),
    rotationDeg: rotationField.default(0),
    features: featuresField.default([]),
    notes: notesField.optional(),
    isBookable: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .strict();

/** `PATCH /chairs/:id` (API.md 7.7). `code` y `status` los valida el service. */
export const updateChairBodySchema = z
  .object({
    zoneId: resourceIdField.optional(),
    code: z
      .string()
      .trim()
      .min(2, 'El código debe tener al menos 2 caracteres')
      .max(30, 'El código no puede superar 30 caracteres')
      .regex(/^[A-Z0-9-]+$/, 'El código sólo admite mayúsculas, dígitos y guiones')
      .optional(),
    /** Se acepta para que el service responda 422 `FIELD_NOT_EDITABLE`. */
    status: z.enum(ChairStatus).optional(),
    name: z.string().trim().max(100, 'El nombre no puede superar 100 caracteres').nullable().optional(),
    numberLabel: z.string().trim().max(20, 'La etiqueta no puede superar 20 caracteres').nullable().optional(),
    kind: z.enum(ChairKind).optional(),
    capacity: capacityField.optional(),
    pricePerHourMinor: priceMinorField.optional(),
    gridX: gridAxisField.optional(),
    gridY: gridAxisField.optional(),
    mapWidth: gridSizeField.optional(),
    mapHeight: gridSizeField.optional(),
    rotationDeg: rotationField.optional(),
    features: featuresField.optional(),
    notes: notesField.optional(),
    isBookable: z.boolean().optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** `DELETE /chairs/:id` (API.md 7.7). El motivo es obligatorio. */
export const deleteChairBodySchema = z
  .object({
    reason: actionReasonField,
  })
  .strict();

/**
 * `PATCH /chairs/:id/status` (API.md 7.7, BR-CHAIR-003).
 *
 * El esquema admite LOS SEIS estados, incluidos `OCCUPIED` y `RESERVED`, a
 * propósito: API.md 7.7 exige que esos dos se rechacen con **422**
 * `INVALID_CHAIR_STATUS_TRANSITION` y no con el 400 de un esquema que no los
 * contempla. El rechazo con su mensaje y su `ruleId` lo hace el service,
 * consultando la máquina de estados compartida.
 *
 * `reason` es obligatorio exactamente para `BLOCKED` y `MAINTENANCE`.
 */
export const setChairStatusBodySchema = z
  .object({
    status: z.enum(ChairStatus),
    reason: actionReasonField.optional(),
  })
  .strict()
  .refine(
    (body) => (body.status === 'BLOCKED' || body.status === 'MAINTENANCE') === (body.reason !== undefined),
    'Debe indicar el motivo para bloquear o enviar a mantenimiento',
  );

/** `POST /chairs/:id/block` (API.md 7.7). */
export const blockChairBodySchema = z
  .object({
    reason: actionReasonField,
    until: z.string().datetime({ offset: true, message: 'Debe ser un instante ISO-8601' }).optional(),
  })
  .strict();

/** `POST /chairs/:id/maintenance` (API.md 7.7). */
export const maintenanceChairBodySchema = z
  .object({
    reason: actionReasonField,
    estimatedEndAt: z.string().datetime({ offset: true, message: 'Debe ser un instante ISO-8601' }).optional(),
  })
  .strict();

/**
 * `POST /chairs/:id/complete-maintenance` (API.md 7.7).
 *
 * `.optional()` porque el cuerpo puede no venir: el endpoint es idempotente y sin
 * cuerpo significa `needsCleaning: true`, que es el default documentado.
 */
export const completeMaintenanceBodySchema = z
  .object({
    notes: z.string().trim().max(300, 'Las notas no pueden superar 300 caracteres').optional(),
    needsCleaning: z.boolean().default(true),
  })
  .strict()
  .optional();

/** Forma que ve el controller tras aplicar el default del cuerpo vacío. */
export type CompleteMaintenanceInput = NonNullable<z.infer<typeof completeMaintenanceBodySchema>>;

/**
 * `GET /chairs/:id/availability` (API.md 7.7).
 *
 * `from` y `to` son OPCIONALES: si no se envían se usa la ventana por defecto
 * (las próximas 24 horas), que es lo que consulta la app del cliente al abrir
 * la ficha de una silla. Si se envía sólo uno de los dos, el service responde
 * 400 `INVALID_DATE_RANGE`: un rango con un solo extremo no significa nada.
 */
export const chairAvailabilityQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true, message: 'Debe ser un instante ISO-8601' }).optional(),
    to: z.string().datetime({ offset: true, message: 'Debe ser un instante ISO-8601' }).optional(),
    granularityMinutes: z.coerce
      .number()
      .int()
      .refine(
        (value) => value === 15 || value === 30 || value === 60,
        'La granularidad sólo admite 15, 30 o 60 minutos',
      )
      .default(30),
  })
  .strict();

/** `GET /chairs/:id/history` (API.md 7.7). */
export const chairHistoryQuerySchema = buildListQuerySchema({
  from: z.string().datetime({ offset: true, message: 'Debe ser un instante ISO-8601' }).optional(),
  to: z.string().datetime({ offset: true, message: 'Debe ser un instante ISO-8601' }).optional(),
  type: z.enum(['reservation', 'rental']).optional(),
});

/** `GET /chairs/:id` · `PATCH` · `DELETE` · `/:id/status` · acciones. */
export const chairIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** Columnas permitidas como orden en `GET /chairs` (API.md 7.7). */
export const CHAIR_SORT_COLUMNS = [
  'code',
  'name',
  'capacity',
  'price_per_hour_minor',
  'status_changed_at',
  'sort_order',
  'created_at',
] as const;
export const CHAIR_SORT_DEFAULT = 'code';

/** Columnas permitidas como orden en `GET /chairs/:id/history` (API.md 7.7). */
export const CHAIR_HISTORY_SORT_COLUMNS = ['startAt', 'endAt', 'durationMinutes', 'revenueMinor'] as const;
export const CHAIR_HISTORY_SORT_DEFAULT = 'startAt';

/** Tope de `pageSize` en el listado de sillas, como en API.md 5.1. */
export const CHAIRS_PAGE_SIZE_MAX = PAGINATION.MAX_PAGE_SIZE;

/** `GET /chairs/:id/availability` acepta sólo estos estados de reserva. */
export const AVAILABILITY_RESERVATION_STATUSES = Object.freeze([
  ReservationStatus.CONFIRMED,
  ReservationStatus.ACTIVE,
]);

// --------------------------------------------------------------------------
// Tipos inferidos, para el controller
// --------------------------------------------------------------------------

export type ListZonesQuery = z.infer<typeof listZonesQuerySchema>;
export type CreateZoneBody = z.infer<typeof createZoneBodySchema>;
export type UpdateZoneBody = z.infer<typeof updateZoneBodySchema>;
export type ReorderZonesBody = z.infer<typeof reorderZonesBodySchema>;
export type ZoneIdParams = z.infer<typeof zoneIdParamsSchema>;

export type ListChairsQuery = z.infer<typeof listChairsQuerySchema>;
export type ChairMapQuery = z.infer<typeof chairMapQuerySchema>;
export type CreateChairBody = z.infer<typeof createChairBodySchema>;
export type UpdateChairBody = z.infer<typeof updateChairBodySchema>;
export type DeleteChairBody = z.infer<typeof deleteChairBodySchema>;
export type SetChairStatusBody = z.infer<typeof setChairStatusBodySchema>;
export type BlockChairBody = z.infer<typeof blockChairBodySchema>;
export type MaintenanceChairBody = z.infer<typeof maintenanceChairBodySchema>;
export type CompleteMaintenanceBody = z.infer<typeof completeMaintenanceBodySchema>;
export type ChairAvailabilityQuery = z.infer<typeof chairAvailabilityQuerySchema>;
export type ChairHistoryQuery = z.infer<typeof chairHistoryQuerySchema>;
export type ChairIdParams = z.infer<typeof chairIdParamsSchema>;
