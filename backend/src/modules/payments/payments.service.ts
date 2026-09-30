/**
 * Servicio de pagos (API.md 7.13, DESIGN.md 6.5 y 7.10).
 *
 * ============================================================================
 * DECISIÓN DEL CLIENTE: NO HAY PASARELA DE PAGOS
 * ============================================================================
 * El negocio cobra TODO en el local: efectivo en la caja o tarjeta en el
 * datáfono, y el cajero registra el cobro a mano. En consecuencia, y eso es lo
 * que define la forma de todo este fichero:
 *
 *  - Los únicos métodos son `CASH` y `CARD`. No hay `PaymentProvider` como
 *    abstracción, ni cliente HTTP, ni webhook, ni cola de reintentos, ni job de
 *    reconciliación con un tercero. NO se implementa Stripe, Mercado Pago,
 *    Wompi ni PayU: el único `provider` real es `CASH_REGISTRY` (la caja).
 *
 *    SOBRE EL `provider` DEL COBRO CON TARJETA: el enunciado de esta fase nombra
 *    `CARD_TERMINAL` (el datáfono), pero ese valor NO existe en el esquema
 *    congelado: ni en `shared/domain/enums.ts` (`PaymentProvider` tiene
 *    `CASH_REGISTRY`, `STRIPE`, `MERCADOPAGO`, `WOMPI` y `PAYU`), ni en el CHECK
 *    `ck_payments_provider` de `0001_init.sql`, ni en `DESIGN.md` 4.6. Esos tres
 *    ficheros están fuera del alcance de esta fase, así que NO se inventa el
 *    valor: el cobro con datáfono se registra con `method = 'CARD'` y
 *    `provider = NULL`, y lo identifica el `provider_reference` OBLIGATORIO (el
 *    número de aprobación que anota el cajero), que es además mejor dato para
 *    conciliar que un `provider` inventado. La migración que añadiría
 *    `CARD_TERMINAL` está en el informe de entrega.
 *  - El cobro es LOCAL y SÍNCRONO: el `INSERT` del pago y el `UPDATE` del pedido
 *    ocurren en la MISMA transacción `BEGIN IMMEDIATE`, y el pago pasa a `APPROVED`
 *    en esa misma transacción (BR-PAY-011). No existe el caso "cobro aceptado y
 *    commit local fallido", porque no hay nadie que acepte nada: el cajero sí lo
 *    hizo, y si el commit falla se le avisa para que devuelva el dinero.
 *  - `provider_reference` es la referencia que ANOTA el cajero: el número de
 *    aprobación del datáfono o los últimos cuatro dígitos. NO es un PAN y no se
 *    trata como uno (BR-SEC-006). Tampoco se marca como sensible en el audit log:
 *    es el dato que hace falta para conciliar, no una credencial.
 *
 * ============================================================================
 * LAS REGLAS QUE APLICA
 * ============================================================================
 *  - **BR-PAY-001** Idempotencia por cabecera `Idempotency-Key`. Se busca DENTRO
 *    de la transacción, antes y después del `INSERT`: si la clave ya existe se
 *    devuelve el MISMO pago con `200`, sin cobrar de nuevo. Dos reintentos
 *    simultáneos no pueden cobrar dos veces porque `ux_payments_idempotency` es un
 *    índice único.
 *  - **BR-PAY-002** Todo pago tiene `order_id` en v1.
 *  - **BR-PAY-003** `CASH` no exige `provider`; `CARD` sí, y es el datáfono.
 *  - **BR-PAY-004** No se cobra un pedido `CANCELLED` ni `REFUNDED`.
 *  - **BR-PAY-005/BR-MONEY-007/008** En efectivo el exceso es CAMBIO, nunca un
 *    favor: se imputa el saldo y se devuelve el resto, sin guardarlo como pago.
 *    Con datáfono el exceso se rechaza con `PAYMENT_EXCEEDS_TOTAL`.
 *  - **BR-PAY-006** El reembolso no puede superar `amount_minor - refunded_minor`,
 *    comprobado en la misma transacción que el `INSERT` del reembolso.
 *  - **BR-PAY-008** Un pago que deja el saldo en 0 completa el pedido y libera
 *    silla y alquiler.
 *  - **BR-PAY-012** `refunded_minor` lo DERIVA el repositorio de la suma de
 *    `payment_refunds`; la API nunca lo escribe.
 *  - **BR-MONEY-009** La propina NO entra en `total_minor`: se registra aparte y
 *    se devuelve para que el total del pedido siga siendo contablemente correcto.
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import type { Db } from '../../shared/database/connection.js';
import {
  AuditAction,
  AuditEntityType,
  OrderStatus,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  Role,
  assertPaymentTransition,
} from '../../shared/domain/index.js';
import type { UserContext } from '../../shared/domain/index.js';
import { BusinessRuleError, ConflictError, DatabaseError, NotFoundError } from '../../shared/errors/index.js';
import { generatePaymentNumber } from '../../shared/utils/codes.js';
import { nowIso } from '../../shared/utils/datetime.js';
import { addMinor } from '../../shared/utils/money.js';
import { logger } from '../../shared/logger/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { settleCashPayment } from '../orders/order-pricing.js';
import type { OrderPaymentReader, OrderPaymentWriter } from '../orders/orders.service.js';
import type {
  AppliedDiscountView,
  OrderPaymentView,
  OrderRefundView,
} from '../orders/orders.types.js';
import type {
  NewPaymentRecord,
  PaymentBusinessSettingsRow,
  PaymentListFilter,
  PaymentOrderRow,
  PaymentRow,
  PaymentsRepository,
} from './payments.repository.js';
import type {
  PaymentDetailView,
  PaymentMethodView,
  PaymentPage,
  PaymentSummaryView,
  PaymentView,
  RefundResult,
  RegisterPaymentResult,
} from './payments.types.js';

/** Contexto de petición: actor (del token) y datos de red para la auditoría. */
export interface PaymentsRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Fuente de los descuentos aplicados que el detalle del pedido expone. */
export interface AppliedDiscountReader {
  /** Descuentos canjeados por un pedido, leídos de `discount_redemptions`. */
  appliedDiscountsOf(orderId: number, db?: Db): readonly AppliedDiscountView[];
}

