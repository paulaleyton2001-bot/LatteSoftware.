/**
 * Servicio de sedes: casos de uso de `/api/v1/locations/*` (API.md 7.5) más el
 * borrado lógico que el enunciado del negocio exige.
 *
 * ============================== CAPAS =======================================
 * No conoce Express, ni zod, ni SQLite. Recibe entradas tipadas, decide,
 * orquesta la transacción y devuelve DTOs. El SQL vive en
 * `locations.repository.sqlite.ts` (DESIGN.md 3.1 y 3.6).
 *
 * ========================== REGLAS QUE APLICA ==============================
 *  - **Soft delete siempre.** `locations.deleted_at` existe y una fila de zona
 *    apunta a la sede con `ON DELETE CASCADE`: un borrado físico se llevaría por
 *    delante las zonas y las sillas. La baja marca `deleted_at` e `is_active = 0`.
 *  - **Una sede con zonas NO se puede dar de baja** (`BR-LOC-001`): sus zonas
 *    seguirían vivo en el mapa de la zona, apuntando a una sede que ya no existe
 *    para el cliente. Con zonas ACTIVAS es `409 LOCATION_HAS_ACTIVE_ZONES`; con
 *    zonas inactivas, `409 LOCATION_HAS_ZONES` (hay que darlas de baja o
 *    eliminarlas antes). En ambos casos el mensaje dice cuántas hay.
 *  - **El nombre es único por negocio, también entre las sedes dadas de baja**
 *    (`UNIQUE(business_id, name)` sigue vigente sobre la fila con `deleted_at`):
 *    reutilizar el nombre de una sede eliminada produciría un 500 de restricción
 *    en lugar de un 409 con mensaje útil, y además rompería los enlaces
 *    históricos que aún apuntan a esa sede.
 *  - **Desactivar no cancela.** API.md 7.5: desactivar una sede impide nuevos
 *    pedidos, reservas y alquileres, pero NO cancela los existentes. Por eso es
 *    una operación con `meta.warnings: ["EXISTING_BOOKINGS_KEPT"]` y no un error.
 *  - **Todo cambio de sede se audita** con `before_data` y `after_data`
 *    completos (BR-SEC-007).
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { AuditAction, AuditEntityType, type UserContext } from '../../shared/domain/index.js';
import { ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import type {
  LocationListFilter,
  LocationPatch,
  LocationsRepository,
  NewLocationRecord,
} from './locations.repository.js';
import type {
  LocationCountedRow,
  LocationDeleteResult,
  LocationDetailView,
  LocationView,
  LocationZoneRow,
  LocationZoneView,
} from './locations.types.js';

/** Contexto de petición para auditoría y negocio. */
export interface LocationRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Entradas de los casos de uso. */
export interface CreateLocationInput {
  readonly name: string;
  readonly address?: string | null;
  readonly phone?: string | null;
  readonly isActive: boolean;
}

export interface UpdateLocationInput {
  readonly name?: string;
  readonly address?: string | null;
  readonly phone?: string | null;
  readonly isActive?: boolean;
}

/** Página de sedes. */
export interface LocationPage {
  readonly items: readonly LocationView[];
  readonly total: number;
}

/** Resultado de un `PATCH`: la vista y los avisos no bloqueantes. */
export interface LocationUpdateResult {
  readonly location: LocationView;
  readonly warnings: readonly string[];
}

