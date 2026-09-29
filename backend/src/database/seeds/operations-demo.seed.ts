/**
 * Semilla de demostración de OPERACIÓN: empleados, clientes, horario del local,
 * reservas, alquileres, dieciocho pedidos con su historial y sus cobros.
 *
 * ============================================================================
 * POR QUÉ EXISTE
 * ============================================================================
 * Con el negocio, el RBAC, las sillas y el catálogo ya sembrados, el sistema
 * arranca pero no se puede DEMOSTRAR: no hay quién compre, ni qué se está
 * sirviendo ahora, ni histórico para los reportes. Esta semilla cierra el
 * círculo con datos que se pueden leer como los de un local que lleva un mes
 * abierto.
 *
 * ============================================================================
 * LA REGLA QUE MANDA EN ESTE FICHERO: LA ARITMÉTICA NO SE INVENTA
 * ============================================================================
 * Ningún total de esta semilla está escrito a mano. Todos salen de las MISMAS
 * funciones puras que usa la API:
 *   - El precio unitario, de `catalog/catalog.pricing.ts` -> `resolveUnitPrice`
 *     (prioridad promo > variante absoluta > base + delta > base).
 *   - Los totales del pedido, de `orders/order-pricing.ts` ->
 *     `computeOrderTotals` (línea -> subtotal -> descuento -> impuesto -> total,
 *     redondeando en cada paso y sumando valores ya redondeados).
 *   - El importe del cupón, con la misma fórmula que `DiscountsService.quote`
 *     (base aplicable -> PERCENT en basis points o FIXED -> tope -> recorte a la
 *     base).
 *   - El cobro de un alquiler, de `rentals/rental-pricing.ts` ->
 *     `computeRentalCharge` (mínimos de 30 minutos, overage al precio congelado).
 *
 * Por eso `subtotal + tax - discount === total` y `suma(line_total_minor) ===
 * subtotal` no son promesas del documento: son la salida de las mismas funciones
 * que usa el servidor. `tests/seed.spec.ts` lo verifica con SQL directo sobre la
 * base sembrada.
 *
 * ============================================================================
 * IDEMPOTENCIA
 * ============================================================================
 * Cada fila tiene su código determinista (`demoCode`): `ORD-9000NN`,
 * `RES-9000NN`, `RENT-9000NN`, `PAY-9000NN`. Antes de insertar se busca ese
 * código; si ya está, el elemento se salta entero (cabecera, líneas,
 * historial, cobro, movimientos de stock y redenciones). Los correos de usuario
 * son la clave de los usuarios. Segunda ejecución: cero escrituras.
 *
 * ============================================================================
 * CONTRASEÑAS
 * ============================================================================
 * Se hashean con el MISMO servicio que `auth` (`hashPassword`, bcrypt con el
 * coste configurado) y la contraseña sale de `SEED_DEMO_PASSWORD`, con
 * `SEED_SYSTEM_ACCOUNTS_PASSWORD` como alternativa. Nunca hay una contraseña ni
 * un hash en este fichero, y en el log sólo se anuncia qué correos se crearon.
 */
import { AUTH } from '../../config/index.js';
import { env } from '../../config/index.js';
import type { Db } from '../../shared/database/connection.js';
import { logger } from '../../shared/logger/index.js';
import {
  OrderChannel,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  ReservationSource,
  ReservationStatus,
  Role,
  RentalStatus,
  type OrderChannel as OrderChannelValue,
  type OrderStatus as OrderStatusValue,
  type OrderType as OrderTypeValue,
  type PaymentMethod as PaymentMethodValue,
  type Role as RoleValue,
} from '../../shared/domain/index.js';
import { addMinutes, nowIso } from '../../shared/utils/datetime.js';
import { applyTaxBp, roundHalfUp } from '../../shared/utils/money.js';
import { resolveUnitPrice } from '../../modules/catalog/catalog.pricing.js';
import { computeOrderTotals } from '../../modules/orders/order-pricing.js';
import { computeRentalCharge, projectRentalMinor } from '../../modules/rentals/rental-pricing.js';
import { SqliteInventoryRepository } from '../../modules/inventory/inventory.repository.sqlite.js';
import { SqliteSpacesRepository } from '../../modules/spaces/spaces.repository.sqlite.js';
import { assertPasswordPolicy, hashPassword } from '../../modules/auth/password.service.js';
import { SYSTEM_ACCOUNTS } from './development-accounts.seed.js';
import { assertSeeded, demoCode, localDayKey as localDay, scalarInt, zonedLocalIso } from './demo-support.js';

// ===========================================================================
// Tipos
// ===========================================================================

/** Primer número de serie de los pedidos de demostración (`ORD-900001`). */
const DEMO_ORDER_BASE = 900_000;

/** Persona de demostración: empleado o cliente. */
interface DemoUser {
  readonly key: string;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string;
  readonly role: RoleValue;
}

/** Reserva de demostración con su alquiler asociado. */
interface DemoReservation {
  /** Índice estable: fija el código `RES-9000NN`. */
  readonly ref: number;
  /** En días respecto de hoy. Negativo = mañana. */
  readonly daysAgo: number;
  readonly hour: number;
  readonly minute: number;
  readonly durationMinutes: number;
  readonly chairCode: string;
  readonly customerKey: string;
  readonly status: ReservationStatus;
  /** Minutos que se pasó de lo planificado (0 = se fue a su hora). */
  readonly overtimeMinutes: number;
  readonly notes: string | null;
  /** `true` si además se siembra el pedido `CHAIR_RENTAL` de este alquiler. */
  readonly withRentalOrder: boolean;
}

/** Línea de pedido declarada por nombre de negocio, no por id. */
interface DemoOrderLine {
  readonly sku: string;
  readonly variant?: string;
  readonly addons?: readonly { readonly name: string; readonly quantity: number }[];
  readonly quantity: number;
  readonly notes?: string;
}

/** Cobro del pedido. */
interface DemoPayment {
  readonly method: PaymentMethodValue;
  /** Fracción del total que se entrega por adelantado (1 = pago completo). */
  readonly depositFactor: number;
  readonly reference: string;
}

/** Pedido de demostración. */
interface DemoOrder {
  readonly ref: number;
  readonly daysAgo: number;
  readonly hour: number;
  readonly minute: number;
  readonly type: OrderTypeValue;
  readonly channel: OrderChannelValue;
  readonly status: OrderStatusValue;
  /** `null` = pedido de mostrador, sin cliente registrado. */
  readonly customerKey: string | null;
  /** Quién lo abrió en el POS. */
  readonly staffKey: string;
  readonly lines: readonly DemoOrderLine[];
  readonly couponCode?: string;
  readonly chairCode?: string;
  readonly tableLabel?: string;
  readonly customerNotes?: string;
  readonly notes?: string;
  readonly cancelReason?: string;
  readonly payment?: DemoPayment;
  /** Enlace con un alquiler sembrado por `DEMO_RESERVATIONS`. */
  readonly rentalRef?: number;
}

// ===========================================================================
// PERSONAS
// ===========================================================================

const STAFF_USERS: readonly DemoUser[] = Object.freeze([
  {
    key: 'staff',
    email: 'staff@lattecoffe.co',
    fullName: 'Paula Nakamura',
    phone: '+57 300 555 0141',
    role: Role.STAFF,
  },
  {
    key: 'cajero2',
    email: 'cajero2@lattecoffe.co',
    fullName: 'Diego Ocampo',
    phone: '+57 301 555 0198',
    role: Role.CASHIER,
  },
]);

/**
 * Cuentas del despliegue (`development-accounts.seed.ts`) que también pueden
 * abrir un pedido en el POS. Se leen de la semilla de despliegue y no se
 * escriben aquí: si `SEED_SYSTEM_ACCOUNTS` está apagado, no existen y el autor
 * del pedido cae al primer empleado de la demo (ver {@link actorId}).
 */
const DEPLOYMENT_ACTORS: readonly { readonly key: string; readonly email: string }[] = Object.freeze(
  SYSTEM_ACCOUNTS.map((account) => ({ key: account.email.split('@')[0] ?? account.email, email: account.email })),
);

const CUSTOMER_USERS: readonly DemoUser[] = Object.freeze([
  {
    key: 'cliente1',
    email: 'cliente1@lattecoffe.co',
    fullName: 'Camila Restrepo',
    phone: '+57 310 555 0111',
    role: Role.CUSTOMER,
  },
  {
    key: 'cliente2',
    email: 'cliente2@lattecoffe.co',
    fullName: 'Julián Cardona',
    phone: '+57 311 555 0122',
    role: Role.CUSTOMER,
  },
  {
    key: 'cliente3',
    email: 'cliente3@lattecoffe.co',
    fullName: 'Sofía Montoya',
    phone: '+57 312 555 0133',
    role: Role.CUSTOMER,
  },
  {
    key: 'cliente4',
    email: 'cliente4@lattecoffe.co',
    fullName: 'Andrés Villamil',
    phone: '+57 313 555 0144',
    role: Role.CUSTOMER,
  },
]);