/**
 * ============================================================================
 * POR QUÉ EL COBRO NECESITA UN PUERTO HACIA EL MÓDULO DE PEDIDOS
 * ============================================================================
 * `POST /payments` auto-completa el pedido cuando el saldo queda en cero
 * (BR-PAY-008), y esa transición —`... -> COMPLETED`— tiene efectos secundarios
 * obligatorios (BR-ORDER-015): si el pedido es un `CHAIR_RENTAL`, se cierra el
 * alquiler y la reserva, y la silla pasa a `CLEANING`.
 *
 * El cobro NO puede hacerlo él mismo con su propio SQL, y por dos motivos:
 *   1. La aritmética del cierre (minutos facturados, overage al precio
 *      CONGELADO) vive en el módulo de alquileres, que es su dueño
 *      (BR-RENTAL-001..004). Reimplementarla aquí sería la forma más corta de
 *      que el cierre a mano y el cobro por POS cobren la misma sesión de forma
 *      distinta.
 *   2. Escribir `chairs.status` desde aquí saltaría `chair-state-machine.ts` y su
 *      auditoría (BR-CHAIR-003).
 *
 * Por eso se declara un PUERTO. Lo implementa `orders/order-session-settlement.ts`
 * y lo inyecta el grafo (`orders/orders.container.ts`). El `import type` de
 * abajo lo BORRA el compilador: en tiempo de ejecución los módulos de pagos y de
 * pedidos no se importan entre sí, que es lo que mantiene el grafo en forma de
 * DAG (el service de pagos ya da al de pedidos `OrderPaymentWriter` y
 * `OrderPaymentReader`).
 */
export interface OrderSessionSettlement {
  /**
   * Cierra la sesión del pedido que acaba de completarse, en la transacción del
   * cobro. Es un no-op para un pedido sin silla, reserva ni alquiler.
   */
  settleCompletedOrder(
    target: {
      readonly orderId: number;
      readonly businessId: number;
      readonly chairId: number | null;
      readonly reservationId: number | null;
      readonly rentalId: number | null;
    },
    context: PaymentsRequestContext,
    at: string,
    db: Db,
  ): void;
}

/**
 * Implementación que se usa si el grafo no inyectó el puerto.
 *
 * Falla a propósito, y con un mensaje que nombra el problema: un cobro que
 * completa un pedido `CHAIR_RENTAL` sin liquidación dejaría la silla `OCCUPIED`
 * para siempre, que es el fallo que este arreglo elimina. Falla DENTRO de la
 * transacción del cobro, así que tampoco queda un medio cobro: el `ROLLBACK` lo
 * deshace entero.
 */
function settlementNotWired(): never {
  throw new DatabaseError('El cobro no puede liquidar la sesión del pedido completado', {
    details: {
      code: 'ORDER_SESSION_SETTLEMENT_NOT_WIRED',
      reason: 'La liquidación de sesión (BR-ORDER-015) no está conectada al módulo de pagos',
    },
  });
}

/**
 * Etiquetas legibles de los dos métodos, para la pantalla de cobro.
 *
 * NO hay una lista dinámica de "proveedores disponibles" porque no hay
 * proveedores: los dos medios son físicos y están en el local, siempre.
 */
const METHOD_LABELS: Readonly<Record<PaymentMethod, string>> = Object.freeze({
  CASH: 'Efectivo (caja)',
  CARD: 'Tarjeta (datáfono)',
  TRANSFER: 'Transferencia (no disponible)',
  ONLINE: 'Pago en línea (no disponible)',
});

/** Explicación que se devuelve cuando se pide un método que no existe. */
const UNSUPPORTED_METHOD_EXPLANATION =
  'Este sistema cobra únicamente en el local: efectivo en la caja o tarjeta en el datáfono. ' +
  'No hay pasarela de pagos, ni transferencias, ni pago en línea.';

/** Tope duro de un cobro individual: 100.000.000 = $1.000.000 COP. */
const MAX_PAYMENT_MINOR = 100_000_000;

/** Los dos métodos reales, en el orden en que aparecen en la pantalla de cobro. */
const CASHIER_METHODS: readonly PaymentMethod[] = [PaymentMethod.CASH, PaymentMethod.CARD];

