/**
 * LIQUIDACIÓN DE SESIÓN: el efecto secundario de `orders.status = 'COMPLETED'`
 * (BR-ORDER-015).
 *
 * ============================================================================
 * EL BUG QUE ESTE FICHERO ARREGLA
 * ============================================================================
 * `orders` tiene DOS escritores de su estado, y sólo uno hacía la liquidación:
 *
 *   1. `OrdersService.transition()` — la usa `POST /orders/:id/status`. Llamaba a
 *      `applyStatusSideEffects`, que cierra el alquiler, hace el check-out de la
 *      reserva y manda la silla a `CLEANING`.
 *   2. `PaymentsService.maybeCompleteOrder()` — la usa `POST /payments`, que es
 *      el camino real del POS. Escribía el estado con un `UPDATE` directo y se
 *      saltaba `applyStatusSideEffects` por completo.
 *
 * El resultado era que, tras cobrar un pedido `CHAIR_RENTAL` en el mostrador, el
 * pedido quedaba `COMPLETED` y pagado, el alquiler se quedaba `ACTIVE` para
 * siempre y la silla `OCCUPIED`: el cliente no podía volver a usarla y nadie
 * podía cerrar la sesión. DESIGN.md 6.1 no distingue entre las dos puertas — la
 * columna "Efecto secundario" de `READY|DELIVERING -> COMPLETED` dice, sin
 * condiciones, "si es `CHAIR_RENTAL` cierra reserva y alquiler; libera la silla
 * a `CLEANING`" — así que el cobro estaba incompleto, no era una excepción.
 *
 * ============================================================================
 * LA SOLUCIÓN: UNA SOLA LIQUIDACIÓN, DOS LLAMANTES
 * ============================================================================
 * Este fichero es la ÚNICA implementación de BR-ORDER-015, y la comparten:
 *   - `OrdersService.applyStatusSideEffects` (el `POST /orders/:id/status`), y
 *   - `PaymentsService.maybeCompleteOrder` (el `POST /payments`, vía el puerto
 *     `OrderSessionSettlement`).
 *
 * Los dos escriben el estado del pedido con su propia transacción y luego llaman
 * aquí DENTRO de ella, así que el cierre del alquiler, el check-out de la
 * reserva y la liberación de la silla son parte del MISMO commit que el estado del
 * pedido y que el cobro (DESIGN.md 8.4: o queda todo, o no queda nada). Si el
 * cierre del alquiler falla, el cobro tampoco queda: no existe el estado "cobrado
 * y con la silla secuestrada".
 *
 * ============================================================================
 * POR QUÉ ES UN PUERTO Y NO UNA LLAMADA DIRECTA
 * ============================================================================
 * El módulo de pagos y el de pedidos se constructions mutuamente: el service de
 * pagos da al de pedidos los puertos de cobro (`OrderPaymentWriter` y
 * `OrderPaymentReader`), así que si el de pagos importara el service de pedidos
 * para llamar a `applyStatusSideEffects` el grafo dejaría de ser un DAG. Lo que
 * se declara aquí es un PUERTO, y el grafo (`orders.container.ts`) inyecta la
 * implementación. `payments.service.ts` sólo importa el TIPO con `import type`,
 * que el compilador borra: no hay ningún `import` en tiempo de ejecución entre
 * los dos módulos.
 */
import type { Db } from '../../shared/database/connection.js';
import type {
  OrderChairGateway,
  OrderChairTransitionContext,
  OrderRentalSettlement,
  OrderReservationGateway,
} from './order-gateways.js';
import { ReservationStatus } from '../../shared/domain/index.js';
import { logger } from '../../shared/logger/index.js';

/**
 * La sesión que hay que cerrar al completarse un pedido.
 *
 * Es un subconjunto de `orders`, no la fila entera: el módulo de pagos sólo
 * necesita saber QUÉ sesión estaba asociada al pedido que acaba de cobrar.
 */
export interface SessionSettlementTarget {
  readonly orderId: number;
  readonly businessId: number;
  /** Silla de la sesión. Un `DINE_IN` puede no tener (BR-ORDER-009). */
  readonly chairId: number | null;
  /** Reserva asociada. `null` en un alquiler walk-in sin reserva previa. */
  readonly reservationId: number | null;
  /** Alquiler asociado. `null` si el pedido no factura una sesión. */
  readonly rentalId: number | null;
}

/** Contexto de auditoría: el actor de la petición y sus metadatos de red. */
export type SessionSettlementContext = OrderChairTransitionContext;

/** Qué se ha liquidado de verdad, para el log y para las aserciones. */
export interface SessionSettlementResult {
  /** `true` si la silla pasó de `OCCUPIED` a `CLEANING` con esta llamada. */
  readonly chairReleased: boolean;
  /** `true` si la reserva estaba `ACTIVE` y se hizo check-out. */
  readonly reservationCheckedOut: boolean;
  /** `true` si el alquiler estaba vivo y se cerró con su cobro. */
  readonly rentalClosed: boolean;
  /** Minutos facturados del alquiler cerrado. `null` si no se cerró. */
  readonly billedMinutes: number | null;
  /** Total del alquiler cerrado. `null` si no se cerró. */
  readonly rentalTotalMinor: number | null;
}

