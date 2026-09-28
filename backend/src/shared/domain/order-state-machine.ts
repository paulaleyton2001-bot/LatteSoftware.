/**
 * Máquina de estados de `orders` (DESIGN.md 6.1).
 *
 * Es la fuente única: los services validan contra esta tabla y
 * `GET /api/v1/meta/enums` publica exactamente el mismo contenido, así que el
 * frontend nunca duplica la lógica.
 *
 * Consecuencias que esta tabla garantiza:
 *  - `COMPLETED -> PREPARING` es IMPOSIBLE (un pedido entregado no vuelve a la
 *    cocina). Como `COMPLETED` no aparece como `from` de ninguna transición,
 *    `canTransition` devuelve `false` y `assertTransition` lanza 422.
 *  - `COMPLETED -> COMPLETED` también es imposible: la idempotencia de la
 *    transición se rechaza explícitamente (BR-ORDER, sección 6.1).
 *  - `CANCELLED` y `REFUNDED` son terminales.
 *  - Sólo se llega a `REFUNDED` desde `COMPLETED`: nunca se "des-completa".
 *
 * CÓDIGO DE ERROR: `assertTransition` lanza `BusinessRuleError` (422
 * BUSINESS_RULE_ERROR) con `details.code = 'INVALID_ORDER_TRANSITION'`, tal y
 * como exige DESIGN.md 6.1. Nota: API.md 4 enumera ese mismo `details.code`
 * bajo 409 CONFLICT_ERROR; se sigue DESIGN.md y la especificación de la fase
 * 1 (BusinessRuleError). El `CHECK` de la base de datos es la última línea de
 * defensa del enum, no de la transición.
 */
import { BusinessRuleError } from '../errors/index.js';
import { OrderStatus, Role, SYSTEM_ACTOR } from './enums.js';
import {
  defineStateMachine,
  forbiddenReason,
  isTerminalStatus,
  isValidTransition,
  type StateMachine,
  type StateTransition,
  type TransitionActor,
} from './types.js';

/** Roles internos habituales, para no repetirlos 15 veces. */
const ALL_STAFF: readonly (typeof Role)[keyof typeof Role][] = [
  Role.STAFF,
  Role.CASHIER,
  Role.MANAGER,
  Role.ADMIN,
  Role.OWNER,
];
const MANAGERS: readonly (typeof Role)[keyof typeof Role][] = [Role.MANAGER, Role.ADMIN, Role.OWNER];
const ALL_ACTORS: readonly TransitionActor[] = [SYSTEM_ACTOR, ...ALL_STAFF];

/** Transiciones permitidas de `orders`, con rol, efecto y endpoint. */
export const ORDER_TRANSITIONS: readonly StateTransition<OrderStatus, OrderStatus>[] = Object.freeze([
  {
    from: OrderStatus.DRAFT,
    to: OrderStatus.PENDING,
    roles: [Role.CUSTOMER, ...ALL_STAFF],
    label: 'Colocar pedido',
    endpoint: 'POST /api/v1/orders',
  },
  {
    from: OrderStatus.DRAFT,
    to: OrderStatus.CANCELLED,
    roles: MANAGERS,
    label: 'Cancelar pedido',
    endpoint: 'POST /api/v1/orders/{id}/cancel',
  },
  {
    from: OrderStatus.PENDING,
    to: OrderStatus.CONFIRMED,
    roles: ALL_STAFF,
    label: 'Confirmar pedido',
    endpoint: 'POST /api/v1/orders/{id}/confirm',
  },
  {
    from: OrderStatus.PENDING,
    to: OrderStatus.CANCELLED,
    roles: ALL_STAFF,
    label: 'Cancelar pedido',
    endpoint: 'POST /api/v1/orders/{id}/cancel',
  },
  {
    from: OrderStatus.CONFIRMED,
    to: OrderStatus.PREPARING,
    roles: ALL_STAFF,
    label: 'Iniciar preparación',
    endpoint: 'POST /api/v1/orders/{id}/status',
  },
  {
    from: OrderStatus.CONFIRMED,
    to: OrderStatus.READY,
    roles: MANAGERS,
    label: 'Marcar listo (sin preparación)',
    endpoint: 'POST /api/v1/orders/{id}/status',
  },
  {
    from: OrderStatus.CONFIRMED,
    to: OrderStatus.DELIVERING,
    roles: MANAGERS,
    label: 'Despachar',
    endpoint: 'POST /api/v1/orders/{id}/status',
  },
  {
    from: OrderStatus.CONFIRMED,
    to: OrderStatus.CANCELLED,
    roles: MANAGERS,
    label: 'Cancelar pedido',
    endpoint: 'POST /api/v1/orders/{id}/cancel',
  },
  {
    from: OrderStatus.PREPARING,
    to: OrderStatus.READY,
    roles: ALL_STAFF,
    label: 'Marcar listo',
    endpoint: 'POST /api/v1/orders/{id}/status',
  },
  {
    from: OrderStatus.PREPARING,
    to: OrderStatus.CANCELLED,
    roles: MANAGERS,
    label: 'Cancelar pedido',
    endpoint: 'POST /api/v1/orders/{id}/cancel',
  },
  {
    from: OrderStatus.READY,
    to: OrderStatus.DELIVERING,
    roles: MANAGERS,
    label: 'Despachar',
    endpoint: 'POST /api/v1/orders/{id}/status',
  },
  {
    from: OrderStatus.READY,
    to: OrderStatus.COMPLETED,
    roles: ALL_STAFF,
    label: 'Entregar',
    endpoint: 'POST /api/v1/orders/{id}/status',
  },
  {
    from: OrderStatus.DELIVERING,
    to: OrderStatus.COMPLETED,
    roles: ALL_STAFF,
    label: 'Entregar',
    endpoint: 'POST /api/v1/orders/{id}/status',
  },
  {
    from: OrderStatus.COMPLETED,
    to: OrderStatus.REFUNDED,
    roles: MANAGERS,
    label: 'Reembolsar',
    endpoint: 'POST /api/v1/orders/{id}/refund',
  },
]);

