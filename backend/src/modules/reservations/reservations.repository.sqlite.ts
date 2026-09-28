/**
 * Implementación SQLite del repositorio de reservas.
 *
 * ÚNICO fichero del módulo con SQL. Sin lógica de negocio: el service decide qué
 * es un conflicto, cuándo es válido y qué transición de máquina de estados aplica;
 * aquí sólo se ejecutan consultas parametrizadas.
 *
 * ================================ SEGURIDAD ================================
 *  - Cero interpolación de valores: todo parámetro va con `?`. La única
 *    interpolación es la columna de orden, que sale de una allowlist validada
 *    por el middleware `parseSort` (API.md 5.1).
 *  - `business_id = ?` en TODAS las lecturas y escrituras: es el aislamiento
 *    multi-tenant (BR-SEC-008) y sale del token, nunca del cuerpo.
 *
 * ========================= ÍNDICES QUE USA ESTE FICHERO =====================
 *  - `idx_chair_res_overlap_lookup (chair_id, status, start_at, end_at)` y
 *    `idx_res_window (chair_id, start_at, end_at)` sostienen `findOverlapping`.
 *  - `idx_res_status (status, start_at)` sostiene el job de expiración.
 *  - `idx_res_customer (customer_id, start_at)` sostiene el listado de un cliente.
 *
 * ================== POR QUÉ NO HAY UN ÍNDICE ÚNICO POR SILLA ================
 * Existió `ux_chair_res_active (chair_id) WHERE status IN ('CONFIRMED','ACTIVE')`
 * y la migración `0002_fix_chair_reservation_index.sql` lo eliminó: siendo único
 * SÓLO por `chair_id` (la ventana no entra en la condición), impedía que una
 * silla tuviera dos reservas confirmadas aunque no se solaparan, lo que
 * bloqueaba la agenda entera del local. Un índice único de SQLite no puede
 * expresar "único por silla dentro de una ventana".
 *
 * La garantía de no-doble-reserva NO vivía ahí: vive en la transacción
 * (`BEGIN IMMEDIATE`) del service, que llama a `findOverlapping` antes de
 * insertar. Por eso `translateReservationUnique` conserva la rama de `chair_id`
 * como red de seguridad ante una base con el índice viejo aún puesto: si algún
 * despliegue lo mantiene, su violación se expresa igual como 409 de negocio y no
 * como un 500.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { ConflictError } from '../../shared/errors/index.js';
import { CONFLICT_DETAIL_CODE } from '../../shared/errors/codes.js';
import { BLOCKING_RESERVATION_STATUSES } from '../../shared/domain/index.js';
import type { ReservationStatus } from '../../shared/domain/index.js';
import type {
  ChairWindowFilter,
  NewReservation,
  OverdueReservationRow,
  ReservationConflictRow,
  ReservationListFilter,
  ReservationRow,
  ReservationWindow,
  ReservationsRepository,
} from './reservations.repository.js';

/**
 * Marcadores `?` para los estados que bloquean la silla.
 *
 * Es una interpolación de MARCADORES, no de valores: los estados salen de
 * `BLOCKING_RESERVATION_STATUSES` (dominio compartido), nunca del cliente. La
 * lista se declara una vez para que la condición de solapamiento y la de las
 * ventanas no puedan divergir.
 */
const BLOCKING_PLACEHOLDERS = BLOCKING_RESERVATION_STATUSES.map(() => '?').join(', ');
const BLOCKING_PARAMS = [...BLOCKING_RESERVATION_STATUSES];

/** Columnas de la vista de reserva, con los tres JOIN de presentación. */
const RESERVATION_COLUMNS = `
  r.id, r.business_id, r.location_id, r.zone_id, r.chair_id, r.customer_id, r.order_id,
  r.code, r.status, r.start_at, r.end_at, r.duration_minutes,
  r.price_per_hour_minor, r.rental_total_minor,
  r.checked_in_at, r.checked_out_at, r.cancelled_at, r.cancel_reason,
  r.source, r.created_by, r.notes, r.created_at, r.updated_at,
  c.code AS chair_code,
  z.name AS zone_name,
  u.full_name AS customer_name
`;

/** `FROM` con los JOIN de presentación, reutilizado por todos los listados. */
const RESERVATION_FROM = `
  FROM chair_reservations r
  JOIN chairs c  ON c.id = r.chair_id
  JOIN zones  z  ON z.id = r.zone_id
  LEFT JOIN users u ON u.id = r.customer_id
`;