/** Horario del local: de lunes a sábado larga, domingo corto. */
const BUSINESS_HOURS: readonly {
  readonly dayOfWeek: number;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly isClosed: boolean;
}[] = Object.freeze([
  { dayOfWeek: 0, opensAt: '09:00', closesAt: '17:00', isClosed: false },
  { dayOfWeek: 1, opensAt: '08:00', closesAt: '20:00', isClosed: false },
  { dayOfWeek: 2, opensAt: '08:00', closesAt: '20:00', isClosed: false },
  { dayOfWeek: 3, opensAt: '08:00', closesAt: '20:00', isClosed: false },
  { dayOfWeek: 4, opensAt: '08:00', closesAt: '20:00', isClosed: false },
  { dayOfWeek: 5, opensAt: '08:00', closesAt: '20:00', isClosed: false },
  { dayOfWeek: 6, opensAt: '08:00', closesAt: '21:00', isClosed: false },
]);

// ===========================================================================
// RESERVAS Y ALQUILERES
// ===========================================================================
/**
 * Cuatro sesiones de alquiler sobre un mes de operación:
 *  - Dos COMPLETED en el pasado, para que el reporte de ingreso por alquiler
 *    tenga datos y uno de ellas con sobretiempo (BR-RENTAL-004).
 *  - Una ACTIVE Empezada hace 47 minutos: el mapa muestra una silla ocupada con
 *    el temporizador corriendo y `GET /rentals/active` devuelve algo.
 *  - Una CONFIRMED para mañana, sin alquiler todavía: es el caso "reserva
 *    aceptada, el cliente aún no llega", y la silla sigue AVAILABLE porque las
 *    reservas futuras no cambian el estado del mueble (DESIGN.md 6.4).
 */
const DEMO_RESERVATIONS: readonly DemoReservation[] = Object.freeze([
  {
    ref: 1,
    daysAgo: 9,
    hour: 9,
    minute: 0,
    durationMinutes: 150,
    chairCode: 'IN-M04',
    customerKey: 'cliente1',
    status: ReservationStatus.COMPLETED,
    overtimeMinutes: 0,
    notes: 'Cliente habitual: pidió la mesa del rincón.',
    withRentalOrder: true,
  },
  {
    ref: 2,
    daysAgo: 4,
    hour: 16,
    minute: 0,
    durationMinutes: 120,
    chairCode: 'TW-04',
    customerKey: 'cliente3',
    status: ReservationStatus.COMPLETED,
    overtimeMinutes: 18,
    notes: 'Se pasó 18 minutos trabajando; se cobró el overage.',
    withRentalOrder: true,
  },
  {
    ref: 3,
    // Empieza AHORA (día 0) y ya lleva 47 minutos: el temporizador del panel
    // tiene que mostrar algo desde el primer segundo de la demo.
    daysAgo: 0,
    hour: 0,
    minute: 0,
    durationMinutes: 120,
    chairCode: 'PR-A1',
    customerKey: 'cliente2',
    status: ReservationStatus.ACTIVE,
    overtimeMinutes: 0,
    notes: null,
    withRentalOrder: false,
  },
  {
    ref: 4,
    daysAgo: -1,
    hour: 10,
    minute: 0,
    durationMinutes: 120,
    chairCode: 'VN-03',
    customerKey: 'cliente4',
    status: ReservationStatus.CONFIRMED,
    overtimeMinutes: 0,
    notes: 'Reunión de trabajo: pidió el enchufe de la barra.',
    withRentalOrder: false,
  },
]);

// ===========================================================================
// PEDIDOS
// ===========================================================================
/**
 * Dieciocho pedidos repartidos en los últimos 30 días y en todas las franjas:
 * desayuno (07:45), mañana (09:20), mediodía (12:30), tarde (16:20) y cierre
 * (19:15), para que los gráficos por hora y por día tengan contenido de verdad.
 *
 * Reparto: 14 COMPLETED pagados (12 en efectivo o tarjeta, 2 de alquiler),
 * 1 CANCELLED con motivo, 2-3 en curso (CONFIRMED, PREPARING, READY) y uno de
 * ellos con un abono para que exista un pedido con `balance_minor > 0`.
 */
