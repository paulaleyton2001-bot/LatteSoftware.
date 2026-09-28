/**
 * Implementación SQLite del repositorio de zonas y sillas.
 *
 * ===================== ÚNICO FICHERO CON SQL DEL MÓDULO ====================
 * Todo el SQL de `zones`, `chairs`, `locations` y los agregados del mapa vive
 * aquí. Los repositorios no contienen reglas de negocio (DESIGN.md 3.2): sólo
 * traducen parámetros a consultas parametrizadas y filas a tipos.
 *
 * ================================ SEGURIDAD ================================
 *  - **Cero interpolación de valores.** Todo dato del usuario va con `?`. La
 *    ÚICA interpolación es la columna de orden, y esa sale de una allowlist
 *    (`SORT_SQL` / `CHAIR_SORT_SQL`) y ya fue validada por el middleware
 *    `parseSort` contra la allowlist del endpoint (API.md 5.1).
 *  - **Aislamiento por negocio.** Toda lectura de sillas y zonas pasa por
 *    `z.business_id`; no existe método que lea una silla sin acotar.
 *
 * ============================ RENDIMIENTO =================================
 *  - El listado de zonas trae `chairCount` y `availableCount` en la MISMA
 *    consulta que las zonas (un `LEFT JOIN` con `GROUP BY`), no en una consulta
 *    por zona: es la diferencia entre 1 y N+1 (DESIGN.md 1.3, criterio 5).
 *  - Los contadores por estado salen de un solo `GROUP BY zone_id, status`.
 *  - `GET /chairs/map` son exactamente DOS consultas (zonas y sillas); el
 *    agrupado por zona y los totales se calculan en el service.
 *  - `idx_chairs_grid (zone_id, grid_y, grid_x)` y `idx_zones_active` cubren los
 *    ordenes por defecto del mapa sin filesort.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import { ConflictError } from '../../shared/errors/index.js';
import { CONFLICT_DETAIL_CODE } from '../../shared/errors/codes.js';
import type { ChairStatus } from '../../shared/domain/index.js';
import type {
  BusinessSpaceSettingsRow,
  ChairListFilter,
  ChairMapFilter,
  ChairRow,
  LocationRow,
  NewChair,
  NewZone,
  SpacesRepository,
  StatusCountRow,
  ZoneListFilter,
  ZoneRow,
  ZoneStatusCountRow,
} from './spaces.repository.js';
import type { ChairPatch, ZonePatch } from './spaces.types.js';

// --------------------------------------------------------------------------
// Allowlists de orden (API.md 5.1: nunca se interpola sin validar)
// --------------------------------------------------------------------------

/** Columnas ordenables de `GET /zones`. */
const ZONE_SORT_SQL: Readonly<Record<string, string>> = Object.freeze({
  sort_order: 'z.sort_order',
  name: 'z.name',
  capacity: 'z.capacity',
  created_at: 'z.created_at',
});

/**
 * Columnas ordenables de `GET /chairs`.
 *
 * `sort_order` no es una columna de `chairs`: el orden en el mapa es el de la
 * zona y luego la posición en la grilla, así que la clave pública `sort_order`
 * se traduce a ese mismo criterio (`idx_chairs_grid` lo cubre).
 */
const CHAIR_SORT_SQL: Readonly<Record<string, string>> = Object.freeze({
  code: 'c.code',
  name: 'c.name',
  capacity: 'c.capacity',
  price_per_hour_minor: 'c.price_per_hour_minor',
  status_changed_at: 'c.status_changed_at',
  created_at: 'c.created_at',
  sort_order: 'z.sort_order, c.grid_y, c.grid_x',
});

// --------------------------------------------------------------------------
// Columnas y WHERE compartidos
// --------------------------------------------------------------------------

const ZONE_COLUMNS = `
  z.id, z.business_id, z.location_id, z.name, z.code, z.color_hex, z.capacity,
  z.sort_order, z.is_active, z.created_at, z.updated_at
`;

