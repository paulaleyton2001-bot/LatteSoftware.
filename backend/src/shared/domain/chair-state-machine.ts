/**
 * Máquina de estados de `chairs` (DESIGN.md 6.4).
 *
 * Regla operativa central: `OCCUPIED` y `RESERVED` **no** se alcanzan por
 * `PATCH /chairs/{id}/status`. Sólo se llega a ellos por check-in, reserva
 * confirmada o apertura de alquiler (BR-CHAIR-003). En esta tabla se marcan
 * con `actors: SYSTEM` para que el servicio pueda distinguirlas de las que sí
 * puede disparar una persona.
 */
import { BusinessRuleError } from '../errors/index.js';
import { ChairStatus, Role, SYSTEM_ACTOR } from './enums.js';
import {
  defineStateMachine,
  forbiddenReason,
  isValidTransition,
  type StateMachine,
} from './types.js';

const MANAGERS: readonly (typeof Role)[keyof typeof Role][] = [Role.MANAGER, Role.ADMIN, Role.OWNER];
const ALL_STAFF: readonly (typeof Role)[keyof typeof Role][] = [
  Role.STAFF,
  Role.CASHIER,
  Role.MANAGER,
  Role.ADMIN,
  Role.OWNER,
];

/** Transiciones permitidas de `chairs`. */
export const CHAIR_TRANSITIONS = Object.freeze([
  { from: ChairStatus.AVAILABLE, to: ChairStatus.RESERVED, roles: [SYSTEM_ACTOR], label: 'Reserva confirmada', endpoint: 'sistema:reservas' },
  { from: ChairStatus.RESERVED, to: ChairStatus.AVAILABLE, roles: [SYSTEM_ACTOR, ...MANAGERS], label: 'Reserva cancelada o expirada', endpoint: 'sistema:reservas' },
  { from: ChairStatus.RESERVED, to: ChairStatus.OCCUPIED, roles: [SYSTEM_ACTOR, ...ALL_STAFF], label: 'Check-in de la reserva', endpoint: 'POST /api/v1/reservations/{id}/check-in' },
  { from: ChairStatus.AVAILABLE, to: ChairStatus.OCCUPIED, roles: ALL_STAFF, label: 'Alquiler walk-in', endpoint: 'POST /api/v1/rentals' },
  { from: ChairStatus.OCCUPIED, to: ChairStatus.AVAILABLE, roles: MANAGERS, label: 'Cierre sin limpieza', endpoint: 'POST /api/v1/rentals/{id}/complete' },
  { from: ChairStatus.OCCUPIED, to: ChairStatus.RESERVED, roles: [SYSTEM_ACTOR], label: 'Cierre con reserva futura', endpoint: 'sistema:reservas' },
  { from: ChairStatus.OCCUPIED, to: ChairStatus.CLEANING, roles: ALL_STAFF, label: 'Cerrar y enviar a limpieza', endpoint: 'POST /api/v1/rentals/{id}/complete' },
  { from: ChairStatus.AVAILABLE, to: ChairStatus.BLOCKED, roles: MANAGERS, label: 'Bloquear silla', endpoint: 'POST /api/v1/chairs/{id}/block' },
  { from: ChairStatus.RESERVED, to: ChairStatus.BLOCKED, roles: MANAGERS, label: 'Bloquear silla', endpoint: 'POST /api/v1/chairs/{id}/block' },
  { from: ChairStatus.BLOCKED, to: ChairStatus.AVAILABLE, roles: MANAGERS, label: 'Desbloquear silla', endpoint: 'POST /api/v1/chairs/{id}/unblock' },
  { from: ChairStatus.AVAILABLE, to: ChairStatus.MAINTENANCE, roles: MANAGERS, label: 'Enviar a mantenimiento', endpoint: 'POST /api/v1/chairs/{id}/maintenance' },
  { from: ChairStatus.CLEANING, to: ChairStatus.MAINTENANCE, roles: MANAGERS, label: 'Daño detectado en limpieza', endpoint: 'POST /api/v1/chairs/{id}/maintenance' },
  { from: ChairStatus.CLEANING, to: ChairStatus.AVAILABLE, roles: ALL_STAFF, label: 'Limpieza completada', endpoint: 'POST /api/v1/chairs/{id}/complete-maintenance' },
  { from: ChairStatus.MAINTENANCE, to: ChairStatus.CLEANING, roles: MANAGERS, label: 'Reparación terminada', endpoint: 'POST /api/v1/chairs/{id}/complete-maintenance' },
  { from: ChairStatus.MAINTENANCE, to: ChairStatus.AVAILABLE, roles: MANAGERS, label: 'Cancelar reparación', endpoint: 'POST /api/v1/chairs/{id}/complete-maintenance' },
] as const);

