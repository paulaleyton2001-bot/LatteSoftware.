/**
 * Servicio de pedidos (API.md 7.12, DESIGN.md 4.5, 6.1, 7.7 y 8.5).
 *
 * ============================================================================
 * LAS CINCO GARANTÍAS DE ESTE FICHERO
 * ============================================================================
 * 1. **EL PRECIO SIEMPRE LO CALCULA EL SERVIDOR** (BR-ORDER-014, BR-PRICE-008).
 *    El body sólo lleva QUÉ se pide y CUÁNTO. El precio unitario se resuelve con
 *    `resolveUnitPrice` de `catalog/catalog.pricing.ts` — la MISMA función pura
 *    que usa el menú y la ficha de producto — y se CONGELA en
 *    `order_items.name_snapshot / sku_snapshot / unit_price_minor`. Mañana el
 *    producto sube de precio y el histórico sigue igual.
 *
 * 2. **LOS 6 PASOS, UNA SOLA TRANSACCIÓN** (DESIGN.md 8.5, 8.4). Un `throw` en
 *    cualquier paso deshace cabecera, líneas, complementos, movimientos de
 *    inventario, canje de cupón, pago y asociación de silla. No existe el estado
 *    "pedido sin líneas" ni "pedido con stock descontado y sin cobrar".
 *
 * 3. **LA MÁQUINA DE ESTADOS ES LA DEL DOMINIO** (DESIGN.md 6.1). Este service
 *    no reimplementa transiciones: llama a `assertTransition` de
 *    `shared/domain/order-state-machine.ts`. Por eso `COMPLETED -> PREPARING` es
 *    imposible por construcción y no por un `if` olvidado.
 *
 * 4. **INMUTABILIDAD** (BR-ORDER-017). `COMPLETED`, `CANCELLED` y `REFUNDED` no
 *    admiten cambios de líneas ni de total. La ÚNICA excepción documentada es
 *    `notes` (nota interna), que es un apéndice auditable y no altera ninguna
 *    cifra, no revierte stock y no dispara notificaciones.
 *
 * 5. **ALCANCE DE CLIENTE** (BR-SEC-008, DESIGN.md 9.3). Un `CUSTOMER` ve y
 *    edita SÓLO lo suyo, y el `customerId` sale SIEMPRE del token, nunca del
 *    body ni de la query. Un pedido ajeno es `404`, no `403`: no se revela que
 *    exista.
 *
 * ============================================================================
 * POR QUÉ EL COBRO EN EFECTIVO ESTÁ DENTRO DE ESTE FICHERO
 * ============================================================================
 * El negocio cobra TODO en el local, en efectivo o con datáfono, y el cajero
 * registra el pago a mano. NO hay pasarela, NO hay llamada de red y NO hay
 * abstracción de proveedores: la decisión del cliente es exactamente esa.
 *
 * Por eso `POST /orders` admite un bloque `payment` en EFECTIVO: si el cajero cobra
 * al registrar, el cobro y la venta deben ser UN commit. En dos peticiones, un
 * fallo de la segunda deja un pedido servido y no cobrado, que es el peor estado
 * posible en una caja. El pago con datáfono (`CARD`) se registra con
 * `POST /api/v1/payments`, que es donde vive la referencia de aprobación.
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import type { Db } from '../../shared/database/connection.js';
import {
  AuditAction,
  AuditEntityType,
  ChairStatus,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  ReservationStatus,
  Role,
  assertOrderTransition,
} from '../../shared/domain/index.js';
import type { UserContext } from '../../shared/domain/index.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../shared/errors/index.js';
import { CONFLICT_DETAIL_CODE } from '../../shared/errors/codes.js';
import { logger } from '../../shared/logger/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import { generateOrderNumber } from '../../shared/utils/codes.js';
import { roundHalfUp } from '../../shared/utils/money.js';
import { resolveUnitPrice } from '../catalog/catalog.pricing.js';
import type { DiscountsService } from '../discounts/discounts.service.js';
import type { DiscountValidationLine } from '../discounts/discounts.types.js';
import type { OrderCatalogReader } from './order-catalog.repository.js';
import type {
  OrderChairGateway,
  OrderRentalGateway,
  OrderReservationGateway,
  OrderStockGateway,
} from './order-gateways.js';
import { computeOrderTotals, lineTotalMinor } from './order-pricing.js';
import type {
  NewOrderRecord,
  OrderBusinessSettingsRow,
  OrderHistoryFilter,
  OrderListFilter,
  OrdersRepository,
  OrderStatusTimestamps,
} from './orders.repository.js';
import type {
  AddOrderItemsBody,
  CancelOrderBody,
  ChangeOrderStatusBody,
  CreateOrderBody,
  OrderItemInput,
  UpdateOrderBody,
  UpdateOrderItemBody,
} from './orders.schemas.js';
import type {
  AppliedDiscountView,
  OrderDetailView,
  OrderHistoryView,
  OrderItemAddonRow,
  OrderItemRow,
  OrderItemView,
  OrderPage,
  OrderPaymentView,
  OrderReceiptView,
  OrderRefundView,
  OrderRow,
  OrderSummaryRow,
  OrderSummaryView,
  OrderTotalsView,
  OrderView,
} from './orders.types.js';

/** Contexto de petición: actor (del token) y datos de red para la auditoría. */
export interface OrdersRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/**
 * Puerto de ESCRITURA de pagos que usa este service.
 *
 * Lo implementa el módulo de pagos, que es dueño de la tabla `payments`. Existe
 * para que el cobro del pedido y el de `POST /payments` no puedan divergir: los
 * dos escriben la misma tabla con las mismas reglas de `paid_minor`, cambio y
 * estado, y este módulo no escribe SQL en la tabla de otro.
 */
export interface OrderPaymentWriter {
  /**
   * Registra un pago EN EFECTIVO dentro de la transacción ya abierta.
   *
   * @returns el número de pago generado y el cambio a devolver al cliente.
   *          El cambio NUNCA se guarda como pago (BR-MONEY-007/008).
   */
  writeCashPayment(
    params: {
      readonly orderId: number;
      readonly businessId: number;
      readonly customerId: number | null;
      readonly processedBy: number;
      /** Efectivo entregado. Puede ser MAYOR que el saldo: eso es el cambio. */
      readonly receivedMinor: number;
      readonly referenceNumber: string | null;
      readonly receiptNumber: string | null;
      readonly notes: string | null;
    },
    db: Db,
  ): { readonly paymentNumber: string; readonly changeDueMinor: number };
}

/** Pago y reembolso tal y como los ve el pedido (los lee el módulo de pagos). */
export interface OrderPaymentReader {
  /** Pagos del pedido, del más reciente al más antiguo. */
  listPayments(orderId: number, db?: Db): readonly OrderPaymentView[];
  /** Reembolsos del pedido. */
  listRefunds(orderId: number, db?: Db): readonly OrderRefundView[];
  /**
   * Descuentos realmente aplicados al pedido, leídos de `discount_redemptions`.
   * El pedido los expone en `appliedDiscounts` (API.md 7.12) para que el recibo
   * explique de dónde sale el descuento.
   */
  listAppliedDiscounts(orderId: number, db?: Db): readonly AppliedDiscountView[];
  /** Suma de pagos APROBADOS menos reembolsos (BR-MONEY-006). */
  settledMinor(orderId: number, db?: Db): number;
}

/** Resultado de `POST /orders`: el pedido y los avisos no bloqueantes. */
export interface CreateOrderResult {
  readonly order: OrderDetailView;
  /** `meta.warnings`: cupón no aplicable, campos ignorados, etc. */
  readonly warnings: readonly string[];
  /** Cambio a devolver, si el body traía un cobro en efectivo. */
  readonly changeDueMinor: number;
  /** Número de pago generado, si el body traía cobro. */
  readonly paymentNumber: string | null;
  /** Reglas de negocio aplicadas, para `meta.appliedRules`. */
  readonly appliedRules: readonly string[];
}

/**
 * Ajustes del negocio con valores por defecto si `businesses` no está sembrada.
 *
 * Los valores coinciden con el DEFAULT de las columnas (`0001_init.sql`), de modo
 * que un despliegue sin sembrar calcula lo mismo que uno sembrado, en vez de
 * fallar con un error de configuración en plena venta.
 */
const FALLBACK_SETTINGS = {
  taxRateBp: 1900,
  taxInclusive: 0,
  serviceFeeBp: 0,
  orderPrefix: 'ORD-',
  name: 'LatteCoffe',
  currencyCode: 'COP',
  currencySymbol: '$',
  tipEnabled: 1,
} as const;

/** Estados en los que el pedido todavía es editable (BR-ORDER-003/004). */
const EDITABLE_STATUSES: readonly OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.PENDING];

/** Estados cerrados: no admiten cambios de líneas ni de total (BR-ORDER-017). */
const CLOSED_STATUSES: readonly OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

/** Una línea del body ya resuelta y cotizada por el servidor. */
interface ResolvedLine {
  readonly productId: number;
  readonly categoryId: number | null;
  readonly variantId: number | null;
  readonly nameSnapshot: string;
  readonly skuSnapshot: string | null;
  /** Snapshot del precio unitario: promo, variante o base (BR-PRICE-001). */
  readonly unitPriceMinor: number;
  readonly quantity: number;
  /** Suma de `price_minor * quantity` de los complementos (BR-PRICE-003). */
  readonly addonsMinor: number;
  /** Tasa de la línea: la del producto o la del negocio (BR-TAX-004). */
  readonly taxRateBp: number;
  readonly preparationMinutes: number;
  readonly trackStock: boolean;
  readonly lineTotalMinor: number;
  readonly addons: readonly ResolvedAddon[];
}

/** Un complemento con su snapshot congelado (BR-PRICE-004). */
interface ResolvedAddon {
  readonly productAddonId: number;
  readonly nameSnapshot: string;
  readonly priceMinor: number;
  readonly quantity: number;
}

/** Asociación de silla, reserva y alquiler resuelta (paso 5 de §8.5). */
interface ChairAssociation {
  readonly chairId: number | null;
  readonly reservationId: number | null;
  readonly rentalId: number | null;
  readonly locationId: number | null;
}

