/**
 * Implementación SQLite del repositorio de reportes.
 *
 * ============================================================================
 * ÚNICO FICHERO DEL MÓDULO CON SQL (DESIGN.md 3.1, P3)
 * ============================================================================
 * Reglas que se respetan sin excepción:
 *  - Todo parámetro va con `?` posicional. Ningún texto del cliente se
 *    interpola. Lo único que se interpola son fragmentos SQL INTERNOS: la
 *    expresión de zona horaria (que sale de un plan ya validado) y la
 *    expresión de agrupación (que sale de una allowlist de este fichero).
 *  - La columna de `ORDER BY` sale de una allowlist interna de este fichero.
 *  - No hay ninguna regla de negocio aquí: qué estados cuentan como venta, qué
 *    es "cliente nuevo" o cómo se reparte un importe por método de pago lo
 *    decide `reports.service.ts`.
 *
 * ============================================================================
 * CÓMO SE AGRUPA POR HORA LOCAL DEL NEGOCIO (la parte delicada)
 * ============================================================================
 * Las fechas se guardan como ISO-8601 **UTC** (`2026-09-28T22:18:21.738Z`).
 * Para agrupar por el día o la hora que ve el administrador hay que desplazar el
 * instante a la zona del negocio ANTES de extraer la parte.
 *
 * En SQLite eso es `strftime('%Y-%m-%d', <columna>, <offset> || ' minutes')`,
 * donde `<offset>` son los minutos de la zona respecto de UTC
 * (`America/Bogota` = -300). Un café vendido a las 21:30 de Bogotá está a las
 * 02:30 UTC del día SIGUIENTE: sin el desplazamiento aparecería en la columna
 * equivocada, que es el bug que este módulo no puede tener.
 *
 * Cuando la zona tiene horario de verano hay un offset antes del cambio y otro
 * después, así que el desplazamiento se construye como un `CASE` que compara el
 * instante con la frontera (`zonedShift`). Para `America/Bogota`, que no aplica
 * horario de verano desde 1993, el plan tiene un solo tramo y el `CASE`
 * degenera en un parámetro constante: es el caso normal y también el más rápido.
 *
 * El criterio de agrupación es SEMIABIERTO `[from, to)`, coherente con
 * BR-RES-001: dos periodos consecutivos nunca se solapan ni dejan un hueco de un
 * milisegundo, de modo que la suma de las partes es siempre el total.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { PaymentMethod } from '../../shared/domain/index.js';
import { RENTAL } from '../../config/index.js';
import type {
  ActiveRentalCountRow,
  BreakdownDimension,
  BreakdownRow,
  ChairCapacityRow,
  ChairScopeRow,
  ChairStatusCountRow,
  CustomerRow,
  CustomerTotalsRow,
  DashboardKpisRow,
  DaySeriesRow,
  HourSeriesRow,
  InventoryGroupBy,
  InventoryGroupRow,
  InventoryItemRow,
  InventorySummaryRow,
  OrderTotalsRow,
  OrdersSummaryGroupRow,
  PageRequest,
  PaymentPeriodRow,
  ProductDailyRow,
  ProductOrderBy,
  ProductRevenueTotalsRow,
  ProductSalesRow,
  ProductTotalsRow,
  ReportsRepository,
  RentalRow,
  ReservationRow,
  SalesExportRow,
  SalesPeriodRowRaw,
  SalesTypeRow,
} from './reports.repository.js';
import type { ReportFilters, ReportGrouping } from './reports.types.js';

/**
 * Estados de pedido que CUENTAN como venta.
 *
 * API.md 7.16: se excluyen `CANCELLED` y `REFUNDED` del cálculo de ingresos y
 * **no** se excluye `DRAFT`. Con `includeRefunded` se admite `REFUNDED` para
 * poder auditar lo devuelto; `CANCELLED` nunca entra, porque un pedido anulado
 * no generó ninguna venta.
 */
const REVENUE_SQL = "o.status <> 'CANCELLED'";

/** Igual, pero admitiendo también los reembolsados si el filtro lo pide. */
const REVENUE_WITH_REFUNDED_SQL =
  "o.status <> 'CANCELLED' AND (o.status <> 'REFUNDED' OR ? = 1)";

/** Estados de pago que representan dinero mouvementado. */
const SETTLED_PAYMENT_STATUSES = "('APPROVED','PARTIALLY_REFUNDED','REFUNDED')";

/** Minutos facturables de un alquiler: mínimo de 30 (BR-RENTAL-001). */
const BILLED_MINUTES_SQL = `MAX(r.billed_minutes, ${RENTAL.MIN_BILLED_MINUTES})`;

/**
 * Unidades vendidas de un pedido, como SUBSELECTA correlacionada.
 *
 * Se usa en lugar de `LEFT JOIN order_items` por una razón que no es de estilo:
 * un `JOIN` de líneas contra cabeceras devuelve UNA FILA POR LÍNEA, así que
 * `SUM(o.total_minor)` contaría el total del pedido tantas veces como líneas
 * tenga. Un pedido de dos cafés y una medialuna contaría su total tres veces.
 * La subconsulta mantiene una fila por pedido y además no obliga a agrupar por
 * `o.id`, que es lo que hace la agregación correcta.
 */
const ITEMS_MILLI_SQL = `
  (SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i
    WHERE i.order_id = o.id AND i.status <> 'CANCELLED')`;

/**
 * Minutos REALES de una sesión de alquiler.
 *
 * La tabla `chair_rentals` NO tiene columna `ended_at`: el único registro de lo
 * que el cliente estuvo sentado es `billed_minutes`, y `end_at` es el FIN
 * PLANIFICADO (es el que se mueve al extender). Por eso la duración real se
 * deduce con tres reglas:
 *
 *  - Alquiler `ACTIVE`/`EXTENDED`: todavía no se ha cerrado, así que la sesión
 *    llega hasta `now`.
 *  - Cerrado y `billed_minutes` mayor que el plan: el cliente se pasó de hora y
 *    el plan no lo refleja. Se toma `billed_minutes`, que es la duración real
 *    redondeada al alza (BR-RENTAL-002).
 *  - Cerrado y `billed_minutes` exactamente 30 con un plan más corto: ese 30 es
 *    el MÍNIMO DE FACTURACIÓN de BR-RENTAL-001, no una duración real (el cliente
 *    estuvo 5 minutos). Se toma el plan, porque ocupar la silla 30 minutos
 *    porque así se facturó falsearía la ocupación.
 *
 * Los minutos se redondean con `ROUND`, no con `CAST`: truncar daría 4 minutos
 * a una sesión de 4,999 por el redondeo de coma flotante de `julianday`, y el
 * error se acumularía en cada sesión del rango.
 */
const SESSION_MINUTES_SQL = `
  CASE
    WHEN r.status IN ('ACTIVE','EXTENDED')
      THEN CAST(ROUND(MAX(0, (julianday(?) - julianday(r.start_at)) * 1440)) AS INTEGER)
    WHEN r.billed_minutes = ${RENTAL.MIN_BILLED_MINUTES}
         AND ROUND((julianday(r.end_at) - julianday(r.start_at)) * 1440) < ${RENTAL.MIN_BILLED_MINUTES}
      THEN CAST(ROUND((julianday(r.end_at) - julianday(r.start_at)) * 1440) AS INTEGER)
    ELSE MAX(r.billed_minutes, CAST(ROUND((julianday(r.end_at) - julianday(r.start_at)) * 1440) AS INTEGER))
  END`;

/**
 * Minutos de la sesión que caen DENTRO del rango `[from, to)`.
 *
 * Es el numerador honesto de la ocupación: una sesión que empezó ayer y sigue
 * abierta ocupa la silla de ayer, no la de hoy. Se calcula sobre
 * `start_at + session_minutes`, que es el final real de la sesión deducido
 * arriba, y no sobre `end_at`, que es el plan.
 */
const MINUTES_IN_RANGE_SQL = (alias: string): string => `
  CAST(ROUND(MAX(0, (julianday(MIN(?, datetime(${alias}.start_at, '+' || ${alias}.session_minutes || ' minutes')))
               - julianday(MAX(?, ${alias}.start_at))) * 1440)) AS INTEGER)`;

/** Minutos de overage de un alquiler cerrado (BR-RENTAL-004). */
const OVERTIME_MINUTES_SQL = (alias: string): string => `
  MAX(0, ${alias}.billed_minutes - MAX(${RENTAL.MIN_BILLED_MINUTES},
      CAST(ROUND((julianday(${alias}.end_at) - julianday(${alias}.start_at)) * 1440) AS INTEGER)))`;

/** `TRUE`/`FALSE` de SQL desde un booleano de TypeScript. */
function bool(value: boolean): number {
  return value ? 1 : 0;
}

/**
 * Consulta en construcción: se añaden fragmentos y sus parámetros a la vez.
 *
 * Existe para que el orden de los `?` sea imposible de desalinear. En
 * `better-sqlite3` los parámetros se emparejan por POSICIÓN en el texto de la
 * consulta, así que un `SELECT` con doce subconsultas obliga a repetir doce
 * veces el mismo `WHERE` y a acertar el orden a mano; con este constructor cada
 * par (SQL, parámetros) viaja unido y no se puede desalinear.
 */
class QueryBuilder {
  private readonly parts: string[] = [];
  private readonly values: unknown[] = [];

  /**
   * Añade un fragmento con sus parámetros, en el orden en que se escriben.
   *
   * Los fragmentos se unen con COMA y salto de línea: por eso `sql` empieza
   * siempre por `SELECT` o por `(SELECT ...)` y nunca hace falta acordarse de
   * la puntuación, que es justo lo que se olvida al repetir el mismo `WHERE`
   * doce veces en un `SELECT`.
   */
  public add(sql: string, params: readonly unknown[] = []): this {
    this.parts.push(this.parts.length === 0 ? `SELECT ${sql}` : `, ${sql}`);
    this.values.push(...params);
    return this;
  }

