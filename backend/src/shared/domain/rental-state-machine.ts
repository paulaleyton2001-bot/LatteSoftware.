/**
 * Máquina de estados de `chair_rentals` (DESIGN.md 6.3).
 *
 * Diferencia clave con las reservas: aquí el alquiler es un hecho físico
 * exclusivo e instantáneo, no un intervalo planificado. Por eso el índice
 * parcial `ux_chair_rental_active` (un ACTIVE/EXTENDED por silla) sí es
 * suficiente y exacto, y por eso `EXTENDED -> EXTENDED` sí es válida
 * (extensiones sucesivas).
 */
import { BusinessRuleError } from '../errors/index.js';
import { RentalStatus, Role } from './enums.js';
import {
  defineStateMachine,
  forbiddenReason,
  isTerminalStatus,
  isValidTransition,
  type StateMachine,
  type StateTransition,
} from './types.js';

const ALL_STAFF: readonly (typeof Role)[keyof typeof Role][] = [
  Role.STAFF,
  Role.CASHIER,
  Role.MANAGER,
  Role.ADMIN,
  Role.OWNER,
];
const MANAGERS: readonly (typeof Role)[keyof typeof Role][] = [Role.MANAGER, Role.ADMIN, Role.OWNER];

/** Transiciones permitidas de `chair_rentals`. */
export const RENTAL_TRANSITIONS: readonly StateTransition<RentalStatus, RentalStatus>[] =
  Object.freeze([
    {
      from: RentalStatus.ACTIVE,
      to: RentalStatus.EXTENDED,
      roles: ALL_STAFF,
      label: 'Extender alquiler',
      endpoint: 'POST /api/v1/rentals/{id}/extend',
    },
    {
      from: RentalStatus.EXTENDED,
      to: RentalStatus.EXTENDED,
      roles: ALL_STAFF,
      label: 'Extender alquiler',
      endpoint: 'POST /api/v1/rentals/{id}/extend',
    },
    {
      from: RentalStatus.ACTIVE,
      to: RentalStatus.COMPLETED,
      roles: ALL_STAFF,
      label: 'Cerrar alquiler',
      endpoint: 'POST /api/v1/rentals/{id}/complete',
    },
    {
      from: RentalStatus.EXTENDED,
      to: RentalStatus.COMPLETED,
      roles: ALL_STAFF,
      label: 'Cerrar alquiler',
      endpoint: 'POST /api/v1/rentals/{id}/complete',
    },
    {
      from: RentalStatus.ACTIVE,
      to: RentalStatus.CANCELLED,
      roles: MANAGERS,
      label: 'Cancelar alquiler',
      endpoint: 'POST /api/v1/rentals/{id}/cancel',
    },
    {
      from: RentalStatus.EXTENDED,
      to: RentalStatus.CANCELLED,
      roles: MANAGERS,
      label: 'Cancelar alquiler',
      endpoint: 'POST /api/v1/rentals/{id}/cancel',
    },
  ]);

/** Transiciones prohibidas y su motivo (DESIGN.md 6.3). */
export const RENTAL_FORBIDDEN_TRANSITIONS = Object.freeze([
  { from: RentalStatus.COMPLETED, to: RentalStatus.ACTIVE, reason: 'El alquiler se cierra una vez, con su cobro' },
  { from: RentalStatus.COMPLETED, to: RentalStatus.EXTENDED, reason: 'No se extiende un alquiler ya facturado' },
  { from: RentalStatus.COMPLETED, to: RentalStatus.CANCELLED, reason: 'Si se cobró, el camino es orders.REFUNDED' },
  { from: RentalStatus.CANCELLED, to: RentalStatus.ACTIVE, reason: 'CANCELLED es terminal' },
  { from: RentalStatus.CANCELLED, to: RentalStatus.EXTENDED, reason: 'CANCELLED es terminal' },
  { from: RentalStatus.CANCELLED, to: RentalStatus.COMPLETED, reason: 'CANCELLED es terminal' },
] as const);

/** Máquina de estados de `chair_rentals`. */
export const RENTAL_STATE_MACHINE: StateMachine<RentalStatus> = defineStateMachine<RentalStatus>({
  entity: 'chairRentals',
  initial: RentalStatus.ACTIVE,
  terminal: [RentalStatus.COMPLETED, RentalStatus.CANCELLED],
  transitions: RENTAL_TRANSITIONS,
  forbidden: RENTAL_FORBIDDEN_TRANSITIONS,
});

/** `true` si `(from, to)` es una transición válida de alquiler. */
export function canTransition(from: RentalStatus, to: RentalStatus): boolean {
  return isValidTransition(RENTAL_STATE_MACHINE, from, to);
}

/** `true` si el alquiler sigue vivo. */
export function isTerminalRentalStatus(status: RentalStatus): boolean {
  return isTerminalStatus(RENTAL_STATE_MACHINE, status);
}

/** Estados que ocupan la silla de forma exclusiva (índice parcial). */
export const ACTIVE_RENTAL_STATUSES: readonly RentalStatus[] = Object.freeze([
  RentalStatus.ACTIVE,
  RentalStatus.EXTENDED,
]);

/** Falla si la transición no está permitida. */
export function assertTransition(from: RentalStatus, to: RentalStatus): void {
  if (canTransition(from, to)) {
    return;
  }
  const reason = forbiddenReason(RENTAL_STATE_MACHINE, from, to);
  throw new BusinessRuleError(`No se puede pasar un alquiler de ${from} a ${to}`, {
    details: {
      code: 'INVALID_RENTAL_TRANSITION',
      entity: 'chairRentals',
      from,
      to,
      ...(reason === null ? {} : { reason }),
    },
  });
}
