/**
 * Controller del módulo de REPORTES (API.md 7.16).
 *
 * Traduce `req` ya validado a los tipos del service y da forma a la respuesta.
 * NO decide nada de negocio: ni el rango, ni qué es una venta, ni el margen, ni
 * el escape de fórmulas. Eso vive en `reports.service.ts` y `reports.csv.ts`.
 *
 * Única excepción: `POST /export`, que NO usa el envoltorio JSON de API.md 3 y
 * devuelve `text/csv` con `Content-Disposition: attachment`. Es la única
 * respuesta no-JSON de la API, y por eso escribe la respuesta a mano en lugar
 * de pasar por `sendSuccess`.
 */
import type { Response } from 'express';

import { sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type {
  ReportRangeMeta,
} from './reports.types.js';
import type { ReportRequestContext, ReportsService } from './reports.service.js';
import type {
  ChairOccupancyQuery,
  CustomersQuery,
  DashboardQuery,
  ExportBody,
  InventoryQuery,
  OrdersSummaryQuery,
  ProductRevenueQuery,
  RentalRevenueQuery,
  SalesQuery,
  TopProductsQuery,
} from './reports.schemas.js';
import type { ChairKind, OrderChannel, OrderType, PaymentMethod } from '../../shared/domain/index.js';

/** `req` con actor y cuerpo/query ya validados. */
type ReportsRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
  };
};

/** Contexto de auditoría de la petición. */
function contextOf(req: ReportsRequest): ReportRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Query ya validada, o el objeto vacío si el endpoint no la usa. */
function queryOf<T>(req: ReportsRequest): T {
  return (req.validated?.query ?? {}) as T;
}

/** Body ya validado. */
function bodyOf<T>(req: ReportsRequest): T {
  return (req.validated?.body ?? {}) as T;
}

/**
 * Extrae los filtros de rango y de negocio de un query ya validado.
 *
 * Los `undefined` se OMITEN (y no se mandan como `undefined`) porque `ReportRequest`
 * los declara opcionales con `exactOptionalPropertyTypes` desactivado pero el
 * service los distingue de "sin filtro" al construir los `WHERE`.
 */
function baseRequest<T extends Record<string, unknown>>(query: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const range: Record<string, unknown> = {};
  for (const key of ['preset', 'from', 'to', 'timezone'] as const) {
    if (query[key] !== undefined) range[key] = query[key];
  }
  out['range'] = range;
  for (const key of [
    'locationId',
    'zoneId',
    'chairId',
    'kind',
    'channel',
    'type',
    'paymentMethod',
    'includeRefunded',
  ] as const) {
    if (query[key] !== undefined) out[key] = query[key];
  }
  return out;
}

/** `meta` común de todos los reportes. */
function meta(range: ReportRangeMeta, generatedAt: string, extra: Record<string, unknown> = {}) {
  return { range, generatedAt, ...extra };
}

/** Controller de reportes. */
export class ReportsController {
  public constructor(private readonly reports: ReportsService) {}

