/**
 * Contrato de persistencia del módulo de REPORTES.
 *
 * Es una INTERFAZ (DESIGN.md 3.1, regla P3): el service nunca ve SQLite. Todo
 * el SQL vive en `reports.repository.sqlite.ts`.
 *
 * ============================================================================
 * GARANTÍA CENTRAL: CERO N+1
 * ============================================================================
 * Ningún método devuelve "una fila por entidad y luego sus hijos". Cada método
 * devuelve filas YA AGREGADAS por la base de datos: un `GROUP BY` por día, por
 * producto, por silla o por método de pago. Un endpoint cuyo número de
 * consultas crezca con el número de pedidos está prohibido; el número de
 * consultas por endpoint es FIJO y está documentado en `reports.service.ts`.
 *
 * Cuando un endpoint necesita varias preguntas distintas (totales + serie +
 * desglose), se hacen varias consultas EXPLÍCITAS y documentadas, nunca un
 * bucle que dependa del número de filas.
 *
 * ============================================================================
 * CONVENCIÓN DE RANGOS
 * ============================================================================
 * Todos los métodos reciben `fromUtc` INCLUSIVO y `toUtc` EXCLUSIVO
 * (intervalo semiabierto `[from, to)`), ya calculados en la zona horaria del
 * negocio por `reports.service.ts`. El repositorio no sabe de zonas: recibe
 * instantes UTC y, cuando necesita agrupar por fecha u hora LOCAL, usa
 * `filters.plan` para desplazar dentro de SQL con `strftime`.
 *
 * ============================================================================
 * REGLAS QUE RESPETA (y que el service NO reimplementa)
 * ============================================================================
 *  - Un pedido soft-deleted (`deleted_at`) no aparece en ningún reporte.
 *  - `CANCELLED` y `REFUNDED` no computan como venta salvo `includeRefunded`
 *    (API.md 7.16). `DRAFT` NO se excluye.
 *  - Las líneas `CANCELLED` de `order_items` no cuentan como unidades vendidas.
 *  - Un alquiler `CANCELLED` no computa ni como sesión ni como ingreso.
 */
import type { ChairStatus, PaymentMethod } from '../../shared/domain/index.js';
import type { ReportFilters, ReportGrouping } from './reports.types.js';

/** Dimensión de un desglose simple. */
export type BreakdownDimension = 'channel' | 'type' | 'status';

/** Orden de `/top-products`. */
export type ProductOrderBy = 'quantity' | 'revenue';

/** Dimensión de la valorización de inventario. */
export type InventoryGroupBy = 'supplier' | 'locationStorage';

/** Intervalo de paginación en el repositorio. */
export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
}

/** Fila de conteo de sillas por estado. */
export interface ChairStatusCountRow {
  readonly status: ChairStatus;
  readonly chairs: number;
  readonly capacity: number;
}

/** Contadores de alquileres abiertos y su ingreso. */
export interface ActiveRentalCountRow {
  readonly active: number;
  readonly revenue_minor: number;
  readonly billed_minutes: number;
}

/** Denominadores de ocupación: cuántas sillas y qué capacidad. */
export interface ChairCapacityRow {
  readonly chairs: number;
  readonly capacity: number;
}

/** Fila de producto vendido, ya agregada. */
export interface ProductSalesRow {
  readonly product_id: number | null;
  readonly category_id: number | null;
  readonly name: string;
  readonly sku: string | null;
  readonly category_name: string | null;
  readonly quantity_milli: number;
  readonly orders: number;
  readonly subtotal_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly total_minor: number;
  readonly refunded_minor: number;
  readonly unit_price_minor: number;
  readonly cost_minor: number | null;
}

/** Totales de productos del rango, en una fila. */
export interface ProductTotalsRow {
  readonly quantity_milli: number;
  readonly net_minor: number;
  readonly products: number;
}

/** Totales de ingresos por producto, en una fila. */
export interface ProductRevenueTotalsRow {
  readonly net_minor: number;
  readonly products: number;
}

/** Fila de la serie diaria de un producto o una categoría. */
export interface ProductDailyRow {
  readonly product_id: number | null;
  readonly category_id: number | null;
  readonly date: string;
  readonly orders: number;
  readonly items_milli: number;
  readonly total_minor: number;
  readonly net_minor: number;
}

