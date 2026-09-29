/**
 * Enumerados del dominio, derivados de `docs/DESIGN.md` 4 y `docs/API.md` 6.2.
 *
 * Cada enum es un `const object` + un tipo unión del mismo nombre. El patrón
 * evita los *magic strings*: el compilador rechaza `if (status === 'PENDINGY')`
 * y el endpoint `GET /api/v1/meta/enums` publica exactamente estas listas, de
 * modo que el frontend nunca las duplica.
 *
 * Los valores coinciden carácter a carácter con los CHECK del esquema SQL
 * (`0001_init.sql` y las migraciones posteriores): si divergen, la base de datos
 * rechaza la escritura.
 */

/** Crea un objeto frozen con clave igual a valor, y su tipo unión. */
function enumOf<const T extends readonly string[]>(values: T): Readonly<Record<T[number], T[number]>> {
  const result: Record<string, string> = {};
  for (const value of values) {
    result[value] = value;
  }
  return Object.freeze(result) as Readonly<Record<T[number], T[number]>>;
}

// --------------------------------------------------------------------------
// Identidad
// --------------------------------------------------------------------------

/** 6.1 Roles del sistema. Jerarquía: OWNER > ADMIN > MANAGER > CASHIER > STAFF > CUSTOMER. */
export const Role = enumOf(['CUSTOMER', 'STAFF', 'CASHIER', 'MANAGER', 'ADMIN', 'OWNER'] as const);
export type Role = (typeof Role)[keyof typeof Role];

/** Orden jerárquico de mayor a menor poder (DESIGN.md 9.1). */
export const ROLE_HIERARCHY: readonly Role[] = Object.freeze([
  Role.OWNER,
  Role.ADMIN,
  Role.MANAGER,
  Role.CASHIER,
  Role.STAFF,
  Role.CUSTOMER,
]);

/** Actor adicional que no es una persona: el scheduler del worker. */
export const SYSTEM_ACTOR = 'SYSTEM' as const;
export type SystemActor = typeof SYSTEM_ACTOR;

/** 6.1 Estado de un usuario. `BLOCKED` impide el login y revoca refresh tokens. */
export const UserStatus = enumOf(['ACTIVE', 'INACTIVE', 'BLOCKED'] as const);
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

// --------------------------------------------------------------------------
// Espacios
// --------------------------------------------------------------------------

/** Tipo de unidad de espacio. No existe tabla `tables` (DESIGN.md 4.3). */
export const ChairKind = enumOf(['CHAIR', 'TABLE', 'COUNTER', 'AREA'] as const);
export type ChairKind = (typeof ChairKind)[keyof typeof ChairKind];

/** Estado de una silla o puesto. */
export const ChairStatus = enumOf([
  'AVAILABLE',
  'OCCUPIED',
  'RESERVED',
  'BLOCKED',
  'MAINTENANCE',
  'CLEANING',
] as const);
export type ChairStatus = (typeof ChairStatus)[keyof typeof ChairStatus];

