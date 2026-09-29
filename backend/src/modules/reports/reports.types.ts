/**
 * DTOs de dominio del módulo de REPORTES (API.md 7.16).
 *
 * ============================================================================
 * REGLAS DE REPRESENTACIÓN (no negociables, P4 y "Dinero y porcentajes en enteros")
 * ============================================================================
 *  - **Todo importe** es un entero de centavos (`*Minor`), nunca `float`
 *    (BR-MONEY-001). Ni un `averageTicketMinor` ni un `totalMinor` se calculan
 *    en coma flotante sin redondear: siempre `roundHalfUp` al entero.
 *  - **Todo porcentaje y toda variación** viaja en BASIS POINTS, un entero
 *    (`*Bp`, 1 bp = 0,01 %). Así el transporte es exacto y la suma de
 *    porcentajes no acumula error de coma flotante. Un `45,32 %` se publica
 *    como `4532`.
 *  - **Toda cantidad de producto** es fraccionable en el dominio
 *    (`order_items.quantity` es `REAL` porque hay pesajes), así que se publica
 *    en **milésimas enteras** (`*Milli`) y, además, su valor redondeado a
 *    unidad entera para el humans que lee la tabla.
 *  - **Fechas**: los instantes viajan en ISO-8601 UTC. Las **claves de día**
 *    (`date`, `period`) viajan como `YYYY-MM-DD` EN LA ZONA DEL NEGOCIO, que es
 *    como las ve el administrador; el `meta.range` lleva además el rango UTC
 *    exacto con el que se consultó la base de datos.
 *
 * ============================================================================
 * DESVIACIÓN DOCUMENTADA RESPECTO A `docs/API.md`
 * ============================================================================
 * API.md nombra algunos porcentajes como `utilizationPercent` / `percentChange` /
 * `shareOfSalesPercent` y los describe como `number`. Aquí se emiten **sólo**
 * como enteros `...Bp`, porque la regla dura del proyecto prohíbe `float` para
 * porcentajes. El nombre lleva el sufijo para que nadie lo lea como un porcentaje
 * ya escalado. Ver el informe de entrega.
 */
import type { ChairKind, ChairStatus, OrderChannel, OrderType, PaymentMethod } from '../../shared/domain/index.js';
import type { TimeZonePlan } from './reports.tz.js';

// ---------------------------------------------------------------------------
// Rango temporal
// ---------------------------------------------------------------------------

/** Presets de fecha admitidos (API.md 5.2). */
export const REPORT_PRESETS = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
  'custom',
] as const;

/** Un preset de `API.md` 5.2. */
export type ReportPreset = (typeof REPORT_PRESETS)[number];

/** Granularidad de agrupación de las series. */
export const REPORT_GROUPINGS = ['day', 'week', 'month', 'hour', 'status', 'type', 'channel'] as const;

/** Granularidad admitida en un reporte. */
export type ReportGrouping = (typeof REPORT_GROUPINGS)[number];

/**
 * Rango resuelto y listo para consultar.
 *
 * CRITERIO DE INCLUSIVIDAD (documentado y aplicado en TODO el módulo):
 * intervalo semiabierto `[from, to)`: `from` INCLUSIVO, `to` EXCLUSIVO.
 *
 * Por eso `today` es `[hoy 00:00:00.000 local, mañana 00:00:00.000 local)`: una
 * venta a las 23:59:59.999 de HOY en Bogotá entra, y una venta a las 00:00:00
 * de MAÑANA en Bogotá no. El criterio semiabierto es el único que no deja ni un
 * hueco de un milisegundo entre dos días consecutivos ni solapa dos instants
 * (misma propiedad que BR-RES-001 para reservas).
 */