/** Servicio de pagos. */
export class PaymentsService {
  public constructor(
    private readonly repository: PaymentsRepository,
    private readonly audit: AuditService,
    /**
     * Lector de descuentos aplicados. Lo inyecta el contenedor: `discounts` es de
     * otro módulo y esta tabla es suya. Se declara como puerto para que pagos no
     * dependa de la implementación concreta.
     */
    private readonly appliedDiscounts: AppliedDiscountReader = {
      appliedDiscountsOf: () => [],
    },
    /**
     * BR-ORDER-015. Lo inyecta el grafo de pedidos con
     * {@link attachSessionSettlement}; sin él, el cobro NO puede completar
     * pedidos (ver {@link settlementNotWired}).
     */
    private sessionSettlement: OrderSessionSettlement = {
      settleCompletedOrder: settlementNotWired,
    },
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /**
   * `GET /api/v1/payments` — listado paginado.
   *
   * El alcance se resuelve ANTES de paginar: sin `payments:read:any` el
   * `customerId` se fuerza al del actor (BR-SEC-008).
   */
  public list(filter: PaymentListFilter, context: PaymentsRequestContext): PaymentPage {
    const scoped = this.scopedFilter(filter, context.actor);
    const totals = this.repository.totals(scoped);
    return {
      items: this.repository.list(scoped).map((row) => this.toSummaryView(row)),
      total: this.repository.count(scoped),
      totals: {
        approvedMinor: totals.approved_minor,
        refundedMinor: totals.refunded_minor,
        netMinor: addMinor(totals.approved_minor, -totals.refunded_minor),
        byMethod: {
          CASH: totals.approved_cash,
          CARD: totals.approved_card,
          // El enum del esquema contempla estos dos, pero este sistema NO los
          // cobra: su importe es siempre 0 y por eso se informa como tal en vez
          // de omitirlos, para que el informe cuadre con el enum publicado.
          TRANSFER: 0,
          ONLINE: 0,
        },
      },
    };
  }

  /** `GET /api/v1/payments/:id` — pago con pedido, reembolsos y personas. */
  public getById(id: number, context: PaymentsRequestContext): PaymentDetailView {
    const row = this.requirePayment(id, context.actor);
    const refunds = this.repository.listRefunds(id);
    const order =
      row.order_id === null ? null : this.repository.findOrder(row.order_id, context.actor.businessId);
    return {
      ...this.toSummaryView(row),
      order:
        order === null
          ? null
          : {
              id: order.id,
              orderNumber: row.order_number ?? '',
              totalMinor: order.total_minor,
              balanceMinor: order.balance_minor,
            },
      refunds: refunds.map((refund) => ({
        id: refund.id,
        amountMinor: refund.amount_minor,
        reason: refund.reason,
        refundedBy: refund.refunded_by,
        createdAt: refund.created_at,
      })),
    };
  }

  /**
   * `GET /api/v1/payments/methods` — los dos métodos y si están habilitados.
   *
   * No consulta "adaptadores registrados" porque no hay ninguno: el cobro en
   * efectivo y con datáfono es una operación puramente local. Lo que sí se lee de
   * `businesses` es la moneda, para que la pantalla de cobro muestre la misma que
   * el resto del sistema.
   */
  public listMethods(context: PaymentsRequestContext): readonly PaymentMethodView[] {
    // La moneda se lee de `businesses` para que la pantalla de cobro use la misma
    // que el resto del sistema, aunque los importes viajan siempre en centavos.
    this.settings(context.actor.businessId);
    void context;
    return CASHIER_METHODS.map((method) => ({
      method,
      enabled: true,
      label: METHOD_LABELS[method],
      // En efectivo la referencia NO es obligatoria: la caja no emite
      // aprobación. Lo que no es opcional es cuánto entregó el cliente.
      requiresReference: method === PaymentMethod.CARD,
      allowsPartial: true,
      // Entregar de más en efectivo es cambio, no un favor (BR-MONEY-007). Con
      // datáfono no hay cambio: el dinero ya entró en la cuenta (BR-MONEY-008).
      allowsOverpayment: method === PaymentMethod.CASH,
      minAmountMinor: 1,
      maxAmountMinor: MAX_PAYMENT_MINOR,
      disabledReason: null,
    }));
  }

  // ==========================================================================
  // Cobro
  // ==========================================================================

  /**
   * `POST /api/v1/payments` — registra el cobro.
   *
   * TODO dentro de UNA transacción `BEGIN IMMEDIATE`:
   *   1. Se busca la `Idempotency-Key` (BR-PAY-001). Si existe, se devuelve el
   *      mismo pago con `200` y NO se cobra de nuevo.
   *   2. Se valida el pedido: existe, es del negocio, es pagable y tiene saldo.
   *   3. Se valida el método (sólo `CASH`/`CARD`) y su coherencia con el importe
   *      recibido.
   *   4. Se inserta el pago en `PENDING` y se lleva a `APPROVED` con
   *      `approved_at = now` (BR-PAY-011: en un cobro local y síncrono el pago
   *      queda aprobado en la misma transacción).
   *   5. Se recalculan `orders.paid_minor` y `orders.balance_minor` (BR-MONEY-006).
   *   6. Si el saldo queda en 0, el pedido pasa a `COMPLETED` (BR-PAY-008) con su
   *      fila de historial.
   *   7. Se audita.
   *
   * "Never fail en el cobro": si cualquier paso falla, la transacción se revierte
   * entera y no queda ni pago ni cambio en el pedido. No hay un segundo sistema
   * que pueda haber cobrado, así que un fallo aquí significa que el cajero
   * devuelve el dinero y lo vuelve a intentar con una clave nueva.
   */
  public register(
    input: {
      readonly orderId: number;
      readonly method: PaymentMethod;
      readonly amountMinor: number;
      readonly provider: PaymentProvider | null;
      readonly providerReference: string | null;
      readonly referenceNumber: string | null;
      readonly receiptNumber: string | null;
      readonly notes: string | null;
      readonly receivedMinor: number | null;
      readonly tipMinor: number;
      readonly idempotencyKey: string;
    },
    context: PaymentsRequestContext,
  ): RegisterPaymentResult {
    return runInTransactionSync((tx) => {
      const businessId = context.actor.businessId;

      // --- 1. Idempotencia (BR-PAY-001) ------------------------------------
      const existing = this.repository.findByIdempotencyKey(input.idempotencyKey, businessId, tx);
      if (existing !== null) {
        // La misma clave devuelve el MISMO pago, sin cobrar de nuevo. El
        // `changeDueMinor` se recalcula porque el cajero necesita saber si tiene
        // que volver a entregar cambio tras un reintento.
        return {
          payment: this.toView(existing),
          orderCompleted: false,
          changeDueMinor: this.changeForRetry(existing, businessId, tx),
          tipMinor: input.tipMinor,
          idempotent: true,
        };
      }

      // --- 2. Pedido -------------------------------------------------------
      const order = this.requirePayableOrder(input.orderId, businessId, tx);
      const settings = this.settings(businessId);
      const outstanding = Math.max(0, order.balance_minor);
      if (outstanding === 0) {
        throw new ConflictError('El pedido no tiene saldo pendiente', {
          details: {
            code: 'PAYMENT_ALREADY_PROCESSED',
            orderId: order.id,
            status: order.status,
            totalMinor: order.total_minor,
          },
        });
      }
      if (order.status === OrderStatus.DRAFT) {
        // BR-PAY-008: no se cobra un borrador. Un `DRAFT` todavía puede cambiar de
        // precio, y cobrarlo obligaría a devolver el dinero si el cliente añade algo
        // más.
        throw new BusinessRuleError('No se puede cobrar un pedido en borrador', {
          details: { code: 'ORDER_NOT_CONFIRMED', orderId: order.id, status: order.status },
        });
      }

      // --- 3. Método e importe --------------------------------------------
      this.assertSupportedMethod(input.method, input.provider, input.providerReference);
      if (input.amountMinor > MAX_PAYMENT_MINOR) {
        throw new BusinessRuleError('El importe del cobro es demasiado alto', {
          details: { code: 'INVALID_AMOUNT_FOR_METHOD', amountMinor: input.amountMinor },
        });
      }

      // Efectivo: se imputa el saldo y el exceso es CAMBIO (BR-MONEY-007/008).
      // Con datáfono no hay cambio: el dinero ya entró en la cuenta, así que
      // entregar de más es un error, no un reembolso futuro (BR-MONEY-008).
      let appliedMinor = input.amountMinor;
      let changeDueMinor = 0;
      if (input.method === PaymentMethod.CASH) {
        const received = input.receivedMinor ?? input.amountMinor;
        if (received < input.amountMinor) {
          throw new BusinessRuleError('El efectivo recibido no alcanza para el cobro', {
            details: {
              code: 'INVALID_AMOUNT_FOR_METHOD',
              method: input.method,
              amountMinor: input.amountMinor,
              receivedMinor: received,
            },
          });
        }
        const settled = settleCashPayment({
          amountMinor: input.amountMinor,
          receivedMinor: received,
          balanceMinor: outstanding,
        });
        // `appliedMinor` no puede ser 0: el importe lo pone el cajero y el
        // esquema exige `> 0`. Si quedara en 0, el pago no imputaría nada y el
        // `INSERT` crearía un cobro que no mueve el saldo del pedido.
        appliedMinor = settled.appliedMinor;
        changeDueMinor = settled.changeDueMinor;
      } else if (input.amountMinor > outstanding) {
        throw new BusinessRuleError('El cobro supera el saldo pendiente del pedido', {
          details: {
            code: 'PAYMENT_EXCEEDS_TOTAL',
            method: input.method,
            amountMinor: input.amountMinor,
            balanceMinor: outstanding,
          },
        });
      }

      // --- 4. Inserción y aprobación ---------------------------------------
      // El número se genera DENTRO de la transacción: el `MAX` y el `INSERT` ven
      // el mismo estado bajo el lock de `BEGIN IMMEDIATE`.
      const paymentNumber = generatePaymentNumber(tx);
      const record: NewPaymentRecord = {
        businessId,
        orderId: order.id,
        paymentNumber,
        method: input.method,
        // El `provider` se NORMALIZA: en efectivo es la caja y en tarjeta el
        // datáfono. Nunca hay un tercero.
        provider: input.method === PaymentMethod.CASH ? PaymentProvider.CASH_REGISTRY : input.provider,
        providerReference: input.providerReference,
        // Lo que se guarda es el importe IMPUTADO, nunca el efectivo entregado:
        // guardar el recibido inflaría `paid_minor` por encima de `total_minor` y
        // dejaría el saldo en negativo.
        amountMinor: appliedMinor,
        currencyCode: settings?.currency_code ?? 'COP',
        referenceNumber: input.referenceNumber,
        receiptNumber: input.receiptNumber,
        notes: input.notes,
        processedBy: context.actor.id,
        customerId: order.customer_id,
        // `metadata` sólo guarda claves de referencia (BR-PAY-007). NUNCA un PAN,
        // un CVV ni un token de proveedor (BR-SEC-006).
        metadata: {
          idempotency_key: input.idempotencyKey,
          received_minor: input.receivedMinor ?? appliedMinor,
          change_due_minor: changeDueMinor,
          tip_minor: input.tipMinor,
          channel: 'LOCAL',
        },
      };
      const paymentId = this.insertPayment(record, input.idempotencyKey, businessId, tx);

      const at = nowIso();
      this.repository.update(paymentId, { status: PaymentStatus.APPROVED, approvedAt: at }, tx);

      // --- 5. Recalcular el pedido (BR-MONEY-006) --------------------------
      const settledMinor = this.repository.settledMinor(order.id, tx);
      this.repository.updateOrderPaid(order.id, order.total_minor, settledMinor, tx);

      // --- 6. Autocompletado (BR-PAY-008) ---------------------------------
      const orderCompleted = this.maybeCompleteOrder(order, settledMinor, context, tx, at);

      // --- 7. Auditoría -----------------------------------------------------
      const created = this.repository.findById(paymentId, businessId, tx);
      if (created === null) {
        throw new NotFoundError('El pago creado no se encuentra', {
          details: { id: paymentId, type: 'payment' },
        });
      }
      // `providerReference` NO se marca como sensible en el audit log: no es un
      // PAN, es la aprobación que anota el cajero, y es justamente el dato que hace
      // falta para conciliar el día. Lo que nunca se registra es un PAN.
      this.audit.record({
        action: AuditAction.PAYMENT,
        entityType: AuditEntityType.payment,
        entityId: paymentId,
        actor: context.actor,
        request: context.request,
        afterData: {
          resource: 'payment',
          id: paymentId,
          paymentNumber,
          orderId: order.id,
          method: input.method,
          provider: record.provider,
          providerReference: input.providerReference,
          amountMinor: appliedMinor,
          changeDueMinor,
          tipMinor: input.tipMinor,
          status: PaymentStatus.APPROVED,
          orderPaidMinor: settledMinor,
        },
      });

      return {
        payment: this.toView(created),
        orderCompleted,
        changeDueMinor,
        tipMinor: input.tipMinor,
        idempotent: false,
      };
    });
  }

  // ==========================================================================
  // Reembolso
  // ==========================================================================

  /**
   * `POST /api/v1/payments/:id/refund` — reembolso total o parcial.
   *
   * `refunded_minor` se DERIVA de la suma de `payment_refunds` (BR-PAY-012) y el
   * pago pasa a `PARTIALLY_REFUNDED` o `REFUNDED` según la tabla de DESIGN.md 6.5.
   * Un reembolso NO devuelve el pedido a `CANCELLED` ni deshace su entrega: se
   * anota en `order_status_history` para que quede rastro contable.
   *
   * Exige `payments:refund`, que en la matriz de RBAC es MANAGER+; un `CUSTOMER`
   * recibe 403 en el middleware, antes de llegar aquí.
   */
  public refund(
    paymentId: number,
    input: {
      readonly amountMinor: number;
      readonly reason: string;
      readonly providerReference: string | null;
      readonly notifyCustomer: boolean;
    },
    context: PaymentsRequestContext,
  ): RefundResult {
    return runInTransactionSync((tx) => {
      const businessId = context.actor.businessId;
      const payment = this.requirePayment(paymentId, context.actor);

      // El pago tiene que estar liquidado: no se devuelve dinero que no entró.
      if (payment.status !== PaymentStatus.APPROVED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
        throw new BusinessRuleError('Este pago no admite reembolsos', {
          details: {
            code: 'REFUND_NOT_ALLOWED',
            status: payment.status,
            ruleId: 'BR-PAY-006',
          },
        });
      }

      // BR-PAY-006: el reembolso no puede superar lo que queda por devolver. La
      // comprobación y el `INSERT` ocurren en la misma transacción, así que dos
      // reembolsos simultáneos no pueden pasar los dos.
      const refundable = payment.amount_minor - payment.refunded_minor;
      if (input.amountMinor > refundable) {
        throw new BusinessRuleError('No se puede reembolsar más de lo que se cobró', {
          details: {
            code: 'REFUND_EXCEEDS_PAID',
            ruleId: 'BR-PAY-006',
            paymentId,
            amountMinor: payment.amount_minor,
            refundedMinor: payment.refunded_minor,
            requestedMinor: input.amountMinor,
            refundableMinor: refundable,
          },
        });
      }

      const at = nowIso();
      const refundId = this.repository.insertRefund(
        {
          paymentId,
          orderId: payment.order_id,
          amountMinor: input.amountMinor,
          reason: input.reason,
          refundedBy: context.actor.id,
          providerReference: input.providerReference,
        },
        tx,
      );
      const refundedMinor = this.repository.recomputeRefundedMinor(paymentId, tx);

      const target =
        refundedMinor >= payment.amount_minor ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED;
      assertPaymentTransition(payment.status, target);
      this.repository.update(
        paymentId,
        { status: target, ...(input.providerReference === null ? {} : { providerReference: input.providerReference }) },
        tx,
      );

      // El saldo del pedido se recalcula con la misma fórmula del cobro.
      let remainingBalanceMinor = 0;
      if (payment.order_id !== null) {
        const order = this.repository.findOrder(payment.order_id, businessId, tx);
        if (order !== null) {
          const settledMinor = this.repository.settledMinor(order.id, tx);
          this.repository.updateOrderPaid(order.id, order.total_minor, settledMinor, tx);
          remainingBalanceMinor = addMinor(order.total_minor, -settledMinor);

          if (refundedMinor >= payment.amount_minor && settledMinor === 0) {
            // Reembolso TOTAL del último pago: el pedido vuelve a deber su
            // importe y pasa a `REFUNDED`, que es el único camino que la máquina
            // de estados permite (`COMPLETED -> REFUNDED`, BR-ORDER y §6.1).
            // `completed_at` se conserva: el pedido SÍ se entregó.
            this.markOrderRefunded(order, context, tx, at, input.reason);
          } else {
            // Reembolso parcial: NO se revierte el estado del pedido. Se anota en
            // `order_status_history` para que quede rastro contable de por qué
            // volvió a haber saldo pendiente.
            this.repository.insertOrderStatusHistory(
              {
                orderId: order.id,
                fromStatus: order.status,
                toStatus: order.status,
                changedBy: context.actor.id,
                reason: `Reembolso de ${input.amountMinor} centavos: ${input.reason}`,
              },
              tx,
            );
          }
        }
      }

      this.audit.record({
        action: AuditAction.REFUND,
        entityType: AuditEntityType.payment,
        entityId: paymentId,
        actor: context.actor,
        request: context.request,
        beforeData: {
          resource: 'payment',
          status: payment.status,
          refundedMinor: payment.refunded_minor,
        },
        afterData: {
          resource: 'payment_refund',
          refundId,
          paymentId,
          amountMinor: input.amountMinor,
          reason: input.reason,
          providerReference: input.providerReference,
          status: target,
          refundedMinor,
          remainingBalanceMinor,
        },
      });

      const updated = this.repository.findById(paymentId, businessId, tx);
      if (updated === null) {
        throw new NotFoundError('El pago no se encuentra', { details: { id: paymentId, type: 'payment' } });
      }
      return {
        payment: this.toView(updated),
        refund: {
          id: refundId,
          amountMinor: input.amountMinor,
          reason: input.reason,
          createdAt: at,
        },
        remainingBalanceMinor,
      };
    });
  }

  // ==========================================================================
  // Puertos para el módulo de pedidos
  // ==========================================================================

  /**
   * Conecta la liquidación de sesión (BR-ORDER-015) al cobro.
   *
   * ============================================================================
   * POR QUÉ ES UN `attach` Y NO UN ARGUMENTO DE CONSTRUCTOR
   * ============================================================================
   * Los dos módulos se necesitan y se construyen el uno al otro: el service de
   * pagos da al de pedidos `OrderPaymentWriter` y `OrderPaymentReader`, y el de
   * pedidos da al de pagos la liquidación. Injectarla por constructor obligaría a
   * que uno de los dos se construyera con una implementación provisional o a
   * duplicar el estado, y ninguna de las dos opciones es aceptable en un cobro.
   *
   * El grafo lo resuelve `orders/orders.container.ts`, que es el punto donde los
   * dos coexisten, y lo hace UNA vez, al construir los servicios. Si se olvidara,
   * el cobro NO falla en silencio: `settleCompletedOrder` lanza
   * `ORDER_SESSION_SETTLEMENT_NOT_WIRED` y la transacción del cobro se revierte
   * entera, así que nunca queda un pedido cobrado con la sesión sin cerrar.
   */
  public attachSessionSettlement(settlement: OrderSessionSettlement): void {
    this.sessionSettlement = settlement;
    logger.info('pagos: liquidación de sesión conectada (BR-ORDER-015)');
  }

  /**
   * Lector de pagos para el módulo de pedidos (`OrderPaymentReader`).
   *
   * Los pagos, reembolsos y descuentos de un pedido salen SIEMPRE de aquí, de modo
   * que el detalle del pedido y el cobro no puedan discrepar: hay una sola
   * lectura de la misma fila para los dos.
   */
  public createOrderPaymentReader(): OrderPaymentReader {
    return {
      listPayments: (orderId: number, db?: Db): readonly OrderPaymentView[] =>
        this.repository.listByOrder(orderId, db).map((row) => ({
          id: row.id,
          paymentNumber: row.payment_number,
          method: row.method,
          provider: row.provider,
          status: row.status,
          amountMinor: row.amount_minor,
          refundedMinor: row.refunded_minor,
          approvedAt: row.approved_at,
        })),
      listRefunds: (orderId: number, db?: Db): readonly OrderRefundView[] =>
        this.repository.listRefundsByOrder(orderId, db).map((row) => ({
          id: row.id,
          amountMinor: row.amount_minor,
          reason: row.reason,
          createdAt: row.created_at,
        })),
      listAppliedDiscounts: (orderId: number, db?: Db): readonly AppliedDiscountView[] =>
        this.appliedDiscounts.appliedDiscountsOf(orderId, db),
      settledMinor: (orderId: number, db?: Db): number => this.repository.settledMinor(orderId, db),
    };
  }

  /**
   * Escritor de pagos para el módulo de pedidos (`OrderPaymentWriter`).
   *
   * Es el cobro EN EFECTIVO que ocurre en la misma transacción que `POST /orders`
   * cuando el body trae el bloque `payment`. No lleva `Idempotency-Key` porque la
   * idempotencia de esa vía la da la atomicidad: si el commit falla, no hay cobro;
   * si hay commit, el pago existe con su pedido.
   */
  public createOrderPaymentWriter(): OrderPaymentWriter {
    return {
      writeCashPayment: (
        params: {
          readonly orderId: number;
          readonly businessId: number;
          readonly customerId: number | null;
          readonly processedBy: number;
          readonly receivedMinor: number;
          readonly referenceNumber: string | null;
          readonly receiptNumber: string | null;
          readonly notes: string | null;
        },
        db: Db,
      ): { readonly paymentNumber: string; readonly changeDueMinor: number } => {
        const order = this.repository.findOrder(params.orderId, params.businessId, db);
        if (order === null) {
          throw new NotFoundError('El pedido no existe', {
            details: { id: params.orderId, type: 'order' },
          });
        }
        const outstanding = Math.max(0, order.balance_minor);
        if (outstanding === 0) {
          throw new ConflictError('El pedido no tiene saldo pendiente', {
            details: { code: 'PAYMENT_ALREADY_PROCESSED', orderId: order.id },
          });
        }
        if (params.receivedMinor < outstanding) {
          throw new BusinessRuleError('El efectivo recibido no alcanza para el cobro', {
            details: {
              code: 'INVALID_AMOUNT_FOR_METHOD',
              method: PaymentMethod.CASH,
              receivedMinor: params.receivedMinor,
              balanceMinor: outstanding,
            },
          });
        }
        const settled = settleCashPayment({
          amountMinor: outstanding,
          receivedMinor: params.receivedMinor,
          balanceMinor: outstanding,
        });
        const at = nowIso();
        const paymentNumber = generatePaymentNumber(db);
        const paymentId = this.repository.insert(
          {
            businessId: params.businessId,
            orderId: order.id,
            paymentNumber,
            method: PaymentMethod.CASH,
            provider: PaymentProvider.CASH_REGISTRY,
            providerReference: null,
            amountMinor: settled.appliedMinor,
            currencyCode: this.settings(params.businessId)?.currency_code ?? 'COP',
            referenceNumber: params.referenceNumber,
            receiptNumber: params.receiptNumber,
            notes: params.notes,
            processedBy: params.processedBy,
            customerId: params.customerId,
            metadata: {
              received_minor: params.receivedMinor,
              change_due_minor: settled.changeDueMinor,
              channel: 'LOCAL',
              source: 'ORDER_CREATE',
            },
          },
          db,
        );
        this.repository.update(paymentId, { status: PaymentStatus.APPROVED, approvedAt: at }, db);
        const settledMinor = this.repository.settledMinor(order.id, db);
        this.repository.updateOrderPaid(order.id, order.total_minor, settledMinor, db);
        return { paymentNumber, changeDueMinor: settled.changeDueMinor };
      },
    };
  }

  // ==========================================================================
  // Utilidades internas
  // ==========================================================================

  /** Pago obligatorio y dentro del alcance del actor. */
  private requirePayment(id: number, actor: UserContext): PaymentRow {
    const row = this.repository.findById(id, actor.businessId);
    if (row === null || (!this.canReadAnyPayment(actor) && row.customer_id !== actor.id)) {
      // Un `CUSTOMER` que pide el pago de otro recibe 404, no 403: el contrato no
      // revela la existencia de recursos de otro cliente (API.md 2).
      throw new NotFoundError('El pago no existe', { details: { id, type: 'payment' } });
    }
    return row;
  }

  /** `true` si el actor puede ver pagos de CUALQUIER cliente. */
  private canReadAnyPayment(actor: UserContext): boolean {
    // BR-RBAC-002: ADMIN y OWNER tienen todos los permisos implícitos.
    if (actor.roles.includes(Role.ADMIN) || actor.roles.includes(Role.OWNER)) {
      return true;
    }
    return actor.permissions.includes('payments:read:any');
  }

  /**
   * Alcance del listado (BR-SEC-008): sin `payments:read:any` el `customerId` se
   * fuerza al del actor y el de la query se descarta.
   */
  private scopedFilter(filter: PaymentListFilter, actor: UserContext): PaymentListFilter {
    if (this.canReadAnyPayment(actor)) {
      return filter;
    }
    return { ...filter, customerId: actor.id };
  }

  /**
   * Pedido pagable: existe, es del negocio, no está borrado y no está cerrado
   * (BR-PAY-004).
   */
  private requirePayableOrder(orderId: number, businessId: number, db: Db): PaymentOrderRow {
    const order = this.repository.findOrder(orderId, businessId, db);
    if (order === null) {
      throw new NotFoundError('El pedido no existe', { details: { id: orderId, type: 'order' } });
    }
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
      throw new BusinessRuleError('El pedido no admite pagos', {
        details: {
          code: 'ORDER_NOT_PAYABLE',
          orderId: order.id,
          status: order.status,
          ruleId: 'BR-PAY-004',
        },
      });
    }
    return order;
  }

