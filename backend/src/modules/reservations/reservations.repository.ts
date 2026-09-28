/**
 * Contrato de persistencia de reservas (`chair_reservations`).
 *
 * ============================================================================
 * `findOverlapping` ES LA FUNCIÓN MÁS IMPORTANTE DE ESTE FICHERO
 * ============================================================================
 * Es la que implementa BR-RES-002: **una** consulta que devuelve la reserva que
 * estorba, o `null`. El service la ejecuta DENTRO de la transacción abierta con
 * `runInTransactionSync` (`BEGIN IMMEDIATE`), y ese es el motivo de existir como
 * método aislado y sin ninguna otra responsabilidad: un `SELECT` fuera de la
 * transacción seguido de un `INSERT` es una condición de carrera (DESIGN.md 8.3,
 * punto 5).
 *
 * La condición es literalmente `NOT (end_at <= :startAt OR start_at >= :endAt)`:
 * intervalos semiabiertos `[start, end)`, de modo que los extremos que se tocan
 * NO se solapan (BR-RES-001: uno suelta la silla a las 12:00 y otro la toma a
 * las 12:00). Es la misma verdad que `overlaps()` de `shared/utils/datetime.ts`,
 * pero en SQL para que la comprobación ocurra dentro de la transacción.
 *
 * `status IN ('PENDING','CONFIRMED','ACTIVE')`: los tres estados bloquean, no
 * sólo los confirmados. Es la lista `BLOCKING_RESERVATION_STATUSES` del dominio
 * compartido y coincide con el punto 4 de DESIGN.md 4.3.
 *
 * ============================================================================
 * `excludeReservationId`
 * ============================================================================
 * Al extender o al confirmar hay que ignorar la propia reserva: sin ese
 * parámetro, la reserva se solaparía consigo misma y toda extensión fallaría.
 */
import type { Db } from '../../shared/database/connection.js';
import type { ReservationSource, ReservationStatus } from '../../shared/domain/index.js';
import type { ReservationSummary } from '../spaces/spaces.types.js';

/** Fila de `chair_reservations` con los datos de presentación ya unidos. */
export interface ReservationRow {
  readonly id: number;
  readonly business_id: number;
  readonly location_id: number;
  readonly zone_id: number;
  readonly chair_id: number;
  readonly customer_id: number | null;
  readonly order_id: number | null;
  readonly code: string;
  readonly status: ReservationStatus;
  readonly start_at: string;
  readonly end_at: string;
  readonly duration_minutes: number;
  readonly price_per_hour_minor: number;
  readonly rental_total_minor: number;
  readonly checked_in_at: string | null;
  readonly checked_out_at: string | null;
  readonly cancelled_at: string | null;
  readonly cancel_reason: string | null;
  readonly source: ReservationSource;
  readonly created_by: number | null;
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  /** JOIN: `chairs.code`. Es lo que el cliente ve en su reserva. */
  readonly chair_code: string;
  /** JOIN: `zones.name`. */
  readonly zone_name: string;
  /** JOIN: `users.full_name`. `null` en reservas de mostrador. */
  readonly customer_name: string | null;
}

/** Fila mínima para la comprobación de solapamiento. */
export interface ReservationConflictRow {
  readonly id: number;
  readonly code: string;
  readonly status: ReservationStatus;
  readonly start_at: string;
  readonly end_at: string;
}

/** Intervalo ocupado de una silla, para el calendario de disponibilidad. */
export interface ReservationWindow {
  readonly id: number;
  readonly code: string;
  readonly status: ReservationStatus;
  readonly startAt: string;
  readonly endAt: string;
  readonly customerId: number | null;
}

/** Filtro de `GET /reservations`. `businessId` sale SIEMPRE del token. */
export interface ReservationListFilter {
  readonly businessId: number;
  readonly from?: string;
  readonly to?: string;
  readonly chairId?: number;
  readonly zoneId?: number;
  readonly locationId?: number;
  /** Forzado por el service a `actor.id` cuando el actor no tiene `read:any`. */
  readonly customerId?: number;
  readonly status?: ReservationStatus;
  readonly code?: string;
  readonly limit: number;
  readonly offset: number;
  readonly sort: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
}

/** Datos de inserción de una reserva. El estado inicial es SIEMPRE `PENDING`. */
export interface NewReservation {
  readonly businessId: number;
  readonly locationId: number;
  readonly zoneId: number;
  readonly chairId: number;
  readonly customerId: number | null;
  readonly code: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly durationMinutes: number;
  /** Precio CONGELADO: no vuelve a leer `chairs.price_per_hour_minor`. */
  readonly pricePerHourMinor: number;
  /** Proyección de BR-RENTAL-001 sobre `durationMinutes`. */
  readonly rentalTotalMinor: number;
  readonly source: ReservationSource;
  readonly createdBy: number | null;
  readonly notes: string | null;
}