/** Allowlist de columnas ordenables (API.md 5.1). */
const SORT_SQL: Readonly<Record<string, string>> = Object.freeze({
  start_at: 'r.start_at',
  end_at: 'r.end_at',
  created_at: 'r.created_at',
  rental_total_minor: 'r.rental_total_minor',
  status: 'r.status',
  duration_minutes: 'r.duration_minutes',
  code: 'r.code',
});

/**
 * Traduce las dos uniques de `chair_reservations` a 409 con el nombre del
 * contrato.
 *
 * SQLite no da el nombre del índice en el mensaje, sólo las columnas, así que se
 * leen ellas: `chair_id` corresponde a `ux_chair_res_active` (eliminado por
 * `0002_fix_chair_reservation_index.sql`; la rama se conserva como red de
 * seguridad, ver la cabecera) y `code` a la secuencia `RES-`, que sí sigue
 * vigente.
 */
function translateReservationUnique(error: unknown): unknown {
  if (!(error instanceof Error) || !error.message.includes('UNIQUE constraint failed')) {
    return error;
  }
  if (error.message.includes('chair_reservations.chair_id')) {
    return new ConflictError('La silla ya tiene una reserva confirmada o activa', {
      details: { code: CONFLICT_DETAIL_CODE.CHAIR_ALREADY_RESERVED, field: 'chairId' },
      cause: error,
    });
  }
  if (error.message.includes('chair_reservations.code')) {
    return new ConflictError('El código de reserva ya existe', {
      details: { code: 'RESERVATION_CODE_TAKEN', field: 'code' },
      cause: error,
    });
  }
  return new ConflictError('La reserva ya existe con esos datos', {
    details: { code: CONFLICT_DETAIL_CODE.DUPLICATE },
    cause: error,
  });
}