  /**
   * Sólo `CASH` y `CARD` (decisión del cliente: cobro en el local, sin pasarela).
   *
   * `TRANSFER` y `ONLINE` reciben un mensaje que dice exactamente por qué no
   * funcionan, que es más útil para el cajero que un enum que los liste como si
   * fueran a estar disponibles.
   */
  private assertSupportedMethod(
    method: PaymentMethod,
    provider: PaymentProvider | null,
    providerReference: string | null,
  ): void {
    if (method !== PaymentMethod.CASH && method !== PaymentMethod.CARD) {
      throw new BusinessRuleError('Este sistema no admite ese método de pago', {
        details: {
          code: 'PAYMENT_METHOD_NOT_SUPPORTED',
          method,
          explanation: UNSUPPORTED_METHOD_EXPLANATION,
        },
      });
    }
    if (method === PaymentMethod.CARD) {
      // El datáfono no es un "proveedor" en el esquema (ver la cabecera): lo que lo
      // identifica es la referencia de aprobación que anota el cajero, y sin ella
      // la conciliación bancaria del día es imposible. Equivalente funcional de
      // BR-PAY-003 para un cobro local.
      if (providerReference === null || providerReference.length === 0) {
        throw new BusinessRuleError('Anote la referencia de aprobación del datáfono', {
          details: {
            code: 'PROVIDER_REQUIRED',
            method,
            field: 'providerReference',
            hint: 'Es el número de aprobación, no el número de la tarjeta',
          },
        });
      }
      // Un `provider` distinto de la caja en un cobro con tarjeta sería un valor
      // de pasarela, y este sistema no tiene ninguno.
      if (provider !== null && provider !== PaymentProvider.CASH_REGISTRY) {
        throw new BusinessRuleError('El cobro con tarjeta se registra en el datáfono, sin pasarela', {
          details: {
            code: 'PROVIDER_REQUIRED',
            method,
            field: 'provider',
            explanation: UNSUPPORTED_METHOD_EXPLANATION,
          },
        });
      }
    }
  }

