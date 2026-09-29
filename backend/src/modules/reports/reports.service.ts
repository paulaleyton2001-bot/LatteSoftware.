/**
 * Servicio de REPORTES: la capa donde vive el criterio de negocio.
 *
 * ============================================================================
 * RESPONSABILIDADES
 * ============================================================================
 *  1. **Resolver el rango temporal en la zona del negocio** (`resolveRange`),
 *     que es la pieza de la que depende la corrección de todo lo demás.
 *  2. **Convertir filas crudas en vistas de negocio**: enteros de centavos,
 *     porcentajes en basis points, cantidades en milésimas, y los
 *    rellenos de series sin huecos.
 *  3. **Aplicar las reglas** de qué cuenta como venta, qué es un cliente
 *     nuevo, cómo se reparte un importe por método de pago y qué es ocupación
 *     real de una silla.
 *
 * ============================================================================
 * NÚMERO DE CONSULTAS POR ENDPOINT (fijo, documentado, sin N+1)
 * ============================================================================
 *  - `/dashboard`         9 (KPIs, canal, tipo, top, sillas, alquileres, capacidad, serie, clientes)
 *  - `/sales`             6 (periodos, pagos x2 —actual y anterior—, totales x2, clientes)
 *  - `/sales-by-hour`     2
 *  - `/sales-by-day`      3 (días, semana, clientes)
 *  - `/top-products`      3 (ranking, conteo, totales)
 *  - `/product-revenue`   4 (paginada, conteo, serie diaria, totales)
 *  - `/chair-occupancy`   4 (alquileres, reservas, sillas, capacidad)
 *  - `/rental-revenue`    4 (alquileres, reservas, sillas, capacidad)
 *  - `/customers`         4 (paginada, conteo, totales, totales anteriores)
 *  - `/inventory`         5 (ítems, conteo, resumen, proveedores, ubicaciones)
 *  - `/orders-summary`    3
 *  - `/export`            1 + N en BLOQUES de 5 000 (ver `buildExport`)
 *
 * Ninguna depende del número de filas de la base: los cruces se hacen con
 * `Map` en memoria, nunca con una consulta por elemento.
 */
import {
  AuditAction,
  ChairKind,
  ChairStatus,
  OrderChannel,
  OrderType,
  PaymentMethod,
  type UserContext,
} from '../../shared/domain/index.js';
import { ValidationError } from '../../shared/errors/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { RENTAL } from '../../config/index.js';
import { addMinor, roundHalfUp, subtractMinor } from '../../shared/utils/money.js';
import { nowIso, parseIso } from '../../shared/utils/datetime.js';
import type { DaySeriesRow, ProductOrderBy, ReportsRepository } from './reports.repository.js';
import type {
  ChairOccupancyReport,
  ChairOccupancyRow,
  ChairOccupancySummary,
  CustomerReportRow,
  CustomerReportTotals,
  CustomerSegment,
  DailySalesPoint,
  DashboardKpis,
  DashboardReport,
  ExportableReport,
  InventoryGroupRow,
  InventoryReport,
  InventoryReportRow,
  InventoryReportSummary,
  OrdersSummaryRow,
  OrdersSummaryTotals,
  PeriodComparison,
  RentalRevenueReport,
  RentalRevenueRow,
  RentalRevenueSummary,
  ReportFilters,
  ReportGrouping,
  ReportPreset,
  ReportRange,
  ReportRangeMeta,
  SalesByDayPoint,
  SalesByHourPoint,
  SalesBreakdownRow,
  SalesPeriodRow,
  SalesTotals,
  TopProductRow,
  TopProductView,
  ProductRevenueRow,
  WeekdayPoint,
  ZoneOccupancyRow,
} from './reports.types.js';
import {
  addLocalDays,
  buildTimeZonePlan,
  isValidTimeZone,
  localDateKey,
  localDatesInRange,
  localHourOf,
  minutesBetween,
  previousLocalMonth,
  startOfLocalDayUtc,
  startOfLocalMonth,
  startOfNextLocalDayUtc,
  addLocalDays as shiftLocalDays,
} from './reports.tz.js';
import { buildCsv, type ReportColumnSpec } from './reports.csv.js';

// ---------------------------------------------------------------------------
// Constantes del módulo
// ---------------------------------------------------------------------------

/** Tope de duración de un rango, en días (API.md 5.2: `RANGE_TOO_LARGE`). */
export const REPORT_MAX_RANGE_DAYS = 366;

/** Días de serie por defecto del dashboard. */
export const REPORT_DEFAULT_SERIES_DAYS = 7;

/** Tamaño de bloque al leer ventas para el CSV. */
const EXPORT_PAGE_SIZE = 5_000;

/** Filas de `top-products` que devuelve el dashboard. */
const DASHBOARD_TOP_LIMIT = 5;

/** Días sin actividad a partir de los cuales un cliente se considera en riesgo. */
const AT_RISK_DAYS = 30;

/** Denominador de basis points. */
const BP = 10_000;

/** Zona horaria de reserva si `businesses.timezone` no fuera válida. */
const FALLBACK_TIMEZONE = 'America/Bogota';

/** Umbral de stock bajo de reserva (DEFAULT de la tabla). */
const FALLBACK_LOW_STOCK = 5;

/** Filtros de rango que llegan del controller ya validados por zod. */
export interface RangeRequest {
  readonly preset?: ReportPreset;
  readonly from?: string;
  readonly to?: string;
  readonly timezone?: string;
}

/** Filtros de negocio comunes. */
export interface ReportRequest {
  readonly range: RangeRequest;
  readonly locationId?: number;
  readonly zoneId?: number;
  readonly chairId?: number;
  readonly kind?: ChairKind;
  readonly channel?: OrderChannel;
  readonly type?: OrderType;
  readonly paymentMethod?: PaymentMethod;
  readonly includeRefunded?: boolean;
  readonly now?: Date;
}

/** Contexto de auditoría de la petición. */
export interface ReportRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Parámetros de `GET /dashboard`. */
export interface DashboardRequest extends ReportRequest {
  readonly includeSeries?: boolean;
  readonly seriesDays?: 7 | 14 | 30;
}

/** Parámetros de `GET /sales`. */
export interface SalesRequest extends ReportRequest {
  readonly groupBy?: 'day' | 'week' | 'month';
}

/** Parámetros de `GET /top-products`. */
export interface TopProductsRequest extends ReportRequest {
  readonly orderBy?: ProductOrderBy;
  readonly limit?: number;
  readonly page?: number;
  readonly pageSize?: number;
  readonly categoryId?: number;
}

/** Parámetros de `GET /product-revenue`. */
export interface ProductRevenueRequest extends ReportRequest {
  readonly groupBy?: 'product' | 'category';
  readonly includeTax?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}

/** Parámetros de `GET /chair-occupancy`. */
export interface ChairOccupancyRequest extends ReportRequest {
  readonly groupBy?: 'chair' | 'zone' | 'hour';
}

/** Parámetros de `GET /rental-revenue`. */
export interface RentalRevenueRequest extends ReportRequest {
  readonly groupBy?: 'chair' | 'zone' | 'day' | 'month';
}

/** Parámetros de `GET /customers`. */
export interface CustomersRequest extends ReportRequest {
  readonly orderBy?: 'totalSpent' | 'orders' | 'lastOrder' | 'newCustomers';
  readonly limit?: number;
  readonly page?: number;
  readonly pageSize?: number;
  readonly onlyWithOrders?: boolean;
  readonly segment?: CustomerSegment;
}

/** Parámetros de `GET /inventory`. */
export interface InventoryReportRequest extends ReportRequest {
  readonly supplier?: string;
  readonly locationStorage?: string;
  readonly includeZeroStock?: boolean;
  readonly lowStockOnly?: boolean;
  readonly page?: number;
  readonly pageSize?: number;
}

/** Parámetros de `GET /orders-summary`. */
export interface OrdersSummaryRequest extends ReportRequest {
  readonly groupBy?: ReportGrouping;
}

/** Parámetros de `POST /export`. */
export interface ExportRequest extends ReportRequest {
  readonly report: ExportableReport;
  readonly columns?: readonly string[];
  readonly filename?: string;
  readonly includeTotalsRow?: boolean;
  /**
   * `groupBy` del reporte solicitado, cuando aplica.
   *
   * Es MÁS ANCHO que el de cada reporte porque el mismo body sirve para los
   * diez: `product-revenue` espera `product|category` y `chair-occupancy`
   * espera `chair|zone|hour`. Cada rama de `export` estrecha el valor con su
   * propio `as*Group`, de modo que un `groupBy` ajeno al reporte nunca llega a
   * la consulta.
   */
  readonly groupBy?: ReportGrouping | 'product' | 'category';
  readonly orderBy?: ProductOrderBy;
  readonly limit?: number;
  readonly pageSize?: number;
  readonly segment?: CustomerSegment;
  readonly supplier?: string;
  readonly locationStorage?: string;
}

