/**
 * Esquemas zod del módulo de REPORTES (API.md 5.2 y 7.16).
 *
 * Todos `.strict()`: un parámetro desconocido se rechaza con 400 en lugar de
 * ignorarse en silencio, porque en un panel de administración un `?filtro=`
 * mal escrito que "no hace nada" es peor que un error visible.
 *
 * Lo que estos esquemas NO hacen, a propósito:
 *  - No resuelven el preset a un rango. Resolverlo depende de la zona horaria
 *    del NEGOCIO, que se lee de la base de datos: eso es del service.
 *  - No validan `from <= to` ni el tope de 366 días, porque dependen del rango
 *    ya resuelto (preset + zona horaria del negocio), que es cosa del service.
 *    Allí se lanzan como `400 VALIDATION_ERROR` con un `details.code` estable
 *    (`INVALID_DATE_RANGE`, `RANGE_TOO_LARGE`), los mismos que usan `spaces`,
 *    `inventory` y `reservations` para el mismo error.
 *  - No restringen qué columnas se pueden exportar: eso depende del reporte
 *    pedido y lo resuelve `reports.csv.ts`, que es donde está la allowlist.
 */
import { z } from 'zod';

import {
  ChairKind,
  OrderChannel,
  OrderType,
  PaymentMethod,
} from '../../shared/domain/index.js';
import { resourceIdField } from '../../shared/validation/index.js';
import { CUSTOMER_SEGMENTS, EXPORTABLE_REPORTS, REPORT_GROUPINGS, REPORT_PRESETS } from './reports.types.js';

/** Booleanos de query: `true`/`false` o su forma textual. */
const booleanQueryField = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/**
 * Instante ISO-8601 en la query.
 *
 * API.md 5.2 los declara "ISO-8601 UTC". Se acepta también una fecha de sólo
 * día (`2026-03-14`), que es un uso legítimo de la API y que el service
 * interpreta como medianoche en la zona del negocio; el resto se normaliza a
 * UTC con `parseIso`.
 */
const instantField = z
  .string()
  .trim()
  .min(1, 'La fecha no puede estar vacía')
  .max(40, 'La fecha es demasiado larga');

/** Zona horaria IANA. La validez real la comprueba el service con `Intl`. */
const timezoneField = z
  .string()
  .trim()
  .min(1, 'La zona horaria no puede estar vacía')
  .max(64, 'La zona horaria es demasiado larga');

/** Granularidad de agrupación. */
const groupingField = z.enum(REPORT_GROUPINGS);

/** Identificador de preset de `API.md` 5.2. */
const presetField = z.enum(REPORT_PRESETS);

/** Campos de rango comunes a TODOS los reportes. */
const rangeShape = {
  preset: presetField.optional(),
  from: instantField.optional(),
  to: instantField.optional(),
  timezone: timezoneField.optional(),
};

/** Filtros de negocio comunes a los reportes que los aceptan. */
const businessShape = {
  locationId: resourceIdField.optional(),
  zoneId: resourceIdField.optional(),
  chairId: resourceIdField.optional(),
  kind: z.enum(ChairKind).optional(),
  channel: z.enum(OrderChannel).optional(),
  type: z.enum(OrderType).optional(),
  paymentMethod: z.enum(PaymentMethod).optional(),
  includeRefunded: booleanQueryField.optional(),
};

/** Forma de los parámetros de rango, reutilizable y exportada para los tests. */
export const reportRangeShape = rangeShape;

/** `GET /api/v1/reports/dashboard`. */
export const dashboardQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    includeSeries: booleanQueryField.optional(),
    seriesDays: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => value === 7 || value === 14 || value === 30, {
        message: 'Debe ser 7, 14 o 30',
      })
      .optional(),
  })
  .strict();

/** `GET /api/v1/reports/sales`. */
export const salesQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    groupBy: z.enum(['day', 'week', 'month']).optional(),
  })
  .strict();

/** `GET /api/v1/reports/sales-by-hour`. */
export const salesByHourQuerySchema = z.object({ ...rangeShape, ...businessShape }).strict();

/** `GET /api/v1/reports/sales-by-day`. */
export const salesByDayQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    includeWeekdays: booleanQueryField.optional(),
  })
  .strict();

/** `GET /api/v1/reports/top-products`. */
export const topProductsQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    limit: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= 100, {
        message: 'Debe ser un entero entre 1 y 100',
      })
      .optional(),
    page: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1, {
        message: 'Debe ser un entero mayor o igual a 1',
      })
      .optional(),
    pageSize: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= 100, {
        message: 'Debe ser un entero entre 1 y 100',
      })
      .optional(),
    orderBy: z.enum(['quantity', 'revenue']).optional(),
    categoryId: resourceIdField.optional(),
  })
  .strict();

/** `GET /api/v1/reports/product-revenue`. */
export const productRevenueQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    groupBy: z.enum(['product', 'category']).optional(),
    includeTax: booleanQueryField.optional(),
    page: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1, {
        message: 'Debe ser un entero mayor o igual a 1',
      })
      .optional(),
    pageSize: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= 100, {
        message: 'Debe ser un entero entre 1 y 100',
      })
      .optional(),
  })
  .strict();

