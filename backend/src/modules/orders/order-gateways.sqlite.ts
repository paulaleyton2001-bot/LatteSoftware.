/**
 * Adaptadores de los puertos de `order-gateways.ts` sobre los repositorios y
 * servicios que YA EXISTEN en el sistema.
 *
 * ============================================================================
 * QUÉ SE ADAPTA Y QUÉ NO SE TOCA
 * ============================================================================
 *  - `InventoryRepository`  (módulo `inventory`) — cumple el puerto: expone
 *    `findBusinessSettings`, `findProductRef` (que devuelve el `product_id`
 *    ligado de un ítem) y `findItemById`. Sus métodos aceptan la conexión como
 *    último parámetro, así que participan en la transacción del pedido sin
 *    cambiar una línea de ese fichero.
 *  - `RentalsRepository`   (módulo `rentals`) — cumple el puerto: `findById`,
 *    `listByReservation` y `close` existen con esas firmas exactas.
 *  - `ReservationsRepository` (módulo `reservations`) — cumple el puerto:
 *    `findById` y `attachOrder` existen, y `attachOrder` está documentado en su
 *    propio repositorio como "lo usa el módulo de pedidos".
 *  - `SpacesService`       (módulo `spaces`) — aporta `occupyChair` y
 *    `releaseChairAfterRental`, la ÚNICA puerta válida a `OCCUPIED` y a
 *    `CLEANING` (BR-CHAIR-003), y además auditan el cambio.
 *
 * NINGUNO de esos ficheros se modifica. Éste sólo traduce formas: fila larga ->
 * fila corta, y `0|1` -> `boolean`.
 *
 * ============================================================================
 * EL ORDEN DE LAS ESCRITURAS DE INVENTARIO
 * ============================================================================
 * `InventoryService` mantiene `setCurrentStock` privado para garantizar que todo
 * cambio de saldo tenga un movimiento que lo justifique (BR-INV-001, BR-INV-005,
 * BR-INV-010). Como el pedido necesita llamar a esas dos primitivas, este
 * adaptador reproduce EXACTAMENTE su orden y su invariante:
 *
 *   1. Leer el saldo DENTRO de la transacción.
 *   2. Calcular `balanceAfter` y validar BR-INV-002.
 *   3. INSERTAR el movimiento.
 *   4. Actualizar el saldo.
 *
 * Si el paso 4 fallara, el `throw` revierte el movimiento: nunca queda un
 * movimiento sin saldo que lo respalde, que es la garantía de BR-INV-010.
 */
import { BusinessRuleError } from '../../shared/errors/index.js';
import { roundHalfUp } from '../../shared/utils/money.js';
import {
  InventoryReferenceType,
  MovementType,
  type InventoryReferenceType as InventoryReferenceTypeValue,
} from '../../shared/domain/index.js';
import type { Db } from '../../shared/database/connection.js';
import type { InventoryRepository } from '../inventory/inventory.repository.js';
import type { RentalsRepository } from '../rentals/rentals.repository.js';
import type { ReservationsRepository } from '../reservations/reservations.repository.js';
import type { SpacesService } from '../spaces/spaces.service.js';
import type { RentalsService } from '../rentals/rentals.service.js';
import type {
  DbLike,
  OrderChairGateway,
  OrderChairTransitionContext,
  OrderRentalSettlement,
  OrderRentalSettlementResult,
  OrderRentalGateway,
  OrderRentalRef,
  OrderReservationGateway,
  OrderReservationRef,
  OrderSessionActorContext,
  OrderStockGateway,
  OrderStockMovement,
  OrderStockSettings,
} from './order-gateways.js';

/** Redondeo de existencias: las cantidades de stock admiten 3 decimales. */
function roundStock(value: number): number {
  return roundHalfUp(value * 1000) / 1000;
}

/** Traduce el tipo de movimiento del pedido al enum del dominio compartido. */
function toMovementType(value: OrderStockMovement['movementType']): MovementType {
  switch (value) {
    case 'RESERVATION':
      return MovementType.RESERVATION;
    case 'RELEASE':
      return MovementType.RELEASE;
    case 'SALE':
      return MovementType.SALE;
    default:
      return MovementType.RESERVATION;
  }
}

/** Adaptador del puerto de inventario sobre `InventoryRepository`. */
export class InventoryOrderStockGateway implements OrderStockGateway {
  public constructor(private readonly inventory: InventoryRepository) {}

  public findSettings(businessId: number, db?: DbLike): OrderStockSettings | null {
    const row = this.inventory.findBusinessSettings(businessId, db as Db | undefined);
    if (row === null) {
      return null;
    }
    return { allowNegativeStock: row.allow_negative_stock === 1 };
  }

