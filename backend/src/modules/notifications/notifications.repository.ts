/**
 * Contrato de persistencia de notificaciones y preferencias.
 *
 * Es una INTERFAZ y no una clase: los services dependen de este contrato, nunca
 * de SQLite (DESIGN.md 3.1, regla P3). La implementación vive en
 * `notifications.repository.sqlite.ts`, único fichero del módulo con SQL.
 *
 * ============================== POR QUÉ DOS SERVICIOS ========================
 * La escritura (encolar) y la lectura (bandeja) son el mismo agregado pero
 * consumedores DISTINTOS:
 *  - `shared/services/notifications.service.ts` (`NotificationsService`) lo
 *    escriben pedidos, reservas y pagos. Necesita sólo tres operaciones y las
 *    declara en su propio puerto {@link NotificationStore}, para que
 *    `shared/` no dependa de `modules/`.
 *  - `notifications.service.ts` (`NotificationsInboxService`) publica los
 *    endpoints: lista, marca leída y preferencias.
 * Este contrato ESCRIBE el puerto del servicio compartido: la única
 * implementación satisface a los dos, así que hay un solo `INSERT` en el
 * sistema y una sola definición de la política de canales.
 *
 * REGLAS QUE RESPETA:
 *  - Ningún método abre ni cierra transacción: la abre el service.
 *  - `markRead` y `markAllRead` llevan SIEMPRE el `userId` del actor: el
 *    alcance lo resuelve el service y el repositorio, nunca un parámetro suelto
 *    del cliente.
 */
import type { Db } from '../../shared/database/connection.js';
import type { NotificationStore } from '../../shared/services/notifications.service.js';
import type {
  NotificationListFilter,
  NotificationRow,
  NotificationSortColumn,
  UnreadCountView,
} from './notifications.types.js';

export type { NotificationListFilter, NotificationSortColumn };

/** Datos insertados en `notification_preferences`. */
export interface NewNotificationPreferencesRecord {
  readonly userId: number;
  readonly inApp: boolean;
  readonly push: boolean;
  readonly email: boolean;
  readonly sms: boolean;
  readonly whatsapp: boolean;
  readonly quietHoursFrom: string | null;
  readonly quietHoursTo: string | null;
}

/** Campos actualizables de las preferencias. */
export interface NotificationPreferencesPatch {
  readonly inApp?: boolean;
  readonly push?: boolean;
  readonly email?: boolean;
  readonly sms?: boolean;
  readonly whatsapp?: boolean;
  readonly quietHoursFrom?: string | null;
  readonly quietHoursTo?: string | null;
}

/** Filtros de `POST /read-all` (opcionales). */
export interface ReadAllFilter {
  readonly userId: number;
  /** Sólo de este tipo. */
  readonly type?: string;
  /** Sólo las creadas antes de este instante ISO-8601. */
  readonly before?: string;
}

/** Fila de `notification_preferences` leída. */
export interface NotificationPreferencesRecordView {
  readonly id: number;
  readonly userId: number;
  readonly inApp: boolean;
  readonly push: boolean;
  readonly email: boolean;
  readonly sms: boolean;
  readonly whatsapp: boolean;
  readonly quietHoursFrom: string | null;
  readonly quietHoursTo: string | null;
}

/**
 * Repositorio de notificaciones.
 *
 * Implementa el puerto {@link NotificationStore} del servicio COMPARTIDO: los
 * módulos de pedidos y reservas dependen de `shared/services`, no de este
 * fichero, pero la fila que escriben acaba aquí.
 */
export interface NotificationsRepository extends NotificationStore {
  /** Listado paginado del usuario, con el filtro ya resuelto. */
  list(filter: NotificationListFilter, db?: Db): readonly NotificationRow[];
  /** Total de notificaciones que satisfacen el filtro. */
  count(filter: Omit<NotificationListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;

  /**
   * No leídas del usuario, agregadas por tipo y por canal.
   * Una sola consulta con `GROUP BY`: es lo que se pinta en el badge.
   */
  countUnread(userId: number, db?: Db): UnreadCountView;

  /** Notificación por id **del usuario indicado**. `null` si no es suya o no existe. */
  findByIdForUser(id: number, userId: number, db?: Db): NotificationRow | null;

  /**
   * Marca como leída. Devuelve `true` si ha cambiado algo, `false` si ya estaba
   * leída (BR-NOTIF-004, idempotencia).
   */
  markRead(id: number, userId: number, readAt: string, db?: Db): boolean;

  /** Marca leídas las notificaciones del usuario que aún no lo estaban. */
  markAllRead(filter: ReadAllFilter, readAt: string, db?: Db): number;

  /** Preferencia del usuario, o `null` si todavía no tiene fila. */
  findPreferencesRow(userId: number, db?: Db): NotificationPreferencesRecordView | null;

  /** Crea la fila de preferencias con los valores por defecto (BR-NOTIF-005). */
  insertPreferences(record: NewNotificationPreferencesRecord, db?: Db): number;

  /** Actualiza sólo los campos presentes de las preferencias. */
  updatePreferences(userId: number, patch: NotificationPreferencesPatch, db?: Db): void;
}