/** Fila de alquiler con su silla, zona y pedido de cobro. */
export interface RentalRow {
  readonly rental_id: number;
  readonly chair_id: number;
  readonly chair_code: string;
  readonly chair_name: string | null;
  readonly chair_kind: string;
  readonly chair_status: ChairStatus;
  readonly zone_id: number;
  readonly zone_name: string;
  readonly customer_id: number | null;
  readonly status: string;
  readonly start_at: string;
  readonly end_at: string;
  readonly planned_minutes: number;
  readonly billed_minutes: number;
  readonly price_per_hour_minor: number;
  readonly subtotal_minor: number;
  readonly extensions_minor: number;
  readonly extra_minutes_minor: number;
  readonly total_minor: number;
  readonly tax_minor: number;
  readonly discount_minor: number;
  /** Minutos de sesión REALES ya recortados al rango (los cuenta el service). */
  readonly session_minutes: number;
  /** Minutos de la sesión que caen dentro del rango. */
  readonly minutes_in_range: number;
}

/** Fila de reserva con su silla. */
export interface ReservationRow {
  readonly reservation_id: number;
  readonly chair_id: number;
  readonly zone_id: number;
  readonly customer_id: number | null;
  readonly start_at: string;
  readonly end_at: string;
  readonly duration_minutes: number;
  readonly rental_total_minor: number;
  /** Minutos de la reserva que caen dentro del rango. */
  readonly minutes_in_range: number;
}

/** Silla del ámbito de un reporte de ocupación. */
export interface ChairScopeRow {
  readonly chair_id: number;
  readonly code: string;
  readonly name: string | null;
  readonly kind: string;
  readonly status: ChairStatus;
  readonly zone_id: number;
  readonly zone_name: string;
  readonly capacity: number;
}

/** Métricas de un cliente del rango, ya agregadas. */
export interface CustomerRow {
  readonly customer_id: number;
  readonly full_name: string;
  readonly email: string;
  readonly phone: string | null;
  readonly orders: number;
  readonly items_milli: number;
  readonly total_spent_minor: number;
  readonly refunded_minor: number;
  readonly first_order_at: string | null;
  readonly last_order_at: string | null;
  /** Primera compra HISTÓRICA del cliente, para detectar si es nuevo. */
  readonly first_ever_at: string | null;
  readonly lifetime_orders: number;
  readonly rental_minutes: number;
  readonly reservations: number;
}

/** Totales de clientes del rango, en una fila. */
export interface CustomerTotalsRow {
  readonly customers: number;
  readonly new_customers: number;
  readonly total_spent_minor: number;
  readonly orders: number;
  readonly with_reservation: number;
}

/** Valorización de un ítem de inventario con sus movimientos del rango. */
export interface InventoryItemRow {
  readonly item_id: number;
  readonly name: string;
  readonly sku: string | null;
  readonly unit: string;
  readonly current_stock: number;
  readonly min_stock: number;
  readonly cost_minor: number;
  readonly is_tracked: number;
  readonly supplier: string | null;
  readonly location_storage: string | null;
  readonly last_movement_at: string | null;
  readonly in_milli: number;
  readonly out_milli: number;
  readonly movements: number;
}

/** Agregado de inventario por proveedor o por ubicación. */
export interface InventoryGroupRow {
  readonly key: string;
  readonly items: number;
  readonly total_value_minor: number;
  readonly total_stock_milli: number;
  readonly low_stock_count: number;
}

/** Resumen global del inventario, en una fila. */
export interface InventorySummaryRow {
  readonly items: number;
  readonly tracked_items: number;
  readonly total_value_minor: number;
  readonly low_stock_count: number;
  readonly out_of_stock_count: number;
  readonly negative_stock_count: number;
  readonly no_movement_count: number;
  readonly quantities_by_unit: string;
  /** Suma de `current_stock × cost_minor` de los ítems con existencias. */
  readonly weighted_cost: number;
  readonly stock_items: number;
}

/**
 * Fila del resumen de pedidos por grupo.
 *
 * El alias en SQL es `group_key` y no `group` porque `GROUP` es palabra
 * reservada en SQLite y sin comillas rompe la consulta.
 */
export interface OrdersSummaryGroupRow {
  readonly group_key: string;
  readonly orders: number;
  readonly cancelled: number;
  readonly refunded: number;
  readonly completed: number;
  readonly pending: number;
  readonly total_minor: number;
  readonly preparation_minutes_milli: number;
  readonly preparation_samples: number;
  readonly wait_minutes_milli: number;
  readonly wait_samples: number;
  readonly first_order_at: string | null;
  readonly last_order_at: string | null;
}

