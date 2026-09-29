/**
 * Implementación SQLite del repositorio de notificaciones.
 *
 * ÚNICO fichero con SQL de `notifications` y `notification_preferences`
 * (DESIGN.md 3.2). Todas las consultas van con parámetros `?`: la entrada del
 * cliente NUNCA se concatena en el texto SQL, y el `user_id` NUNCA viene de un
 * parámetro de la petición: lo inyecta el service con el id del token.
 *
 * ============================== TRES DETALLES QUE IMPORTAN =================
 * 1. **El índice `idx_notifications_unread` es PARCIAL** (`WHERE status <>
 *    'READ'`). Por eso `countUnread` filtra por `status <> 'READ'` y no por
 *    `read_at IS NULL`: son la misma condición y es la que exploitó el índice.
 * 2. **`countUnread` con `GROUP BY`, no cargando la lista.** El badge se repinta
 *    cada pocos segundos: traer 200 filas para contarlas sería absurdo. Una
 *    consulta devuelve `total`, el desglose por tipo y el desglose por canal.
 * 3. **`markRead` filtra por `user_id` en el `WHERE`.** Marcar leída la
 *    notificación de OTRO usuario no debe tocar ninguna fila: el service
 *    convierte ese "0 filas afectadas" en `404` y no se filtra nada sobre la
 *    existencia del recurso ajeno (API.md 2).
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import type {
  NewNotificationPreferencesRecord,
  NotificationPreferencesPatch,
  NotificationPreferencesRecordView,
  NotificationsRepository,
  ReadAllFilter,
} from './notifications.repository.js';
import type {
  NotificationListFilter,
  NotificationRow,
  NotificationSortColumn,
  UnreadCountView,
} from './notifications.types.js';
import type {
  NewNotificationRecord,
  NotificationPreferencesRecord,
} from '../../shared/services/notifications.service.js';

/** Columnas de `notifications`. */
const NOTIFICATION_COLUMNS = `
  id, user_id, type, title, body, channel, status,
  data, order_id, reservation_id, read_at, sent_at, created_at
`;

/** Columnas de `notification_preferences`. */
const PREFERENCES_COLUMNS = `
  id, user_id, in_app, push, email, sms, whatsapp,
  quiet_hours_from, quiet_hours_to, created_at, updated_at
`;

/**
 * Allowlist de columnas ordenables: clave = salida de `parseSort`, valor =
 * columna real. Una allowlist por construcción, sin concatenar entrada.
 */
const SORT_SQL: Readonly<Record<NotificationSortColumn, string>> = Object.freeze({
  created_at: 'created_at',
  read_at: 'read_at',
});

/** Traducción de la violación de unicidad de preferencias (una fila por usuario). */
const PREFS_TAKEN = {
  code: 'NOTIFICATION_PREFERENCES_EXIST',
  message: 'Ya existen preferencias de notificación para este usuario',
  field: 'userId',
  index: 'ux_notification_prefs_user',
} as const;