const CHAIR_COLUMNS = `
  c.id, c.zone_id, c.code, c.name, c.number_label, c.kind, c.capacity,
  c.price_per_hour_minor, c.status, c.status_changed_at, c.grid_x, c.grid_y,
  c.map_width, c.map_height, c.rotation_deg, c.features, c.notes,
  c.is_bookable, c.is_active, c.created_at, c.updated_at
`;

/** `WHERE` de zonas, sin paginación ni orden. */
function zoneWhere(
  filter: Omit<ZoneListFilter, 'limit' | 'offset' | 'sort'>,
): { readonly sql: string; readonly params: unknown[] } {
  const clauses: string[] = ['z.business_id = ?', 'z.deleted_at IS NULL'];
  const params: unknown[] = [filter.businessId];

  if (filter.locationId !== undefined) {
    clauses.push('z.location_id = ?');
    params.push(filter.locationId);
  }
  if (filter.isActive !== undefined) {
    clauses.push('z.is_active = ?');
    params.push(filter.isActive ? 1 : 0);
  } else if (filter.includeInactive !== true) {
    clauses.push('z.is_active = 1');
  }
  if (filter.q !== undefined) {
    const pattern = `%${filter.q}%`;
    clauses.push('(z.name LIKE ? OR IFNULL(z.code, \'\') LIKE ?)');
    params.push(pattern, pattern);
  }
  return { sql: clauses.join(' AND '), params };
}

/** `WHERE` de sillas, sin paginación ni orden. */
function chairWhere(
  filter: Omit<ChairListFilter, 'limit' | 'offset' | 'sort'>,
): { readonly sql: string; readonly params: unknown[] } {
  // El JOIN con `zones` es lo que aporta `business_id`: sin él no hay aislamiento.
  const clauses: string[] = ['z.business_id = ?', 'z.deleted_at IS NULL', 'c.deleted_at IS NULL'];
  const params: unknown[] = [filter.businessId];

  if (filter.locationId !== undefined) {
    clauses.push('z.location_id = ?');
    params.push(filter.locationId);
  }
  if (filter.zoneId !== undefined) {
    clauses.push('c.zone_id = ?');
    params.push(filter.zoneId);
  }
  if (filter.status !== undefined) {
    clauses.push('c.status = ?');
    params.push(filter.status);
  }
  if (filter.kind !== undefined) {
    clauses.push('c.kind = ?');
    params.push(filter.kind);
  }
  if (filter.isBookable !== undefined) {
    clauses.push('c.is_bookable = ?');
    params.push(filter.isBookable ? 1 : 0);
  }
  if (filter.q !== undefined) {
    const pattern = `%${filter.q}%`;
    clauses.push('(c.code LIKE ? OR IFNULL(c.name, \'\') LIKE ? OR IFNULL(c.number_label, \'\') LIKE ?)');
    params.push(pattern, pattern, pattern);
  }
  if (filter.includeInactive !== true) {
    // BR-CHAIR-004: una silla dada de baja o de zona inactiva no aparece en el
    // mapa ni admite reservas, salvo `includeInactive=true`.
    clauses.push('c.is_active = 1');
    clauses.push('z.is_active = 1');
  }
  return { sql: clauses.join(' AND '), params };
}

/** Zona de SQL interpolada sólo desde las allowlists de arriba. */
function zoneOrderBy(sort: ZoneListFilter['sort']): string {
  const column = ZONE_SORT_SQL[sort.column] ?? ZONE_SORT_SQL['sort_order'];
  return `ORDER BY ${column} ${sort.direction}, z.id ${sort.direction}`;
}

/** Orden de sillas interpolado sólo desde la allowlist de arriba. */
function chairOrderBy(sort: ChairListFilter['sort']): string {
  const column = CHAIR_SORT_SQL[sort.column] ?? CHAIR_SORT_SQL['code'];
  return `ORDER BY ${column} ${sort.direction}, c.id ${sort.direction}`;
}