  /**
   * Marca el pedido como `REFUNDED` tras un reembolso total.
   *
   * Sólo se hace desde `COMPLETED`, que es el único `from` válido de la
   * transición (DESIGN.md 6.1): un pedido que se pagó, se entregó y se devolvió
   * el dinero está `REFUNDED`, no `CANCELLED`. Un pedido a medio pagar que se le
   * devuelve lo único que había pagado NO se marca: no hubo entrega cobrada, y
   * saltarse la máquina de estados aquí dejaría un pedido con saldo en un
   * terminal que no le corresponde.
   */
  private markOrderRefunded(
    order: PaymentOrderRow,
    context: PaymentsRequestContext,
    db: Db,
    at: string,
    reason: string,
  ): void {
    if (order.status !== OrderStatus.COMPLETED) {
      this.repository.insertOrderStatusHistory(
        {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: order.status,
          changedBy: context.actor.id,
          reason: `Reembolso total: ${reason}`,
        },
        db,
      );
      return;
    }
    this.repository.updateOrderStatus(order.id, OrderStatus.REFUNDED, at, db);
    this.repository.insertOrderStatusHistory(
      {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: OrderStatus.REFUNDED,
        changedBy: context.actor.id,
        // `ck_order_history_reason` exige `reason` en `REFUNDED`: nunca es NULL.
        reason: `Reembolso total: ${reason}`,
      },
      db,
    );
  }

