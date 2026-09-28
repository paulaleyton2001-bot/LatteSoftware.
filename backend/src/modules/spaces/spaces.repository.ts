/**
 * Contrato de persistencia de la familia de ESPACIOS: zonas y sillas.
 *
 * ============================================================================
 * POR QUÉ `chairs` NO LLEVA `business_id`
 * ============================================================================
 * `chairs.zone_id -> zones.id -> zones.business_id`. El aislamiento por negocio
 * (BR-SEC-008) se hace siempre por ese camino, y TODAS las consultas de sillas
 * de este repositorio hacen el JOIN con `zones`. Una consulta de sillas sin ese
 * JOIN sería una fuga entre negocios, así que no existe ningún método que lea
 * sillas sin acotar por `business_id`.
 *
 * ============================================================================
 * REGLAS DE CAPA (DESIGN.md 3.2/3.3)
 * ============================================================================
 *  - Aquí NO hay SQL: la implementación vive en `spaces.repository.sqlite.ts`.
 *  - Ninguna decisión de negocio: este contrato sólo habla de filas y de
 *    parámetros. Si un método necesita "si el cliente tiene el permiso X", quien
 *    lo decide es el service.
 *  - Ningún método abre ni cierra transacción: es el service, con
 *    `runInTransactionSync`, quien la envuelve (DESIGN.md 8.2).
 *  - Todos los métodos aceptan la conexión como último parámetro opcional para
 *    poder participar en la transacción abierta por el UnitOfWork.
 */
import type { Db } from '../../shared/database/connection.js';
import type { ChairKind, ChairStatus } from '../../shared/domain/index.js';
import type {
  ChairListFilter,
  ChairMapFilter,
  ChairPatch,
  ZoneListFilter,
  ZonePatch,
} from './spaces.types.js';

// Reexportados para que el controller y el service hablen el vocabulario del
// repositorio sin llegar a `*.types` (mismo criterio que `users` y `customers`).
export type { ChairListFilter, ChairMapFilter, ChairPatch, ZoneListFilter, ZonePatch };

// --------------------------------------------------------------------------
// Filas
// --------------------------------------------------------------------------

/**
 * Fila de `zones` con el nombre de su sede y los agregados de sillas.
 *
 * `chair_count` y `available_count` vienen del `LEFT JOIN` con `chairs` en la
 * misma consulta: es la forma de evitar el N+1 del listado de zonas (una consulta
 * por zona) sin recurrir a un segundo `SELECT` por zona.
 */
export interface ZoneRow {
  readonly id: number;
  readonly business_id: number;
  readonly location_id: number;
  readonly location_name: string;
  readonly name: string;
  readonly code: string | null;
  readonly color_hex: string | null;
  readonly capacity: number;
  readonly sort_order: number;
  readonly is_active: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
  /** Aggregate del JOIN: sillas activas de la zona. */
  readonly chair_count: number;
  /** Aggregate del JOIN: sillas de la zona en estado `AVAILABLE`. */
  readonly available_count: number;
}

/** Fila de `chairs` con el nombre de su zona y la sede a la que pertenece. */
export interface ChairRow {
  readonly id: number;
  readonly zone_id: number;
  readonly zone_name: string;
  readonly location_id: number;
  readonly business_id: number;
  readonly code: string;
  readonly name: string | null;
  readonly number_label: string | null;
  readonly kind: ChairKind;
  readonly capacity: number;
  readonly price_per_hour_minor: number;
  readonly status: ChairStatus;
  readonly status_changed_at: string;
  readonly grid_x: number;
  readonly grid_y: number;
  readonly map_width: number;
  readonly map_height: number;
  readonly rotation_deg: number;
  /** JSON serializado (`["wifi","outlet"]`) o `null`. */
  readonly features: string | null;
  readonly notes: string | null;
  readonly is_bookable: 0 | 1;
  readonly is_active: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
}

/**
 * Ajustes del negocio que afectan a la family's espacios.
 *
 * Se leen aquí, y no desde un repositorio de `businesses`, porque el módulo
 * `business` todavía no existe y porque son exactamente los campos que este
 * dominio necesita: `max_reservation_minutes` (BR-RENTAL-010),
 * `chair_default_price_minor` (BR-CHAIR-002) y los tres de precio/imposto.
 */
export interface BusinessSpaceSettingsRow {
  readonly id: number;
  readonly name: string;
  readonly currency_code: string;
  readonly currency_symbol: string;
  readonly max_reservation_minutes: number;
  readonly chair_default_price_minor: number;
  readonly tax_rate_bp: number;
  readonly service_fee_bp: number;
  readonly tax_inclusive: 0 | 1;
}

/** Fila de `locations` (sede). */
export interface LocationRow {
  readonly id: number;
  readonly business_id: number;
  readonly name: string;
  readonly is_active: 0 | 1;
}

/** Par (zona, estado) con el número de sillas en ese estado. */
export interface ZoneStatusCountRow {
  readonly zone_id: number;
  readonly status: ChairStatus;
  readonly total: number;
}

/** Par (estado, total) de sillas de un filtro de listado o de mapa. */
export interface StatusCountRow {
  readonly status: ChairStatus;
  readonly total: number;
}