/**
 * Traduce las dos uniques de `zones` a 409 con su nombre propio.
 *
 * `translateUniqueConstraint` (shared) identifica la restricción por el NOMBRE
 * del índice cuando se le pasa, pero SQLite no lo incluye en el mensaje: sólo
 * lista las columnas (`UNIQUE constraint failed: zones.business_id, zones.code`).
 * Por eso aquí se leen las columnas del mensaje. `zones` tiene dos uniques
 * (`ux_zones_location_name` y `ux_zones_business_code`) y el cliente necesita
 * saber cuál falló para poder señalar el campo.
 */
function translateZoneUnique(error: unknown): unknown {
  if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed')) {
    return error;
  }
  if (error.message.includes('zones.code')) {
    return new ConflictError('Ya existe una zona con ese código en el negocio', {
      details: { code: 'ZONE_CODE_TAKEN', field: 'code' },
      cause: error,
    });
  }
  if (error.message.includes('zones.name')) {
    return new ConflictError('Ya existe una zona con ese nombre en esta sede', {
      details: { code: 'ZONE_NAME_TAKEN', field: 'name' },
      cause: error,
    });
  }
  return new ConflictError('La zona ya existe con esos datos', {
    details: { code: CONFLICT_DETAIL_CODE.DUPLICATE },
    cause: error,
  });
}

// --------------------------------------------------------------------------
// Repositorio
// --------------------------------------------------------------------------

/** Repositorio de zonas y sillas sobre `better-sqlite3`. */
export class SqliteSpacesRepository implements SpacesRepository {
  // --- Contexto -------------------------------------------------------------

  public findBusinessSettings(businessId: number, db: Db = getConnection()): BusinessSpaceSettingsRow | null {
    const row = db
      .prepare(
        `SELECT id, name, currency_code, currency_symbol, max_reservation_minutes,
                chair_default_price_minor, tax_rate_bp, service_fee_bp, tax_inclusive
           FROM businesses
          WHERE id = ?
          LIMIT 1`,
      )
      .get(businessId) as BusinessSpaceSettingsRow | undefined;
    return row ?? null;
  }

  public findLocation(locationId: number, businessId: number, db: Db = getConnection()): LocationRow | null {
    const row = db
      .prepare(
        `SELECT id, business_id, name, is_active
           FROM locations
          WHERE id = ?
            AND business_id = ?
            AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(locationId, businessId) as LocationRow | undefined;
    return row ?? null;
  }

  public listLocations(businessId: number, includeInactive: boolean, db: Db = getConnection()): readonly LocationRow[] {
    const rows = db
      .prepare(
        `SELECT id, business_id, name, is_active
           FROM locations
          WHERE business_id = ?
            AND deleted_at IS NULL
            ${includeInactive ? '' : 'AND is_active = 1'}
          ORDER BY name ASC, id ASC`,
      )
      .all(businessId) as LocationRow[];
    return rows;
  }

  // --- Zonas ----------------------------------------------------------------

  public listZones(filter: ZoneListFilter, db: Db = getConnection()): readonly ZoneRow[] {
    const where = zoneWhere(filter);
    const rows = db
      .prepare(
        `SELECT ${ZONE_COLUMNS},
                l.name AS location_name,
                COUNT(c.id) AS chair_count,
                COALESCE(SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END), 0) AS available_count
           FROM zones z
           JOIN locations l ON l.id = z.location_id
           LEFT JOIN chairs c ON c.zone_id = z.id AND c.deleted_at IS NULL AND c.is_active = 1
          WHERE ${where.sql}
          GROUP BY z.id
          ${zoneOrderBy(filter.sort)}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as ZoneRow[];
    return rows;
  }