export interface ReportRange {
  /** Inicio del rango en UTC, INCLUSIVO. */
  readonly from: string;
  /** Fin del rango en UTC, EXCLUSIVO. */
  readonly to: string;
  /** `from` en ISO-8601 UTC. Mismo valor que {@link from}; cómodo al serializar. */
  readonly fromUtc: string;
  /** `to` en ISO-8601 UTC. Mismo valor que {@link to}. */
  readonly toUtc: string;
  /** Zona IANA efectiva con la que se resolvió el rango. */
  readonly timezone: string;
  /** Preset que originó el rango. `custom` si vine de `from`/`to`. */
  readonly preset: ReportPreset;
  /** Primer día local cubierto, `YYYY-MM-DD`. */
  readonly localFrom: string;
  /** Último día local cubierto, `YYYY-MM-DD`. */
  readonly localTo: string;
  /** Duración del rango en minutos exactos. */
  readonly minutes: number;
  /** Periodo anterior, de la MISMA duración, para comparativas. */
  readonly previous: ReportRangeWindow;
  /** Plan de offsets para traducir a hora local dentro de SQL. */
  readonly plan: TimeZonePlan;
}

/** Ventana temporal simple, usada para el periodo anterior. */
export interface ReportRangeWindow {
  readonly fromUtc: string;
  readonly toUtc: string;
  readonly minutes: number;
}

/** Rango tal y como viaja en `meta.range`. */
export interface ReportRangeMeta {
  readonly from: string;
  readonly to: string;
  readonly timezone: string;
  readonly preset: ReportPreset;
  /** Criterio de inclusividad, para que el cliente no tenga que suponerlo. */
  readonly boundary: 'FROM_INCLUSIVE_TO_EXCLUSIVE';
  readonly minutes: number;
  readonly localFrom: string;
  readonly localTo: string;
}

// ---------------------------------------------------------------------------
// Filtros comunes
// ---------------------------------------------------------------------------