const DEMO_ORDERS: readonly DemoOrder[] = Object.freeze([
  {
    ref: 1,
    daysAgo: 29,
    hour: 7,
    minute: 45,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.COUNTER,
    status: OrderStatus.COMPLETED,
    customerKey: null,
    staffKey: 'cajero',
    lines: [
      { sku: 'CAF-LAT-01', variant: 'Mediano', quantity: 1 },
      { sku: 'COM-CRS-01', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CASH, depositFactor: 1, reference: 'Caja 1' },
  },
  {
    ref: 2,
    daysAgo: 27,
    hour: 9,
    minute: 20,
    type: OrderType.DINE_IN,
    channel: OrderChannel.POS,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente1',
    staffKey: 'staff',
    chairCode: 'IN-M01',
    tableLabel: 'M1',
    customerNotes: 'Para llevar el croissant aparte, por favor.',
    lines: [
      { sku: 'CAF-CAP-01', variant: 'Pequeño', quantity: 1 },
      { sku: 'POS-CHE-01', quantity: 1, notes: 'Sin coulis, allergy a la maracuyá.' },
    ],
    payment: { method: PaymentMethod.CARD, depositFactor: 1, reference: 'AUT-441207' },
  },
  {
    ref: 3,
    daysAgo: 25,
    hour: 14,
    minute: 10,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.MOBILE_WEB,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente2',
    staffKey: 'cajero',
    couponCode: 'BIENVENIDO20',
    lines: [
      { sku: 'CAF-MOC-01', variant: 'Mediano', quantity: 1 },
      { sku: 'POS-COO-01', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CARD, depositFactor: 1, reference: 'AUT-443918' },
  },
  {
    ref: 4,
    daysAgo: 22,
    hour: 17,
    minute: 35,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.COUNTER,
    status: OrderStatus.COMPLETED,
    customerKey: null,
    staffKey: 'cajero2',
    lines: [
      { sku: 'CAF-CBR-01', variant: 'Mediano', quantity: 1 },
      { sku: 'COM-SAN-01', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CASH, depositFactor: 1, reference: 'Caja 2' },
  },
  {
    ref: 5,
    daysAgo: 20,
    hour: 8,
    minute: 5,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.COUNTER,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente3',
    staffKey: 'cajero',
    couponCode: 'LUNESFIJO',
    lines: [
      { sku: 'CAF-AME-01', variant: 'Grande', quantity: 1 },
      { sku: 'BEB-JUG-01', variant: 'Mediano', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CASH, depositFactor: 1, reference: 'Caja 1' },
  },
  {
    ref: 6,
    daysAgo: 18,
    hour: 12,
    minute: 30,
    type: OrderType.DINE_IN,
    channel: OrderChannel.POS,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente1',
    staffKey: 'staff',
    chairCode: 'TW-01',
    tableLabel: 'W1',
    lines: [
      { sku: 'BEB-MAT-01', variant: 'Mediano', quantity: 1 },
      { sku: 'COM-BAG-01', quantity: 1 },
      { sku: 'POS-TIR-01', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CASH, depositFactor: 1, reference: 'Caja 2' },
  },
  {
    ref: 7,
    daysAgo: 14,
    hour: 10,
    minute: 45,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.COUNTER,
    status: OrderStatus.CANCELLED,
    customerKey: 'cliente2',
    staffKey: 'cajero',
    cancelReason: 'El cliente se retiró: la cheesecake se había agotado y no quiso esperar',
    lines: [
      { sku: 'CAF-LAT-01', variant: 'Grande', quantity: 1 },
      { sku: 'POS-CHE-01', quantity: 1 },
    ],
  },
  {
    ref: 8,
    daysAgo: 12,
    hour: 15,
    minute: 0,
    type: OrderType.DINE_IN,
    channel: OrderChannel.POS,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente3',
    staffKey: 'staff',
    chairCode: 'IN-M02',
    tableLabel: 'M2',
    lines: [
      { sku: 'COM-QUI-01', quantity: 1 },
      { sku: 'BEB-LIM-01', variant: 'Mediano', quantity: 1 },
      { sku: 'CAF-COR-01', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CASH, depositFactor: 1, reference: 'Caja 1' },
  },
  {
    ref: 9,
    daysAgo: 10,
    hour: 8,
    minute: 30,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.COUNTER,
    status: OrderStatus.COMPLETED,
    customerKey: null,
    staffKey: 'cajero',
    couponCode: 'BIENVENIDO20',
    lines: [
      { sku: 'ESP-COM-01', quantity: 1 },
      { sku: 'BEB-JUG-01', variant: 'Mediano', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CASH, depositFactor: 1, reference: 'Caja 2' },
  },
  {
    ref: 10,
    daysAgo: 8,
    hour: 16,
    minute: 20,
    type: OrderType.DINE_IN,
    channel: OrderChannel.POS,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente1',
    staffKey: 'staff',
    chairCode: 'TW-02',
    tableLabel: 'W2',
    customerNotes: 'Tienen reunión y el teclado delante, por eso pido algo rápido.',
    lines: [
      { sku: 'BEB-MAT-01', variant: 'Pequeño', quantity: 1 },
      { sku: 'COM-SAN-01', quantity: 1 },
      { sku: 'SNA-PAP-01', quantity: 1, notes: 'Con alioli.' },
    ],
    payment: { method: PaymentMethod.CARD, depositFactor: 1, reference: 'AUT-448112' },
  },
  {
    ref: 11,
    daysAgo: 6,
    hour: 11,
    minute: 10,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.MOBILE_WEB,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente2',
    staffKey: 'cajero2',
    couponCode: 'TODOCAFE15',
    lines: [
      { sku: 'CAF-CAP-01', variant: 'Mediano', quantity: 2 },
      { sku: 'SNA-GAL-01', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CARD, depositFactor: 1, reference: 'AUT-449005' },
  },
  {
    ref: 12,
    daysAgo: 3,
    hour: 9,
    minute: 55,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.COUNTER,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente3',
    staffKey: 'cajero',
    couponCode: 'BIENVENIDO20',
    lines: [
      {
        sku: 'CAF-LAT-01',
        variant: 'Mediano',
        quantity: 1,
        addons: [
          { name: 'Leche de avena', quantity: 1 },
          { name: 'Extra shot', quantity: 1 },
        ],
      },
    ],
    payment: { method: PaymentMethod.CARD, depositFactor: 1, reference: 'AUT-450477' },
  },
  {
    ref: 13,
    daysAgo: 1,
    hour: 18,
    minute: 25,
    type: OrderType.DINE_IN,
    channel: OrderChannel.POS,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente1',
    staffKey: 'staff',
    chairCode: 'TW-03',
    tableLabel: 'W3',
    lines: [
      { sku: 'BEB-CHC-01', variant: 'Grande', quantity: 1 },
      { sku: 'SNA-PAP-01', quantity: 1 },
      { sku: 'POS-BRW-01', quantity: 1 },
    ],
    payment: { method: PaymentMethod.CASH, depositFactor: 1, reference: 'Caja 2' },
  },
  // --- En curso: lo que el cajero ve en pantalla ahora mismo -----------------
  {
    ref: 14,
    daysAgo: 0,
    hour: 9,
    minute: 5,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.COUNTER,
    status: OrderStatus.CONFIRMED,
    customerKey: 'cliente2',
    staffKey: 'cajero',
    customerNotes: 'Para recoger a las 10:00.',
    lines: [
      { sku: 'ESP-BOW-01', quantity: 1 },
      { sku: 'BEB-MAT-01', variant: 'Pequeño', quantity: 1 },
    ],
  },
  {
    ref: 15,
    daysAgo: 0,
    hour: 9,
    minute: 12,
    type: OrderType.DINE_IN,
    channel: OrderChannel.POS,
    status: OrderStatus.PREPARING,
    customerKey: null,
    staffKey: 'staff',
    chairCode: 'IN-M03',
    tableLabel: 'M3',
    lines: [
      { sku: 'CAF-CAP-01', variant: 'Mediano', quantity: 2 },
      { sku: 'COM-CRS-01', quantity: 1 },
    ],
  },
  {
    ref: 16,
    daysAgo: 0,
    hour: 9,
    minute: 18,
    type: OrderType.TAKEAWAY,
    channel: OrderChannel.MOBILE_WEB,
    status: OrderStatus.READY,
    customerKey: 'cliente3',
    staffKey: 'cajero2',
    customerNotes: 'Abonó el 50 % por la app.',
    lines: [{ sku: 'ESP-COM-01', quantity: 1 }],
    // Abono: deja el pedido con `paid_minor > 0` y `balance_minor > 0`, que es el
    // caso que los reportes de "por cobrar" necesitan ver.
    payment: { method: PaymentMethod.CARD, depositFactor: 0.5, reference: 'AUT-451990' },
  },
  // --- Pedidos de alquiler (BR-ORDER-008 y BR-ORDER-012) -------------------
  {
    ref: 17,
    daysAgo: 9,
    hour: 11,
    minute: 30,
    type: OrderType.CHAIR_RENTAL,
    channel: OrderChannel.POS,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente1',
    staffKey: 'cajero',
    lines: [],
    rentalRef: 1,
    notes: 'Cobro de la sesión de sala, sin consumo.',
    payment: { method: PaymentMethod.CASH, depositFactor: 1, reference: 'Caja 1' },
  },
  {
    ref: 18,
    daysAgo: 4,
    hour: 18,
    minute: 18,
    type: OrderType.CHAIR_RENTAL,
    channel: OrderChannel.POS,
    status: OrderStatus.COMPLETED,
    customerKey: 'cliente3',
    staffKey: 'cajero2',
    lines: [],
    rentalRef: 2,
    notes: 'Incluye 18 minutos de sobretiempo.',
    payment: { method: PaymentMethod.CARD, depositFactor: 1, reference: 'AUT-449870' },
  },
]);

// ===========================================================================
// Resultado
// ===========================================================================

/** Resumen de lo que hizo la semilla de operación. */
export interface OperationsDemoSeedResult {
  readonly createdUsers: number;
  readonly createdHours: number;
  readonly createdReservations: number;
  readonly createdRentals: number;
  readonly createdOrders: number;
  readonly createdOrderItems: number;
  readonly createdPayments: number;
  readonly createdMovements: number;
  readonly createdRedemptions: number;
  readonly skipped: boolean;
}

/** Ajustes del negocio que afectan al dinero de los pedidos. */
interface BusinessSettings {
  readonly businessId: number;
  readonly locationId: number;
  readonly timezone: string;
  readonly currencyCode: string;
  readonly taxRateBp: number;
  readonly taxInclusive: boolean;
  readonly serviceFeeBp: number;
  readonly orderPrefix: string;
}

/** Producto con los datos de precio que necesita cotizar una línea. */
interface PricedProductRow {
  readonly id: number;
  readonly sku: string;
  readonly name: string;
  readonly categoryId: number | null;
  readonly basePriceMinor: number;
  readonly promoPriceMinor: number | null;
  readonly promoStartsAt: string | null;
  readonly promoEndsAt: string | null;
  readonly preparationMinutes: number;
  readonly trackStock: boolean;
}

/** Línea ya cotizada, lista para `computeOrderTotals`. */
interface ResolvedLine {
  readonly product: PricedProductRow;
  readonly variantId: number | null;
  readonly variantName: string | null;
  readonly unitPriceMinor: number;
  readonly quantity: number;
  readonly addonsMinor: number;
  /** Complementes ya resueltos, para `order_item_addons`. */
  readonly addons: readonly { readonly id: number; readonly name: string; readonly priceMinor: number; readonly quantity: number }[];
  readonly notes: string | null;
}

/** Sesión de alquiler sembrada, para el pedido `CHAIR_RENTAL` que la factura. */
interface SeededRental {
  readonly reservationId: number;
  readonly rentalId: number;
  readonly chairId: number;
  readonly totalMinor: number;
  readonly startAt: string;
}

// ===========================================================================
// ENTRADA
// ===========================================================================

/**
 * Siembra los datos operativos de demostración. Idempotente.
 *
 * @param db Conexión dentro de la transacción que abre `seeds/index.ts`.
 */
export function seedOperationsDemo(db: Db): OperationsDemoSeedResult {
  // Se importa de forma diferida SÓLO para no crear un ciclo con el catálogo:
  // `catalog-demo` no necesita saber nada de esta semilla, y esta necesita su
  // comprobación de cuadre del libro de inventario.
  const { assertLedgerConsistency } = loadCatalogGuard();

  const settings = readBusinessSettings(db);
  const now = nowIso();

  assertSeeded('products', db, 'ejecuta `seedCatalogDemo` antes que esta');
  assertSeeded('chairs', db, 'ejecuta `seedSpacesDemo` antes que esta');

  const users = seedUsers(db, now);
  const createdHours = seedBusinessHours(db, settings.businessId);
  const rentals = seedReservationsAndRentals(db, settings, now, users);
  const orders = seedOrders(db, settings, now, users, rentals);
  const createdRedemptions = syncDiscountUsage(db, settings.businessId);

  assertLedgerConsistency(db, settings.businessId, orders.createdMovements);

  const skipped =
    users.created === 0 &&
    createdHours === 0 &&
    rentals.createdReservations === 0 &&
    orders.createdOrders === 0 &&
    orders.createdPayments === 0 &&
    orders.createdMovements === 0;

  logger.info(
    {
      users: users.created,
      hours: createdHours,
      reservations: rentals.createdReservations,
      rentals: rentals.createdRentals,
      orders: orders.createdOrders,
      orderItems: orders.createdOrderItems,
      payments: orders.createdPayments,
      movements: orders.createdMovements,
      redemptions: createdRedemptions,
      skipped,
    },
    'semilla de operaciones aplicada',
  );

  return {
    createdUsers: users.created,
    createdHours,
    createdReservations: rentals.createdReservations,
    createdRentals: rentals.createdRentals,
    createdOrders: orders.createdOrders,
    createdOrderItems: orders.createdOrderItems,
    createdPayments: orders.createdPayments,
    createdMovements: orders.createdMovements,
    createdRedemptions,
    skipped,
  };
}

// ===========================================================================
// AJUSTES DEL NEGOCIO
// ===========================================================================

/**
 * Carga perezosa de la comprobación de cuadre del catálogo.
 *
 * `catalog-demo` no necesita nada de esta semilla, así que no hay ciclo entre las
 * dos; lo que hay es una dependencia que sólo se usa al final del siembra.
 * Resolverla por REFERENCIA (y no con un `import` arriba) deja el grafo de
 * módulos igual de lineal y hace que `seeds/index.ts` sea el único sitio que
 * conoce el orden de las semillas.
 */
function loadCatalogGuard(): LedgerGuard {
  return catalogGuard;
}

/** Contrato de la comprobación de cuadre que aporta el catálogo. */
export interface LedgerGuard {
  assertLedgerConsistency: (db: Db, businessId: number, movedItems: number) => void;
}

/**
 * Referencia al módulo de catálogo. Empieza con una implementación que falla de
 * forma ruidosa: si alguien llamara a `seedOperationsDemo` sin registrar el
 * catálogo, prefiero un error explícito a una semilla que no verifica su libro.
 */
let catalogGuard: LedgerGuard = {
  assertLedgerConsistency: () => {
    throw new Error(
      'La comprobación del libro de inventario no está registrada: llama a `registerCatalogGuard` ' +
        'desde `seeds/index.ts` antes de sembrar operaciones.',
    );
  },
};

/**
 * Registra la comprobación de cuadre del catálogo.
 *
 * Lo invoca `seeds/index.ts` cuando importa ambas semillas, y existe para que el
 * orden de los imports no importe. También lo puede llamar un test que quiera
 * sembrar sólo operaciones.
 */
export function registerCatalogGuard(guard: LedgerGuard): void {
  catalogGuard = guard;
}

/** Lee del negocio lo que el dinero y el calendario de la demo necesitan. */
function readBusinessSettings(db: Db): BusinessSettings {
  const businessId = AUTH.DEFAULT_BUSINESS_ID;
  const business = db
    .prepare(
      `SELECT id, timezone, currency_code, tax_rate_bp, tax_inclusive, service_fee_bp, order_prefix
         FROM businesses WHERE id = ?`,
    )
    .get(businessId) as
    | {
        id: number;
        timezone: string;
        currency_code: string;
        tax_rate_bp: number;
        tax_inclusive: number;
        service_fee_bp: number;
        order_prefix: string;
      }
    | undefined;
  if (business === undefined) {
    throw new Error('La semilla de operaciones necesita el negocio: ejecuta `seedDeployment` antes que esta');
  }
  // La sede de demostración: `spaces-demo` la crea antes que esta.
  const locationId = scalarInt(
    db,
    'SELECT id FROM locations WHERE business_id = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1',
    businessId,
  );
  if (locationId === null) {
    throw new Error('La semilla de operaciones necesita una sede: ejecuta `seedSpacesDemo` antes que esta');
  }
  return {
    businessId,
    locationId,
    timezone: business.timezone,
    currencyCode: business.currency_code,
    taxRateBp: business.tax_rate_bp,
    taxInclusive: business.tax_inclusive === 1,
    serviceFeeBp: business.service_fee_bp,
    orderPrefix: business.order_prefix,
  };
}

// ===========================================================================
// PERSONAS
// ===========================================================================

interface SeededUsers {
  /** `clave -> id de usuario`. */
  readonly ids: ReadonlyMap<string, number>;
  readonly created: number;
  readonly hash: string;
}

/**
 * Contraseña de las cuentas de demostración.
 *
 * `SEED_DEMO_PASSWORD` es la fuente propia de esta semilla; si no está, se
 * reutiliza la de las cuentas de sistema (`SEED_SYSTEM_ACCOUNTS_PASSWORD`), que
 * también sale del entorno. Nunca hay un valor en el código: si ninguna de las
 * dos está puesta, la semilla NO crea usuarios y lo dice en el log, porque
 * inventar una contraseña por aquí sería una puerta abierta en el repositorio.
 */
function readDemoPassword(): string {
  const raw = process.env['SEED_DEMO_PASSWORD'] ?? env.seed.systemAccountsPassword;
  return raw.trim();
}

/** Crea empleados y clientes con su rol, hasheando con el servicio de `auth`. */
function seedUsers(db: Db, now: string): SeededUsers {
  const password = readDemoPassword();
  const all = [...STAFF_USERS, ...CUSTOMER_USERS];

  if (password === '') {
    logger.warn(
      'semilla de operaciones: SEED_DEMO_PASSWORD y SEED_SYSTEM_ACCOUNTS_PASSWORD están vacías; ' +
        'no se crean los usuarios de demostración',
    );
    return { ids: readUserIds(db), created: 0, hash: '' };
  }
  assertPasswordPolicy(password, 'SEED_DEMO_PASSWORD');

  // Un único hash para todas las cuentas, y la MISMA sal para las cinco: es una
  // demo y así el login de la documentación es idéntico para todos los correos.
  // Nótese que el hash NUNCA se registra: el logger redacta `passwordHash`.
  const hash = hashPassword(password);
  const ids = readUserIds(db);
  const verifiedAt = now;

  const roleIds = new Map<RoleValue, number>();
  for (const role of Object.values(Role) as RoleValue[]) {
    const found = db.prepare('SELECT id FROM roles WHERE name = ?').get(role) as { id: number } | undefined;
    if (found === undefined) {
      throw new Error(`El rol ${role} no está sembrado: ejecuta la semilla de RBAC antes que esta`);
    }
    roleIds.set(role, found.id);
  }

  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, full_name, phone, status, email_verified_at, is_staff, created_at)
     VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`,
  );
  const insertRole = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');

  let created = 0;
  for (const user of all) {
    // El correo es la clave natural (`ux_users_email`): si ya existe, la cuenta
    // se respeta tal cual y NO se le restablece la contraseña.
    if (ids.has(user.key)) {
      continue;
    }
    const roleId = roleIds.get(user.role);
    if (roleId === undefined) {
      throw new Error(`El rol ${user.role} no está sembrado para ${user.email}`);
    }
    const inserted = insertUser.run(
      user.email,
      hash,
      user.fullName,
      user.phone,
      verifiedAt,
      user.role === Role.CUSTOMER ? 0 : 1,
      now,
    );
    const userId = Number(inserted.lastInsertRowid);
    insertRole.run(userId, roleId);
    ids.set(user.key, userId);
    created += 1;
  }

  if (created > 0) {
    logger.warn(
      { created, emails: all.map((user) => user.email) },
      'semilla de operaciones: cuentas de demostración creadas con contraseña de DESARROLLO',
    );
  }
  return { ids, created, hash };
}

/** `clave de la demo -> id` de los usuarios que ya existen en la base. */
/** Todo lo que la demo sabe resolver por correo: empleados, clientes y despliegue. */
function addressableUsers(): readonly { readonly key: string; readonly email: string }[] {
  return [...STAFF_USERS, ...CUSTOMER_USERS, ...DEPLOYMENT_ACTORS];
}

function readUserIds(db: Db): Map<string, number> {
  const ids = new Map<string, number>();
  const addressable = addressableUsers();
  if (addressable.length === 0) {
    return ids;
  }
  const emails = addressable.map((user) => user.email);
  const placeholders = emails.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT id, email FROM users WHERE email IN (${placeholders})`)
    .all(...emails) as { id: number; email: string }[];
  const byEmail = new Map(rows.map((row) => [row.email, row.id]));
  for (const user of addressable) {
    const found = byEmail.get(user.email);
    if (found !== undefined) {
      ids.set(user.key, found);
    }
  }
  return ids;
}

// ===========================================================================
// HORARIO DEL LOCAL
// ===========================================================================

/** Siembra la semana de apertura. Sin esto, `GET /business/status` no dice nada. */
function seedBusinessHours(db: Db, businessId: number): number {
  let created = 0;
  for (const day of BUSINESS_HOURS) {
    const found = db
      .prepare('SELECT id FROM business_hours WHERE business_id = ? AND day_of_week = ?')
      .get(businessId, day.dayOfWeek) as { id: number } | undefined;
    if (found !== undefined) {
      continue;
    }
    db.prepare(
      `INSERT INTO business_hours (business_id, day_of_week, opens_at, closes_at, is_closed)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(businessId, day.dayOfWeek, day.opensAt, day.closesAt, day.isClosed ? 1 : 0);
    created += 1;
  }
  return created;
}

// ===========================================================================
// RESERVAS Y ALQUILERES
// ===========================================================================

/**
 * Siembra las sesiones de alquiler con su reserva, su alquiler y el estado de
 * la silla que corresponde.
 *
 * El estado de la silla NO es un dato libre: sale de la máquina de estados
 * (DESIGN.md 6.4). Una reserva ACTIVE tiene al cliente sentado, así que la silla
 * está `OCCUPIED` y su alquiler `ACTIVE`; una reserva CONFIRMED de mañana deja la
 * silla `AVAILABLE`; una reserva terminada la deja como estaba.
 */
function seedReservationsAndRentals(
  db: Db,
  settings: BusinessSettings,
  now: string,
  users: SeededUsers,
): { readonly byRef: ReadonlyMap<number, SeededRental>; readonly createdReservations: number; readonly createdRentals: number } {
  const spaces = new SqliteSpacesRepository();
  const byRef = new Map<number, SeededRental>();
  let createdReservations = 0;
  let createdRentals = 0;

  for (const reservation of DEMO_RESERVATIONS) {
    const code = demoCode('RES-', reservation.ref);
    const existing = db
      .prepare('SELECT id FROM chair_reservations WHERE code = ?')
      .get(code) as { id: number } | undefined;
    if (existing !== undefined) {
      continue;
    }

    const chair = spaces.findChairByCode(reservation.chairCode);
    if (chair === null) {
      throw new Error(
        `La reserva ${code} usa la silla ${reservation.chairCode}, que no está sembrada: ` +
          'ejecuta `seedSpacesDemo` antes que esta',
      );
    }
    const zone = db.prepare('SELECT id FROM zones WHERE id = ?').get(chair.zone_id) as { id: number };
    const customerId = userId(users, reservation.customerKey);
    // El precio se CONGELA aquí (BR-PRICE-010 / BR-RENTAL-003).
    const pricePerHourMinor = chair.price_per_hour_minor;
    const rentalTotalMinor = projectRentalMinor(reservation.durationMinutes, pricePerHourMinor);

    // La sesión de la reserva 3 ya lleva 47 minutos: el reloj del panel tiene que
    // tener algo que mostrar desde el primer segundo de la demo.
    const elapsedMinutes = reservation.status === ReservationStatus.ACTIVE ? 47 : 0;
    // La reserva ACTIVA arranca AHORA (hace 47 minutos), no a una hora de reloj:
    // es la única cuya ventana tiene que contener el instante actual.
    const startAt =
      reservation.status === ReservationStatus.ACTIVE
        ? addMinutes(now, -elapsedMinutes)
        : zonedLocalIso(
            localDay(reservation.daysAgo, now, settings.timezone),
            reservation.hour,
            reservation.minute,
            settings.timezone,
          );
    const endAt = addMinutes(startAt, reservation.durationMinutes);

    const inserted = db
      .prepare(
        `INSERT INTO chair_reservations (
           business_id, location_id, zone_id, chair_id, customer_id, code, status,
           start_at, end_at, duration_minutes, price_per_hour_minor, rental_total_minor,
           checked_in_at, checked_out_at, source, created_by, notes
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        settings.businessId,
        settings.locationId,
        zone.id,
        chair.id,
        customerId,
        code,
        reservation.status,
        startAt,
        endAt,
        reservation.durationMinutes,
        pricePerHourMinor,
        rentalTotalMinor,
        // Un ACTIVE siempre tiene check-in (CHECK `ck_chair_reservations_checkin`).
        reservation.status === ReservationStatus.ACTIVE || reservation.status === ReservationStatus.COMPLETED
          ? startAt
          : null,
        reservation.status === ReservationStatus.COMPLETED
          ? addMinutes(endAt, reservation.overtimeMinutes)
          : null,
        ReservationSource.CUSTOMER,
        null,
        reservation.notes,
      );
    const reservationId = Number(inserted.lastInsertRowid);
    createdReservations += 1;

    // --- Alquiler -----------------------------------------------------------
    if (reservation.status === ReservationStatus.PENDING || reservation.status === ReservationStatus.CONFIRMED) {
      continue;
    }
    const rentalCode = demoCode('RENT-', reservation.ref);
    const charge = computeRentalCharge({
      startAt,
      // `plannedEndAt` es el `end_at` vigente: el overage se mide contra el plan.
      plannedEndAt: endAt,
      plannedMinutes: reservation.durationMinutes,
      extensionsMinor: 0,
      pricePerHourMinor,
      endedAt: addMinutes(endAt, reservation.overtimeMinutes),
      taxRateBp: settings.taxRateBp,
      serviceFeeBp: settings.serviceFeeBp,
      taxInclusive: settings.taxInclusive,
      waiveOvertime: false,
    });
    const rentalStatus =
      reservation.status === ReservationStatus.ACTIVE ? RentalStatus.ACTIVE : RentalStatus.COMPLETED;
    const rentalInserted = db
      .prepare(
        `INSERT INTO chair_rentals (
           business_id, chair_id, reservation_id, customer_id, code, status,
           start_at, end_at, planned_minutes, billed_minutes, price_per_hour_minor,
           subtotal_minor, extensions_minor, extra_minutes_minor, total_minor, created_by
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        settings.businessId,
        chair.id,
        reservationId,
        customerId,
        rentalCode,
        rentalStatus,
        startAt,
        endAt,
        reservation.durationMinutes,
        // Un alquiler abierto todavía no ha cerrado: no se facturan minutos
        // hasta el check-out, que es donde se calcula el overage.
        rentalStatus === RentalStatus.ACTIVE ? 0 : charge.billedMinutes,
        pricePerHourMinor,
        charge.subtotalMinor,
        charge.extensionsMinor,
        rentalStatus === RentalStatus.ACTIVE ? 0 : charge.extraMinutesMinor,
        rentalStatus === RentalStatus.ACTIVE ? charge.subtotalMinor : charge.totalMinor,
        null,
      );
    const rentalId = Number(rentalInserted.lastInsertRowid);
    createdRentals += 1;

    // --- Estado de la silla -------------------------------------------------
    if (rentalStatus === RentalStatus.ACTIVE) {
      spaces.updateChairStatus(chair.id, 'OCCUPIED', startAt, db);
    }

    byRef.set(reservation.ref, {
      reservationId,
      rentalId,
      chairId: chair.id,
      totalMinor: rentalStatus === RentalStatus.ACTIVE ? charge.subtotalMinor : charge.totalMinor,
      startAt,
    });
  }

  return { byRef, createdReservations, createdRentals };
}

// ===========================================================================
// PEDIDOS
// ===========================================================================

/** Resultado del bucle de pedidos, para el resumen y las aserciones. */
interface SeededOrders {
  readonly createdOrders: number;
  readonly createdOrderItems: number;
  readonly createdPayments: number;
  readonly createdMovements: number;
}

/** Siembra los dieciocho pedidos con líneas, historial, cobros y stock. */
function seedOrders(
  db: Db,
  settings: BusinessSettings,
  now: string,
  users: SeededUsers,
  rentals: { readonly byRef: ReadonlyMap<number, SeededRental> },
): SeededOrders {
  const stock = new SqliteInventoryRepository();
  let createdOrders = 0;
  let createdOrderItems = 0;
  let createdPayments = 0;
  let createdMovements = 0;

  // En orden cronológico: el libro de inventario se encadena por fecha, así que un
  // movimiento posterior nunca puede tener un `balance_after` anterior.
  const sorted = [...DEMO_ORDERS].sort((a, b) => b.daysAgo - a.daysAgo || a.ref - b.ref);

  for (const order of sorted) {
    // `ORD-900001`: el prefijo del negocio más el número de serie de la demo,
    // que es determinista y por tanto la clave de idempotencia de la fila.
    const orderNumber = `${settings.orderPrefix}-${String(DEMO_ORDER_BASE + order.ref).padStart(6, '0')}`;
    const existing = db
      .prepare('SELECT id FROM orders WHERE order_number = ?')
      .get(orderNumber) as { id: number } | undefined;
    if (existing !== undefined) {
      continue;
    }

    const placedAt = zonedLocalIso(
      localDay(order.daysAgo, now, settings.timezone),
      order.hour,
      order.minute,
      settings.timezone,
    );
    const customerId = order.customerKey === null ? null : userId(users, order.customerKey);
    const createdBy = actorId(users, order.staffKey);

    // --- Líneas ------------------------------------------------------------
    const rental = order.rentalRef === undefined ? undefined : rentals.byRef.get(order.rentalRef);
    if (order.type === OrderType.CHAIR_RENTAL && rental === undefined) {
      throw new Error(
        `El pedido ${orderNumber} es CHAIR_RENTAL y no encuentra el alquiler de la reserva ${String(order.rentalRef)}`,
      );
    }
    // BR-ORDER-008: un pedido `CHAIR_RENTAL` SIEMPRE lleva silla y reserva, así
    // que la silla del alquiler es la suya aunque el pedido no la declare.
    const chairId =
      order.chairCode !== undefined
        ? requireChairId(db, order.chairCode)
        : (rental?.chairId ?? null);
    const lines = order.lines.map((line) => resolveLine(db, line, placedAt));
    // BR-ORDER-012: un pedido es de productos O de alquiler, nunca de los dos.
    if (order.type === OrderType.CHAIR_RENTAL && lines.length > 0) {
      throw new Error(`El pedido ${orderNumber} mezcla líneas de producto con un alquiler (BR-ORDER-012)`);
    }

    // --- Cupón -------------------------------------------------------------
    const subtotalBeforeDiscount =
      lines.reduce<number>((total, line) => total + roundHalfUp((line.unitPriceMinor + line.addonsMinor) * line.quantity), 0) +
      (rental?.totalMinor ?? 0);
    const discountMinor =
      order.couponCode === undefined
        ? 0
        : quoteCoupon(db, order.couponCode, subtotalBeforeDiscount, lines, placedAt);

    // --- Totales: los calcula el motor de la API, no esta semilla -----------
    const totals = computeOrderTotals({
      lines: lines.map((line, index) => ({
        id: index + 1,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        addonsMinor: line.addonsMinor,
        taxRateBp: settings.taxRateBp,
      })),
      discountMinor,
      settings: {
        taxRateBp: settings.taxRateBp,
        taxInclusive: settings.taxInclusive,
        serviceFeeBp: settings.serviceFeeBp,
      },
      ...(rental === undefined
        ? {}
        : { rentalBaseMinor: rental.totalMinor, rentalTaxRateBp: settings.taxRateBp }),
    });

    // --- Fechas del ciclo de vida -----------------------------------------
    const confirmedAt =
      order.status === OrderStatus.PENDING || order.status === OrderStatus.DRAFT
        ? null
        : addMinutes(placedAt, 1);
    // Un alquiler de silla no pasa por cocina: el cobro lo completa desde
    // CONFIRMED (BR-ORDER-015), así que no inventa pasos de preparación.
    const goesToKitchen = order.type !== OrderType.CHAIR_RENTAL;
    const preparingAt =
      goesToKitchen &&
      (order.status === OrderStatus.PREPARING ||
        order.status === OrderStatus.READY ||
        order.status === OrderStatus.DELIVERING ||
        order.status === OrderStatus.COMPLETED)
        ? addMinutes(placedAt, 3)
        : null;
    const readyAt =
      goesToKitchen && (order.status === OrderStatus.READY || order.status === OrderStatus.COMPLETED)
        ? addMinutes(placedAt, 8)
        : null;
    const completedAt = order.status === OrderStatus.COMPLETED ? addMinutes(placedAt, 12) : null;
    const cancelledAt = order.status === OrderStatus.CANCELLED ? addMinutes(placedAt, 4) : null;

    // --- Cobro -------------------------------------------------------------
    const paidMinor = computePaidMinor(order, totals.totalMinor);

    const inserted = db
      .prepare(
        `INSERT INTO orders (
           business_id, location_id, order_number, type, status, customer_id, chair_id,
           reservation_id, rental_id, table_label, channel, created_by,
           subtotal_minor, discount_minor, tax_minor, service_fee_minor, total_minor,
           paid_minor, balance_minor, coupon_code, notes, customer_notes,
           placed_at, confirmed_at, preparing_at, ready_at, completed_at, cancelled_at,
           cancel_reason, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        settings.businessId,
        settings.locationId,
        orderNumber,
        order.type,
        order.status,
        customerId,
        chairId,
        rental?.reservationId ?? null,
        rental?.rentalId ?? null,
        order.tableLabel ?? null,
        order.channel,
        createdBy,
        totals.subtotalMinor,
        totals.discountMinor,
        totals.taxMinor,
        totals.serviceFeeMinor,
        totals.totalMinor,
        paidMinor,
        totals.totalMinor - paidMinor,
        order.couponCode ?? null,
        order.notes ?? null,
        order.customerNotes ?? null,
        placedAt,
        confirmedAt,
        preparingAt,
        readyAt,
        completedAt,
        cancelledAt,
        order.cancelReason ?? null,
        placedAt,
      );
    const orderId = Number(inserted.lastInsertRowid);
    createdOrders += 1;

    // --- Líneas ------------------------------------------------------------
    const itemStatus =
      order.status === OrderStatus.CANCELLED
        ? OrderItemStatus.CANCELLED
        : order.status === OrderStatus.COMPLETED || order.status === OrderStatus.READY
          ? OrderItemStatus.READY
          : OrderItemStatus.PENDING;
    const insertItem = db.prepare(
      `INSERT INTO order_items (
         order_id, product_id, variant_id, name_snapshot, sku_snapshot, unit_price_minor,
         quantity, discount_minor, tax_minor, line_total_minor, notes, status,
         preparation_minutes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertItemAddon = db.prepare(
      `INSERT INTO order_item_addons (order_item_id, product_addon_id, name_snapshot, price_minor, quantity, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    lines.forEach((line, index) => {
      const computed = totals.lines[index];
      if (computed === undefined) {
        throw new Error(`El motor de precios no devolvió la línea ${index} del pedido ${orderNumber}`);
      }
      const itemInserted = insertItem.run(
        orderId,
        line.product.id,
        line.variantId,
        // Snapshot: el recibo no vuelve a mirar el catálogo (BR-PRICE-004).
        line.variantName === null ? line.product.name : `${line.product.name} (${line.variantName})`,
        line.product.sku,
        computed.unitPriceMinor,
        computed.quantity,
        computed.discountMinor,
        computed.taxMinor,
        computed.lineTotalMinor,
        line.notes ?? null,
        itemStatus,
        line.product.preparationMinutes,
        placedAt,
      );
      createdOrderItems += 1;
      const itemId = Number(itemInserted.lastInsertRowid);
      for (const addon of line.addons) {
        insertItemAddon.run(itemId, addon.id, addon.name, addon.priceMinor, addon.quantity, placedAt);
      }
    });

    // --- Historial de estados ---------------------------------------------
    writeOrderHistory(db, orderId, order.status, createdBy, placedAt, confirmedAt, preparingAt, readyAt, completedAt, cancelledAt, order.cancelReason);

    // --- Cobro -------------------------------------------------------------
    if (order.payment !== undefined && paidMinor > 0) {
      const paymentRef = order.ref;
      const approvedAt = completedAt ?? addMinutes(placedAt, 10);
      const receivedMinor = roundUpToCash(order.payment.method, paidMinor);
      const changeDueMinor = receivedMinor - paidMinor;
      const provider =
        order.payment.method === PaymentMethod.CASH ? PaymentProvider.CASH_REGISTRY : PaymentProvider.WOMPI;
      db.prepare(
        `INSERT INTO payments (
           business_id, order_id, payment_number, method, provider, provider_reference, status,
           amount_minor, refunded_minor, currency_code, reference_number, notes,
           processed_by, customer_id, approved_at, metadata, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        settings.businessId,
        orderId,
        demoCode('PAY-', paymentRef),
        order.payment.method,
        provider,
        order.payment.method === PaymentMethod.CARD ? order.payment.reference : null,
        PaymentStatus.APPROVED,
        paidMinor,
        settings.currencyCode,
        order.payment.method === PaymentMethod.CASH ? order.payment.reference : null,
        null,
        createdBy,
        customerId,
        approvedAt,
        // Nunca un PAN ni un token (BR-SEC-006): sólo claves de referencia.
        JSON.stringify({
          idempotency_key: `seed-${demoCode('PAY-', paymentRef)}`,
          received_minor: receivedMinor,
          change_due_minor: changeDueMinor,
          channel: 'LOCAL',
          seeded: true,
        }),
        approvedAt,
      );
      createdPayments += 1;
    }

    // --- Reserva <-> pedido (enlace bidireccional) ------------------------
    if (rental !== undefined) {
      db.prepare('UPDATE chair_reservations SET order_id = ? WHERE id = ?').run(orderId, rental.reservationId);
    }

    // --- Renunciación de cupón (BR-DISC-010) ------------------------------
    if (order.couponCode !== undefined && order.status !== OrderStatus.CANCELLED) {
      db.prepare(
        `INSERT OR IGNORE INTO discount_redemptions (discount_id, order_id, customer_id, amount_minor, created_at)
         SELECT id, ?, ?, ?, ? FROM discounts WHERE code = ?`,
      ).run(orderId, customerId, totals.discountMinor, placedAt, order.couponCode);
    }

    // --- Inventario --------------------------------------------------------
    createdMovements += applyStockForOrder(db, stock, settings, orderId, order.status, lines, placedAt, cancelledAt, order.cancelReason ?? null, createdBy);
  }

  stampLastLogins(db);
  return { createdOrders, createdOrderItems, createdPayments, createdMovements };
}

/**
 * Rellena `users.last_login_at` con la última vez que esa persona tocó el sistema.
 *
 * Un cliente con cinco pedidos y `last_login_at = NULL` delata que la fila la
 * escribió una máquina. El `WHERE last_login_at IS NULL` lo mantiene idempotente:
 * una segunda ejecución no lo vuelve a escribir, y una persona que haya entrado
 * de verdad desde la siembra conserva su fecha.
 */
function stampLastLogins(db: Db): void {
  db.prepare(
    `UPDATE users
        SET last_login_at = (
              SELECT MAX(o.placed_at) FROM orders o
               WHERE o.customer_id = users.id OR o.created_by = users.id
            )
      WHERE last_login_at IS NULL
        AND EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = users.id OR o.created_by = users.id)`,
  ).run();
}

// ===========================================================================
// COBRO
// ===========================================================================

/**
 * Importe cobrado de un pedido: el total, o el abono si el pago es parcial.
 *
 * `depositFactor` menor que 1 deja el pedido con `balance_minor > 0`, que es el caso
 * "abonado" que el reporte de cuentas por cobrar tiene que saber mostrar.
 */
function computePaidMinor(order: DemoOrder, totalMinor: number): number {
  if (order.payment === undefined || totalMinor <= 0) {
    return 0;
  }
  return Math.min(totalMinor, roundHalfUp(totalMinor * order.payment.depositFactor));
}

/** Efectivo entregado redondeado hacia arriba a múltiplos de $1.000. */
function roundUpToCash(method: PaymentMethodValue, paidMinor: number): number {
  if (method !== PaymentMethod.CASH) {
    return paidMinor;
  }
  const step = 100_000;
  return Math.ceil(paidMinor / step) * step;
}

// ===========================================================================
// HISTORIAL DE ESTADOS
// ===========================================================================

/**
 * Escribe `order_status_history` con la CADENA REAL de transiciones.
 *
 * No se inventa un `from_status`->`to_status`Shortcut: una venta cobrada en el
 * mostrador pasa por `PENDING -> CONFIRMED -> COMPLETED` (el autocompletado del
 * cobro, `PaymentsService.maybeCompleteOrder`), y una que se preparó en cocina
 * pasa por `PENDING -> CONFIRMED -> PREPARING -> READY -> COMPLETED`. La primera
 * entrada tiene `from_status = NULL` porque el pedido nace aquí.
 */
function writeOrderHistory(
  db: Db,
  orderId: number,
  status: OrderStatusValue,
  changedBy: number | null,
  placedAt: string,
  confirmedAt: string | null,
  preparingAt: string | null,
  readyAt: string | null,
  completedAt: string | null,
  cancelledAt: string | null,
  cancelReason: string | undefined,
): void {
  const insert = db.prepare(
    `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  // Paso 1: el pedido nace.
  insert.run(orderId, null, OrderStatus.PENDING, changedBy, null, placedAt);

  if (status === OrderStatus.PENDING || status === OrderStatus.DRAFT) {
    return;
  }

  if (status === OrderStatus.CANCELLED) {
    // CHECK `ck_order_history_reason`: cancelar siempre deja motivo.
    insert.run(
      orderId,
      OrderStatus.PENDING,
      OrderStatus.CANCELLED,
      changedBy,
      cancelReason ?? 'Cancelado en el mostrador',
      cancelledAt ?? addMinutes(placedAt, 4),
    );
    return;
  }

  if (confirmedAt !== null) {
    // El pago en mostrador confirma solo; la cocina lo confirma a mano.
    const byCashier = completedAt !== null && preparingAt === null;
    insert.run(
      orderId,
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      changedBy,
      byCashier ? 'Confirmado automáticamente por el cobro' : 'Pedido confirmado en el mostrador',
      confirmedAt,
    );
  }
  if (preparingAt !== null) {
    insert.run(orderId, OrderStatus.CONFIRMED, OrderStatus.PREPARING, changedBy, 'En preparación', preparingAt);
  }
  if (readyAt !== null) {
    insert.run(
      orderId,
      OrderStatus.PREPARING,
      OrderStatus.READY,
      changedBy,
      'Listo para entregar',
      readyAt,
    );
  }
  if (completedAt !== null) {
    insert.run(
      orderId,
      readyAt === null ? OrderStatus.CONFIRMED : OrderStatus.READY,
      OrderStatus.COMPLETED,
      changedBy,
      'Cobro completo: el pedido queda pagado y entregado',
      completedAt,
    );
  }
}

// ===========================================================================
// INVENTARIO DE LOS PEDIDOS
// ===========================================================================

/**
 * Escribe los movimientos de stock de un pedido, igual que haría la API.
 *
 * Al colocar el pedido se reserva (`RESERVATION` negativo) cada producto con
 * `track_stock = 1` que tenga ítem de inventario, y cada insumo de su receta que
 * también lo tenga (BR-INV-003). Al cancelar se devuelve todo (`RELEASE`
 * positivo): nunca hay `SALE` desde aquí, porque la venta definitiva es la
 * reserva que ya se consumió (BR-INV-004).
 *
 * El `balance_after` se encadena con el saldo real del ítem y el `current_stock`
 * se actualiza en la misma transacción, así que el libro sigue cuadrando.
 */
function applyStockForOrder(
  db: Db,
  stock: SqliteInventoryRepository,
  settings: BusinessSettings,
  orderId: number,
  status: OrderStatusValue,
  lines: readonly ResolvedLine[],
  placedAt: string,
  cancelledAt: string | null,
  cancelReason: string | null,
  performedBy: number | null,
): number {
  let movements = 0;
  const insert = db.prepare(
    `INSERT INTO inventory_movements (
       business_id, inventory_item_id, movement_type, quantity, balance_after,
       unit_cost_minor, reference_type, reference_id, reason, performed_by, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, 'ORDER', ?, ?, ?, ?)`,
  );

  const reserve = (inventoryItemId: number, quantity: number, at: string, reason: string | null): void => {
    const item = stock.findItemById(inventoryItemId, settings.businessId, db);
    if (item === null || item.is_tracked === 0) {
      return;
    }
    const balanceAfter = roundStock(item.current_stock + quantity);
    insert.run(
      settings.businessId,
      inventoryItemId,
      quantity < 0 ? 'RESERVATION' : 'RELEASE',
      quantity,
      balanceAfter,
      item.cost_minor,
      orderId,
      reason,
      performedBy,
      at,
    );
    stock.setCurrentStock(inventoryItemId, balanceAfter, db);
    movements += 1;
  };

  for (const line of lines) {
    if (!line.product.trackStock) {
      continue;
    }
    const itemId = scalarInt(
      db,
      'SELECT id FROM inventory_items WHERE product_id = ? AND deleted_at IS NULL',
      line.product.id,
    );
    if (itemId !== null) {
      reserve(itemId, -line.quantity, placedAt, null);
    }
    // Explosión de la receta: sólo los insumos que el negocio sigue.
    for (const ingredient of trackedRecipeIngredients(db, line.product.id)) {
      reserve(ingredient.inventoryItemId, -(ingredient.quantity * line.quantity), placedAt, null);
    }
  }

  if (status === OrderStatus.CANCELLED) {
    const at = cancelledAt ?? addMinutes(placedAt, 4);
    for (const line of lines) {
      if (!line.product.trackStock) {
        continue;
      }
      const itemId = scalarInt(
        db,
        'SELECT id FROM inventory_items WHERE product_id = ? AND deleted_at IS NULL',
        line.product.id,
      );
      if (itemId !== null) {
        reserve(itemId, line.quantity, at, cancelReason);
      }
    }
  }

  return movements;
}

/** Insumos de la receta que además tienen control de stock. */
function trackedRecipeIngredients(
  db: Db,
  productId: number,
): readonly { readonly inventoryItemId: number; readonly quantity: number }[] {
  return db
    .prepare(
      `SELECT ii.id AS inventoryItemId, pi.quantity AS quantity
         FROM product_ingredients pi
         JOIN inventory_items ii ON ii.ingredient_id = pi.ingredient_id AND ii.deleted_at IS NULL
        WHERE pi.product_id = ? AND ii.is_tracked = 1`,
    )
    .all(productId) as readonly { readonly inventoryItemId: number; readonly quantity: number }[];
}

/** Redondeo del saldo de inventario: tres decimales, sin ruido de coma flotante. */
function roundStock(value: number): number {
  return Math.round(value * 1000) / 1000;
}

// ===========================================================================
// COTIZACIÓN DEL CUPÓN
// ===========================================================================

/**
 * Importe de un cupón con la MISMA fórmula que `DiscountsService.quote`.
 *
 * Se replica aquí, y no se llama al service, por una razón práctica: el service
 * necesita un `UserContext`, escribe la redención y valida permisos de gestión;
 * una semilla que fabricase un contexto para cotizar cuatro cupones acabaría
 * escribió auditoría y redemption desde donde no debe. La fórmula sí es la misma:
 * base aplicable -> PERCENT en basis points o FIXED -> tope -> recorte a la base.
 *
 * @throws Error si el cupón no existe o el pedido no llega al mínimo: es un error
 *         de los DATOS de la demo, y es mejor que salte aquí que un pedido con un
 *         descuento que ninguna otra vez sabría justificar.
 */
function quoteCoupon(
  db: Db,
  code: string,
  subtotalMinor: number,
  lines: readonly ResolvedLine[],
  at: string,
): number {
  const row = db
    .prepare(
      `SELECT id, type, value, min_order_minor, max_discount_minor, applies_to,
              applies_category_id, usage_limit, used_count, is_active, starts_at, ends_at
         FROM discounts WHERE code = ? AND deleted_at IS NULL`,
    )
    .get(code) as
    | {
        id: number;
        type: string;
        value: number;
        min_order_minor: number | null;
        max_discount_minor: number | null;
        applies_to: string;
        applies_category_id: number | null;
        usage_limit: number | null;
        used_count: number;
        is_active: number;
        starts_at: string | null;
        ends_at: string | null;
      }
    | undefined;
  if (row === undefined) {
    throw new Error(`El pedido usa el cupón ${code}, que no está sembrado: ejecuta la semilla de descuentos antes`);
  }
  if (row.is_active !== 1) {
    throw new Error(`El cupón ${code} está desactivado y no puede aplicarse a un pedido de demostración`);
  }
  if (row.starts_at !== null && row.starts_at > at) {
    throw new Error(`El cupón ${code} todavía no empieza en la fecha del pedido (${at})`);
  }
  if (row.ends_at !== null && row.ends_at <= at) {
    throw new Error(`El cupón ${code} ya está vencido en la fecha del pedido (${at})`);
  }
  if (row.usage_limit !== null && row.used_count >= row.usage_limit) {
    throw new Error(`El cupón ${code} ya agotó su límite de usos`);
  }
  if (row.min_order_minor !== null && subtotalMinor < row.min_order_minor) {
    throw new Error(
      `El pedido con el cupón ${code} suma ${String(subtotalMinor)} y no alcanza el mínimo de ${String(row.min_order_minor)}`,
    );
  }

  // Base aplicable según el ámbito (BR-DISC-002).
  const applicableBase =
    row.applies_to === 'ALL'
      ? subtotalMinor
      : lines
          .filter((line) => line.product.categoryId === row.applies_category_id)
          .reduce<number>(
            (total, line) => total + roundHalfUp((line.unitPriceMinor + line.addonsMinor) * line.quantity),
            0,
          );
  if (applicableBase <= 0) {
    throw new Error(`El cupón ${code} no aplica a ninguna línea del pedido`);
  }

  const gross = row.type === 'PERCENT' ? applyTaxBp(applicableBase, row.value) : row.value;
  const capped = row.max_discount_minor === null ? gross : Math.min(gross, row.max_discount_minor);
  return Math.max(0, Math.min(capped, applicableBase));
}

/**
 * `discounts.used_count` = número de redenciones reales (BR-DISC-004).
 *
 * Se recalcula al final, después de todos los pedidos, en vez de incrementarlo
 * al sembrar: así el contador SIEMPRE coincide con `discount_redemptions`, aunque
 * la mitad de los pedidos vinieran de antes y no se hubieran insertado.
 */
function syncDiscountUsage(db: Db, businessId: number): number {
  const updated = db
    .prepare(
      `UPDATE discounts
          SET used_count = (
            SELECT COUNT(*) FROM discount_redemptions r WHERE r.discount_id = discounts.id
          )
        WHERE business_id = ?
          AND used_count <> (
            SELECT COUNT(*) FROM discount_redemptions r WHERE r.discount_id = discounts.id
          )`,
    )
    .run(businessId);
  return updated.changes;
}

// ===========================================================================
// UTILIDADES
// ===========================================================================

/** Id de un cliente de la demo por su clave, con error si no existe. */
function userId(users: SeededUsers, key: string): number {
  const found = users.ids.get(key);
  if (found === undefined) {
    throw new Error(`El usuario de demostración "${key}" no está sembrado: revisa seedUsers`);
  }
  return found;
}

/**
 * Id de quien abre el pedido (`orders.created_by`).
 *
 * `created_by` admite `NULL`, así que si la cuenta de sistema que la demo
 * esperaba no existe --porque `SEED_SYSTEM_ACCOUNTS` está apagado-- el pedido se
 * siembra sin autor en vez de abortar la semilla entera. Los clientes, en
 * cambio, son parte del contrato de la demo: si faltan, sí es un error.
 */
function actorId(users: SeededUsers, key: string): number | null {
  return users.ids.get(key) ?? users.ids.get('cajero2') ?? users.ids.get('staff') ?? null;
}

/** Id de una silla por su código, con error si no existe. */
function requireChairId(db: Db, code: string): number {
  const found = scalarInt(db, 'SELECT id FROM chairs WHERE code = ?', code);
  if (found === null) {
    throw new Error(`La silla ${code} no está sembrada: ejecuta la semilla de espacios antes que esta`);
  }
  return found;
}

/** Producto con sus datos de precio, por SKU. */
function findPricedProduct(db: Db, sku: string): PricedProductRow {
  const row = db
    .prepare(
      `SELECT id, sku, name, category_id, base_price_minor, promo_price_minor, promo_starts_at,
              promo_ends_at, preparation_minutes, track_stock
         FROM products WHERE sku = ? AND deleted_at IS NULL`,
    )
    .get(sku) as
    | {
        id: number;
        sku: string;
        name: string;
        category_id: number | null;
        base_price_minor: number;
        promo_price_minor: number | null;
        promo_starts_at: string | null;
        promo_ends_at: string | null;
        preparation_minutes: number;
        track_stock: number;
      }
    | undefined;
  if (row === undefined) {
    throw new Error(`El producto ${sku} no está sembrado: ejecuta la semilla de catálogo antes que esta`);
  }
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    categoryId: row.category_id,
    basePriceMinor: row.base_price_minor,
    promoPriceMinor: row.promo_price_minor,
    promoStartsAt: row.promo_starts_at,
    promoEndsAt: row.promo_ends_at,
    preparationMinutes: row.preparation_minutes,
    trackStock: row.track_stock === 1,
  };
}

/**
 * Cotiza una línea de pedido con el MISMO motor de precio que la API.
 *
 * El precio se resuelve en el INSTANTE DEL PEDIDO, no en el de la siembra: un
 * pedido de hace 25 días se cobró al precio de entonces, con la promoción que
 * estaba vigente ese día. Es la diferencia entre un histórico que cuadra y uno
 * que parece inventado.
 */
function resolveLine(db: Db, line: DemoOrderLine, at: string): ResolvedLine {
  const product = findPricedProduct(db, line.sku);
  let variantId: number | null = null;
  let variant: { priceDeltaMinor: number; priceMinor: number | null } | null = null;
  let variantName: string | null = null;
  if (line.variant !== undefined) {
    const found = db
      .prepare('SELECT id, name, price_delta_minor, price_minor FROM product_variants WHERE product_id = ? AND name = ?')
      .get(product.id, line.variant) as
      | { id: number; name: string; price_delta_minor: number; price_minor: number | null }
      | undefined;
    if (found === undefined) {
      throw new Error(`La variante "${line.variant}" de ${line.sku} no está sembrada`);
    }
    variantId = found.id;
    variantName = found.name;
    variant = { priceDeltaMinor: found.price_delta_minor, priceMinor: found.price_minor };
  }

  const priced = resolveUnitPrice(
    {
      basePriceMinor: product.basePriceMinor,
      promoPriceMinor: product.promoPriceMinor,
      promoStartsAt: product.promoStartsAt,
      promoEndsAt: product.promoEndsAt,
    },
    variant,
    at,
  );

  const addons = (line.addons ?? []).map((addon) => {
    const found = db
      .prepare('SELECT id, name, price_minor FROM product_addons WHERE product_id = ? AND name = ? AND is_active = 1')
      .get(product.id, addon.name) as { id: number; name: string; price_minor: number } | undefined;
    if (found === undefined) {
      throw new Error(`El complemento "${addon.name}" de ${line.sku} no está sembrado`);
    }
    return { id: found.id, name: found.name, priceMinor: found.price_minor, quantity: addon.quantity };
  });

  return {
    product,
    variantId,
    variantName,
    unitPriceMinor: priced.unitPriceMinor,
    quantity: line.quantity,
    // BR-PRICE-003: los complementos suman al precio UNITARIO antes de multiplicar.
    addonsMinor: roundHalfUp(
      addons.reduce<number>((total, addon) => total + addon.priceMinor * addon.quantity, 0),
    ),
    addons,
    notes: line.notes ?? null,
  };
}

/** Exportado para los tests: la aritmética de línea del motor de la API. */
export { computeOrderTotals as computeDemoOrderTotals };
