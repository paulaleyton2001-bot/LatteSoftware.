/**
 * Puertos hacia los módulos de INVENTARIO, ALQUILERES, RESERVAS y ESPACIOS.
 *
 * ============================================================================
 * POR QUÉ NO SE IMPORTA SU REPOSITORIO
 * ============================================================================
 * El módulo de pedidos necesita cuatro cosas de otros módulos:
 *   1. Descontar stock al colocar un pedido (paso 3 de DESIGN.md 8.5).
 *   2. Leer el `total_minor` de un alquiler para sumarlo al pedido
 *      (BR-RENTAL-006) y para la reserva de un `CHAIR_RENTAL`.
 *   3. Asociar el pedido a la reserva (`chair_reservations.order_id`) y cerrarla
 *      al completar el pedido (BR-ORDER-015).
 *   4. Mover la silla a `OCCUPIED` al abrir sesión y a `CLEANING` al cerrarla.
 *
 * Sus repositorios ya exponen casi todo eso (`insertMovement`,
 * `setCurrentStock`, `findItemById`, `findById`, `attachOrder`), y se podría
 * importar `InventoryRepository` directamente. No se hace, por dos razones:
 *
 *  - **Acoplamiento de contrato.** `InventoryRepository` tiene 30 métodos; el
 *    pedido necesita 3. Acoplar el módulo a un contrato de 30 métodos ata su
 *    evolución al de inventario: cada método nuevo del inventario obligaría a
 *    tocar el pedido, y un test podría sustituir el inventario por un doble que
 *    no implemente los 27 métodos sobrantes.
 *  - **Regla de capa.** `InventoryService` guarda `setCurrentStock` como PRIVADO
 *    a propósito ("nadie más del módulo puede dejar el saldo sin su movimiento",
 *    BR-INV-001/005). Un pedido que lo llamara por debajo saltaría esa garantía.
 *    Aquí se usan las MISMAS primitivas del repositorio pero se escribe SIEMPRE
 *    el movimiento antes que el saldo, dentro de la transacción del pedido y en
 *    ese orden (BR-INV-010).
 *
 * La LECTURA de la silla, en cambio, sí la hace el propio módulo de pedidos con
 * su propio SQL (`OrdersRepository.findChairById`), por el mismo motivo que
 * `inventory`: leer una fila de `chairs` no necesita el contrato de 40 métodos
 * del módulo de espacios, y el aislamiento por negocio se resuelve con el
 * `JOIN` con `zones` que ya usa `spaces.repository.sqlite.ts`.
 *
 * Ninguno de los ficheros de esos cuatro módulos se modifica.
 */
import type { UserContext } from '../../shared/domain/index.js';
import type { RequestAuditMeta } from '../../shared/services/index.js';

/**
 * Tipo de la conexión de la transacción.
 *
 * Se declara ESTRUCTURAL y no como `Db` para que este fichero de puertos no
 * dependa del driver: el adaptador es quien traduce. La forma es la de
 * `better-sqlite3`: `prepare` devuelve algo con `get`, `all` y `run`.
 */
export interface DbLike {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  };
}

/**
 * Ajustes de stock del negocio.
 *
 * El LECTOR de `inventory_items` NO vive aquí sino en `OrderCatalogReader`: el
 * repositorio de inventario no tiene "buscar el ítem de un producto" y encadenar
 * su `findProductRef` con su `findItemById` sólo funciona por casualidad (el
 * primero devuelve la fila de `products`, no la del ítem). La lectura está en el
 * catálogo de pedidos y este puerto sólo ESCRIBE, que es lo que sí está resuelto
 * con las primitivas públicas del repositorio de inventario.
 */
export interface OrderStockSettings {
  /** `businesses.allow_negative_stock` (BR-INV-002). */
  readonly allowNegativeStock: boolean;
}

/** Tipos de movimiento que genera el flujo de pedidos. */
export const ORDER_MOVEMENT_TYPES = ['RESERVATION', 'RELEASE', 'SALE'] as const;
export type OrderMovementType = (typeof ORDER_MOVEMENT_TYPES)[number];

/** Datos de un movimiento de inventario que genera un pedido. */
export interface OrderStockMovement {
  readonly businessId: number;
  readonly inventoryItemId: number;
  /**
   * `RESERVATION` al colocar el pedido, `RELEASE` al cancelarlo o al quitar una
   * línea, `SALE` al completarlo. La secuencia `RESERVATION -> (SALE|RELEASE)`
   * es la única válida (BR-INV-004).
   */
  readonly movementType: OrderMovementType;
  /** Con signo: negativo resta, positivo suma. Nunca 0 (CHECK). */
  readonly quantity: number;
  /** Saldo ya aplicado, calculado por el gateway DENTRO de la transacción. */
  readonly balanceAfter: number;
  readonly unitCostMinor: number | null;
  /** Siempre `'ORDER'`: los pedidos son la única referencia que genera stock. */
  readonly referenceType: 'ORDER';
  readonly referenceId: number;
  readonly reason: string | null;
  readonly performedBy: number | null;
}