  /** `GET /api/v1/reports/dashboard` — KPIs del día y series. */
  public dashboard = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<DashboardQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = await this.reports.dashboard(
      {
        ...base,
        ...(query.includeSeries === undefined ? {} : { includeSeries: query.includeSeries }),
        ...(query.seriesDays === undefined ? {} : { seriesDays: query.seriesDays }),
      } as never,
      contextOf(req),
    );
    sendSuccess(res, result.data, meta(result.meta.range, result.meta.generatedAt));
  };

  /** `GET /api/v1/reports/sales` — ventas del periodo con comparativa. */
  public sales = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<SalesQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = this.reports.sales(
      { ...base, ...(query.groupBy === undefined ? {} : { groupBy: query.groupBy }) } as never,
      contextOf(req),
    );
    sendSuccess(
      res,
      result.data,
      meta(result.meta.range, result.meta.generatedAt, { totals: result.totals }),
    );
  };

  /** `GET /api/v1/reports/sales-by-hour` — 24 puntos en hora local. */
  public salesByHour = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<Record<string, unknown>>(req);
    const result = this.reports.salesByHour(baseRequest(query) as never, contextOf(req));
    sendSuccess(
      res,
      result.data,
      meta(result.meta.range, result.meta.generatedAt, { peakHours: result.peakHours }),
    );
  };

  /** `GET /api/v1/reports/sales-by-day` — serie diaria sin huecos. */
  public salesByDay = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<Record<string, unknown>>(req);
    const result = this.reports.salesByDay(baseRequest(query) as never, contextOf(req));
    sendSuccess(
      res,
      result.data,
      meta(result.meta.range, result.meta.generatedAt, { byWeekday: result.byWeekday }),
    );
  };

  /** `GET /api/v1/reports/top-products` — ranking de productos. */
  public topProducts = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<TopProductsQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = this.reports.topProducts(
      {
        ...base,
        ...(query.orderBy === undefined ? {} : { orderBy: query.orderBy }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.page === undefined ? {} : { page: query.page }),
        ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
        ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      } as never,
      contextOf(req),
    );
    sendSuccess(
      res,
      result.data,
      meta(result.meta.range, result.meta.generatedAt, {
        page: query.page ?? 1,
        pageSize: result.meta['pageSize'],
        total: result.total,
        totals: result.totals,
      }),
    );
  };

  /** `GET /api/v1/reports/product-revenue` — ingresos por producto o categoría. */
  public productRevenue = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<ProductRevenueQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = this.reports.productRevenue(
      {
        ...base,
        ...(query.groupBy === undefined ? {} : { groupBy: query.groupBy }),
        ...(query.includeTax === undefined ? {} : { includeTax: query.includeTax }),
        ...(query.page === undefined ? {} : { page: query.page }),
        ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
      } as never,
      contextOf(req),
    );
    sendSuccess(
      res,
      result.data,
      meta(result.meta.range, result.meta.generatedAt, {
        total: result.meta['total'],
        totals: result.totals,
      }),
    );
  };

  /** `GET /api/v1/reports/chair-occupancy` — ocupación de sillas. */
  public chairOccupancy = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<ChairOccupancyQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = this.reports.chairOccupancy(
      { ...base, ...(query.groupBy === undefined ? {} : { groupBy: query.groupBy }) } as never,
      contextOf(req),
    );
    sendSuccess(res, result.data, meta(result.meta.range, result.meta.generatedAt));
  };

  /** `GET /api/v1/reports/rental-revenue` — ingresos por alquiler de sillas. */
  public rentalRevenue = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<RentalRevenueQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = this.reports.rentalRevenue(
      { ...base, ...(query.groupBy === undefined ? {} : { groupBy: query.groupBy }) } as never,
      contextOf(req),
    );
    sendSuccess(res, result.data, meta(result.meta.range, result.meta.generatedAt));
  };

  /** `GET /api/v1/reports/customers` — métricas de clientes. */
  public customers = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<CustomersQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = this.reports.customers(
      {
        ...base,
        ...(query.orderBy === undefined ? {} : { orderBy: query.orderBy }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.page === undefined ? {} : { page: query.page }),
        ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
        ...(query.onlyWithOrders === undefined ? {} : { onlyWithOrders: query.onlyWithOrders }),
        ...(query.segment === undefined ? {} : { segment: query.segment }),
      } as never,
      contextOf(req),
    );
    sendSuccess(
      res,
      result.data,
      meta(result.meta.range, result.meta.generatedAt, {
        total: result.total,
        totals: result.totals,
      }),
    );
  };

  /** `GET /api/v1/reports/inventory` — valorización del inventario. */
  public inventory = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<InventoryQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = this.reports.inventory(
      {
        ...base,
        ...(query.supplier === undefined ? {} : { supplier: query.supplier }),
        ...(query.locationStorage === undefined ? {} : { locationStorage: query.locationStorage }),
        ...(query.includeZeroStock === undefined ? {} : { includeZeroStock: query.includeZeroStock }),
        ...(query.lowStockOnly === undefined ? {} : { lowStockOnly: query.lowStockOnly }),
        ...(query.page === undefined ? {} : { page: query.page }),
        ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
      } as never,
      contextOf(req),
    );
    sendSuccess(res, result.data, meta(result.meta.range, result.meta.generatedAt));
  };

  /** `GET /api/v1/reports/orders-summary` — conteo por estado y tipo. */
  public ordersSummary = async (req: ReportsRequest, res: Response): Promise<void> => {
    const query = queryOf<OrdersSummaryQuery>(req);
    const base = baseRequest(query as unknown as Record<string, unknown>);
    const result = this.reports.ordersSummary(
      { ...base, ...(query.groupBy === undefined ? {} : { groupBy: query.groupBy }) } as never,
      contextOf(req),
    );
    sendSuccess(
      res,
      result.data,
      meta(result.meta.range, result.meta.generatedAt, { totals: result.totals }),
    );
  };

  /**
   * `POST /api/v1/reports/export` — CSV del reporte pedido.
   *
   * Es la ÚNICA respuesta de la API que no usa el envoltorio JSON (API.md 3).
   * Va auditada dentro del service, antes de que se escriba un solo byte.
   */
  public export = async (req: ReportsRequest, res: Response): Promise<void> => {
    const body = bodyOf<ExportBody>(req);
    const range: Record<string, unknown> = {};
    for (const key of ['preset', 'from', 'to', 'timezone'] as const) {
      if (body[key] !== undefined) range[key] = body[key];
    }
    const csv = await this.reports.export(
      {
        report: body.report,
        range: range as never,
        ...(body.locationId === undefined ? {} : { locationId: body.locationId }),
        ...(body.zoneId === undefined ? {} : { zoneId: body.zoneId }),
        ...(body.chairId === undefined ? {} : { chairId: body.chairId }),
        ...(body.kind === undefined ? {} : { kind: body.kind as ChairKind }),
        ...(body.channel === undefined ? {} : { channel: body.channel as OrderChannel }),
        ...(body.type === undefined ? {} : { type: body.type as OrderType }),
        ...(body.paymentMethod === undefined ? {} : { paymentMethod: body.paymentMethod as PaymentMethod }),
        ...(body.includeRefunded === undefined ? {} : { includeRefunded: body.includeRefunded }),
        ...(body.groupBy === undefined ? {} : { groupBy: body.groupBy }),
        ...(body.orderBy === undefined ? {} : { orderBy: body.orderBy }),
        ...(body.segment === undefined ? {} : { segment: body.segment }),
        ...(body.supplier === undefined ? {} : { supplier: body.supplier }),
        ...(body.locationStorage === undefined ? {} : { locationStorage: body.locationStorage }),
        ...(body.onlyWithOrders === undefined ? {} : { onlyWithOrders: body.onlyWithOrders }),
        ...(body.limit === undefined ? {} : { limit: body.limit }),
        ...(body.columns === undefined ? {} : { columns: body.columns }),
        ...(body.filename === undefined ? {} : { filename: body.filename }),
        includeTotalsRow: body.includeTotalsRow,
      },
      contextOf(req),
    );

    res.setHeader('Content-Type', csv.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
    res.setHeader('X-Row-Count', String(csv.rows));
    res.status(200).send(csv.body);
  };
}
