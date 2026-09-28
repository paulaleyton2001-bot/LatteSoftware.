/**
 * Implementación SQLite del repositorio de alquileres.
 *
 * ÚNICO fichero del módulo con SQL. Sin lógica de negocio: los importes, los
 * minutos y las transiciones los decide el service; aquí sólo consultas.
 *
 * ================================ DINERO ====================================
 * `subtotal_minor`, `extensions_minor`, `extra_minutes_minor` y `total_minor` son
 * `INTEGER` en centavos (P4, BR-MONEY-001). Ni un solo `SUM` devuelve `REAL`: el
 * DDL los declara `INTEGER` y SQLite los mantiene enteros, así que el agregado
 * se puede leer directamente como número sin redondear en el service.
 *
 * ============================ CONCURRENCIA ==================================
 * `ux_chair_rental_active` (un `ACTIVE`/`EXTENDED` por silla) es la garantía
 * DURA de BR-RENTAL-009. El service la consulta antes para dar un 409 legible
 * con el `code` del alquiler que estorba, y aquí se traduce la violación del
 * índice si aun así se cuela alguien: la base de datos siempre tiene la razón.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { ConflictError } from '../../shared/errors/index.js';
import { CONFLICT_DETAIL_CODE } from '../../shared/errors/codes.js';
import { ACTIVE_RENTAL_STATUSES, type RentalStatus } from '../../shared/domain/index.js';
import type {
  ChairWindowFilter,
  NewRental,
  NewRentalExtension,
  RentalChairStats,
  RentalClose,
  RentalExtend,
  RentalExtensionRow,
  RentalListFilter,
  RentalRow,
  RentalWindow,
  RentalsRepository,
} from './rentals.repository.js';

/** Marcadores `?` para los estados que ocupan la silla de forma exclusiva. */
const ACTIVE_PLACEHOLDERS = ACTIVE_RENTAL_STATUSES.map(() => '?').join(', ');
const ACTIVE_PARAMS = [...ACTIVE_RENTAL_STATUSES];

const RENTAL_COLUMNS = `
  t.id, t.business_id, t.chair_id, t.reservation_id, t.customer_id, t.code, t.status,
  t.start_at, t.end_at, t.planned_minutes, t.billed_minutes, t.price_per_hour_minor,
  t.subtotal_minor, t.extensions_minor, t.extra_minutes_minor, t.total_minor,
  t.created_by, t.created_at, t.updated_at,
  c.code AS chair_code,
  z.id AS zone_id,
  z.name AS zone_name,
  z.location_id AS location_id,
  u.full_name AS customer_name
`;

const RENTAL_FROM = `
  FROM chair_rentals t
  JOIN chairs c ON c.id = t.chair_id
  JOIN zones  z ON z.id = c.zone_id
  LEFT JOIN users u ON u.id = t.customer_id
`;

/** Allowlist de columnas ordenables (API.md 5.1). */
const SORT_SQL: Readonly<Record<string, string>> = Object.freeze({
  start_at: 't.start_at',
  end_at: 't.end_at',
  created_at: 't.created_at',
  total_minor: 't.total_minor',
  billed_minutes: 't.billed_minutes',
  code: 't.code',
  status: 't.status',
});

/**
 * Traduce las dos uniques de `chair_rentals` (BR-RENTAL-009 y el `code`).
 *
 * SQLite no incluye el nombre del índice en el mensaje, sólo las columnas
 * (`UNIQUE constraint failed: chair_rentals.chair_id`), así que se leen las
 * columnas: `chair_id` es el índice parcial del alquiler vivo y `code` es la
 * secuencia de negocio. Confundirlas haría que un conflicto real de silla se
 * reportara como un problema de códigos.
 */
function translateRentalUnique(error: unknown): unknown {
  if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed')) {
    return error;
  }
  if (error.message.includes('chair_rentals.chair_id')) {
    return new ConflictError('La silla ya tiene un alquiler abierto', {
      details: { code: 'CHAIR_OCCUPIED', field: 'chairId' },
      cause: error,
    });
  }
  if (error.message.includes('chair_rentals.code')) {
    return new ConflictError('El código de alquiler ya existe', {
      details: { code: 'RENTAL_CODE_TAKEN', field: 'code' },
      cause: error,
    });
  }
  return new ConflictError('El alquiler ya existe con esos datos', {
    details: { code: CONFLICT_DETAIL_CODE.DUPLICATE },
    cause: error,
  });
}

