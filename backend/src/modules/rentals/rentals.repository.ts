/**
 * Contrato de persistencia de alquileres (`chair_rentals` y
 * `chair_rental_extensions`).
 *
 * ============================================================================
 * DIFERENCIA CON LAS RESERVAS QUE IMPONE EL ESQUEMA
 * ============================================================================
 * El alquiler NO es un intervalo planificado: es un hecho físico exclusivo e
 * instantáneo. Por eso el índice parcial `ux_chair_rental_active` (un
 * `ACTIVE`/`EXTENDED` por silla) sí es suficiente y exacto, mientras que en
 * reservas no lo es (DESIGN.md 4.3 y BR-RENTAL-009). Esa es la razón de que aquí
 * la comprobación sea "existe un alquiler vivo para esta silla" y no un
 * solapamiento de intervalos.
 *
 * `chair_rental_extensions` es INMUTABLE (no tiene `updated_at` ni `deleted_at`):
 * cada extensión es un hecho económico que no se edita, se suma. Por eso las
 * extensiones cobradas por adelantado (`additional_minor`) son un concepto
 * separado del overage y no se recalculan al cerrar (BR-RENTAL-005).
 */
import type { Db } from '../../shared/database/connection.js';
import type { RentalStatus } from '../../shared/domain/index.js';
import type { RentalSummary } from '../spaces/spaces.types.js';

/** Fila de `chair_rentals` con los datos de presentación ya unidos. */
export interface RentalRow {
  readonly id: number;
  readonly business_id: number;
  readonly chair_id: number;
  readonly reservation_id: number | null;
  readonly customer_id: number | null;
  readonly code: string;
  readonly status: RentalStatus;
  readonly start_at: string;
  readonly end_at: string;
  /** Minutos del plan ORIGINAL, congelados (BR-RENTAL-006). */
  readonly planned_minutes: number;
  /** Minutos facturados: se escribe al completar (BR-RENTAL-002). */
  readonly billed_minutes: number;
  /** Precio CONGELADO al abrir. Es la base del overage (BR-RENTAL-003). */
  readonly price_per_hour_minor: number;
  readonly subtotal_minor: number;
  readonly extensions_minor: number;
  readonly extra_minutes_minor: number;
  readonly total_minor: number;
  readonly created_by: number | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly chair_code: string;
  readonly zone_id: number;
  readonly zone_name: string;
  readonly location_id: number;
  readonly customer_name: string | null;
}

/** Fila de `chair_rental_extensions`: inmutable, sólo se inserta. */
export interface RentalExtensionRow {
  readonly id: number;
  readonly rental_id: number;
  readonly chair_id: number;
  readonly requested_minutes: number;
  readonly previous_end_at: string;
  readonly new_end_at: string;
  readonly additional_minor: number;
  /** Copia del precio congelado del alquiler (BR-RENTAL-011). */
  readonly price_per_hour_minor: number;
  readonly reason: string | null;
  readonly created_by: number | null;
  readonly created_at: string;
}

/** Datos de inserción de un alquiler. El estado inicial es SIEMPRE `ACTIVE`. */
export interface NewRental {
  readonly businessId: number;
  readonly chairId: number;
  /** `null` en alquiler walk-in sin reserva previa. */
  readonly reservationId: number | null;
  readonly customerId: number | null;
  readonly code: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly plannedMinutes: number;
  /** Precio congelado de `chairs.price_per_hour_minor` en este instante. */
  readonly pricePerHourMinor: number;
  /** Proyección de BR-RENTAL-001 sobre `planned_minutes`. */
  readonly subtotalMinor: number;
  readonly createdBy: number | null;
}

/** Datos de inserción de una extensión de alquiler. */
export interface NewRentalExtension {
  readonly rentalId: number;
  readonly chairId: number;
  readonly requestedMinutes: number;
  readonly previousEndAt: string;
  readonly newEndAt: string;
  /** `roundHalfUp(requested_minutes / 60 * price_per_hour_minor)`. */
  readonly additionalMinor: number;
  /** Copia del precio congelado: la extensión no usa el precio vigente. */
  readonly pricePerHourMinor: number;
  readonly reason: string | null;
  readonly createdBy: number | null;
}

/** Filtro de `GET /rentals`. `businessId` sale SIEMPRE del token. */
export interface RentalListFilter {
  readonly businessId: number;
  readonly status?: RentalStatus;
  readonly chairId?: number;
  readonly zoneId?: number;
  readonly locationId?: number;
  /** Forzado por el service a `actor.id` cuando el actor no tiene `read:any`. */
  readonly customerId?: number;
  readonly reservationId?: number;
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
  readonly sort: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
}

