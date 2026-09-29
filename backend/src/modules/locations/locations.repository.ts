/**
 * Contrato de persistencia de las sedes (`locations`).
 *
 * Es una INTERFAZ y no una clase: el service depende de este contrato, nunca de
 * SQLite (DESIGN.md 3.1, regla P3). La implementación vive en
 * `locations.repository.sqlite.ts`, único fichero del módulo con SQL.
 *
 * REGLAS QUE RESPETA:
 *  - Ningún método abre ni cierra transacción: la abre el service.
 *  - `locations` tiene soft delete (`deleted_at`), así que "no existe" y
 *    "existe pero dada de baja" son estados distintos y los métodos los
 *    distinguen (`findById` oculta las dadas de baja;
 *    `findByNameIncludingDeleted` las ve).
 *  - Los conteos de zonas y sillas se resuelven AQUÍ, en una consulta, no
 *    contando filas en el service: es una proyección de la base de datos, no una
 *    regla de negocio (DESIGN.md 3.2).
 *  - Aquí NO hay reglas de negocio: que una sede con zonas activas no se pueda
 *    dar de baja lo decide `locations.service.ts`.
 */
import type { Db } from '../../shared/database/connection.js';
import type {
  LocationBookingsCount,
  LocationChairStats,
  LocationCountedRow,
  LocationRow,
  LocationSortColumn,
  LocationZoneCounts,
  LocationZoneRow,
} from './locations.types.js';

/** Orden ya validado por el middleware `validate`. */
export interface LocationSort {
  readonly column: LocationSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** Campos actualizables de una sede, ya validados por el service. */
export interface LocationPatch {
  readonly name?: string;
  readonly address?: string | null;
  readonly phone?: string | null;
  readonly isActive?: boolean;
}

/** Datos insertados en `locations`. */
export interface NewLocationRecord {
  readonly businessId: number;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly isActive: boolean;
}

/** Filtros de `GET /api/v1/locations`. */
export interface LocationListFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: LocationSort;
  /** Filtro explícito por estado. */
  readonly isActive?: boolean;
  /** `q`: busca por nombre o dirección. `LIKE` siempre parametrizado. */
  readonly q?: string;
}

/** Repositorio de sedes. */
export interface LocationsRepository {
  /** Listado paginado, con los conteos de zonas y sillas resueltos. */
  list(filter: LocationListFilter, db?: Db): readonly LocationCountedRow[];
  /** Total de sedes que satisfacen el filtro. */
  count(filter: Omit<LocationListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Sede por id dentro del negocio. `null` si no existe o está dada de baja. */
  findById(id: number, businessId: number, db?: Db): LocationCountedRow | null;
  /**
   * Sede por nombre dentro del negocio, INCLUDING las dadas de baja. Existe para
   * no reutilizar el nombre de una sede eliminada: el
   * `UNIQUE(business_id, name)` sigue vigente sobre la fila con `deleted_at`.
   */
  findByNameIncludingDeleted(name: string, businessId: number, db?: Db): LocationRow | null;
  /** Inserta la sede y devuelve su id. */
  insert(record: NewLocationRecord, db?: Db): number;
  /** Actualiza sólo los campos presentes. */
  update(id: number, patch: LocationPatch, db?: Db): void;
  /** Marca `deleted_at`. Idempotente. */
  softDelete(id: number, deletedAt: string, db?: Db): void;

  /** Zonas de la sede con los conteos de sillas, para `GET /locations/:id`. */
  listZones(locationId: number, db?: Db): readonly LocationZoneRow[];
  /** Zonas no borradas lógicas, por estado. */
  countZones(locationId: number, db?: Db): LocationZoneCounts;
  /** Sillas de la sede por estado (`AVAILABLE` / `OCCUPIED` / total). */
  chairStats(locationId: number, db?: Db): LocationChairStats;
  /** Pedidos y reservas vivas de la sede. */
  countBookings(locationId: number, db?: Db): LocationBookingsCount;
}
