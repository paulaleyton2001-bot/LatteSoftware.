/**
 * DTOs de dominio del módulo `notifications` (API.md 6.3 y 7.17).
 *
 * Son tipos PUROS: no importan `express`, `zod` ni el driver de base de datos
 * (DESIGN.md 3.2).
 *
 * ============================== ALCANCE =====================================
 * Una notificación PERTENECE a un usuario. Un `CUSTOMER` sólo ve y marca las
 * suyas; el personal puede ver las de cualquier usuario, siempre asking por
 * `userId` de forma explícita. El `userId` de una lectura sale SIEMPRE del token
 * y, si se permite pedir las de otro, se valida contra el rol antes de tocar la
 * base de datos (BR-SEC-011).
 */
import type { NotificationChannel, NotificationStatus, NotificationType } from '../../shared/domain/index.js';
import type { NotificationData } from '../../shared/services/notifications.service.js';

/** Notificación tal y como la expone el contrato (API.md 6.3). */
export interface NotificationView {
  readonly id: number;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly channel: NotificationChannel;
  readonly status: NotificationStatus;
  /** Contenido de `notifications.data` YA PARSEADO. Nunca datos sensibles. */
  readonly data: NotificationData | null;
  readonly orderId: number | null;
  readonly reservationId: number | null;
  readonly readAt: string | null;
  readonly sentAt: string | null;
  readonly createdAt: string;
}

/** Fila cruda de `notifications`. */
export interface NotificationRow {
  readonly id: number;
  readonly user_id: number;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly channel: NotificationChannel;
  readonly status: NotificationStatus;
  readonly data: string | null;
  readonly order_id: number | null;
  readonly reservation_id: number | null;
  readonly read_at: string | null;
  readonly sent_at: string | null;
  readonly created_at: string;
}

/** Preferencias de notificación del usuario (API.md 7.17). */
export interface NotificationPreferencesView {
  readonly inApp: boolean;
  readonly push: boolean;
  readonly email: boolean;
  readonly sms: boolean;
  readonly whatsapp: boolean;
  /** `HH:MM` local del negocio, o `null`. */
  readonly quietHoursFrom: string | null;
  readonly quietHoursTo: string | null;
}

/** Fila cruda de `notification_preferences`. */
export interface NotificationPreferencesRow {
  readonly id: number;
  readonly user_id: number;
  readonly in_app: 0 | 1;
  readonly push: 0 | 1;
  readonly email: 0 | 1;
  readonly sms: 0 | 1;
  readonly whatsapp: 0 | 1;
  readonly quiet_hours_from: string | null;
  readonly quiet_hours_to: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Columnas ordenables de `GET /api/v1/notifications`. */
export type NotificationSortColumn = 'created_at' | 'read_at';

/** Filtros de `GET /api/v1/notifications` (sin `userId`: sale del token). */
export interface NotificationListFilter {
  readonly userId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: { readonly column: NotificationSortColumn; readonly direction: 'ASC' | 'DESC' };
  readonly type?: NotificationType;
  readonly channel?: NotificationChannel;
  readonly status?: NotificationStatus;
  /** Sólo las no leídas (`status <> 'READ'`). */
  readonly unreadOnly?: boolean;
  /** `from`/`to` ISO-8601 sobre `created_at`, inclusive. */
  readonly from?: string;
  readonly to?: string;
}

/** Página de notificaciones. */
export interface NotificationPage {
  readonly items: readonly NotificationView[];
  readonly total: number;
  /** No leídas del usuario, para el badge (se calcula con una agregación). */
  readonly unreadCount: number;
}

/**
 * Conteo de no leídas (API.md 7.17).
 *
 * Se calcula con UNA consulta de agregación (`GROUP BY`), nunca cargando la
 * lista: el badge se repinta cada pocos segundos y traer 200 filas para
 * contarlas sería absurdo.
 */
export interface UnreadCountView {
  readonly total: number;
  readonly byType: Readonly<Record<string, number>>;
  readonly byChannel: Readonly<Record<string, number>>;
}

/** Resultado de `POST /api/v1/notifications/read-all`. */
export interface ReadAllResult {
  readonly updated: number;
  readonly unreadCount: number;
}