/** Estado de una reserva. */
export const ReservationStatus = enumOf([
  'PENDING',
  'CONFIRMED',
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const);
export type ReservationStatus = (typeof ReservationStatus)[keyof typeof ReservationStatus];

/** Origen de la reserva. */
export const ReservationSource = enumOf(['CUSTOMER', 'STAFF', 'ADMIN'] as const);
export type ReservationSource = (typeof ReservationSource)[keyof typeof ReservationSource];

/** Estado de un alquiler de espacio. */
export const RentalStatus = enumOf(['ACTIVE', 'EXTENDED', 'COMPLETED', 'CANCELLED'] as const);
export type RentalStatus = (typeof RentalStatus)[keyof typeof RentalStatus];

// --------------------------------------------------------------------------
// Pedidos
// --------------------------------------------------------------------------

/** Tipo de pedido. `CHAIR_RENTAL` exige silla y reserva (BR-ORDER-008). */
export const OrderType = enumOf(['TAKEAWAY', 'DINE_IN', 'CHAIR_RENTAL'] as const);
export type OrderType = (typeof OrderType)[keyof typeof OrderType];

/** Estado del pedido. Fuente canónica: DESIGN.md 6.1. */
export const OrderStatus = enumOf([
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'DELIVERING',
  'COMPLETED',
  'CANCELLED',
  'REFUNDED',
] as const);
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Estado por línea: un pedido puede tener un café listo y otro no. */
export const OrderItemStatus = enumOf(['PENDING', 'READY', 'CANCELLED'] as const);
export type OrderItemStatus = (typeof OrderItemStatus)[keyof typeof OrderItemStatus];

/** Canal de venta. */
export const OrderChannel = enumOf(['COUNTER', 'MOBILE_WEB', 'POS'] as const);
export type OrderChannel = (typeof OrderChannel)[keyof typeof OrderChannel];

// --------------------------------------------------------------------------
// Pagos
// --------------------------------------------------------------------------

/** Método de pago. */
export const PaymentMethod = enumOf(['CASH', 'CARD', 'TRANSFER', 'ONLINE'] as const);
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/**
 * Proveedor de pago. NULL en la BD sólo para `CASH`.
 *
 * `CARD_TERMINAL` es el DATÁFONO del propio local y lo añadió la migración
 * `0003_card_terminal_provider.sql`; los otros cuatro son pasarelas online que el
 * sistema todavía no usa. El valor va detrás de `CASH_REGISTRY` porque las dos
 * cosas son el cobro en el mostrador, y el orden coincide con el del CHECK
 * `ck_payments_provider` de `payments`, que es el que manda: si divergen, la base
 * rechaza la escritura.
 */
export const PaymentProvider = enumOf([
  'CASH_REGISTRY',
  'CARD_TERMINAL',
  'STRIPE',
  'MERCADOPAGO',
  'WOMPI',
  'PAYU',
] as const);
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

/** Estado de un pago. */
export const PaymentStatus = enumOf([
  'PENDING',
  'APPROVED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'CANCELLED',
] as const);
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

// --------------------------------------------------------------------------
// Descuentos
// --------------------------------------------------------------------------

/** Tipo de descuento: `PERCENT` usa basis points en `value`; `FIXED`, centavos. */
export const DiscountType = enumOf(['PERCENT', 'FIXED'] as const);
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

/** Ámbito de aplicación del descuento. */
export const DiscountAppliesTo = enumOf(['ALL', 'CATEGORY', 'PRODUCT'] as const);
export type DiscountAppliesTo = (typeof DiscountAppliesTo)[keyof typeof DiscountAppliesTo];

// --------------------------------------------------------------------------
// Inventario
// --------------------------------------------------------------------------

/** Tipo de movimiento de inventario. Positivo suma, negativo resta. */
export const MovementType = enumOf([
  'PURCHASE',
  'SALE',
  'ADJUSTMENT',
  'WASTE',
  'RETURN',
  'RESERVATION',
  'RELEASE',
] as const);
export type MovementType = (typeof MovementType)[keyof typeof MovementType];

/** Tipo de entidad referenciada por un movimiento. */
export const InventoryReferenceType = enumOf(['ORDER', 'PURCHASE', 'MANUAL'] as const);
export type InventoryReferenceType =
  (typeof InventoryReferenceType)[keyof typeof InventoryReferenceType];

/** Unidad de medida de un insumo o de un ítem de inventario. */
export const InventoryUnit = enumOf(['UND', 'KG', 'G', 'L', 'ML'] as const);
export type InventoryUnit = (typeof InventoryUnit)[keyof typeof InventoryUnit];

// --------------------------------------------------------------------------
// Notificaciones
// --------------------------------------------------------------------------

/** Tipo de notificación. */
export const NotificationType = enumOf([
  'ORDER_CONFIRMED',
  'ORDER_READY',
  'RESERVATION_CONFIRMED',
  'RESERVATION_UPCOMING',
  'RESERVATION_TIME_ENDING',
  'RESERVATION_CANCELLED',
  'PAYMENT_SUCCESS',
  'PAYMENT_FAILED',
  'SYSTEM',
] as const);
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

/** Canal de entrega de la notificación. */
export const NotificationChannel = enumOf(['IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP'] as const);
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

/** Estado de entrega/lectura de la notificación. */
export const NotificationStatus = enumOf(['PENDING', 'SENT', 'READ', 'FAILED'] as const);
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

// --------------------------------------------------------------------------
// Auditoría
// --------------------------------------------------------------------------

/** Acción auditada. */
export const AuditAction = enumOf([
  'CREATE',
  'UPDATE',
  'DELETE',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'REFRESH_TOKEN_REUSE',
  'MODIFY_PRODUCT',
  'CHANGE_STATUS',
  'PAYMENT',
  'REFUND',
  'EXPORT',
  'PASSWORD_RESET',
  'ROLE_CHANGE',
] as const);
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** Tipo de entidad auditada. */
export const AuditEntityType = enumOf([
  'user',
  'product',
  'order',
  'chair',
  'reservation',
  'rental',
  'payment',
  'discount',
  'inventory_item',
  'business',
  'export',
] as const);
export type AuditEntityType = (typeof AuditEntityType)[keyof typeof AuditEntityType];

// --------------------------------------------------------------------------
// Módulos y permisos
// --------------------------------------------------------------------------

/** Módulos de permisos de DESIGN.md 9.2. */
export const PERMISSION_MODULES = enumOf([
  'auth',
  'users',
  'customers',
  'business',
  'locations',
  'zones',
  'chairs',
  'reservations',
  'rentals',
  'categories',
  'products',
  'inventory',
  'discounts',
  'orders',
  'payments',
  'reports',
  'notifications',
  'audit',
] as const);
export type PermissionModule = (typeof PERMISSION_MODULES)[keyof typeof PERMISSION_MODULES];

/**
 * Compara un valor arbitrario contra un enum en tiempo de ejecución.
 * Útil para datos que vienen de la BD (una columna TEXT) sin hacer `as`.
 */
export function isEnumValue<T extends string>(enumObject: Readonly<Record<string, T>>, value: unknown): value is T {
  return typeof value === 'string' && Object.hasOwn(enumObject, value);
}

/** Lista de valores de un enum, en el orden de declaración. */
export function enumValues<T extends string>(enumObject: Readonly<Record<T, T>>): T[] {
  return Object.keys(enumObject) as T[];
}
