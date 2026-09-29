/**
 * Esquemas zod del módulo `business` (API.md 7.4 + endpoint auxiliar
 * `GET /api/v1/business/status`).
 *
 * TODOS son `.strict()`: un campo desconocido es `400 VALIDATION_ERROR` con
 * `code: 'UNKNOWN_FIELD'`, no se ignora en silencio (API.md 1).
 *
 * ============================ DÓNDE VIVE QUÉ ==============================
 *  - Los esquemas NO contienen reglas de negocio: que la moneda no cambie con
 *    pedidos ya creados, que la zona horaria exista en el runtime o que una
 *    franja horaria sea coherente lo resuelve el service, que es donde están los
 *    datos ya conocidos. Es la misma frontera que usa el catálogo.
 *  - Lo que SÍ vive aquí es la FORMA: longitudes, tipos y formatos. Es la
 *    frontera que devuelve 400 sin llegar a tocar la base de datos.
 *  - Excepción deliberada: el formato de `opensAt`/`closesAt` se valida aquí con
 *    `HH:MM` porque el `CHECK` del esquema es exactamente ese patrón; la
 *    coherencia de la franja (`422 INVALID_HOURS_RANGE`) es del service.
 */
import { z } from 'zod';

import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField } from '../../shared/validation/index.js';
import { isCalendarDate, isHhMm } from './business.hours.js';

// --------------------------------------------------------------------------
// Atomos reutilizables
// --------------------------------------------------------------------------

/** Booleanos de query: `true`/`false` y también `"true"`/`"false"`. */
const booleanQueryField = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/**
 * Hora local `HH:MM` (24 h).
 *
 * El patrón es el mismo que el `CHECK` de `business_hours`
 * (`GLOB '[0-2][0-9]:[0-5][0-9]'`), pero más estricto: aquí se rechaza `24:00`
 * y `7:30`, que el `GLOB` del esquema aceptaría y que después romperían
 * `Intl.DateTimeFormat`.
 */
const hhMmField = (label: string) =>
  z
    .string({ error: `${label} es obligatoria` })
    .trim()
    .refine(isHhMm, `${label} debe tener formato HH:MM en 24 horas, por ejemplo 08:30`);

/** Fecha de calendario `YYYY-MM-DD` (rechaza `2026-02-30`). */
const dateKeyField = (label: string) =>
  z
    .string({ error: `${label} es obligatoria` })
    .trim()
    .refine(isCalendarDate, `${label} debe ser una fecha real con formato YYYY-MM-DD`);

/** Texto corto de configuración. */
const shortText = (max: number, label: string) =>
  z
    .string({ error: `${label} es obligatorio` })
    .trim()
    .min(1, `${label} no puede estar vacío`)
    .max(max, `${label} no puede superar ${max} caracteres`);

/** Texto largo opcional: descripciones y direcciones. */
const optionalText = (max: number, label: string) =>
  z
    .string({ error: `${label} debe ser texto` })
    .trim()
    .max(max, `${label} no puede superar ${max} caracteres`)
    .nullable()
    .optional();

/** URL de logo: sólo `http(s)`. */
const logoUrlField = z
  .union([
    z
      .url({ error: 'Debe ser una URL válida' })
      .max(500, 'La URL del logo es demasiado larga')
      .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
        message: 'La URL debe empezar por http:// o https://',
      }),
    z.null(),
  ])
  .optional();