  public countZones(
    filter: Omit<ZoneListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = zoneWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM zones z WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findZoneById(zoneId: number, businessId: number, db: Db = getConnection()): ZoneRow | null {
    const row = db
      .prepare(
        `SELECT ${ZONE_COLUMNS},
                l.name AS location_name,
                COUNT(c.id) AS chair_count,
                COALESCE(SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END), 0) AS available_count
           FROM zones z
           JOIN locations l ON l.id = z.location_id
           LEFT JOIN chairs c ON c.zone_id = z.id AND c.deleted_at IS NULL AND c.is_active = 1
          WHERE z.id = ?
            AND z.business_id = ?
            AND z.deleted_at IS NULL
          GROUP BY z.id`,
      )
      .get(zoneId, businessId) as ZoneRow | undefined;
    return row ?? null;
  }

  public findZoneByIdIncludingDeleted(zoneId: number, db: Db = getConnection()): ZoneRow | null {
    const row = db
      .prepare(
        `SELECT ${ZONE_COLUMNS},
                l.name AS location_name,
                0 AS chair_count,
                0 AS available_count
           FROM zones z
           JOIN locations l ON l.id = z.location_id
          WHERE z.id = ?
          LIMIT 1`,
      )
      .get(zoneId) as ZoneRow | undefined;
    return row ?? null;
  }

  public listZoneIdsByLocation(locationId: number, db: Db = getConnection()): readonly number[] {
    const rows = db
      .prepare('SELECT id FROM zones WHERE location_id = ? AND deleted_at IS NULL')
      .all(locationId) as { id: number }[];
    return rows.map((row) => row.id);
  }

  public listZoneStatusCounts(
    businessId: number,
    locationId: number,
    db: Db = getConnection(),
  ): readonly ZoneStatusCountRow[] {
    const rows = db
      .prepare(
        `SELECT c.zone_id AS zone_id, c.status AS status, COUNT(*) AS total
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE z.business_id = ?
            AND z.deleted_at IS NULL
            AND z.location_id = ?
            AND c.deleted_at IS NULL
            AND c.is_active = 1
          GROUP BY c.zone_id, c.status`,
      )
      .all(businessId, locationId) as ZoneStatusCountRow[];
    return rows;
  }

  public nextZoneSortOrder(locationId: number, db: Db = getConnection()): number {
    const row = db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), 0) AS max_sort
           FROM zones
          WHERE location_id = ?
            AND deleted_at IS NULL`,
      )
      .get(locationId) as { max_sort: number } | undefined;
    return (row?.max_sort ?? 0) + 1;
  }

  public insertZone(zone: NewZone, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO zones (business_id, location_id, name, code, color_hex, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          zone.businessId,
          zone.locationId,
          zone.name,
          zone.code,
          zone.colorHex,
          zone.sortOrder,
          zone.isActive ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // `ux_zones_location_name` y `ux_zones_business_code` son dos uniques
      // distintas y el mensaje del driver es lo único que las distingue.
      throw translateZoneUnique(error);
    }
  }

  public updateZone(zoneId: number, patch: ZonePatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      assignments.push('name = ?');
      params.push(patch.name);
    }
    if (patch.code !== undefined) {
      assignments.push('code = ?');
      params.push(patch.code);
    }
    if (patch.colorHex !== undefined) {
      assignments.push('color_hex = ?');
      params.push(patch.colorHex);
    }
    if (patch.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(patch.sortOrder);
    }
    if (patch.isActive !== undefined) {
      assignments.push('is_active = ?');
      params.push(patch.isActive ? 1 : 0);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(zoneId);
    try {
      db.prepare(`UPDATE zones SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateZoneUnique(error);
    }
  }

  public softDeleteZone(zoneId: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare('UPDATE zones SET deleted_at = ?, is_active = 0 WHERE id = ?').run(deletedAt, zoneId);
  }

  public recomputeZoneCapacity(zoneId: number, db: Db = getConnection()): void {
    db.prepare(
      `UPDATE zones
          SET capacity = (
            SELECT COALESCE(SUM(c.capacity), 0)
              FROM chairs c
             WHERE c.zone_id = ?
               AND c.deleted_at IS NULL
               AND c.is_active = 1
          )
        WHERE id = ?`,
    ).run(zoneId, zoneId);
  }

  // --- Sillas ---------------------------------------------------------------

  public listChairs(filter: ChairListFilter, db: Db = getConnection()): readonly ChairRow[] {
    const where = chairWhere(filter);
    const rows = db
      .prepare(
        `SELECT ${CHAIR_COLUMNS},
                z.name AS zone_name,
                z.location_id AS location_id,
                z.business_id AS business_id
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE ${where.sql}
          ${chairOrderBy(filter.sort)}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as ChairRow[];
    return rows;
  }

  public countChairs(
    filter: Omit<ChairListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = chairWhere(filter);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE ${where.sql}`,
      )
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findChairById(chairId: number, businessId: number, db: Db = getConnection()): ChairRow | null {
    const row = db
      .prepare(
        `SELECT ${CHAIR_COLUMNS},
                z.name AS zone_name,
                z.location_id AS location_id,
                z.business_id AS business_id
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE c.id = ?
            AND z.business_id = ?
            AND c.deleted_at IS NULL
            AND z.deleted_at IS NULL
          LIMIT 1`,
      )
      .get(chairId, businessId) as ChairRow | undefined;
    return row ?? null;
  }

  public findChairByCode(code: string, db: Db = getConnection()): ChairRow | null {
    const row = db
      .prepare(
        `SELECT ${CHAIR_COLUMNS},
                z.name AS zone_name,
                z.location_id AS location_id,
                z.business_id AS business_id
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE c.code = ?
          LIMIT 1`,
      )
      .get(code) as ChairRow | undefined;
    return row ?? null;
  }

  public listZonesForMap(filter: ChairMapFilter, db: Db = getConnection()): readonly ZoneRow[] {
    const clauses: string[] = [
      'z.business_id = ?',
      'z.location_id = ?',
      'z.deleted_at IS NULL',
    ];
    const params: unknown[] = [filter.businessId, filter.locationId];
    if (filter.zoneId !== undefined) {
      clauses.push('z.id = ?');
      params.push(filter.zoneId);
    }
    if (filter.includeInactive !== true) {
      clauses.push('z.is_active = 1');
    }
    const rows = db
      .prepare(
        `SELECT ${ZONE_COLUMNS},
                l.name AS location_name,
                COUNT(c.id) AS chair_count,
                COALESCE(SUM(CASE WHEN c.status = 'AVAILABLE' THEN 1 ELSE 0 END), 0) AS available_count
           FROM zones z
           JOIN locations l ON l.id = z.location_id
           LEFT JOIN chairs c
                  ON c.zone_id = z.id
                 AND c.deleted_at IS NULL
                 ${filter.includeInactive === true ? '' : 'AND c.is_active = 1'}
          WHERE ${clauses.join(' AND ')}
          GROUP BY z.id
          ORDER BY z.sort_order ASC, z.id ASC`,
      )
      .all(...params) as ZoneRow[];
    return rows;
  }

  public listChairsForMap(filter: ChairMapFilter, db: Db = getConnection()): readonly ChairRow[] {
    const clauses: string[] = [
      'z.business_id = ?',
      'z.location_id = ?',
      'z.deleted_at IS NULL',
      'c.deleted_at IS NULL',
    ];
    const params: unknown[] = [filter.businessId, filter.locationId];
    if (filter.zoneId !== undefined) {
      clauses.push('c.zone_id = ?');
      params.push(filter.zoneId);
    }
    if (filter.includeInactive !== true) {
      clauses.push('c.is_active = 1');
      clauses.push('z.is_active = 1');
    }
    const rows = db
      .prepare(
        `SELECT ${CHAIR_COLUMNS},
                z.name AS zone_name,
                z.location_id AS location_id,
                z.business_id AS business_id
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE ${clauses.join(' AND ')}
          ORDER BY z.sort_order ASC, c.grid_y ASC, c.grid_x ASC, c.id ASC`,
      )
      .all(...params) as ChairRow[];
    return rows;
  }

  public countChairsByStatus(
    filter: Omit<ChairListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): readonly StatusCountRow[] {
    const where = chairWhere(filter);
    const rows = db
      .prepare(
        `SELECT c.status AS status, COUNT(*) AS total
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE ${where.sql}
          GROUP BY c.status`,
      )
      .all(...where.params) as StatusCountRow[];
    return rows;
  }

  public insertChair(chair: NewChair, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO chairs (
             zone_id, code, name, number_label, kind, capacity, price_per_hour_minor,
             status, status_changed_at, grid_x, grid_y, map_width, map_height,
             rotation_deg, features, notes, is_bookable, is_active
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, 'AVAILABLE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          chair.zoneId,
          chair.code,
          chair.name,
          chair.numberLabel,
          chair.kind,
          chair.capacity,
          chair.pricePerHourMinor,
          chair.statusChangedAt,
          chair.gridX,
          chair.gridY,
          chair.mapWidth,
          chair.mapHeight,
          chair.rotationDeg,
          chair.features.length > 0 ? JSON.stringify(chair.features) : null,
          chair.notes,
          chair.isBookable ? 1 : 0,
          chair.isActive ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // BR-CHAIR-001: `ux_chairs_code` es global y el soft delete NO libera el
      // código, así que una silla dada de baja conserva el suyo para siempre.
      throw translateUniqueConstraint(error, {
        code: 'CHAIR_CODE_TAKEN',
        message: 'Ya existe una silla o mesa con ese código',
        field: 'code',
        index: 'ux_chairs_code',
      });
    }
  }

  public updateChair(chairId: number, patch: ChairPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.zoneId !== undefined) push('zone_id', patch.zoneId);
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.numberLabel !== undefined) push('number_label', patch.numberLabel);
    if (patch.kind !== undefined) push('kind', patch.kind);
    if (patch.capacity !== undefined) push('capacity', patch.capacity);
    if (patch.pricePerHourMinor !== undefined) push('price_per_hour_minor', patch.pricePerHourMinor);
    if (patch.gridX !== undefined) push('grid_x', patch.gridX);
    if (patch.gridY !== undefined) push('grid_y', patch.gridY);
    if (patch.mapWidth !== undefined) push('map_width', patch.mapWidth);
    if (patch.mapHeight !== undefined) push('map_height', patch.mapHeight);
    if (patch.rotationDeg !== undefined) push('rotation_deg', patch.rotationDeg);
    if (patch.features !== undefined) {
      push('features', patch.features.length > 0 ? JSON.stringify(patch.features) : null);
    }
    if (patch.notes !== undefined) push('notes', patch.notes);
    if (patch.isBookable !== undefined) push('is_bookable', patch.isBookable ? 1 : 0);
    if (patch.isActive !== undefined) push('is_active', patch.isActive ? 1 : 0);

    if (assignments.length === 0) {
      return;
    }
    params.push(chairId);
    db.prepare(`UPDATE chairs SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  }

  public updateChairCode(chairId: number, code: string, db: Db = getConnection()): void {
    try {
      db.prepare('UPDATE chairs SET code = ? WHERE id = ?').run(code, chairId);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'CHAIR_CODE_TAKEN',
        message: 'Ya existe una silla o mesa con ese código',
        field: 'code',
        index: 'ux_chairs_code',
      });
    }
  }

  public softDeleteChair(chairId: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare(
      'UPDATE chairs SET deleted_at = ?, is_active = 0, is_bookable = 0 WHERE id = ?',
    ).run(deletedAt, chairId);
  }

  public updateChairStatus(
    chairId: number,
    status: ChairStatus,
    statusChangedAt: string,
    db: Db = getConnection(),
  ): void {
    db.prepare('UPDATE chairs SET status = ?, status_changed_at = ? WHERE id = ?').run(
      status,
      statusChangedAt,
      chairId,
    );
  }
}