/** `WHERE` de listado, sin paginación ni orden. */
function buildWhere(
  filter: Omit<ReservationListFilter, 'limit' | 'offset' | 'sort'>,
): { readonly sql: string; readonly params: unknown[] } {
  const clauses: string[] = ['r.business_id = ?'];
  const params: unknown[] = [filter.businessId];

  if (filter.from !== undefined) {
    clauses.push('r.end_at > ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('r.start_at < ?');
    params.push(filter.to);
  }
  if (filter.chairId !== undefined) {
    clauses.push('r.chair_id = ?');
    params.push(filter.chairId);
  }
  if (filter.zoneId !== undefined) {
    clauses.push('r.zone_id = ?');
    params.push(filter.zoneId);
  }
  if (filter.locationId !== undefined) {
    clauses.push('r.location_id = ?');
    params.push(filter.locationId);
  }
  if (filter.customerId !== undefined) {
    clauses.push('r.customer_id = ?');
    params.push(filter.customerId);
  }
  if (filter.status !== undefined) {
    clauses.push('r.status = ?');
    params.push(filter.status);
  }
  if (filter.code !== undefined) {
    clauses.push('r.code = ?');
    params.push(filter.code);
  }
  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de reservas sobre `better-sqlite3`. */
export class SqliteReservationsRepository implements ReservationsRepository {
  public findById(reservationId: number, businessId: number, db: Db = getConnection()): ReservationRow | null {
    const row = db
      .prepare(`SELECT ${RESERVATION_COLUMNS} ${RESERVATION_FROM} WHERE r.id = ? AND r.business_id = ? LIMIT 1`)
      .get(reservationId, businessId) as ReservationRow | undefined;
    return row ?? null;
  }

  public findByCode(code: string, businessId: number, db: Db = getConnection()): ReservationRow | null {
    const row = db
      .prepare(`SELECT ${RESERVATION_COLUMNS} ${RESERVATION_FROM} WHERE r.code = ? AND r.business_id = ? LIMIT 1`)
      .get(code, businessId) as ReservationRow | undefined;
    return row ?? null;
  }

  public list(filter: ReservationListFilter, db: Db = getConnection()): readonly ReservationRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column] ?? SORT_SQL['start_at'];
    const rows = db
      .prepare(
        `SELECT ${RESERVATION_COLUMNS}
         ${RESERVATION_FROM}
         WHERE ${where.sql}
         ORDER BY ${column} ${filter.sort.direction}, r.id ${filter.sort.direction}
         LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as ReservationRow[];
    return rows;
  }

  public count(
    filter: Omit<ReservationListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM chair_reservations r WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public countByStatus(
    filter: Omit<ReservationListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): readonly { readonly status: ReservationStatus; readonly total: number }[] {
    const where = buildWhere(filter);
    const rows = db
      .prepare(
        `SELECT r.status AS status, COUNT(*) AS total
           FROM chair_reservations r
          WHERE ${where.sql}
          GROUP BY r.status`,
      )
      .all(...where.params) as { status: ReservationStatus; total: number }[];
    return rows;
  }

  /**
   * BR-RES-002. Ver la cabecera del contrato: la condición de solapamiento es
   * `NOT (end_at <= :startAt OR start_at >= :endAt)` y los estados que bloquean
   * son PENDING, CONFIRMED y ACTIVE.
   */
  public findOverlapping(
    businessId: number,
    chairId: number,
    startAt: string,
    endAt: string,
    excludeReservationId: number | null,
    db: Db = getConnection(),
  ): ReservationConflictRow | null {
    const excludeClause = excludeReservationId === null ? '' : 'AND r.id <> ?';
    const params: unknown[] = [businessId, chairId, ...BLOCKING_PARAMS, startAt, endAt];
    if (excludeReservationId !== null) {
      params.push(excludeReservationId);
    }
    const row = db
      .prepare(
        `SELECT r.id, r.code, r.status, r.start_at, r.end_at
           FROM chair_reservations r
          WHERE r.business_id = ?
            AND r.chair_id = ?
            AND r.status IN (${BLOCKING_PLACEHOLDERS})
            AND NOT (r.end_at <= ? OR r.start_at >= ?)
            ${excludeClause}
          ORDER BY r.start_at ASC
          LIMIT 1`,
      )
      .get(...params) as ReservationConflictRow | undefined;
    return row ?? null;
  }

  public listWindowsForChair(filter: ChairWindowFilter, db: Db = getConnection()): readonly ReservationWindow[] {
    const rows = db
      .prepare(
        `SELECT r.id, r.code, r.status, r.start_at, r.end_at, r.customer_id
           FROM chair_reservations r
          WHERE r.business_id = ?
            AND r.chair_id = ?
            AND r.status IN (${BLOCKING_PLACEHOLDERS})
            AND NOT (r.end_at <= ? OR r.start_at >= ?)
          ORDER BY r.start_at ASC`,
      )
      .all(filter.businessId, filter.chairId, ...BLOCKING_PARAMS, filter.from, filter.to) as {
      id: number;
      code: string;
      status: ReservationStatus;
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

  public listForChair(filter: ChairWindowFilter, db: Db = getConnection()): readonly ReservationRow[] {
    const rows = db
      .prepare(
        `SELECT ${RESERVATION_COLUMNS}
         ${RESERVATION_FROM}
         WHERE r.business_id = ?
           AND r.chair_id = ?
           AND r.end_at > ?
           AND r.start_at < ?
         ORDER BY r.start_at ASC, r.id ASC`,
      )
      .all(filter.businessId, filter.chairId, filter.from, filter.to) as ReservationRow[];
    return rows;
  }

  public findCurrentForChair(businessId: number, chairId: number, at: string, db: Db = getConnection()): ReservationRow | null {
    const row = db
      .prepare(
        `SELECT ${RESERVATION_COLUMNS}
         ${RESERVATION_FROM}
         WHERE r.business_id = ?
           AND r.chair_id = ?
           AND (
             r.status = 'ACTIVE'
             OR (r.status = 'CONFIRMED' AND r.start_at <= ? AND r.end_at > ?)
           )
         ORDER BY r.start_at ASC
         LIMIT 1`,
      )
      .get(businessId, chairId, at, at) as ReservationRow | undefined;
    return row ?? null;
  }

  public findActiveById(reservationId: number, businessId: number, db: Db = getConnection()): ReservationRow | null {
    const row = db
      .prepare(
        `SELECT ${RESERVATION_COLUMNS} ${RESERVATION_FROM} WHERE r.id = ? AND r.business_id = ? AND r.status = 'ACTIVE' LIMIT 1`,
      )
      .get(reservationId, businessId) as ReservationRow | undefined;
    return row ?? null;
  }

  public listBlockingForChair(
    businessId: number,
    chairId: number,
    from: string,
    db: Db = getConnection(),
  ): readonly ReservationWindow[] {
    const rows = db
      .prepare(
        `SELECT r.id, r.code, r.status, r.start_at, r.end_at, r.customer_id
           FROM chair_reservations r
          WHERE r.business_id = ?
            AND r.chair_id = ?
            AND r.status IN (${BLOCKING_PLACEHOLDERS})
            AND r.end_at > ?
          ORDER BY r.start_at ASC`,
      )
      .all(businessId, chairId, ...BLOCKING_PARAMS, from) as {
      id: number;
      code: string;
      status: ReservationStatus;
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

  public countForChair(chairId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COUNT(*) AS total FROM chair_reservations WHERE chair_id = ?')
      .get(chairId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  /**
   * BR-RES-004: un `PENDING` vence si `now > start_at + 30 min` sin check-in y
   * un `CONFIRMED` vence si `now > end_at` sin check-in.
   *
   * `pendingDeadline` es el instante `now - 30 min` que calcula el service con el
   * reloj del dominio: el SQL no lleva `strftime('now')` para que la función sea
   * determinista y testeable con un `now` inyectado.
   */
  public listOverdue(
    businessId: number,
    pendingDeadline: string,
    now: string,
    limit: number,
    db: Db = getConnection(),
  ): readonly OverdueReservationRow[] {
    const rows = db
      .prepare(
        `SELECT id, chair_id, code, status, start_at, end_at
           FROM chair_reservations
          WHERE business_id = ?
            AND (
              (status = 'PENDING'  AND start_at <= ?)
              OR (status = 'CONFIRMED' AND end_at <= ?)
            )
          ORDER BY start_at ASC
          LIMIT ?`,
      )
      .all(businessId, pendingDeadline, now, limit) as OverdueReservationRow[];
    return rows;
  }

  public insert(reservation: NewReservation, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO chair_reservations (
             business_id, location_id, zone_id, chair_id, customer_id, code, status,
             start_at, end_at, duration_minutes, price_per_hour_minor, rental_total_minor,
             source, created_by, notes
           )
           VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          reservation.businessId,
          reservation.locationId,
          reservation.zoneId,
          reservation.chairId,
          reservation.customerId,
          reservation.code,
          reservation.startAt,
          reservation.endAt,
          reservation.durationMinutes,
          reservation.pricePerHourMinor,
          reservation.rentalTotalMinor,
          reservation.source,
          reservation.createdBy,
          reservation.notes,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // En el INSERT sólo puede saltar la unique de `code` (una reserva nace
      // `PENDING` y no la cubre ningún índice de estado): se traducen las dos
      // igual para que una base que conserve `ux_chair_res_active` por el
      // `0002` sin aplicar no produzca un 500.
      throw translateReservationUnique(error);
    }
  }

  public updateStatus(reservationId: number, status: ReservationStatus, db: Db = getConnection()): void {
    try {
      db.prepare('UPDATE chair_reservations SET status = ? WHERE id = ?').run(status, reservationId);
    } catch (error) {
      // El solapamiento lo detecta `findOverlapping` DENTRO de la transacción,
      // antes de esta sentencia (BR-RES-002). Este `catch` cubre la violación
      // del índice único en despliegues que aún no aplicaron el `0002`: es un
      // conflicto de negocio, no un 500.
      throw translateReservationUnique(error);
    }
  }

  /**
   * `CONFIRMED -> ACTIVE`. Estado y `checked_in_at` van en la MISMA sentencia
   * porque el CHECK `ck_chair_reservations_checkin` exige `checked_in_at` cuando
   * `status = 'ACTIVE'`: dos sentencias dejarían un instante (dentro de la
   * transacción, pero visible para cualquier lectura de la misma conexión) en el
   * que la fila viola su propio invariante.
   */
  public markCheckedIn(
    reservationId: number,
    status: ReservationStatus,
    checkedInAt: string,
    db: Db = getConnection(),
  ): void {
    try {
      db.prepare('UPDATE chair_reservations SET status = ?, checked_in_at = ? WHERE id = ?').run(
        status,
        checkedInAt,
        reservationId,
      );
    } catch (error) {
      throw translateReservationUnique(error);
    }
  }

  public markCheckedOut(
    reservationId: number,
    status: ReservationStatus,
    checkedOutAt: string,
    db: Db = getConnection(),
  ): void {
    db.prepare('UPDATE chair_reservations SET status = ?, checked_out_at = ? WHERE id = ?').run(
      status,
      checkedOutAt,
      reservationId,
    );
  }

  public markCancelled(
    reservationId: number,
    status: ReservationStatus,
    cancelledAt: string,
    reason: string,
    db: Db = getConnection(),
  ): void {
    db.prepare(
      'UPDATE chair_reservations SET status = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?',
    ).run(status, cancelledAt, reason, reservationId);
  }

  public updateWindow(
    reservationId: number,
    endAt: string,
    durationMinutes: number,
    rentalTotalMinor: number,
    db: Db = getConnection(),
  ): void {
    db.prepare(
      `UPDATE chair_reservations
          SET end_at = ?, duration_minutes = ?, rental_total_minor = ?
        WHERE id = ?`,
    ).run(endAt, durationMinutes, rentalTotalMinor, reservationId);
  }

  public attachOrder(reservationId: number, orderId: number, db: Db = getConnection()): void {
    db.prepare('UPDATE chair_reservations SET order_id = ? WHERE id = ?').run(orderId, reservationId);
  }
}