/** Transiciones prohibidas y su motivo (DESIGN.md 6.4). */
export const CHAIR_FORBIDDEN_TRANSITIONS = Object.freeze([
  { from: ChairStatus.OCCUPIED, to: ChairStatus.BLOCKED, reason: 'Bloquear una silla con gente es pérdida operativa y hueco de facturación' },
  { from: ChairStatus.OCCUPIED, to: ChairStatus.MAINTENANCE, reason: 'Hay que cerrar el alquiler primero' },
  { from: ChairStatus.BLOCKED, to: ChairStatus.OCCUPIED, reason: 'Desbloquear primero' },
  { from: ChairStatus.BLOCKED, to: ChairStatus.RESERVED, reason: 'Imposible' },
  { from: ChairStatus.BLOCKED, to: ChairStatus.CLEANING, reason: 'Imposible' },
  { from: ChairStatus.BLOCKED, to: ChairStatus.MAINTENANCE, reason: 'Imposible' },
  { from: ChairStatus.MAINTENANCE, to: ChairStatus.OCCUPIED, reason: 'Imposible sin pasar por AVAILABLE' },
  { from: ChairStatus.MAINTENANCE, to: ChairStatus.RESERVED, reason: 'Imposible' },
  { from: ChairStatus.MAINTENANCE, to: ChairStatus.BLOCKED, reason: 'Imposible' },
  { from: ChairStatus.CLEANING, to: ChairStatus.OCCUPIED, reason: 'Una silla sin limpiar no recibe clientes' },
  { from: ChairStatus.CLEANING, to: ChairStatus.RESERVED, reason: 'Una silla sin limpiar no recibe clientes' },
  { from: ChairStatus.CLEANING, to: ChairStatus.BLOCKED, reason: 'Imposible' },
  { from: ChairStatus.RESERVED, to: ChairStatus.MAINTENANCE, reason: 'Bloquear primero si hay que intervenir el mueble' },
  { from: ChairStatus.AVAILABLE, to: ChairStatus.CLEANING, reason: 'CLEANING sólo se alcanza desde OCCUPIED' },
] as const);

/** Máquina de estados de `chairs`. */
export const CHAIR_STATE_MACHINE: StateMachine<ChairStatus> = defineStateMachine<ChairStatus>({
  entity: 'chairs',
  initial: ChairStatus.AVAILABLE,
  terminal: [],
  transitions: CHAIR_TRANSITIONS,
  forbidden: CHAIR_FORBIDDEN_TRANSITIONS,
});

/** `true` si `(from, to)` es una transición válida de silla. */
export function canTransition(from: ChairStatus, to: ChairStatus): boolean {
  return isValidTransition(CHAIR_STATE_MACHINE, from, to);
}

/**
 * Estados que `PATCH /chairs/{id}/status}` puede fijar (BR-CHAIR-003).
 * `OCCUPIED` y `RESERVED` quedan fuera a propósito.
 */
export const MANUALLY_SETTABLE_CHAIR_STATUSES: readonly ChairStatus[] = Object.freeze([
  ChairStatus.AVAILABLE,
  ChairStatus.BLOCKED,
  ChairStatus.MAINTENANCE,
  ChairStatus.CLEANING,
]);

/** `true` si el estado admite `PATCH /chairs/{id}/status`. */
export function isManuallySettable(status: ChairStatus): boolean {
  return MANUALLY_SETTABLE_CHAIR_STATUSES.includes(status);
}

/** Falla si la transición no está permitida. */
export function assertTransition(from: ChairStatus, to: ChairStatus): void {
  if (canTransition(from, to)) {
    return;
  }
  const reason = forbiddenReason(CHAIR_STATE_MACHINE, from, to);
  throw new BusinessRuleError(`No se puede pasar una silla de ${from} a ${to}`, {
    details: {
      code: 'INVALID_CHAIR_STATUS_TRANSITION',
      entity: 'chairs',
      from,
      to,
      ...(reason === null ? {} : { reason }),
    },
  });
}