/** Fila de una venta concreta, para el CSV. */
export interface SalesExportRow {
  readonly order_id: number;
  readonly order_number: string;
  readonly created_at: string;
  readonly local_date: string;
  readonly local_hour: number;
  readonly type: string;
  readonly status: string;
  readonly channel: string;
  readonly location_id: number | null;
  readonly customer_id: number | null;
  readonly customer_name: string | null;
  readonly items_milli: number;
  readonly subtotal_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly service_fee_minor: number;
  readonly total_minor: number;
  readonly paid_minor: number;
  readonly refunded_minor: number;
  readonly cash_minor: number;
  readonly card_minor: number;
  readonly transfer_minor: number;
  readonly online_minor: number;
}

/** Fila de pago agregado por periodo local y método. */
export interface PaymentPeriodRow {
  readonly period: string;
  readonly method: PaymentMethod;
  readonly payments: number;
  readonly amount_minor: number;
  readonly refunded_minor: number;
}

/** Fila de venta agregada por periodo local. */
export interface SalesPeriodRowRaw {
  readonly period: string;
  readonly orders: number;
  readonly items_milli: number;
  readonly subtotal_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly service_fee_minor: number;
  readonly total_minor: number;
  readonly refunded_minor: number;
}

/** Fila de venta por periodo y tipo de pedido. */
export interface SalesTypeRow {
  readonly period: string;
  readonly type: string;
  readonly orders: number;
  readonly total_minor: number;
}

/** Fila de desglose por dimensión. */
export interface BreakdownRow {
  readonly key: string;
  readonly orders: number;
  readonly total_minor: number;
  readonly net_minor: number;
}

/** Fila de la serie diaria local. */
export interface DaySeriesRow {
  readonly date: string;
  readonly orders: number;
  readonly items_milli: number;
  readonly subtotal_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly service_fee_minor: number;
  readonly total_minor: number;
  readonly refunded_minor: number;
  readonly rentals: number;
  readonly rental_minutes: number;
  readonly rental_revenue_minor: number;
  readonly new_customers: number;
}

/** Fila de la serie por hora local (0-23). */
export interface HourSeriesRow {
  readonly hour: number;
  readonly orders: number;
  readonly items_milli: number;
  readonly total_minor: number;
  readonly refunded_minor: number;
  readonly rental_minutes: number;
  readonly rental_revenue_minor: number;
}

/** Repositorio de reportes. */
export interface ReportsRepository {
  /** Zona horaria y umbral de stock bajo del negocio. `null` si no existe. */
  findBusinessSettings(
    businessId: number,
  ): { readonly timezone: string; readonly lowStockThreshold: number } | null;

  // --- Dashboard (6 consultas fijas, todas agregadas) ----------------------

  /** KPIs agregados del rango, en una fila. */
  dashboardKpis(filters: ReportFilters): DashboardKpisRow;
  /** Desglose por canal o por tipo del rango. */
  dashboardBreakdown(filters: ReportFilters, dimension: BreakdownDimension): readonly BreakdownRow[];
  /** Productos más vendidos del rango, para la lista corta del dashboard. */
  dashboardTopProducts(filters: ReportFilters, limit: number): readonly ProductSalesRow[];
  /** Sillas por estado del ámbito. */
  chairStatusCounts(filters: ReportFilters): readonly ChairStatusCountRow[];
  /** Alquileres abiertos (`ACTIVE`/`EXTENDED`) y su ingreso. */
  activeRentals(filters: ReportFilters): ActiveRentalCountRow;
  /** Denominador de ocupación: número de sillas y capacidad del ámbito. */
  chairCapacity(filters: ReportFilters): ChairCapacityRow;
  /** Serie diaria local del rango, con alquileres y clientes nuevos. */
  dailySeries(filters: ReportFilters): readonly DaySeriesRow[];

  // --- Ventas --------------------------------------------------------------

  /** Totales agregados del rango, en una fila. */
  orderTotals(filters: ReportFilters): OrderTotalsRow;
  /** Serie agregada por periodo local. */
  salesByPeriod(filters: ReportFilters, granularity: ReportGrouping): readonly SalesPeriodRowRaw[];
  /** Pagos liquidados por periodo local y método. */
  salesByPayment(filters: ReportFilters, granularity: ReportGrouping): readonly PaymentPeriodRow[];
  /** Importe de venta por periodo local y tipo de pedido. */
  salesByType(filters: ReportFilters, granularity: ReportGrouping): readonly SalesTypeRow[];
  /** Clientes distintos y clientes nuevos del rango, en una fila. */
  customerCounts(filters: ReportFilters): { readonly customers: number; readonly newCustomers: number };

  // --- Series --------------------------------------------------------------

  /** Serie por hora LOCAL (0-23) del negocio. */
  salesByHour(filters: ReportFilters): readonly HourSeriesRow[];
  /** Agregado por día de la semana local (0 = domingo). */
  salesByWeekday(filters: ReportFilters): readonly { readonly weekday: number; readonly orders: number; readonly total_minor: number }[];