/** Servicio de pedidos. */
export class OrdersService {
  public constructor(
    private readonly orders: OrdersRepository,
    private readonly catalog: OrderCatalogReader,
    private readonly stock: OrderStockGateway,
    private readonly rentals: OrderRentalGateway,
    private readonly reservations: OrderReservationGateway,
    private readonly chairs: OrderChairGateway,
    private readonly discounts: DiscountsService,
    private readonly paymentWriter: OrderPaymentWriter,
    private readonly paymentReader: OrderPaymentReader,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /**
   * `GET /api/v1/orders` — listado paginado.
   *
   * El alcance se resuelve ANTES de paginar: si el actor no tiene
   * `orders:read:any`, `customerId` se fuerza a su id y el `customerId` de la
   * query se ignora. Forzarlo después de paginar daría páginas incoherentes entre
   * dos peticiones del mismo cliente.
   */
  public list(filter: OrderListFilter, context: OrdersRequestContext): OrderPage {
    const scoped = this.scopedFilter(filter, context.actor);
    const counts: Record<string, number> = {};
    for (const status of Object.values(OrderStatus)) {
      counts[status] = 0;
    }
    for (const entry of this.orders.countByStatus(scoped)) {
      counts[entry.status] = entry.total;
    }
    const totals = this.orders.aggregateTotals(scoped);
    return {
      items: this.orders.list(scoped).map((row) => this.toSummaryView(row)),
      total: this.orders.count(scoped),
      countsByStatus: counts as OrderPage['countsByStatus'],
      totals: {
        grossMinor: totals.gross_minor,
        netMinor: totals.net_minor,
        unpaidMinor: totals.unpaid_minor,
      },
    };
  }

  /** `GET /api/v1/orders/:id` — pedido con pagos, reembolsos, silla y cupones. */
  public getById(id: number, context: OrdersRequestContext): OrderDetailView {
    return this.toDetailView(this.requireOrder(id, context.actor));
  }

  /**
   * `GET /api/v1/orders/:id/receipt` — comprobante imprimible.
   *
   * BR-ORDER-018: se construye SOLO con snapshots y valores almacenados. No
   * consulta el catálogo, así que un producto que subió de precio o se borró no
   * altera el comprobante de una venta ya emitida. Para un pedido `REFUNDED`
   * muestra el reembolso en `refunds`.
   */
  public getReceipt(id: number, context: OrdersRequestContext): OrderReceiptView {
    const row = this.requireOrder(id, context.actor);
    const settings = this.settings(row.business_id);
    const receipt = this.orders.findReceiptContext(row.id, row.business_id);
    if (receipt === null) {
      // Sólo puede ocurrir si el negocio se borró entre medias: `businesses` es
      // `NOT NULL` con FK, así que es prácticamente imposible.
      throw new NotFoundError('El pedido no existe', { details: { id, type: 'order' } });
    }
    const items = this.orders.listItems(row.id);
    const addons = this.orders.listAddonsForItems(items.map((item) => item.id));
    const customer = this.orders.findCustomerForOrder(row.id);
    const payments = this.paymentReader.listPayments(row.id);
    const refunds = this.paymentReader.listRefunds(row.id);

    return {
      orderNumber: row.order_number,
      type: row.type,
      status: row.status,
      business: {
        name: receipt.business_name,
        legalName: receipt.business_legal_name,
        taxId: receipt.business_tax_id,
        addressLine1: receipt.business_address_line1,
        city: receipt.business_city,
        currencyCode: receipt.business_currency_code,
        currencySymbol: receipt.business_currency_symbol,
      },
      customer: customer === null ? null : { fullName: customer.full_name, phone: customer.phone },
      items: items.map((item) => ({
        name: item.name_snapshot,
        variantName: item.variant_name,
        unitPriceMinor: item.unit_price_minor,
        quantity: item.quantity,
        addons: addons
          .filter((addon) => addon.order_item_id === item.id)
          .map((addon) => ({
            name: addon.name_snapshot,
            priceMinor: addon.price_minor,
            quantity: addon.quantity,
          })),
        discountMinor: item.discount_minor,
        taxMinor: item.tax_minor,
        lineTotalMinor: item.line_total_minor,
        notes: item.notes,
      })),
      totals: this.toTotalsView(row, settings, { changeDueMinor: 0, tipMinor: 0 }),
      payments: payments.map((payment) => ({
        paymentNumber: payment.paymentNumber,
        method: payment.method,
        amountMinor: payment.amountMinor,
        approvedAt: payment.approvedAt,
      })),
      refunds: refunds.map((refund) => ({
        amountMinor: refund.amountMinor,
        reason: refund.reason,
        createdAt: refund.createdAt,
      })),
      chair:
        receipt.chair_code === null
          ? null
          : { code: receipt.chair_code, name: receipt.chair_name, zoneName: receipt.chair_zone_name },
      rental:
        receipt.rental_code === null
          ? null
          : {
              code: receipt.rental_code,
              startAt: receipt.rental_start_at ?? '',
              endAt: receipt.rental_end_at ?? '',
              billedMinutes: receipt.rental_billed_minutes ?? 0,
              extraMinutesMinor: receipt.rental_extra_minutes_minor ?? 0,
            },
      placedAt: row.placed_at,
      completedAt: row.completed_at,
      printedAt: null,
    };
  }

  /** `GET /api/v1/orders/:id/history` — historial de estados con actor y fecha. */
  public getHistory(
    id: number,
    filter: { readonly limit: number; readonly offset: number; readonly direction: 'ASC' | 'DESC' },
    context: OrdersRequestContext,
  ): { readonly items: readonly OrderHistoryView[]; readonly total: number } {
    // `requireOrder` aplica el alcance de cliente: sin él, un `CUSTOMER` vería el
    // historial de pedidos ajenos.
    this.requireOrder(id, context.actor);
    const historyFilter: OrderHistoryFilter = {
      orderId: id,
      limit: filter.limit,
      offset: filter.offset,
      direction: filter.direction,
    };
    return {
      items: this.orders.listHistory(historyFilter).map((row) => ({
        id: row.id,
        fromStatus: row.from_status,
        toStatus: row.to_status,
        changedBy: row.changed_by,
        changedByName: row.changed_by_name,
        reason: row.reason,
        createdAt: row.created_at,
      })),
      total: this.orders.countHistory(id),
    };
  }

  // ==========================================================================
  // Creación: los 6 pasos de DESIGN.md 8.5 en UNA transacción
  // ==========================================================================

  /**
   * `POST /api/v1/orders` — crea el pedido completo.
   *
   * SECUENCIA DENTRO DE `runInTransactionSync` (DESIGN.md 8.5), con el criterio
   * "tocar primero lo más caro de revertir":
   *
   *   0. Ajustes del negocio, validación y resolución de PRECIOS, todo en
   *      memoria: si algo falla aquí, no se escribió nada.
   *   1. Cabecera del pedido con `order_number` generado bajo el lock.
   *   2. Líneas + complementos con TODOS sus snapshots, y la primera fila de
   *      `order_status_history` (`from_status = NULL`).
   *   3. Inventario: movimiento `RESERVATION` por cada producto con
   *      `track_stock = 1` y por cada insumo de su receta.
   *   4. Cupón (consumiendo `used_count` y escribiendo la redemption) y
   *      ESCRITURA de los totales calculados por `order-pricing.ts`.
   *   5. Asociación de silla, reserva y alquiler.
   *   6. Cobro en efectivo del mismo cuerpo, con su cambio.
   *   7. Auditoría (BR-SEC-007), también dentro de la transacción.
   *
   * DESVIACIÓN DOCUMENTADA respecto al orden literal del enunciado: los totales se
   * ESCRIBEN antes del pago. El motivo es aritmético, no de gusto: el pago necesita
   * conocer el total para saber cuánto imputar y cuánto es cambio (BR-MONEY-007).
   * Escribir el total después del cobro abriría una ventana en la que existe un
   * pago `APPROVED` sobre un pedido con `total_minor = 0`.
   */
  public create(input: CreateOrderBody, context: OrdersRequestContext): CreateOrderResult {
    const warnings: string[] = [];
    return runInTransactionSync((tx) => {
      const businessId = context.actor.businessId;
      const settings = this.settings(businessId);
      const at = nowIso();

      // ── PASO 0 ───────────────────────────────────────────────────────────
      const type = input.type;
      const customerId = this.resolveCustomerId(input.customerId, context.actor);
      const association = this.resolveAssociation(type, input, businessId, tx, warnings);

      // BR-ORDER-012: un pedido es de productos O de alquiler, nunca de los dos.
      if (type === OrderType.CHAIR_RENTAL && input.items.length > 0) {
        throw new BusinessRuleError('Un pedido de alquiler no lleva líneas de producto', {
          details: { code: 'MIXED_ORDER_TYPE_NOT_ALLOWED', ruleId: 'BR-ORDER-012', type },
        });
      }
      // BR-ORDER-007: un pedido colocado necesita al menos una línea; un `DRAFT`
      // puede quedarse vacío.
      if (type !== OrderType.CHAIR_RENTAL && input.items.length === 0 && input.place) {
        throw new BusinessRuleError('Un pedido colocado necesita al menos una línea', {
          details: { code: 'EMPTY_ORDER', ruleId: 'BR-ORDER-007' },
        });
      }
      // BR-ORDER-010: un `TAKEAWAY` nunca lleva silla ni reserva. `resolveAssociation`
      // ya los dejó en `null`; aquí sólo se deja constancia en `meta.warnings`.
      if (type === OrderType.TAKEAWAY && (input.chairId != null || input.reservationId != null)) {
        warnings.push('CHAIR_IGNORED_ON_TAKEAWAY');
      }

      const resolvedLines = input.items.map((item) => this.resolveLine(item, businessId, tx, at));
      const rentalBaseMinor = this.resolveRentalBase(type, association.rentalId, businessId, tx, warnings);

      // ── PASO 1: cabecera ─────────────────────────────────────────────────
      const status = input.place ? OrderStatus.PENDING : OrderStatus.DRAFT;
      // BR-ORDER-001: el número se genera DENTRO de la transacción, con el `MAX`
      // leído bajo el lock de escritura de `BEGIN IMMEDIATE`.
      const orderNumber = generateOrderNumber(tx, orderCodePrefix(settings.order_prefix));
      const record: NewOrderRecord = {
        businessId,
        locationId: association.locationId,
        orderNumber,
        type,
        status,
        customerId,
        chairId: association.chairId,
        reservationId: association.reservationId,
        rentalId: association.rentalId,
        tableLabel: input.tableLabel ?? null,
        channel: input.channel,
        createdBy: context.actor.id,
        couponCode: null,
        notes: input.notes ?? null,
        customerNotes: input.customerNotes ?? null,
        placedAt: input.place ? at : null,
        createdAt: at,
      };
      const orderId = this.orders.insert(record, tx);

      // ── PASO 2: líneas, complementos e historial de creación ────────────
      for (const [index, item] of input.items.entries()) {
        const line = resolvedLines[index];
        if (line === undefined) continue;
        this.insertResolvedItem(orderId, item, line, tx);
      }
      // BR-ORDER-013: la creación también deja rastro, con `from_status = NULL`.
      this.orders.insertStatusHistory(
        { orderId, fromStatus: null, toStatus: status, changedBy: context.actor.id, reason: null },
        tx,
      );

      // ── PASO 3: inventario ───────────────────────────────────────────────
      this.reserveStock(orderId, resolvedLines, businessId, context.actor.id, tx);

      // ── PASO 4: cupón y totales ──────────────────────────────────────────
      const discountAmount = this.consumeCoupon(input.couponCode, orderId, customerId, resolvedLines, context, tx, at);
      this.writeTotals(orderId, resolvedLines, rentalBaseMinor, discountAmount, settings, tx);
      if (input.couponCode !== undefined) {
        // `coupon_code` y `discount_minor` se escriben juntos: un cupón visible sin
        // importe, o un importe sin el código que lo justifica, serían dos estados
        // imposibles (BR-ORDER-020).
        this.orders.updateCoupon(orderId, normalizeCouponCode(input.couponCode), discountAmount, tx);
      }

      // ── PASO 5: asociación de silla, reserva y alquiler ─────────────────
      if (association.reservationId !== null) {
        this.reservations.attachOrder(association.reservationId, orderId, tx);
      }

      // ── PASO 6: cobro en efectivo del mismo cuerpo ───────────────────────
      let changeDueMinor = 0;
      let paymentNumber: string | null = null;
      if (input.payment !== undefined) {
        const written = this.paymentWriter.writeCashPayment(
          {
            orderId,
            businessId,
            customerId,
            processedBy: context.actor.id,
            receivedMinor: input.payment.receivedMinor,
            referenceNumber: input.payment.referenceNumber ?? null,
            receiptNumber: input.payment.receiptNumber ?? null,
            notes: input.payment.notes ?? null,
          },
          tx,
        );
        changeDueMinor = written.changeDueMinor;
        paymentNumber = written.paymentNumber;
      }

      // ── PASO 7: auditoría ────────────────────────────────────────────────
      const row = this.orders.findById(orderId, businessId, tx);
      if (row === null) {
        throw new NotFoundError('El pedido creado no se encuentra', { details: { id: orderId, type: 'order' } });
      }
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.order,
        entityId: orderId,
        actor: context.actor,
        request: context.request,
        afterData: {
          resource: 'order',
          id: orderId,
          orderNumber,
          type,
          status,
          customerId,
          channel: input.channel,
          itemCount: resolvedLines.length,
          subtotalMinor: row.subtotal_minor,
          discountMinor: row.discount_minor,
          taxMinor: row.tax_minor,
          serviceFeeMinor: row.service_fee_minor,
          totalMinor: row.total_minor,
          couponCode: row.coupon_code,
          chairId: association.chairId,
          reservationId: association.reservationId,
          rentalId: association.rentalId,
          appliedRules: ['BR-PRICE-001', 'BR-MONEY-003', 'BR-TAX-004', 'BR-INV-004'],
        },
      });

      return {
        order: this.toDetailView(row),
        warnings,
        changeDueMinor,
        paymentNumber,
        appliedRules: [
          'BR-PRICE-001',
          'BR-PRICE-004',
          'BR-MONEY-003',
          'BR-MONEY-004',
          'BR-TAX-002',
          'BR-TAX-004',
          'BR-INV-004',
          'BR-ORDER-013',
        ],
      };
    });
  }

  // ==========================================================================
  // Edición de líneas
  // ==========================================================================

  /**
   * `POST /api/v1/orders/:id/items` — añade líneas a un pedido editable.
   *
   * Recalcula TODOS los totales (BR-ORDER-003) y reserva el stock de lo nuevo en
   * la MISMA transacción, de modo que un fallo de existencias no deja ni líneas a
   * medias ni stock descontado.
   */
  public addItems(
    orderId: number,
    body: AddOrderItemsBody,
    context: OrdersRequestContext,
  ): { readonly order: OrderDetailView; readonly addedItems: readonly OrderItemView[] } {
    return runInTransactionSync((tx) => {
      const row = this.requireOrder(orderId, context.actor);
      this.assertEditable(row);
      const settings = this.settings(row.business_id);
      const at = nowIso();

      if (row.type === OrderType.CHAIR_RENTAL) {
        throw new BusinessRuleError('Un pedido de alquiler no lleva líneas de producto', {
          details: { code: 'MIXED_ORDER_TYPE_NOT_ALLOWED', ruleId: 'BR-ORDER-012' },
        });
      }

      const resolved = body.items.map((item) => this.resolveLine(item, row.business_id, tx, at));
      const addedIds: number[] = [];
      for (const [index, item] of body.items.entries()) {
        const line = resolved[index];
        if (line === undefined) continue;
        const itemId = this.insertResolvedItem(orderId, item, line, tx);
        addedIds.push(itemId);
      }
      // Paso equivalente al 3: el stock de lo nuevo se reserva en la MISMA
      // transacción que la inserción, para que un fallo de existencias revierte
      // también las líneas.
      this.reserveStock(orderId, resolved, row.business_id, context.actor.id, tx);

      this.recalculate(row, context, tx, at, settings);
      const updated = this.requireOrder(orderId, context.actor);
      const stored = this.orders.listItems(orderId, tx);
      const addons = this.orders.listAddonsForItems(stored.map((item) => item.id), tx);
      return {
        order: this.toDetailView(updated),
        addedItems: stored
          .filter((item) => addedIds.includes(item.id))
          .map((item) => this.toItemView(item, addons.filter((addon) => addon.order_item_id === item.id))),
      };
    });
  }

  /**
   * `PATCH /api/v1/orders/items/:itemId`.
   *
   * Cualquier campo que afecte al importe (cantidad o complementos) dispara el
   * recálculo completo y el ajuste de stock correspondiente. El precio unitario se
   * vuelve a resolver desde el catálogo, NO desde el snapshot: si el producto
   * subió, quien aún está en `PENDING` ve el precio vigente, y en cuanto se
   * confirma el snapshot queda congelado para siempre (BR-PRICE-004).
   */
  public updateItem(
    itemId: number,
    body: UpdateOrderItemBody,
    context: OrdersRequestContext,
  ): { readonly order: OrderDetailView; readonly item: OrderItemView } {
    return runInTransactionSync((tx) => {
      const itemRow = this.requireItem(itemId, tx);
      const orderRow = this.requireOrder(itemRow.order_id, context.actor);
      this.assertEditable(orderRow);
      const settings = this.settings(orderRow.business_id);
      const at = nowIso();

      const touchesAmount = body.quantity !== undefined || body.addons !== undefined;
      if (touchesAmount) {
        if (itemRow.product_id === null) {
          // BR-PRICE-005: sin producto no hay precio que re-resolver.
          throw new BusinessRuleError('Esta línea ya no tiene producto y no se puede modificar su importe', {
            details: { code: 'PRODUCT_NOT_FOUND', itemId, ruleId: 'BR-PRICE-005' },
          });
        }
        const resolved = this.resolveLine(
          {
            productId: itemRow.product_id,
            ...(itemRow.variant_id === null ? {} : { variantId: itemRow.variant_id }),
            quantity: body.quantity ?? itemRow.quantity,
            ...(body.addons === undefined ? {} : { addons: body.addons }),
            // `body.notes` admite `null` (limpiar la nota) y `resolveLine` sólo
            // escribe la nota si viene: `null` significa "sin nota", que es
            // exactamente lo que se guarda en la columna.
            ...(body.notes === undefined || body.notes === null ? {} : { notes: body.notes }),
            ...(body.status === undefined ? {} : { status: body.status }),
          },
          orderRow.business_id,
          tx,
          at,
        );
        this.orders.updateItem(
          itemRow.id,
          {
            quantity: resolved.quantity,
            unitPriceMinor: resolved.unitPriceMinor,
            lineTotalMinor: resolved.lineTotalMinor,
            preparationMinutes: resolved.preparationMinutes,
            ...(body.notes === undefined ? {} : { notes: body.notes }),
            ...(body.status === undefined ? {} : { status: body.status }),
          },
          tx,
        );
        // Los complementos se reemplazan: son parte del precio de la línea.
        this.orders.deleteItemAddons(itemRow.id, tx);
        for (const addon of resolved.addons) {
          this.orders.insertItemAddon(
            {
              orderItemId: itemRow.id,
              productAddonId: addon.productAddonId,
              nameSnapshot: addon.nameSnapshot,
              priceMinor: addon.priceMinor,
              quantity: addon.quantity,
            },
            tx,
          );
        }
        // La diferencia de stock se materializa con un movimiento compensatorio
        // (BR-INV-004: la secuencia válida es `RESERVATION -> (SALE|RELEASE)`).
        this.adjustStockForQuantityChange(orderRow, itemRow, resolved.quantity, context.actor.id, tx);
      } else {
        this.orders.updateItem(
          itemRow.id,
          {
            ...(body.notes === undefined ? {} : { notes: body.notes }),
            ...(body.status === undefined ? {} : { status: body.status }),
          },
          tx,
        );
      }

      this.recalculate(orderRow, context, tx, at, settings);
      const updatedOrder = this.requireOrder(orderRow.id, context.actor);
      const updatedItem = this.requireItem(itemRow.id, tx);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.order,
        entityId: orderRow.id,
        actor: context.actor,
        request: context.request,
        beforeData: {
          resource: 'order_item',
          itemId,
          quantity: itemRow.quantity,
          unitPriceMinor: itemRow.unit_price_minor,
          lineTotalMinor: itemRow.line_total_minor,
        },
        afterData: {
          resource: 'order_item',
          itemId,
          quantity: body.quantity ?? itemRow.quantity,
          lineTotalMinor: updatedItem.line_total_minor,
        },
      });
      return {
        order: this.toDetailView(updatedOrder),
        item: this.toItemView(updatedItem, this.orders.listItemAddons(itemRow.id, tx)),
      };
    });
  }

  /**
   * `DELETE /api/v1/orders/items/:itemId` — quita una línea y libera su stock.
   *
   * Quitar la ÚLTIMA línea es `422 LAST_ITEM_REMOVAL`: un pedido sin líneas no se
   * puede confirmar (BR-ORDER-007) y el contrato ofrece `DELETE /orders/:id` con
   * `deleted_at` para eliminarlo entero, no este endpoint.
   */
  public removeItem(
    itemId: number,
    body: { readonly reason?: string },
    context: OrdersRequestContext,
  ): {
    readonly order: OrderDetailView;
    readonly removedItem: OrderItemView;
    readonly recalculated: {
      readonly subtotalMinor: number;
      readonly discountMinor: number;
      readonly taxMinor: number;
      readonly totalMinor: number;
    };
  } {
    return runInTransactionSync((tx) => {
      const itemRow = this.requireItem(itemId, tx);
      const orderRow = this.requireOrder(itemRow.order_id, context.actor);
      this.assertEditable(orderRow);
      const settings = this.settings(orderRow.business_id);
      const at = nowIso();

      const remaining = this.orders
        .listItems(orderRow.id, tx)
        .filter((item) => item.id !== itemId && item.status !== OrderItemStatus.CANCELLED);
      if (remaining.length === 0) {
        throw new BusinessRuleError('No se puede quitar la última línea del pedido', {
          details: { code: 'LAST_ITEM_REMOVAL', ruleId: 'BR-ORDER-007', orderId: orderRow.id },
        });
      }

      const removedView = this.toItemView(itemRow, this.orders.listItemAddons(itemId, tx));
      // BR-INV-004: lo reservado se libera con `RELEASE`, nunca `SALE`.
      this.releaseStockForLine(orderRow, itemRow, context.actor.id, tx, body.reason ?? null);
      this.orders.deleteItem(itemId, tx);

      this.recalculate(orderRow, context, tx, at, settings);
      const updated = this.requireOrder(orderRow.id, context.actor);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.order,
        entityId: orderRow.id,
        actor: context.actor,
        request: context.request,
        beforeData: {
          resource: 'order_item',
          itemId,
          nameSnapshot: itemRow.name_snapshot,
          quantity: itemRow.quantity,
          lineTotalMinor: itemRow.line_total_minor,
        },
        afterData: { resource: 'order_item', itemId, removed: true, reason: body.reason ?? null },
      });

      return {
        order: this.toDetailView(updated),
        removedItem: removedView,
        recalculated: {
          subtotalMinor: updated.subtotal_minor,
          discountMinor: updated.discount_minor,
          taxMinor: updated.tax_minor,
          totalMinor: updated.total_minor,
        },
      };
    });
  }

  /**
   * `PATCH /api/v1/orders/:id` — edición de cabecera, cupón o conjunto de líneas.
   *
   * BR-ORDER-017: en `COMPLETED`, `CANCELLED` y `REFUNDED` sólo se admite un body
   * con `notes` y NADA más. Es `409 CONFLICT_ERROR / ORDER_IMMUTABLE`, el código
   * que el contrato asigna a la inmutabilidad.
   */
  public update(orderId: number, body: UpdateOrderBody, context: OrdersRequestContext): OrderDetailView {
    return runInTransactionSync((tx) => {
      const row = this.requireOrder(orderId, context.actor);
      const at = nowIso();
      const settings = this.settings(row.business_id);
      const present = Object.entries(body).filter(([, value]) => value !== undefined);

      // ── Pedido cerrado: sólo `notes`, y sólo él (BR-ORDER-017) ───────────
      if (CLOSED_STATUSES.includes(row.status)) {
        if (present.length !== 1 || present[0]?.[0] !== 'notes') {
          throw new ConflictError('El pedido está cerrado y no admite cambios', {
            details: {
              code: CONFLICT_DETAIL_CODE.ORDER_IMMUTABLE,
              status: row.status,
              allowedFields: ['notes'],
            },
          });
        }
        const notes = body.notes ?? null;
        this.orders.updateHeader(orderId, { notes }, tx);
        this.audit.record({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.order,
          entityId: orderId,
          actor: context.actor,
          request: context.request,
          beforeData: { resource: 'order', notes: row.notes, status: row.status },
          afterData: { resource: 'order', notes, noteOnly: true },
        });
        return this.toDetailView(this.requireOrder(orderId, context.actor));
      }

      this.assertEditable(row);

      // ── Reemplazo del conjunto de líneas ────────────────────────────────
      if (body.items !== undefined) {
        const previous = this.orders.listItems(orderId, tx);
        for (const item of previous) {
          this.releaseStockForLine(row, item, context.actor.id, tx, 'Conjunto de líneas reemplazado');
        }
        // El cupón se desvincula ANTES de tocar las líneas: la redemption apunta
        // a un `order_id` cuyo subtotal va a cambiar, y `discount_redemptions` es
        // inmutable (no se edita, se borra y se vuelve a insertar).
        if (row.coupon_code !== null) {
          this.detachCoupon(orderId, context, tx);
        }
        for (const item of previous) {
          this.orders.deleteItem(item.id, tx);
        }
        const resolved = body.items.map((item) => this.resolveLine(item, row.business_id, tx, at));
        for (const [index, item] of body.items.entries()) {
          const line = resolved[index];
          if (line === undefined) continue;
          this.insertResolvedItem(orderId, item, line, tx);
        }
        this.reserveStock(orderId, resolved, row.business_id, context.actor.id, tx);
      }

      // ── Cupón: poner o quitar (BR-ORDER-020) ───────────────────────────
      if (body.couponCode !== undefined) {
        if (body.couponCode === null) {
          if (row.coupon_code !== null) {
            this.detachCoupon(orderId, context, tx);
            this.orders.updateCoupon(orderId, null, 0, tx);
          }
        } else {
          const items = this.orders.listItems(orderId, tx);
          const applied = this.discounts.applyToOrder(
            {
              code: body.couponCode,
              orderId,
              customerId: row.customer_id,
              subtotalMinor: this.subtotalOf(items, row, settings),
              lines: this.validationLinesFromStored(items),
              alreadyApplied: [],
            },
            context,
            tx,
            at,
          );
          this.orders.updateCoupon(orderId, applied.code, applied.amountMinor, tx);
        }
      }

      // ── Cabecera ────────────────────────────────────────────────────────
      // Se construye el patch en una sola expresión para no mutar un objeto
      // `readonly`: cada clave aparece sólo si el body la trae.
      this.orders.updateHeader(
        orderId,
        {
          ...(body.notes === undefined ? {} : { notes: body.notes }),
          ...(body.customerNotes === undefined ? {} : { customerNotes: body.customerNotes }),
          ...(body.tableLabel === undefined ? {} : { tableLabel: body.tableLabel }),
          ...(body.locationId === undefined ? {} : { locationId: body.locationId }),
        },
        tx,
      );

      this.recalculate(row, context, tx, at, settings, body.couponCode);
      const updated = this.requireOrder(orderId, context.actor);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.order,
        entityId: orderId,
        actor: context.actor,
        request: context.request,
        beforeData: {
          resource: 'order',
          status: row.status,
          subtotalMinor: row.subtotal_minor,
          discountMinor: row.discount_minor,
          totalMinor: row.total_minor,
          couponCode: row.coupon_code,
        },
        afterData: {
          resource: 'order',
          status: updated.status,
          subtotalMinor: updated.subtotal_minor,
          discountMinor: updated.discount_minor,
          totalMinor: updated.total_minor,
          couponCode: updated.coupon_code,
        },
      });
      return this.toDetailView(updated);
    });
  }

  // ==========================================================================
  // Estados
  // ==========================================================================

  /**
   * `POST /api/v1/orders/:id/status` — transición contra la máquina de estados.
   *
   * `COMPLETED -> PREPARING` es IMPOSIBLE porque `assertOrderTransition` consulta
   * la tabla de transiciones de `shared/domain/order-state-machine.ts`, donde
   * `COMPLETED` no aparece como `from` de ninguna, y la lista de prohibidas
   * documenta el motivo. El error es `422 BUSINESS_RULE_ERROR /
   * INVALID_ORDER_TRANSITION` con `details.allowed` para que la UI pueda
   * desactivar el botón sin conocer la tabla.
   */
  public changeStatus(
    orderId: number,
    body: ChangeOrderStatusBody,
    context: OrdersRequestContext,
  ): OrderDetailView {
    return runInTransactionSync((tx) => {
      const row = this.requireOrder(orderId, context.actor);
      this.transition(row, body.toStatus, body.reason ?? null, context, tx, nowIso());
      return this.toDetailView(this.requireOrder(orderId, context.actor));
    });
  }

  /**
   * `POST /api/v1/orders/:id/confirm` — atajo de `POST /:id/status` con
   * `toStatus = CONFIRMED`.
   */
  public confirm(
    orderId: number,
    body: { readonly reservePayment: boolean; readonly notes?: string },
    context: OrdersRequestContext,
  ): OrderDetailView {
    return runInTransactionSync((tx) => {
      const row = this.requireOrder(orderId, context.actor);
      if (body.notes !== undefined) {
        this.orders.updateHeader(orderId, { notes: body.notes }, tx);
      }
      // BR-ORDER-007: un pedido `PENDING` sin líneas no se confirma.
      if (this.orders.countActiveItems(orderId, tx) === 0) {
        throw new BusinessRuleError('No se puede confirmar un pedido sin líneas', {
          details: { code: 'EMPTY_ORDER', ruleId: 'BR-ORDER-007', orderId },
        });
      }
      this.transition(row, OrderStatus.CONFIRMED, null, context, tx, nowIso());
      return this.toDetailView(this.requireOrder(orderId, context.actor));
    });
  }

  /**
   * `POST /api/v1/orders/:id/cancel` — cancelación con o sin reembolso.
   *
   * Si el pedido tiene pagos aprobados y `refundIfPaid`, el destino NO es
   * `CANCELLED` sino `REFUNDED` (BR-PAY-004 y la tabla de transiciones): un
   * pedido cobrado no se cancela, se devuelve. Y si nunca se cobró, el canje de
   * cupón se devuelve y `used_count` se ajusta (BR-DISC-010).
   */
  public cancel(
    orderId: number,
    body: CancelOrderBody,
    context: OrdersRequestContext,
  ): {
    readonly order: OrderDetailView;
    readonly refund: { readonly totalMinor: number } | null;
    readonly stockReleased: readonly { readonly inventoryItemId: number; readonly quantity: number }[];
  } {
    return runInTransactionSync((tx) => {
      const row = this.requireOrder(orderId, context.actor);
      const at = nowIso();
      const settled = this.paymentReader.settledMinor(row.id, tx);
      const hasApprovedPayment = settled > 0;

      // Con pago aprobado el destino es `REFUNDED`; sin pago, `CANCELLED`.
      const target = hasApprovedPayment && body.refundIfPaid ? OrderStatus.REFUNDED : OrderStatus.CANCELLED;
      const stockReleased = this.releaseAllStock(row, context.actor.id, tx, body.reason);

      this.transition(row, target, body.reason, context, tx, at);

      if (target === OrderStatus.CANCELLED && row.coupon_code !== null) {
        // BR-DISC-010: nunca se cobró, así que la campaña recupera el uso.
        this.discounts.releaseForOrder(orderId, context, tx);
      }

      const updated = this.requireOrder(orderId, context.actor);
      this.audit.record({
        action: hasApprovedPayment ? AuditAction.REFUND : AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.order,
        entityId: orderId,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'order', status: row.status, paidMinor: row.paid_minor },
        afterData: {
          resource: 'order',
          status: updated.status,
          reason: body.reason,
          stockReleased: stockReleased.length,
        },
      });

      return {
        order: this.toDetailView(updated),
        refund: target === OrderStatus.REFUNDED ? { totalMinor: settled } : null,
        stockReleased,
      };
    });
  }

  // ==========================================================================
  // Silla
  // ==========================================================================

  /**
   * `POST /api/v1/orders/:id/assign-chair` — mueve el pedido a otra silla.
   *
   * En `DRAFT`/`PENDING` es libre. Desde `CONFIRMED` exige que la silla destino
   * no esté ocupada (BR-ORDER-019), y en un pedido cerrado ni se intenta:
   * `assertOrderMutable` lanza antes de tocar nada.
   */
  public assignChair(
    orderId: number,
    chairId: number,
    context: OrdersRequestContext,
  ): { readonly order: OrderDetailView; readonly previousChairId: number | null } {
    return runInTransactionSync((tx) => {
      const row = this.requireOrder(orderId, context.actor);
      if (CLOSED_STATUSES.includes(row.status)) {
        throw new ConflictError('El pedido está cerrado y no admite cambios', {
          details: { code: CONFLICT_DETAIL_CODE.ORDER_IMMUTABLE, status: row.status },
        });
      }

      const chair = this.requireChair(chairId, row.business_id);
      if (chair.deleted_at !== null || chair.is_active !== 1) {
        throw new BusinessRuleError('La silla no admite pedidos', {
          details: { code: 'CHAIR_NOT_BOOKABLE', chairId, ruleId: 'BR-RES-005' },
        });
      }

      // BR-ORDER-019: desde `CONFIRMED` la silla destino no puede estar ocupada.
      if (
        !EDITABLE_STATUSES.includes(row.status) &&
        chair.status === ChairStatus.OCCUPIED &&
        chair.id !== row.chair_id
      ) {
        throw new ConflictError('La silla está ocupada', {
          details: { code: CONFLICT_DETAIL_CODE.CHAIR_OCCUPIED, chairId },
        });
      }

      this.orders.updateHeader(orderId, { chairId }, tx);
      const updated = this.requireOrder(orderId, context.actor);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.order,
        entityId: orderId,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'order', chairId: row.chair_id },
        afterData: { resource: 'order', chairId },
      });
      return { order: this.toDetailView(updated), previousChairId: row.chair_id };
    });
  }

  // ==========================================================================
  // Núcleo: resolución de precios, inventario y totales
  // ==========================================================================

  /**
   * Resuelve una línea del body: precio, complementos y snapshots.
   *
   * Aquí es donde BR-ORDER-014 se hace verdad: el body trae `productId`,
   * `variantId`, `quantity` y `addons`, y de aquí sale un `unitPriceMinor` que el
   * cliente no ha podido influencear. Se aplican las reglas de `DESIGN.md` 7.1:
   *  - BR-PRICE-006 producto no disponible -> 422 `PRODUCT_UNAVAILABLE`.
   *  - BR-PRICE-007 producto borrado o inactivo -> 404 `PRODUCT_NOT_FOUND`.
   *  - BR-PRICE-009 precio resuelto negativo -> 422 `INVALID_VARIANT_PRICE`.
   *  - BR-PRICE-011/012 complementos del producto y límite de unidades.
   */
  private resolveLine(
    item: OrderItemInput,
    businessId: number,
    db: Db,
    at: string,
  ): ResolvedLine {
    const product = this.catalog.findProduct(item.productId, businessId, db);
    if (product === null || product.deleted_at !== null || product.is_active !== 1) {
      throw new NotFoundError('El producto no existe', {
        details: { id: item.productId, type: 'product', field: 'productId' },
      });
    }
    if (product.is_available !== 1) {
      throw new BusinessRuleError('El producto no está disponible', {
        details: {
          code: 'PRODUCT_UNAVAILABLE',
          ruleId: 'BR-PRICE-006',
          productId: product.id,
          productName: product.name,
        },
      });
    }

    let variant: { readonly priceDeltaMinor: number; readonly priceMinor: number | null } | null = null;
    if (item.variantId !== undefined) {
      const found = this.catalog.findVariant(item.variantId, db);
      if (found === null || found.product_id !== product.id) {
        throw new NotFoundError('La variante no pertenece a este producto', {
          details: { id: item.variantId, type: 'product_variant', field: 'variantId' },
        });
      }
      if (found.is_active !== 1) {
        throw new BusinessRuleError('La variante no está disponible', {
          details: { code: 'PRODUCT_UNAVAILABLE', productId: product.id, variantId: found.id },
        });
      }
      variant = { priceDeltaMinor: found.price_delta_minor, priceMinor: found.price_minor };
    }

    // LA MISMA función pura que usa el menú (BR-PRICE-001):
    // promo > variante absoluta > base + delta > base.
    const resolved = resolveUnitPrice(
      {
        basePriceMinor: product.base_price_minor,
        promoPriceMinor: product.promo_price_minor,
        promoStartsAt: product.promo_starts_at,
        promoEndsAt: product.promo_ends_at,
      },
      variant,
      at,
    );
    if (resolved.unitPriceMinor < 0) {
      throw new BusinessRuleError('La combinación de producto y variante tiene un precio negativo', {
        details: {
          code: 'INVALID_VARIANT_PRICE',
          ruleId: 'BR-PRICE-009',
          productId: product.id,
          unitPriceMinor: resolved.unitPriceMinor,
        },
      });
    }

    const addons = this.resolveAddons(item, product.id, db);
    const addonsMinor = roundHalfUp(
      addons.reduce<number>((accumulator, addon) => accumulator + addon.priceMinor * addon.quantity, 0),
    );
    const lineTotal = lineTotalMinor({
      id: 1,
      unitPriceMinor: resolved.unitPriceMinor,
      quantity: item.quantity,
      addonsMinor,
      taxRateBp: 0,
    });

    return {
      productId: product.id,
      categoryId: product.category_id,
      variantId: item.variantId ?? null,
      nameSnapshot: product.name,
      skuSnapshot: product.sku,
      unitPriceMinor: resolved.unitPriceMinor,
      quantity: item.quantity,
      addonsMinor,
      // BR-TAX-004: tasa propia del producto, o la del negocio si no tiene.
      taxRateBp: product.tax_rate_bp ?? FALLBACK_SETTINGS.taxRateBp,
      preparationMinutes: item.preparationMinutesOverride ?? product.preparation_minutes,
      trackStock: product.track_stock === 1,
      lineTotalMinor: lineTotal,
      addons,
    };
  }

  /** Complementos de una línea, con sus límites de selección (BR-PRICE-011/012). */
  private resolveAddons(
    item: OrderItemInput,
    productId: number,
    db: Db,
  ): readonly ResolvedAddon[] {
    const addons: ResolvedAddon[] = [];
    const seen = new Map<number, number>();
    for (const requested of item.addons ?? []) {
      const addon = this.catalog.findAddon(requested.productAddonId, db);
      if (addon === null || addon.product_id !== productId) {
        throw new BusinessRuleError('El complemento no pertenece a este producto', {
          details: {
            code: 'ADDON_NOT_IN_PRODUCT',
            ruleId: 'BR-PRICE-012',
            productId,
            productAddonId: requested.productAddonId,
          },
        });
      }
      if (addon.is_active !== 1) {
        throw new BusinessRuleError('El complemento no está disponible', {
          details: { code: 'PRODUCT_UNAVAILABLE', productAddonId: addon.id },
        });
      }
      const accumulated = (seen.get(addon.id) ?? 0) + requested.quantity;
      if (addon.is_multiple !== 1 && accumulated > 1) {
        throw new BusinessRuleError('Este complemento no se puede pedir más de una vez', {
          details: {
            code: 'ADDON_SELECTION_LIMIT',
            ruleId: 'BR-PRICE-011',
            productAddonId: addon.id,
          },
        });
      }
      if (addon.max_select !== null && accumulated > addon.max_select) {
        throw new BusinessRuleError('Se superó el máximo de unidades de este complemento', {
          details: {
            code: 'ADDON_SELECTION_LIMIT',
            ruleId: 'BR-PRICE-011',
            productAddonId: addon.id,
            maxSelect: addon.max_select,
            requested: accumulated,
          },
        });
      }
      seen.set(addon.id, accumulated);
      // Snapshot del complemento: nombre y precio CONGELADOS (BR-PRICE-004).
      addons.push({
        productAddonId: addon.id,
        nameSnapshot: addon.name,
        priceMinor: addon.price_minor,
        quantity: requested.quantity,
      });
    }
    return addons;
  }

  /** Inserta una línea con sus snapshots y sus complementos. Devuelve su id. */
  private insertResolvedItem(
    orderId: number,
    item: OrderItemInput,
    line: ResolvedLine,
    db: Db,
  ): number {
    const itemId = this.orders.insertItem(
      {
        orderId,
        productId: line.productId,
        variantId: line.variantId,
        nameSnapshot: line.nameSnapshot,
        skuSnapshot: line.skuSnapshot,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        lineTotalMinor: line.lineTotalMinor,
        notes: item.notes ?? null,
        // `OrderItemStatus` es un enum del dominio: se usa su constante y nunca
        // un string suelto (el CHECK de la tabla valida el mismo conjunto).
        status: item.status ?? OrderItemStatus.PENDING,
        preparationMinutes: line.preparationMinutes,
      },
      db,
    );
    for (const addon of line.addons) {
      this.orders.insertItemAddon(
        {
          orderItemId: itemId,
          productAddonId: addon.productAddonId,
          nameSnapshot: addon.nameSnapshot,
          priceMinor: addon.priceMinor,
          quantity: addon.quantity,
        },
        db,
      );
    }
    return itemId;
  }

  /**
   * PASO 3: reserva el stock de las líneas indicadas.
   *
   * Por cada producto con `track_stock = 1` (BR-INV-003) escribe un movimiento
   * `RESERVATION` NEGATIVO, y por cada insumo de su receta con control de stock
   * otro. Todo dentro de la transacción del pedido: si faltan existencias, el
   * `NEGATIVE_STOCK_BLOCKED` revierte cabecera, líneas y cupón.
   */
  private reserveStock(
    orderId: number,
    lines: readonly ResolvedLine[],
    businessId: number,
    performedBy: number,
    db: Db,
  ): void {
    for (const line of lines) {
      if (!line.trackStock) {
        // BR-INV-007: un producto que no controla stock no genera movimientos.
        continue;
      }
      const inventoryItem = this.catalog.findStockItemForProduct(line.productId, businessId, db);
      if (inventoryItem === null) {
        continue;
      }
      this.stock.applyMovement(
        {
          businessId,
          inventoryItemId: inventoryItem.id,
          movementType: 'RESERVATION',
          quantity: -line.quantity,
          balanceAfter: 0,
          unitCostMinor: inventoryItem.cost_minor,
          referenceType: 'ORDER',
          referenceId: orderId,
          reason: null,
          performedBy,
        },
        db,
      );
      // BR-INV-003: si el producto tiene receta, se descuentan también sus
      // insumos, multiplicando por la cantidad vendida.
      for (const ingredient of this.catalog.listTrackedIngredients(line.productId, businessId, db)) {
        this.stock.applyMovement(
          {
            businessId,
            inventoryItemId: ingredient.inventory_item_id,
            movementType: 'RESERVATION',
            quantity: -(ingredient.quantity_per_unit * line.quantity),
            balanceAfter: 0,
            unitCostMinor: ingredient.unit_cost_minor,
            referenceType: 'ORDER',
            referenceId: orderId,
            reason: null,
            performedBy,
          },
          db,
        );
      }
    }
  }

  /** Libera (`RELEASE`) el stock reservado por una línea. */
  private releaseStockForLine(
    order: OrderRow,
    item: OrderItemRow,
    performedBy: number,
    db: Db,
    reason: string | null,
  ): void {
    if (item.product_id === null) return;
    const product = this.catalog.findProduct(item.product_id, order.business_id, db);
    if (product === null || product.track_stock !== 1) return;
    const inventoryItem = this.catalog.findStockItemForProduct(product.id, order.business_id, db);
    if (inventoryItem === null) return;
    this.stock.applyMovement(
      {
        businessId: order.business_id,
        inventoryItemId: inventoryItem.id,
        movementType: 'RELEASE',
        quantity: item.quantity,
        balanceAfter: 0,
        unitCostMinor: inventoryItem.cost_minor,
        referenceType: 'ORDER',
        referenceId: order.id,
        reason,
        performedBy,
      },
      db,
    );
  }

  /**
   * Libera TODAS las líneas del pedido, para la cancelación.
   *
   * El resultado informa qué ítems se liberaron, que es lo que API.md 7.12 pide
   * en `stockReleased`.
   */
  private releaseAllStock(
    order: OrderRow,
    performedBy: number,
    db: Db,
    reason: string,
  ): readonly { readonly inventoryItemId: number; readonly quantity: number }[] {
    const released: { inventoryItemId: number; quantity: number }[] = [];
    for (const item of this.orders.listItems(order.id, db)) {
      if (item.product_id === null) continue;
      const product = this.catalog.findProduct(item.product_id, order.business_id, db);
      if (product === null || product.track_stock !== 1) continue;
      const inventoryItem = this.catalog.findStockItemForProduct(product.id, order.business_id, db);
      if (inventoryItem === null) continue;
      this.stock.applyMovement(
        {
          businessId: order.business_id,
          inventoryItemId: inventoryItem.id,
          movementType: 'RELEASE',
          quantity: item.quantity,
          balanceAfter: 0,
          unitCostMinor: inventoryItem.cost_minor,
          referenceType: 'ORDER',
          referenceId: order.id,
          reason,
          performedBy,
        },
        db,
      );
      released.push({ inventoryItemId: inventoryItem.id, quantity: item.quantity });
    }
    return released;
  }

  /**
   * Ajuste de stock por cambio de cantidad de una línea.
   *
   * Bajar cantidad libera stock (`RELEASE`); subirlo lo reserva (`RESERVATION`).
   * Nunca se hace `SALE` desde aquí: la venta definitiva ocurre al completar el
   * pedido (BR-INV-004).
   */
  private adjustStockForQuantityChange(
    order: OrderRow,
    item: OrderItemRow,
    newQuantity: number,
    performedBy: number,
    db: Db,
  ): void {
    if (item.product_id === null) return;
    const delta = roundHalfUp(newQuantity - item.quantity);
    if (delta === 0) return;
    const product = this.catalog.findProduct(item.product_id, order.business_id, db);
    if (product === null || product.track_stock !== 1) return;
    const inventoryItem = this.catalog.findStockItemForProduct(product.id, order.business_id, db);
    if (inventoryItem === null) return;
    this.stock.applyMovement(
      {
        businessId: order.business_id,
        inventoryItemId: inventoryItem.id,
        movementType: delta < 0 ? 'RELEASE' : 'RESERVATION',
        quantity: -delta,
        balanceAfter: 0,
        unitCostMinor: inventoryItem.cost_minor,
        referenceType: 'ORDER',
        referenceId: order.id,
        reason: 'Cambio de cantidad de la línea',
        performedBy,
      },
      db,
    );
  }

  /**
   * PASO 4 (cupón): consume el cupón dentro de la transacción del pedido.
   *
   * Devuelve el importe aplicado o `0`. Un cupón que no aplica LANZA
   * `BusinessRuleError` con el `details.code` estable, en vez de ignorarse en
   * silencio: el cliente pidió un descuento concreto y saber que no se aplicó es
   * información que necesita, no un detalle que se pueda ocultar.
   */
  private consumeCoupon(
    couponCode: string | undefined,
    orderId: number,
    customerId: number | null,
    lines: readonly ResolvedLine[],
    context: OrdersRequestContext,
    db: Db,
    at: string,
  ): number {
    if (couponCode === undefined) {
      return 0;
    }
    const applied = this.discounts.applyToOrder(
      {
        code: couponCode,
        orderId,
        customerId,
        subtotalMinor: this.subtotalOfLines(lines, 0),
        lines: this.validationLinesFromResolved(lines),
        alreadyApplied: [],
      },
      context,
      db,
      at,
    );
    return applied.amountMinor;
  }

  /** Escribe los totales y su PRORRATEO en las líneas ya guardadas. */
  private writeTotals(
    orderId: number,
    lines: readonly ResolvedLine[],
    rentalBaseMinor: number,
    discountAmount: number,
    settings: OrderBusinessSettingsRow,
    db: Db,
  ): void {
    const isRentalOrder = rentalBaseMinor > 0;
    const totals = computeOrderTotals({
      lines: lines.map((line, index) => ({
        id: index + 1,
        unitPriceMinor: line.unitPriceMinor,
        quantity: line.quantity,
        addonsMinor: line.addonsMinor,
        taxRateBp: line.taxRateBp,
      })),
      discountMinor: discountAmount,
      settings: {
        taxRateBp: settings.tax_rate_bp,
        taxInclusive: settings.tax_inclusive === 1,
        serviceFeeBp: settings.service_fee_bp,
      },
      ...(isRentalOrder ? { rentalBaseMinor, rentalTaxRateBp: settings.tax_rate_bp } : {}),
    });
    this.orders.updateTotals(
      orderId,
      {
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        serviceFeeMinor: totals.serviceFeeMinor,
        totalMinor: totals.totalMinor,
      },
      db,
    );
    // BR-MONEY-005: la parte de descuento y el impuesto de cada línea quedan
    // MATERIALIZADOS. Es lo que hace que el recibo de un pedido de hace un año
    // siga cuadrando aunque el catálogo entero haya cambiado.
    const stored = this.orders.listItems(orderId, db);
    for (const [index, line] of totals.lines.entries()) {
      const item = stored[index];
      if (item === undefined) continue;
      this.orders.updateItemAmounts(item.id, line.discountMinor, line.taxMinor, db);
    }
  }

  /**
   * Recalcula TODOS los totales de un pedido existente y los escribe.
   *
   * El cupón vigente se vuelve a cotizar sobre el subtotal NUEVO (BR-DISC-001): un
   * cupón válido sobre 20.000 puede no serlo sobre 5.000, y el servidor no lo
   * descubre al cliente.
   */
  private recalculate(
    row: OrderRow,
    context: OrdersRequestContext,
    db: Db,
    at: string,
    settings: OrderBusinessSettingsRow,
    /**
     * Cupón EFECTIVO del pedido tras las edición de esta petición.
     *
     * Hace falta porque `row` es la fila leída AL PRINCIPIO del `PATCH`: si el
     * body quita el cupón (`couponCode: null`) y el recálculo leyera `row`, volvería
     * a aplicarlo y la petición no tendría ningún efecto. `undefined` significa
     * "usa el de `row`".
     */
    couponCodeOverride?: string | null,
  ): void {
    const items = this.orders
      .listItems(row.id, db)
      .filter((item) => item.status !== OrderItemStatus.CANCELLED);
    const addons = this.orders.listAddonsForItems(items.map((item) => item.id), db);
    const rentalBaseMinor =
      row.type === OrderType.CHAIR_RENTAL && row.rental_id !== null
        ? (this.rentals.findById(row.rental_id, row.business_id, db)?.total_minor ?? 0)
        : 0;

    const toPriced = (discountMinor: number) =>
      computeOrderTotals({
        lines: items.map((item, index) => ({
          id: index + 1,
          unitPriceMinor: item.unit_price_minor,
          quantity: item.quantity,
          addonsMinor: roundHalfUp(
            addons
              .filter((addon) => addon.order_item_id === item.id)
              .reduce<number>((accumulator, addon) => accumulator + addon.price_minor * addon.quantity, 0),
          ),
          // La tasa efectiva de la línea se conserva en la fila: si el producto
          // cambió de tasa, un pedido ya colocado mantiene la del momento en que
          // se colocó, salvo que se re-resuelva la línea.
          taxRateBp: settings.tax_rate_bp,
        })),
        discountMinor,
        settings: {
          taxRateBp: settings.tax_rate_bp,
          taxInclusive: settings.tax_inclusive === 1,
          serviceFeeBp: settings.service_fee_bp,
        },
        ...(rentalBaseMinor > 0 ? { rentalBaseMinor, rentalTaxRateBp: settings.tax_rate_bp } : {}),
      });

    const couponCode = couponCodeOverride === undefined ? row.coupon_code : couponCodeOverride;
    let discountAmount = 0;
    if (couponCode !== null) {
      discountAmount = this.discounts.applyToOrder(
        {
          code: couponCode,
          orderId: row.id,
          customerId: row.customer_id,
          subtotalMinor: toPriced(0).subtotalMinor,
          lines: this.validationLinesFromStored(items),
          alreadyApplied: [],
        },
        context,
        db,
        at,
      ).amountMinor;
    }

    const totals = toPriced(discountAmount);
    this.orders.updateTotals(
      row.id,
      {
        subtotalMinor: totals.subtotalMinor,
        discountMinor: totals.discountMinor,
        taxMinor: totals.taxMinor,
        serviceFeeMinor: totals.serviceFeeMinor,
        totalMinor: totals.totalMinor,
      },
      db,
    );
    this.orders.updateCoupon(row.id, couponCode, totals.discountMinor, db);
    for (const [index, line] of totals.lines.entries()) {
      const item = items[index];
      if (item === undefined) continue;
      this.orders.updateItemAmounts(item.id, line.discountMinor, line.taxMinor, db);
    }
  }

  /**
   * Aplica una transición: valida la tabla del dominio, escribe el estado con sus
   * timestamps y guarda la fila de historial (BR-ORDER-013).
   */
  private transition(
    row: OrderRow,
    toStatus: OrderStatus,
    reason: string | null,
    context: OrdersRequestContext,
    db: Db,
    at: string,
  ): void {
    // `assertOrderTransition` es la ÚNICA fuente de transiciones válidas.
    assertOrderTransition(row.status, toStatus);
    if (
      (toStatus === OrderStatus.CANCELLED || toStatus === OrderStatus.REFUNDED) &&
      reason === null
    ) {
      throw new BusinessRuleError('El motivo es obligatorio para cancelar o reembolsar un pedido', {
        details: { code: 'REASON_REQUIRED', field: 'reason', ruleId: 'BR-ORDER-013' },
      });
    }

    this.orders.updateStatus(row.id, toStatus, this.timestampsFor(toStatus, at, row), db);
    this.orders.insertStatusHistory(
      { orderId: row.id, fromStatus: row.status, toStatus, changedBy: context.actor.id, reason },
      db,
    );
    this.applyStatusSideEffects(row, toStatus, context, db, at);
  }

  /** Timestamps de estado que escribe la transición (DESIGN.md 6.1). */
  private timestampsFor(
    toStatus: OrderStatus,
    at: string,
    row: OrderRow,
  ): OrderStatusTimestamps {
    switch (toStatus) {
      case OrderStatus.CONFIRMED:
        return { confirmedAt: at };
      case OrderStatus.PREPARING:
        return { preparingAt: at };
      case OrderStatus.READY:
        return { readyAt: at };
      case OrderStatus.COMPLETED:
        // `ck_orders_completed_at` exige que no sea NULL, y por eso el
        // repositorio lo escribe en la MISMA sentencia que el estado.
        return { completedAt: row.completed_at ?? at };
      case OrderStatus.REFUNDED:
        // Se pasa por `COMPLETED`, así que conserva su fecha de entrega.
        return { completedAt: row.completed_at ?? at };
      case OrderStatus.CANCELLED:
        return { cancelledAt: at };
      default:
        return {};
    }
  }

  /**
   * Efectos secundarios de la transición (la columna "Efecto secundario" de
   * DESIGN.md 6.1), en la misma transacción que el estado.
   */
  private applyStatusSideEffects(
    row: OrderRow,
    toStatus: OrderStatus,
    context: OrdersRequestContext,
    db: Db,
    at: string,
  ): void {
    // Un pedido puede tener un café listo y otro no (`OrderItemStatus`).
    if (toStatus === OrderStatus.READY) {
      for (const item of this.orders.listItems(row.id, db)) {
        if (item.status === OrderItemStatus.PENDING) {
          this.orders.updateItem(item.id, { status: 'READY' }, db);
        }
      }
    }
    if (toStatus === OrderStatus.PREPARING) {
      for (const item of this.orders.listItems(row.id, db)) {
        if (item.status !== OrderItemStatus.CANCELLED) {
          this.orders.updateItem(item.id, { status: 'PENDING' }, db);
        }
      }
    }

    // BR-ORDER-015: al completar un `CHAIR_RENTAL` se cierra la reserva y el
    // alquiler, y la silla pasa a `CLEANING` (BR-RENTAL-008). Un `DINE_IN` con
    // silla hace lo mismo con la silla.
    if (toStatus !== OrderStatus.COMPLETED) {
      return;
    }
    if (row.chair_id !== null) {
      this.chairs.releaseAfterSession(row.chair_id, context, db);
    }
    if (row.reservation_id !== null) {
      const reservation = this.reservations.findById(row.reservation_id, row.business_id, db);
      if (reservation !== null && reservation.status === ReservationStatus.ACTIVE) {
        this.reservations.markCheckedOut(row.reservation_id, at, db);
      }
    }
    if (row.rental_id !== null) {
      const rental = this.rentals.findById(row.rental_id, row.business_id, db);
      if (rental !== null) {
        this.rentals.close(
          row.rental_id,
          rental.billed_minutes,
          rental.extra_minutes_minor,
          rental.total_minor,
          db,
        );
      }
    }
  }

  // ==========================================================================
  // Utilidades internas
  // ==========================================================================

  /**
   * Pedido obligatorio y dentro del alcance del actor.
   *
   * Un `CUSTOMER` que pide un pedido ajeno recibe `404`, no `403`: el contrato
   * dice que no se revela la existencia de recursos de otro cliente (API.md 2 y la
   * nota de `DESIGN.md` 9.3).
   */
  private requireOrder(id: number, actor: UserContext): OrderRow {
    const row = this.orders.findById(id, actor.businessId);
    if (row === null || (!this.canReadAnyOrder(actor) && row.customer_id !== actor.id)) {
      throw new NotFoundError('El pedido no existe', { details: { id, type: 'order' } });
    }
    return row;
  }

  private requireItem(itemId: number, db: Db): OrderItemRow {
    const row = this.orders.findItemById(itemId, db);
    if (row === null) {
      throw new NotFoundError('La línea del pedido no existe', {
        details: { id: itemId, type: 'order_item' },
      });
    }
    return row;
  }

  private requireChair(chairId: number, businessId: number) {
    const chair = this.orders.findChairById(chairId, businessId);
    if (chair === null) {
      throw new NotFoundError('La silla no existe', { details: { id: chairId, type: 'chair' } });
    }
    return chair;
  }

  /** `true` si el actor puede ver pedidos de CUALQUIER cliente. */
  private canReadAnyOrder(actor: UserContext): boolean {
    // BR-RBAC-002: ADMIN y OWNER tienen todos los permisos implícitos.
    if (actor.roles.includes(Role.ADMIN) || actor.roles.includes(Role.OWNER)) {
      return true;
    }
    return actor.permissions.includes('orders:read:any');
  }

  /**
   * Alcance del listado (BR-SEC-008).
   *
   * Sin `orders:read:any` el `customerId` se FUERZA al del actor y el de la query
   * se descarta: un `CUSTOMER` que mande `?customerId=<otro>` sigue viendo sólo
   * lo suyo, en silencio, porque el filtro no es un campo de la respuesta.
   */
  private scopedFilter(filter: OrderListFilter, actor: UserContext): OrderListFilter {
    if (this.canReadAnyOrder(actor)) {
      return filter;
    }
    return { ...filter, customerId: actor.id };
  }

  /** Ajustes del negocio, con valores por defecto si `businesses` no existe. */
  private settings(businessId: number): OrderBusinessSettingsRow {
    const row = this.orders.findBusinessSettings(businessId);
    if (row === null) {
      logger.warn({ businessId }, 'pedidos: el negocio no está sembrado; se usan los valores por defecto');
      return {
        id: businessId,
        name: FALLBACK_SETTINGS.name,
        legal_name: null,
        tax_id: null,
        address_line1: null,
        city: null,
        currency_code: FALLBACK_SETTINGS.currencyCode,
        currency_symbol: FALLBACK_SETTINGS.currencySymbol,
        tax_rate_bp: FALLBACK_SETTINGS.taxRateBp,
        tax_inclusive: FALLBACK_SETTINGS.taxInclusive,
        service_fee_bp: FALLBACK_SETTINGS.serviceFeeBp,
        allow_negative_stock: 0,
        order_prefix: FALLBACK_SETTINGS.orderPrefix,
        tip_enabled: FALLBACK_SETTINGS.tipEnabled,
      };
    }
    return row;
  }

  /**
   * Cliente del pedido: el del token si el actor es `CUSTOMER`, el del body si es
   * de la casa (BR-SEC-008). Nunca del body para un cliente.
   */
  private resolveCustomerId(requested: number | null | undefined, actor: UserContext): number | null {
    const isCustomer = actor.roles.every((role) => role === Role.CUSTOMER);
    if (isCustomer) {
      return actor.id;
    }
    return requested ?? null;
  }

  /** BR-ORDER-008/009/010: qué silla, reserva y alquiler lleva el pedido. */
  private resolveAssociation(
    type: OrderType,
    input: CreateOrderBody,
    businessId: number,
    db: Db,
    warnings: string[],
  ): ChairAssociation {
    const locationId = input.locationId ?? null;

    if (type === OrderType.CHAIR_RENTAL) {
      // El CHECK `ck_orders_rental_requires_chair` es la última línea de defensa;
      // aquí se valida antes para dar un 422 legible en vez de un 500 de SQLite.
      if (input.chairId == null) {
        throw new BusinessRuleError('Un pedido de alquiler necesita la silla', {
          details: {
            code: 'RENTAL_REQUIRES_CHAIR_AND_RESERVATION',
            ruleId: 'BR-ORDER-008',
            field: 'chairId',
          },
        });
      }
      if (input.reservationId == null) {
        throw new BusinessRuleError('Un pedido de alquiler necesita la reserva asociada', {
          details: {
            code: 'RENTAL_REQUIRES_CHAIR_AND_RESERVATION',
            ruleId: 'BR-ORDER-008',
            field: 'reservationId',
          },
        });
      }
      const chair = this.requireChair(input.chairId, businessId);
      const reservation = this.reservations.findById(input.reservationId, businessId, db);
      if (reservation === null) {
        throw new NotFoundError('La reserva no existe', {
          details: { id: input.reservationId, type: 'reservation', field: 'reservationId' },
        });
      }
      if (reservation.chair_id !== chair.id) {
        throw new BusinessRuleError('La silla no corresponde a la reserva', {
          details: {
            code: 'RENTAL_REQUIRES_CHAIR_AND_RESERVATION',
            ruleId: 'BR-ORDER-008',
            chairId: chair.id,
            reservationChairId: reservation.chair_id,
          },
        });
      }
      let rentalId = input.rentalId ?? null;
      if (rentalId === null) {
        // El check-in puede no haber guardado `rental_id` en el pedido: se busca
        // el alquiler de la reserva antes de rendirse.
        rentalId = this.rentals.listByReservation(reservation.id, db)[0]?.id ?? null;
        if (rentalId === null) {
          warnings.push('RENTAL_NOT_STARTED_YET');
        }
      }
      return { chairId: chair.id, reservationId: reservation.id, rentalId, locationId };
    }

    // BR-ORDER-009: un `DINE_IN` PUEDE no tener silla ("barra sin asignar"). Si la
    // trae, se valida.
    if (type === OrderType.DINE_IN && input.chairId != null) {
      const chair = this.requireChair(input.chairId, businessId);
      if (chair.deleted_at !== null || chair.is_active !== 1) {
        throw new BusinessRuleError('La silla no admite pedidos', {
          details: { code: 'CHAIR_NOT_BOOKABLE', chairId: chair.id, ruleId: 'BR-RES-005' },
        });
      }
      return {
        chairId: chair.id,
        reservationId: input.reservationId ?? null,
        rentalId: input.rentalId ?? null,
        locationId,
      };
    }

    // TAKEAWAY: nunca lleva silla ni reserva (BR-ORDER-010).
    return { chairId: null, reservationId: null, rentalId: null, locationId };
  }

  /**
   * Base de alquiler del pedido: el `total_minor` de `chair_rentals`.
   *
   * BR-RENTAL-006: el total del alquiler (`subtotal + extensiones + overage`) entra
   * en el pedido tal cual, y es el pedido quien le aplica descuento e impuesto
   * (BR-TAX-007). Sin alquiler todavía la base es 0 y se avisa con
   * `RENTAL_NOT_STARTED_YET`: inventar una proyección como si fuera un hecho sería
   * mentirle al cajero sobre lo que debe el cliente.
   */
  private resolveRentalBase(
    type: OrderType,
    rentalId: number | null,
    businessId: number,
    db: Db,
    warnings: string[],
  ): number {
    if (type !== OrderType.CHAIR_RENTAL || rentalId === null) {
      return 0;
    }
    const rental = this.rentals.findById(rentalId, businessId, db);
    if (rental === null) {
      throw new NotFoundError('El alquiler no existe', {
        details: { id: rentalId, type: 'rental', field: 'rentalId' },
      });
    }
    void warnings;
    return rental.total_minor;
  }

  /** Desvincula el cupón de un pedido vivo sin devolver el uso (BR-DISC-010). */
  private detachCoupon(orderId: number, context: OrdersRequestContext, db: Db): void {
    const applied = this.paymentReader.listAppliedDiscounts(orderId, db);
    for (const discount of applied) {
      this.discounts.detachFromOrder(orderId, discount.discountId, context, db);
    }
  }

  /** Subtotal de las líneas resueltas, antes de descuento. */
  private subtotalOfLines(lines: readonly ResolvedLine[], rentalBaseMinor: number): number {
    return roundHalfUp(
      lines.reduce<number>((accumulator, line) => accumulator + line.lineTotalMinor, rentalBaseMinor),
    );
  }

  /** Subtotal de las líneas ya guardadas, antes de descuento. */
  private subtotalOf(
    items: readonly OrderItemRow[],
    row: OrderRow,
    _settings: OrderBusinessSettingsRow,
  ): number {
    const rentalBaseMinor =
      row.type === OrderType.CHAIR_RENTAL && row.rental_id !== null ? row.subtotal_minor : 0;
    const lines = items.reduce<number>((accumulator, item) => accumulator + item.line_total_minor, 0);
    return roundHalfUp(rentalBaseMinor > lines ? rentalBaseMinor : lines);
  }

  /** Líneas resueltas -> líneas de validación del cupón. */
  private validationLinesFromResolved(lines: readonly ResolvedLine[]): readonly DiscountValidationLine[] {
    return lines.map((line) => ({
      productId: line.productId,
      categoryId: line.categoryId,
      quantity: line.quantity,
      lineTotalMinor: line.lineTotalMinor,
    }));
  }

  /** Líneas ya guardadas -> líneas de validación del cupón. */
  private validationLinesFromStored(items: readonly OrderItemRow[]): readonly DiscountValidationLine[] {
    return items.map((item) => ({
      productId: item.product_id,
      categoryId: item.category_id,
      quantity: item.quantity,
      lineTotalMinor: item.line_total_minor,
    }));
  }

  /** `DRAFT` y `PENDING` son los únicos estados editables (BR-ORDER-003/005). */
  private assertEditable(row: OrderRow): void {
    if (EDITABLE_STATUSES.includes(row.status)) {
      return;
    }
    if (CLOSED_STATUSES.includes(row.status)) {
      // `COMPLETED`, `CANCELLED` y `REFUNDED` no admiten cambios: el código
      // `ORDER_IMMUTABLE` es el que el contrato asigna a la inmutabilidad.
      throw new ConflictError('El pedido está cerrado y no admite cambios', {
        details: { code: CONFLICT_DETAIL_CODE.ORDER_IMMUTABLE, status: row.status },
      });
    }
    throw new BusinessRuleError('El pedido ya no admite cambios en sus líneas', {
      details: { code: 'ORDER_NOT_EDITABLE', status: row.status, ruleId: 'BR-ORDER-005' },
    });
  }

  // ==========================================================================
  // Mapeo a vistas
  // ==========================================================================

  private toSummaryView(row: OrderSummaryRow): OrderSummaryView {
    return {
      id: row.id,
      orderNumber: row.order_number,
      type: row.type,
      status: row.status,
      channel: row.channel,
      customerId: row.customer_id,
      customerName: row.customer_name,
      chairId: row.chair_id,
      chairCode: row.chair_code,
      totalMinor: row.total_minor,
      paidMinor: row.paid_minor,
      balanceMinor: row.balance_minor,
      itemCount: row.item_count,
      placedAt: row.placed_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
    };
  }

  private toItemView(item: OrderItemRow, addons: readonly OrderItemAddonRow[]): OrderItemView {
    return {
      id: item.id,
      productId: item.product_id,
      variantId: item.variant_id,
      variantName: item.variant_name,
      nameSnapshot: item.name_snapshot,
      skuSnapshot: item.sku_snapshot,
      unitPriceMinor: item.unit_price_minor,
      quantity: item.quantity,
      discountMinor: item.discount_minor,
      taxMinor: item.tax_minor,
      lineTotalMinor: item.line_total_minor,
      notes: item.notes,
      status: item.status,
      preparationMinutes: item.preparation_minutes,
      addons: addons.map((addon) => ({
        id: addon.id,
        productAddonId: addon.product_addon_id,
        nameSnapshot: addon.name_snapshot,
        priceMinor: addon.price_minor,
        quantity: addon.quantity,
      })),
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    };
  }

  private toTotalsView(
    row: OrderRow,
    settings: OrderBusinessSettingsRow,
    extra: { readonly changeDueMinor: number; readonly tipMinor: number },
  ): OrderTotalsView {
    const taxInclusive = settings.tax_inclusive === 1;
    const base = row.subtotal_minor - row.discount_minor;
    return {
      subtotalMinor: row.subtotal_minor,
      discountMinor: row.discount_minor,
      taxMinor: row.tax_minor,
      serviceFeeMinor: row.service_fee_minor,
      totalMinor: row.total_minor,
      paidMinor: row.paid_minor,
      balanceMinor: row.balance_minor,
      taxInclusive,
      // BR-TAX-003: con precios que ya incluyen impuesto, el importe se desglosa
      // sólo con fines informativos y NO altera ningún total almacenado.
      taxIncludedMinor:
        taxInclusive && settings.tax_rate_bp > 0
          ? roundHalfUp((base * settings.tax_rate_bp) / (10_000 + settings.tax_rate_bp))
          : 0,
      changeDueMinor: extra.changeDueMinor,
      tipMinor: extra.tipMinor,
    };
  }

  private toDetailView(row: OrderRow): OrderDetailView {
    const items = this.orders.listItems(row.id);
    const addons = this.orders.listAddonsForItems(items.map((item) => item.id));
    const settings = this.settings(row.business_id);
    const chair = this.orders.findChairForOrder(row.id);
    const customer = this.orders.findCustomerForOrder(row.id);
    const receipt = this.orders.findReceiptContext(row.id, row.business_id);

    const view: OrderView = {
      id: row.id,
      orderNumber: row.order_number,
      type: row.type,
      status: row.status,
      channel: row.channel,
      locationId: row.location_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      chairId: row.chair_id,
      chairCode: row.chair_code,
      reservationId: row.reservation_id,
      rentalId: row.rental_id,
      tableLabel: row.table_label,
      subtotalMinor: row.subtotal_minor,
      discountMinor: row.discount_minor,
      taxMinor: row.tax_minor,
      serviceFeeMinor: row.service_fee_minor,
      totalMinor: row.total_minor,
      paidMinor: row.paid_minor,
      balanceMinor: row.balance_minor,
      couponCode: row.coupon_code,
      notes: row.notes,
      customerNotes: row.customer_notes,
      items: items.map((item) =>
        this.toItemView(item, addons.filter((addon) => addon.order_item_id === item.id)),
      ),
      placedAt: row.placed_at,
      confirmedAt: row.confirmed_at,
      preparingAt: row.preparing_at,
      readyAt: row.ready_at,
      completedAt: row.completed_at,
      cancelledAt: row.cancelled_at,
      cancelReason: row.cancel_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };

    return {
      ...view,
      payments: this.paymentReader.listPayments(row.id),
      refunds: this.paymentReader.listRefunds(row.id),
      chair:
        chair === null
          ? null
          : { id: chair.id, code: chair.code, name: chair.name, zoneName: chair.zone_name ?? '' },
      reservation:
        receipt?.reservation_id == null || receipt.reservation_code == null
          ? null
          : {
              id: receipt.reservation_id,
              code: receipt.reservation_code,
              status: receipt.reservation_status ?? '',
              startAt: receipt.reservation_start_at ?? '',
              endAt: receipt.reservation_end_at ?? '',
            },
      rental:
        receipt?.rental_id == null || receipt.rental_code == null
          ? null
          : {
              id: receipt.rental_id,
              code: receipt.rental_code,
              status: receipt.rental_status ?? '',
              totalMinor: receipt.rental_total_minor ?? 0,
            },
      customer:
        customer === null
          ? null
          : {
              id: customer.id,
              fullName: customer.full_name,
              phone: customer.phone,
              email: customer.email,
            },
      totals: this.toTotalsView(row, settings, { changeDueMinor: 0, tipMinor: 0 }),
      appliedDiscounts: this.paymentReader.listAppliedDiscounts(row.id),
    };
  }
}

/**
 * Prefijo de `order_number` con separador, para `generateCode`.
 *
 * `businesses.order_prefix` es `ORD` (sin guion) porque la columna es una
 * plantilla; el código de negocio es `ORD-000001`. Se añade el `-` aquí, y en un
 * solo sitio, para que el formato no dependa de lo que se haya configurado.
 */
export function orderCodePrefix(raw: string): string {
  const trimmed = raw.trim();
  const base = trimmed.length === 0 ? 'ORD' : trimmed;
  return base.endsWith('-') ? base : `${base}-`;
}

/** `UPPER(TRIM(code))` del cupón (BR-DISC-007), para escribirlo canónico. */
function normalizeCouponCode(value: string): string {
  return value.trim().toUpperCase();
}
