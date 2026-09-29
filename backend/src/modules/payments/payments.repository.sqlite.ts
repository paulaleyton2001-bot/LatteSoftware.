/**
 * Implementación SQLite del repositorio de pagos.
 *
 * ÚNICO fichero con SQL de `payments` y `payment_refunds` (DESIGN.md 3.2).
 *
 * ============================================================================
 * DECISIÓN DEL CLIENTE: NO HAY PASARELA
 * ============================================================================
 * Todo lo que hay aquí es LOCAL. No hay ninguna llamada de red, ningún cliente
 * HTTP, ningún webhook y ningún cliente de proveedor. `provider` y
 * `provider_reference` se rellenan con los dos únicos valores del negocio:
 * `CASH_REGISTRY` (la caja) y `CARD_TERMINAL` (el datáfono), y
 * `provider_reference` es el número de aprobación que anota el cajero — NO un
 * PAN (BR-SEC-006).
 *
 * ============================ CUATRO DETALLES QUE IMPORTAN =================
 * 1. **`ux_payments_idempotency` es un índice de EXPRESIÓN** sobre
 *    `json_extract(metadata, '$.idempotency_key')`. La búsqueda de la clave se
 *    hace con la MISMA expresión, nunca con un `metadata LIKE`: un `LIKE` sobre
 *    JSON daría falsos positivos y dejaría de ser idempotente.
 * 2. **`refunded_minor` se DERIVA, no se escribe** (BR-PAY-012). El CHECK
 *    `ck_payments_refunded` es la garantía final de que no supere el importe.
 * 3. **`paid_minor` y `balance_minor` se escriben JUNTOS** con el total que pasa
 *    el service: no hay forma de que queden descuadrados.
 * 4. **`payments.order_id` es `ON DELETE RESTRICT`**: un pago no se borra nunca.
 *    Por eso `insertOrderStatusHistory` y `updateOrderStatus` viven aquí: el
 *    módulo de pagos es el que completa el pedido, y su repositorio es el que
 *    tiene que tocar `orders` para mantener la escritura en una sola capa.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import { BusinessRuleError } from '../../shared/errors/index.js';
import { isEnumValue, OrderStatus, PaymentStatus } from '../../shared/domain/index.js';
import type {
  NewPaymentRecord,
  NewRefundRecord,
  PaymentBusinessSettingsRow,
  PaymentListFilter,
  PaymentOrderRow,
  PaymentPatch,
  PaymentRow,
  PaymentsRepository,
  PaymentSortColumn,
  PaymentTotalsRow,
} from './payments.repository.js';
import type { PaymentRefundRow } from './payments.types.js';

/** Columnas base de `payments`, con los JOIN de presentación. */
const PAYMENT_COLUMNS = `
  pay.id, pay.business_id, pay.order_id, pay.payment_number, pay.method, pay.provider,
  pay.provider_reference, pay.status, pay.amount_minor, pay.refunded_minor,
  pay.currency_code, pay.reference_number, pay.receipt_number, pay.notes,
  pay.processed_by, pay.customer_id, pay.approved_at, pay.failed_at, pay.failure_reason,
  pay.created_at, pay.updated_at, pay.metadata,
  o.order_number AS order_number,
  pb.full_name AS processed_by_name,
  cu.full_name AS customer_name
`;

/** `FROM` con los tres LEFT JOIN de presentación. */
const PAYMENT_FROM = `
  FROM payments pay
  LEFT JOIN orders o  ON o.id  = pay.order_id
  LEFT JOIN users  pb ON pb.id = pay.processed_by
  LEFT JOIN users  cu ON cu.id = pay.customer_id
`;

/**
 * Expresión de idempotencia. Es la MISMA que usa el índice único parcial
 * `ux_payments_idempotency`, y debe seguirla al pie de la letra: si las dos
 * divergen, la garantía de unicidad deja de aplicarse.
 */
const IDEMPOTENCY_KEY_SQL = "json_extract(pay.metadata, '$.idempotency_key')";

/** Allowlist de columnas ordenables: nunca se interpola entrada del cliente. */
const SORT_SQL: Readonly<Record<PaymentSortColumn, string>> = Object.freeze({
  created_at: 'pay.created_at',
  amount_minor: 'pay.amount_minor',
  approved_at: 'pay.approved_at',
});

/** Estados cuyo importe cuenta como pagado (BR-MONEY-006). */
const SETTLED_SQL = "('APPROVED','PARTIALLY_REFUNDED')";