/** Servicio de sedes. */
export class LocationsService {
  public constructor(
    private readonly repository: LocationsRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /**
   * `GET /api/v1/locations` — listado paginado.
   *
   * PÚBLICO: el cliente necesita saber qué sedes existen para elegir dónde
   * reservar. Por defecto sólo se listan las ACTIVAS (una sede inactiva no
   * admite pedidos ni reservas); `?isActive=false` trae las inactivas y
   * `?isActive=true|false` filtra explícitamente.
   */
  public list(filter: Omit<LocationListFilter, 'businessId'>, businessId: number): LocationPage {
    const safe: LocationListFilter = {
      ...filter,
      businessId,
      // Sin filtro explícito, sólo las activas.
      isActive: filter.isActive ?? true,
    };
    return {
      items: this.repository.list(safe).map((row) => toView(row)),
      total: this.repository.count(safe),
    };
  }

  /** `GET /api/v1/locations/:id` — la sede con sus zonas y el conteo de sillas. */
  public getById(id: number, businessId: number): LocationDetailView {
    const row = this.requireLocation(id, businessId);
    return {
      ...toView(row),
      zones: this.repository.listZones(id).map((zone) => toZoneView(zone)),
      stats: this.repository.chairStats(id),
    };
  }

  // ==========================================================================
  // Escrituras
  // ==========================================================================

  /** `POST /api/v1/locations` — alta. */
  public create(input: CreateLocationInput, context: LocationRequestContext): LocationView {
    const businessId = context.actor.businessId;
    this.assertNameAvailable(input.name, businessId, null);

    return runInTransactionSync(() => {
      const record: NewLocationRecord = {
        businessId,
        name: input.name,
        address: input.address ?? null,
        phone: input.phone ?? null,
        isActive: input.isActive,
      };
      const id = this.repository.insert(record);
      const after = this.requireLocation(id, businessId);

      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.business,
        entityId: businessId,
        actor: context.actor,
        request: context.request,
        afterData: { resource: 'location', location: toAuditFields(after) },
      });
      return toView(after);
    });
  }

  /**
   * `PATCH /api/v1/locations/:id` — edición parcial.
   *
   * `meta.warnings: ['EXISTING_BOOKINGS_KEPT']` si la sede se desactiva y había
   * pedidos o reservas vivos: desactivar impide lo nuevo, pero no cancela lo
   * que ya está en marcha (API.md 7.5).
   */
  public update(
    id: number,
    input: UpdateLocationInput,
    context: LocationRequestContext,
  ): LocationUpdateResult {
    const businessId = context.actor.businessId;
    if (input.name !== undefined) {
      this.assertNameAvailable(input.name, businessId, id);
    }

    return runInTransactionSync(() => {
      const before = this.requireLocation(id, businessId);
      const patch: LocationPatch = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };
      this.repository.update(id, patch);
      const after = this.requireLocation(id, businessId);

      const warnings: string[] = [];
      if (input.isActive === false && before.is_active === 1) {
        const bookings = this.repository.countBookings(id);
        if (bookings.orders > 0 || bookings.reservations > 0) {
          warnings.push('EXISTING_BOOKINGS_KEPT');
        }
      }

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.business,
        entityId: businessId,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'location', location: toAuditFields(before) },
        afterData: { resource: 'location', location: toAuditFields(after) },
      });

      return { location: toView(after), warnings };
    });
  }

  /**
   * `DELETE /api/v1/locations/:id` — baja lógica.
   *
   * DESVIACIÓN DOCUMENTADA: la tabla de endpoints de API.md 7.5 no incluye el
   * `DELETE`, pero la introducción de la sección 7 sí cuenta "DELETE de zonas,
   * categorías, productos, descuentos, sillas, locales e inventario". Este
   * endpoint es el que corresponde a esa fila; hay que añadirlo a la tabla.
   *
   * Permiso: `locations:update`. No existe una clave `locations:delete` en
   * DESIGN.md 9.2, y no se inventa una: la baja de una sede es una edición de
   * configuración.
   *
   * @throws ConflictError 409 si la sede tiene zonas (activas o inactivas).
   */
  public remove(id: number, context: LocationRequestContext): LocationDeleteResult {
    const businessId = context.actor.businessId;

    return runInTransactionSync(() => {
      const before = this.requireLocation(id, businessId);
      const zones = this.repository.countZones(id);
      this.assertRemovable(zones, id);

      const deletedAt = nowIso();
      this.repository.softDelete(id, deletedAt);

      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.business,
        entityId: businessId,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'location', location: toAuditFields(before) },
        afterData: { resource: 'location', deletedAt },
      });

      return { id, deletedAt, zonesCount: zones.total };
    });
  }

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  /** Sede obligatoria: `404` si no existe, está dada de baja o es ajena. */
  private requireLocation(id: number, businessId: number): LocationCountedRow {
    const row = this.repository.findById(id, businessId);
    if (row === null) {
      throw new NotFoundError('La sede no existe', { details: { id, type: 'location' } });
    }
    return row;
  }

  /**
   * El nombre debe estar libre en el negocio. `excludeId` permite el propio
   * recurso cuando se edita (cambiar el teléfono no debe chocar con su nombre).
   */
  private assertNameAvailable(name: string, businessId: number, excludeId: number | null): void {
    const existing = this.repository.findByNameIncludingDeleted(name, businessId);
    if (existing !== null && existing.id !== excludeId) {
      throw new ConflictError('Ya existe una sede con ese nombre en este negocio', {
        details: { code: 'LOCATION_NAME_TAKEN', field: 'name' },
      });
    }
  }

  /** BR-LOC-001: una sede con zonas no se puede dar de baja. */
  private assertRemovable(zones: { readonly total: number; readonly active: number }, id: number): void {
    if (zones.active > 0) {
      throw new ConflictError(
        `La sede tiene ${zones.active} zona(s) activa(s): desactívelas o elimínalas antes de darla de baja`,
        {
          details: {
            code: 'LOCATION_HAS_ACTIVE_ZONES',
            id,
            activeZones: zones.active,
            totalZones: zones.total,
          },
        },
      );
    }
    if (zones.total > 0) {
      throw new ConflictError(
        `La sede tiene ${zones.total} zona(s) inactiva(s): elimínalas antes de darla de baja`,
        {
          details: {
            code: 'LOCATION_HAS_ZONES',
            id,
            activeZones: 0,
            totalZones: zones.total,
          },
        },
      );
    }
  }
}

// --------------------------------------------------------------------------
// Proyecciones de fila a DTO
// --------------------------------------------------------------------------

/** Fila de `locations` -> vista del contrato. */
function toView(row: LocationCountedRow): LocationView {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    isActive: row.is_active === 1,
    zonesCount: row.zones_count,
    activeChairsCount: row.active_chairs_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Fila de `zones` -> zona embebida en el detalle de la sede. */
function toZoneView(row: LocationZoneRow): LocationZoneView {
  return {
    id: row.id,
    locationId: row.location_id,
    name: row.name,
    code: row.code,
    colorHex: row.color_hex,
    capacity: row.capacity,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    chairCount: row.chair_count,
    availableCount: row.available_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Snapshot de la sede para `audit_logs`. */
function toAuditFields(row: LocationCountedRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    isActive: row.is_active === 1,
    zonesCount: row.zones_count,
    activeChairsCount: row.active_chairs_count,
  };
}
