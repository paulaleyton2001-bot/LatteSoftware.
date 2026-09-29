/**
 * Controller del módulo `locations` (API.md 7.5).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: no comprueba nombres duplicados, no cuenta zonas
 *    ni cancela reservas. Traduce `req` -> tipos del service y la respuesta -> el
 *    envoltorio de API.md 3.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`.
 *  - No escribe SQL ni toca la base de datos.
 *  - `businessId` sale SIEMPRE del token cuando hay token, y del negocio
 *    singleton cuando la lectura es anónima. Nunca del body ni de la query
 *    (API.md 2).
 */
import type { Response } from 'express';

import { AUTH } from '../../config/index.js';
import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { hasAuth, requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type {
  CreateLocationBody,
  ListLocationsQuery,
  UpdateLocationBody,
} from './locations.schemas.js';
import { LOCATION_SORT_DEFAULT } from './locations.schemas.js';
import type { LocationSortColumn } from './locations.types.js';
import type { LocationRequestContext, LocationsService } from './locations.service.js';

/** `req` con actor opcional y cuerpo/query/params validados. */
type LocationRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_COLUMNS: readonly LocationSortColumn[] = ['name', 'created_at', 'updated_at'];

/** Contexto de auditoría de la petición (el actor ya está resuelto). */
function contextOf(req: LocationRequest): LocationRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Identidad del negocio: la del token, o el singleton si la lectura es anónima. */
function businessIdOf(req: LocationRequest): number {
  return hasAuth(req) ? req.auth.businessId : AUTH.DEFAULT_BUSINESS_ID;
}

/** Controller de sedes. */
export class LocationsController {
  public constructor(private readonly locations: LocationsService) {}

  /**
   * `GET /api/v1/locations` — listado paginado, PÚBLICO.
   *
   * El cliente necesita saber qué sedes existen antes de iniciar sesión; la
   * lista sólo contiene datos de contacto y estado, nada de la configuración
   * fiscal del negocio.
   */
  public list = async (req: LocationRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListLocationsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? LOCATION_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as LocationSortColumn)
      : (LOCATION_SORT_DEFAULT as LocationSortColumn);

    const page = this.locations.list(
      {
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        sort: { column, direction: req.validated?.sort?.direction ?? 'ASC' },
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      },
      businessIdOf(req),
    );
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /** `POST /api/v1/locations` — alta (201). `409 LOCATION_NAME_TAKEN`. */
  public create = async (req: LocationRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateLocationBody;
    sendCreated(
      res,
      this.locations.create(
        {
          name: body.name,
          ...(body.address === undefined ? {} : { address: body.address }),
          ...(body.phone === undefined ? {} : { phone: body.phone }),
          isActive: body.isActive,
        },
        contextOf(req),
      ),
    );
  };

  /**
   * `GET /api/v1/locations/:id` — la sede con sus zonas y el conteo de sillas.
   * PÚBLICO, por el mismo motivo que el listado.
   */
  public getById = async (req: LocationRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.locations.getById(params.id, businessIdOf(req)));
  };

  /**
   * `PATCH /api/v1/locations/:id` — edición parcial.
   * `meta.warnings: ["EXISTING_BOOKINGS_KEPT"]` si se desactiva con pedidos o
   * reservas vivos (API.md 7.5).
   */
  public update = async (req: LocationRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as UpdateLocationBody;
    const result = this.locations.update(
      params.id,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.address === undefined ? {} : { address: body.address }),
        ...(body.phone === undefined ? {} : { phone: body.phone }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      },
      contextOf(req),
    );
    sendSuccess(
      res,
      result.location,
      result.warnings.length === 0 ? {} : { warnings: result.warnings },
    );
  };

  /**
   * `DELETE /api/v1/locations/:id` — baja lógica.
   * `409 LOCATION_HAS_ACTIVE_ZONES` si la sede tiene zonas (BR-LOC-001).
   */
  public remove = async (req: LocationRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.locations.remove(params.id, contextOf(req)));
  };
}
