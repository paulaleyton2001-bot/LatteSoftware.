/**
 * Controller de zonas y sillas (API.md 7.6 y 7.7).
 *
 * REGLAS QUE RESPETA ESTE FICHERO (DESIGN.md 3.2):
 *  - No decide negocio: traduce `req` ya validado a los tipos del service y da
 *    forma a la respuesta con los helpers de `shared/http`.
 *  - No contiene `try/catch`: los errores suben al `errorHandler`, que es el
 *    único que decide el status y el `code` de API.md 4.
 *  - No escribe SQL ni toca la base de datos.
 *  - Construye el `SpacesRequestContext` UNA vez, para que los 19 handlers no
 *    repitan actor + metadatos de auditoría.
 *
 * Los avisos no bloqueantes (`CAPACITY_IS_DERIVED`, `PRICE_CHANGE_AFFECTS_ONLY_NEW`,
 * `ALREADY_APPLIED`) viajan en `meta.warnings`, que es donde API.md 3.1 dice que
 * van: son información para la UI, no un error.
 */
import type { Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { SpacesRequestContext, SpacesService } from './spaces.service.js';
import type { ChairListFilter, ChairMapFilter, ZoneListFilter } from './spaces.types.js';
import {
  CHAIR_HISTORY_SORT_DEFAULT,
  CHAIR_SORT_COLUMNS,
  CHAIR_SORT_DEFAULT,
  ZONE_SORT_COLUMNS,
  ZONE_SORT_DEFAULT,
  type ChairAvailabilityQuery,
  type ChairHistoryQuery,
  type ChairIdParams,
  type ChairMapQuery,
  type CompleteMaintenanceInput,
  type CreateChairBody,
  type CreateZoneBody,
  type DeleteChairBody,
  type ListChairsQuery,
  type ListZonesQuery,
  type ReorderZonesBody,
  type SetChairStatusBody,
  type UpdateChairBody,
  type UpdateZoneBody,
  type ZoneIdParams,
} from './spaces.schemas.js';

/** `req` con actor y cuerpo/query/params ya validados. */
type SpacesRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables replicadas para acotar la salida de `parseSort`. */
const CHAIR_SORT_ALLOWED: readonly string[] = CHAIR_SORT_COLUMNS;
const ZONE_SORT_ALLOWED: readonly string[] = ZONE_SORT_COLUMNS;

/** Contexto de auditoría de la petición. */
function contextOf(req: SpacesRequest): SpacesRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Orden validado contra la allowlist, con el valor por defecto del recurso. */
function sortOf(
  req: SpacesRequest,
  allowed: readonly string[],
  fallback: string,
): { readonly column: string; readonly direction: 'ASC' | 'DESC' } {
  const requested = req.validated?.sort?.column ?? fallback;
  const column = allowed.includes(requested) ? requested : fallback;
  return { column, direction: req.validated?.sort?.direction ?? 'DESC' };
}

/** Controller de zonas y sillas. */
export class SpacesController {
  public constructor(private readonly spaces: SpacesService) {}

  // ==========================================================================
  // Zonas — API.md 7.6
  // ==========================================================================

  /** `GET /zones` — listado paginado con contadores por estado. */
  public listZones = async (req: SpacesRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListZonesQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const actor = requireAuth(req);
    const filter: ZoneListFilter = {
      businessId: actor.businessId,
      locationId: query.locationId,
      includeInactive: query.includeInactive === true,
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.q === undefined ? {} : { q: query.q }),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: sortOf(req, ZONE_SORT_ALLOWED, ZONE_SORT_DEFAULT) as ZoneListFilter['sort'],
    };
    const page = this.spaces.listZones(filter, contextOf(req));
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /** `GET /zones/:id` — zona con sus sillas. */
  public getZone = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ZoneIdParams;
    sendSuccess(res, this.spaces.getZone(params.id, contextOf(req)));
  };

  /** `POST /zones` — alta (201). */
  public createZone = async (req: SpacesRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateZoneBody;
    const result = this.spaces.createZone(
      {
        locationId: body.locationId,
        name: body.name,
        ...(body.code === undefined ? {} : { code: body.code }),
        colorHex: body.colorHex,
        ...(body.capacity === undefined ? {} : { capacity: body.capacity }),
        ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
        isActive: body.isActive,
      },
      contextOf(req),
    );
    sendCreated(res, result.zone, result.warnings.length === 0 ? {} : { warnings: result.warnings });
  };

  /** `PATCH /zones/:id` — edición (200). */
  public updateZone = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ZoneIdParams;
    const body = req.validated?.body as UpdateZoneBody;
    const result = this.spaces.updateZone(
      params.id,
      {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.code === undefined ? {} : { code: body.code }),
        ...(body.colorHex === undefined ? {} : { colorHex: body.colorHex }),
        ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      },
      contextOf(req),
    );
    sendSuccess(res, result.zone, result.warnings.length === 0 ? {} : { warnings: result.warnings });
  };

  /** `DELETE /zones/:id` — soft delete (200 con `{ id, deletedAt }`). */
  public deleteZone = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ZoneIdParams;
    sendSuccess(res, this.spaces.deleteZone(params.id, contextOf(req)));
  };

  /** `POST /zones/reorder` — reordenación transaccional (200). */
  public reorderZones = async (req: SpacesRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as ReorderZonesBody;
    sendSuccess(res, this.spaces.reorderZones({ locationId: body.locationId, items: body.items }, contextOf(req)));
  };

  // ==========================================================================
  // Sillas — API.md 7.7
  // ==========================================================================

  /** `GET /chairs` — listado paginado con contadores por estado en el `meta`. */
  public listChairs = async (req: SpacesRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListChairsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const actor = requireAuth(req);
    const filter: ChairListFilter = {
      businessId: actor.businessId,
      includeInactive: query.includeInactive === true,
      ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
      ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.kind === undefined ? {} : { kind: query.kind }),
      ...(query.isBookable === undefined ? {} : { isBookable: query.isBookable }),
      ...(query.q === undefined ? {} : { q: query.q }),
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: sortOf(req, CHAIR_SORT_ALLOWED, CHAIR_SORT_DEFAULT) as ChairListFilter['sort'],
    };
    const page = this.spaces.listChairs(filter, contextOf(req));
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      // `meta.countsByStatus`: la vista de rejilla pinta los contadores sin
      // tener que pedirlos en un segundo request (BR-CHAIR-006).
      { countsByStatus: page.countsByStatus },
    );
  };

  /**
   * `GET /chairs/map` — el mapa visual (BR-CHAIR-006).
   *
   * Se declara ANTES de `/:id` en el router: Express enruta por orden de
   * declaración y `map` no es un id.
   */
  public getMap = async (req: SpacesRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ChairMapQuery;
    const actor = requireAuth(req);
    const filter: ChairMapFilter = {
      businessId: actor.businessId,
      locationId: query.locationId,
      includeInactive: query.includeInactive === true,
      ...(query.zoneId === undefined ? {} : { zoneId: query.zoneId }),
    };
    sendSuccess(res, this.spaces.getMap(filter, contextOf(req)), { generatedAt: new Date().toISOString() });
  };

  /** `GET /chairs/:id` — ficha con sesión viva e indicadores de uso. */
  public getChair = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    sendSuccess(res, this.spaces.getChair(params.id, contextOf(req)));
  };

  /** `POST /chairs` — alta (201). El estado inicial siempre es `AVAILABLE`. */
  public createChair = async (req: SpacesRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateChairBody;
    sendCreated(res, this.spaces.createChair(
      {
        zoneId: body.zoneId,
        code: body.code,
        kind: body.kind,
        capacity: body.capacity,
        name: body.name ?? null,
        numberLabel: body.numberLabel ?? null,
        notes: body.notes ?? null,
        ...(body.pricePerHourMinor === undefined ? {} : { pricePerHourMinor: body.pricePerHourMinor }),
        gridX: body.gridX,
        gridY: body.gridY,
        mapWidth: body.mapWidth,
        mapHeight: body.mapHeight,
        rotationDeg: body.rotationDeg,
        features: body.features,
        isBookable: body.isBookable,
        isActive: body.isActive,
      },
      contextOf(req),
    ));
  };

  /** `PATCH /chairs/:id` — edición (200). */
  public updateChair = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    const body = req.validated?.body as UpdateChairBody;
    const result = this.spaces.updateChair(
      params.id,
      {
        ...(body.zoneId === undefined ? {} : { zoneId: body.zoneId }),
        ...(body.code === undefined ? {} : { code: body.code }),
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.numberLabel === undefined ? {} : { numberLabel: body.numberLabel }),
        ...(body.kind === undefined ? {} : { kind: body.kind }),
        ...(body.capacity === undefined ? {} : { capacity: body.capacity }),
        ...(body.pricePerHourMinor === undefined ? {} : { pricePerHourMinor: body.pricePerHourMinor }),
        ...(body.gridX === undefined ? {} : { gridX: body.gridX }),
        ...(body.gridY === undefined ? {} : { gridY: body.gridY }),
        ...(body.mapWidth === undefined ? {} : { mapWidth: body.mapWidth }),
        ...(body.mapHeight === undefined ? {} : { mapHeight: body.mapHeight }),
        ...(body.rotationDeg === undefined ? {} : { rotationDeg: body.rotationDeg }),
        ...(body.features === undefined ? {} : { features: body.features }),
        ...(body.notes === undefined ? {} : { notes: body.notes }),
        ...(body.isBookable === undefined ? {} : { isBookable: body.isBookable }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      },
      contextOf(req),
    );
    sendSuccess(res, result.chair, result.warnings.length === 0 ? {} : { warnings: result.warnings });
  };

  /** `DELETE /chairs/:id` — soft delete con motivo (200). */
  public deleteChair = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    const body = req.validated?.body as DeleteChairBody;
    sendSuccess(res, this.spaces.deleteChair(params.id, body.reason, contextOf(req)));
  };

  /** `PATCH /chairs/:id/status` — cambio de estado operativo (200). */
  public setChairStatus = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    const body = req.validated?.body as SetChairStatusBody;
    const result = this.spaces.setStatus(
      params.id,
      body.status,
      body.reason,
      contextOf(req),
    );
    sendSuccess(res, result.chair, result.warnings.length === 0 ? {} : { warnings: result.warnings });
  };

  /** `GET /chairs/:id/availability` — calendario de ocupación. */
  public availability = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    const query = (req.validated?.query ?? {}) as ChairAvailabilityQuery;
    const now = new Date();
    // `from`/`to` son opcionales: sin ellos, la ventana por defecto son las
    // próximas 24 horas, que es lo que consulta la app al abrir la ficha.
    const from = query.from ?? now.toISOString();
    const to =
      query.to ??
      (query.from === undefined
        ? new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
        : (query.from as string));
    sendSuccess(
      res,
      this.spaces.availability(
        params.id,
        { from, to, granularityMinutes: query.granularityMinutes },
        contextOf(req),
      ),
    );
  };

  /** `GET /chairs/:id/history` — sesiones de la silla, paginadas. */
  public history = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    const query = (req.validated?.query ?? {}) as ChairHistoryQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const now = new Date();
    const to = query.to ?? now.toISOString();
    const from =
      query.from ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const page = this.spaces.history(
      params.id,
      {
        chairId: params.id,
        businessId: requireAuth(req).businessId,
        from,
        to,
        ...(query.type === undefined ? {} : { type: query.type }),
      },
      { limit: pagination.pageSize, offset: (pagination.page - 1) * pagination.pageSize },
      {
        column: req.validated?.sort?.column ?? CHAIR_HISTORY_SORT_DEFAULT,
        direction: req.validated?.sort?.direction ?? 'DESC',
      },
      contextOf(req),
    );
    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.totals.sessions },
      { totals: page.totals },
    );
  };

  /** `POST /chairs/:id/block` — bloqueo con motivo (200). */
  public blockChair = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    const body = req.validated?.body as { reason: string };
    const result = this.spaces.block(params.id, body.reason, contextOf(req));
    sendSuccess(res, result.chair, { affectedReservations: result.affectedReservations });
  };

  /** `POST /chairs/:id/unblock` — desbloqueo (200). */
  public unblockChair = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    sendSuccess(res, this.spaces.unblock(params.id, contextOf(req)).chair);
  };

  /** `POST /chairs/:id/maintenance` — envío a mantenimiento (200). */
  public maintenanceChair = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    const body = req.validated?.body as { reason: string };
    const result = this.spaces.maintenance(params.id, body.reason, contextOf(req));
    sendSuccess(res, result.chair, { affectedReservations: result.affectedReservations });
  };

  /** `POST /chairs/:id/complete-maintenance` — cierre de la intervención (200). */
  public completeMaintenance = async (req: SpacesRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as ChairIdParams;
    // `complete-maintenance` admite cuerpo vacío: el esquema es opcional y el
    // default documentado es `needsCleaning: true` (API.md 7.7).
    const body = (req.validated?.body ?? { needsCleaning: true }) as CompleteMaintenanceInput;
    const result = this.spaces.completeMaintenance(
      params.id,
      { needsCleaning: body.needsCleaning, ...(body.notes === undefined ? {} : { notes: body.notes }) },
      contextOf(req),
    );
    sendSuccess(res, result.chair, result.warnings.length === 0 ? {} : { warnings: result.warnings });
  };
}