/** Email de contacto del negocio. */
const contactEmailField = z
  .string({ error: 'El correo debe ser texto' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Debe ser un correo electrónico válido' }).max(254))
  .nullable()
  .optional();

/** Teléfono libre (no E.164 estricto: la sede puede tener uno local). */
const contactPhoneField = z
  .string({ error: 'El teléfono debe ser texto' })
  .trim()
  .min(3, 'El teléfono es demasiado corto')
  .max(40, 'El teléfono no puede superar 40 caracteres')
  .nullable()
  .optional();

/** Tasa en basis points: 0 a 10000 (100 % = 10000 bp, BR-TAX-001). */
const basisPointsField = (label: string) =>
  z
    .number({ error: `${label} debe ser un número entero en basis points` })
    .int(`${label} debe ser un entero en basis points`)
    .min(0, `${label} no puede ser negativa`)
    .max(10_000, `${label} no puede superar el 100 % (10000 basis points)`);

// --------------------------------------------------------------------------
// 7.4 Negocio
// --------------------------------------------------------------------------

/**
 * `PATCH /api/v1/business`.
 *
 * TODOS opcionales y se exige al menos uno. NO admite `id`: la identidad del
 * negocio sale del token y no es editable, así que mandarlo es un
 * `400 UNKNOWN_FIELD`.
 *
 * `defaultTipsBp` es `string[]` (API.md 7.4) y el service lo guarda como CSV en
 * la columna `TEXT`: cada elemento debe ser un número entero de basis points en
 * texto, porque es lo que produce el cliente.
 */
export const updateBusinessBodySchema = z
  .object({
    name: shortText(150, 'El nombre').optional(),
    legalName: optionalText(150, 'La razón social'),
    logoUrl: logoUrlField,
    taxId: optionalText(40, 'El NIT o RUT'),
    email: contactEmailField,
    phone: contactPhoneField,
    addressLine1: optionalText(150, 'La dirección'),
    addressLine2: optionalText(150, 'La dirección complementaria'),
    city: optionalText(100, 'La ciudad'),
    /** ISO-3166 alpha-2, ej. `CO`. */
    country: z
      .string({ error: 'El país debe ser texto' })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/, 'El país debe ser un código ISO-3166 de dos letras, por ejemplo CO')
      .nullable()
      .optional(),
    /** ISO-4217 de tres letras. Que el runtime la conozca lo decide el service. */
    currencyCode: z
      .string({ error: 'La moneda debe ser texto' })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, 'La moneda debe ser un código ISO-4217 de tres letras, por ejemplo COP')
      .optional(),
    currencySymbol: shortText(4, 'El símbolo de la moneda').optional(),
    /** BCP-47, ej. `es_CO`. */
    locale: z
      .string({ error: 'El locale debe ser texto' })
      .trim()
      .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'El locale debe tener formato BCP-47, por ejemplo es_CO')
      .max(35, 'El locale es demasiado largo')
      .optional(),
    /** IANA, ej. `America/Bogota`. Que exista lo decide el service (422). */
    timezone: z
      .string({ error: 'La zona horaria debe ser texto' })
      .trim()
      .min(1, 'La zona horaria no puede estar vacía')
      .max(64, 'La zona horaria no puede superar 64 caracteres')
      .optional(),
    taxRateBp: basisPointsField('La tasa de impuesto').optional(),
    taxInclusive: z.boolean().optional(),
    serviceFeeBp: basisPointsField('La tarifa de servicio').optional(),
    tipEnabled: z.boolean().optional(),
    defaultTipsBp: z
      .array(
        z
          .string({ error: 'Cada propina sugerida debe ser texto' })
          .trim()
          .regex(/^\d{1,5}$/, 'Cada propina sugerida debe ser un número entero de basis points en texto, por ejemplo "1500"'),
      )
      .min(1, 'Debe haber al menos una propina sugerida')
      .max(10, 'No se pueden admitir más de 10 propinas sugeridas')
      .optional(),
    /** Tope de duración de una reserva: 1..1440 minutos (BR-RES-002). */
    maxReservationMinutes: z
      .number({ error: 'La duración máxima de reserva debe ser un número entero de minutos' })
      .int('La duración máxima de reserva debe ser un entero')
      .min(1, 'La duración máxima de reserva debe ser de al menos 1 minuto')
      .max(1440, 'La duración máxima de reserva no puede superar 1440 minutos (24 horas)')
      .optional(),
    /** Precio por hora por defecto al crear una silla (alquiler de espacios). */
    chairDefaultPriceMinor: z
      .number({ error: 'El precio de la silla debe ser un número entero en centavos' })
      .int('El precio de la silla debe ser un entero en centavos (BR-MONEY-001)')
      .min(0, 'El precio de la silla no puede ser negativo')
      .max(100_000_000, 'El precio de la silla es demasiado alto')
      .optional(),
    allowNegativeStock: z.boolean().optional(),
    lowStockAlertThreshold: z
      .number({ error: 'El umbral de stock bajo debe ser un número entero' })
      .int('El umbral de stock bajo debe ser un entero')
      .min(0, 'El umbral de stock bajo no puede ser negativo')
      .max(1_000_000, 'El umbral de stock bajo es demasiado alto')
      .optional(),
    /** Prefijo de `order_number`: 2..8 caracteres en mayúsculas o dígitos. */
    orderPrefix: z
      .string({ error: 'El prefijo de pedido debe ser texto' })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{2,8}$/, 'El prefijo de pedido debe tener entre 2 y 8 caracteres en mayúsculas o dígitos')
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** `GET /api/v1/business/holidays`. `includePast` por defecto `true`. */
export const listBusinessHolidaysQuerySchema = buildListQuerySchema({
  from: dateKeyField('La fecha inicial').optional(),
  to: dateKeyField('La fecha final').optional(),
  includePast: booleanQueryField.default(true),
});

