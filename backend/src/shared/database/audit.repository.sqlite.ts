/**
 * Implementación SQLite del repositorio de auditoría.
 *
 * ÚNICO fichero de este módulo que contiene SQL. Todas las consultas usan
 * parámetros (?): nunca concatenación. El `ORDER BY created_at DESC, id DESC`
 * da un orden estable, requisito de paginación sin duplicados (API.md 5.1).
 */
import { getConnection, type Db } from './connection.js';
import type {
  AuditLogFilter,
  AuditLogInsert,
  AuditLogRow,
  AuditRepository,
} from './audit.repository.js';

/** Columnas de la vista, en el orden del contrato. */
const SELECT_COLUMNS = `
  id, user_id, user_email, action, entity_type, entity_id,
  before_data, after_data, ip_address, user_agent, request_id, created_at
`;

/** Fila cruda tal como la devuelve `better-sqlite3` (snake_case). */
interface RawAuditRow {
  readonly id: number;
  readonly user_id: number | null;
  readonly user_email: string | null;
  readonly action: string;
  readonly entity_type: string;
  readonly entity_id: number | null;
  readonly before_data: string | null;
  readonly after_data: string | null;
  readonly ip_address: string | null;
  readonly user_agent: string | null;
  readonly request_id: string | null;
  readonly created_at: string;
}

/** Convierte una fila cruda en el DTO camelCase del dominio. */
function toRow(raw: RawAuditRow): AuditLogRow {
  return {
    id: raw.id,
    userId: raw.user_id,
    userEmail: raw.user_email,
    action: raw.action,
    entityType: raw.entity_type,
    entityId: raw.entity_id,
    beforeData: parseJson(raw.before_data),
    afterData: parseJson(raw.after_data),
    ipAddress: raw.ip_address,
    userAgent: raw.user_agent,
    requestId: raw.request_id,
    createdAt: raw.created_at,
  };
}

/** `json_valid` ya lo garantiza el CHECK de la tabla; un `null` es `null`. */
function parseJson(value: string | null): unknown {
  if (value === null) {
    return null;
  }
  return JSON.parse(value) as unknown;
}

/**
 * Construye la cláusula `WHERE` compartida por `list` y `count`.
 * Devuelve el SQL y los parámetros en el orden en que aparecen.
 */
function buildWhere(filter: {
  readonly businessId: number;
  readonly userId?: number;
  readonly action?: string;
  readonly entityType?: string;
  readonly from?: string;
  readonly to?: string;
}): { sql: string; params: readonly unknown[] } {
  const clauses: string[] = ['business_id = ?'];
  const params: unknown[] = [filter.businessId];

  if (filter.userId !== undefined) {
    clauses.push('user_id = ?');
    params.push(filter.userId);
  }
  if (filter.action !== undefined) {
    clauses.push('action = ?');
    params.push(filter.action);
  }
  if (filter.entityType !== undefined) {
    clauses.push('entity_type = ?');
    params.push(filter.entityType);
  }
  if (filter.from !== undefined) {
    clauses.push('created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('created_at < ?');
    params.push(filter.to);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de auditoría sobre `better-sqlite3`. */
export class SqliteAuditRepository implements AuditRepository {
  public insert(entry: AuditLogInsert, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `INSERT INTO audit_logs
           (business_id, user_id, user_email, action, entity_type, entity_id,
            before_data, after_data, ip_address, user_agent, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.businessId,
        entry.userId,
        entry.userEmail,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.beforeData,
        entry.afterData,
        entry.ipAddress,
        entry.userAgent,
        entry.requestId,
      );
    return Number(result.lastInsertRowid);
  }

  public list(filter: AuditLogFilter, db: Db = getConnection()): AuditLogRow[] {
    const where = buildWhere(filter);
    const rows = db
      .prepare(
        `SELECT ${SELECT_COLUMNS}
           FROM audit_logs
          WHERE ${where.sql}
          ORDER BY created_at DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as RawAuditRow[];
    return rows.map(toRow);
  }

  public count(filter: Omit<AuditLogFilter, 'limit' | 'offset'>, db: Db = getConnection()): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM audit_logs WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}