/** `WHERE` de listado, sin paginación ni orden. */
function buildWhere(
  filter: Omit<RentalListFilter, 'limit' | 'offset' | 'sort'>,
): { readonly sql: string; readonly params: unknown[] } {
  const clauses: string[] = ['t.business_id = ?'];
  const params: unknown[] = [filter.businessId];

  if (filter.status !== undefined) {
    clauses.push('t.status = ?');
    params.push(filter.status);
  }
  if (filter.chairId !== undefined) {
    clauses.push('t.chair_id = ?');
    params.push(filter.chairId);
  }
  if (filter.zoneId !== undefined) {
    clauses.push('c.zone_id = ?');
    params.push(filter.zoneId);
  }
  if (filter.locationId !== undefined) {
    clauses.push('z.location_id = ?');
    params.push(filter.locationId);
  }
  if (filter.customerId !== undefined) {
    clauses.push('t.customer_id = ?');
    params.push(filter.customerId);
  }
  if (filter.reservationId !== undefined) {
    clauses.push('t.reservation_id = ?');
    params.push(filter.reservationId);
  }
  if (filter.from !== undefined) {
    clauses.push('t.end_at > ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('t.start_at < ?');
    params.push(filter.to);
  }
  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de alquileres sobre `better-sqlite3`. */
export class SqliteRentalsRepository implements RentalsRepository {
  public findById(rentalId: number, businessId: number, db: Db = getConnection()): RentalRow | null {
    const row = db
      .prepare(`SELECT ${RENTAL_COLUMNS} ${RENTAL_FROM} WHERE t.id = ? AND t.business_id = ? LIMIT 1`)
      .get(rentalId, businessId) as RentalRow | undefined;
    return row ?? null;
  }

  public findByCode(code: string, businessId: number, db: Db = getConnection()): RentalRow | null {
    const row = db
      .prepare(`SELECT ${RENTAL_COLUMNS} ${RENTAL_FROM} WHERE t.code = ? AND t.business_id = ? LIMIT 1`)
      .get(code, businessId) as RentalRow | undefined;
    return row ?? null;
  }

  public list(filter: RentalListFilter, db: Db = getConnection()): readonly RentalRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column] ?? SORT_SQL['start_at'];
    const rows = db
      .prepare(
        `SELECT ${RENTAL_COLUMNS}
         ${RENTAL_FROM}
         WHERE ${where.sql}
         ORDER BY ${column} ${filter.sort.direction}, t.id ${filter.sort.direction}
         LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as RentalRow[];
    return rows;
  }

  public count(
    filter: Omit<RentalListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM chair_rentals t
           JOIN chairs c ON c.id = t.chair_id
           JOIN zones  z ON z.id = c.zone_id
          WHERE ${where.sql}`,
      )
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public countByStatus(
    filter: Omit<RentalListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): readonly { readonly status: RentalStatus; readonly total: number }[] {
    const where = buildWhere(filter);
    const rows = db
      .prepare(
        `SELECT t.status AS status, COUNT(*) AS total
           FROM chair_rentals t
           JOIN chairs c ON c.id = t.chair_id
           JOIN zones  z ON z.id = c.zone_id
          WHERE ${where.sql}
          GROUP BY t.status`,
      )
      .all(...where.params) as { status: RentalStatus; total: number }[];
    return rows;
  }

  public findActiveByChair(businessId: number, chairId: number, db: Db = getConnection()): RentalRow | null {
    const row = db
      .prepare(
        `SELECT ${RENTAL_COLUMNS}
         ${RENTAL_FROM}
         WHERE t.business_id = ?
           AND t.chair_id = ?
           AND t.status IN (${ACTIVE_PLACEHOLDERS})
         ORDER BY t.start_at DESC
         LIMIT 1`,
      )
      .get(businessId, chairId, ...ACTIVE_PARAMS) as RentalRow | undefined;
    return row ?? null;
  }

  public listActive(filter: RentalListFilter, db: Db = getConnection()): readonly RentalRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column] ?? SORT_SQL['start_at'];
    const rows = db
      .prepare(
        `SELECT ${RENTAL_COLUMNS}
         ${RENTAL_FROM}
         WHERE ${where.sql}
           AND t.status IN (${ACTIVE_PLACEHOLDERS})
         ORDER BY ${column} ${filter.sort.direction}, t.id ${filter.sort.direction}
         LIMIT ? OFFSET ?`,
      )
      .all(...where.params, ...ACTIVE_PARAMS, filter.limit, filter.offset) as RentalRow[];
    return rows;
  }

  public listWindowsForChair(filter: ChairWindowFilter, db: Db = getConnection()): readonly RentalWindow[] {
    const rows = db
      .prepare(
        `SELECT t.id, t.code, t.status, t.start_at, t.end_at, t.customer_id
           FROM chair_rentals t
          WHERE t.business_id = ?
            AND t.chair_id = ?
            AND t.end_at > ?
            AND t.start_at < ?
          ORDER BY t.start_at ASC`,
      )
      .all(filter.businessId, filter.chairId, filter.from, filter.to) as {
      id: number;
      code: string;
      status: RentalStatus;
      start_at: string;
      end_at: string;
      customer_id: number | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      status: row.status,
      startAt: row.start_at,
      endAt: row.end_at,
      customerId: row.customer_id,
    }));
  }

  public listForChair(filter: ChairWindowFilter, db: Db = getConnection()): readonly RentalRow[] {
    const rows = db
      .prepare(
        `SELECT ${RENTAL_COLUMNS}
         ${RENTAL_FROM}
         WHERE t.business_id = ?
           AND t.chair_id = ?
           AND t.end_at > ?
           AND t.start_at < ?
         ORDER BY t.start_at ASC, t.id ASC`,
      )
      .all(filter.businessId, filter.chairId, filter.from, filter.to) as RentalRow[];
    return rows;
  }

  public listByReservation(reservationId: number, db: Db = getConnection()): readonly RentalRow[] {
    const rows = db
      .prepare(
        `SELECT ${RENTAL_COLUMNS}
         ${RENTAL_FROM}
         WHERE t.reservation_id = ?
         ORDER BY t.start_at ASC, t.id ASC`,
      )
      .all(reservationId) as RentalRow[];
    return rows;
  }

  public listExtensions(rentalId: number, db: Db = getConnection()): readonly RentalExtensionRow[] {
    const rows = db
      .prepare(
        `SELECT id, rental_id, chair_id, requested_minutes, previous_end_at, new_end_at,
                additional_minor, price_per_hour_minor, reason, created_by, created_at
           FROM chair_rental_extensions
          WHERE rental_id = ?
          ORDER BY created_at ASC, id ASC`,
      )
      .all(rentalId) as RentalExtensionRow[];
    return rows;
  }

  public chairStats(chairId: number, from: string, to: string, db: Db = getConnection()): RentalChairStats {
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(billed_minutes), 0) AS minutes,
                COALESCE(SUM(total_minor), 0)     AS revenue,
                COUNT(*)                         AS sessions
           FROM chair_rentals
          WHERE chair_id = ?
            AND status = 'COMPLETED'
            AND end_at > ?
            AND start_at < ?`,
      )
      .get(chairId, from, to) as { minutes: number; revenue: number; sessions: number } | undefined;
    return {
      minutes: row?.minutes ?? 0,
      revenueMinor: row?.revenue ?? 0,
      sessions: row?.sessions ?? 0,
    };
  }

  public insert(rental: NewRental, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO chair_rentals (
             business_id, chair_id, reservation_id, customer_id, code, status,
             start_at, end_at, planned_minutes, billed_minutes, price_per_hour_minor,
             subtotal_minor, extensions_minor, extra_minutes_minor, total_minor, created_by
           )
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 0, ?, ?, 0, 0, ?, ?)`,
        )
        .run(
          rental.businessId,
          rental.chairId,
          rental.reservationId,
          rental.customerId,
          rental.code,
          rental.startAt,
          rental.endAt,
          rental.plannedMinutes,
          rental.pricePerHourMinor,
          rental.subtotalMinor,
          rental.subtotalMinor,
          rental.createdBy,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // El índice parcial `ux_chair_rental_active` salta aquí si otra conexión
      // abrió un alquiler de la misma silla entre la comprobación y el INSERT.
      throw translateRentalUnique(error);
    }
  }

  public insertExtension(extension: NewRentalExtension, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `INSERT INTO chair_rental_extensions (
           rental_id, chair_id, requested_minutes, previous_end_at, new_end_at,
           additional_minor, price_per_hour_minor, reason, created_by
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        extension.rentalId,
        extension.chairId,
        extension.requestedMinutes,
        extension.previousEndAt,
        extension.newEndAt,
        extension.additionalMinor,
        extension.pricePerHourMinor,
        extension.reason,
        extension.createdBy,
      );
    return Number(result.lastInsertRowid);
  }

  public close(rentalId: number, close: RentalClose, db: Db = getConnection()): void {
    db.prepare(
      `UPDATE chair_rentals
          SET status = ?, billed_minutes = ?, extra_minutes_minor = ?, total_minor = ?
        WHERE id = ?`,
    ).run(close.status, close.billedMinutes, close.extraMinutesMinor, close.totalMinor, rentalId);
  }

  public extend(rentalId: number, extension: RentalExtend, db: Db = getConnection()): void {
    db.prepare(
      `UPDATE chair_rentals
          SET status = ?, end_at = ?, extensions_minor = ?, total_minor = ?
        WHERE id = ?`,
    ).run(extension.status, extension.endAt, extension.extensionsMinor, extension.totalMinor, rentalId);
  }

  public updateStatus(rentalId: number, status: RentalStatus, db: Db = getConnection()): void {
    db.prepare('UPDATE chair_rentals SET status = ? WHERE id = ?').run(status, rentalId);
  }
}