/** Transiciones prohibidas y su motivo (DESIGN.md 6.1). */
export const ORDER_FORBIDDEN_TRANSITIONS = Object.freeze([
  { from: OrderStatus.COMPLETED, to: OrderStatus.PREPARING, reason: 'Un pedido entregado no vuelve a la cocina (BR-ORDER-017)' },
  { from: OrderStatus.COMPLETED, to: OrderStatus.DRAFT, reason: 'Revertir un pedido cerrado destruiría el histórico contable' },
  { from: OrderStatus.COMPLETED, to: OrderStatus.PENDING, reason: 'No se puede des-colocar un pedido entregado' },
  { from: OrderStatus.COMPLETED, to: OrderStatus.CONFIRMED, reason: 'COMPLETED es inmutable' },
  { from: OrderStatus.COMPLETED, to: OrderStatus.CANCELLED, reason: 'Cancelación y completado son excluyentes; con pago, el camino es REFUNDED' },
  { from: OrderStatus.COMPLETED, to: OrderStatus.COMPLETED, reason: 'Idempotencia prohibida: un segundo COMPLETED es 409 CONFLICT_ERROR' },
  { from: OrderStatus.COMPLETED, to: OrderStatus.READY, reason: 'COMPLETED es inmutable' },
  { from: OrderStatus.COMPLETED, to: OrderStatus.DELIVERING, reason: 'COMPLETED es inmutable' },
  { from: OrderStatus.REFUNDED, to: OrderStatus.COMPLETED, reason: 'REFUNDED es terminal' },
  { from: OrderStatus.REFUNDED, to: OrderStatus.CANCELLED, reason: 'REFUNDED es terminal' },
  { from: OrderStatus.REFUNDED, to: OrderStatus.PENDING, reason: 'REFUNDED es terminal' },
  { from: OrderStatus.REFUNDED, to: OrderStatus.CONFIRMED, reason: 'REFUNDED es terminal' },
  { from: OrderStatus.REFUNDED, to: OrderStatus.PREPARING, reason: 'REFUNDED es terminal' },
  { from: OrderStatus.REFUNDED, to: OrderStatus.READY, reason: 'REFUNDED es terminal' },
  { from: OrderStatus.REFUNDED, to: OrderStatus.DELIVERING, reason: 'REFUNDED es terminal' },
  { from: OrderStatus.CANCELLED, to: OrderStatus.COMPLETED, reason: 'Un pedido cancelado no se entrega' },
  { from: OrderStatus.CANCELLED, to: OrderStatus.PENDING, reason: 'CANCELLED es terminal' },
  { from: OrderStatus.CANCELLED, to: OrderStatus.CONFIRMED, reason: 'CANCELLED es terminal' },
  { from: OrderStatus.CANCELLED, to: OrderStatus.PREPARING, reason: 'CANCELLED es terminal' },
  { from: OrderStatus.CANCELLED, to: OrderStatus.READY, reason: 'CANCELLED es terminal' },
  { from: OrderStatus.CANCELLED, to: OrderStatus.DELIVERING, reason: 'CANCELLED es terminal' },
  { from: OrderStatus.CANCELLED, to: OrderStatus.DRAFT, reason: 'Borrar no es una transición: se usa deleted_at sobre pedidos CANCELLED (BR-ORDER-016)' },
  { from: OrderStatus.DRAFT, to: OrderStatus.COMPLETED, reason: 'Imposible sin pasar por PENDING' },
  { from: OrderStatus.DRAFT, to: OrderStatus.CONFIRMED, reason: 'Imposible sin pasar por PENDING' },
  { from: OrderStatus.DRAFT, to: OrderStatus.PREPARING, reason: 'Imposible sin pasar por PENDING' },
  { from: OrderStatus.DRAFT, to: OrderStatus.READY, reason: 'Imposible sin pasar por PENDING' },
  { from: OrderStatus.DRAFT, to: OrderStatus.DELIVERING, reason: 'Imposible sin pasar por PENDING' },
  { from: OrderStatus.PENDING, to: OrderStatus.COMPLETED, reason: 'Imposible sin confirmar' },
  { from: OrderStatus.PENDING, to: OrderStatus.READY, reason: 'Imposible sin confirmar y sin preparar' },
  { from: OrderStatus.PENDING, to: OrderStatus.PREPARING, reason: 'Imposible sin confirmar' },
  { from: OrderStatus.PENDING, to: OrderStatus.DELIVERING, reason: 'Imposible' },
  { from: OrderStatus.DELIVERING, to: OrderStatus.PREPARING, reason: 'No se retrocede en el flujo de despacho' },
  { from: OrderStatus.DELIVERING, to: OrderStatus.READY, reason: 'No se retrocede en el flujo de despacho' },
  { from: OrderStatus.DELIVERING, to: OrderStatus.CANCELLED, reason: 'Si salió del local no se cancela: se cierra como COMPLETED o se reembolsa vía REFUNDED' },
  { from: OrderStatus.DELIVERING, to: OrderStatus.REFUNDED, reason: 'Sólo se reembolsa sobre COMPLETED' },
  { from: OrderStatus.READY, to: OrderStatus.PREPARING, reason: 'Retroceder en cocina se modela con order_items.status, no con el estado del pedido' },
  { from: OrderStatus.READY, to: OrderStatus.CONFIRMED, reason: 'No se retrocede en el flujo' },
] as const);