/** Filtros de negocio comunes a todos los reportes. */
export interface ReportFilters {
  readonly businessId: number;
  readonly fromUtc: string;
  readonly toUtc: string;
  readonly timezone: string;
  readonly plan: TimeZonePlan;
  readonly nowIso: string;
  readonly locationId?: number;
  readonly zoneId?: number;
  readonly chairId?: number;
  readonly kind?: ChairKind;
  readonly channel?: OrderChannel;
  readonly type?: OrderType;
  readonly paymentMethod?: PaymentMethod;
  /** `false` (por defecto) excluye `CANCELLED` y `REFUNDED` de los ingresos. */
  readonly includeRefunded: boolean;
  /** Umbral de stock bajo efectivo del negocio (BR-INV-006). */
  readonly lowStockThreshold: number;
  /** Duración del rango en minutos, para los porcentajes de ocupación. */
  readonly rangeMinutes: number;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/** KPIs de la pantalla principal del administrador. */
export interface DashboardKpis {
  readonly totalOrders: number;
  readonly pendingOrders: number;
  readonly totalItemsMilli: number;
  readonly totalItems: number;
  /** Suma de `total_minor` de los pedidos que computan como venta. */
  readonly grossSalesMinor: number;
  /** Ingresos cobrados: `grossSalesMinor` menos lo reembolsado. */
  readonly netSalesMinor: number;
  readonly averageTicketMinor: number;
  readonly totalDiscountMinor: number;
  readonly totalTaxMinor: number;
  readonly totalServiceFeeMinor: number;
  /**
   * Propinas. BR-MONEY-009 las saca de `total_minor` a propósito y el esquema
   * congelado (`0001_init.sql`) no tiene columna donde persistirlas: se
   * devuelve `0` de forma explícita para que la UI no tenga que adivinar si el
   * cero significa "no hubo" o "no se midió".
   */
  readonly totalTipsMinor: number;
  readonly refundedMinor: number;
  readonly ordersCancelled: number;
  readonly ordersRefunded: number;
  /** Clientes distintos con al menos un pedido en el rango. */
  readonly customers: number;
  /** Clientes cuya PRIMERA compra histórica cae dentro del rango. */
  readonly newCustomers: number;
  /** Alquileres `ACTIVE`/`EXTENDED` ahora mismo. */
  readonly activeRentals: number;
  /** Ingresos de alquiler del rango (`chair_rentals.total_minor`). */
  readonly rentalRevenueMinor: number;
  /** Minutos de silla FACTURADOS en el rango, sobre el rango completo. */
  readonly chairOccupiedMinutes: number;
  /** Ocupación en basis points: `ocupado / (sillas × minutos del rango) × 10000`. */
  readonly chairOccupancyRateBp: number;
  /** Ítems de inventario en alerta de stock bajo (BR-INV-006). */
  readonly inventoryAlertsCount: number;
}

/** Fila de un desglose por dimensión (canal, tipo de pedido, estado). */
export interface SalesBreakdownRow {
  /** Valor de la dimensión. */
  readonly key: string;
  readonly orders: number;
  readonly totalMinor: number;
  readonly netMinor: number;
  /** Peso sobre el total del rango, en basis points. */
  readonly shareBp: number;
}

/** Punto de una serie temporal diaria. */
export interface DailySalesPoint {
  /** `YYYY-MM-DD` en la zona del negocio. */
  readonly date: string;
  readonly orders: number;
  readonly itemsMilli: number;
  readonly items: number;
  readonly totalMinor: number;
  readonly netMinor: number;
  readonly averageTicketMinor: number;
}

/** Comparativa con el periodo anterior de la misma duración. */
export interface PeriodComparison {
  readonly fromUtc: string;
  readonly toUtc: string;
  readonly orders: number;
  readonly grossSalesMinor: number;
  /** Variación de pedidos en basis points. `null` si el periodo anterior fue 0. */
  readonly ordersChangeBp: number | null;
  /** Variación de ingresos en basis points. `null` si el anterior fue 0. */
  readonly grossSalesChangeBp: number | null;
}

/** Contadores de sillas por estado: los seis estados, siempre presentes. */
export interface ChairStatusCounts {
  readonly total: number;
  readonly available: number;
  readonly occupied: number;
  readonly reserved: number;
  readonly blocked: number;
  readonly maintenance: number;
  readonly cleaning: number;
  /** Sillas `OCCUPIED` o con alquiler `ACTIVE`/`EXTENDED` abierto. */
  readonly occupiedNow: number;
  /** Capacidad total (suma de `chairs.capacity`) de las sillas del ámbito. */
  readonly totalCapacity: number;
}

/** Producto más vendido del día, para la lista corta del dashboard. */
export interface TopProductRow {
  readonly productId: number | null;
  readonly name: string;
  readonly quantityMilli: number;
  readonly quantity: number;
  readonly totalMinor: number;
}

/** Payload de `GET /api/v1/reports/dashboard`. */
export interface DashboardReport {
  readonly kpis: DashboardKpis;
  readonly salesByChannel: readonly SalesBreakdownRow[];
  readonly salesByType: readonly SalesBreakdownRow[];
  readonly topProducts: readonly TopProductRow[];
  readonly currentSpaces: ChairStatusCounts;
  readonly series: readonly DailySalesPoint[];
  readonly comparison: PeriodComparison;
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------

/** Fila de `/sales`: un periodo (día, semana o mes) con sus totales. */
export interface SalesPeriodRow {
  /** `YYYY-MM-DD` (día), `YYYY-Www` (semana ISO) o `YYYY-MM` (mes). */
  readonly period: string;
  readonly orders: number;
  readonly itemsMilli: number;
  readonly items: number;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  readonly totalMinor: number;
  readonly refundedMinor: number;
  readonly netMinor: number;
  readonly averageTicketMinor: number;
  /** Reparto por método de pago, en el MISMO periodo. */
  readonly byMethod: Readonly<Record<PaymentMethod, number>>;
  /** Reparto por tipo de pedido, en el MISMO periodo. */
  readonly byType: Readonly<Record<OrderType, number>>;
}

/** Totales del rango y su comparativa con el periodo anterior. */
export interface SalesTotals {
  readonly orders: number;
  readonly itemsMilli: number;
  readonly items: number;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  readonly totalMinor: number;
  readonly refundedMinor: number;
  readonly netMinor: number;
  readonly averageTicketMinor: number;
  readonly byMethod: Readonly<Record<PaymentMethod, number>>;
  readonly byType: Readonly<Record<OrderType, number>>;
  readonly comparison: PeriodComparison;
}

/** Punto de `/sales-by-hour`. Siempre 24, en la zona del negocio. */
export interface SalesByHourPoint {
  /** Hora LOCAL del negocio, 0-23. */
  readonly hour: number;
  readonly orders: number;
  readonly itemsMilli: number;
  readonly items: number;
  readonly totalMinor: number;
  readonly netMinor: number;
  readonly averageTicketMinor: number;
  /** Minutos de alquiler que ENEZARON en esta hora local. */
  readonly rentalMinutes: number;
  /** Ingreso de alquiler de los alquileres que empezaron en esta hora. */
  readonly rentalRevenueMinor: number;
}

/** Punto de `/sales-by-day`. Sin huecos: los días sin actividad van en cero. */
export interface SalesByDayPoint extends DailySalesPoint {
  /** Alquileres que empezaron ese día local. */
  readonly rentals: number;
  readonly rentalMinutes: number;
  readonly rentalRevenueMinor: number;
  /** Clientes cuya primera compra histórica cae en ese día local. */
  readonly newCustomers: number;
}

/** Agregado por día de la semana. 0 = domingo. */
export interface WeekdayPoint {
  /** 0 = domingo … 6 = sábado. */
  readonly weekday: number;
  readonly orders: number;
  readonly totalMinor: number;
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

/** Fila de `/top-products`. */
export interface TopProductView {
  readonly rank: number;
  readonly productId: number | null;
  readonly name: string;
  readonly sku: string | null;
  readonly categoryName: string | null;
  readonly quantityMilli: number;
  readonly quantity: number;
  readonly orders: number;
  readonly totalMinor: number;
  readonly netMinor: number;
  /** Precio medio unitario cobrado, en centavos enteros. */
  readonly averagePriceMinor: number;
  /** Margen en centavos. `null` si el producto no tiene coste cargado. */
  readonly marginMinor: number | null;
}

/** Fila de `/product-revenue`, por producto o por categoría. */
export interface ProductRevenueRow {
  /** `product:<id>` o `category:<id>`. */
  readonly key: string;
  readonly name: string;
  readonly quantityMilli: number;
  readonly quantity: number;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly netMinor: number;
  /** Peso sobre el total del rango, en basis points. */
  readonly shareBp: number;
  /** Margen en centavos, si hay coste. */
  readonly marginMinor: number | null;
  /** Serie diaria del elemento. */
  readonly sales: readonly DailySalesPoint[];
}

// ---------------------------------------------------------------------------
// Sillas y alquileres
// ---------------------------------------------------------------------------

/** Fila de ocupación de una silla. */
export interface ChairOccupancyRow {
  readonly chairId: number;
  readonly code: string;
  readonly name: string | null;
  readonly kind: ChairKind;
  readonly zoneId: number;
  readonly zoneName: string;
  readonly status: ChairStatus;
  /** Sesiones (alquileres) con ocupación real dentro del rango. */
  readonly sessions: number;
  /** Minutos ocupados de verdad, recortados al rango. */
  readonly occupiedMinutes: number;
  /** Minutos reservados en el rango, aunque no se hayan usado. */
  readonly reservedMinutes: number;
  /** `occupiedMinutes / (1 × minutos del rango) × 10000`. */
  readonly utilizationBp: number;
  readonly revenueMinor: number;
  /** Minutos de más sobre el plan, cobrados al precio congelado. */
  readonly overageMinutes: number;
  readonly overageRevenueMinor: number;
}

/** Fila de ocupación de una zona. */
export interface ZoneOccupancyRow {
  readonly zoneId: number;
  readonly name: string;
  readonly chairs: number;
  readonly sessions: number;
  readonly occupiedMinutes: number;
  readonly availableMinutes: number;
  readonly utilizationBp: number;
  readonly averageSessionMinutes: number;
  readonly revenueMinor: number;
}

/** Resumen de ocupación del rango. */
export interface ChairOccupancySummary {
  readonly totalChairs: number;
  readonly totalCapacity: number;
  /** `totalChairs × minutos del rango`: el denominador de la ocupación. */
  readonly availableMinutes: number;
  readonly occupiedMinutes: number;
  readonly reservedMinutes: number;
  readonly utilizationBp: number;
  readonly avgSessionMinutes: number;
  readonly totalSessions: number;
  readonly overageMinutes: number;
  readonly overageRevenueMinor: number;
  readonly revenueMinor: number;
}

/** Punto de la línea de tiempo de ocupación. */
export interface OccupancyTimelinePoint {
  /** `YYYY-MM-DD` local. */
  readonly date: string;
  /** Hora local, 0-23. */
  readonly hour: number;
  readonly occupiedChairs: number;
  readonly reservedChairs: number;
  /** Ocupación de esa franja, en basis points. */
  readonly utilizationBp: number;
}

/** Payload de `/chair-occupancy`. */
export interface ChairOccupancyReport {
  readonly summary: ChairOccupancySummary;
  readonly byChair: readonly ChairOccupancyRow[];
  readonly byZone: readonly ZoneOccupancyRow[];
  readonly timeline: readonly OccupancyTimelinePoint[];
}

/** Fila de ingresos de alquiler por silla, zona o día. */
export interface RentalRevenueRow {
  /** `chair:<id>`, `zone:<id>` o `YYYY-MM-DD`. */
  readonly key: string;
  readonly label: string;
  readonly sessions: number;
  readonly minutes: number;
  readonly billedMinutes: number;
  readonly overtimeMinutes: number;
  readonly totalMinor: number;
}

/** Resumen de ingresos de alquiler. */
export interface RentalRevenueSummary {
  readonly sessions: number;
  /** Minutos reales de sesión. */
  readonly totalMinutes: number;
  /** Minutos FACTURADOS (`chair_rentals.billed_minutes`, con mínimo de 30). */
  readonly billedMinutes: number;
  readonly overtimeMinutes: number;
  readonly subtotalMinor: number;
  readonly extensionsMinor: number;
  readonly overtimeMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly averageSessionMinutes: number;
  readonly averageRevenuePerSessionMinor: number;
  /** Sesiones a las que se aplicó el mínimo de 30 min (BR-RENTAL-001). */
  readonly minimumAppliedCount: number;
  /** Reglas de `DESIGN.md` 7.4 que el reporte refleja. */
  readonly appliedRules: readonly string[];
}

/** Payload de `/rental-revenue`. */
export interface RentalRevenueReport {
  readonly summary: RentalRevenueSummary;
  readonly byChair: readonly RentalRevenueRow[];
  readonly byZone: readonly RentalRevenueRow[];
  readonly byDay: readonly RentalRevenueRow[];
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

/** Segmento de cliente según la API (`new`, `returning`, `loyal`, `atRisk`). */
export const CUSTOMER_SEGMENTS = ['new', 'returning', 'loyal', 'atRisk', 'all'] as const;

/** Segmento de cliente. */
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

/** Métricas de un cliente en el rango. */
export interface CustomerReportRow {
  readonly customerId: number;
  readonly fullName: string;
  readonly email: string;
  readonly phone: string | null;
  readonly orders: number;
  readonly itemsMilli: number;
  readonly items: number;
  readonly totalSpentMinor: number;
  readonly averageTicketMinor: number;
  readonly firstOrderAt: string | null;
  readonly lastOrderAt: string | null;
  readonly daysSinceLastOrder: number | null;
  readonly totalRentalMinutes: number;
  /** `true` si el cliente tiene al menos una reserva de silla en el rango. */
  readonly hasChairReservation: boolean;
  readonly segment: CustomerSegment;
}

/** Totales del reporte de clientes. */
export interface CustomerReportTotals {
  readonly customers: number;
  readonly newCustomers: number;
  readonly returningCustomers: number;
  readonly loyalCustomers: number;
  readonly atRiskCustomers: number;
  /** Clientes con 2+ compras en el rango, sobre el total, en basis points. */
  readonly repeatRateBp: number;
  readonly totalSpentMinor: number;
  readonly averageTicketMinor: number;
  readonly withChairReservation: number;
  readonly newCustomersChangeBp: number | null;
}

// ---------------------------------------------------------------------------
// Inventario
// ---------------------------------------------------------------------------

/** Fila de valorización de un ítem. */
export interface InventoryReportRow {
  readonly itemId: number;
  readonly name: string;
  readonly sku: string | null;
  readonly unit: string;
  readonly currentStock: number;
  readonly minStock: number;
  readonly costMinor: number;
  /** `roundHalfUp(current_stock × cost_minor)`, en centavos enteros. */
  readonly valueMinor: number;
  readonly isLowStock: boolean;
  readonly supplier: string | null;
  readonly locationStorage: string | null;
  readonly lastMovementAt: string | null;
  /** Movimientos del rango, por sentido. */
  readonly movementsInRange: InventoryMovementsInRange;
  /** `true` si no registró ningún movimiento en el rango. */
  readonly noMovementInRange: boolean;
  /**
   * Rotación aproximada en basis points: salidas del rango divididas por el
   * stock actual, por el número de días del rango. Es un indicativo, no un
   * COS contable: conFew días de historial no es interpretable.
   */
  readonly rotationBp: number;
}

/** Movimientos de un ítem dentro del rango. */
export interface InventoryMovementsInRange {
  /** Unidades que entraron (compras, devoluciones, ajustes al alza, liberaciones). */
  readonly inQuantityMilli: number;
  /** Unidades que salieron (ventas, mermas, ajustes a la baja). */
  readonly outQuantityMilli: number;
  /** `in - out`, en milésimas. */
  readonly netQuantityMilli: number;
  readonly movements: number;
}

/** Resumen de valorización del inventario. */
export interface InventoryReportSummary {
  readonly items: number;
  readonly trackedItems: number;
  /** Suma de `valueMinor` de todos los ítems no borrados. */
  readonly totalValueMinor: number;
  /** Existencias agrupadas por unidad de medida, en milésimas de unidad. */
  readonly totalQuantityByUnit: Readonly<Record<string, number>>;
  readonly lowStockCount: number;
  readonly outOfStockCount: number;
  readonly negativeStockCount: number;
  /** Coste medio de los ítems con existencias, en centavos enteros. */
  readonly averageCostMinor: number;
  /** Ítems sin ningún movimiento en el rango. */
  readonly noMovementCount: number;
  /** Días que abarca el rango, para la rotación. */
  readonly rangeDays: number;
}

/** Fila de agregación por proveedor o por ubicación. */
export interface InventoryGroupRow {
  readonly key: string;
  readonly items: number;
  readonly totalValueMinor: number;
  readonly totalStockMilli: number;
  readonly lowStockCount: number;
}

/** Payload de `/inventory`. */
export interface InventoryReport {
  readonly summary: InventoryReportSummary;
  readonly byItem: readonly InventoryReportRow[];
  readonly bySupplier: readonly InventoryGroupRow[];
  readonly byStorage: readonly InventoryGroupRow[];
}

// ---------------------------------------------------------------------------
// Resumen de pedidos
// ---------------------------------------------------------------------------

/** Fila del resumen de pedidos por grupo. */
export interface OrdersSummaryRow {
  readonly group: string;
  readonly orders: number;
  readonly cancelled: number;
  readonly refunded: number;
  readonly completed: number;
  readonly pending: number;
  /** `completed_at - preparing_at`, en minutos enteros. */
  readonly averagePreparationMinutes: number;
  /** `ready_at - placed_at`, en minutos enteros. */
  readonly averageWaitMinutes: number;
  readonly firstOrderAt: string | null;
  readonly lastOrderAt: string | null;
  readonly totalMinor: number;
}

/** Totales del resumen de pedidos. */
export interface OrdersSummaryTotals {
  readonly orders: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly refunded: number;
  readonly pending: number;
  readonly totalMinor: number;
  /** Cancelados sobre total, en basis points. */
  readonly cancelRateBp: number;
  readonly averagePreparationMinutes: number;
  readonly averageWaitMinutes: number;
  readonly averageItemsPerOrderMilli: number;
  readonly averageItemsPerOrder: number;
  readonly itemsCancelled: number;
}

// ---------------------------------------------------------------------------
// Exportación CSV
// ---------------------------------------------------------------------------

/** Reportes exportables a CSV. */
export const EXPORTABLE_REPORTS = [
  'sales',
  'sales-by-day',
  'sales-by-hour',
  'top-products',
  'product-revenue',
  'chair-occupancy',
  'rental-revenue',
  'customers',
  'inventory',
  'orders-summary',
] as const;

/** Nombre de un reporte exportable. */
export type ExportableReport = (typeof EXPORTABLE_REPORTS)[number];

/** Una columna de un reporte, con su rótulo en el CSV. */
export interface ExportColumn {
  /** Clave de la columna en el objeto de la fila. */
  readonly key: string;
  /** Rótulo de la cabecera del CSV. */
  readonly label: string;
}

/** Resultado de construir el CSV. */
export interface CsvExport {
  readonly filename: string;
  readonly contentType: string;
  readonly body: string;
  readonly rows: number;
  readonly columns: readonly string[];
  readonly byteLength: number;
}