  /**
   * Añade un fragmento SIN coma delante (para el `FROM` que cierra un `SELECT`).
   * Los parámetros se añaden aparte, con {@link pushParams}, porque en un `FROM`
   * no hay columna a la que asociarlos.
   */
  public addRaw(sql: string): this {
    this.parts.push(sql);
    return this;
  }

  /** Añade parámetros SIN añadir un fragmento (los del `WHERE` del `FROM`). */
  public pushParams(params: readonly unknown[]): this {
    this.values.push(...params);
    return this;
  }

  /** Texto completo de la consulta. */
  public get sql(): string {
    return this.parts.join('\n');
  }

  /** Parámetros en el orden textual de los `?`. */
  public get params(): unknown[] {
    return [...this.values];
  }
}

/**
 * Expresión de desplazamiento a la zona del negocio, con sus parámetros.
 *
 * Un tramo (caso de `America/Bogota`): `? || ' minutes'`, un parámetro.
 * Varios tramos (zona con horario de verano dentro del rango): un `CASE` que
 * elige el offset según si el instante cae antes o después de cada frontera.
 */
function zonedShift(column: string, filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  const segments = filters.plan.segments;
  if (segments.length <= 1) {
    return { sql: `(? || ' minutes')`, params: [filters.plan.offsetMinutes ?? 0] };
  }
  const whens: string[] = [];
  const params: unknown[] = [];
  for (const segment of [...segments].reverse()) {
    whens.push(`WHEN julianday(${column}) >= julianday(?) THEN ?`);
    params.push(segment.fromUtc, segment.offsetMinutes);
  }
  whens.push('ELSE ?');
  params.push(segments[segments.length - 1]?.offsetMinutes ?? 0);
  return { sql: `(${whens.join(' ')})`, params };
}

/** `strftime('%Y-%m-%d', <col>, <offset> || ' minutes')`: día local del negocio. */
function localDateSql(column: string, filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  const shift = zonedShift(column, filters);
  return { sql: `strftime('%Y-%m-%d', ${column}, ${shift.sql})`, params: shift.params };
}

/** Hora local (0-23) del negocio. */
function localHourSql(column: string, filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  const shift = zonedShift(column, filters);
  return {
    sql: `CAST(strftime('%H', ${column}, ${shift.sql}) AS INTEGER)`,
    params: shift.params,
  };
}

/** Día de la semana local: 0 = domingo … 6 = sábado. */
function localWeekdaySql(column: string, filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  const shift = zonedShift(column, filters);
  return {
    sql: `CAST(strftime('%w', ${column}, ${shift.sql}) AS INTEGER)`,
    params: shift.params,
  };
}

/** Semana local `YYYY-Www`, tal y como la formatea `strftime('%W')`. */
function localWeekSql(column: string, filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  const shift = zonedShift(column, filters);
  return { sql: `strftime('%Y-W%W', ${column}, ${shift.sql})`, params: shift.params };
}

/** Mes local `YYYY-MM`. */
function localMonthSql(column: string, filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  const shift = zonedShift(column, filters);
  return { sql: `strftime('%Y-%m', ${column}, ${shift.sql})`, params: shift.params };
}

/**
 * Expresión de agrupación por periodo.
 *
 * Allowlist INTERNA: el `switch` cubre exactamente las granularidades de
 * `ReportGrouping` y ninguna otra cosa puede llegar aquí. `status`, `type` y
 * `channel` no dependen de la zona, así que devuelven la columna de `orders`.
 */
function periodSql(
  column: string,
  granularity: ReportGrouping,
  filters: ReportFilters,
): { readonly sql: string; readonly params: readonly unknown[] } {
  switch (granularity) {
    case 'week':
      return localWeekSql(column, filters);
    case 'month':
      return localMonthSql(column, filters);
    case 'hour':
      return localHourSql(column, filters);
    case 'status':
      return { sql: `o.status`, params: [] };
    case 'type':
      return { sql: `o.type`, params: [] };
    case 'channel':
      return { sql: `o.channel`, params: [] };
    case 'day':
    default:
      return localDateSql(column, filters);
  }
}

/** `WHERE` de pedidos del rango, con el criterio de estados que se le pase. */
function orderWhere(
  filters: ReportFilters,
  statusesSql: string,
  options: { readonly includeRefundedFlag?: boolean } = {},
): { readonly sql: string; readonly params: readonly unknown[] } {
  const clauses: string[] = [
    'o.business_id = ?',
    'o.deleted_at IS NULL',
    'o.created_at >= ?',
    'o.created_at < ?',
  ];
  const params: unknown[] = [filters.businessId, filters.fromUtc, filters.toUtc];

  // La bandera precede al fragmento de estados, así que su `?` va en esa misma
  // posición del vector de parámetros.
  if (options.includeRefundedFlag === true) {
    params.push(bool(filters.includeRefunded));
  }
  clauses.push(statusesSql);

  if (filters.locationId !== undefined) {
    clauses.push('o.location_id = ?');
    params.push(filters.locationId);
  }
  if (filters.type !== undefined) {
    clauses.push('o.type = ?');
    params.push(filters.type);
  }
  if (filters.channel !== undefined) {
    clauses.push('o.channel = ?');
    params.push(filters.channel);
  }
  if (filters.paymentMethod !== undefined) {
    clauses.push(
      `EXISTS (SELECT 1 FROM payments pmt
                 WHERE pmt.order_id = o.id
                   AND pmt.method = ?
                   AND pmt.status IN ${SETTLED_PAYMENT_STATUSES})`,
    );
    params.push(filters.paymentMethod);
  }
  return { sql: clauses.join('\n                  AND '), params };
}

/** `WHERE` de pedidos del rango contando también cancelados y reembolsados. */
function anyStatusWhere(filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  return orderWhere(filters, '1 = 1');
}

/** `WHERE` de pedidos del rango que sí computan como venta. */
function revenueWhere(filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  return orderWhere(filters, REVENUE_SQL);
}

/** `WHERE` de pedidos del rango, incluyendo reembolsados si toca. */
function revenueMaybeRefundedWhere(filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  return orderWhere(filters, REVENUE_WITH_REFUNDED_SQL, { includeRefundedFlag: true });
}

/** `WHERE` de sillas del ámbito de ocupación. */
function chairWhere(filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  const clauses: string[] = ['c.is_active = 1', 'c.deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filters.zoneId !== undefined) {
    clauses.push('c.zone_id = ?');
    params.push(filters.zoneId);
  }
  if (filters.locationId !== undefined) {
    clauses.push('z.location_id = ?');
    params.push(filters.locationId);
  }
  if (filters.kind !== undefined) {
    clauses.push('c.kind = ?');
    params.push(filters.kind);
  }
  if (filters.chairId !== undefined) {
    clauses.push('c.id = ?');
    params.push(filters.chairId);
  }
  return { sql: clauses.join(' AND '), params };
}

/** `WHERE` de alquileres que se solapan con `[from, to)`. */
function rentalWhere(filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  const clauses: string[] = [
    'r.business_id = ?',
    "r.status <> 'CANCELLED'",
    'r.start_at < ?',
    'r.end_at > ?',
  ];
  const params: unknown[] = [filters.businessId, filters.toUtc, filters.fromUtc];
  if (filters.chairId !== undefined) {
    clauses.push('r.chair_id = ?');
    params.push(filters.chairId);
  }
  if (filters.zoneId !== undefined) {
    clauses.push('c.zone_id = ?');
    params.push(filters.zoneId);
  }
  if (filters.locationId !== undefined) {
    clauses.push('z.location_id = ?');
    params.push(filters.locationId);
  }
  if (filters.kind !== undefined) {
    clauses.push('c.kind = ?');
    params.push(filters.kind);
  }
  return { sql: clauses.join(' AND '), params };
}

/** `WHERE` de los ítems de inventario del reporte. */
function inventoryWhere(filters: ReportFilters): { readonly sql: string; readonly params: readonly unknown[] } {
  return {
    sql: 'ii.business_id = ? AND ii.deleted_at IS NULL',
    params: [filters.businessId],
  };
}

/** Fila de KPIs vacía: la consulta puede no traer ninguna. */
function emptyKpis(): DashboardKpisRow {
  return {
    orders: 0,
    pending_orders: 0,
    completed_orders: 0,
    cancelled_orders: 0,
    refunded_orders: 0,
    items_milli: 0,
    subtotal_minor: 0,
    discount_minor: 0,
    tax_minor: 0,
    service_fee_minor: 0,
    total_minor: 0,
    refunded_minor: 0,
    customers: 0,
  };
}

/** Fila de totales vacía. */
function emptyOrderTotals(): OrderTotalsRow {
  return {
    orders: 0,
    items_milli: 0,
    items_cancelled_milli: 0,
    subtotal_minor: 0,
    discount_minor: 0,
    tax_minor: 0,
    service_fee_minor: 0,
    total_minor: 0,
    refunded_minor: 0,
    cancelled_orders: 0,
    refunded_orders: 0,
    completed_orders: 0,
    pending_orders: 0,
    preparation_minutes_milli: 0,
    preparation_samples: 0,
    wait_minutes_milli: 0,
    wait_samples: 0,
  };
}

/** Repositorio SQLite de reportes. */
export class SqliteReportsRepository implements ReportsRepository {
  // ==========================================================================
  // Configuración del negocio
  // ==========================================================================

