/**
 * Controller del módulo `business` (API.md 7.4 + `GET /api/v1/business/status`).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: no valida zonas horarias, no cuenta pedidos ni
 *    ordena días. Traduce `req` -> tipos del service y la respuesta -> el
 *    envoltorio de API.md 3.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`, que es el
 *    único que decide el status y el `code`.
 *  - No escribe SQL ni toca la base de datos.
 *  - `businessId` sale SIEMPRE del token (`authenticate` ya lo resolvió) y, en
 *    las lecturas públicas donde no hay token, del singleton del despliegue.
 *    Nunca del body ni de la query (API.md 2).
 *  - Aquí, y sólo aquí, se decide si la respuesta es la vista COMPLETA o la
 *    PÚBLICA del negocio: es una decisión de autorización (quién puede ver
 *    `taxId`), no de negocio.
 */
import type { Response } from 'express';

import { AUTH } from '../../config/index.js';
import { PERMISSION, type UserContext } from '../../shared/domain/index.js';
import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import {
  hasAuth,
  hasPermission,
  requireAuth,
  type RequestWithAuth,
} from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { BusinessRequestContext, BusinessService } from './business.service.js';
import type {
  CreateBusinessHolidayBody,
  ListBusinessHolidaysQuery,
  ReplaceBusinessHoursBody,
  UpdateBusinessBody,
} from './business.schemas.js';

/** `req` con actor opcional y cuerpo/query/params validados. */
type BusinessRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
  };
};

/** Contexto de auditoría de la petición. */
function contextOf(req: BusinessRequest): BusinessRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/**
 * Identidad del negocio de la petición.
 *
 * Con token, la del token (`authenticate` la ya resolvió del access token). Sin
 * token --lectura pública-- el singleton del despliegue (`businesses.id = 1`).
 * En ningún caso un parámetro del cliente.
 */
function businessIdOf(req: BusinessRequest): number {
  return hasAuth(req) ? (req.auth as UserContext).businessId : AUTH.DEFAULT_BUSINESS_ID;
}

/** Controller de la configuración del negocio. */
export class BusinessController {
  public constructor(private readonly business: BusinessService) {}

  /**
   * `GET /api/v1/business` — configuración del negocio.
   *
   * PÚBLICA por decisión del cliente móvil: sin token devuelve la proyección sin
   * datos fiscales; con token y `business:read` devuelve la configuración
   * completa (API.md 7.4 la declaraba `business:read`, y ese caso sigue siendo
   * el que recibe la vista `full`).
   */
  public get = async (req: BusinessRequest, res: Response): Promise<void> => {
    const mode = hasPermission(req, PERMISSION.BUSINESS_READ) ? 'full' : 'public';
    sendSuccess(res, this.business.get(mode, businessIdOf(req)));
  };

  /**
   * `GET /api/v1/business/status` — ¿está abierto el local ahora?
   *
   * DESVIACIÓN DOCUMENTADA: `docs/API.md` NO define este endpoint. La home del
   * cliente lo necesita ANTES de iniciar sesión (para pintar "abierto ahora" y
   * deshabilitar el pedido), así que es público y su respuesta no lleva nada de
   * la configuración. Hay que añadir esta sección a API.md.
   */
  public status = async (_req: BusinessRequest, res: Response): Promise<void> => {
    sendSuccess(res, this.business.getStatus());
  };

  /** `GET /api/v1/business/hours` — los siete días, ordenados. */
  public getHours = async (req: BusinessRequest, res: Response): Promise<void> => {
    sendSuccess(res, this.business.getHours(businessIdOf(req)));
  };