/** `GET /api/v1/reports/chair-occupancy`. */
export const chairOccupancyQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    groupBy: z.enum(['chair', 'zone', 'hour']).optional(),
  })
  .strict();

/** `GET /api/v1/reports/rental-revenue`. */
export const rentalRevenueQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    groupBy: z.enum(['chair', 'zone', 'day', 'month']).optional(),
  })
  .strict();

/** `GET /api/v1/reports/customers`. */
export const customersQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    limit: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= 500, {
        message: 'Debe ser un entero entre 1 y 500',
      })
      .optional(),
    page: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1, {
        message: 'Debe ser un entero mayor o igual a 1',
      })
      .optional(),
    pageSize: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= 500, {
        message: 'Debe ser un entero entre 1 y 500',
      })
      .optional(),
    orderBy: z.enum(['totalSpent', 'orders', 'lastOrder', 'newCustomers']).optional(),
    onlyWithOrders: booleanQueryField.optional(),
    segment: z.enum(CUSTOMER_SEGMENTS).optional(),
  })
  .strict();

/** `GET /api/v1/reports/inventory`. */
export const inventoryQuerySchema = z
  .object({
    ...rangeShape,
    ...businessShape,
    supplier: z.string().trim().min(1).max(150).optional(),
    locationStorage: z.string().trim().min(1).max(100).optional(),
    includeZeroStock: booleanQueryField.optional(),
    lowStockOnly: booleanQueryField.optional(),
    page: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1, {
        message: 'Debe ser un entero mayor o igual a 1',
      })
      .optional(),
    pageSize: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= 100, {
        message: 'Debe ser un entero entre 1 y 100',
      })
      .optional(),
  })
  .strict();

/** `GET /api/v1/reports/orders-summary`. */
export const ordersSummaryQuerySchema = z
  .object({ ...rangeShape, ...businessShape, groupBy: groupingField.optional() })
  .strict();

/** `POST /api/v1/reports/export`. */
export const exportBodySchema = z
  .object({
    report: z.enum(EXPORTABLE_REPORTS, {
      error: 'El reporte solicitado no es exportable',
    }),
    format: z.literal('csv', { error: 'Sólo se admite el formato csv' }).default('csv'),
    preset: presetField.optional(),
    from: instantField.optional(),
    to: instantField.optional(),
    timezone: timezoneField.optional(),
    locationId: resourceIdField.optional(),
    zoneId: resourceIdField.optional(),
    chairId: resourceIdField.optional(),
    kind: z.enum(ChairKind).optional(),
    channel: z.enum(OrderChannel).optional(),
    type: z.enum(OrderType).optional(),
    paymentMethod: z.enum(PaymentMethod).optional(),
    includeRefunded: z.boolean().optional(),
    groupBy: groupingField.optional(),
    orderBy: z.enum(['quantity', 'revenue']).optional(),
    segment: z.enum(CUSTOMER_SEGMENTS).optional(),
    supplier: z.string().trim().min(1).max(150).optional(),
    locationStorage: z.string().trim().min(1).max(100).optional(),
    onlyWithOrders: z.boolean().optional(),
    includeWeekdays: z.boolean().optional(),
    limit: z
      .union([z.number(), z.string()])
      .transform((value) => (typeof value === 'number' ? value : Number(value)))
      .refine((value) => Number.isInteger(value) && value >= 1 && value <= 500, {
        message: 'Debe ser un entero entre 1 y 500',
      })
      .optional(),
    /**
     * Subconjunto de columnas del reporte. Las claves válidas dependen del
     * reporte: la allowlist está en `reports.csv.ts` y una clave desconocida es
     * un 400 `INVALID_COLUMNS`.
     */
    columns: z
      .array(z.string().trim().min(1).max(64))
      .max(64, 'No se admiten más de 64 columnas')
      .optional(),
    filename: z
      .string()
      .trim()
      .min(1, 'El nombre de fichero no puede estar vacío')
      .max(120, 'El nombre de fichero no puede superar 120 caracteres')
      .optional(),
    includeTotalsRow: z.boolean().default(true),
  })
  .strict();

/** Tipo del query de `dashboard` ya validado. */
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
/** Tipo del query de `sales` ya validado. */
export type SalesQuery = z.infer<typeof salesQuerySchema>;
/** Tipo del query de `top-products` ya validado. */
export type TopProductsQuery = z.infer<typeof topProductsQuerySchema>;
/** Tipo del query de `product-revenue` ya validado. */
export type ProductRevenueQuery = z.infer<typeof productRevenueQuerySchema>;
/** Tipo del query de `chair-occupancy` ya validado. */
export type ChairOccupancyQuery = z.infer<typeof chairOccupancyQuerySchema>;
/** Tipo del query de `rental-revenue` ya validado. */
export type RentalRevenueQuery = z.infer<typeof rentalRevenueQuerySchema>;
/** Tipo del query de `customers` ya validado. */
export type CustomersQuery = z.infer<typeof customersQuerySchema>;
/** Tipo del query de `inventory` ya validado. */
export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
/** Tipo del query de `orders-summary` ya validado. */
export type OrdersSummaryQuery = z.infer<typeof ordersSummaryQuerySchema>;
/** Tipo del body de `export` ya validado. */
export type ExportBody = z.infer<typeof exportBodySchema>;
