/**
 * Dominio compartido: enums y máquinas de estado.
 *
 * `assertTransition` existe en varias máquinas de estado, así que aquí se
 * reexporta con nombre propio por entidad para no colisionar al importar desde
 * el índice.
 */
export {
  AuditAction,
  AuditEntityType,
  ChairKind,
  ChairStatus,
  DiscountAppliesTo,
  DiscountType,
  InventoryReferenceType,
  InventoryUnit,
  MovementType,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  OrderChannel,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  PERMISSION_MODULES,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  ROLE_HIERARCHY,
  RentalStatus,
  ReservationSource,
  ReservationStatus,
  Role,
  SYSTEM_ACTOR,
  UserStatus,
  enumValues,
  isEnumValue,
  type PermissionModule,
  type SystemActor,
} from './enums.js';

export {
  ORDER_FORBIDDEN_TRANSITIONS,
  ORDER_LIFECYCLE_ACTORS,
  ORDER_STATE_MACHINE,
  ORDER_TRANSITIONS,
  assertOrderMutable,
  assertTransition as assertOrderTransition,
  canTransition as canOrderTransition,
  findOrderTransition,
  isTerminalOrderStatus,
  nextOrderStatuses,
} from './order-state-machine.js';

export {
  BLOCKING_RESERVATION_STATUSES,
  RESERVATION_FORBIDDEN_TRANSITIONS,
  RESERVATION_STATE_MACHINE,
  RESERVATION_TRANSITIONS,
  assertTransition as assertReservationTransition,
  canTransition as canReservationTransition,
  findReservationTransition,
  isTerminalReservationStatus,
  nextReservationStatuses,
} from './reservation-state-machine.js';

export {
  ACTIVE_RENTAL_STATUSES,
  RENTAL_FORBIDDEN_TRANSITIONS,
  RENTAL_STATE_MACHINE,
  RENTAL_TRANSITIONS,
  assertTransition as assertRentalTransition,
  canTransition as canRentalTransition,
  isTerminalRentalStatus,
} from './rental-state-machine.js';

export {
  CHAIR_FORBIDDEN_TRANSITIONS,
  CHAIR_STATE_MACHINE,
  CHAIR_TRANSITIONS,
  MANUALLY_SETTABLE_CHAIR_STATUSES,
  assertTransition as assertChairTransition,
  canTransition as canChairTransition,
  isManuallySettable,
} from './chair-state-machine.js';

export {
  PAYMENT_FORBIDDEN_TRANSITIONS,
  PAYMENT_STATE_MACHINE,
  PAYMENT_TRANSITIONS,
  SETTLED_PAYMENT_STATUSES,
  assertTransition as assertPaymentTransition,
  canTransition as canPaymentTransition,
  isTerminalPaymentStatus,
} from './payment-state-machine.js';

export {
  defineStateMachine,
  forbiddenReason,
  isTerminalStatus,
  isValidTransition,
  type RequestContext,
  type RequestWithContext,
  type StateMachine,
  type StateTransition,
  type TransitionActor,
  type UserContext,
} from './types.js';

export {
  PERMISSION,
  PERMISSION_DESCRIPTION,
  PERMISSION_KEYS,
  PERMISSION_MODULE_OF,
  TOTAL_PERMISSIONS,
  isPermissionKey,
  type PermissionKey,
} from './permissions.js';