  public findBusinessSettings(
    businessId: number,
    db: Db = getConnection(),
  ): { readonly timezone: string; readonly lowStockThreshold: number } | null {
    const row = db
      .prepare('SELECT timezone, low_stock_alert_threshold FROM businesses WHERE id = ?')
      .get(businessId) as { timezone: string; low_stock_alert_threshold: number } | undefined;
    if (row === undefined) return null;
    return { timezone: row.timezone, lowStockThreshold: row.low_stock_alert_threshold };
  }

  // ==========================================================================
  // Dashboard — 6 consultas fijas, todas agregadas, ninguna N+1
  // ==========================================================================

  /**
   * KPIs del dashboard.
   *
   * Cada subconsulta del `SELECT` es un agregado de una fila; hay un número
   * FIJO de ellas (13) que no depende de cuántas filas haya en `orders`, y la
   * consulta devuelve SIEMPRE una fila. `QueryBuilder` evita que el orden de los
   * `?` se desalinee al repetirse el mismo `WHERE` trece veces.
   */
  public dashboardKpis(filters: ReportFilters, db: Db = getConnection()): DashboardKpisRow {
    const any = anyStatusWhere(filters);
    const revenue = revenueWhere(filters);

    const builder = new QueryBuilder();
    const sub = (sql: string, params: readonly unknown[]): void => {
      builder.add(sql, params);
    };

    sub(`(SELECT COUNT(*) FROM orders o WHERE ${any.sql}) AS orders`, any.params);
    sub(
      `(SELECT COUNT(*) FROM orders o
         WHERE ${any.sql} AND o.status IN ('PENDING','CONFIRMED','PREPARING','READY','DELIVERING'))
         AS pending_orders`,
      any.params,
    );
    sub(`(SELECT COUNT(*) FROM orders o WHERE ${any.sql} AND o.status = 'COMPLETED') AS completed_orders`, any.params);
    sub(`(SELECT COUNT(*) FROM orders o WHERE ${any.sql} AND o.status = 'CANCELLED') AS cancelled_orders`, any.params);
    sub(`(SELECT COUNT(*) FROM orders o WHERE ${any.sql} AND o.status = 'REFUNDED') AS refunded_orders`, any.params);
    sub(
      `(SELECT COALESCE(SUM(i.quantity), 0)
         FROM orders o JOIN order_items i ON i.order_id = o.id
        WHERE ${revenue.sql} AND i.status <> 'CANCELLED') AS items_milli`,
      revenue.params,
    );
    sub(`(SELECT COALESCE(SUM(o.subtotal_minor), 0) FROM orders o WHERE ${revenue.sql}) AS subtotal_minor`, revenue.params);
    sub(`(SELECT COALESCE(SUM(o.discount_minor), 0) FROM orders o WHERE ${revenue.sql}) AS discount_minor`, revenue.params);
    sub(`(SELECT COALESCE(SUM(o.tax_minor), 0) FROM orders o WHERE ${revenue.sql}) AS tax_minor`, revenue.params);
    sub(`(SELECT COALESCE(SUM(o.service_fee_minor), 0) FROM orders o WHERE ${revenue.sql}) AS service_fee_minor`, revenue.params);
    sub(`(SELECT COALESCE(SUM(o.total_minor), 0) FROM orders o WHERE ${revenue.sql}) AS total_minor`, revenue.params);
    sub(
      `(SELECT COALESCE(SUM(p.refunded_minor), 0)
         FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE ${revenue.sql} AND p.status IN ${SETTLED_PAYMENT_STATUSES}) AS refunded_minor`,
      revenue.params,
    );
    sub(
      `(SELECT COUNT(DISTINCT o.customer_id) FROM orders o
         WHERE ${any.sql} AND o.customer_id IS NOT NULL) AS customers`,
      any.params,
    );

    const row = db.prepare(builder.sql).get(...builder.params) as DashboardKpisRow | undefined;
    return row ?? emptyKpis();
  }
  public dashboardBreakdown(
    filters: ReportFilters,
    dimension: BreakdownDimension,
    db: Db = getConnection(),
  ): readonly BreakdownRow[] {
    // Allowlist interna: nunca se interpola un valor del cliente.
    const column =
      dimension === 'channel' ? 'o.channel' : dimension === 'type' ? 'o.type' : 'o.status';
    const revenue = revenueWhere(filters);
    return db
      .prepare(
        `SELECT ${column} AS key,
                COUNT(*) AS orders,
                COALESCE(SUM(o.total_minor), 0) AS total_minor,
                COALESCE(SUM(o.total_minor), 0) AS net_minor
           FROM orders o
          WHERE ${revenue.sql}
          GROUP BY ${column}
          ORDER BY total_minor DESC, key ASC`,
      )
      .all(...revenue.params) as BreakdownRow[];
  }

  public dashboardTopProducts(
    filters: ReportFilters,
    limit: number,
    db: Db = getConnection(),
  ): readonly ProductSalesRow[] {
    const revenue = revenueWhere(filters);
    return db
      .prepare(
        `SELECT i.product_id AS product_id,
                pr.category_id AS category_id,
                i.name_snapshot AS name,
                i.sku_snapshot AS sku,
                cat.name AS category_name,
                COALESCE(SUM(i.quantity), 0) AS quantity_milli,
                COUNT(DISTINCT i.order_id) AS orders,
                CAST(COALESCE(SUM(i.unit_price_minor * i.quantity), 0) AS INTEGER) AS subtotal_minor,
                CAST(COALESCE(SUM(i.discount_minor), 0) AS INTEGER) AS discount_minor,
                CAST(COALESCE(SUM(i.tax_minor), 0) AS INTEGER) AS tax_minor,
                CAST(COALESCE(SUM(i.line_total_minor), 0) AS INTEGER) AS total_minor,
                0 AS refunded_minor,
                CAST(COALESCE(SUM(i.unit_price_minor * i.quantity) / NULLIF(SUM(i.quantity), 0), 0)
                     AS INTEGER) AS unit_price_minor,
                (SELECT ii.cost_minor FROM inventory_items ii
                  WHERE ii.product_id = i.product_id AND ii.deleted_at IS NULL LIMIT 1) AS cost_minor
           FROM order_items i
           JOIN orders o ON o.id = i.order_id
           LEFT JOIN products pr ON pr.id = i.product_id
           LEFT JOIN categories cat ON cat.id = pr.category_id
          WHERE ${revenue.sql}
            AND i.status <> 'CANCELLED'
          GROUP BY i.product_id, i.name_snapshot, i.sku_snapshot, pr.category_id, cat.name
          ORDER BY quantity_milli DESC, total_minor DESC, i.product_id ASC
          LIMIT ?`,
      )
      .all(...revenue.params, limit) as ProductSalesRow[];
  }

  public chairStatusCounts(filters: ReportFilters, db: Db = getConnection()): readonly ChairStatusCountRow[] {
    const chair = chairWhere(filters);
    return db
      .prepare(
        `SELECT c.status AS status,
                COUNT(*) AS chairs,
                COALESCE(SUM(c.capacity), 0) AS capacity
           FROM chairs c JOIN zones z ON z.id = c.zone_id
          WHERE ${chair.sql}
          GROUP BY c.status`,
      )
      .all(...chair.params) as ChairStatusCountRow[];
  }

