/**
 * DTOs de dominio de alquileres (API.md 7.9).
 *
 * Todos los importes son enteros de centavos (P4, BR-MONEY-001) y todas las
 * fechas son ISO-8601 UTC (P5). Aquí no hay ningún `float` ni ninguna fecha en
 * `Date`: el mapeo desde las filas ocurre en el service.
 */
import type { RentalStatus } from '../../shared/domain/index.js';
import type { ReservationSummary } from '../spaces/spaces.types.js';

/** Alquiler tal y como lo ve la API (`Rental` de API.md 6.3). */
export interface RentalView {
  readonly id: number;
  readonly code: string;
  readonly chairId: number;
  readonly chairCode: string;
  readonly zoneId: number;
  readonly zoneName: string;
  readonly locationId: number;
  /** `null` en alquiler walk-in (API.md 4.3). */
  readonly reservationId: number | null;
  readonly customerId: number | null;
  readonly customerName: string | null;
  readonly status: RentalStatus;
  readonly startAt: string;
  /** Fin planeado. Se mueve al extender. */
  readonly endAt: string;
  /** Minutos del plan original, congelados. */
  readonly plannedMinutes: number;
  /** Minutos reales facturados. `0` mientras el alquiler está abierto. */
  readonly billedMinutes: number;
  /** Centavos por hora CONGELADOS al abrir (BR-RENTAL-003). */
  readonly pricePerHourMinor: number;
  readonly subtotalMinor: number;
  readonly extensionsMinor: number;
  /** Overage: minutos de más al precio congelado (BR-RENTAL-004). */
  readonly extraMinutesMinor: number;
  readonly totalMinor: number;
  /** Minutos transcurridos desde `startAt`, a la hora de la respuesta. */
  readonly elapsedMinutes: number;
  /** Minutos que quedan hasta `endAt`. Negativo si ya se pasó. */
  readonly remainingMinutes: number;
  /** Minutos consumidos por encima del plan. `0` si va en hora. */
  readonly overtimeMinutes: number;
  readonly createdBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Extensión registrada de un alquiler (`chair_rental_extensions`). */
export interface RentalExtensionView {
  readonly id: number;
  readonly requestedMinutes: number;
  readonly previousEndAt: string;
  readonly newEndAt: string;
  readonly additionalMinor: number;
  readonly pricePerHourMinor: number;
  readonly reason: string | null;
  readonly createdBy: number | null;
  readonly createdAt: string;
}

/** Cobro de un alquiler ya cerrado (API.md 7.9, `charge`). */
export interface RentalChargeView {
  readonly plannedMinutes: number;
  readonly billedMinutes: number;
  /** `true` si se aplicó el mínimo de 30 minutos (BR-RENTAL-001). */
  readonly minimumApplied: boolean;
  readonly overtimeMinutes: number;
  readonly pricePerHourMinor: number;
  readonly subtotalMinor: number;
  readonly extensionsMinor: number;
  readonly extraMinutesMinor: number;
  /** Centavos perdonados por `waiveOvertime`, para que la UI lo muestre. */
  readonly waivedMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  /** `subtotal + extensions + extra` (BR-RENTAL-006). */
  readonly totalMinor: number;
  readonly currencyCode: string;
  /** `total + tax + serviceFee`. */
  readonly grandTotalMinor: number;
}

/** Detalle de un alquiler (`GET /rentals/:id`). */
export interface RentalDetail {
  readonly rental: RentalView;
  readonly extensions: readonly RentalExtensionView[];
  readonly charge: RentalChargeView;
  readonly reservation: ReservationSummary | null;
}

/** Resultado de abrir un alquiler. */
export interface RentalOpenResult {
  readonly rental: RentalView;
  /** Estado de la silla tras la apertura: siempre `OCCUPIED` (BR-RENTAL-008). */
  readonly chairStatus: string;
  readonly chairStatusChangedAt: string;
}

/** Resultado de extender un alquiler. */
export interface RentalExtendResult {
  readonly rental: RentalView;
  readonly extension: RentalExtensionView;
  readonly chairStatus: string;
}

/** Resultado de cerrar un alquiler. */
export interface RentalCompleteResult {
  readonly rental: RentalView;
  readonly charge: RentalChargeView;
  readonly chairStatus: string;
  readonly chairStatusChangedAt: string;
}

/** Página de alquileres con sus contadores por estado. */
export interface RentalPage {
  readonly items: readonly RentalView[];
  readonly total: number;
  readonly countsByStatus: Readonly<Record<RentalStatus, number>>;
}

/** Contador a cero de los cuatro estados de alquiler (DESIGN.md 4.3). */
export function emptyRentalStatusCounts(): Record<RentalStatus, number> {
  return { ACTIVE: 0, EXTENDED: 0, COMPLETED: 0, CANCELLED: 0 };
}