  // --- Productos -----------------------------------------------------------

  /** Ranking de productos, ordenado y paginado en SQL. */
  topProducts(filters: ReportFilters, orderBy: ProductOrderBy, page: PageRequest): readonly ProductSalesRow[];
  /** Número de productos del ranking. */
  countTopProducts(filters: ReportFilters): number;
  /** Totales de productos del rango. */
  productTotals(filters: ReportFilters): ProductTotalsRow;
  /** Ingresos por producto o por categoría, agregados y paginados. */
  productRevenue(
    filters: ReportFilters,
    groupBy: 'product' | 'category',
    page: PageRequest,
  ): readonly ProductSalesRow[];
  /** Número de elementos del reporte de ingresos. */
  countProductRevenue(filters: ReportFilters, groupBy: 'product' | 'category'): number;
  /** Serie diaria por producto o por categoría. */
  productDailySeries(filters: ReportFilters, groupBy: 'product' | 'category'): readonly ProductDailyRow[];
  /** Totales de ingresos por producto del rango. */
  productRevenueTotals(filters: ReportFilters): ProductRevenueTotalsRow;

  // --- Sillas y alquileres -------------------------------------------------

  /** Alquileres que se solapan con el rango, con silla, zona y pedido. */
  rentals(filters: ReportFilters): readonly RentalRow[];
  /** Reservas que se solapan con el rango. */
  reservations(filters: ReportFilters): readonly ReservationRow[];
  /** Sillas del ámbito, para cruzar con los alquileres sin N+1. */
  chairsInScope(filters: ReportFilters): readonly ChairScopeRow[];

  // --- Clientes ------------------------------------------------------------

  /** Métricas por cliente del rango, ordenadas y paginadas. */
  customers(
    filters: ReportFilters,
    orderBy: 'totalSpent' | 'orders' | 'lastOrder' | 'newCustomers',
    page: PageRequest,
  ): readonly CustomerRow[];
  /** Número de clientes del reporte. */
  countCustomers(filters: ReportFilters): number;
  /** Totales de clientes del rango, en una fila. */
  customerTotals(filters: ReportFilters): CustomerTotalsRow;

  // --- Inventario ----------------------------------------------------------

  /** Valorización de cada ítem, con sus movimientos del rango. */
  inventoryItems(filters: ReportFilters, page: PageRequest): readonly InventoryItemRow[];
  /** Número de ítems del reporte. */
  countInventoryItems(filters: ReportFilters): number;
  /** Agregado por proveedor o por ubicación. */
  inventoryGroups(filters: ReportFilters, by: InventoryGroupBy): readonly InventoryGroupRow[];
  /** Resumen global del inventario, en una fila. */
  inventorySummary(filters: ReportFilters): InventorySummaryRow;

  // --- Resumen de pedidos --------------------------------------------------

  /** Conteos por grupo. */
  ordersSummary(filters: ReportFilters, groupBy: ReportGrouping): readonly OrdersSummaryGroupRow[];

  // --- Exportación ---------------------------------------------------------

  /** Filas de venta para el CSV, paginadas en bloques. */
  salesRowsForExport(filters: ReportFilters, page: PageRequest): readonly SalesExportRow[];
  /** Número de ventas del rango. */
  countSalesRowsForExport(filters: ReportFilters): number;
}

/** KPIs crudos del dashboard, tal y como los agrega SQL. */
export interface DashboardKpisRow {
  readonly orders: number;
  readonly pending_orders: number;
  readonly completed_orders: number;
  readonly cancelled_orders: number;
  readonly refunded_orders: number;
  readonly items_milli: number;
  readonly subtotal_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly service_fee_minor: number;
  readonly total_minor: number;
  readonly refunded_minor: number;
  readonly customers: number;
}

/** Totales crudos de `orders` para un rango. */
export interface OrderTotalsRow {
  readonly orders: number;
  readonly items_milli: number;
  readonly items_cancelled_milli: number;
  readonly subtotal_minor: number;
  readonly discount_minor: number;
  readonly tax_minor: number;
  readonly service_fee_minor: number;
  readonly total_minor: number;
  readonly refunded_minor: number;
  readonly cancelled_orders: number;
  readonly refunded_orders: number;
  readonly completed_orders: number;
  readonly pending_orders: number;
  readonly preparation_minutes_milli: number;
  readonly preparation_samples: number;
  readonly wait_minutes_milli: number;
  readonly wait_samples: number;
}
