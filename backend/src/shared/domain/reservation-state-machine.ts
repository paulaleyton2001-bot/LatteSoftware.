/**
 * Máquina de estados de `chair_reservations` (DESIGN.md 6.2).
 *
 * Garantías que fija esta tabla:
 *  - No se puede saltar de `PENDING` a `ACTIVE`: la confirmación es la que
 *    revalida el solapamiento dentro de la transacción (BR-RES-002) y la que
 *    hace que el índice parcial `ux_chair_res_active` cubra la fila.
 *  - `COMPLETED` sólo se alcanza desde `ACTIVE` (check-in + check-out).
 *  - `PENDING -> EXPIRED` y `CONFIRMED -> EXPIRED` son del scheduler.
 *  - `CANCELLED`, `EXPIRED` y `COMPLETED` son terminales.
 *
 * El solapamiento temporal NO se resuelve aquí: se resuelve con `overlaps()` de
 * `shared/utils/datetime.ts` ejecutando el SELECT dentro del mismo
 * `BEGIN IMMEDIATE` (BR-RES-002 y DESIGN.md 8.3).
 */
import { BusinessRuleError } from '../errors/index.js';
import { ReservationStatus, Role, SYSTEM_ACTOR } from './enums.js';
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
const EVERYONE: readonly (typeof Role)[keyof typeof Role][] = [Role.CUSTOMER, ...ALL_STAFF];

/** Transiciones permitidas de `chair_reservations`. */
export const RESERVATION_TRANSITIONS: readonly StateTransition<
  ReservationStatus,
  ReservationStatus
>[] = Object.freeze([
  {
    from: ReservationStatus.PENDING,
    to: ReservationStatus.CONFIRMED,
    roles: EVERYONE,
    label: 'Confirmar reserva',
    endpoint: 'POST /api/v1/reservations/{id}/confirm',
  },
  {
    from: ReservationStatus.PENDING,
    to: ReservationStatus.CANCELLED,
    roles: EVERYONE,
    label: 'Cancelar reserva',
    endpoint: 'POST /api/v1/reservations/{id}/cancel',
  },
  {
    from: ReservationStatus.PENDING,
    to: ReservationStatus.EXPIRED,
    roles: [SYSTEM_ACTOR],
    label: 'Marcar como no-show',
    endpoint: 'scheduler:expire-reservations',
  },
  {
    from: ReservationStatus.CONFIRMED,
    to: ReservationStatus.ACTIVE,
    roles: ALL_STAFF,
    label: 'Check-in',
    endpoint: 'POST /api/v1/reservations/{id}/check-in',
  },
  {
    from: ReservationStatus.CONFIRMED,
    to: ReservationStatus.CANCELLED,
    roles: EVERYONE,
    label: 'Cancelar reserva',
    endpoint: 'POST /api/v1/reservations/{id}/cancel',
  },
  {
    from: ReservationStatus.CONFIRMED,
    to: ReservationStatus.EXPIRED,
    roles: [SYSTEM_ACTOR],
    label: 'Expirar por no iniciado',
    endpoint: 'scheduler:expire-reservations',
  },
  {
    from: ReservationStatus.ACTIVE,
    to: ReservationStatus.COMPLETED,
    roles: ALL_STAFF,
    label: 'Check-out',
    endpoint: 'POST /api/v1/reservations/{id}/check-out',
  },
  {
    from: ReservationStatus.ACTIVE,
    to: ReservationStatus.CANCELLED,
    roles: MANAGERS,
    label: 'Cancelar con cobro',
    endpoint: 'POST /api/v1/reservations/{id}/cancel',
  },
]);

