/**
 * Esquemas zod de alquileres (API.md 7.9).
 *
 * TODOS `.strict()` (API.md 1).
 *
 * ========================= LO QUE NUNCA SE ACEPTA ============================
 * `startAt` NO se acepta en `POST /rentals`: el alquiler arranca SIEMPRE en
 * `now` (BR-RENTAL-007 y API.md 7.9: "el servidor usa `now`"). Aceptarlo abriría
 * la puerta a un alquiler con fecha de inicio inventada, que es exactamente el
 * hueco por el que se puede "perder" una hora de facturación.
 *
 * Tampoco se aceptan `pricePerHourMinor` (lo congela el servidor desde la silla),
 * ni `subtotalMinor` / `extensionsMinor` / `extraMinutesMinor` / `totalMinor`:
 * los importes los calcula el servidor con enteros en centavos (BR-MONEY-001 y
 * BR-ORDER-014).
 */
import { z } from 'zod';

import { RentalStatus } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField, searchQueryField } from '../../shared/validation/index.js';

/** Instante ISO-8601 con offset, normalizado a UTC. */
const instantField = z
  .string({ error: 'La fecha es obligatoria' })
  .datetime({ offset: true, message: 'Debe ser un instante ISO-8601, por ejemplo 2026-03-14T14:00:00.000Z' });

/** Motivo de la renuncia al sobretiempo. */
const waiveReasonField = z
  .string()
  .trim()
  .min(1, 'El motivo es obligatorio')
  .max(300, 'El motivo no puede superar 300 caracteres');

/** `GET /rentals` (API.md 7.9). */
export const listRentalsQuerySchema = buildListQuerySchema({
  status: z.enum(RentalStatus).optional(),
  chairId: resourceIdField.optional(),
  zoneId: resourceIdField.optional(),
  locationId: resourceIdField.optional(),
  /** Sobrescrito por el service si el actor no tiene `rentals:read:any`. */
  customerId: resourceIdField.optional(),
  reservationId: resourceIdField.optional(),
  from: instantField.optional(),
  to: instantField.optional(),
});

/** `GET /rentals/active` (API.md 7.9). Sólo `ACTIVE`/`EXTENDED`. */
export const listActiveRentalsQuerySchema = buildListQuerySchema({
  locationId: resourceIdField.optional(),
  zoneId: resourceIdField.optional(),
  q: searchQueryField,
});

/** `GET /rentals/chair/:chairId/active` (API.md 7.9). */
export const rentalByChairParamsSchema = z
  .object({
    chairId: resourceIdField,
  })
  .strict();

/**
 * `POST /rentals` (API.md 7.9).
 *
 * `plannedMinutes` por defecto 60 (BR-RENTAL-007). `reservationId` activa el
 * check-in implícito de una reserva `CONFIRMED`.
 */
export const createRentalBodySchema = z
  .object({
    chairId: resourceIdField,
    plannedMinutes: z.coerce
      .number()
      .int('La duración debe ser un número entero de minutos')
      .min(1, 'La duración debe ser al menos 1 minuto')
      .max(1440, 'La duración no puede superar 1440 minutos')
      .default(60),
    /** `null` = alquiler walk-in sin cliente identificado. */
    customerId: resourceIdField.nullable().optional(),
    reservationId: resourceIdField.optional(),
    /** El módulo de descuentos no existe: se acepta y no se aplica. */
    discountCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/, 'El código del descuento sólo admite mayúsculas, dígitos, guion y guion bajo')
      .optional(),
    notes: z.string().trim().max(500, 'Las notas no pueden superar 500 caracteres').nullable().optional(),
    applyTax: z.boolean().default(true),
  })
  .strict();

/** `POST /rentals/:id/extend` (API.md 7.9). */
export const extendRentalBodySchema = z
  .object({
    additionalMinutes: z.coerce
      .number()
      .int('La extensión debe ser un número entero de minutos')
      .min(5, 'La extensión mínima es de 5 minutos')
      .max(1440, 'La extensión no puede superar 1440 minutos'),
    reason: z.string().trim().max(300, 'El motivo no puede superar 300 caracteres').nullable().optional(),
  })
  .strict();

/** `POST /rentals/:id/complete` (API.md 7.9). */
export const completeRentalBodySchema = z
  .object({
    /** `now` por defecto (el check-out). */
    endAt: instantField.optional(),
    notes: z.string().trim().max(500, 'Las notas no pueden superar 500 caracteres').nullable().optional(),
    discountCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/)
      .optional(),
    /**
     * Perdonar el sobretiempo. Requiere MANAGER y `waiveReason`: lo valida el
     * service, no el esquema, porque depende del ROL del actor y el esquema no lo
     * conoce (el middleware no mira el body).
     */
    waiveOvertime: z.boolean().default(false),
    waiveReason: waiveReasonField.optional(),
  })
  .strict()
  .optional();

/** `GET /rentals/:id` · acciones. */
export const rentalIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** Columnas permitidas como orden en `GET /rentals` (API.md 7.9). */
export const RENTAL_SORT_COLUMNS = [
  'start_at',
  'end_at',
  'created_at',
  'total_minor',
  'billed_minutes',
  'code',
  'status',
] as const;
export const RENTAL_SORT_DEFAULT = 'start_at';

/** Columnas permitidas como orden en `GET /rentals/active` (API.md 7.9). */
export const ACTIVE_RENTAL_SORT_COLUMNS = ['start_at', 'end_at'] as const;
export const ACTIVE_RENTAL_SORT_DEFAULT = 'start_at';

/** Tipos inferidos, para el controller. */
export type ListRentalsQuery = z.infer<typeof listRentalsQuerySchema>;
export type ListActiveRentalsQuery = z.infer<typeof listActiveRentalsQuerySchema>;
export type RentalByChairParams = z.infer<typeof rentalByChairParamsSchema>;
export type CreateRentalBody = z.infer<typeof createRentalBodySchema>;
export type ExtendRentalBody = z.infer<typeof extendRentalBodySchema>;
export type CompleteRentalBody = z.infer<typeof completeRentalBodySchema>;
export type RentalIdParams = z.infer<typeof rentalIdParamsSchema>;
