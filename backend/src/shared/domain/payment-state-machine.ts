/**
 * Máquina de estados de `payments` (DESIGN.md 6.5).
 *
 * Regla contable: un pago `APPROVED` no se "desaprueba" nunca, se reembolsa.
 * `FAILED -> APPROVED` es imposible: el reintento legítimo crea un pago NUEVO
 * con su propio `payment_number` y su propia `Idempotency-Key`.
 */
import { BusinessRuleError } from '../errors/index.js';
import { PaymentStatus, Role, SYSTEM_ACTOR } from './enums.js';
import {
  defineStateMachine,
  forbiddenReason,
  isTerminalStatus,
  isValidTransition,
  type StateMachine,
} from './types.js';

const ALL_STAFF: readonly (typeof Role)[keyof typeof Role][] = [
  Role.STAFF,
  Role.CASHIER,
  Role.MANAGER,
  Role.ADMIN,
  Role.OWNER,
];
const MANAGERS: readonly (typeof Role)[keyof typeof Role][] = [Role.MANAGER, Role.ADMIN, Role.OWNER];

/** Transiciones permitidas de `payments`. */
export const PAYMENT_TRANSITIONS = Object.freeze([
  { from: PaymentStatus.PENDING, to: PaymentStatus.APPROVED, roles: [SYSTEM_ACTOR, ...ALL_STAFF], label: 'Aprobar pago', endpoint: 'POST /api/v1/payments/{id}/approve' },
  { from: PaymentStatus.PENDING, to: PaymentStatus.FAILED, roles: [SYSTEM_ACTOR], label: 'Rechazo del proveedor', endpoint: 'sistema:proveedor' },
  { from: PaymentStatus.PENDING, to: PaymentStatus.CANCELLED, roles: ALL_STAFF, label: 'Cancelar cobro', endpoint: 'POST /api/v1/payments/{id}/cancel' },
  { from: PaymentStatus.APPROVED, to: PaymentStatus.PARTIALLY_REFUNDED, roles: MANAGERS, label: 'Reembolso parcial', endpoint: 'POST /api/v1/payments/{id}/refund' },
  { from: PaymentStatus.APPROVED, to: PaymentStatus.REFUNDED, roles: MANAGERS, label: 'Reembolso total', endpoint: 'POST /api/v1/payments/{id}/refund' },
  { from: PaymentStatus.PARTIALLY_REFUNDED, to: PaymentStatus.REFUNDED, roles: MANAGERS, label: 'Reembolsar el saldo', endpoint: 'POST /api/v1/payments/{id}/refund' },
] as const);

/** Transiciones prohibidas y su motivo (DESIGN.md 6.5). */
export const PAYMENT_FORBIDDEN_TRANSITIONS = Object.freeze([
  { from: PaymentStatus.APPROVED, to: PaymentStatus.FAILED, reason: 'Un pago aprobado no se desaprueba: se reembolsa' },
  { from: PaymentStatus.APPROVED, to: PaymentStatus.PENDING, reason: 'Imposible' },
  { from: PaymentStatus.APPROVED, to: PaymentStatus.CANCELLED, reason: 'Imposible por la misma razón que APPROVED -> FAILED' },
  { from: PaymentStatus.APPROVED, to: PaymentStatus.APPROVED, reason: 'Idempotencia prohibida: el reintento legítimo usa Idempotency-Key' },
  { from: PaymentStatus.FAILED, to: PaymentStatus.APPROVED, reason: 'El reintento crea un payments nuevo con su propia Idempotency-Key' },
  { from: PaymentStatus.FAILED, to: PaymentStatus.PENDING, reason: 'Imposible' },
  { from: PaymentStatus.FAILED, to: PaymentStatus.REFUNDED, reason: 'Nunca se reembolsa dinero que no entró' },
  { from: PaymentStatus.FAILED, to: PaymentStatus.PARTIALLY_REFUNDED, reason: 'Nunca se reembolsa dinero que no entró' },
  { from: PaymentStatus.FAILED, to: PaymentStatus.CANCELLED, reason: 'Son terminales distintos' },
  { from: PaymentStatus.CANCELLED, to: PaymentStatus.APPROVED, reason: 'CANCELLED es terminal' },
  { from: PaymentStatus.CANCELLED, to: PaymentStatus.FAILED, reason: 'CANCELLED es terminal' },
  { from: PaymentStatus.CANCELLED, to: PaymentStatus.REFUNDED, reason: 'CANCELLED es terminal' },
  { from: PaymentStatus.PARTIALLY_REFUNDED, to: PaymentStatus.APPROVED, reason: 'Retroceder en el reembolso destruye el histórico' },
  { from: PaymentStatus.PARTIALLY_REFUNDED, to: PaymentStatus.PENDING, reason: 'Imposible' },
  { from: PaymentStatus.PARTIALLY_REFUNDED, to: PaymentStatus.FAILED, reason: 'Imposible' },
  { from: PaymentStatus.PARTIALLY_REFUNDED, to: PaymentStatus.CANCELLED, reason: 'Imposible' },
  { from: PaymentStatus.REFUNDED, to: PaymentStatus.APPROVED, reason: 'Estado terminal absoluto' },
  { from: PaymentStatus.REFUNDED, to: PaymentStatus.PARTIALLY_REFUNDED, reason: 'Estado terminal absoluto' },
] as const);

/** Máquina de estados de `payments`. */
export const PAYMENT_STATE_MACHINE: StateMachine<PaymentStatus> =
  defineStateMachine<PaymentStatus>({
    entity: 'payments',
    initial: PaymentStatus.PENDING,
    terminal: [PaymentStatus.FAILED, PaymentStatus.CANCELLED, PaymentStatus.REFUNDED],
    transitions: PAYMENT_TRANSITIONS,
    forbidden: PAYMENT_FORBIDDEN_TRANSITIONS,
  });

/** `true` si `(from, to)` es una transición válida de pago. */
export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return isValidTransition(PAYMENT_STATE_MACHINE, from, to);
}

/** `true` si el estado no admite más transiciones. */
export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return isTerminalStatus(PAYMENT_STATE_MACHINE, status);
}

/** Estados cuyo importe cuenta como pagado (BR-MONEY-006). */
export const SETTLED_PAYMENT_STATUSES: readonly PaymentStatus[] = Object.freeze([
  PaymentStatus.APPROVED,
  PaymentStatus.PARTIALLY_REFUNDED,
]);

/** Falla si la transición no está permitida. */
export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (canTransition(from, to)) {
    return;
  }
  const reason = forbiddenReason(PAYMENT_STATE_MACHINE, from, to);
  throw new BusinessRuleError(`No se puede pasar un pago de ${from} a ${to}`, {
    details: {
      code: 'INVALID_PAYMENT_TRANSITION',
      entity: 'payments',
      from,
      to,
      ...(reason === null ? {} : { reason }),
    },
  });
}