/** Transiciones prohibidas y su motivo (DESIGN.md 6.2). */
export const RESERVATION_FORBIDDEN_TRANSITIONS = Object.freeze([
  { from: ReservationStatus.PENDING, to: ReservationStatus.ACTIVE, reason: 'Saltarse la confirmación permitiría ocupar la silla sin validar el solapamiento real' },
  { from: ReservationStatus.PENDING, to: ReservationStatus.COMPLETED, reason: 'Nunca se empieza ni se termina una reserva sin check-in' },
  { from: ReservationStatus.CONFIRMED, to: ReservationStatus.COMPLETED, reason: 'Imposible sin pasar por ACTIVE' },
  { from: ReservationStatus.CANCELLED, to: ReservationStatus.CONFIRMED, reason: 'No se resucita una reserva cancelada' },
  { from: ReservationStatus.CANCELLED, to: ReservationStatus.ACTIVE, reason: 'CANCELLED es terminal' },
  { from: ReservationStatus.CANCELLED, to: ReservationStatus.PENDING, reason: 'CANCELLED es terminal' },
  { from: ReservationStatus.CANCELLED, to: ReservationStatus.EXPIRED, reason: 'Cancelar y expirar son terminales distintos' },
  { from: ReservationStatus.EXPIRED, to: ReservationStatus.CONFIRMED, reason: 'Una reserva vencida no se revive' },
  { from: ReservationStatus.EXPIRED, to: ReservationStatus.ACTIVE, reason: 'EXPIRED es terminal' },
  { from: ReservationStatus.EXPIRED, to: ReservationStatus.PENDING, reason: 'EXPIRED es terminal' },
  { from: ReservationStatus.EXPIRED, to: ReservationStatus.COMPLETED, reason: 'EXPIRED es terminal' },
  { from: ReservationStatus.COMPLETED, to: ReservationStatus.ACTIVE, reason: 'El check-in ya ocurrió y el alquiler se facturó' },
  { from: ReservationStatus.COMPLETED, to: ReservationStatus.CONFIRMED, reason: 'COMPLETED es terminal' },
  { from: ReservationStatus.COMPLETED, to: ReservationStatus.CANCELLED, reason: 'Si se cobró, el camino es un reembolso sobre orders' },
  { from: ReservationStatus.COMPLETED, to: ReservationStatus.EXPIRED, reason: 'COMPLETED es terminal' },
  { from: ReservationStatus.COMPLETED, to: ReservationStatus.PENDING, reason: 'COMPLETED es terminal' },
  { from: ReservationStatus.ACTIVE, to: ReservationStatus.CONFIRMED, reason: 'Retroceder perdería la silla ocupada' },
  { from: ReservationStatus.ACTIVE, to: ReservationStatus.PENDING, reason: 'Retroceder perdería la silla ocupada' },
  { from: ReservationStatus.ACTIVE, to: ReservationStatus.EXPIRED, reason: 'Si el cliente sigue adentro, la reserva no expira' },
  { from: ReservationStatus.ACTIVE, to: ReservationStatus.ACTIVE, reason: 'Idempotencia prohibida: repita el check-out' },
] as const);

/** Máquina de estados de `chair_reservations`. */
export const RESERVATION_STATE_MACHINE: StateMachine<ReservationStatus> =
  defineStateMachine<ReservationStatus>({
    entity: 'chairReservations',
    initial: ReservationStatus.PENDING,
    terminal: [ReservationStatus.CANCELLED, ReservationStatus.EXPIRED, ReservationStatus.COMPLETED],
    transitions: RESERVATION_TRANSITIONS,
    forbidden: RESERVATION_FORBIDDEN_TRANSITIONS,
  });

/** `true` si `(from, to)` es una transición válida de reserva. */
export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return isValidTransition(RESERVATION_STATE_MACHINE, from, to);
}

/** `true` si el estado no admite más transiciones de salida. */
export function isTerminalReservationStatus(status: ReservationStatus): boolean {
  return isTerminalStatus(RESERVATION_STATE_MACHINE, status);
}

/** Transición concreta, o `undefined` si no existe. */
export function findReservationTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): StateTransition<ReservationStatus, ReservationStatus> | undefined {
  return RESERVATION_TRANSITIONS.find(
    (transition) => transition.from === from && transition.to === to,
  );
}

/** Estados alcanzables desde `from` en un paso. */
export function nextReservationStatuses(from: ReservationStatus): readonly ReservationStatus[] {
  return RESERVATION_TRANSITIONS.filter((transition) => transition.from === from).map(
    (transition) => transition.to,
  );
}

/**
 * Falla si la transición no está permitida.
 *
 * @throws BusinessRuleError 422 con `details = { code: 'INVALID_RESERVATION_TRANSITION',
 *         from, to, allowed, reason? }`.
 */
export function assertTransition(from: ReservationStatus, to: ReservationStatus): void {
  if (canTransition(from, to)) {
    return;
  }
  const reason = forbiddenReason(RESERVATION_STATE_MACHINE, from, to);
  throw new BusinessRuleError(
    `No se puede pasar una reserva de ${from} a ${to}`,
    {
      details: {
        code: 'INVALID_RESERVATION_TRANSITION',
        entity: 'chairReservations',
        from,
        to,
        allowed: nextReservationStatuses(from),
        ...(reason === null ? {} : { reason }),
      },
    },
  );
}

/**
 * Estados de reserva que bloquean la silla para el chequeo de solapamiento
 * (BR-RES-002). Son los que aparecen en la condición
 * `NOT (end_at <= :start OR start_at >= :end)`.
 */
export const BLOCKING_RESERVATION_STATUSES: readonly ReservationStatus[] = Object.freeze([
  ReservationStatus.PENDING,
  ReservationStatus.CONFIRMED,
  ReservationStatus.ACTIVE,
]);