/** Resultado de un reporte listo para el controller. */
export interface ReportResult<T> {
  readonly data: T;
  readonly meta: {
    readonly range: ReportRangeMeta;
    readonly generatedAt: string;
    readonly [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Utilidades enteras
// ---------------------------------------------------------------------------

/** Milésimas a unidades enteras, half-up (BR-MONEY-002). */
function milliToUnits(milli: number): number {
  return roundHalfUp(milli / 1000);
}

/** Unidades a milésimas enteras. */
function unitsToMilli(units: number): number {
  return roundHalfUp(units * 1000);
}

/** Cociente entero de dos enteros, half-up. `0` si el denominador es 0. */
function safeRatio(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return roundHalfUp(numerator / denominator);
}

/** Cociente entero de tres enteros. `0` si el denominador es 0. */
function ratioOf(numerator: number, denominator: number, divisor: number): number {
  if (denominator === 0) return 0;
  return roundHalfUp(numerator / (denominator * divisor));
}

/** Ticket medio en centavos enteros. */
function averageTicket(netMinor: number, orders: number): number {
  return safeRatio(netMinor, orders);
}

/** Variación porcentual en basis points. `null` si la base es 0. */
export function variationBp(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return roundHalfUp(((current - previous) * BP) / previous);
}

/** Peso de `part` sobre `total`, en basis points. */
function shareBp(part: number, total: number): number {
  if (total === 0) return 0;
  return roundHalfUp((part * BP) / total);
}

/**
 * Mapa de métodos de pago a cero, en el orden estable del contrato.
 *
 * Las claves se escriben como LITERALES y no como `[PaymentMethod.CASH]`: con
 * la forma `const object` de `shared/domain/enums.ts` la clave computada se
 * ensancha a `string` y el `Record<PaymentMethod, number>` deja de comprobar
 * que estén los cuatro. Es el mismo patrón que `spaces.types.ts`.
 */
function emptyByMethod(): Record<PaymentMethod, number> {
  return { CASH: 0, CARD: 0, TRANSFER: 0, ONLINE: 0 };
}

/** Mapa de tipos de pedido a cero. */
function emptyByType(): Record<OrderType, number> {
  return { TAKEAWAY: 0, DINE_IN: 0, CHAIR_RENTAL: 0 };
}

// ---------------------------------------------------------------------------
// Servicio
// ---------------------------------------------------------------------------

/** Servicio de reportes. */
export class ReportsService {
  public constructor(
    private readonly repository: ReportsRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Rango temporal
  // ==========================================================================

  /**
   * Resuelve el rango pedido a un intervalo `[from, to)` en UTC.
   *
   * Este es el método del que depende la corrección de todos los reportes. Ver
   * `reports.tz.ts` para el mecanismo de zona; aquí sólo se resuelve qué día
   * local abre y cierra cada preset.
   */
  public resolveRange(
    request: RangeRequest,
    businessId: number,
    now: Date = new Date(),
  ): ReportRange {
    const settings = this.repository.findBusinessSettings(businessId);
    const businessTimezone = settings?.timezone ?? FALLBACK_TIMEZONE;
    const timezone = request.timezone ?? businessTimezone;
    if (!isValidTimeZone(timezone)) {
      throw new ValidationError('La zona horaria no es válida', {
        details: [
          {
            path: 'timezone',
            message: `"${timezone}" no es un identificador IANA válido`,
            code: 'INVALID_FORMAT',
          },
        ],
      });
    }

    const today = localDateKeyOf(now, timezone);
    const localToday = parseDateKey(today);

    // `from`/`to` explícitos sin `preset` equivalen a `custom`: es lo que espera
    // un cliente que llama a la API con dos fechas y no quiere saber de presets.
    const explicit = request.from !== undefined || request.to !== undefined;
    const preset: ReportPreset =
      request.preset ?? (explicit ? 'custom' : 'today');

    if (request.preset !== undefined && request.preset !== 'custom' && explicit) {
      throw new ValidationError('El rango de fechas es inválido', {
        details: [
          {
            path: 'from',
            message:
              'Los parámetros `from`/`to` sólo se aceptan con `preset=custom` o sin `preset`',
            code: 'INVALID_DATE_RANGE',
          },
        ],
      });
    }

    const { from, to, localFrom, localTo } = this.resolveBounds(
      preset,
      request,
      localToday,
      timezone,
    );

    // `INVALID_DATE_RANGE` y `RANGE_TOO_LARGE` son 400 VALIDATION_ERROR, y no
    // 422 BUSINESS_RULE_ERROR: un `from` posterior al `to` o un rango de más de
    // 366 días es una combinación MAL FORMADA de parámetros, no una regla de
    // negocio que el servidor rehúse cumplir. Es además lo que ya hacen los otros
    // módulos con los MISMOS `details.code` (`spaces`, `inventory` y
    // `reservations` los lanzan como `ValidationError`), y lo que dice API.md
    // 7.16, que lista `400, 401, 403, 429` y ningún 422. Con 422 aquí, un
    // cliente que ramifique por `details.code` se comportaría de forma distinta
    // en `/reports/sales` y en `/inventory/movements` para el mismo error.
    if (from.getTime() > to.getTime()) {
      throw new ValidationError('El rango de fechas es inválido', {
        details: [
          {
            path: 'from',
            message: '`from` no puede ser posterior a `to`',
            code: 'INVALID_DATE_RANGE',
          },
        ],
      });
    }

    const minutes = minutesBetween(from, to);
    if (minutes > REPORT_MAX_RANGE_DAYS * 24 * 60) {
      throw new ValidationError('El rango de fechas es demasiado amplio', {
        details: [
          {
            path: 'to',
            message: `El rango no puede superar ${REPORT_MAX_RANGE_DAYS} días`,
            code: 'RANGE_TOO_LARGE',
          },
        ],
      });
    }

    // El periodo anterior es de la MISMA duración, inmediatamente anterior, y
    // termina exactamente donde empieza éste. Así la comparación es justa: dos
    // semanas contra dos semanas, no dos semanas contra un mes.
    const previousTo = from;
    const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      fromUtc: from.toISOString(),
      toUtc: to.toISOString(),
      timezone,
      preset,
      localFrom: localFromKey(localFrom),
      localTo: localToKey(localTo),
      minutes,
      previous: {
        fromUtc: previousFrom.toISOString(),
        toUtc: previousTo.toISOString(),
        minutes,
      },
      plan: buildTimeZonePlan(from, to, timezone),
    };
  }

  /**
   * Devuelve los límites `[from, to)` de un preset.
   *
   * Todos los cortes son MEDIANOCHES LOCALES convertidos a UTC. Ése es el
   * detalle que hace que `today` en Bogotá empiece a las 05:00Z y termine a las
   * 05:00Z del día siguiente, y no a medianoche UTC.
   */
  private resolveBounds(
    preset: ReportPreset,
    request: RangeRequest,
    today: { readonly year: number; readonly month: number; readonly day: number },
    timezone: string,
  ): {
    readonly from: Date;
    readonly to: Date;
    readonly localFrom: { readonly year: number; readonly month: number; readonly day: number };
    readonly localTo: { readonly year: number; readonly month: number; readonly day: number };
  } {
    switch (preset) {
      case 'today': {
        const from = startOfLocalDayUtc(today, timezone);
        const nextDay = addLocalDays(today, 1);
        return { from, to: startOfLocalDayUtc(nextDay, timezone), localFrom: today, localTo: today };
      }
      case 'yesterday': {
        const yesterday = addLocalDays(today, -1);
        return {
          from: startOfLocalDayUtc(yesterday, timezone),
          to: startOfLocalDayUtc(today, timezone),
          localFrom: yesterday,
          localTo: yesterday,
        };
      }
      case 'last7': {
        // 7 días INCLUSIVOS: desde hace 6 días a las 00:00 hasta mañana a las
        // 00:00, que es donde termina "hoy".
        const start = addLocalDays(today, -6);
        const nextDay = addLocalDays(today, 1);
        return {
          from: startOfLocalDayUtc(start, timezone),
          to: startOfLocalDayUtc(nextDay, timezone),
          localFrom: start,
          localTo: today,
        };
      }
      case 'last30': {
        const start = addLocalDays(today, -29);
        const nextDay = addLocalDays(today, 1);
        return {
          from: startOfLocalDayUtc(start, timezone),
          to: startOfLocalDayUtc(nextDay, timezone),
          localFrom: start,
          localTo: today,
        };
      }
      case 'thisMonth': {
        const first = startOfLocalMonth(today);
        const nextDay = addLocalDays(today, 1);
        return {
          from: startOfLocalDayUtc(first, timezone),
          to: startOfLocalDayUtc(nextDay, timezone),
          localFrom: first,
          localTo: today,
        };
      }
      case 'lastMonth': {
        const firstOfThisMonth = startOfLocalMonth(today);
        const firstOfLastMonth = previousLocalMonth(today);
        return {
          from: startOfLocalDayUtc(firstOfLastMonth, timezone),
          to: startOfLocalDayUtc(firstOfThisMonth, timezone),
          localFrom: firstOfLastMonth,
          localTo: addLocalDays(firstOfThisMonth, -1),
        };
      }
      case 'custom':
      default: {
        const from = request.from !== undefined ? parseInstant(request.from, 'from') : new Date();
        // Sin `to`, el rango llega hasta "ahora" (API.md 5.2).
        const to = request.to !== undefined ? parseInstant(request.to, 'to') : new Date();
        const localFrom = localDateKeyOf(from, timezone);
        // `to` es EXCLUSIVO: el último día cubierto es el anterior al local de `to`.
        const localTo = addLocalDays(parseDateKey(localDateKeyOf(to, timezone)), -1);
        return { from, to, localFrom: parseDateKey(localFrom), localTo };
      }
    }
  }

  /** Filtros de repositorio a partir de un rango y unos parámetros. */
  private filters(
    range: ReportRange,
    businessId: number,
    request: ReportRequest,
    now: Date,
  ): ReportFilters {
    const settings = this.repository.findBusinessSettings(businessId);
    return {
      businessId,
      fromUtc: range.from,
      toUtc: range.to,
      timezone: range.timezone,
      plan: range.plan,
      nowIso: now.toISOString(),
      includeRefunded: request.includeRefunded === true,
      lowStockThreshold: settings?.lowStockThreshold ?? FALLBACK_LOW_STOCK,
      rangeMinutes: range.minutes,
      ...(request.locationId === undefined ? {} : { locationId: request.locationId }),
      ...(request.zoneId === undefined ? {} : { zoneId: request.zoneId }),
      ...(request.chairId === undefined ? {} : { chairId: request.chairId }),
      ...(request.kind === undefined ? {} : { kind: request.kind }),
      ...(request.channel === undefined ? {} : { channel: request.channel }),
      ...(request.type === undefined ? {} : { type: request.type }),
      ...(request.paymentMethod === undefined ? {} : { paymentMethod: request.paymentMethod }),
    };
  }

  /** `meta.range` de la respuesta. */
  private rangeMeta(range: ReportRange): ReportRangeMeta {
    return {
      from: range.from,
      to: range.to,
      timezone: range.timezone,
      preset: range.preset,
      boundary: 'FROM_INCLUSIVE_TO_EXCLUSIVE',
      minutes: range.minutes,
      localFrom: range.localFrom,
      localTo: range.localTo,
    };
  }

  // ==========================================================================
  // Dashboard — 9 consultas fijas
  // ==========================================================================

  public async dashboard(
    request: DashboardRequest,
    context: ReportRequestContext,
  ): Promise<ReportResult<DashboardReport>> {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);

    const includeSeries = request.includeSeries !== false;
    const seriesDays = request.seriesDays ?? REPORT_DEFAULT_SERIES_DAYS;

    // Las KPIs y la comparación se calculan SIEMPRE para el rango pedido (por
    // defecto, hoy), y la serie aparte: son ventanas distintas.
    const kpisRaw = this.repository.dashboardKpis(filters);
    const channelRows = this.repository.dashboardBreakdown(filters, 'channel');
    const typeRows = this.repository.dashboardBreakdown(filters, 'type');
    const topRaw = this.repository.dashboardTopProducts(filters, DASHBOARD_TOP_LIMIT);
    const chairs = this.repository.chairStatusCounts(filters);
    const capacity = this.repository.chairCapacity(filters);
    const active = this.repository.activeRentals(filters);

    // Serie: la ventana de `seriesDays` días que termina en el último día del
    // rango, resuelta también en zona local. Es una consulta aparte, no un
    // recorte de la serie del rango, porque el rango por defecto es un día.
    const series = includeSeries
      ? this.dashboardSeries(businessId, range, seriesDays, request, now)
      : [];

    // Clientes nuevos del rango: su PRIMERA compra histórica cae dentro. Es una
    // consulta propia porque necesita mirar más allá del rango.
    const counts = this.repository.customerCounts(filters);
    const comparison = this.previousComparison(range, businessId, request, now, {
      orders: kpisRaw.orders,
      totalMinor: kpisRaw.total_minor,
    });

    // Minutos de silla realmente ocupados en el rango: la intersección de cada
    // sesión con el rango, no la sesión entera. Una sesión que empezó ayer y
    // sigue abierta ocupa la silla de ayer, no la de hoy.
    const rentals = this.repository.rentals(filters);
    const occupiedMinutes = rentals.reduce((acc, rental) => acc + rental.minutes_in_range, 0);
    const availableMinutes = capacity.chairs * range.minutes;

    const kpis: DashboardKpis = {
      totalOrders: kpisRaw.orders,
      pendingOrders: kpisRaw.pending_orders,
      totalItemsMilli: unitsToMilli(kpisRaw.items_milli),
      totalItems: milliToUnits(unitsToMilli(kpisRaw.items_milli)),
      grossSalesMinor: kpisRaw.total_minor,
      netSalesMinor: subtractMinor(kpisRaw.total_minor, kpisRaw.refunded_minor),
      averageTicketMinor: averageTicket(
        subtractMinor(kpisRaw.total_minor, kpisRaw.refunded_minor),
        kpisRaw.orders,
      ),
      totalDiscountMinor: kpisRaw.discount_minor,
      totalTaxMinor: kpisRaw.tax_minor,
      totalServiceFeeMinor: kpisRaw.service_fee_minor,
      totalTipsMinor: 0,
      refundedMinor: kpisRaw.refunded_minor,
      ordersCancelled: kpisRaw.cancelled_orders,
      ordersRefunded: kpisRaw.refunded_orders,
      customers: kpisRaw.customers,
      newCustomers: counts.newCustomers,
      activeRentals: active.active,
      // Ingreso de alquiler DEL RANGO, no el de los alquileres abiertos: `kpis`
      // son las cifras del día que pide el administrador, y mezclar "hoy" con
      // "ahora mismo" haría que dos cifras del mismo panel dijeran cosas
      // distintas. Los alquileres abiertos se cuentan en `activeRentals`.
      rentalRevenueMinor: rentals.reduce((acc, rental) => addMinor(acc, rental.total_minor), 0),
      chairOccupiedMinutes: occupiedMinutes,
      chairOccupancyRateBp: shareBp(occupiedMinutes, availableMinutes),
      inventoryAlertsCount: this.repository.inventorySummary(filters).low_stock_count,
    };

    const data: DashboardReport = {
      kpis,
      salesByChannel: this.toBreakdown(channelRows, kpisRaw.total_minor),
      salesByType: this.toBreakdown(typeRows, kpisRaw.total_minor),
      topProducts: topRaw.map<TopProductRow>((row) => ({
        productId: row.product_id,
        name: row.name,
        quantityMilli: unitsToMilli(row.quantity_milli),
        quantity: milliToUnits(unitsToMilli(row.quantity_milli)),
        totalMinor: row.total_minor,
      })),
      currentSpaces: this.toChairCounts(chairs, capacity.chairs, capacity.capacity, active.active),
      series,
      comparison,
    };

    return {
      data,
      meta: { range: this.rangeMeta(range), generatedAt: nowIso() },
    };
  }

  /** Serie del dashboard: `seriesDays` días locales terminando en el rango. */
  private dashboardSeries(
    businessId: number,
    range: ReportRange,
    seriesDays: number,
    request: DashboardRequest,
    now: Date,
  ): readonly DailySalesPoint[] {
    const lastLocal = parseDateKey(range.localTo);
    const firstLocal = shiftLocalDays(lastLocal, -(seriesDays - 1));
    const from = startOfLocalDayUtc(firstLocal, range.timezone);
    const to = startOfNextLocalDayUtc(lastLocal, range.timezone);
    const seriesRange: ReportRange = {
      ...range,
      from: from.toISOString(),
      to: to.toISOString(),
      fromUtc: from.toISOString(),
      toUtc: to.toISOString(),
      localFrom: localFromKey(firstLocal),
      localTo: localToKey(lastLocal),
      minutes: minutesBetween(from, to),
      plan: buildTimeZonePlan(from, to, range.timezone),
    };
    const filters = this.filters(seriesRange, businessId, request, now);
    const rows = this.repository.dailySeries(filters);
    return this.fillDailySeries(rows, from, to, range.timezone, false);
  }

  /**
   * Comparación con el periodo anterior de la MISMA duración.
   *
   * La variación se expresa en BASIS POINTS enteros (`grossSalesChangeBp`), no
   * en un porcentaje en coma flotante: 1250 bp es +12,50 %. Cuando el periodo
   * anterior no tuvo ventas, la variación es `null` y no 0 ni 10000: "no hay
   * contra qué comparar" no es lo mismo que "no varió".
   */
  private previousComparison(
    range: ReportRange,
    businessId: number,
    request: ReportRequest,
    now: Date,
    current: { readonly orders: number; readonly totalMinor: number },
  ): PeriodComparison {
    const previousRange = this.previousRangeOf(range);
    const totals = this.repository.orderTotals(
      this.filters(previousRange, businessId, request, now),
    );
    return {
      fromUtc: previousRange.from,
      toUtc: previousRange.to,
      orders: totals.orders,
      grossSalesMinor: totals.total_minor,
      ordersChangeBp: variationBp(current.orders, totals.orders),
      grossSalesChangeBp: variationBp(current.totalMinor, totals.total_minor),
    };
  }

  /** Convierte filas de desglose en vistas con su peso en basis points. */
  private toBreakdown(
    rows: readonly { readonly key: string; readonly orders: number; readonly total_minor: number; readonly net_minor: number }[],
    totalMinor: number,
  ): readonly SalesBreakdownRow[] {
    return rows.map((row) => ({
      key: row.key,
      orders: row.orders,
      totalMinor: row.total_minor,
      netMinor: row.net_minor,
      shareBp: shareBp(row.total_minor, totalMinor),
    }));
  }

  /** Contadores de sillas: los seis estados, siempre presentes. */
  private toChairCounts(
    rows: readonly { readonly status: ChairStatus; readonly chairs: number; readonly capacity: number }[],
    total: number,
    totalCapacity: number,
    activeRentals: number,
  ): {
    readonly total: number;
    readonly available: number;
    readonly occupied: number;
    readonly reserved: number;
    readonly blocked: number;
    readonly maintenance: number;
    readonly cleaning: number;
    readonly occupiedNow: number;
    readonly totalCapacity: number;
  } {
    const counts: Record<ChairStatus, number> = {
      AVAILABLE: 0,
      OCCUPIED: 0,
      RESERVED: 0,
      BLOCKED: 0,
      MAINTENANCE: 0,
      CLEANING: 0,
    };
    for (const row of rows) counts[row.status] = row.chairs;
    return {
      total,
      available: counts[ChairStatus.AVAILABLE],
      occupied: counts[ChairStatus.OCCUPIED],
      reserved: counts[ChairStatus.RESERVED],
      blocked: counts[ChairStatus.BLOCKED],
      maintenance: counts[ChairStatus.MAINTENANCE],
      cleaning: counts[ChairStatus.CLEANING],
      occupiedNow: counts[ChairStatus.OCCUPIED] + activeRentals,
      totalCapacity,
    };
  }

  // ==========================================================================
  // Ventas — 6 consultas fijas
  // ==========================================================================

  public sales(
    request: SalesRequest,
    context: ReportRequestContext,
  ): ReportResult<readonly SalesPeriodRow[]> & { readonly totals: SalesTotals } {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const granularity = request.groupBy ?? 'day';
    const filters = this.filters(range, businessId, request, now);

    const periodRows = this.repository.salesByPeriod(filters, granularity);
    const paymentRows = this.repository.salesByPayment(filters, granularity);
    const previousRange = this.previousRangeOf(range);
    const previousFilters = this.filters(previousRange, businessId, request, now);
    const previousTotals = this.repository.orderTotals(previousFilters);

    const paymentsByPeriod = new Map<string, Record<PaymentMethod, number>>();
    for (const row of paymentRows) {
      const bucket = paymentsByPeriod.get(row.period) ?? emptyByMethod();
      bucket[row.method] = addMinor(bucket[row.method], row.amount_minor);
      paymentsByPeriod.set(row.period, bucket);
    }
    const typeRows = this.repository.salesByType(filters, granularity);
    const typesByPeriod = new Map<string, Record<OrderType, number>>();
    for (const row of typeRows) {
      const bucket = typesByPeriod.get(row.period) ?? emptyByType();
      const type = row.type as OrderType;
      bucket[type] = addMinor(bucket[type], row.total_minor);
      typesByPeriod.set(row.period, bucket);
    }

    const rows: SalesPeriodRow[] = periodRows.map((row) => ({
      period: row.period,
      orders: row.orders,
      itemsMilli: unitsToMilli(row.items_milli),
      items: milliToUnits(unitsToMilli(row.items_milli)),
      subtotalMinor: row.subtotal_minor,
      discountMinor: row.discount_minor,
      taxMinor: row.tax_minor,
      serviceFeeMinor: row.service_fee_minor,
      totalMinor: row.total_minor,
      refundedMinor: row.refunded_minor,
      netMinor: subtractMinor(row.total_minor, row.refunded_minor),
      averageTicketMinor: averageTicket(row.total_minor, row.orders),
      byMethod: paymentsByPeriod.get(row.period) ?? emptyByMethod(),
      byType: typesByPeriod.get(row.period) ?? emptyByType(),
    }));

    const totals = this.repository.orderTotals(filters);
    const netTotal = subtractMinor(totals.total_minor, totals.refunded_minor);
    const allPayments = emptyByMethod();
    for (const row of paymentRows) {
      allPayments[row.method] = addMinor(allPayments[row.method], row.amount_minor);
    }
    const allTypes = emptyByType();
    for (const row of typeRows) {
      const type = row.type as OrderType;
      allTypes[type] = addMinor(allTypes[type], row.total_minor);
    }

    return {
      data: rows,
      totals: {
        orders: totals.orders,
        itemsMilli: unitsToMilli(totals.items_milli),
        items: milliToUnits(unitsToMilli(totals.items_milli)),
        subtotalMinor: totals.subtotal_minor,
        discountMinor: totals.discount_minor,
        taxMinor: totals.tax_minor,
        serviceFeeMinor: totals.service_fee_minor,
        totalMinor: totals.total_minor,
        refundedMinor: totals.refunded_minor,
        netMinor: netTotal,
        averageTicketMinor: averageTicket(netTotal, totals.orders),
        byMethod: allPayments,
        byType: allTypes,
        comparison: {
          fromUtc: previousRange.from,
          toUtc: previousRange.to,
          orders: previousTotals.orders,
          grossSalesMinor: previousTotals.total_minor,
          ordersChangeBp: variationBp(totals.orders, previousTotals.orders),
          grossSalesChangeBp: variationBp(totals.total_minor, previousTotals.total_minor),
        },
      },
      meta: { range: this.rangeMeta(range), generatedAt: nowIso() },
    };
  }

  // ==========================================================================
  // Series
  // ==========================================================================

  public salesByHour(
    request: ReportRequest,
    context: ReportRequestContext,
  ): ReportResult<readonly SalesByHourPoint[]> & { readonly peakHours: readonly number[] } {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);
    const rows = this.repository.salesByHour(filters);
    const byHour = new Map(rows.map((row) => [row.hour, row]));

    // Las 24 horas SIEMPRE presentes: el gráfico de barras no puede tener huecos
    // y el cliente no debería tener que rellenar los ceros.
    const points: SalesByHourPoint[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const row = byHour.get(hour);
      points.push({
        hour,
        orders: row?.orders ?? 0,
        itemsMilli: unitsToMilli(row?.items_milli ?? 0),
        items: milliToUnits(unitsToMilli(row?.items_milli ?? 0)),
        totalMinor: row?.total_minor ?? 0,
        netMinor: row?.total_minor ?? 0,
        averageTicketMinor: averageTicket(row?.total_minor ?? 0, row?.orders ?? 0),
        rentalMinutes: row?.rental_minutes ?? 0,
        rentalRevenueMinor: row?.rental_revenue_minor ?? 0,
      });
    }

    const peak = points.reduce((best, point) => (point.totalMinor > best ? point.totalMinor : best), 0);
    return {
      data: points,
      peakHours: peak > 0 ? points.filter((point) => point.totalMinor === peak).map((point) => point.hour) : [],
      meta: { range: this.rangeMeta(range), generatedAt: nowIso() },
    };
  }

  public salesByDay(
    request: ReportRequest,
    context: ReportRequestContext,
  ): ReportResult<readonly SalesByDayPoint[]> & { readonly byWeekday: readonly WeekdayPoint[] } {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);
    const rows = this.repository.dailySeries(filters);
    const from = new Date(range.from);
    const to = new Date(range.to);
    const data = this.fillDailySeries(rows, from, to, range.timezone, true) as readonly SalesByDayPoint[];

    const weekdayRows = this.repository.salesByWeekday(filters);
    const byWeekdayMap = new Map(weekdayRows.map((row) => [row.weekday, row]));
    const byWeekday: WeekdayPoint[] = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      byWeekday.push({
        weekday,
        orders: byWeekdayMap.get(weekday)?.orders ?? 0,
        totalMinor: byWeekdayMap.get(weekday)?.total_minor ?? 0,
      });
    }