/** Escapa los comodines de `LIKE` en el texto buscado por el cliente. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** `WHERE` compartido por `list`, `count` y `totals`. */
function buildWhere(filter: Omit<PaymentListFilter, 'limit' | 'offset' | 'sort'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = ['pay.business_id = ?'];
  const params: unknown[] = [filter.businessId];

  if (filter.orderId !== undefined) {
    clauses.push('pay.order_id = ?');
    params.push(filter.orderId);
  }
  if (filter.method !== undefined) {
    clauses.push('pay.method = ?');
    params.push(filter.method);
  }
  if (filter.provider !== undefined) {
    clauses.push('pay.provider = ?');
    params.push(filter.provider);
  }
  if (filter.status !== undefined) {
    clauses.push('pay.status = ?');
    params.push(filter.status);
  }
  if (filter.customerId !== undefined) {
    clauses.push('pay.customer_id = ?');
    params.push(filter.customerId);
  }
  if (filter.referenceNumber !== undefined) {
    clauses.push("pay.reference_number LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(filter.referenceNumber)}%`);
  }
  if (filter.from !== undefined) {
    clauses.push('pay.created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('pay.created_at < ?');
    params.push(filter.to);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de pagos sobre `better-sqlite3`. */
export class SqlitePaymentsRepository implements PaymentsRepository {
  public findBusinessSettings(
    businessId: number,
    db: Db = getConnection(),
  ): PaymentBusinessSettingsRow | null {
    const row = db
      .prepare(
        `SELECT id, currency_code, currency_symbol, tip_enabled, default_tips_bp
           FROM businesses
          WHERE id = ?`,
      )
      .get(businessId) as PaymentBusinessSettingsRow | undefined;
    return row ?? null;
  }

  public findById(id: number, businessId: number, db: Db = getConnection()): PaymentRow | null {
    const row = db
      .prepare(
        `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
          WHERE pay.id = ? AND pay.business_id = ?`,
      )
      .get(id, businessId) as PaymentRow | undefined;
    return row ?? null;
  }

  /**
   * BR-PAY-001: la clave se busca con la MISMA expresión del índice único.
   *
   * Se llama DENTRO de la transacción, antes del `INSERT` y otra vez después de
   * una violación de `ux_payments_idempotency`: en ese segundo caso recupera el
   * pago ganador y el servicio lo devuelve con `200` en lugar de un error.
   */
  public findByIdempotencyKey(
    key: string,
    businessId: number,
    db: Db = getConnection(),
  ): PaymentRow | null {
    const row = db
      .prepare(
        `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
          WHERE ${IDEMPOTENCY_KEY_SQL} = ? AND pay.business_id = ?
          LIMIT 1`,
      )
      .get(key, businessId) as PaymentRow | undefined;
    return row ?? null;
  }

  public list(filter: PaymentListFilter, db: Db = getConnection()): readonly PaymentRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, pay.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as PaymentRow[];
  }

  public count(
    filter: Omit<PaymentListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM payments pay WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  /**
   * Agregados de `meta.totals`.
   *
   * `approved_minor` suma los pagos liquidados; `refunded_minor` los reembolsados
   * y `net_minor` la diferencia, que es la caja real del periodo. El desglose por
   * método sale de dos sumas condicionales, porque sólo existen `CASH` y `CARD`.
   */
  public totals(
    filter: Omit<PaymentListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): PaymentTotalsRow {
    const where = buildWhere(filter);
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN pay.status IN ${SETTLED_SQL} THEN pay.amount_minor ELSE 0 END), 0)
                 AS approved_minor,
                COALESCE(SUM(pay.refunded_minor), 0) AS refunded_minor,
                COALESCE(SUM(CASE WHEN pay.status IN ${SETTLED_SQL} AND pay.method = 'CASH'
                                  THEN pay.amount_minor ELSE 0 END), 0) AS approved_cash,
                COALESCE(SUM(CASE WHEN pay.status IN ${SETTLED_SQL} AND pay.method = 'CARD'
                                  THEN pay.amount_minor ELSE 0 END), 0) AS approved_card
           FROM payments pay
          WHERE ${where.sql}`,
      )
      .get(...where.params) as PaymentTotalsRow | undefined;
    return row ?? { approved_minor: 0, refunded_minor: 0, approved_cash: 0, approved_card: 0 };
  }

  public listRefunds(paymentId: number, db: Db = getConnection()): readonly PaymentRefundRow[] {
    return db
      .prepare(
        `SELECT r.id, r.payment_id, r.order_id, r.amount_minor, r.reason, r.refunded_by,
                r.provider_reference, r.created_at, u.full_name AS refunded_by_name
           FROM payment_refunds r
           LEFT JOIN users u ON u.id = r.refunded_by
          WHERE r.payment_id = ?
          ORDER BY r.created_at ASC, r.id ASC`,
      )
      .all(paymentId) as PaymentRefundRow[];
  }

  public listRefundsByOrder(orderId: number, db: Db = getConnection()): readonly PaymentRefundRow[] {
    return db
      .prepare(
        `SELECT r.id, r.payment_id, r.order_id, r.amount_minor, r.reason, r.refunded_by,
                r.provider_reference, r.created_at, u.full_name AS refunded_by_name
           FROM payment_refunds r
           LEFT JOIN users u ON u.id = r.refunded_by
          WHERE r.order_id = ?
          ORDER BY r.created_at ASC, r.id ASC`,
      )
      .all(orderId) as PaymentRefundRow[];
  }

  public listByOrder(orderId: number, db: Db = getConnection()): readonly PaymentRow[] {
    return db
      .prepare(
        `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
          WHERE pay.order_id = ?
          ORDER BY pay.created_at DESC, pay.id DESC`,
      )
      .all(orderId) as PaymentRow[];
  }

  /**
   * BR-MONEY-006: `paid_minor` = suma de pagos liquidados menos la suma de sus
   * reembolsos. Se calcula con una subconsulta por pago en lugar de con un
   * `GROUP BY` sobre una unión, que es más legible y no multiplica filas.
   */
  public settledMinor(orderId: number, db: Db = getConnection()): number {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(
                  CASE WHEN pay.status IN ${SETTLED_SQL}
                       THEN pay.amount_minor - pay.refunded_minor
                       ELSE 0 END), 0) AS settled
           FROM payments pay
          WHERE pay.order_id = ?`,
      )
      .get(orderId) as { settled: number } | undefined;
    return row?.settled ?? 0;
  }

  public findOrder(orderId: number, businessId: number, db: Db = getConnection()): PaymentOrderRow | null {
    const row = db
      .prepare(
        `SELECT id, business_id, status, total_minor, paid_minor, balance_minor,
                customer_id, type, deleted_at
           FROM orders
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL`,
      )
      .get(orderId, businessId) as PaymentOrderRow | undefined;
    return row ?? null;
  }

  /**
   * `paid_minor` y `balance_minor` en UNA sentencia.
   *
   * El total llega calculado por el service: si el repositorio lo leyera, un
   * segundo escritor entre la lectura y el UPDATE dejaría los dos campos
   * descuadrados, que es justo lo que BR-MONEY-006 prohíbe.
   */
  public updateOrderPaid(orderId: number, totalMinor: number, paidMinor: number, db: Db = getConnection()): void {
    db.prepare(
      `UPDATE orders SET paid_minor = ?, balance_minor = ? - ? WHERE id = ?`,
    ).run(paidMinor, totalMinor, paidMinor, orderId);
  }

  /**
   * Estado del pedido con su `completed_at` en la misma sentencia.
   *
   * `ck_orders_completed_at` exige `completed_at IS NOT NULL` cuando el estado es
   * `COMPLETED`; escribirlos por separado abriría una ventana en la que el
   * UPDATE es rechazado por el CHECK.
   */
  public updateOrderStatus(
    orderId: number,
    status: string,
    completedAt: string | null,
    db: Db = getConnection(),
  ): void {
    // La validación es contra el enum de PEDIDOS, no contra el de pagos: este
    // método escribe `orders.status` y el error que se quiere es de pedido. Una
    // comprobación contra el enum equivocado rechazaría `CONFIRMED` y
    // `PREPARING` con un mensaje que no ayuda a nadie.
    if (!isEnumValue(OrderStatus, status)) {
      throw new BusinessRuleError('El estado de destino del pedido no es válido', {
        details: { code: 'INVALID_ORDER_TRANSITION', entity: 'orders', field: 'status', value: status },
      });
    }
    db.prepare('UPDATE orders SET status = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?').run(
      status,
      completedAt,
      orderId,
    );
  }

  public insertOrderStatusHistory(
    record: {
      readonly orderId: number;
      readonly fromStatus: string;
      readonly toStatus: string;
      readonly changedBy: number | null;
      readonly reason: string | null;
    },
    db: Db = getConnection(),
  ): number {
    const result = db
      .prepare(
        `INSERT INTO order_status_history (order_id, from_status, to_status, changed_by, reason)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(record.orderId, record.fromStatus, record.toStatus, record.changedBy, record.reason);
    return Number(result.lastInsertRowid);
  }

  public insertOrderNote(orderId: number, note: string, db: Db = getConnection()): void {
    // `notes` es la NOTA INTERNA del pedido (BR-ORDER-017): el apéndice
    // auditable en el que el cajero anota "se devolvieron 200 pesos". Se
    // CONCATENA en vez de sobrescribir para no perder lo que ya había.
    db.prepare(
      `UPDATE orders
          SET notes = CASE WHEN notes IS NULL OR notes = '' THEN ? ELSE notes || char(10) || ? END
        WHERE id = ?`,
    ).run(note, note, orderId);
  }

  public insert(record: NewPaymentRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO payments
             (business_id, order_id, payment_number, method, provider, provider_reference,
              status, amount_minor, currency_code, reference_number, receipt_number, notes,
              processed_by, customer_id, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.orderId,
          record.paymentNumber,
          record.method,
          record.provider,
          record.providerReference,
          // El estado inicial de TODO pago es `PENDING` (BR-PAY-011). El service
          // lo lleva a `APPROVED` en la misma transacción cuando el cobro es
          // local y síncrono, que en este negocio SIEMPRE lo es.
          PaymentStatus.PENDING,
          record.amountMinor,
          record.currencyCode,
          record.referenceNumber,
          record.receiptNumber,
          record.notes,
          record.processedBy,
          record.customerId,
          record.metadata === null ? null : JSON.stringify(record.metadata),
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      throw translateCodeConflict(error);
    }
  }

  public update(id: number, patch: PaymentPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.status !== undefined) {
      assignments.push('status = ?');
      params.push(patch.status);
    }
    if (patch.approvedAt !== undefined) {
      assignments.push('approved_at = ?');
      params.push(patch.approvedAt);
    }
    if (patch.failedAt !== undefined) {
      assignments.push('failed_at = ?');
      params.push(patch.failedAt);
    }
    if (patch.failureReason !== undefined) {
      assignments.push('failure_reason = ?');
      params.push(patch.failureReason);
    }
    if (patch.receiptNumber !== undefined) {
      assignments.push('receipt_number = ?');
      params.push(patch.receiptNumber);
    }
    if (patch.notes !== undefined) {
      assignments.push('notes = ?');
      params.push(patch.notes);
    }
    if (patch.providerReference !== undefined) {
      assignments.push('provider_reference = ?');
      params.push(patch.providerReference);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(id);
    try {
      db.prepare(`UPDATE payments SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateCodeConflict(error);
    }
  }

  /**
   * `refunded_minor` se deriva de la SUMA de `payment_refunds` (BR-PAY-012).
   *
   * La API nunca escribe el campo: escribe el reembolso y este método lo
   * recalcula. El CHECK `ck_payments_refunded` es la garantía final de que la
   * suma no supere el importe, y un reembolso por encima lo traduce aquí a un 422
   * legible en vez de dejarlo como un 500 con el texto del driver.
   */
  public recomputeRefundedMinor(paymentId: number, db: Db = getConnection()): number {
    const payment = db
      .prepare('SELECT amount_minor FROM payments WHERE id = ?')
      .get(paymentId) as { amount_minor: number } | undefined;
    if (payment === undefined) {
      throw new BusinessRuleError('El pago no existe', {
        details: { id: paymentId, type: 'payment' },
      });
    }
    const row = db
      .prepare('SELECT COALESCE(SUM(amount_minor), 0) AS total FROM payment_refunds WHERE payment_id = ?')
      .get(paymentId) as { total: number } | undefined;
    const total = row?.total ?? 0;
    if (total > payment.amount_minor) {
      throw new BusinessRuleError('No se puede reembolsar más de lo que se cobró', {
        details: {
          code: 'REFUND_EXCEEDS_PAID',
          ruleId: 'BR-PAY-006',
          paymentId,
          amountMinor: payment.amount_minor,
          refundedMinor: total,
        },
      });
    }
    db.prepare('UPDATE payments SET refunded_minor = ? WHERE id = ?').run(total, paymentId);
    return total;
  }

  public insertRefund(record: NewRefundRecord, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `INSERT INTO payment_refunds
           (payment_id, order_id, amount_minor, reason, refunded_by, provider_reference)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.paymentId,
        record.orderId,
        record.amountMinor,
        record.reason,
        record.refundedBy,
        record.providerReference,
      );
    return Number(result.lastInsertRowid);
  }
}

/**
 * Traduce la violación de `ux_payments_payment_number` y de
 * `ux_payments_idempotency`.
 *
 * La segunda NO se traduce a un error: es la garantía de BR-PAY-001 y la resuelve
 * el service, que dentro de la transacción vuelve a leer el pago ganador por
 * clave y lo devuelve con `200`. Aquí sólo se distingue el caso para que el
 * service pueda atraparlo por su cuenta.
 */
function translateCodeConflict(error: unknown): unknown {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code: unknown = (error as { code: unknown }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('ux_payments_idempotency')) {
        return error;
      }
    }
  }
  return translateUniqueConstraint(error, {
    code: 'PAYMENT_NUMBER_TAKEN',
    message: 'Ya existe un pago con ese número',
    field: 'paymentNumber',
    index: 'ux_payments_payment_number',
  });
}