/** Lo que el módulo de pagos (y el de pedidos) necesitan de esta liquidación. */
export interface OrderSessionSettlement {
  /**
   * Cierra la sesión de un pedido que acaba de pasar a `COMPLETED`.
   *
   * @param at Instante del cierre. Es el MISMO que el `completed_at` del pedido,
   *            para que `chair_rentals` y `orders` no tengan dos relojes.
   * @param db Transacción del llamante. Todo lo que se escriba aquí entra en su
   *           commit; si algo falla, el llamador revierte el cobro entero.
   */
  settleCompletedOrder(
    target: SessionSettlementTarget,
    context: SessionSettlementContext,
    at: string,
    db: Db,
  ): SessionSettlementResult;
}

/** Resultado neutro: un pedido sin sesión no tiene nada que liquidar. */
const NOTHING_SETTLED: SessionSettlementResult = Object.freeze({
  chairReleased: false,
  reservationCheckedOut: false,
  rentalClosed: false,
  billedMinutes: null,
  rentalTotalMinor: null,
});

/**
 * Única implementación de BR-ORDER-015.
 *
 * Sólo conoce PUERTOS: nunca importa el repositorio de alquileres, el de
 * reservas ni el de espacios. Eso es lo que permite que el mismo objeto se
 * inyecte en el service de pedidos y en el de pagos sin que ninguno dependa del
 * grafo del otro.
 */
export class SqliteOrderSessionSettlement implements OrderSessionSettlement {
  public constructor(
    private readonly rentals: OrderRentalSettlement,
    private readonly reservations: OrderReservationGateway,
    private readonly chairs: OrderChairGateway,
  ) {}

  public settleCompletedOrder(
    target: SessionSettlementTarget,
    context: SessionSettlementContext,
    at: string,
    db: Db,
  ): SessionSettlementResult {
    // Un pedido sin silla, sin reserva y sin alquiler no tiene sesión que cerrar:
    // es el caso normal de un `TAKEAWAY` y no se escribe nada (ni una fila de
    // audit, ni un `UPDATE`). Es lo que hace que este puerto sea seguro de
    // inyectar en el cobro de CUALQUIER pedido.
    if (target.chairId === null && target.reservationId === null && target.rentalId === null) {
      return NOTHING_SETTLED;
    }

    // --- 1. La silla a `CLEANING` -------------------------------------------
    // Primero, y con la transición de la máquina de estados (BR-CHAIR-003 y
    // BR-RENTAL-008): `OCCUPIED -> CLEANING` es el único final válido del cierre
    // de un alquiler o de una reserva. Es idempotente: si otra operación ya la
    // movió, no escribe nada. Un `DINE_IN` con silla pasa por aquí igual
    // (BR-ORDER-015).
    let chairReleased = false;
    if (target.chairId !== null) {
      chairReleased = this.chairs.releaseAfterSession(target.chairId, context, db);
    }

    // --- 2. Check-out de la reserva ------------------------------------------
    // Sólo si estaba `ACTIVE`. Una reserva `CONFIRMED` de un alquiler walk-in no
    // se ha marcado en `orders` y cerrarla aquí saltaría la máquina de estados de
    // reservas (DESIGN.md 6.2), que sólo admite `ACTIVE -> COMPLETED`.
    let reservationCheckedOut = false;
    if (target.reservationId !== null) {
      const reservation = this.reservations.findById(target.reservationId, target.businessId, db);
      if (reservation !== null && reservation.status === ReservationStatus.ACTIVE) {
        this.reservations.markCheckedOut(target.reservationId, at, db);
        reservationCheckedOut = true;
      }
    }

    // --- 3. Cierre del alquiler con su cobro real ----------------------------
    // Aquí está la diferencia con el bug: el cierre pasa por `RentalsService`, que
    // recalcula `billed_minutes = max(30, ceil((cierre - apertura)))` y el overage
    // al precio CONGELADO (BR-RENTAL-001..004) y libera la silla. El `UPDATE` de
    // cuatro columnas que hacía el pedido antes dejaba el alquiler `COMPLETED`
    // con `billed_minutes = 0`, que el propio documento de diseño prohíbe
    // ("`billed_minutes >= 30` siempre", DESIGN.md 6.3).
    let rentalClosed = false;
    let billedMinutes: number | null = null;
    let rentalTotalMinor: number | null = null;
    if (target.rentalId !== null) {
      const result = this.rentals.closeForOrder(
        {
          rentalId: target.rentalId,
          businessId: target.businessId,
          orderId: target.orderId,
          endedAt: at,
        },
        context,
        db,
      );
      rentalClosed = result.closed;
      billedMinutes = result.billedMinutes;
      rentalTotalMinor = result.totalMinor;
    }

    if (chairReleased || reservationCheckedOut || rentalClosed) {
      logger.info(
        {
          orderId: target.orderId,
          chairId: target.chairId,
          reservationId: target.reservationId,
          rentalId: target.rentalId,
          chairReleased,
          reservationCheckedOut,
          rentalClosed,
          billedMinutes,
          rentalTotalMinor,
        },
        'pedidos: sesión liquidada al completarse el pedido (BR-ORDER-015)',
      );
    }

    return { chairReleased, reservationCheckedOut, rentalClosed, billedMinutes, rentalTotalMinor };
  }
}
