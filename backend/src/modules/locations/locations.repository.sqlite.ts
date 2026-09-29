/**
 * Implementación SQLite del repositorio de sedes.
 *
 * ÚNICO fichero con SQL de `locations` y de los agregados que la sede necesita
 * de `zones` y `chairs` (DESIGN.md 3.2). Todas las consultas van con parámetros
 * `?`: la entrada del cliente NUNCA se concatena en el texto SQL.
 *
 * ============================== TRES DETALLES QUE IMPORTAN =================
 * 1. **Conteos por subconsulta escalar, no por `LEFT JOIN` + `GROUP BY`.** Un
 *    `JOIN` con `chairs` multiplicaría las filas y obligaría a agrupar por todas
 *    las columnas de `locations`; dos escalares correlacionados dan el mismo
 *    número en una consulta legible.
 * 2. **`LIKE` parametrizado y escapado.** `q` viene del cliente: va siempre como
 *    parámetro `?` y además se escapan `%`, `_` y `\`, para que buscar "100%"
 *    no devuelva todo el listado.
 * 3. **Soft delete en todas las lecturas.** `deleted_at IS NULL` en cada
 *    `WHERE` que mira una sede: una sede dada de baja no debe aparecer en el
 *    listado, ni en el detalle, ni en los conteos.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import type {
  LocationListFilter,
  LocationPatch,
  LocationsRepository,
  NewLocationRecord,
} from './locations.repository.js';
import type {
  LocationBookingsCount,
  LocationChairStats,
  LocationCountedRow,
  LocationRow,
  LocationSortColumn,
  LocationZoneCounts,
  LocationZoneRow,
} from './locations.types.js';

/** Columnas base de `locations`. */
const LOCATION_COLUMNS = `
  l.id, l.business_id, l.name, l.address, l.phone,
  l.is_active, l.created_at, l.updated_at
`;

/** Columnas de `zones` para el detalle de la sede. */
const ZONE_COLUMNS = `
  z.id, z.business_id, z.location_id, z.name, z.code, z.color_hex,
  z.capacity, z.sort_order, z.is_active, z.created_at, z.updated_at
`;

/**
 * Allowlist de columnas ordenables: clave = salida de `parseSort`, valor =
 * columna real. Una allowlist por construcción, sin concatenar entrada.
 */
const SORT_SQL: Readonly<Record<LocationSortColumn, string>> = Object.freeze({
  name: 'l.name',
  created_at: 'l.created_at',
  updated_at: 'l.updated_at',
});

/** Traducción de la violación de unicidad del nombre de sede. */
const NAME_TAKEN = {
  code: 'LOCATION_NAME_TAKEN',
  message: 'Ya existe una sede con ese nombre en este negocio',
  field: 'name',
  index: 'ux_locations_business_name',
} as const;

/** Escapa los comodines de `LIKE` en el texto buscado por el cliente. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * Conteos de la sede, como escalares correlacionados.
 *
 * `zones_count` cuenta zonas NO borradas lógicamente y `active_chairs_count`
 * sillas no borradas con `is_active = 1` que pertenecen a una zona no borrada: si
 * la zona está dada de baja, su silla no está en servicio.
 */
const LOCATION_COUNTS_SQL = `
  (SELECT COUNT(*) FROM zones z
    WHERE z.location_id = l.id AND z.deleted_at IS NULL) AS zones_count,
  (SELECT COUNT(*) FROM chairs c
     JOIN zones cz ON cz.id = c.zone_id
    WHERE cz.location_id = l.id
      AND c.deleted_at IS NULL
      AND c.is_active = 1
      AND cz.deleted_at IS NULL) AS active_chairs_count
`;