  public applyMovement(movement: OrderStockMovement, db?: DbLike): void {
    const connection = db as Db | undefined;
    // 1. Saldo DENTRO de la transacción: otro escritor no puede cambiarlo entre
    //    esta lectura y el UPDATE, porque `BEGIN IMMEDIATE` tiene el lock.
    const current = this.inventory.findItemById(
      movement.inventoryItemId,
      movement.businessId,
      connection,
    );
    if (current === null) {
      throw new BusinessRuleError('El ítem de inventario del producto ya no existe', {
        details: { code: 'INVENTORY_ITEM_MISSING', inventoryItemId: movement.inventoryItemId },
      });
    }
    if (current.is_tracked === 0) {
      throw new BusinessRuleError('El ítem no tiene seguimiento de stock', {
        details: {
          code: 'ITEM_NOT_TRACKED',
          ruleId: 'BR-INV-007',
          id: current.id,
          hint: 'Un producto con isTracked = 0 no genera movimientos',
        },
      });
    }

    // 2. `balance_after` es el saldo YA aplicado, y la validación de stock
    //    negativo ocurre aquí con el mismo criterio que el servicio de inventario.
    const balanceAfter = roundStock(current.current_stock + movement.quantity);
    if (balanceAfter < 0) {
      const settings = this.findSettings(movement.businessId, connection);
      if (settings === null || !settings.allowNegativeStock) {
        throw new BusinessRuleError('No hay existencias suficientes del producto', {
          details: {
            code: 'NEGATIVE_STOCK_BLOCKED',
            ruleId: 'BR-INV-002',
            inventoryItemId: current.id,
            productName: current.name,
            available: current.current_stock,
            requested: Math.abs(movement.quantity),
          },
        });
      }
    }

    // 3. Movimiento.
    this.inventory.insertMovement(
      {
        businessId: movement.businessId,
        inventoryItemId: movement.inventoryItemId,
        movementType: toMovementType(movement.movementType),
        quantity: movement.quantity,
        balanceAfter,
        unitCostMinor: movement.unitCostMinor,
        referenceType: movement.referenceType as InventoryReferenceTypeValue,
        referenceId: movement.referenceId,
        reason: movement.reason,
        performedBy: movement.performedBy,
      },
      connection,
    );
    // 4. Saldo. Si este paso fallara, el `throw` revierte el movimiento.
    this.inventory.setCurrentStock(movement.inventoryItemId, balanceAfter, connection);
  }
}

/** Fila larga de alquileres -> forma corta que consume el pedido. */
function toRentalRef(row: {
  readonly id: number;
  readonly chair_id: number;
  readonly reservation_id: number | null;
  readonly customer_id: number | null;
  readonly status: string;
  readonly total_minor: number;
  readonly billed_minutes: number;
  readonly start_at: string;
  readonly end_at: string;
  readonly extra_minutes_minor: number;
}): OrderRentalRef {
  return {
    id: row.id,
    chair_id: row.chair_id,
    reservation_id: row.reservation_id,
    customer_id: row.customer_id,
    status: row.status,
    total_minor: row.total_minor,
    billed_minutes: row.billed_minutes,
    start_at: row.start_at,
    end_at: row.end_at,
    extra_minutes_minor: row.extra_minutes_minor,
  };
}

/** Adaptador del puerto de alquileres sobre `RentalsRepository`. */
export class RentalsOrderRentalGateway implements OrderRentalGateway {
  public constructor(private readonly rentals: RentalsRepository) {}

  public findById(rentalId: number, businessId: number, db?: DbLike): OrderRentalRef | null {
    const row = this.rentals.findById(rentalId, businessId, db as Db | undefined);
    return row === null ? null : toRentalRef(row);
  }

  public listByReservation(reservationId: number, db?: DbLike): readonly OrderRentalRef[] {
    return this.rentals
      .listByReservation(reservationId, db as Db | undefined)
      .map((row) => toRentalRef(row));
  }

  public close(
    rentalId: number,
    billedMinutes: number,
    extraMinutesMinor: number,
    totalMinor: number,
    db?: DbLike,
  ): void {
    this.rentals.close(
      rentalId,
      { status: 'COMPLETED', billedMinutes, extraMinutesMinor, totalMinor },
      db as Db | undefined,
    );
  }
}

/** Adaptador del puerto de reservas sobre `ReservationsRepository`. */
export class ReservationsOrderReservationGateway implements OrderReservationGateway {
  public constructor(private readonly reservations: ReservationsRepository) {}

  public findById(reservationId: number, businessId: number, db?: DbLike): OrderReservationRef | null {
    const row = this.reservations.findById(reservationId, businessId, db as Db | undefined);
    if (row === null) {
      return null;
    }
    return {
      id: row.id,
      chair_id: row.chair_id,
      customer_id: row.customer_id,
      status: row.status,
      code: row.code,
      rental_total_minor: row.rental_total_minor,
    };
  }