  /**
   * BR-PAY-008: si el saldo queda en 0, el pedido pasa a `COMPLETED`.
   *
   * Sólo se auto-completa desde `PENDING`, `CONFIRMED`, `PREPARING` o `READY`; el
   * `DRAFT` ya se ha rechazado más arriba. La cadena real de transiciones se
   * registra completa, porque el historial tiene que reflejar lo que pasó y no un
   * salto: de `PENDING` se confirma y luego se completa.
   *
   * ============================================================================
   * Y DESPUÉS, LA LIQUIDACIÓN DE LA SESIÓN (BR-ORDER-015)
   * ============================================================================
   * Escribir el estado NO es completar el pedido: `... -> COMPLETED` cierra además
   * el alquiler de un `CHAIR_RENTAL`, hace el check-out de la reserva y manda la
   * silla a `CLEANING`. Aquí es donde se ejecutaba ese paso, y por eso un cobro
   * del POS dejaba el alquiler `ACTIVE` y la silla `OCCUPIED` para siempre. Se
   * delega en el mismo puerto que usa `POST /orders/:id/status`, dentro de la
   * MISMA transacción: si el cierre falla, el cobro tampoco queda.
   */
  private maybeCompleteOrder(
    order: PaymentOrderRow,
    settledMinor: number,
    context: PaymentsRequestContext,
    db: Db,
    at: string,
  ): boolean {
    const remaining = addMinor(order.total_minor, -settledMinor);
    if (remaining > 0 || order.status === OrderStatus.COMPLETED) {
      return false;
    }
    const current = order.status as OrderStatus;
    const completable: readonly OrderStatus[] = [
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.PREPARING,
      OrderStatus.READY,
    ];
    if (!completable.includes(current)) {
      return false;
    }

    const chain: readonly OrderStatus[] =
      current === OrderStatus.PENDING
        ? [OrderStatus.CONFIRMED, OrderStatus.COMPLETED]
        : [OrderStatus.COMPLETED];
    let fromStatus = current;
    let completed = false;
    for (const toStatus of chain) {
      this.repository.updateOrderStatus(
        order.id,
        toStatus,
        toStatus === OrderStatus.COMPLETED ? at : null,
        db,
      );
      this.repository.insertOrderStatusHistory(
        {
          orderId: order.id,
          fromStatus,
          toStatus,
          changedBy: context.actor.id,
          reason:
            toStatus === OrderStatus.COMPLETED
              ? 'Cobro completo: el pedido queda pagado y entregado'
              : 'Confirmado automáticamente por el cobro',
        },
        db,
      );
      fromStatus = toStatus;
      completed = toStatus === OrderStatus.COMPLETED;
    }
    if (!completed) {
      return false;
    }
    this.sessionSettlement.settleCompletedOrder(
      {
        orderId: order.id,
        businessId: order.business_id,
        chairId: order.chair_id,
        reservationId: order.reservation_id,
        rentalId: order.rental_id,
      },
      context,
      at,
      db,
    );
    return true;
  }