/** Máquina de estados de `orders`. */
export const ORDER_STATE_MACHINE: StateMachine<OrderStatus> = defineStateMachine<OrderStatus>({
  entity: 'orders',
  initial: OrderStatus.DRAFT,
  terminal: [OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  transitions: ORDER_TRANSITIONS,
  forbidden: ORDER_FORBIDDEN_TRANSITIONS,
});

/** `true` si `(from, to)` es una transición válida de pedido. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return isValidTransition(ORDER_STATE_MACHINE, from, to);
}

/** `true` si el estado no admite más transiciones de salida. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return isTerminalStatus(ORDER_STATE_MACHINE, status);
}

/** Transición concreta, o `undefined` si no existe. */
export function findOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): StateTransition<OrderStatus, OrderStatus> | undefined {
  return ORDER_TRANSITIONS.find((transition) => transition.from === from && transition.to === to);
}

/** Estados alcanzables desde `from` en un paso. */
export function nextOrderStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS.filter((transition) => transition.from === from).map(
    (transition) => transition.to,
  );
}

/**
 * Falla si la transición no está permitida.
 *
 * @throws BusinessRuleError 422 con `details = { code: 'INVALID_ORDER_TRANSITION',
 *         from, to, allowed, reason? }`. `allowed` permite a la UI desactivar
 *         el botón sin conocer la tabla.
 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (canTransition(from, to)) {
    return;
  }
  const reason = forbiddenReason(ORDER_STATE_MACHINE, from, to);
  throw new BusinessRuleError(
    `No se puede pasar un pedido de ${from} a ${to}`,
    {
      details: {
        code: 'INVALID_ORDER_TRANSITION',
        entity: 'orders',
        from,
        to,
        allowed: nextOrderStatuses(from),
        ...(reason === null ? {} : { reason }),
      },
    },
  );
}

/**
 * Falla si el estado no permite edición de ítems, precios o pagos.
 * `COMPLETED`, `CANCELLED` y `REFUNDED` son inmutables (BR-ORDER-017).
 */
export function assertOrderMutable(status: OrderStatus): void {
  if (
    status === OrderStatus.COMPLETED ||
    status === OrderStatus.CANCELLED ||
    status === OrderStatus.REFUNDED
  ) {
    throw new BusinessRuleError('El pedido está cerrado y no admite cambios', {
      details: { code: 'ORDER_IMMUTABLE', status },
    });
  }
}

/** Actores internos que pueden tocar el ciclo de vida de un pedido. */
export const ORDER_LIFECYCLE_ACTORS: readonly TransitionActor[] = ALL_ACTORS;
