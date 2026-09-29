/**
 * Grafo de dependencias del módulo `orders` (DESIGN.md 3.6).
 *
 * ============================ POR QUÉ ES LOCAL ==============================
 * El contenedor oficial es `config/container.ts`, y ese fichero lo mantiene otro
 * agente en paralelo (lo cablea el integrador al final). Añadir aquí las entradas
 * de pedidos habría creado un conflicto de edición sobre un archivo compartido,
 * así que este módulo construye SU PROPIO grafo, con las mismas reglas:
 *
 *  1. Se construye UNA vez por proceso y se reutiliza (perezoso).
 *  2. Los repositorios NO guardan la conexión: la piden a `getConnection()` en
 *     cada llamada, así que este singletón no abre la base de datos y los tests
 *     pueden apuntarla a una base en memoria sin reconstruir nada.
 *  3. El `AuditService` se TOMA del contenedor oficial, no se crea otro: la
 *     auditoría es compartida (BR-SEC-007) y tener dos instancias significaría
 *     dos `defaultBusinessId` distintos conviviendo.
 *
 * ============================================================================
 * LOS TRES MÓDULOS DE LOS QUE DEPENDE Y CÓMO SE CONECTAN
 * ============================================================================
 *  - `catalog`   -> `resolveUnitPrice`, la función pura de BR-PRICE-001. Se
 *                  importa DIRECTAMENTE porque no arrastra nada: no toca la base de
 *                  datos y no conoce el pedido. Es la garantía de que el precio del
 *                  pedido y el del menú son el mismo.
 *  - `inventory` -> el puerto `OrderStockGateway`, adaptado sobre
 *                  `InventoryRepository` en `order-gateways.sqlite.ts`. NO se
 *                  modifica el módulo de inventario.
 *  - `rentals` y `reservations` -> los puertos `OrderRentalGateway` y
 *                  `OrderReservationGateway`, también adaptados. Ninguno de esos
 *                  módulos se modifica.
 *  - `spaces` -> el puerto `OrderChairGateway`, que delega en
 *                  `SpacesService.occupyChair` y `releaseChairAfterRental` para no
 *                  saltarse `chair-state-machine.ts`.
 *  - `discounts` -> el `DiscountsService`, que es quien conoce los cupones.
 *  - `payments` -> los DOS puertos (`OrderPaymentWriter` y `OrderPaymentReader`),
 *                  construidos por `PaymentsService` para que el cobro del pedido y
 *                  el de `POST /payments` compartan una sola implementación.
 *
 * Los repositorios de `inventory`, `rentals` y `reservations` se construyen AQUÍ
 * porque sus contenedores también son locales (los escribió su propio agente) y
 * así este grafo no depende del orden en que el integrador los monte.
 *
 * ================================= MIGRACIÓN ================================
 * Cuando el integrador registre este módulo, el contenido de {@link buildOrders}
 * debe pasar a `build()` de `config/container.ts`.
 */
import { getContainer } from '../../config/container.js';
import type { Db } from '../../shared/database/connection.js';
import { SqliteInventoryRepository } from '../inventory/inventory.repository.sqlite.js';
import { SqliteRentalsRepository } from '../rentals/rentals.repository.sqlite.js';
import { SqliteReservationsRepository } from '../reservations/reservations.repository.sqlite.js';
import { SpacesService } from '../spaces/spaces.service.js';
import { SqliteSpacesRepository } from '../spaces/spaces.repository.sqlite.js';
import { getDiscountsServices } from '../discounts/discounts.container.js';
import { getPaymentsServices } from '../payments/payments.container.js';
import { SqliteOrderCatalogReader } from './order-catalog.repository.sqlite.js';
import type { OrderCatalogReader } from './order-catalog.repository.js';
import {
  InventoryOrderStockGateway,
  RentalsOrderRentalGateway,
  ReservationsOrderReservationGateway,
  SpacesOrderChairGateway,
} from './order-gateways.sqlite.js';
import type {
  OrderChairGateway,
  OrderRentalGateway,
  OrderReservationGateway,
  OrderStockGateway,
} from './order-gateways.js';
import { SqliteOrdersRepository } from './orders.repository.sqlite.js';
import type { OrdersRepository } from './orders.repository.js';
import { OrdersService, type OrderPaymentReader } from './orders.service.js';

/** Servicios del módulo `orders`. */
export interface OrdersServices {
  readonly orders: OrdersService;
  readonly repository: OrdersRepository;
  readonly catalog: OrderCatalogReader;
  readonly stock: OrderStockGateway;
  readonly rentals: OrderRentalGateway;
  readonly reservations: OrderReservationGateway;
  readonly chairs: OrderChairGateway;
}

let services: OrdersServices | null = null;

/** Construye el grafo del módulo con las implementaciones SQLite. */
function buildOrders(): OrdersServices {
  // Mismo servicio de auditoría que el resto de la aplicación: una sola fuente
  // de verdad para `audit_logs` y un solo `defaultBusinessId`.
  const audit = getContainer().services.audit;

  const orders: OrdersRepository = new SqliteOrdersRepository();
  const catalog: OrderCatalogReader = new SqliteOrderCatalogReader();

  // Puertos hacia los otros módulos. Los repositorios se construyen aquí porque
  // no guardan conexión y su contenedor también es local.
  const stock: OrderStockGateway = new InventoryOrderStockGateway(new SqliteInventoryRepository());
  const rentalsRepository = new SqliteRentalsRepository();
  const rentals: OrderRentalGateway = new RentalsOrderRentalGateway(rentalsRepository);
  const reservations: OrderReservationGateway = new ReservationsOrderReservationGateway(
    new SqliteReservationsRepository(),
  );
  const chairs: OrderChairGateway = new SpacesOrderChairGateway(
    new SpacesService(new SqliteSpacesRepository(), new SqliteReservationsRepository(), rentalsRepository, audit),
  );

  // El service de descuentos conecta el puerto de pedidos para poder cotizar un
  // cupón sobre el subtotal REAL (BR-DISC-001).
  const discounts = getDiscountsServices().discounts;

  // Los dos puertos de pagos los construye el propio módulo de pagos: así el
  // cobro del pedido y el de `POST /payments` no pueden divergir.
  //
  // El LECTOR se completa aquí, y no dentro del módulo de pagos, porque
  // `discount_redemptions` es una tabla de OTRO módulo: el pago la lee a través de
  // un puerto, y el punto donde ambos servicios coexisten es este grafo. Así
  // `payments` no depende de `discounts` y `orders` no depende del SQL de ninguno.
  const payments = getPaymentsServices().payments;
  const paymentReader: OrderPaymentReader = {
    ...payments.createOrderPaymentReader(),
    listAppliedDiscounts: (orderId: number, db?: Db) => discounts.appliedDiscountsOf(orderId, db),
  };

  return {
    orders: new OrdersService(
      orders,
      catalog,
      stock,
      rentals,
      reservations,
      chairs,
      discounts,
      payments.createOrderPaymentWriter(),
      paymentReader,
      audit,
    ),
    repository: orders,
    catalog,
    stock,
    rentals,
    reservations,
    chairs,
  };
}

/**
 * Servicios de pedidos, construidos en la primera llamada.
 *
 * `orders.routes.ts` lo llama UNA vez, al construir su controller.
 */
export function getOrdersServices(): OrdersServices {
  services ??= buildOrders();
  return services;
}