/** Intervalo ocupado por un alquiler, para el calendario de disponibilidad. */
export interface RentalWindow {
  readonly id: number;
  readonly code: string;
  readonly status: RentalStatus;
  readonly startAt: string;
  readonly endAt: string;
  readonly customerId: number | null;
}

/** Filtro de las ventanas de una silla. */
export interface ChairWindowFilter {
  readonly businessId: number;
  readonly chairId: number;
  readonly from: string;
  readonly to: string;
}

/** Agregados de facturación de un alquiler cerrado. */
export interface RentalChairStats {
  readonly minutes: number;
  readonly revenueMinor: number;
  readonly sessions: number;
}

/** Cierre de un alquiler: minutos reales, overage y total (BR-RENTAL-001..004). */
export interface RentalClose {
  readonly status: RentalStatus;
  readonly billedMinutes: number;
  readonly extraMinutesMinor: number;
  readonly totalMinor: number;
}

/** Extensión aplicada a un alquiler vivo. */
export interface RentalExtend {
  readonly status: RentalStatus;
  readonly endAt: string;
  readonly extensionsMinor: number;
  readonly totalMinor: number;
}

/** Repositorio de alquileres y sus extensiones. */
export interface RentalsRepository {
  // --- Lecturas ------------------------------------------------------------

  /** Alquiler por id, acotado al negocio. `null` si no existe. */
  findById(rentalId: number, businessId: number, db?: Db): RentalRow | null;
  /** Alquiler por `code` (`RENT-000001`), acotado al negocio. */
  findByCode(code: string, businessId: number, db?: Db): RentalRow | null;
  /** Listado paginado. */
  list(filter: RentalListFilter, db?: Db): readonly RentalRow[];
  /** Total de alquileres que satisfacen el filtro, sin paginar. */
  count(filter: Omit<RentalListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Contadores por estado del filtro, para el `meta.countsByStatus`. */
  countByStatus(filter: Omit<RentalListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): readonly { readonly status: RentalStatus; readonly total: number }[];
  /** Alquiler vivo (`ACTIVE`/`EXTENDED`) de una silla. La fila, no un booleano. */
  findActiveByChair(businessId: number, chairId: number, db?: Db): RentalRow | null;
  /**
   * Listado paginado de alquileres vivos, para `GET /rentals/active`.
   *
   * Acepta el filtro COMPLETO (con `limit`, `offset` y `sort`) a propósito: el
   * corte de página tiene que aplicarse DESPUÉS de restricting por alcance, y
   * hacerlo en SQL con un `LIMIT` al que todavía no se le ha aplicado el scope del
   * cliente daría páginas incoherentes entre dos peticiones del mismo cliente.
   * El service resuelve primero el alcance y luego pagina.
   */
  listActive(filter: RentalListFilter, db?: Db): readonly RentalRow[];
  /** Ventanas ocupadas de una silla en un rango, para el calendario. */
  listWindowsForChair(filter: ChairWindowFilter, db?: Db): readonly RentalWindow[];
  /** Alquileres de una silla en un rango, para el historial. */
  listForChair(filter: ChairWindowFilter, db?: Db): readonly RentalRow[];
  /** Alquileres de una reserva (`chair_rentals.reservation_id`). */
  listByReservation(reservationId: number, db?: Db): readonly RentalRow[];
  /** Extensiones registradas de un alquiler, en orden cronológico. */
  listExtensions(rentalId: number, db?: Db): readonly RentalExtensionRow[];
  /** Agregados de facturación de una silla (minutos facturados e importe). */
  chairStats(chairId: number, from: string, to: string, db?: Db): RentalChairStats;

  // --- Escrituras ----------------------------------------------------------

  /** Inserta el alquiler en `ACTIVE` y devuelve su id. */
  insert(rental: NewRental, db?: Db): number;
  /** Inserta una extensión. La tabla es inmutable: nunca se actualiza. */
  insertExtension(extension: NewRentalExtension, db?: Db): number;
  /** Cierra el alquiler: estado, `billed_minutes`, overage y `total_minor`. */
  close(rentalId: number, close: RentalClose, db?: Db): void;
  /** Aplica una extensión: `end_at`, `extensions_minor`, `total_minor` y estado. */
  extend(rentalId: number, extension: RentalExtend, db?: Db): void;
  /** Cambia sólo el estado. Para cancelaciones (BR-RENTAL: nunca queda en cero). */
  updateStatus(rentalId: number, status: RentalStatus, db?: Db): void;
}

/** Proyección mínima de un alquiler, reutilizable por otros módulos. */
export function toRentalSummary(row: RentalRow): RentalSummary {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    totalMinor: row.total_minor,
  };
}