  /**
   * Inserta el pago y RECUPERA la clave de idempotencia si otro proceso se
   * adelantó (BR-PAY-001).
   *
   * La segunda búsqueda es la parte no obvia: si el `INSERT` choca con
   * `ux_payments_idempotency`, el pago ganador ya existe y hay que devolverlo, no
   * fallar. Por eso el método devuelve SIEMPRE un id, y el `idempotent` se decide
   * comparando la fila leída con la clave buscada al principio.
   */
  private insertPayment(
    record: NewPaymentRecord,
    idempotencyKey: string,
    businessId: number,
    db: Db,
  ): number {
    try {
      return this.repository.insert(record, db);
    } catch (error) {
      if (isIdempotencyConflict(error)) {
        const winner = this.repository.findByIdempotencyKey(idempotencyKey, businessId, db);
        if (winner !== null) {
          logger.info(
            { paymentId: winner.id, paymentNumber: winner.payment_number },
            'pagos: la clave de idempotencia ya existía; se devuelve el pago original',
          );
          return winner.id;
        }
      }
      throw error;
    }
  }

  /**
   * Cambio que el cajero tiene que ENTREGAR tras un reintento con la misma clave.
   *
   * Si el pedido quedó pagado, hay que devolver el mismo cambio otra vez (puede
   * que la primera respuesta se perdiera). Si el pedido sigue debiendo, este pago
   * no cerró el cobro y hay que entregar la diferencia, que es un cobro nuevo.
   * Un `metadata` ilegible devuelve 0, que es el valor seguro: no se vuelve a dar
   * dinero por una lectura fallida.
   */
  private changeForRetry(payment: PaymentRow, businessId: number, db: Db): number {
    if (payment.status !== PaymentStatus.APPROVED && payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
      return 0;
    }
    if (payment.order_id === null) {
      return 0;
    }
    const order = this.repository.findOrder(payment.order_id, businessId, db);
    if (order === null) {
      return 0;
    }
    const settledMinor = this.repository.settledMinor(order.id, db);
    if (addMinor(order.total_minor, -settledMinor) > 0) {
      return 0;
    }
    return changeDueOf(payment);
  }