    return {
      data,
      byWeekday,
      meta: { range: this.rangeMeta(range), generatedAt: nowIso() },
    };
  }

  /**
   * Rellena una serie diaria con los días sin actividad.
   *
   * La consulta agrupada sólo devuelve los días con datos; un gráfico con huecos
   * parece un fallo de la consulta cuando en realidad es que ese día no hubo
   * ventas. Los días intermedios se generan con aritmética CIVIL en zona local
   * (no sumando milisegundos), para que un cambio de horario de verano no
   * repita ni salte un día.
   */
  private fillDailySeries(
    rows: readonly DaySeriesRow[],
    from: Date,
    to: Date,
    timezone: string,
    withRentals: boolean,
  ): readonly (DailySalesPoint & Partial<SalesByDayPoint>)[] {
    const byDate = new Map(rows.map((row) => [row.date, row]));
    const dates = localDatesInRange(from, to, timezone);
    const out: (DailySalesPoint & Partial<SalesByDayPoint>)[] = [];
    for (const date of dates) {
      const key =
        `${String(date.year).padStart(4, '0')}-` +
        `${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
      const row = byDate.get(key);
      const totalMinor = row?.total_minor ?? 0;
      const refundedMinor = row?.refunded_minor ?? 0;
      const orders = row?.orders ?? 0;
      const itemsMilli = unitsToMilli(row?.items_milli ?? 0);
      // Objeto mutable a propósito: se rellenan los campos opcionales de
      // alquiler y clientes nuevos sólo cuando el reporte los pide.
      const point: {
        -readonly [K in keyof (DailySalesPoint & Partial<SalesByDayPoint>)]: (DailySalesPoint &
          Partial<SalesByDayPoint>)[K];
      } = {
        date: key,
        orders,
        itemsMilli,
        items: milliToUnits(itemsMilli),
        totalMinor,
        netMinor: subtractMinor(totalMinor, refundedMinor),
        averageTicketMinor: averageTicket(totalMinor, orders),
      };
      if (withRentals) {
        point.rentals = row?.rentals ?? 0;
        point.rentalMinutes = row?.rental_minutes ?? 0;
        point.rentalRevenueMinor = row?.rental_revenue_minor ?? 0;
        point.newCustomers = row?.new_customers ?? 0;
      }
      out.push(point);
    }
    return out;
  }

  // ==========================================================================
  // Productos
  // ==========================================================================

  public topProducts(
    request: TopProductsRequest,
    context: ReportRequestContext,
  ): ReportResult<readonly TopProductView[]> & { readonly total: number; readonly totals: Record<string, number> } {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);
    const limit = clamp(request.limit ?? 10, 1, 100);
    const page = Math.max(1, request.page ?? 1);
    const pageSize = clamp(request.pageSize ?? limit, 1, 100);
    const orderBy = request.orderBy ?? 'quantity';

    const rows = this.repository.topProducts(filters, orderBy, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = this.repository.countTopProducts(filters);
    const totals = this.repository.productTotals(filters);

    const data: TopProductView[] = rows.map((row, index) => {
      const quantityMilli = unitsToMilli(row.quantity_milli);
      const quantity = milliToUnits(quantityMilli);
      // Margen = ingreso de la línea menos el coste del producto por esa
      // cantidad. `null` cuando el producto no tiene coste cargado: es
      // information que falta, no un margen de cero.
      const marginMinor =
        row.cost_minor === null
          ? null
          : subtractMinor(row.total_minor, Math.round((row.cost_minor * quantityMilli) / 1000));
      return {
        rank: (page - 1) * pageSize + index + 1,
        productId: row.product_id,
        name: row.name,
        sku: row.sku,
        categoryName: row.category_name,
        quantityMilli,
        quantity,
        orders: row.orders,
        totalMinor: row.total_minor,
        netMinor: row.total_minor,
        averagePriceMinor: row.unit_price_minor,
        marginMinor,
      };
    });

    return {
      data,
      total,
      totals: {
        quantity: milliToUnits(unitsToMilli(totals.quantity_milli)),
        netMinor: totals.net_minor,
        shareOfSalesBp: shareBp(totals.net_minor, totals.net_minor),
        products: totals.products,
      },
      meta: { range: this.rangeMeta(range), generatedAt: nowIso(), total, page, pageSize },
    };
  }

  public productRevenue(
    request: ProductRevenueRequest,
    context: ReportRequestContext,
  ): ReportResult<readonly ProductRevenueRow[]> & { readonly totals: Record<string, number> } {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);
    const groupBy = request.groupBy ?? 'product';
    const page = Math.max(1, request.page ?? 1);
    const pageSize = clamp(request.pageSize ?? 20, 1, 100);

    const rows = this.repository.productRevenue(filters, groupBy, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const series = this.repository.productDailySeries(filters, groupBy);
    const totals = this.repository.productRevenueTotals(filters);

    const seriesByKey = new Map<string, DailySalesPoint[]>();
    for (const row of series) {
      const key = groupBy === 'product' ? `product:${String(row.product_id)}` : `category:${String(row.category_id)}`;
      const bucket = seriesByKey.get(key) ?? [];
      const itemsMilli = unitsToMilli(row.items_milli);
      bucket.push({
        date: row.date,
        orders: row.orders,
        itemsMilli,
        items: milliToUnits(itemsMilli),
        totalMinor: row.total_minor,
        netMinor: row.net_minor,
        averageTicketMinor: averageTicket(row.total_minor, row.orders),
      });
      seriesByKey.set(key, bucket);
    }

    const data: ProductRevenueRow[] = rows.map((row) => {
      const key = groupBy === 'product' ? `product:${String(row.product_id)}` : `category:${String(row.category_id)}`;
      const quantityMilli = unitsToMilli(row.quantity_milli);
      const marginMinor =
        row.cost_minor === null
          ? null
          : subtractMinor(row.total_minor, Math.round((row.cost_minor * quantityMilli) / 1000));
      return {
        key,
        name: row.name,
        quantityMilli,
        quantity: milliToUnits(quantityMilli),
        subtotalMinor: row.subtotal_minor,
        discountMinor: row.discount_minor,
        taxMinor: row.tax_minor,
        totalMinor: row.total_minor,
        netMinor: row.total_minor,
        shareBp: shareBp(row.total_minor, totals.net_minor),
        marginMinor,
        sales: seriesByKey.get(key) ?? [],
      };
    });

    return {
      data,
      totals: { netMinor: totals.net_minor, productsWithSales: totals.products },
      meta: {
        range: this.rangeMeta(range),
        generatedAt: nowIso(),
        total: this.repository.countProductRevenue(filters, groupBy),
        page,
        pageSize,
      },
    };
  }

  // ==========================================================================
  // Sillas y alquileres
  // ==========================================================================

  public chairOccupancy(
    request: ChairOccupancyRequest,
    context: ReportRequestContext,
  ): ReportResult<ChairOccupancyReport> {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);

    // CUATRO consultas fijas: alquileres, reservas, sillas y capacidad. Ninguna
    // depende del número de sillas, así que no hay N+1 aunque haya 500 sillas.
    const rentals = this.repository.rentals(filters);
    const reservations = this.repository.reservations(filters);
    const chairs = this.repository.chairsInScope(filters);
    const capacity = this.repository.chairCapacity(filters);

    const occupancy = this.accumulateOccupancy(rentals, reservations, range.minutes);
    const chairById = new Map(chairs.map((chair) => [chair.chair_id, chair]));

    // "SOLO CUENTA SILLAS CON OCUPACIÓN REAL": una silla sin ninguna sesión en
    // el rango no aparece en `byChair`. Un mapa con 400 sillas libres y cero
    // minutos ocupados no es un reporte de ocupación, es ruido.
    const byChair: ChairOccupancyRow[] = [...occupancy.byChair.values()]
      .filter((entry) => entry.sessions > 0)
      .map((entry) => {
        const chair = chairById.get(entry.chairId);
        return {
          chairId: entry.chairId,
          code: chair?.code ?? '',
          name: chair?.name ?? null,
          kind: (chair?.kind ?? ChairKind.CHAIR) as ChairKind,
          zoneId: chair?.zone_id ?? 0,
          zoneName: chair?.zone_name ?? '',
          status: (chair?.status ?? ChairStatus.AVAILABLE) as ChairStatus,
          sessions: entry.sessions,
          occupiedMinutes: entry.occupiedMinutes,
          reservedMinutes: entry.reservedMinutes,
          utilizationBp: shareBp(entry.occupiedMinutes, range.minutes),
          revenueMinor: entry.revenueMinor,
          overageMinutes: entry.overageMinutes,
          overageRevenueMinor: entry.overageRevenueMinor,
        };
      })
      .sort((a, b) => b.occupiedMinutes - a.occupiedMinutes || a.code.localeCompare(b.code));

    const byZone = this.aggregateZones(occupancy.byChair, chairById, range.minutes);
    const occupiedMinutes = byChair.reduce((acc, row) => acc + row.occupiedMinutes, 0);
    const overageMinutes = byChair.reduce((acc, row) => acc + row.overageMinutes, 0);
    const revenueMinor = byChair.reduce((acc, row) => acc + row.revenueMinor, 0);
    const sessions = byChair.reduce((acc, row) => acc + row.sessions, 0);
    const availableMinutes = capacity.chairs * range.minutes;

    const summary: ChairOccupancySummary = {
      totalChairs: capacity.chairs,
      totalCapacity: capacity.capacity,
      availableMinutes,
      occupiedMinutes,
      reservedMinutes: byChair.reduce((acc, row) => acc + row.reservedMinutes, 0),
      utilizationBp: shareBp(occupiedMinutes, availableMinutes),
      avgSessionMinutes: safeRatio(occupiedMinutes, sessions),
      totalSessions: sessions,
      overageMinutes,
      overageRevenueMinor: byChair.reduce((acc, row) => acc + row.overageRevenueMinor, 0),
      revenueMinor,
    };

    return {
      data: {
        summary,
        byChair,
        byZone,
        timeline: this.occupancyTimeline(rentals, reservations, range, capacity.chairs),
      },
      meta: { range: this.rangeMeta(range), generatedAt: nowIso() },
    };
  }

  public rentalRevenue(
    request: RentalRevenueRequest,
    context: ReportRequestContext,
  ): ReportResult<RentalRevenueReport> {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);

    const rentals = this.repository.rentals(filters);
    const chairs = this.repository.chairsInScope(filters);

    const summary: RentalRevenueSummary = {
      sessions: rentals.length,
      totalMinutes: rentals.reduce((acc, row) => acc + row.session_minutes, 0),
      billedMinutes: rentals.reduce(
        (acc, row) => acc + Math.max(row.billed_minutes, RENTAL.MIN_BILLED_MINUTES),
        0,
      ),
      overtimeMinutes: rentals.reduce((acc, row) => acc + overtimeMinutesOf(row), 0),
      subtotalMinor: rentals.reduce((acc, row) => acc + row.subtotal_minor, 0),
      extensionsMinor: rentals.reduce((acc, row) => acc + row.extensions_minor, 0),
      overtimeMinor: rentals.reduce((acc, row) => acc + row.extra_minutes_minor, 0),
      discountMinor: rentals.reduce((acc, row) => acc + row.discount_minor, 0),
      taxMinor: rentals.reduce((acc, row) => acc + row.tax_minor, 0),
      totalMinor: rentals.reduce((acc, row) => acc + row.total_minor, 0),
      averageSessionMinutes: safeRatio(
        rentals.reduce((acc, row) => acc + row.session_minutes, 0),
        rentals.length,
      ),
      averageRevenuePerSessionMinor: safeRatio(
        rentals.reduce((acc, row) => acc + row.total_minor, 0),
        rentals.length,
      ),
      minimumAppliedCount: rentals.filter(
        (row) => row.billed_minutes > 0 && row.billed_minutes === RENTAL.MIN_BILLED_MINUTES,
      ).length,
      appliedRules: ['BR-RENTAL-001', 'BR-RENTAL-002', 'BR-RENTAL-003', 'BR-RENTAL-004'],
    };

    const chairById = new Map(chairs.map((chair) => [chair.chair_id, chair]));
    const byChair = this.rentalRows(
      rentals,
      (row) => `chair:${String(row.chair_id)}`,
      (row) => chairById.get(row.chair_id)?.code ?? String(row.chair_id),
    );
    const byZone = this.rentalRows(
      rentals,
      (row) => `zone:${String(row.zone_id)}`,
      (row) => row.zone_name,
    );
    const byDay = this.rentalRows(
      rentals,
      (row) => localDateKeyOf(new Date(row.start_at), range.timezone),
      (row) => localDateKeyOf(new Date(row.start_at), range.timezone),
    );

    return {
      data: { summary, byChair, byZone, byDay },
      meta: { range: this.rangeMeta(range), generatedAt: nowIso() },
    };
  }

  /** Agrupa los alquileres por la clave que le indique cada función. */
  private rentalRows(
    rentals: readonly import('./reports.repository.js').RentalRow[],
    keyOf: (row: import('./reports.repository.js').RentalRow) => string,
    labelOf: (row: import('./reports.repository.js').RentalRow) => string,
  ): readonly RentalRevenueRow[] {
    const buckets = new Map<string, { label: string; sessions: number; minutes: number; billed: number; overtime: number; total: number }>();
    for (const row of rentals) {
      const key = keyOf(row);
      const bucket = buckets.get(key) ?? {
        label: labelOf(row),
        sessions: 0,
        minutes: 0,
        billed: 0,
        overtime: 0,
        total: 0,
      };
      bucket.sessions += 1;
      bucket.minutes += row.session_minutes;
      bucket.billed += Math.max(row.billed_minutes, RENTAL.MIN_BILLED_MINUTES);
      bucket.overtime += overtimeMinutesOf(row);
      bucket.total = addMinor(bucket.total, row.total_minor);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        label: bucket.label,
        sessions: bucket.sessions,
        minutes: bucket.minutes,
        billedMinutes: bucket.billed,
        overtimeMinutes: bucket.overtime,
        totalMinor: bucket.total,
      }))
      .sort((a, b) => b.totalMinor - a.totalMinor || a.key.localeCompare(b.key));
  }

  // ==========================================================================
  // Clientes
  // ==========================================================================

  public customers(
    request: CustomersRequest,
    context: ReportRequestContext,
  ): ReportResult<readonly CustomerReportRow[]> & { readonly total: number; readonly totals: CustomerReportTotals } {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);
    const page = Math.max(1, request.page ?? 1);
    const pageSize = clamp(request.pageSize ?? 50, 1, 500);
    const orderBy = request.orderBy ?? 'totalSpent';
    const segment = request.segment ?? 'all';

    const rows = this.repository.customers(filters, orderBy, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    const total = this.repository.countCustomers(filters);
    const totals = this.repository.customerTotals(filters);

    const data = rows
      .map((row) => this.toCustomerRow(row, now))
      .filter((row) => request.onlyWithOrders !== false || row.orders > 0)
      .filter((row) => segment === 'all' || row.segment === segment);

    const returning = data.filter((row) => row.orders >= 2).length;
    const previous = this.repository.customerTotals(
      this.filters(this.previousRangeOf(range), businessId, request, now),
    );

    return {
      data,
      total,
      totals: {
        customers: totals.customers,
        newCustomers: totals.new_customers,
        returningCustomers: returning,
        loyalCustomers: data.filter((row) => row.segment === 'loyal').length,
        atRiskCustomers: data.filter((row) => row.segment === 'atRisk').length,
        repeatRateBp: shareBp(returning, data.length),
        totalSpentMinor: totals.total_spent_minor,
        averageTicketMinor: averageTicket(totals.total_spent_minor, totals.orders),
        withChairReservation: totals.with_reservation,
        newCustomersChangeBp: variationBp(totals.new_customers, previous.new_customers),
      },
      meta: { range: this.rangeMeta(range), generatedAt: nowIso(), total, page, pageSize },
    };
  }

  /** Convierte una fila de cliente en su vista, con su segmento. */
  private toCustomerRow(
    row: import('./reports.repository.js').CustomerRow,
    now: Date,
  ): CustomerReportRow {
    const lastOrder = row.last_order_at === null ? null : new Date(row.last_order_at);
    const daysSince = lastOrder === null ? null : Math.floor((now.getTime() - lastOrder.getTime()) / 86_400_000);
    const net = subtractMinor(row.total_spent_minor, row.refunded_minor);
    // Segmento por compras EN EL RANGO: 1 = nuevo, 2-4 = recurrente, 5+ = fiel.
    // `atRisk` se superpone a los tres: es "no compra hace más de 30 días", una
    // señal de riesgo, no una categoría que excluya a los demás.
    let segment: CustomerSegment;
    if (daysSince !== null && daysSince > AT_RISK_DAYS) {
      segment = 'atRisk';
    } else if (row.orders <= 1) {
      segment = 'new';
    } else if (row.orders < 5) {
      segment = 'returning';
    } else {
      segment = 'loyal';
    }
    return {
      customerId: row.customer_id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone,
      orders: row.orders,
      itemsMilli: unitsToMilli(row.items_milli),
      items: milliToUnits(unitsToMilli(row.items_milli)),
      totalSpentMinor: net,
      averageTicketMinor: averageTicket(net, row.orders),
      firstOrderAt: row.first_order_at,
      lastOrderAt: row.last_order_at,
      daysSinceLastOrder: daysSince,
      totalRentalMinutes: row.rental_minutes,
      hasChairReservation: row.reservations > 0,
      segment,
    };
  }

  // ==========================================================================
  // Inventario
  // ==========================================================================

  public inventory(
    request: InventoryReportRequest,
    context: ReportRequestContext,
  ): ReportResult<InventoryReport> {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);
    const page = Math.max(1, request.page ?? 1);
    const pageSize = clamp(request.pageSize ?? 50, 1, 100);
    const lowStockOnly = request.lowStockOnly === true;
    const includeZeroStock = request.includeZeroStock !== false;
    const rangeDays = Math.max(1, Math.round(range.minutes / (24 * 60)));

    const rows = this.repository.inventoryItems(filters, { limit: pageSize, offset: (page - 1) * pageSize });
    const total = this.repository.countInventoryItems(filters);
    const summaryRaw = this.repository.inventorySummary(filters);
    const bySupplier = this.repository.inventoryGroups(filters, 'supplier');
    const byStorage = this.repository.inventoryGroups(filters, 'locationStorage');

    const byItem: InventoryReportRow[] = rows
      .filter((row) => (includeZeroStock ? true : row.current_stock > 0))
      .map((row) => {
        const isLowStock =
          row.is_tracked === 1 &&
          row.current_stock <= (row.min_stock > 0 ? row.min_stock : filters.lowStockThreshold);
        // `valueMinor = roundHalfUp(current_stock × cost_minor)`, en centavos.
        const valueMinor = roundHalfUp(row.current_stock * row.cost_minor);
        // Rotación aproximada: salidas del rango sobre el stock actual,
        // normalizadas por los días del rango. Es un INDICATIVO: con pocos días
        // de historial no es interpretable, y por eso se publica en basis points
        // con el denominador visible en `summary.rangeDays`.
        const rotationBp = shareBp(row.out_milli, Math.round(row.current_stock * 1000) * rangeDays);
        return {
          itemId: row.item_id,
          name: row.name,
          sku: row.sku,
          unit: row.unit,
          currentStock: row.current_stock,
          minStock: row.min_stock,
          costMinor: row.cost_minor,
          valueMinor,
          isLowStock,
          supplier: row.supplier,
          locationStorage: row.location_storage,
          lastMovementAt: row.last_movement_at,
          movementsInRange: {
            inQuantityMilli: row.in_milli,
            outQuantityMilli: row.out_milli,
            netQuantityMilli: row.in_milli - row.out_milli,
            movements: row.movements,
          },
          noMovementInRange: row.movements === 0,
          rotationBp,
        };
      })
      .filter((row) => (lowStockOnly ? row.isLowStock : true));

    const summary: InventoryReportSummary = {
      items: summaryRaw.items,
      trackedItems: summaryRaw.tracked_items,
      totalValueMinor: summaryRaw.total_value_minor,
      totalQuantityByUnit: parseQuantityMap(summaryRaw.quantities_by_unit),
      lowStockCount: summaryRaw.low_stock_count,
      outOfStockCount: summaryRaw.out_of_stock_count,
      negativeStockCount: summaryRaw.negative_stock_count,
      averageCostMinor: safeRatio(
        Math.round(summaryRaw.weighted_cost),
        summaryRaw.stock_items,
      ),
      noMovementCount: summaryRaw.no_movement_count,
      rangeDays,
    };

    return {
      data: {
        summary,
        byItem,
        bySupplier: this.toInventoryGroups(bySupplier),
        byStorage: this.toInventoryGroups(byStorage),
      },
      meta: { range: this.rangeMeta(range), generatedAt: nowIso(), total, page, pageSize },
    };
  }

  private toInventoryGroups(
    rows: readonly { readonly key: string; readonly items: number; readonly total_value_minor: number; readonly total_stock_milli: number; readonly low_stock_count: number }[],
  ): readonly InventoryGroupRow[] {
    return rows.map((row) => ({
      key: row.key,
      items: row.items,
      totalValueMinor: row.total_value_minor,
      totalStockMilli: row.total_stock_milli,
      lowStockCount: row.low_stock_count,
    }));
  }

  // ==========================================================================
  // Resumen de pedidos
  // ==========================================================================

  public ordersSummary(
    request: OrdersSummaryRequest,
    context: ReportRequestContext,
  ): ReportResult<readonly OrdersSummaryRow[]> & { readonly totals: OrdersSummaryTotals } {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);
    const groupBy = request.groupBy ?? 'day';

    const groups = this.repository.ordersSummary(filters, groupBy);
    const totals = this.repository.orderTotals(filters);

    const data: OrdersSummaryRow[] = groups.map((row) => ({
      group: row.group_key,
      orders: row.orders,
      cancelled: row.cancelled,
      refunded: row.refunded,
      completed: row.completed,
      pending: row.pending,
      averagePreparationMinutes: safeRatio(row.preparation_minutes_milli, row.preparation_samples * 1000),
      averageWaitMinutes: safeRatio(row.wait_minutes_milli, row.wait_samples * 1000),
      firstOrderAt: row.first_order_at,
      lastOrderAt: row.last_order_at,
      totalMinor: row.total_minor,
    }));

    return {
      data,
      totals: {
        orders: totals.orders + totals.cancelled_orders,
        completed: totals.completed_orders,
        cancelled: totals.cancelled_orders,
        refunded: totals.refunded_orders,
        pending: totals.pending_orders,
        totalMinor: totals.total_minor,
        cancelRateBp: shareBp(totals.cancelled_orders, totals.orders + totals.cancelled_orders),
        averagePreparationMinutes: safeRatio(
          totals.preparation_minutes_milli,
          totals.preparation_samples * 1000,
        ),
        averageWaitMinutes: safeRatio(totals.wait_minutes_milli, totals.wait_samples * 1000),
        averageItemsPerOrderMilli: unitsToMilli(
          ratioOf(totals.items_milli, Math.max(1, totals.orders), 1),
        ),
        averageItemsPerOrder: milliToUnits(
          unitsToMilli(ratioOf(totals.items_milli, Math.max(1, totals.orders), 1)),
        ),
        itemsCancelled: milliToUnits(unitsToMilli(totals.items_cancelled_milli)),
      },
      meta: { range: this.rangeMeta(range), generatedAt: nowIso() },
    };
  }

  // ==========================================================================
  // Exportación CSV
  // ==========================================================================

  /**
   * Genera el CSV del reporte pedido y deja rastro en `audit_logs`.
   *
   * La exportación es una acción administrativa que EXTRAE datos, así que va
   * auditada con `action = EXPORT` y `entity_type = 'export'`, incluyendo los
   * parámetros usados (rango, reporte, columnas) y NO los datos de los clientes:
   * lo que se registra es QUÉ se exportó, no lo que contenía el fichero.
   *
   * Las ventas se leen en BLOQUES de 5 000 para no materializar 100 000 filas de
   * golpe en memoria: el número de consultas crece con el tamaño del rango, pero
   * es acotado y predecible, y nunca es "una consulta por fila".
   */
  public async export(
    request: ExportRequest,
    context: ReportRequestContext,
  ): Promise<import('./reports.types.js').CsvExport> {
    const now = request.now ?? new Date();
    const businessId = context.actor.businessId;
    const range = this.resolveRange(request.range, businessId, now);
    const filters = this.filters(range, businessId, request, now);
    const baseName = request.filename ?? `${request.report}-${range.localFrom}_${range.localTo}`;
    const includeTotals = request.includeTotalsRow !== false;

    const spec = this.exportColumns(request.report);
    let rows: Record<string, unknown>[] = [];
    let totalRow: Record<string, unknown> | null = null;

    switch (request.report) {
      case 'sales': {
        // Se recorren TODAS las ventas del rango concatenando páginas: el
        // rango se resuelve una vez, arriba, y las páginas sólo paginan.
        const total = this.repository.countSalesRowsForExport(filters);
        const collected: Record<string, unknown>[] = [];
        for (let offset = 0; offset < total; offset += EXPORT_PAGE_SIZE) {
          const page = this.repository.salesRowsForExport(filters, {
            limit: EXPORT_PAGE_SIZE,
            offset,
          });
          for (const row of page) collected.push(toRecord(row));
          if (page.length === 0) break;
        }
        rows = collected;
        totalRow = includeTotals ? sumSalesRows(collected) : null;
        break;
      }
      case 'sales-by-day':
      case 'sales-by-hour': {
        const result =
          request.report === 'sales-by-hour'
            ? this.salesByHour(request, context)
            : this.salesByDay(request, context);
        rows = result.data.map((point) => toRecord(point));
        break;
      }
      case 'top-products': {
        const result = this.topProducts(
          { ...request, orderBy: request.orderBy ?? 'quantity', page: 1, pageSize: 100 },
          context,
        );
        rows = result.data.map((row) => toRecord(row));
        break;
      }
      case 'product-revenue': {
        const result = this.productRevenue(
          { ...request, groupBy: asProductGroup(request.groupBy), page: 1, pageSize: 100 },
          context,
        );
        rows = result.data.map((row) => toRecord(row));
        break;
      }
      case 'chair-occupancy': {
        const result = this.chairOccupancy(
          { ...request, groupBy: asChairGroup(request.groupBy) },
          context,
        );
        rows = result.data.byChair.map((row) => toRecord(row));
        break;
      }
      case 'rental-revenue': {
        const result = this.rentalRevenue(
          { ...request, groupBy: asRentalGroup(request.groupBy) },
          context,
        );
        rows = result.data.byChair.map((row) => toRecord(row));
        break;
      }
      case 'customers': {
        const result = this.customers(
          {
            ...request,
            orderBy: request.groupBy === 'day' ? 'lastOrder' : 'totalSpent',
            page: 1,
            pageSize: 500,
          },
          context,
        );
        rows = result.data.map((row) => toRecord(row));
        break;
      }
      case 'inventory': {
        const result = this.inventory({ ...request, page: 1, pageSize: 100 }, context);
        rows = result.data.byItem.map((row) => toRecord(row));
        break;
      }
      case 'orders-summary': {
        const result = this.ordersSummary(
          { ...request, groupBy: asSummaryGroup(request.groupBy) },
          context,
        );
        rows = result.data.map((row) => toRecord(row));
        break;
      }
      default:
        throw new ValidationError('El reporte solicitado no existe', {
          details: [
            {
              path: 'report',
              message: `"${String(request.report)}" no es un reporte exportable`,
              code: 'INVALID_REPORT',
            },
          ],
        });
    }

    const csv = buildCsv(spec, rows, totalRow, request.columns, baseName);

    this.audit.record({
      action: AuditAction.EXPORT,
      entityType: 'export',
      actor: {
        id: context.actor.id,
        email: context.actor.email,
        businessId: context.actor.businessId,
      },
      request: context.request,
      afterData: {
        report: request.report,
        range: { from: range.from, to: range.to, timezone: range.timezone, preset: range.preset },
        rows: csv.rows,
        columns: csv.columns,
        filename: csv.filename,
        includeTotalsRow: includeTotals,
      },
    });

    return csv;
  }

  /** Definición de columnas de cada reporte exportable. */
  private exportColumns(report: ExportableReport): readonly ReportColumnSpec[] {
    return EXPORT_COLUMNS[report] ?? [];
  }

  // ==========================================================================
  // Utilidades internas
  // ==========================================================================

  /** Rango anterior de la misma duración. */
  private previousRangeOf(range: ReportRange): ReportRange {
    const from = new Date(range.previous.fromUtc);
    const to = new Date(range.previous.toUtc);
    return {
      ...range,
      from: from.toISOString(),
      to: to.toISOString(),
      fromUtc: from.toISOString(),
      toUtc: to.toISOString(),
      localFrom: localDateKeyOf(from, range.timezone),
      localTo: localDateKeyOf(to, range.timezone),
      minutes: minutesBetween(from, to),
      plan: buildTimeZonePlan(from, to, range.timezone),
    };
  }

  /**
   * Acumula la ocupación por silla a partir de los alquileres y las reservas.
   *
   * Se hace en memoria y NO con una consulta por silla: los cruces son por
   * `Map` y el número de consultas del endpoint es fijo.
   */
  private accumulateOccupancy(
    rentals: readonly import('./reports.repository.js').RentalRow[],
    reservations: readonly import('./reports.repository.js').ReservationRow[],
    rangeMinutes: number,
  ): {
    readonly byChair: ReadonlyMap<
      number,
      {
        chairId: number;
        sessions: number;
        occupiedMinutes: number;
        reservedMinutes: number;
        revenueMinor: number;
        overageMinutes: number;
        overageRevenueMinor: number;
      }
    >;
  } {
    const byChair = new Map<
      number,
      {
        chairId: number;
        sessions: number;
        occupiedMinutes: number;
        reservedMinutes: number;
        revenueMinor: number;
        overageMinutes: number;
        overageRevenueMinor: number;
      }
    >();
    const bucket = (chairId: number) => {
      const found = byChair.get(chairId) ?? {
        chairId,
        sessions: 0,
        occupiedMinutes: 0,
        reservedMinutes: 0,
        revenueMinor: 0,
        overageMinutes: 0,
        overageRevenueMinor: 0,
      };
      return found;
    };
    for (const rental of rentals) {
      const entry = bucket(rental.chair_id);
      entry.sessions += 1;
      entry.occupiedMinutes += rental.minutes_in_range;
      entry.revenueMinor = addMinor(entry.revenueMinor, rental.total_minor);
      const overtime = overtimeMinutesOf(rental);
      entry.overageMinutes += overtime;
      entry.overageRevenueMinor = addMinor(entry.overageRevenueMinor, rental.extra_minutes_minor);
      byChair.set(rental.chair_id, entry);
    }
    for (const reservation of reservations) {
      // Una reserva que se convirtió en alquiler ya está contada como sesión: sólo
      // se suma el tiempo RESERVADO cuando no hubo alquiler para esa silla.
      const entry = bucket(reservation.chair_id);
      if (entry.sessions === 0) {
        entry.reservedMinutes += Math.min(reservation.minutes_in_range, rangeMinutes);
      }
      byChair.set(reservation.chair_id, entry);
    }
    return { byChair };
  }

  /** Agrega la ocupación por zona, a partir de la acumulación por silla. */
  private aggregateZones(
    byChair: ReadonlyMap<number, { chairId: number; sessions: number; occupiedMinutes: number; reservedMinutes: number; revenueMinor: number }>,
    chairById: ReadonlyMap<number, { zone_id: number; zone_name: string }>,
    rangeMinutes: number,
  ): readonly ZoneOccupancyRow[] {
    const zones = new Map<number, { id: number; name: string; chairs: number; sessions: number; occupied: number; reserved: number; revenue: number }>();
    for (const [chairId, entry] of byChair) {
      const chair = chairById.get(chairId);
      if (chair === undefined) continue;
      const zone = zones.get(chair.zone_id) ?? {
        id: chair.zone_id,
        name: chair.zone_name,
        chairs: 0,
        sessions: 0,
        occupied: 0,
        reserved: 0,
        revenue: 0,
      };
      zone.chairs += 1;
      zone.sessions += entry.sessions;
      zone.occupied += entry.occupiedMinutes;
      zone.reserved += entry.reservedMinutes;
      zone.revenue = addMinor(zone.revenue, entry.revenueMinor);
      zones.set(chair.zone_id, zone);
    }
    return [...zones.values()]
      .map((zone) => ({
        zoneId: zone.id,
        name: zone.name,
        chairs: zone.chairs,
        sessions: zone.sessions,
        occupiedMinutes: zone.occupied,
        availableMinutes: Math.max(0, zone.chairs * rangeMinutes - zone.occupied),
        utilizationBp: shareBp(zone.occupied, zone.chairs * rangeMinutes),
        averageSessionMinutes: safeRatio(zone.occupied, zone.sessions),
        revenueMinor: zone.revenue,
      }))
      .sort((a, b) => b.occupiedMinutes - a.occupiedMinutes || a.name.localeCompare(b.name));
  }

  /**
   * Línea de tiempo de ocupación, en franjas de una hora local.
   *
   * Se recorre cada sesión y se reparte en las horas que toca. Es O(sesiones ×
   * horas de la sesión), que es pequeño y está acotado por el rango, y evita una
   * expansión en SQL que multiplicaría las filas por el número de horas del
   * rango (7 800 para un año).
   */
  private occupancyTimeline(
    rentals: readonly import('./reports.repository.js').RentalRow[],
    reservations: readonly import('./reports.repository.js').ReservationRow[],
    range: ReportRange,
    totalChairs: number,
  ): readonly import('./reports.types.js').OccupancyTimelinePoint[] {
    const from = new Date(range.from);
    const to = new Date(range.to);
    const buckets = new Map<string, { date: string; hour: number; occupied: Set<number>; reserved: Set<number> }>();

    const visit = (
      chairId: number,
      startIso: string,
      endIso: string,
      kind: 'occupied' | 'reserved',
    ): void => {
      let cursor = new Date(startIso);
      if (cursor.getTime() < from.getTime()) cursor = from;
      const end = new Date(endIso);
      const stop = end.getTime() < to.getTime() ? end : to;
      // Tope defensivo: 400 iteraciones por sesión (más de 16 días) es un bucle
      // que el rango máximo (366 días) no puede alcanzar.
      for (let guard = 0; guard < 400 && cursor.getTime() < stop.getTime(); guard += 1) {
        const date = localDateKeyOf(cursor, range.timezone);
        const hour = localHourOf(cursor, range.timezone);
        const key = `${date}#${String(hour).padStart(2, '0')}`;
        const bucket = buckets.get(key) ?? { date, hour, occupied: new Set<number>(), reserved: new Set<number>() };
        if (kind === 'occupied') bucket.occupied.add(chairId);
        else bucket.reserved.add(chairId);
        buckets.set(key, bucket);
        cursor = new Date(cursor.getTime() + 3_600_000);
      }
    };

    for (const rental of rentals) {
      const endIso = rental.status === 'ACTIVE' || rental.status === 'EXTENDED' ? nowIso() : rental.end_at;
      visit(rental.chair_id, rental.start_at, endIso, 'occupied');
    }
    for (const reservation of reservations) {
      visit(reservation.chair_id, reservation.start_at, reservation.end_at, 'reserved');
    }

    // El denominador de la ocupación de UNA FRANJA es `sillas × 60 minutos`, con
    // el mismo criterio que el resumen: silla-minutos ocupados sobre silla-minutos
    // disponibles. Se usa `max(1, ...)` para no dividir por cero si el ámbito no
    // tiene ninguna silla activa.
    const chairs = Math.max(1, totalChairs);
    return [...buckets.values()]
      .map((bucket) => ({
        date: bucket.date,
        hour: bucket.hour,
        occupiedChairs: bucket.occupied.size,
        reservedChairs: bucket.reserved.size,
        utilizationBp: shareBp(bucket.occupied.size * 60, chairs * 60),
      }))
      .sort((a, b) => (a.date === b.date ? a.hour - b.hour : a.date.localeCompare(b.date)));
  }
}