/** `POST /api/v1/business/holidays`. */
export const createBusinessHolidayBodySchema = z
  .object({
    holidayDate: dateKeyField('La fecha del festivo'),
    name: shortText(150, 'El nombre del festivo'),
    isClosed: z.boolean().default(true),
  })
  .strict();

/**
 * `PUT /api/v1/business/hours`.
 *
 * Exactamente siete días, uno por `dayOfWeek` (0 = domingo … 6 = sábado), sin
 * repetidos y en cualquier orden: el servidor los ordena. Que la franja sea
 * coherente (`422 INVALID_HOURS_RANGE`) lo decide el service.
 *
 * El esquema NO exige los siete con `.length(7)`: ese fallo tiene su propio
 * código de contrato, `400 INCOMPLETE_WEEK`, y un `.length()` de zod lo
 * reportaría como `TOO_SMALL`. El conteo exacto, los días repetidos
 * (`DUPLICATE_DAY_OF_WEEK`) y la coherencia de cada franja los comprueba
 * `normalizeWeek` en `business.hours.ts`. Aquí sólo se acota el tamaño para no
 * arrastrar un array gigante.
 */
export const replaceBusinessHoursBodySchema = z
  .object({
    hours: z
      .array(
        z
          .object({
            dayOfWeek: z
              .number({ error: 'El día de la semana debe ser un número entero' })
              .int('El día de la semana debe ser un entero')
              .min(0, 'El día de la semana debe estar entre 0 (domingo) y 6 (sábado)')
              .max(6, 'El día de la semana debe estar entre 0 (domingo) y 6 (sábado)'),
            opensAt: hhMmField('La hora de apertura'),
            closesAt: hhMmField('La hora de cierre'),
            isClosed: z.boolean({ error: 'Debe indicar si el día está cerrado' }),
          })
          .strict(),
      )
      .max(7, 'La semana tiene como máximo siete días'),
  })
  .strict();

/** `DELETE /api/v1/business/holidays/:id`. */
export const businessHolidayIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

// --------------------------------------------------------------------------
// Tipos inferidos, para los controllers
// --------------------------------------------------------------------------

export type UpdateBusinessBody = z.infer<typeof updateBusinessBodySchema>;
export type ListBusinessHolidaysQuery = z.infer<typeof listBusinessHolidaysQuerySchema>;
export type CreateBusinessHolidayBody = z.infer<typeof createBusinessHolidayBodySchema>;
export type ReplaceBusinessHoursBody = z.infer<typeof replaceBusinessHoursBodySchema>;