/** Lo que el módulo de pedidos necesita del de inventario. */
export interface OrderStockGateway {
  /** Ajustes de stock del negocio. `null` si `businesses` no está sembrada. */
  findSettings(businessId: number, db?: DbLike): OrderStockSettings | null;
  /**
   * Escribe el movimiento Y el saldo, en ese orden, con `balanceAfter` real.
   *
   * El saldo ANTES se lee aquí DENTRO de la transacción, aunque quien lo pasó
   * como dato (`balanceAfter`) ya lo calculó: es el servicio de inventario quien
   * valida y quien decide, y leerlo dos veces en la misma transacción no cuesta
   * nada y evita depender de un valor calculado fuera del lock.
   */
  applyMovement(movement: OrderStockMovement, db?: DbLike): void;
}

/** Alquiler mínimo que necesita el pedido (BR-RENTAL-006). */
export interface OrderRentalRef {
  readonly id: number;
  readonly chair_id: number;
  readonly reservation_id: number | null;
  readonly customer_id: number | null;
  readonly status: string;
  /** `subtotal + extensions + extra`, sin impuesto: lo suma el pedido. */
  readonly total_minor: number;
  readonly billed_minutes: number;
  readonly start_at: string;
  readonly end_at: string;
  readonly extra_minutes_minor: number;
}

/** Lo que el módulo de pedidos necesita del de alquileres. */
export interface OrderRentalGateway {
  /** Alquiler por id, acotado al negocio. `null` si no existe. */
  findById(rentalId: number, businessId: number, db?: DbLike): OrderRentalRef | null;
  /** Alquileres de una reserva: el check-in puede no haber guardado `rental_id`. */
  listByReservation(reservationId: number, db?: DbLike): readonly OrderRentalRef[];
  /**
   * Cierre de la sesión (BR-ORDER-015): marca el alquiler `COMPLETED` con los
   * minutos reales. Delega en `RentalsRepository.close`, que es la única puerta.
   */
  close(
    rentalId: number,
    billedMinutes: number,
    extraMinutesMinor: number,
    totalMinor: number,
    db?: DbLike,
  ): void;
}

/** Reserva mínima que necesita el pedido. */
export interface OrderReservationRef {
  readonly id: number;
  readonly chair_id: number;
  readonly customer_id: number | null;
  readonly status: string;
  readonly code: string;
  /** Proyección del alquiler, útil si el alquiler aún no arrancó. */
  readonly rental_total_minor: number;
}

/** Lo que el módulo de pedidos necesita del de reservas. */
export interface OrderReservationGateway {
  /** Reserva por id, acotada al negocio. `null` si no existe. */
  findById(reservationId: number, businessId: number, db?: DbLike): OrderReservationRef | null;
  /**
   * Asocia el pedido a la reserva (`chair_reservations.order_id`).
   *
   * El método existe YA en `ReservationsRepository` (`attachOrder`) y está
   * documentado allí como "lo usa el módulo de pedidos": este puerto lo expone
   * sin tocar ese fichero.
   */
  attachOrder(reservationId: number, orderId: number, db?: DbLike): void;
  /** `ACTIVE -> COMPLETED` con su `checked_out_at` (BR-ORDER-015). */
  markCheckedOut(reservationId: number, checkedOutAt: string, db?: DbLike): void;
}

/** Estados de silla que el pedido puede pedir al módulo de espacios. */
export type ChairStatusTarget = 'OCCUPIED' | 'CLEANING';

/**
 * Contexto que el módulo de espacios exige para sus operaciones de estado.
 *
 * Es el `UserContext` real del actor de la petición más sus metadatos de red,
 * porque `SpacesService.occupyChair` y `releaseChairAfterRental` los usan tal
 * cual para acotar el negocio (`chair.zone_id -> zones.business_id`) y para
 * auditar el cambio de silla con el usuario que realmente lo hizo.
 */
export interface OrderChairTransitionContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Lo que el módulo de pedidos necesita del de espacios. */
export interface OrderChairGateway {
  /**
   * Pone la silla `OCCUPIED` validando `chair-state-machine.ts` y auditando.
   *
   * No se escribe `chairs.status` a pelo: `shared/domain/chair-state-machine.ts`
   * es la fuente única y saltársela dejaría al pedido como único lugar del
   * sistema capaz de ocupar una silla sin validación.
   *
   * @returns `true` si la silla quedó `OCCUPIED`; `false` si la transición
   *          está prohibida desde su estado actual, para que el service decida
   *          si eso es un 409 o un no-op.
   */
  occupy(chairId: number, context: OrderChairTransitionContext, db?: DbLike): boolean;
  /**
   * Cierre de sesión: `OCCUPIED -> CLEANING` (BR-RENTAL-008).
   *
   * Es idempotente: si la silla no estaba `OCCUPIED` (otra operación la movió
   * mientras tanto), devuelve `false` sin escribir nada.
   */
  releaseAfterSession(chairId: number, context: OrderChairTransitionContext, db?: DbLike): boolean;
}
