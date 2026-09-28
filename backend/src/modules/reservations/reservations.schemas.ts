/**
 * Esquemas zod de reservas (API.md 7.8).
 *
 * TODOS `.strict()` (API.md 1): un campo desconocido es 400.
 *
 * ============================ LO QUE NUNCA SE ACEPTA ============================
 * `durationMinutes`, `pricePerHourMinor` y `rentalTotalMinor` NO están en ningún
 * esquema de este fichero. Los calcula el servidor (BR-RES-006 y BR-ORDER-014: el
 * cliente nunca envía importes calculados). Si un cliente los manda, el `.strict()`
 * los rechaza con 400 en vez de dejar que un importe falso llegue a la base de
 * datos: ése es el orden de protección queBR-PRICE-008 exige.
 *
 * `businessId` tampoco: sale del token (API.md 2).
 */
import { z } from 'zod';

import { RESERVATION } from '../../config/index.js';
import { ReservationStatus } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField } from '../../shared/validation/index.js';

/** Instante ISO-8601 con offset, normalizado a UTC. */
const instantField = z
  .string({ error: 'La fecha es obligatoria' })
  .datetime({ offset: true, message: 'Debe ser un instante ISO-8601, por ejemplo 2026-03-14T14:00:00.000Z' });

/** `code` de reserva: `RES-` + 6..12 dígitos (API.md 7.8). */
const reservationCodeField = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^RES-\d{6,12}$/, 'El código debe tener el formato RES- seguido de 6 a 12 dígitos');

/** Notas internas de la reserva. `null` las borra. */
const notesField = z.string().trim().max(500, 'Las notas no pueden superar 500 caracteres').nullable();

/** `GET /reservations` (API.md 7.8). */
export const listReservationsQuerySchema = buildListQuerySchema({
  from: instantField.optional(),
  to: instantField.optional(),
  chairId: resourceIdField.optional(),
  zoneId: resourceIdField.optional(),
  locationId: resourceIdField.optional(),
  /**
   * Un `CUSTOMER` puede enviarlo, pero el service lo SOBRESCRIBE con su propio id:
   * el alcance lo decide el servidor, nunca el cliente (API.md 9.3).
   */
  customerId: resourceIdField.optional(),
  status: z.enum(ReservationStatus).optional(),
  code: reservationCodeField.optional(),
});

/** `GET /reservations/quote` (API.md 7.8). Sólo lectura. */
export const quoteReservationQuerySchema = z
  .object({
    chairId: resourceIdField,
    startAt: instantField,
    endAt: instantField,
    /**
     * Aceptado por compatibilidad con el contrato. El módulo de descuentos no
     * existe todavía, así que NO se aplica: la respuesta incluye
     * `meta.warnings: ['COUPON_NOT_APPLIED']` y `discountMinor = 0`. Rechazarlo con
     * un 400 sería peor que decir la verdad sobre lo que se ignoró.
     */
    applyCouponCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/, 'El código del cupón sólo admite mayúsculas, dígitos, guion y guion bajo')
      .optional(),
  })
  .strict();

/** `POST /reservations` (API.md 7.8). */
export const createReservationBodySchema = z
  .object({
    chairId: resourceIdField,
    startAt: instantField,
    endAt: instantField,
    /**
     * Por defecto, el propio cliente si el actor es `CUSTOMER`; `null` es una
     * reserva de mostrador sin cliente (lo admite el esquema: `customer_id` es
     * NULLABLE en `chair_reservations`).
     */
    customerId: resourceIdField.nullable().optional(),
    notes: notesField.optional(),
    source: z.enum(['CUSTOMER', 'STAFF', 'ADMIN']).optional(),
    sendNotification: z.boolean().default(true),
    /**
     * El módulo de pedidos no existe todavía, así que `createOrder` se acepta y se
     * documenta como no aplicado (`meta.warnings: ['ORDER_NOT_CREATED']`).
     */
    createOrder: z.boolean().default(false),
  })
  .strict();

/** `POST /reservations/:id/check-in` (API.md 7.8). */
export const checkInReservationBodySchema = z
  .object({
    /** `now` por defecto. */
    actualStartAt: instantField.optional(),
    notes: notesField.optional(),
    createOrder: z.boolean().default(true),
  })
  .strict()
  .optional();

/** `POST /reservations/:id/extend` (API.md 7.8). */
export const extendReservationBodySchema = z
  .object({
    newEndAt: instantField,
  })
  .strict();

/** `POST /reservations/:id/complete` (API.md 7.8). */
export const completeReservationBodySchema = z
  .object({
    /** `now` por defecto (check-out). */
    endAt: instantField.optional(),
    notes: notesField.optional(),
    reportIssue: z.enum(['NO_SHOW', 'ABANDONED', 'OTHER']).optional(),
  })
  .strict()
  .optional();

/**
 * `POST /reservations/:id/cancel` (API.md 7.8).
 *
 * `reason` es OBLIGATORIO y no opcional (API.md 7.8): sin motivo no hay forma de
 * saber si fue el cliente, el negocio o un error de dedo, así que se exige con
 * `z.string().min(1)` en el propio esquema y no con un `422` posterior.
 */
export const cancelReservationBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1, 'El motivo de la cancelación es obligatorio')
      .max(500, 'El motivo no puede superar 500 caracteres'),
    /** Se acepta y se documenta como no aplicado: el módulo de pagos no existe. */
    refundPayment: z.boolean().default(true),
    notifyCustomer: z.boolean().default(true),
  })
  .strict();

/**
 * `POST /api/v1/system/jobs/expire-reservations` (API.md 7.19).
 *
 * Cuerpo opcional: sin `now` se usa el reloj del servidor y sin `limit` se
 * procesan hasta 200 reservas por ejecución.
 */
export const expireJobBodySchema = z
  .object({
    now: instantField.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'El límite debe ser al menos 1')
      .max(1000, 'El límite no puede superar 1000 reservas por ejecución')
      .default(200),
  })
  .strict()
  .optional();

/** `GET /reservations/:id` · acciones. */
export const reservationIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** Columnas permitidas como orden en `GET /reservations` (API.md 7.8). */
export const RESERVATION_SORT_COLUMNS = [
  'start_at',
  'end_at',
  'created_at',
  'rental_total_minor',
  'status',
  'duration_minutes',
  'code',
] as const;
export const RESERVATION_SORT_DEFAULT = 'start_at';

/** Margen de gracia de un `PENDING` sin check-in (BR-RES-004). */
export const PENDING_GRACE_MINUTES = RESERVATION.PENDING_GRACE_MINUTES;

/** Tipos inferidos, para el controller. */
export type ListReservationsQuery = z.infer<typeof listReservationsQuerySchema>;
export type QuoteReservationQuery = z.infer<typeof quoteReservationQuerySchema>;
export type CreateReservationBody = z.infer<typeof createReservationBodySchema>;
export type CheckInReservationBody = z.infer<typeof checkInReservationBodySchema>;
export type ExtendReservationBody = z.infer<typeof extendReservationBodySchema>;
export type CompleteReservationBody = z.infer<typeof completeReservationBodySchema>;
export type CancelReservationBody = z.infer<typeof cancelReservationBodySchema>;
export type ReservationIdParams = z.infer<typeof reservationIdParamsSchema>;
/**
 * Forma del cuerpo del job con los defaults ya resueltos. El esquema es
 * `.optional()` (el cuerpo puede no venir), así que el tipo que ve el handler
 * es el no-nulo.
 */
export type ExpireJobBody = NonNullable<z.infer<typeof expireJobBodySchema>>;