  /**
   * `PATCH /api/v1/business` — edición parcial de la configuración.
   *
   * Todo cambio escribe en `audit_logs` con `before_data` y `after_data`
   * completos (BR-SEC-007). `meta.warnings` recoge los cambios con efecto
   * colateral, como `TIMEZONE_CHANGED` (API.md 7.4).
   */
  public update = async (req: BusinessRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as UpdateBusinessBody;
    const result = this.business.update(
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.legalName === undefined ? {} : { legalName: body.legalName }),
        ...(body.logoUrl === undefined ? {} : { logoUrl: body.logoUrl }),
        ...(body.taxId === undefined ? {} : { taxId: body.taxId }),
        ...(body.email === undefined ? {} : { email: body.email }),
        ...(body.phone === undefined ? {} : { phone: body.phone }),
        ...(body.addressLine1 === undefined ? {} : { addressLine1: body.addressLine1 }),
        ...(body.addressLine2 === undefined ? {} : { addressLine2: body.addressLine2 }),
        ...(body.city === undefined ? {} : { city: body.city }),
        ...(body.country === undefined ? {} : { country: body.country }),
        ...(body.currencyCode === undefined ? {} : { currencyCode: body.currencyCode }),
        ...(body.currencySymbol === undefined ? {} : { currencySymbol: body.currencySymbol }),
        ...(body.locale === undefined ? {} : { locale: body.locale }),
        ...(body.timezone === undefined ? {} : { timezone: body.timezone }),
        ...(body.taxRateBp === undefined ? {} : { taxRateBp: body.taxRateBp }),
        ...(body.taxInclusive === undefined ? {} : { taxInclusive: body.taxInclusive }),
        ...(body.serviceFeeBp === undefined ? {} : { serviceFeeBp: body.serviceFeeBp }),
        ...(body.tipEnabled === undefined ? {} : { tipEnabled: body.tipEnabled }),
        ...(body.defaultTipsBp === undefined ? {} : { defaultTipsBp: body.defaultTipsBp }),
        ...(body.maxReservationMinutes === undefined
          ? {}
          : { maxReservationMinutes: body.maxReservationMinutes }),
        ...(body.chairDefaultPriceMinor === undefined
          ? {}
          : { chairDefaultPriceMinor: body.chairDefaultPriceMinor }),
        ...(body.allowNegativeStock === undefined
          ? {}
          : { allowNegativeStock: body.allowNegativeStock }),
        ...(body.lowStockAlertThreshold === undefined
          ? {}
          : { lowStockAlertThreshold: body.lowStockAlertThreshold }),
        ...(body.orderPrefix === undefined ? {} : { orderPrefix: body.orderPrefix }),
      },
      contextOf(req),
    );
    sendSuccess(
      res,
      result.business,
      result.warnings.length === 0 ? {} : { warnings: result.warnings },
    );
  };

  /** `PUT /api/v1/business/hours` — reemplazo transaccional de la semana. */
  public replaceHours = async (req: BusinessRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as ReplaceBusinessHoursBody;
    const result = this.business.replaceHours(
      body.hours.map((day) => ({
        dayOfWeek: day.dayOfWeek,
        opensAt: day.opensAt,
        closesAt: day.closesAt,
        isClosed: day.isClosed,
      })),
      contextOf(req),
    );
    sendSuccess(
      res,
      result.hours,
      result.warnings.length === 0 ? {} : { warnings: result.warnings },
    );
  };

  /** `GET /api/v1/business/holidays` — listado paginado. */
  public listHolidays = async (req: BusinessRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListBusinessHolidaysQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const context = contextOf(req);
    const page = this.business.listHolidays(
      {
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.includePast === undefined ? {} : { includePast: query.includePast }),
      },
      context.actor.businessId,
    );
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /**
   * `POST /api/v1/business/holidays` — alta (201).
   * `409 HOLIDAY_ALREADY_EXISTS` si la fecha ya está registrada.
   */
  public createHoliday = async (req: BusinessRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateBusinessHolidayBody;
    sendCreated(res, this.business.createHoliday(
      {
        holidayDate: body.holidayDate,
        name: body.name,
        isClosed: body.isClosed,
      },
      contextOf(req),
    ));
  };

  /** `DELETE /api/v1/business/holidays/:id` — baja del festivo. */
  public deleteHoliday = async (req: BusinessRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.business.deleteHoliday(params.id, contextOf(req)));
  };
}