// ---------------------------------------------------------------------------
// Utilidades puras de módulo
// ---------------------------------------------------------------------------

/**
 * Parsea un instante de la query a `Date`.
 *
 * Acepta un ISO-8601 completo (`2026-03-14T15:04:05.000Z`, con o sin offset) y
 * también un `--T` o un espacio. Se usa `parseIso` de `shared/utils/datetime.ts`
 * para no reimplementar la validación del formato.
 */
function parseInstant(value: string, field: 'from' | 'to'): Date {
  const normalized = value.includes('T') || value.includes(' ') ? value : `${value}T00:00:00.000Z`;
  return parseIso(normalized, field);
}

/** `YYYY-MM-DD` de un instante en la zona indicada. */
function localDateKeyOf(instant: Date, timezone: string): string {
  return localDateKey(instant, timezone);
}

/** Convierte `YYYY-MM-DD` en sus tres partes numéricas. */
function parseDateKey(key: string): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-');
  return { year: Number(year), month: Number(month), day: Number(day) };
}

/** `YYYY-MM-DD` de una fecha local. */
function localFromKey(date: { year: number; month: number; day: number }): string {
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/** Alias legible de {@link localFromKey}. */
function localToKey(date: { year: number; month: number; day: number }): string {
  return localFromKey(date);
}

/**
 * Minutos de overage de un alquiler (BR-RENTAL-004).
 *
 * `extra_minutes = max(0, billed − planned_final)`, y `planned_final` es el
 * `end_at` vigente tras extensiones con el mismo suelo de 30 minutos que usa la
 * facturación (BR-RENTAL-001). Un alquiler abierto no tiene `billed_minutes`, así
 * que no puede tener overage todavía: se le reconoce 0.
 */
function overtimeMinutesOf(rental: { billed_minutes: number; start_at: string; end_at: string; status: string }): number {
  if (rental.billed_minutes <= 0) return 0;
  const planned = Math.max(
    RENTAL.MIN_BILLED_MINUTES,
    Math.ceil(minutesBetween(new Date(rental.start_at), new Date(rental.end_at))),
  );
  return Math.max(0, rental.billed_minutes - planned);
}

/**
 * Convierte la `groupBy` genérica del body de exportación en la del reporte
 * concreto. Un `groupBy=type` en un `POST /export` de `product-revenue` no
 * significa nada, así que se cae al valor por defecto del reporte en vez de
 * dejar que un valor ajeno llegue a la consulta.
 */
function asProductGroup(
  value: ReportGrouping | 'product' | 'category' | undefined,
): 'product' | 'category' {
  return value === ('category' as string) ? 'category' : 'product';
}

/** Igual, para `chair-occupancy`. */
function asChairGroup(
  value: ReportGrouping | 'product' | 'category' | undefined,
): 'chair' | 'zone' | 'hour' {
  return value === ('zone' as string) || value === ('hour' as string)
    ? (value as 'zone' | 'hour')
    : 'chair';
}

/** Igual, para `rental-revenue`. */
function asRentalGroup(
  value: ReportGrouping | 'product' | 'category' | undefined,
): 'chair' | 'zone' | 'day' | 'month' {
  const candidate: string = value ?? '';
  if (candidate === 'zone' || candidate === 'day' || candidate === 'month') {
    return candidate as 'zone' | 'day' | 'month';
  }
  return 'chair';
}

/** Acota la `groupBy` del resumen de pedidos a su propio vocabulario. */
function asSummaryGroup(
  value: ReportGrouping | 'product' | 'category' | undefined,
): ReportGrouping {
  switch (value) {
    case 'week':
    case 'month':
    case 'hour':
    case 'status':
    case 'type':
    case 'channel':
      return value;
    default:
      return 'day';
  }
}

/** Acota un entero a un rango. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Convierte una fila strongly-typed a `Record<string, unknown>` para el CSV. */
function toRecord(row: object): Record<string, unknown> {
  return { ...row } as Record<string, unknown>;
}

/** Parsea el mapa de existencias por unidad que devuelve el repositorio. */
function parseQuantityMap(json: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([unit, qty]) => [unit, Number(qty)]),
    );
  } catch {
    return {};
  }
}