/** `WHERE` compartido por `list` y `count`. */
function buildWhere(filter: Omit<LocationListFilter, 'limit' | 'offset' | 'sort'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = ['l.business_id = ?', 'l.deleted_at IS NULL'];
  const params: unknown[] = [filter.businessId];

  if (filter.isActive !== undefined) {
    clauses.push('l.is_active = ?');
    params.push(filter.isActive ? 1 : 0);
  }
  if (filter.q !== undefined) {
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push("(l.name LIKE ? ESCAPE '\\' OR l.address LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de sedes sobre `better-sqlite3`. */
export class SqliteLocationsRepository implements LocationsRepository {
  public list(filter: LocationListFilter, db: Db = getConnection()): readonly LocationCountedRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${LOCATION_COLUMNS}, ${LOCATION_COUNTS_SQL}
           FROM locations l
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, l.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as LocationCountedRow[];
  }

  public count(
    filter: Omit<LocationListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM locations l WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findById(id: number, businessId: number, db: Db = getConnection()): LocationCountedRow | null {
    const row = db
      .prepare(
        `SELECT ${LOCATION_COLUMNS}, ${LOCATION_COUNTS_SQL}
           FROM locations l
          WHERE l.id = ?
            AND l.business_id = ?
            AND l.deleted_at IS NULL`,
      )
      .get(id, businessId) as LocationCountedRow | undefined;
    return row ?? null;
  }

  public findByNameIncludingDeleted(
    name: string,
    businessId: number,
    db: Db = getConnection(),
  ): LocationRow | null {
    const row = db
      .prepare(
        `SELECT l.id, l.business_id, l.name, l.address, l.phone,
                l.is_active, l.created_at, l.updated_at
           FROM locations l
          WHERE l.name = ?
            AND l.business_id = ?
          LIMIT 1`,
      )
      .get(name, businessId) as LocationRow | undefined;
    return row ?? null;
  }

  public insert(record: NewLocationRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO locations (business_id, name, address, phone, is_active)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.name,
          record.address,
          record.phone,
          record.isActive ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // `ux_locations_business_name` es la garantía final contra dos sedes con
      // el mismo nombre, aunque dos altas simultáneas esquiven la comprobación
      // previa del service.
      throw translateUniqueConstraint(error, NAME_TAKEN);
    }
  }

  public update(id: number, patch: LocationPatch, db: Db = getConnection()): void {
    // Sólo se escriben los campos presentes: un PATCH parcial no borra el resto.
    // Los nombres de columna salen de esta lista cerrada, nunca del cliente.
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      assignments.push('name = ?');
      params.push(patch.name);
    }
    if (patch.address !== undefined) {
      assignments.push('address = ?');
      params.push(patch.address);
    }
    if (patch.phone !== undefined) {
      assignments.push('phone = ?');
      params.push(patch.phone);
    }
    if (patch.isActive !== undefined) {
      assignments.push('is_active = ?');
      params.push(patch.isActive ? 1 : 0);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(id);
    try {
      db.prepare(`UPDATE locations SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateUniqueConstraint(error, NAME_TAKEN);
    }
  }

  public softDelete(id: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare(
      'UPDATE locations SET deleted_at = ?, is_active = 0 WHERE id = ? AND deleted_at IS NULL',
    ).run(deletedAt, id);
  }

  public listZones(locationId: number, db: Db = getConnection()): readonly LocationZoneRow[] {
    return db
      .prepare(
        `SELECT ${ZONE_COLUMNS},
                COUNT(c.id) AS chair_count,
                COALESCE(SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END), 0) AS available_count
           FROM zones z
           LEFT JOIN chairs c ON c.zone_id = z.id AND c.deleted_at IS NULL AND c.is_active = 1
          WHERE z.location_id = ?
            AND z.deleted_at IS NULL
          GROUP BY z.id
          ORDER BY z.sort_order ASC, z.name ASC, z.id ASC`,
      )
      .all(locationId) as LocationZoneRow[];
  }

  public countZones(locationId: number, db: Db = getConnection()): LocationZoneCounts {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS active
           FROM zones
          WHERE location_id = ?
            AND deleted_at IS NULL`,
      )
      .get(locationId) as { total: number; active: number } | undefined;
    return { total: row?.total ?? 0, active: row?.active ?? 0 };
  }

  public chairStats(locationId: number, db: Db = getConnection()): LocationChairStats {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN c.status = 'AVAILABLE' AND c.is_active = 1 THEN 1 ELSE 0 END), 0) AS available,
                COALESCE(SUM(CASE WHEN c.status = 'OCCUPIED' THEN 1 ELSE 0 END), 0) AS occupied
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE z.location_id = ?
            AND c.deleted_at IS NULL
            AND z.deleted_at IS NULL`,
      )
      .get(locationId) as { total: number; available: number; occupied: number } | undefined;
    return {
      totalChairs: row?.total ?? 0,
      availableChairs: row?.available ?? 0,
      occupiedChairs: row?.occupied ?? 0,
    };
  }

  public countBookings(locationId: number, db: Db = getConnection()): LocationBookingsCount {
    // Un pedido cuenta si no está cancelado ni reembolsado; una reserva si sigue
    // viva (PENDING, CONFIRMED o ACTIVE). Son los estados que "ocupan" la mesa.
    const orders = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM orders
          WHERE location_id = ?
            AND deleted_at IS NULL
            AND status NOT IN ('CANCELLED', 'REFUNDED')`,
      )
      .get(locationId) as { total: number } | undefined;

    const reservations = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM chair_reservations
          WHERE location_id = ?
            AND status IN ('PENDING', 'CONFIRMED', 'ACTIVE')`,
      )
      .get(locationId) as { total: number } | undefined;

    return { orders: orders?.total ?? 0, reservations: reservations?.total ?? 0 };
  }
}
