/**
 * DTOs de dominio de reservas (API.md 7.8).
 *
 * La reserva es un INTERVALO PLANIFICADO y el alquiler es un HECHO FÍSICO
 * (DESIGN.md 4.3). Esa diferencia se nota aquí: la reserva lleva
 * `durationMinutes` y una proyección `rentalTotalMinor`; el alquiler lleva
 * `billedMinutes` y un total real. Mezclarlos haría que la UI mostrara un precio
 * estimado como si fuera cobrado.
 */
import type { ChairStatus, ReservationSource, ReservationStatus } from '../../shared/domain/index.js';
import type { ChairView, ReservationSummary, RentalSummary } from '../spaces/spaces.types.js';

/** Reserva tal y como la expone la API (`Reservation` de API.md 6.3). */
export interface ReservationView {
  readonly id: number;
  /** `RES-000001`. Es lo que el cliente dicta por teléfono. */
  readonly code: string;
  readonly businessId: number;
  readonly locationId: number;
  readonly zoneId: number;
  readonly zoneName: string;
  readonly chairId: number;
  readonly chairCode: string;
  readonly customerId: number | null;
  readonly customerName: string | null;
  readonly orderId: number | null;
  readonly status: ReservationStatus;
  readonly startAt: string;
  readonly endAt: string;
  /** `end - start` en minutos, materializado por el servidor (BR-RES-006). */
  readonly durationMinutes: number;
  /** Centavos por hora CONGELADOS al reservar (BR-PRICE-010). */
  readonly pricePerHourMinor: number;
  /** Proyección estimada, NO cobrada (BR-RES-007). */
  readonly rentalTotalMinor: number;
  readonly checkedInAt: string | null;
  readonly checkedOutAt: string | null;
  readonly cancelledAt: string | null;
  readonly cancelReason: string | null;
  readonly source: ReservationSource;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Cotización de `GET /reservations/quote` (sólo lectura, no escribe nada). */
export interface ReservationQuote {
  readonly chair: {
    readonly id: number;
    readonly code: string;
    readonly name: string | null;
    readonly kind: string;
    readonly capacity: number;
    readonly pricePerHourMinor: number;
    readonly features: readonly string[];
  };
  readonly zone: { readonly id: number; readonly name: string };
  readonly startAt: string;
  readonly endAt: string;
  readonly durationMinutes: number;
  /** Minutos a cobrar, con el mínimo de 30 ya aplicado (BR-RENTAL-001). */
  readonly billableMinutes: number;
  /** `true` si el mínimo de 30 minutos se aplicó a una sesión más corta. */
  readonly minApplied: boolean;
  readonly pricePerHourMinor: number;
  readonly subtotalMinor: number;
  /** Siempre 0: el módulo de descuentos todavía no existe. */
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  readonly totalMinor: number;
  readonly taxRateBp: number;
  /** `false` si la silla no es reservable, hay conflicto o hay alquiler abierto. */
  readonly isAvailable: boolean;
  /** La reserva que estorba, o `null`. Nunca es un 409: es una consulta. */
  readonly conflict: {
    readonly id: number;
    readonly code: string;
    readonly status: ReservationStatus;
    readonly startAt: string;
    readonly endAt: string;
  } | null;
  /** Reglas aplicadas, para que el cliente pueda depurar el cálculo. */
  readonly appliedRules: readonly string[];
}

/** Página de reservas con sus contadores por estado. */
export interface ReservationPage {
  readonly items: readonly ReservationView[];
  readonly total: number;
  readonly countsByStatus: Readonly<Record<string, number>>;
}

/** Detalle de una reserva (`GET /reservations/:id`). */
export interface ReservationDetail {
  readonly reservation: ReservationView;
  readonly chair: ChairView;
  /** Alquiler materializado por el check-in, si lo hay. */
  readonly currentRental: RentalSummary | null;
  /** Hitos: `created`, `checked_in`, `checked_out`, `cancelled`. */
  readonly timeline: readonly { readonly at: string; readonly event: string }[];
}

/** Desglose del cobro al hacer check-out de una reserva. */
export interface ReservationChargeView {
  readonly billedMinutes: number;
  readonly minimumApplied: boolean;
  /** Minutos de más sobre el plan (el overage de BR-RENTAL-004). */
  readonly extraMinutes: number;
  readonly pricePerHourMinor: number;
  readonly subtotalMinor: number;
  readonly extensionsMinor: number;
  readonly extraMinutesMinor: number;
  readonly totalMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  readonly grandTotalMinor: number;
  readonly currencyCode: string;
}

/** Resultado del check-in: reserva, alquiler y silla, en una sola respuesta. */
export interface ReservationCheckInResult {
  readonly reservation: ReservationView;
  readonly rental: ReservationSummary;
  readonly chair: ChairView;
  readonly warnings: readonly string[];
}

/** Resultado del check-out. */
export interface ReservationCompleteResult {
  readonly reservation: ReservationView;
  readonly rental: RentalSummary | null;
  readonly charge: ReservationChargeView;
}

/** Resultado del job de expiración (`POST /system/jobs/expire-reservations`). */
export interface ExpireReservationsResult {
  /** Número de reservas marcadas `EXPIRED` en esta ejecución. */
  readonly expired: number;
  /** Códigos de las reservas expiradas, para poder avisar al cliente. */
  readonly codes: readonly string[];
  /** Instante de referencia usado por el job. */
  readonly at: string;
}

/** Estado de la silla tras un check-in, para la respuesta del servicio. */
export type ChairStatusAfterCheckIn = ChairStatus;

/** Alias de la reserva resumida, usada al incrustar en otros recursos. */
export type EmbeddedReservation = ReservationSummary;