/** Fila de totales de la exportación de ventas, sumando en enteros. */
function sumSalesRows(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const sum = (key: string): number =>
    rows.reduce((acc, row) => acc + Number(row[key] ?? 0), 0);
  const orders = rows.length;
  const total = sum('total_minor');
  return {
    order_id: 0,
    order_number: 'TOTAL',
    created_at: '',
    local_date: '',
    local_hour: null,
    type: '',
    status: '',
    channel: '',
    location_id: null,
    customer_id: null,
    customer_name: `TOTAL (${String(orders)} ventas)`,
    items_milli: sum('items_milli'),
    subtotal_minor: sum('subtotal_minor'),
    discount_minor: sum('discount_minor'),
    tax_minor: sum('tax_minor'),
    service_fee_minor: sum('service_fee_minor'),
    total_minor: total,
    paid_minor: sum('paid_minor'),
    refunded_minor: sum('refunded_minor'),
    cash_minor: sum('cash_minor'),
    card_minor: sum('card_minor'),
    transfer_minor: sum('transfer_minor'),
    online_minor: sum('online_minor'),
  };
}

// ---------------------------------------------------------------------------
// Definición de columnas del CSV por reporte
// ---------------------------------------------------------------------------

/** Columnas del CSV de cada reporte, en el orden en que se publican. */
const EXPORT_COLUMNS: Readonly<Record<ExportableReport, readonly ReportColumnSpec[]>> = Object.freeze({
  sales: [
    { key: 'order_number', label: 'Numero pedido', value: (row) => String(row['order_number'] ?? '') },
    { key: 'local_date', label: 'Fecha (local)', value: (row) => String(row['local_date'] ?? '') },
    {
      key: 'local_hour',
      label: 'Hora (local)',
      // La fila de totales no tiene hora: se deja en blanco en vez de publicar
      // un `0` que se leería como "las ventas ocurrieron a medianoche".
      value: (row) => (row['local_hour'] === null || row['local_hour'] === undefined ? '' : Number(row['local_hour'])),
    },
    { key: 'type', label: 'Tipo', value: (row) => String(row['type'] ?? '') },
    { key: 'status', label: 'Estado', value: (row) => String(row['status'] ?? '') },
    { key: 'channel', label: 'Canal', value: (row) => String(row['channel'] ?? '') },
    { key: 'customer_name', label: 'Cliente', value: (row) => String(row['customer_name'] ?? '') },
    { key: 'items_milli', label: 'Unidades (milesimas)', value: (row) => Number(row['items_milli'] ?? 0) },
    { key: 'subtotal_minor', label: 'Subtotal (cents)', value: (row) => Number(row['subtotal_minor'] ?? 0) },
    { key: 'discount_minor', label: 'Descuento (cents)', value: (row) => Number(row['discount_minor'] ?? 0) },
    { key: 'tax_minor', label: 'Impuesto (cents)', value: (row) => Number(row['tax_minor'] ?? 0) },
    { key: 'service_fee_minor', label: 'Cargo servicio (cents)', value: (row) => Number(row['service_fee_minor'] ?? 0) },
    { key: 'total_minor', label: 'Total (cents)', value: (row) => Number(row['total_minor'] ?? 0) },
    { key: 'refunded_minor', label: 'Reembolsado (cents)', value: (row) => Number(row['refunded_minor'] ?? 0) },
    { key: 'cash_minor', label: 'Efectivo (cents)', value: (row) => Number(row['cash_minor'] ?? 0) },
    { key: 'card_minor', label: 'Tarjeta (cents)', value: (row) => Number(row['card_minor'] ?? 0) },
    { key: 'transfer_minor', label: 'Transferencia (cents)', value: (row) => Number(row['transfer_minor'] ?? 0) },
    { key: 'online_minor', label: 'Online (cents)', value: (row) => Number(row['online_minor'] ?? 0) },
  ],
  'sales-by-day': [
    { key: 'date', label: 'Fecha (local)', value: (row) => String(row['date'] ?? '') },
    { key: 'orders', label: 'Pedidos', value: (row) => Number(row['orders'] ?? 0) },
    { key: 'items', label: 'Unidades', value: (row) => Number(row['items'] ?? 0) },
    { key: 'totalMinor', label: 'Total (cents)', value: (row) => Number(row['totalMinor'] ?? 0) },
    { key: 'netMinor', label: 'Neto (cents)', value: (row) => Number(row['netMinor'] ?? 0) },
    { key: 'averageTicketMinor', label: 'Ticket medio (cents)', value: (row) => Number(row['averageTicketMinor'] ?? 0) },
    { key: 'rentals', label: 'Alquileres', value: (row) => Number(row['rentals'] ?? 0) },
    { key: 'rentalMinutes', label: 'Minutos alquiler', value: (row) => Number(row['rentalMinutes'] ?? 0) },
    { key: 'rentalRevenueMinor', label: 'Ingreso alquiler (cents)', value: (row) => Number(row['rentalRevenueMinor'] ?? 0) },
    { key: 'newCustomers', label: 'Clientes nuevos', value: (row) => Number(row['newCustomers'] ?? 0) },
  ],
  'sales-by-hour': [
    { key: 'hour', label: 'Hora (local)', value: (row) => Number(row['hour'] ?? 0) },
    { key: 'orders', label: 'Pedidos', value: (row) => Number(row['orders'] ?? 0) },
    { key: 'items', label: 'Unidades', value: (row) => Number(row['items'] ?? 0) },
    { key: 'totalMinor', label: 'Total (cents)', value: (row) => Number(row['totalMinor'] ?? 0) },
    { key: 'averageTicketMinor', label: 'Ticket medio (cents)', value: (row) => Number(row['averageTicketMinor'] ?? 0) },
    { key: 'rentalMinutes', label: 'Minutos alquiler', value: (row) => Number(row['rentalMinutes'] ?? 0) },
    { key: 'rentalRevenueMinor', label: 'Ingreso alquiler (cents)', value: (row) => Number(row['rentalRevenueMinor'] ?? 0) },
  ],
  'top-products': [
    { key: 'rank', label: 'Puesto', value: (row) => Number(row['rank'] ?? 0) },
    { key: 'name', label: 'Producto', value: (row) => String(row['name'] ?? '') },
    { key: 'sku', label: 'SKU', value: (row) => String(row['sku'] ?? '') },
    { key: 'categoryName', label: 'Categoria', value: (row) => String(row['categoryName'] ?? '') },
    { key: 'quantity', label: 'Unidades', value: (row) => Number(row['quantity'] ?? 0) },
    { key: 'orders', label: 'Pedidos', value: (row) => Number(row['orders'] ?? 0) },
    { key: 'totalMinor', label: 'Ingreso (cents)', value: (row) => Number(row['totalMinor'] ?? 0) },
    { key: 'averagePriceMinor', label: 'Precio medio (cents)', value: (row) => Number(row['averagePriceMinor'] ?? 0) },
    { key: 'marginMinor', label: 'Margen (cents)', value: (row) => (row['marginMinor'] === null ? '' : Number(row['marginMinor'])) },
  ],
  'product-revenue': [
    { key: 'key', label: 'Clave', value: (row) => String(row['key'] ?? '') },
    { key: 'name', label: 'Nombre', value: (row) => String(row['name'] ?? '') },
    { key: 'quantity', label: 'Unidades', value: (row) => Number(row['quantity'] ?? 0) },
    { key: 'subtotalMinor', label: 'Subtotal (cents)', value: (row) => Number(row['subtotalMinor'] ?? 0) },
    { key: 'discountMinor', label: 'Descuento (cents)', value: (row) => Number(row['discountMinor'] ?? 0) },
    { key: 'taxMinor', label: 'Impuesto (cents)', value: (row) => Number(row['taxMinor'] ?? 0) },
    { key: 'totalMinor', label: 'Total (cents)', value: (row) => Number(row['totalMinor'] ?? 0) },
    { key: 'shareBp', label: 'Peso (bp)', value: (row) => Number(row['shareBp'] ?? 0) },
    { key: 'marginMinor', label: 'Margen (cents)', value: (row) => (row['marginMinor'] === null ? '' : Number(row['marginMinor'])) },
  ],
  'chair-occupancy': [
    { key: 'code', label: 'Silla', value: (row) => String(row['code'] ?? '') },
    { key: 'zoneName', label: 'Zona', value: (row) => String(row['zoneName'] ?? '') },
    { key: 'kind', label: 'Tipo', value: (row) => String(row['kind'] ?? '') },
    { key: 'sessions', label: 'Sesiones', value: (row) => Number(row['sessions'] ?? 0) },
    { key: 'occupiedMinutes', label: 'Minutos ocupados', value: (row) => Number(row['occupiedMinutes'] ?? 0) },
    { key: 'utilizationBp', label: 'Ocupacion (bp)', value: (row) => Number(row['utilizationBp'] ?? 0) },
    { key: 'revenueMinor', label: 'Ingreso (cents)', value: (row) => Number(row['revenueMinor'] ?? 0) },
    { key: 'overageMinutes', label: 'Minutos extra', value: (row) => Number(row['overageMinutes'] ?? 0) },
  ],
  'rental-revenue': [
    { key: 'key', label: 'Clave', value: (row) => String(row['key'] ?? '') },
    { key: 'label', label: 'Etiqueta', value: (row) => String(row['label'] ?? '') },
    { key: 'sessions', label: 'Sesiones', value: (row) => Number(row['sessions'] ?? 0) },
    { key: 'minutes', label: 'Minutos', value: (row) => Number(row['minutes'] ?? 0) },
    { key: 'billedMinutes', label: 'Minutos facturados', value: (row) => Number(row['billedMinutes'] ?? 0) },
    { key: 'overtimeMinutes', label: 'Minutos extra', value: (row) => Number(row['overtimeMinutes'] ?? 0) },
    { key: 'totalMinor', label: 'Ingreso (cents)', value: (row) => Number(row['totalMinor'] ?? 0) },
  ],
  customers: [
    { key: 'customerId', label: 'Id cliente', value: (row) => Number(row['customerId'] ?? 0) },
    { key: 'fullName', label: 'Nombre', value: (row) => String(row['fullName'] ?? '') },
    { key: 'email', label: 'Correo', value: (row) => String(row['email'] ?? '') },
    { key: 'orders', label: 'Pedidos', value: (row) => Number(row['orders'] ?? 0) },
    { key: 'totalSpentMinor', label: 'Gastado (cents)', value: (row) => Number(row['totalSpentMinor'] ?? 0) },
    { key: 'averageTicketMinor', label: 'Ticket medio (cents)', value: (row) => Number(row['averageTicketMinor'] ?? 0) },
    { key: 'totalRentalMinutes', label: 'Minutos alquiler', value: (row) => Number(row['totalRentalMinutes'] ?? 0) },
    { key: 'hasChairReservation', label: 'Tiene reserva', value: (row) => (row['hasChairReservation'] === true ? 'Si' : 'No') },
    { key: 'segment', label: 'Segmento', value: (row) => String(row['segment'] ?? '') },
  ],
  inventory: [
    { key: 'name', label: 'Item', value: (row) => String(row['name'] ?? '') },
    { key: 'sku', label: 'SKU', value: (row) => String(row['sku'] ?? '') },
    { key: 'unit', label: 'Unidad', value: (row) => String(row['unit'] ?? '') },
    { key: 'currentStock', label: 'Existencias', value: (row) => Number(row['currentStock'] ?? 0) },
    { key: 'costMinor', label: 'Costo unitario (cents)', value: (row) => Number(row['costMinor'] ?? 0) },
    { key: 'valueMinor', label: 'Valor (cents)', value: (row) => Number(row['valueMinor'] ?? 0) },
    { key: 'isLowStock', label: 'Stock bajo', value: (row) => (row['isLowStock'] === true ? 'Si' : 'No') },
    { key: 'supplier', label: 'Proveedor', value: (row) => String(row['supplier'] ?? '') },
    { key: 'noMovementInRange', label: 'Sin movimiento', value: (row) => (row['noMovementInRange'] === true ? 'Si' : 'No') },
  ],
  'orders-summary': [
    { key: 'group', label: 'Grupo', value: (row) => String(row['group'] ?? '') },
    { key: 'orders', label: 'Pedidos', value: (row) => Number(row['orders'] ?? 0) },
    { key: 'completed', label: 'Completados', value: (row) => Number(row['completed'] ?? 0) },
    { key: 'pending', label: 'Pendientes', value: (row) => Number(row['pending'] ?? 0) },
    { key: 'cancelled', label: 'Cancelados', value: (row) => Number(row['cancelled'] ?? 0) },
    { key: 'refunded', label: 'Reembolsados', value: (row) => Number(row['refunded'] ?? 0) },
    { key: 'totalMinor', label: 'Total (cents)', value: (row) => Number(row['totalMinor'] ?? 0) },
    { key: 'averagePreparationMinutes', label: 'Prep. media (min)', value: (row) => Number(row['averagePreparationMinutes'] ?? 0) },
    { key: 'averageWaitMinutes', label: 'Espera media (min)', value: (row) => Number(row['averageWaitMinutes'] ?? 0) },
  ],
});