/** Datos de inserción de una zona. */
export interface NewZone {
  readonly businessId: number;
  readonly locationId: number;
  readonly name: string;
  readonly code: string | null;
  readonly colorHex: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/** Datos de inserción de una silla. `status` NUNCA viaja: siempre `AVAILABLE`. */
export interface NewChair {
  readonly zoneId: number;
  readonly code: string;
  readonly name: string | null;
  readonly numberLabel: string | null;
  readonly kind: ChairKind;
  readonly capacity: number;
  readonly pricePerHourMinor: number;
  readonly gridX: number;
  readonly gridY: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly rotationDeg: number;
  /** Se serializa a JSON aquí, no en el service. */
  readonly features: readonly string[];
  readonly notes: string | null;
  readonly isBookable: boolean;
  readonly isActive: boolean;
  /** `status_changed_at` de la fila nueva. */
  readonly statusChangedAt: string;
}

// --------------------------------------------------------------------------
// Repositorio
// --------------------------------------------------------------------------

/** Repositorio de zonas y sillas (y de los ajustes de negocio que las afetan). */
export interface SpacesRepository {
  // --- Contexto -------------------------------------------------------------

  /** Ajustes del negocio. `null` si el negocio no existe. */
  findBusinessSettings(businessId: number, db?: Db): BusinessSpaceSettingsRow | null;
  /** Sede por id, acotada al negocio. `null` si no existe o está borrada. */
  findLocation(locationId: number, businessId: number, db?: Db): LocationRow | null;
  /** Sedes del negocio. `includeInactive` trae también las inactivas. */
  listLocations(businessId: number, includeInactive: boolean, db?: Db): readonly LocationRow[];

  // --- Zonas ----------------------------------------------------------------

  /** Listado paginado de zonas con agregados de sillas. */
  listZones(filter: ZoneListFilter, db?: Db): readonly ZoneRow[];
  /** Total de zonas que satisfacen el filtro, sin paginar. */
  countZones(filter: Omit<ZoneListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Zona por id, acotada al negocio y no borrada. `null` si no existe. */
  findZoneById(zoneId: number, businessId: number, db?: Db): ZoneRow | null;
  /** Zona por id incluyendo las borradas lógicamente (para validar y restaurar). */
  findZoneByIdIncludingDeleted(zoneId: number, db?: Db): ZoneRow | null;
  /** Ids de las zonas de una sede, para validar `POST /zones/reorder`. */
  listZoneIdsByLocation(locationId: number, db?: Db): readonly number[];
  /** Contadores por (zona, estado) de las sillas activas del negocio. */
  listZoneStatusCounts(businessId: number, locationId: number, db?: Db): readonly ZoneStatusCountRow[];
  /** `max(sort_order) + 1` de las zonas de una sede. 1 si no hay ninguna. */
  nextZoneSortOrder(locationId: number, db?: Db): number;
  /** Inserta la zona y devuelve su id. */
  insertZone(zone: NewZone, db?: Db): number;
  /** Actualiza los campos indicados de la zona. */
  updateZone(zoneId: number, patch: ZonePatch, db?: Db): void;
  /** Soft delete: sólo `deleted_at` (el histórico de sillas debe seguir siendo legible). */
  softDeleteZone(zoneId: number, deletedAt: string, db?: Db): void;
  /**
   * Recalcula `zones.capacity` como la suma de `chairs.capacity` de sus sillas
   * activas (BR-CHAIR-005). Es una caché para el mapa, no la fuente de verdad.
   */
  recomputeZoneCapacity(zoneId: number, db?: Db): void;

  // --- Sillas ---------------------------------------------------------------

  /** Listado paginado de sillas. */
  listChairs(filter: ChairListFilter, db?: Db): readonly ChairRow[];
  /** Total de sillas que satisfacen el filtro, sin paginar. */
  countChairs(filter: Omit<ChairListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Silla por id, acotada al negocio. `null` si no existe o está borrada. */
  findChairById(chairId: number, businessId: number, db?: Db): ChairRow | null;
  /** Silla por `code`, que es UNIQUE global (BR-CHAIR-001). */
  findChairByCode(code: string, db?: Db): ChairRow | null;
  /** Sillas de las zonas indicadas, para pintar el mapa en dos consultas. */
  listChairsForMap(filter: ChairMapFilter, db?: Db): readonly ChairRow[];
  /** Zonas del mapa, con sus agregados. */
  listZonesForMap(filter: ChairMapFilter, db?: Db): readonly ZoneRow[];
  /** Contadores por estado de las sillas de un filtro de listado. */
  countChairsByStatus(filter: Omit<ChairListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): readonly StatusCountRow[];
  /** Inserta la silla y devuelve su id. El estado inicial es SIEMPRE `AVAILABLE`. */
  insertChair(chair: NewChair, db?: Db): number;
  /** Actualiza los campos indicados de la silla (sin `code` ni `status`). */
  updateChair(chairId: number, patch: ChairPatch, db?: Db): void;
  /**
   * Cambia el `code` de la silla, que es UNIQUE global.
   *
   * Método propio y no parte de `updateChair` porque la regla de negocio es
   * especial (BR-CHAIR-008): sólo es editable si la silla no tiene historial, y
   * quien lo decide es el service. Aquí sólo se traduce la violación de unicidad.
   */
  updateChairCode(chairId: number, code: string, db?: Db): void;
  /** Soft delete de la silla. */
  softDeleteChair(chairId: number, deletedAt: string, db?: Db): void;
  /**
   * Cambia `status` y `status_changed_at` juntos (DESIGN.md 4.3).
   * El service es quien valida la transición contra la máquina de estados antes
   * de llamar; aquí no hay ninguna comprobación de negocio.
   */
  updateChairStatus(chairId: number, status: ChairStatus, statusChangedAt: string, db?: Db): void;
}