  public attachOrder(reservationId: number, orderId: number, db?: DbLike): void {
    this.reservations.attachOrder(reservationId, orderId, db as Db | undefined);
  }

  public markCheckedOut(reservationId: number, checkedOutAt: string, db?: DbLike): void {
    this.reservations.markCheckedOut(reservationId, 'COMPLETED', checkedOutAt, db as Db | undefined);
  }
}

/**
 * Adaptador del puerto de sillas sobre `SpacesService`.
 *
 * No escribe `chairs.status`: delega en los dos métodos del módulo de espacios
 * que validan `chair-state-machine.ts` y auditan. `BusinessRuleError` se
 * traduce a `false` porque hay transiciones que son un NO-OP legítimo (una silla
 * que otra operación movió a `RESERVED` mientras el pedido avanzaba) y otras que
 * son un error de negocio real (silla `BLOCKED`), y la diferencia la decide el
 * service de pedidos con el estado que devuelve la consulta, no el adaptador.
 */
export class SpacesOrderChairGateway implements OrderChairGateway {
  public constructor(private readonly spaces: SpacesService) {}

  public occupy(chairId: number, context: OrderChairTransitionContext, db?: DbLike): boolean {
    return this.run(chairId, context, db, 'OCCUPIED');
  }

  public releaseAfterSession(
    chairId: number,
    context: OrderChairTransitionContext,
    db?: DbLike,
  ): boolean {
    return this.run(chairId, context, db, 'CLEANING');
  }

  /** Ejecuta la transición que corresponda y aísla el error de máquina de estados. */
  private run(
    chairId: number,
    context: OrderChairTransitionContext,
    db: DbLike | undefined,
    target: 'OCCUPIED' | 'CLEANING',
  ): boolean {
    try {
      if (target === 'OCCUPIED') {
        this.spaces.occupyChair(chairId, this.toSpacesContext(context), db as Db);
        return true;
      }
      const result = this.spaces.releaseChairAfterRental(chairId, this.toSpacesContext(context), db as Db);
      return result.status === 'CLEANING';
    } catch (error) {
      if (error instanceof BusinessRuleError) {
        return false;
      }
      throw error;
    }
  }

  /** Traduce el contexto del puerto al que espera `SpacesService`. */
  private toSpacesContext(context: OrderChairTransitionContext) {
    return { actor: context.actor, request: context.request };
  }
}

/**
 * Adaptador del cierre de alquiler sobre `RentalsService`.
 *
 * ============================================================================
 * POR QUÉ ESTE ADAPTADOR Y NO `RentalsRepository.close`
 * ============================================================================
 * `RentalsOrderRentalGateway.close` escribe cuatro columnas de `chair_rentals` y
 * nada más. Para BR-ORDER-015 eso NO basta: el cierre tiene que recalcular los
 * minutos facturados y el overage al precio congelado (BR-RENTAL-001..004),
 * liberar la silla a `CLEANING` (BR-RENTAL-008) y auditar. `RentalsService` es
 * quien tiene esa lógica, y su núcleo privado `closeLiveRental` lo comparte con
 * `POST /rentals/:id/complete` y con el check-out de reservas: delegar aquí es lo
 * que garantiza que el cobro del POS y el cierre a mano cobren la misma sesión
 * con la misma aritmética.
 *
 * El método delega además la IDEMPOTENCIA: `completeForOrder` no falla si el
 * alquiler ya estaba cerrado, y devuelve `closed: false` para que quien llama lo
 * pueda registrar.
 */
export class RentalsOrderRentalSettlement implements OrderRentalSettlement {
  public constructor(private readonly rentals: RentalsService) {}

  public closeForOrder(
    params: {
      readonly rentalId: number;
      readonly businessId: number;
      readonly orderId: number;
      readonly endedAt: string;
    },
    context: OrderSessionActorContext,
    db: DbLike,
  ): OrderRentalSettlementResult {
    const connection = db as Db;
    const row = this.rentals.findRentalRow(params.rentalId, params.businessId, connection);
    if (row === null) {
      // El alquiler se borró o es de otro negocio. No es un error: el pedido se
      // completó igual y la silla se liberó por su cuenta. Lo que no se puede es
      // inventar un cobro de algo que no existe.
      return { closed: false, billedMinutes: null, totalMinor: null };
    }
    const result = this.rentals.completeForOrder(
      row,
      params.endedAt,
      { actor: context.actor, request: context.request },
      connection,
      params.orderId,
    );
    return {
      closed: result.closed,
      billedMinutes: result.rentalRow.billed_minutes,
      totalMinor: result.rentalRow.total_minor,
    };
  }
}

/** `true` si el enum de referencia de inventario es el esperado. */
export function isOrderInventoryReference(value: string): value is InventoryReferenceType {
  return value === InventoryReferenceType.ORDER;
}