/** Filtro de las ventanas de una silla. */
export interface ChairWindowFilter {
  readonly businessId: number;
  readonly chairId: number;
  readonly from: string;
  readonly to: string;
}

/** Reserva vencida que el job de expiración debe marcar `EXPIRED`. */
export interface OverdueReservationRow {
  readonly id: number;
  readonly chair_id: number;
  readonly code: string;
  readonly status: ReservationStatus;
  readonly start_at: string;
  readonly end_at: string;
}

/** Repositorio de reservas. */
export interface ReservationsRepository {
  // --- Lecturas ------------------------------------------------------------

  /** Reserva por id, acotada al negocio. `null` si no existe. */
  findById(reservationId: number, businessId: number, db?: Db): ReservationRow | null;
  /** Reserva por `code` (`RES-000001`), acotada al negocio. */
  findByCode(code: string, businessId: number, db?: Db): ReservationRow | null;
  /** Listado paginado. */
  list(filter: ReservationListFilter, db?: Db): readonly ReservationRow[];
  /** Total de reservas que satisfacen el filtro, sin paginar. */
  count(filter: Omit<ReservationListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Contadores por estado del filtro, para el `meta.countsByStatus`. */
  countByStatus(filter: Omit<ReservationListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): readonly { readonly status: ReservationStatus; readonly total: number }[];

  /**
   * BR-RES-002: reserva que bloquea `[startAt, endAt)` para la silla, o `null`.
   * Pensada para ejecutarse dentro de la transacción de escritura.
   */
  findOverlapping(
    businessId: number,
    chairId: number,
    startAt: string,
    endAt: string,
    excludeReservationId: number | null,
    db?: Db,
  ): ReservationConflictRow | null;

  /** Ventanas ocupadas de una silla en un rango, para el calendario. */
  listWindowsForChair(filter: ChairWindowFilter, db?: Db): readonly ReservationWindow[];
  /** Reservas de una silla en un rango, para el historial. */
  listForChair(filter: ChairWindowFilter, db?: Db): readonly ReservationRow[];
  /** Reserva viva de una silla en un instante: `ACTIVE` o la `CONFIRMED` vigente. */
  findCurrentForChair(businessId: number, chairId: number, at: string, db?: Db): ReservationRow | null;
  /** Reserva `ACTIVE` que debe abrirse o cerrarse como alquiler. */
  findActiveById(reservationId: number, businessId: number, db?: Db): ReservationRow | null;
  /** Reservas que bloquean una silla desde `from` (PENDING/CONFIRMED/ACTIVE). */
  listBlockingForChair(businessId: number, chairId: number, from: string, db?: Db): readonly ReservationWindow[];
  /** `COUNT(*)` de reservas de una silla: decide si su `code` es inmutable. */
  countForChair(chairId: number, db?: Db): number;
  /** Reservas vencidas según BR-RES-004, para el job de expiración. */
  listOverdue(businessId: number, pendingDeadline: string, now: string, limit: number, db?: Db): readonly OverdueReservationRow[];

  // --- Escrituras ----------------------------------------------------------

  /** Inserta la reserva en `PENDING` y devuelve su id. */
  insert(reservation: NewReservation, db?: Db): number;
  /** Cambia el estado sin timestamps de estado (confirmar, expirar). */
  updateStatus(reservationId: number, status: ReservationStatus, db?: Db): void;
  /** `CONFIRMED -> ACTIVE`: escribe estado y `checked_in_at` en la misma sentencia. */
  markCheckedIn(reservationId: number, status: ReservationStatus, checkedInAt: string, db?: Db): void;
  /** `ACTIVE -> COMPLETED`: escribe estado y `checked_out_at` juntos. */
  markCheckedOut(reservationId: number, status: ReservationStatus, checkedOutAt: string, db?: Db): void;
  /** Cancelación: estado, `cancelled_at` y `cancel_reason`. */
  markCancelled(reservationId: number, status: ReservationStatus, cancelledAt: string, reason: string, db?: Db): void;
  /** Extensión: mueve `end_at` y recalcula `duration_minutes` y `rental_total_minor`. */
  updateWindow(
    reservationId: number,
    endAt: string,
    durationMinutes: number,
    rentalTotalMinor: number,
    db?: Db,
  ): void;
  /** Asocia el pedido de cobro (lo usa el módulo de pedidos, no este servicio). */
  attachOrder(reservationId: number, orderId: number, db?: Db): void;
}

/** Proyección mínima de una reserva, reutilizable por otros módulos. */
export function toReservationSummary(row: ReservationRow): ReservationSummary {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
  };
}