  public activeRentals(filters: ReportFilters, db: Db = getConnection()): ActiveRentalCountRow {
    const chair = chairWhere(filters);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS active,
                COALESCE(SUM(r.total_minor), 0) AS revenue_minor,
                COALESCE(SUM(r.billed_minutes), 0) AS billed_minutes
           FROM chair_rentals r
           JOIN chairs c ON c.id = r.chair_id
           JOIN zones  z ON z.id = c.zone_id
          WHERE r.business_id = ?
            AND r.status IN ('ACTIVE','EXTENDED')
            AND ${chair.sql}`,
      )
      .get(filters.businessId, ...chair.params) as ActiveRentalCountRow | undefined;
    return row ?? { active: 0, revenue_minor: 0, billed_minutes: 0 };
  }

  public chairCapacity(filters: ReportFilters, db: Db = getConnection()): ChairCapacityRow {
    const chair = chairWhere(filters);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS chairs, COALESCE(SUM(c.capacity), 0) AS capacity
           FROM chairs c JOIN zones z ON z.id = c.zone_id
          WHERE ${chair.sql}`,
      )
      .get(...chair.params) as ChairCapacityRow | undefined;
    return row ?? { chairs: 0, capacity: 0 };
  }

  /**
   * Serie diaria local del rango, con alquileres y clientes nuevos.
   *
   * TRES consultas fijas: pedidos por día, alquileres por día y clientes nuevos
   * por día, las tres ya agregadas. El service las une por clave de día. No hay
   * N+1: el número de consultas no depende del número de días ni de pedidos.
   */
  public dailySeries(filters: ReportFilters, db: Db = getConnection()): readonly DaySeriesRow[] {
    const revenue = revenueWhere(filters);
    const day = localDateSql('o.created_at', filters);
    const rentalDay = localDateSql('r.start_at', filters);
    const firstDay = localDateSql('fc.created_at', filters);

    const orders = db
      .prepare(
        `SELECT ${day.sql} AS date,
                COUNT(*) AS orders,
                ${ITEMS_MILLI_SQL} AS items_milli,
                COALESCE(SUM(o.subtotal_minor), 0) AS subtotal_minor,
                COALESCE(SUM(o.discount_minor), 0) AS discount_minor,
                COALESCE(SUM(o.tax_minor), 0) AS tax_minor,
                COALESCE(SUM(o.service_fee_minor), 0) AS service_fee_minor,
                COALESCE(SUM(o.total_minor), 0) AS total_minor,
                0 AS refunded_minor
           FROM orders o
          WHERE ${revenue.sql}
          GROUP BY date
          ORDER BY date ASC`,
      )
      .all(...day.params, ...revenue.params) as Omit<DaySeriesRow, 'rentals' | 'rental_minutes' | 'rental_revenue_minor' | 'new_customers'>[];

    const rentalClauses = [
      'r.business_id = ?',
      "r.status <> 'CANCELLED'",
      'r.start_at >= ?',
      'r.start_at < ?',
    ];
    const rentalParams: unknown[] = [filters.businessId, filters.fromUtc, filters.toUtc];
    if (filters.zoneId !== undefined) {
      rentalClauses.push('c.zone_id = ?');
      rentalParams.push(filters.zoneId);
    }
    if (filters.locationId !== undefined) {
      rentalClauses.push('z.location_id = ?');
      rentalParams.push(filters.locationId);
    }
    if (filters.kind !== undefined) {
      rentalClauses.push('c.kind = ?');
      rentalParams.push(filters.kind);
    }

    const rentals = db
      .prepare(
        `SELECT ${rentalDay.sql} AS date,
                COUNT(*) AS rentals,
                COALESCE(SUM(CAST(${BILLED_MINUTES_SQL} AS INTEGER)), 0) AS rental_minutes,
                COALESCE(SUM(r.total_minor), 0) AS rental_revenue_minor
           FROM chair_rentals r
           JOIN chairs c ON c.id = r.chair_id
           JOIN zones  z ON z.id = c.zone_id
          WHERE ${rentalClauses.join(' AND ')}
          GROUP BY date
          ORDER BY date ASC`,
      )
      .all(...rentalDay.params, ...rentalParams) as {
      date: string;
      rentals: number;
      rental_minutes: number;
      rental_revenue_minor: number;
    }[];

    // "Cliente nuevo" = su PRIMERA compra histórica cae dentro del rango. La
    // comparación es de INSTANTE, no de día: así un cliente cuya primera compra
    // fue ayer no cuenta como nuevo hoy aunque hoy vuelva a comprar.
    const newCustomers = db
      .prepare(
        `SELECT ${firstDay.sql} AS date, COUNT(*) AS new_customers
           FROM orders fc
          WHERE fc.business_id = ?
            AND fc.deleted_at IS NULL
            AND fc.customer_id IS NOT NULL
            AND fc.status <> 'CANCELLED'
            AND fc.created_at >= ?
            AND fc.created_at < ?
            AND fc.created_at = (SELECT MIN(fo.created_at) FROM orders fo
                                  WHERE fo.business_id = fc.business_id
                                    AND fo.customer_id = fc.customer_id
                                    AND fo.deleted_at IS NULL
                                    AND fo.status <> 'CANCELLED')
          GROUP BY date
          ORDER BY date ASC`,
      )
      .all(...firstDay.params, filters.businessId, filters.fromUtc, filters.toUtc) as {
      date: string;
      new_customers: number;
    }[];

    const rentalByDate = new Map(rentals.map((row) => [row.date, row]));
    const newByDate = new Map(newCustomers.map((row) => [row.date, row]));
    // Un día con alquileres pero sin pedidos (una silla alquilada para tomar un
    // café que se pagó en otro ticket) tiene que salir igual: por eso se hace
    // unión de días y no un `map` sobre los pedidos.
    const byDate = new Map<string, (typeof orders)[number]>();
    for (const row of orders) byDate.set(row.date, row);
    for (const rental of rentals) {
      if (!byDate.has(rental.date)) {
        byDate.set(rental.date, {
          date: rental.date,
          orders: 0,
          items_milli: 0,
          subtotal_minor: 0,
          discount_minor: 0,
          tax_minor: 0,
          service_fee_minor: 0,
          total_minor: 0,
          refunded_minor: 0,
        });
      }
    }
    for (const entry of newByDate) {
      if (!byDate.has(entry[0])) {
        byDate.set(entry[0], {
          date: entry[0],
          orders: 0,
          items_milli: 0,
          subtotal_minor: 0,
          discount_minor: 0,
          tax_minor: 0,
          service_fee_minor: 0,
          total_minor: 0,
          refunded_minor: 0,
        });
      }
    }
    return [...byDate.values()]
      .map((row) => ({
        ...row,
        rentals: rentalByDate.get(row.date)?.rentals ?? 0,
        rental_minutes: rentalByDate.get(row.date)?.rental_minutes ?? 0,
        rental_revenue_minor: rentalByDate.get(row.date)?.rental_revenue_minor ?? 0,
        new_customers: newByDate.get(row.date)?.new_customers ?? 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ==========================================================================
  // Ventas
  // ==========================================================================

  /** Totales agregados del rango, en una fila y con un número fijo de subconsultas. */
  public orderTotals(filters: ReportFilters, db: Db = getConnection()): OrderTotalsRow {
    const any = anyStatusWhere(filters);
    const revenue = revenueWhere(filters);

    const builder = new QueryBuilder();
    const sub = (sql: string, params: readonly unknown[]): void => {
      builder.add(sql, params);
    };

    sub(`(SELECT COUNT(*) FROM orders o WHERE ${revenue.sql}) AS orders`, revenue.params);
    sub(
      `(SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE ${revenue.sql} AND i.status <> 'CANCELLED') AS items_milli`,
      revenue.params,
    );
    sub(
      `(SELECT COALESCE(SUM(i.quantity), 0) FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE ${revenue.sql} AND i.status = 'CANCELLED') AS items_cancelled_milli`,
      revenue.params,
    );
    sub(`(SELECT COALESCE(SUM(o.subtotal_minor), 0) FROM orders o WHERE ${revenue.sql}) AS subtotal_minor`, revenue.params);
    sub(`(SELECT COALESCE(SUM(o.discount_minor), 0) FROM orders o WHERE ${revenue.sql}) AS discount_minor`, revenue.params);
    sub(`(SELECT COALESCE(SUM(o.tax_minor), 0) FROM orders o WHERE ${revenue.sql}) AS tax_minor`, revenue.params);
    sub(`(SELECT COALESCE(SUM(o.service_fee_minor), 0) FROM orders o WHERE ${revenue.sql}) AS service_fee_minor`, revenue.params);
    sub(`(SELECT COALESCE(SUM(o.total_minor), 0) FROM orders o WHERE ${revenue.sql}) AS total_minor`, revenue.params);
    sub(
      `(SELECT COALESCE(SUM(p.refunded_minor), 0) FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE ${revenue.sql} AND p.status IN ${SETTLED_PAYMENT_STATUSES}) AS refunded_minor`,
      revenue.params,
    );
    sub(`(SELECT COUNT(*) FROM orders o WHERE ${any.sql} AND o.status = 'CANCELLED') AS cancelled_orders`, any.params);
    sub(`(SELECT COUNT(*) FROM orders o WHERE ${any.sql} AND o.status = 'REFUNDED') AS refunded_orders`, any.params);
    sub(`(SELECT COUNT(*) FROM orders o WHERE ${any.sql} AND o.status = 'COMPLETED') AS completed_orders`, any.params);
    sub(
      `(SELECT COUNT(*) FROM orders o WHERE ${any.sql}
         AND o.status IN ('PENDING','CONFIRMED','PREPARING','READY','DELIVERING')) AS pending_orders`,
      any.params,
    );
    sub(
      `(SELECT COALESCE(SUM(CAST((julianday(o.completed_at) - julianday(o.preparing_at)) * 1440 AS INTEGER)), 0)
         FROM orders o
         WHERE ${any.sql} AND o.completed_at IS NOT NULL AND o.preparing_at IS NOT NULL)
         AS preparation_minutes_milli`,
      any.params,
    );
    sub(
      `(SELECT COUNT(*) FROM orders o
         WHERE ${any.sql} AND o.completed_at IS NOT NULL AND o.preparing_at IS NOT NULL)
         AS preparation_samples`,
      any.params,
    );
    sub(
      `(SELECT COALESCE(SUM(CAST((julianday(o.ready_at) - julianday(o.placed_at)) * 1440 AS INTEGER)), 0)
         FROM orders o
         WHERE ${any.sql} AND o.ready_at IS NOT NULL AND o.placed_at IS NOT NULL)
         AS wait_minutes_milli`,
      any.params,
    );
    sub(
      `(SELECT COUNT(*) FROM orders o
         WHERE ${any.sql} AND o.ready_at IS NOT NULL AND o.placed_at IS NOT NULL)
         AS wait_samples`,
      any.params,
    );

    const row = db.prepare(builder.sql).get(...builder.params) as OrderTotalsRow | undefined;
    return row ?? emptyOrderTotals();
  }

  public salesByPeriod(
    filters: ReportFilters,
    granularity: ReportGrouping,
    db: Db = getConnection(),
  ): readonly SalesPeriodRowRaw[] {
    const revenue = revenueWhere(filters);
    const anchor = granularity === 'status' || granularity === 'type' || granularity === 'channel' ? 'o.status' : 'o.created_at';
    const period = periodSql(anchor, granularity, filters);
    return db
      .prepare(
        `SELECT ${period.sql} AS period,
                COUNT(*) AS orders,
                ${ITEMS_MILLI_SQL} AS items_milli,
                COALESCE(SUM(o.subtotal_minor), 0) AS subtotal_minor,
                COALESCE(SUM(o.discount_minor), 0) AS discount_minor,
                COALESCE(SUM(o.tax_minor), 0) AS tax_minor,
                COALESCE(SUM(o.service_fee_minor), 0) AS service_fee_minor,
                COALESCE(SUM(o.total_minor), 0) AS total_minor,
                0 AS refunded_minor
           FROM orders o
          WHERE ${revenue.sql}
          GROUP BY period
          ORDER BY period ASC`,
      )
      .all(...period.params, ...revenue.params) as SalesPeriodRowRaw[];
  }

  public salesByPayment(
    filters: ReportFilters,
    granularity: ReportGrouping,
    db: Db = getConnection(),
  ): readonly PaymentPeriodRow[] {
    const revenue = revenueMaybeRefundedWhere(filters);
    const anchor = granularity === 'status' || granularity === 'type' || granularity === 'channel' ? 'o.status' : 'o.created_at';
    const period = periodSql(anchor, granularity, filters);
    return db
      .prepare(
        `SELECT ${period.sql} AS period,
                p.method AS method,
                COUNT(*) AS payments,
                COALESCE(SUM(p.amount_minor - p.refunded_minor), 0) AS amount_minor,
                COALESCE(SUM(p.refunded_minor), 0) AS refunded_minor
           FROM payments p JOIN orders o ON o.id = p.order_id
          WHERE ${revenue.sql}
            AND p.status IN ${SETTLED_PAYMENT_STATUSES}
          GROUP BY period, p.method
          ORDER BY period ASC`,
      )
      .all(...period.params, ...revenue.params) as PaymentPeriodRow[];
  }

  /**
   * Importe de venta por periodo local y tipo de pedido.
   *
   * Es UNA consulta, no una por periodo ni una por tipo: el `GROUP BY` es
   * `(periodo, tipo)` y el service reparte el resultado en dos mapas.
   */
  public salesByType(
    filters: ReportFilters,
    granularity: ReportGrouping,
    db: Db = getConnection(),
  ): readonly SalesTypeRow[] {
    const revenue = revenueWhere(filters);
    const anchor =
      granularity === 'status' || granularity === 'type' || granularity === 'channel'
        ? 'o.status'
        : 'o.created_at';
    const period = periodSql(anchor, granularity, filters);
    return db
      .prepare(
        `SELECT ${period.sql} AS period,
                o.type AS type,
                COUNT(*) AS orders,
                COALESCE(SUM(o.total_minor), 0) AS total_minor
           FROM orders o
          WHERE ${revenue.sql}
          GROUP BY period, o.type
          ORDER BY period ASC`,
      )
      .all(...period.params, ...revenue.params) as SalesTypeRow[];
  }

  public customerCounts(
    filters: ReportFilters,
    db: Db = getConnection(),
  ): { readonly customers: number; readonly newCustomers: number } {
    const any = anyStatusWhere(filters);
    const row = db
      .prepare(
        `SELECT (SELECT COUNT(DISTINCT o.customer_id) FROM orders o
                  WHERE ${any.sql} AND o.customer_id IS NOT NULL) AS customers,
                (SELECT COUNT(*)
                   FROM orders fc
                  WHERE fc.business_id = ?
                    AND fc.deleted_at IS NULL
                    AND fc.customer_id IS NOT NULL
                    AND fc.status <> 'CANCELLED'
                    AND fc.created_at >= ?
                    AND fc.created_at < ?
                    AND fc.created_at = (SELECT MIN(fo.created_at) FROM orders fo
                                          WHERE fo.business_id = fc.business_id
                                            AND fo.customer_id = fc.customer_id
                                            AND fo.deleted_at IS NULL
                                            AND fo.status <> 'CANCELLED')) AS new_customers`,
      )
      .get(...any.params, filters.businessId, filters.fromUtc, filters.toUtc) as
      | { customers: number; new_customers: number }
      | undefined;
    return { customers: row?.customers ?? 0, newCustomers: row?.new_customers ?? 0 };
  }

  // ==========================================================================
  // Series
  // ==========================================================================

  /** Serie por hora LOCAL (0-23). Dos consultas fijas: pedidos y alquileres. */
  public salesByHour(filters: ReportFilters, db: Db = getConnection()): readonly HourSeriesRow[] {
    const revenue = revenueWhere(filters);
    const hour = localHourSql('o.created_at', filters);
    const rentalHour = localHourSql('r.start_at', filters);

    const orders = db
      .prepare(
        `SELECT ${hour.sql} AS hour,
                COUNT(*) AS orders,
                ${ITEMS_MILLI_SQL} AS items_milli,
                COALESCE(SUM(o.total_minor), 0) AS total_minor,
                0 AS refunded_minor
           FROM orders o
          WHERE ${revenue.sql}
          GROUP BY hour
          ORDER BY hour ASC`,
      )
      .all(...hour.params, ...revenue.params) as HourSeriesRow[];

    const rentalClauses = [
      'r.business_id = ?',
      "r.status <> 'CANCELLED'",
      'r.start_at >= ?',
      'r.start_at < ?',
    ];
    const rentalParams: unknown[] = [filters.businessId, filters.fromUtc, filters.toUtc];
    if (filters.zoneId !== undefined) {
      rentalClauses.push('c.zone_id = ?');
      rentalParams.push(filters.zoneId);
    }
    if (filters.locationId !== undefined) {
      rentalClauses.push('z.location_id = ?');
      rentalParams.push(filters.locationId);
    }
    if (filters.kind !== undefined) {
      rentalClauses.push('c.kind = ?');
      rentalParams.push(filters.kind);
    }

    const rentals = db
      .prepare(
        `SELECT ${rentalHour.sql} AS hour,
                COALESCE(SUM(CAST(${BILLED_MINUTES_SQL} AS INTEGER)), 0) AS rental_minutes,
                COALESCE(SUM(r.total_minor), 0) AS rental_revenue_minor
           FROM chair_rentals r
           JOIN chairs c ON c.id = r.chair_id
           JOIN zones  z ON z.id = c.zone_id
          WHERE ${rentalClauses.join(' AND ')}
          GROUP BY hour
          ORDER BY hour ASC`,
      )
      .all(...rentalHour.params, ...rentalParams) as {
      hour: number;
      rental_minutes: number;
      rental_revenue_minor: number;
    }[];

    // Unión de horas, no sólo las de `orders`: un alquiler puede empezar a las
    // 18:00 sin que haya ningún pedido a esa hora, y esa hora debe salir igual
    // con su ingreso de alquiler. Perderla haría que el gráfico por hora
    // mostrara menos ingreso del que realmente hubo.
    const rentalByHour = new Map(rentals.map((row) => [row.hour, row]));
    const merged = new Map<number, HourSeriesRow>();
    for (const row of orders) merged.set(row.hour, row);
    for (const row of rentals) {
      const found = merged.get(row.hour);
      if (found === undefined) {
        merged.set(row.hour, {
          hour: row.hour,
          orders: 0,
          items_milli: 0,
          total_minor: 0,
          refunded_minor: 0,
          rental_minutes: row.rental_minutes,
          rental_revenue_minor: row.rental_revenue_minor,
        });
      }
    }
    return [...merged.values()]
      .map((row) => ({
        ...row,
        rental_minutes: rentalByHour.get(row.hour)?.rental_minutes ?? 0,
        rental_revenue_minor: rentalByHour.get(row.hour)?.rental_revenue_minor ?? 0,
      }))
      .sort((a, b) => a.hour - b.hour);
  }

  public salesByWeekday(
    filters: ReportFilters,
    db: Db = getConnection(),
  ): readonly { readonly weekday: number; readonly orders: number; readonly total_minor: number }[] {
    const revenue = revenueWhere(filters);
    const weekday = localWeekdaySql('o.created_at', filters);
    return db
      .prepare(
        `SELECT ${weekday.sql} AS weekday,
                COUNT(*) AS orders,
                COALESCE(SUM(o.total_minor), 0) AS total_minor
           FROM orders o
          WHERE ${revenue.sql}
          GROUP BY weekday
          ORDER BY weekday ASC`,
      )
      .all(...weekday.params, ...revenue.params) as {
      weekday: number;
      orders: number;
      total_minor: number;
    }[];
  }

  // ==========================================================================
  // Productos
  // ==========================================================================

  /**
   * `SELECT` compartido por el ranking y por el reporte de ingresos.
   *
   * `groupBy` decide qué se agrupa (`i.product_id` o `pr.category_id`) y qué se
   * nombra. Es un `switch` interno, no un valor libre: la columna de `GROUP BY`
   * sale de aquí, nunca del cliente.
   */
  private productSelect(
    filters: ReportFilters,
    groupBy: 'product' | 'category',
  ): { readonly sql: string; readonly params: readonly unknown[] } {
    const revenue = revenueWhere(filters);
    const byProduct = groupBy === 'product';
    const groupColumn = byProduct ? 'i.product_id' : 'pr.category_id';
    const groupName = byProduct ? 'i.name_snapshot' : "COALESCE(cat.name, 'Sin categoría')";
    const groupSku = byProduct ? 'i.sku_snapshot' : 'NULL';
    const groupCategory = byProduct ? 'cat.name' : "COALESCE(cat.name, 'Sin categoría')";
    const cost = byProduct
      ? `(SELECT ii.cost_minor FROM inventory_items ii
           WHERE ii.product_id = i.product_id AND ii.deleted_at IS NULL LIMIT 1)`
      : 'NULL';
    return {
      sql: `SELECT ${groupColumn} AS product_id,
                   pr.category_id AS category_id,
                   ${groupName} AS name,
                   ${groupSku} AS sku,
                   ${groupCategory} AS category_name,
                   COALESCE(SUM(i.quantity), 0) AS quantity_milli,
                   COUNT(DISTINCT i.order_id) AS orders,
                   CAST(COALESCE(SUM(i.unit_price_minor * i.quantity), 0) AS INTEGER) AS subtotal_minor,
                   CAST(COALESCE(SUM(i.discount_minor), 0) AS INTEGER) AS discount_minor,
                   CAST(COALESCE(SUM(i.tax_minor), 0) AS INTEGER) AS tax_minor,
                   CAST(COALESCE(SUM(i.line_total_minor), 0) AS INTEGER) AS total_minor,
                   0 AS refunded_minor,
                   CAST(COALESCE(SUM(i.unit_price_minor * i.quantity) / NULLIF(SUM(i.quantity), 0), 0)
                        AS INTEGER) AS unit_price_minor,
                   ${cost} AS cost_minor
              FROM order_items i
              JOIN orders o ON o.id = i.order_id
              LEFT JOIN products pr ON pr.id = i.product_id
              LEFT JOIN categories cat ON cat.id = pr.category_id
             WHERE ${revenue.sql}
               AND i.status <> 'CANCELLED'
             GROUP BY ${groupColumn}, ${groupName}, pr.category_id, cat.name`,
      params: revenue.params,
    };
  }

  public topProducts(
    filters: ReportFilters,
    orderBy: ProductOrderBy,
    page: PageRequest,
    db: Db = getConnection(),
  ): readonly ProductSalesRow[] {
    const base = this.productSelect(filters, 'product');
    // Allowlist interna: la columna de ORDER BY sale de aquí, no del cliente.
    const order = orderBy === 'revenue' ? 'total_minor DESC' : 'quantity_milli DESC';
    return db
      .prepare(`${base.sql} ORDER BY ${order}, product_id ASC LIMIT ? OFFSET ?`)
      .all(...base.params, page.limit, page.offset) as ProductSalesRow[];
  }

  public countTopProducts(filters: ReportFilters, db: Db = getConnection()): number {
    const base = this.productSelect(filters, 'product');
    const row = db.prepare(`SELECT COUNT(*) AS total FROM (${base.sql})`).get(...base.params) as
      | { total: number }
      | undefined;
    return row?.total ?? 0;
  }

  public productTotals(filters: ReportFilters, db: Db = getConnection()): ProductTotalsRow {
    const revenue = revenueWhere(filters);
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(i.quantity), 0) AS quantity_milli,
                CAST(COALESCE(SUM(i.line_total_minor), 0) AS INTEGER) AS net_minor,
                COUNT(DISTINCT i.product_id) AS products
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE ${revenue.sql} AND i.status <> 'CANCELLED'`,
      )
      .all(...revenue.params)[0] as ProductTotalsRow | undefined;
    return row ?? { quantity_milli: 0, net_minor: 0, products: 0 };
  }

  public productRevenue(
    filters: ReportFilters,
    groupBy: 'product' | 'category',
    page: PageRequest,
    db: Db = getConnection(),
  ): readonly ProductSalesRow[] {
    const base = this.productSelect(filters, groupBy);
    return db
      .prepare(`${base.sql} ORDER BY total_minor DESC, name ASC LIMIT ? OFFSET ?`)
      .all(...base.params, page.limit, page.offset) as ProductSalesRow[];
  }

  public countProductRevenue(
    filters: ReportFilters,
    groupBy: 'product' | 'category',
    db: Db = getConnection(),
  ): number {
    const base = this.productSelect(filters, groupBy);
    const row = db.prepare(`SELECT COUNT(*) AS total FROM (${base.sql})`).get(...base.params) as
      | { total: number }
      | undefined;
    return row?.total ?? 0;
  }

  public productDailySeries(
    filters: ReportFilters,
    groupBy: 'product' | 'category',
    db: Db = getConnection(),
  ): readonly ProductDailyRow[] {
    const revenue = revenueWhere(filters);
    const day = localDateSql('o.created_at', filters);
    const groupColumn = groupBy === 'product' ? 'i.product_id' : 'pr.category_id';
    return db
      .prepare(
        `SELECT ${groupColumn} AS product_id,
                pr.category_id AS category_id,
                ${day.sql} AS date,
                COUNT(DISTINCT i.order_id) AS orders,
                ${ITEMS_MILLI_SQL} AS items_milli,
                CAST(COALESCE(SUM(i.line_total_minor), 0) AS INTEGER) AS total_minor,
                CAST(COALESCE(SUM(i.line_total_minor), 0) AS INTEGER) AS net_minor
           FROM order_items i
           JOIN orders o ON o.id = i.order_id
           LEFT JOIN products pr ON pr.id = i.product_id
          WHERE ${revenue.sql} AND i.status <> 'CANCELLED'
          GROUP BY ${groupColumn}, pr.category_id, date
          ORDER BY date ASC`,
      )
      .all(...day.params, ...revenue.params) as ProductDailyRow[];
  }

  public productRevenueTotals(
    filters: ReportFilters,
    db: Db = getConnection(),
  ): ProductRevenueTotalsRow {
    const revenue = revenueWhere(filters);
    const row = db
      .prepare(
        `SELECT CAST(COALESCE(SUM(i.line_total_minor), 0) AS INTEGER) AS net_minor,
                COUNT(DISTINCT i.product_id) AS products
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE ${revenue.sql} AND i.status <> 'CANCELLED'`,
      )
      .all(...revenue.params)[0] as ProductRevenueTotalsRow | undefined;
    return row ?? { net_minor: 0, products: 0 };
  }

  // ==========================================================================
  // Sillas y alquileres
  // ==========================================================================

  /**
   * Alquileres que se solapan con el rango, con silla, zona y pedido de cobro.
   *
   * UNA consulta. Los minutos de sesión y los minutos dentro del rango se
   * calculan aquí, en SQL, porque dependen del reloj: hacerlo en el service
   * obligaría a traer todas las filas y a recalcular el solape una por una.
   */
  public rentals(filters: ReportFilters, db: Db = getConnection()): readonly RentalRow[] {
    const where = rentalWhere(filters);
    // El `session_minutes` se calcula en una SUBCONSULTA y se reutiliza para
    // recortar la sesión al rango. Calcularlo dos veces con dos fórmulas
    // distintas daría minutos de ocupación distintos de los de duración, y la
    // incoherencia sería invisible hasta que alguien comparase los dos números.
    const inner = new QueryBuilder();
    inner.add(
      `r.id AS rental_id,
              c.id AS chair_id,
              c.code AS chair_code,
              c.name AS chair_name,
              c.kind AS chair_kind,
              c.status AS chair_status,
              z.id AS zone_id,
              z.name AS zone_name,
              r.customer_id AS customer_id,
              r.status AS status,
              r.start_at AS start_at,
              r.end_at AS end_at,
              r.planned_minutes AS planned_minutes,
              r.billed_minutes AS billed_minutes,
              r.price_per_hour_minor AS price_per_hour_minor,
              r.subtotal_minor AS subtotal_minor,
              r.extensions_minor AS extensions_minor,
              r.extra_minutes_minor AS extra_minutes_minor,
              r.total_minor AS total_minor,
              COALESCE((SELECT SUM(ord.tax_minor) FROM orders ord
                         WHERE ord.rental_id = r.id AND ord.deleted_at IS NULL), 0) AS tax_minor,
              COALESCE((SELECT SUM(ord.discount_minor) FROM orders ord
                         WHERE ord.rental_id = r.id AND ord.deleted_at IS NULL), 0) AS discount_minor`,
    );
    inner.add(`${SESSION_MINUTES_SQL} AS session_minutes`, [filters.nowIso]);
    inner.addRaw(
      `FROM chair_rentals r
         JOIN chairs c ON c.id = r.chair_id
         JOIN zones  z ON z.id = c.zone_id
        WHERE ${where.sql}`,
    );
    inner.pushParams(where.params);

    const outer = new QueryBuilder();
    outer.add(
      `t.rental_id, t.chair_id, t.chair_code, t.chair_name, t.chair_kind, t.chair_status,
              t.zone_id, t.zone_name, t.customer_id, t.status, t.start_at, t.end_at,
              t.planned_minutes, t.billed_minutes, t.price_per_hour_minor, t.subtotal_minor,
              t.extensions_minor, t.extra_minutes_minor, t.total_minor, t.tax_minor,
              t.discount_minor, t.session_minutes`,
    );
    outer.add(`${MINUTES_IN_RANGE_SQL('t')} AS minutes_in_range`, [filters.toUtc, filters.fromUtc]);
    outer.add(`${OVERTIME_MINUTES_SQL('t')} AS overtime_minutes`);
    outer.addRaw('FROM (' + inner.sql + ') t ORDER BY t.start_at ASC, t.rental_id ASC');
    // Los parámetros de la SUBCONSULTA van los últimos porque su texto aparece
    // al final, dentro del `FROM`. El orden de `?` es posicional: si se invirtiera,
    // `nowIso` se leería como el límite superior del rango y la consulta fallaría.
    outer.pushParams(inner.params);

    return db.prepare(outer.sql).all(...outer.params) as RentalRow[];
  }

  public reservations(filters: ReportFilters, db: Db = getConnection()): readonly ReservationRow[] {
    const clauses = [
      'res.business_id = ?',
      "res.status NOT IN ('CANCELLED','EXPIRED')",
      'res.start_at < ?',
      'res.end_at > ?',
    ];
    const params: unknown[] = [filters.businessId, filters.toUtc, filters.fromUtc];
    if (filters.zoneId !== undefined) {
      clauses.push('res.zone_id = ?');
      params.push(filters.zoneId);
    }
    if (filters.locationId !== undefined) {
      clauses.push('res.location_id = ?');
      params.push(filters.locationId);
    }
    if (filters.chairId !== undefined) {
      clauses.push('res.chair_id = ?');
      params.push(filters.chairId);
    }
    if (filters.kind !== undefined) {
      clauses.push('c.kind = ?');
      params.push(filters.kind);
    }
    return db
      .prepare(
        `SELECT res.id AS reservation_id,
                res.chair_id AS chair_id,
                res.zone_id AS zone_id,
                res.customer_id AS customer_id,
                res.start_at AS start_at,
                res.end_at AS end_at,
                res.duration_minutes AS duration_minutes,
                res.rental_total_minor AS rental_total_minor,
                CAST(ROUND(MAX(0, (julianday(MIN(?, res.end_at)) - julianday(MAX(?, res.start_at))) * 1440))
                     AS INTEGER) AS minutes_in_range
           FROM chair_reservations res
           JOIN chairs c ON c.id = res.chair_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY res.start_at ASC, res.id ASC`,
      )
      .all(filters.toUtc, filters.fromUtc, ...params) as ReservationRow[];
  }

  public chairsInScope(filters: ReportFilters, db: Db = getConnection()): readonly ChairScopeRow[] {
    const chair = chairWhere(filters);
    return db
      .prepare(
        `SELECT c.id AS chair_id,
                c.code AS code,
                c.name AS name,
                c.kind AS kind,
                c.status AS status,
                z.id AS zone_id,
                z.name AS zone_name,
                c.capacity AS capacity
           FROM chairs c JOIN zones z ON z.id = c.zone_id
          WHERE ${chair.sql}
          ORDER BY z.name ASC, c.code ASC`,
      )
      .all(...chair.params) as ChairScopeRow[];
  }

  // ==========================================================================
  // Clientes
  // ==========================================================================

  public customers(
    filters: ReportFilters,
    orderBy: 'totalSpent' | 'orders' | 'lastOrder' | 'newCustomers',
    page: PageRequest,
    db: Db = getConnection(),
  ): readonly CustomerRow[] {
    const revenue = revenueWhere(filters);
    // Allowlist interna de ordenación: el valor del cliente se mapea aquí.
    const order =
      orderBy === 'orders'
        ? 'orders DESC'
        : orderBy === 'lastOrder'
          ? 'last_order_at DESC'
          : orderBy === 'newCustomers'
            ? 'first_ever_at ASC'
            : 'total_spent_minor DESC';
    return db
      .prepare(
        `SELECT o.customer_id AS customer_id,
                u.full_name AS full_name,
                u.email AS email,
                u.phone AS phone,
                COUNT(*) AS orders,
                ${ITEMS_MILLI_SQL} AS items_milli,
                COALESCE(SUM(o.total_minor), 0) AS total_spent_minor,
                COALESCE(SUM(COALESCE((SELECT SUM(p.refunded_minor) FROM payments p
                                         WHERE p.order_id = o.id
                                           AND p.status IN ${SETTLED_PAYMENT_STATUSES}), 0)), 0)
                  AS refunded_minor,
                MIN(o.created_at) AS first_order_at,
                MAX(o.created_at) AS last_order_at,
                (SELECT MIN(fo.created_at) FROM orders fo
                  WHERE fo.business_id = o.business_id
                    AND fo.customer_id = o.customer_id
                    AND fo.deleted_at IS NULL
                    AND fo.status <> 'CANCELLED') AS first_ever_at,
                (SELECT COUNT(*) FROM orders fo
                  WHERE fo.business_id = o.business_id
                    AND fo.customer_id = o.customer_id
                    AND fo.deleted_at IS NULL
                    AND fo.status <> 'CANCELLED') AS lifetime_orders,
                COALESCE((SELECT SUM(CAST(${BILLED_MINUTES_SQL} AS INTEGER))
                            FROM chair_rentals r
                           WHERE r.business_id = o.business_id
                             AND r.customer_id = o.customer_id
                             AND r.status <> 'CANCELLED'
                             AND r.start_at >= ? AND r.start_at < ?), 0) AS rental_minutes,
                COALESCE((SELECT COUNT(*) FROM chair_reservations res
                           WHERE res.business_id = o.business_id
                             AND res.customer_id = o.customer_id
                             AND res.status NOT IN ('CANCELLED','EXPIRED')
                             AND res.start_at < ? AND res.end_at > ?), 0) AS reservations
           FROM orders o
           JOIN users u ON u.id = o.customer_id
          WHERE ${revenue.sql} AND o.customer_id IS NOT NULL
          GROUP BY o.customer_id, u.full_name, u.email, u.phone
          ORDER BY ${order}, customer_id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(
        filters.fromUtc,
        filters.toUtc,
        filters.toUtc,
        filters.fromUtc,
        ...revenue.params,
        page.limit,
        page.offset,
      ) as CustomerRow[];
  }

  public countCustomers(filters: ReportFilters, db: Db = getConnection()): number {
    const revenue = revenueWhere(filters);
    const row = db
      .prepare(
        `SELECT COUNT(DISTINCT o.customer_id) AS total
           FROM orders o
          WHERE ${revenue.sql} AND o.customer_id IS NOT NULL`,
      )
      .get(...revenue.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public customerTotals(filters: ReportFilters, db: Db = getConnection()): CustomerTotalsRow {
    const revenue = revenueWhere(filters);
    const row = db
      .prepare(
        `SELECT (SELECT COUNT(DISTINCT o.customer_id) FROM orders o
                  WHERE ${revenue.sql} AND o.customer_id IS NOT NULL) AS customers,
                (SELECT COUNT(*)
                   FROM orders fc
                  WHERE fc.business_id = ?
                    AND fc.deleted_at IS NULL
                    AND fc.customer_id IS NOT NULL
                    AND fc.status <> 'CANCELLED'
                    AND fc.created_at >= ? AND fc.created_at < ?
                    AND fc.created_at = (SELECT MIN(fo.created_at) FROM orders fo
                                          WHERE fo.business_id = fc.business_id
                                            AND fo.customer_id = fc.customer_id
                                            AND fo.deleted_at IS NULL
                                            AND fo.status <> 'CANCELLED')) AS new_customers,
                (SELECT COALESCE(SUM(o.total_minor), 0) FROM orders o WHERE ${revenue.sql})
                  AS total_spent_minor,
                (SELECT COUNT(*) FROM orders o WHERE ${revenue.sql}) AS orders,
                (SELECT COUNT(DISTINCT o.customer_id) FROM orders o
                  WHERE ${revenue.sql} AND o.customer_id IS NOT NULL
                    AND EXISTS (SELECT 1 FROM chair_reservations res
                                 WHERE res.customer_id = o.customer_id
                                   AND res.business_id = o.business_id
                                   AND res.status NOT IN ('CANCELLED','EXPIRED')
                                   AND res.start_at >= ? AND res.start_at < ?))
                  AS with_reservation`,
      )
      .get(
        ...revenue.params,
        filters.businessId,
        filters.fromUtc,
        filters.toUtc,
        ...revenue.params,
        ...revenue.params,
        ...revenue.params,
        filters.fromUtc,
        filters.toUtc,
      ) as CustomerTotalsRow | undefined;
    return row ?? { customers: 0, new_customers: 0, total_spent_minor: 0, orders: 0, with_reservation: 0 };
  }

  // ==========================================================================
  // Inventario
  // ==========================================================================

  /**
   * Valorización de cada ítem con sus movimientos del rango.
   *
   * DOS consultas fijas: los ítems y los movimientos ya agrupados por ítem. El
   * cruce se hace en memoria con un `Map` en lugar de una consulta por ítem,
   * que es exactamente lo que sería un N+1.
   */
  public inventoryItems(
    filters: ReportFilters,
    page: PageRequest,
    db: Db = getConnection(),
  ): readonly InventoryItemRow[] {
    const where = inventoryWhere(filters);
    const rows = db
      .prepare(
        `SELECT ii.id AS item_id,
                ii.name AS name,
                ii.sku AS sku,
                ii.unit AS unit,
                ii.current_stock AS current_stock,
                ii.min_stock AS min_stock,
                ii.cost_minor AS cost_minor,
                ii.is_tracked AS is_tracked,
                ii.supplier AS supplier,
                ii.location_storage AS location_storage,
                (SELECT MAX(im.created_at) FROM inventory_movements im
                  WHERE im.inventory_item_id = ii.id) AS last_movement_at
           FROM inventory_items ii
          WHERE ${where.sql}
          ORDER BY ii.name ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, page.limit, page.offset) as Omit<
      InventoryItemRow,
      'in_milli' | 'out_milli' | 'movements'
    >[];

    const movements = db
      .prepare(
        `SELECT im.inventory_item_id AS item_id,
                COALESCE(SUM(CASE WHEN im.quantity > 0 THEN im.quantity ELSE 0 END), 0) AS in_qty,
                COALESCE(SUM(CASE WHEN im.quantity < 0 THEN -im.quantity ELSE 0 END), 0) AS out_qty,
                COUNT(*) AS movements
           FROM inventory_movements im
          WHERE im.created_at >= ? AND im.created_at < ?
          GROUP BY im.inventory_item_id`,
      )
      .all(filters.fromUtc, filters.toUtc) as {
      item_id: number;
      in_qty: number;
      out_qty: number;
      movements: number;
    }[];
    const byItem = new Map(movements.map((row) => [row.item_id, row]));

    return rows.map((row) => ({
      ...row,
      // `quantity` es REAL en el esquema: se publica en milésimas enteras.
      in_milli: roundMilli(row.item_id in byItem ? (byItem.get(row.item_id)?.in_qty ?? 0) : 0),
      out_milli: roundMilli(row.item_id in byItem ? (byItem.get(row.item_id)?.out_qty ?? 0) : 0),
      movements: byItem.get(row.item_id)?.movements ?? 0,
    }));
  }

  public countInventoryItems(filters: ReportFilters, db: Db = getConnection()): number {
    const where = inventoryWhere(filters);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM inventory_items ii WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public inventoryGroups(
    filters: ReportFilters,
    by: InventoryGroupBy,
    db: Db = getConnection(),
  ): readonly InventoryGroupRow[] {
    const where = inventoryWhere(filters);
    // Allowlist interna: la columna sale de este `switch`, nunca del cliente.
    const column = by === 'supplier' ? 'ii.supplier' : 'ii.location_storage';
    return db
      .prepare(
        `SELECT COALESCE(${column}, 'Sin asignar') AS key,
                COUNT(*) AS items,
                CAST(COALESCE(SUM(ii.current_stock * ii.cost_minor), 0) AS INTEGER) AS total_value_minor,
                CAST(COALESCE(SUM(ii.current_stock), 0) * 1000 AS INTEGER) AS total_stock_milli,
                COALESCE(SUM(CASE WHEN ii.is_tracked = 1
                                   AND ii.current_stock <= CASE WHEN ii.min_stock > 0 THEN ii.min_stock ELSE ? END
                                  THEN 1 ELSE 0 END), 0) AS low_stock_count
           FROM inventory_items ii
          WHERE ${where.sql}
          GROUP BY key
          ORDER BY total_value_minor DESC, key ASC`,
      )
      .all(filters.lowStockThreshold, ...where.params) as InventoryGroupRow[];
  }

  public inventorySummary(filters: ReportFilters, db: Db = getConnection()): InventorySummaryRow {
    const where = inventoryWhere(filters);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS items,
                COALESCE(SUM(ii.is_tracked), 0) AS tracked_items,
                CAST(COALESCE(SUM(ii.current_stock * ii.cost_minor), 0) AS INTEGER) AS total_value_minor,
                COALESCE(SUM(CASE WHEN ii.is_tracked = 1
                                   AND ii.current_stock <= CASE WHEN ii.min_stock > 0 THEN ii.min_stock ELSE ? END
                                  THEN 1 ELSE 0 END), 0) AS low_stock_count,
                COALESCE(SUM(CASE WHEN ii.current_stock = 0 THEN 1 ELSE 0 END), 0) AS out_of_stock_count,
                COALESCE(SUM(CASE WHEN ii.current_stock < 0 THEN 1 ELSE 0 END), 0) AS negative_stock_count,
                COALESCE(SUM(ii.current_stock * ii.cost_minor), 0) AS weighted_cost,
                COALESCE(SUM(CASE WHEN ii.current_stock > 0 THEN 1 ELSE 0 END), 0) AS stock_items
           FROM inventory_items ii
          WHERE ${where.sql}`,
      )
      .get(filters.lowStockThreshold, ...where.params) as Omit<
      InventorySummaryRow,
      'no_movement_count' | 'quantities_by_unit'
    > | undefined;

    const noMovement = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM inventory_items ii
          WHERE ${where.sql}
            AND NOT EXISTS (SELECT 1 FROM inventory_movements im
                             WHERE im.inventory_item_id = ii.id
                               AND im.created_at >= ? AND im.created_at < ?)`,
      )
      .get(...where.params, filters.fromUtc, filters.toUtc) as { total: number } | undefined;

    const byUnit = db
      .prepare(
        `SELECT ii.unit AS unit, CAST(COALESCE(SUM(ii.current_stock), 0) * 1000 AS INTEGER) AS qty
           FROM inventory_items ii
          WHERE ${where.sql}
          GROUP BY ii.unit`,
      )
      .all(...where.params) as { unit: string; qty: number }[];

    return {
      items: row?.items ?? 0,
      tracked_items: row?.tracked_items ?? 0,
      total_value_minor: row?.total_value_minor ?? 0,
      low_stock_count: row?.low_stock_count ?? 0,
      out_of_stock_count: row?.out_of_stock_count ?? 0,
      negative_stock_count: row?.negative_stock_count ?? 0,
      weighted_cost: row?.weighted_cost ?? 0,
      stock_items: row?.stock_items ?? 0,
      no_movement_count: noMovement?.total ?? 0,
      quantities_by_unit: JSON.stringify(
        Object.fromEntries(byUnit.map((entry) => [entry.unit, entry.qty])),
      ),
    };
  }

  // ==========================================================================
  // Resumen de pedidos
  // ==========================================================================

  public ordersSummary(
    filters: ReportFilters,
    groupBy: ReportGrouping,
    db: Db = getConnection(),
  ): readonly OrdersSummaryGroupRow[] {
    const any = anyStatusWhere(filters);
    const anchor =
      groupBy === 'status' || groupBy === 'type' || groupBy === 'channel' ? 'o.status' : 'o.created_at';
    const period = periodSql(anchor, groupBy, filters);
    return db
      .prepare(
        `SELECT ${period.sql} AS group_key,
                COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN o.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled,
                COALESCE(SUM(CASE WHEN o.status = 'REFUNDED' THEN 1 ELSE 0 END), 0) AS refunded,
                COALESCE(SUM(CASE WHEN o.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed,
                COALESCE(SUM(CASE WHEN o.status IN ('PENDING','CONFIRMED','PREPARING','READY','DELIVERING')
                                  THEN 1 ELSE 0 END), 0) AS pending,
                COALESCE(SUM(o.total_minor), 0) AS total_minor,
                COALESCE(SUM(CASE WHEN o.completed_at IS NOT NULL AND o.preparing_at IS NOT NULL
                                  THEN CAST((julianday(o.completed_at) - julianday(o.preparing_at)) * 1440 AS INTEGER)
                                  ELSE 0 END), 0) AS preparation_minutes_milli,
                COALESCE(SUM(CASE WHEN o.completed_at IS NOT NULL AND o.preparing_at IS NOT NULL
                                  THEN 1 ELSE 0 END), 0) AS preparation_samples,
                COALESCE(SUM(CASE WHEN o.ready_at IS NOT NULL AND o.placed_at IS NOT NULL
                                  THEN CAST((julianday(o.ready_at) - julianday(o.placed_at)) * 1440 AS INTEGER)
                                  ELSE 0 END), 0) AS wait_minutes_milli,
                COALESCE(SUM(CASE WHEN o.ready_at IS NOT NULL AND o.placed_at IS NOT NULL
                                  THEN 1 ELSE 0 END), 0) AS wait_samples,
                MIN(o.created_at) AS first_order_at,
                MAX(o.created_at) AS last_order_at
           FROM orders o
          WHERE ${any.sql}
          GROUP BY group_key
          ORDER BY group_key ASC`,
      )
      .all(...period.params, ...any.params) as OrdersSummaryGroupRow[];
  }

  // ==========================================================================
  // Exportación
  // ==========================================================================

  public salesRowsForExport(
    filters: ReportFilters,
    page: PageRequest,
    db: Db = getConnection(),
  ): readonly SalesExportRow[] {
    const where = revenueMaybeRefundedWhere(filters);
    const localDate = localDateSql('o.created_at', filters);
    const localHour = localHourSql('o.created_at', filters);
    // El importe por método se agrega en SUBSELECTAS (una por método) y no con
    // un `LEFT JOIN` + `GROUP BY`: el `JOIN` multiplicaría las filas del pedido
    // por el número de pagos y el `total_minor` saldría repetido.
    const methodSub = (method: PaymentMethod, alias: string): string => `
       COALESCE((SELECT SUM(p.amount_minor - p.refunded_minor) FROM payments p
                  WHERE p.order_id = o.id AND p.method = '${method}'
                    AND p.status IN ${SETTLED_PAYMENT_STATUSES}), 0) AS ${alias}`;
    return db
      .prepare(
        `SELECT o.id AS order_id,
                o.order_number AS order_number,
                o.created_at AS created_at,
                ${localDate.sql} AS local_date,
                ${localHour.sql} AS local_hour,
                o.type AS type,
                o.status AS status,
                o.channel AS channel,
                o.location_id AS location_id,
                o.customer_id AS customer_id,
                (SELECT u.full_name FROM users u WHERE u.id = o.customer_id) AS customer_name,
                COALESCE((SELECT SUM(i.quantity) FROM order_items i
                           WHERE i.order_id = o.id AND i.status <> 'CANCELLED'), 0) AS items_milli,
                o.subtotal_minor AS subtotal_minor,
                o.discount_minor AS discount_minor,
                o.tax_minor AS tax_minor,
                o.service_fee_minor AS service_fee_minor,
                o.total_minor AS total_minor,
                o.paid_minor AS paid_minor,
                COALESCE((SELECT SUM(p.refunded_minor) FROM payments p
                           WHERE p.order_id = o.id AND p.status IN ${SETTLED_PAYMENT_STATUSES}), 0)
                  AS refunded_minor,
                ${methodSub(PaymentMethod.CASH, 'cash_minor')},
                ${methodSub(PaymentMethod.CARD, 'card_minor')},
                ${methodSub(PaymentMethod.TRANSFER, 'transfer_minor')},
                ${methodSub(PaymentMethod.ONLINE, 'online_minor')}
           FROM orders o
          WHERE ${where.sql}
          ORDER BY o.created_at ASC, o.id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...localDate.params, ...localHour.params, ...where.params, page.limit, page.offset) as SalesExportRow[];
  }

  public countSalesRowsForExport(filters: ReportFilters, db: Db = getConnection()): number {
    const where = revenueMaybeRefundedWhere(filters);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM orders o WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}

/** REDONDEO A MILÉSIMAS ENTERAS. */
function roundMilli(value: number): number {
  return Math.floor(value * 1000 + 0.5);
}

/** Métodos de pago, en el orden estable del contrato (API.md 6.2). */
export const REPORT_PAYMENT_METHODS: readonly PaymentMethod[] = Object.freeze([
  PaymentMethod.CASH,
  PaymentMethod.CARD,
  PaymentMethod.TRANSFER,
  PaymentMethod.ONLINE,
]);