  /** Ajustes del negocio, o `null` si `businesses` no está sembrada. */
  private settings(businessId: number): PaymentBusinessSettingsRow | null {
    return this.repository.findBusinessSettings(businessId);
  }

  // --- Mapeo a vistas ------------------------------------------------------

  private toView(row: PaymentRow): PaymentView {
    return {
      id: row.id,
      paymentNumber: row.payment_number,
      orderId: row.order_id,
      method: row.method,
      provider: row.provider,
      providerReference: row.provider_reference,
      status: row.status,
      amountMinor: row.amount_minor,
      refundedMinor: row.refunded_minor,
      currencyCode: row.currency_code,
      referenceNumber: row.reference_number,
      receiptNumber: row.receipt_number,
      notes: row.notes,
      approvedAt: row.approved_at,
      failedAt: row.failed_at,
      failureReason: row.failure_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSummaryView(row: PaymentRow): PaymentSummaryView {
    return {
      ...this.toView(row),
      orderNumber: row.order_number,
      processedByUser:
        row.processed_by === null || row.processed_by_name === null
          ? null
          : { id: row.processed_by, fullName: row.processed_by_name },
      customer:
        row.customer_id === null || row.customer_name === null
          ? null
          : { id: row.customer_id, fullName: row.customer_name },
    };
  }
}

/** `true` si el error es la violación de `ux_payments_idempotency`. */
function isIdempotencyConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code: unknown = (error as { code: unknown }).code;
  if (code !== 'SQLITE_CONSTRAINT_UNIQUE') {
    return false;
  }
  const message = error instanceof Error ? error.message : '';
  return message.includes('ux_payments_idempotency');
}

/**
 * Cambio ya entregado, leído de `payments.metadata.change_due_minor`.
 *
 * `metadata` es un JSON escrito por este mismo módulo y sólo contiene claves de
 * referencia (BR-PAY-007): nunca un PAN, un CVV ni un token. Un valor ausente,
 * no numérico o negativo devuelve 0, que es el valor seguro.
 */
function changeDueOf(payment: PaymentRow): number {
  if (payment.metadata === null) {
    return 0;
  }
  try {
    const parsed: unknown = JSON.parse(payment.metadata);
    if (typeof parsed !== 'object' || parsed === null || !('change_due_minor' in parsed)) {
      return 0;
    }
    const value: unknown = (parsed as { change_due_minor: unknown }).change_due_minor;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return 0;
    }
    return value;
  } catch {
    return 0;
  }
}