/** `WHERE` compartido por `list` y `count` (el `userId` siempre va primero). */
function buildWhere(filter: Omit<NotificationListFilter, 'limit' | 'offset' | 'sort'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = ['user_id = ?'];
  const params: unknown[] = [filter.userId];

  if (filter.type !== undefined) {
    clauses.push('type = ?');
    params.push(filter.type);
  }
  if (filter.channel !== undefined) {
    clauses.push('channel = ?');
    params.push(filter.channel);
  }
  if (filter.status !== undefined) {
    clauses.push('status = ?');
    params.push(filter.status);
  }
  if (filter.unreadOnly === true) {
    clauses.push("status <> 'READ'");
  }
  if (filter.from !== undefined) {
    clauses.push('created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('created_at <= ?');
    params.push(filter.to);
  }

  return { sql: clauses.join(' AND '), params };
}

/** `WHERE` de `markAllRead`, siempre acotado al usuario. */
function buildReadAllWhere(filter: ReadAllFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = ['user_id = ?', "status <> 'READ'"];
  const params: unknown[] = [filter.userId];
  if (filter.type !== undefined) {
    clauses.push('type = ?');
    params.push(filter.type);
  }
  if (filter.before !== undefined) {
    clauses.push('created_at <= ?');
    params.push(filter.before);
  }
  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de notificaciones sobre `better-sqlite3`. */
export class SqliteNotificationsRepository implements NotificationsRepository {
  // --- Puerto del servicio compartido (escritura) --------------------------

  public insert(record: NewNotificationRecord, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `INSERT INTO notifications
           (user_id, type, title, body, channel, status, data, order_id, reservation_id, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.userId,
        record.type,
        record.title,
        record.body,
        record.channel,
        record.status,
        record.data,
        record.orderId,
        record.reservationId,
        record.sentAt,
      );
    return Number(result.lastInsertRowid);
  }

  public findPreferences(userId: number, db: Db = getConnection()): NotificationPreferencesRecord | null {
    const row = db
      .prepare(
        `SELECT in_app, push, email, sms, whatsapp, quiet_hours_from, quiet_hours_to
           FROM notification_preferences
          WHERE user_id = ?
          LIMIT 1`,
      )
      .get(userId) as
      | {
          in_app: 0 | 1;
          push: 0 | 1;
          email: 0 | 1;
          sms: 0 | 1;
          whatsapp: 0 | 1;
          quiet_hours_from: string | null;
          quiet_hours_to: string | null;
        }
      | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      inApp: row.in_app === 1,
      push: row.push === 1,
      email: row.email === 1,
      sms: row.sms === 1,
      whatsapp: row.whatsapp === 1,
      quietHoursFrom: row.quiet_hours_from,
      quietHoursTo: row.quiet_hours_to,
    };
  }

  public findBusinessTimezone(businessId: number, db: Db = getConnection()): string | null {
    const row = db
      .prepare('SELECT timezone FROM businesses WHERE id = ? LIMIT 1')
      .get(businessId) as { timezone: string } | undefined;
    return row?.timezone ?? null;
  }

  // --- Lectura de la bandeja ------------------------------------------------

  public list(filter: NotificationListFilter, db: Db = getConnection()): readonly NotificationRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${NOTIFICATION_COLUMNS}
           FROM notifications
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as NotificationRow[];
  }

  public count(
    filter: Omit<NotificationListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM notifications WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  /**
   * No leídas del usuario, agregadas.
   *
   * Tres consultas pequeñas en lugar de una con `UNION`: cada una exploitó un
   * índice distinto y el resultado cabe en la memoria del proceso.
   */
  public countUnread(userId: number, db: Db = getConnection()): UnreadCountView {
    const total = db
      .prepare("SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND status <> 'READ'")
      .get(userId) as { total: number } | undefined;

    const byTypeRows = db
      .prepare(
        `SELECT type, COUNT(*) AS total
           FROM notifications
          WHERE user_id = ? AND status <> 'READ'
          GROUP BY type`,
      )
      .all(userId) as { type: string; total: number }[];

    const byChannelRows = db
      .prepare(
        `SELECT channel, COUNT(*) AS total
           FROM notifications
          WHERE user_id = ? AND status <> 'READ'
          GROUP BY channel`,
      )
      .all(userId) as { channel: string; total: number }[];

    return {
      total: total?.total ?? 0,
      byType: Object.fromEntries(byTypeRows.map((row) => [row.type, row.total])),
      byChannel: Object.fromEntries(byChannelRows.map((row) => [row.channel, row.total])),
    };
  }

  public findByIdForUser(id: number, userId: number, db: Db = getConnection()): NotificationRow | null {
    const row = db
      .prepare(
        `SELECT ${NOTIFICATION_COLUMNS}
           FROM notifications
          WHERE id = ?
            AND user_id = ?
          LIMIT 1`,
      )
      .get(id, userId) as NotificationRow | undefined;
    return row ?? null;
  }

  public markRead(id: number, userId: number, readAt: string, db: Db = getConnection()): boolean {
    // `status <> 'READ'` hace la operación idempotente (BR-NOTIF-004): repetirla
    // no escribe nada y devuelve `false`, y el service responde 200 igual.
    const result = db
      .prepare(
        `UPDATE notifications
            SET status = 'READ', read_at = ?
          WHERE id = ?
            AND user_id = ?
            AND status <> 'READ'`,
      )
      .run(readAt, id, userId);
    return result.changes > 0;
  }

  public markAllRead(filter: ReadAllFilter, readAt: string, db: Db = getConnection()): number {
    const where = buildReadAllWhere(filter);
    const result = db
      .prepare(
        `UPDATE notifications
            SET status = 'READ', read_at = ?
          WHERE ${where.sql}`,
      )
      .run(readAt, ...where.params);
    return result.changes;
  }

  // --- Preferencias ---------------------------------------------------------

  public findPreferencesRow(
    userId: number,
    db: Db = getConnection(),
  ): NotificationPreferencesRecordView | null {
    const row = db
      .prepare(`SELECT ${PREFERENCES_COLUMNS} FROM notification_preferences WHERE user_id = ? LIMIT 1`)
      .get(userId) as
      | {
          id: number;
          user_id: number;
          in_app: 0 | 1;
          push: 0 | 1;
          email: 0 | 1;
          sms: 0 | 1;
          whatsapp: 0 | 1;
          quiet_hours_from: string | null;
          quiet_hours_to: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: row.id,
      userId: row.user_id,
      inApp: row.in_app === 1,
      push: row.push === 1,
      email: row.email === 1,
      sms: row.sms === 1,
      whatsapp: row.whatsapp === 1,
      quietHoursFrom: row.quiet_hours_from,
      quietHoursTo: row.quiet_hours_to,
    };
  }

  public insertPreferences(record: NewNotificationPreferencesRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO notification_preferences
             (user_id, in_app, push, email, sms, whatsapp, quiet_hours_from, quiet_hours_to)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.userId,
          record.inApp ? 1 : 0,
          record.push ? 1 : 0,
          record.email ? 1 : 0,
          record.sms ? 1 : 0,
          record.whatsapp ? 1 : 0,
          record.quietHoursFrom,
          record.quietHoursTo,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // `ux_notification_prefs_user` es la garantía final de "una fila por
      // usuario" aunque dos peticiones simultáneas la intenten a la vez.
      throw translateUniqueConstraint(error, PREFS_TAKEN);
    }
  }

  public updatePreferences(
    userId: number,
    patch: NotificationPreferencesPatch,
    db: Db = getConnection(),
  ): void {
    // Sólo se escriben los campos presentes: un PUT parcial no borra el resto.
    // Los nombres de columna salen de esta lista cerrada, nunca del cliente.
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.inApp !== undefined) {
      assignments.push('in_app = ?');
      params.push(patch.inApp ? 1 : 0);
    }
    if (patch.push !== undefined) {
      assignments.push('push = ?');
      params.push(patch.push ? 1 : 0);
    }
    if (patch.email !== undefined) {
      assignments.push('email = ?');
      params.push(patch.email ? 1 : 0);
    }
    if (patch.sms !== undefined) {
      assignments.push('sms = ?');
      params.push(patch.sms ? 1 : 0);
    }
    if (patch.whatsapp !== undefined) {
      assignments.push('whatsapp = ?');
      params.push(patch.whatsapp ? 1 : 0);
    }
    if (patch.quietHoursFrom !== undefined) {
      assignments.push('quiet_hours_from = ?');
      params.push(patch.quietHoursFrom);
    }
    if (patch.quietHoursTo !== undefined) {
      assignments.push('quiet_hours_to = ?');
      params.push(patch.quietHoursTo);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(userId);
    db.prepare(
      `UPDATE notification_preferences SET ${assignments.join(', ')} WHERE user_id = ?`,
    ).run(...params);
  }
}
