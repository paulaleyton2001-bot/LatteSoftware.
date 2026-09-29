/**
 * Servicios compartidos por todos los módulos.
 *
 * Ahora mismo hay dos: la auditoría (BR-SEC-007) y las notificaciones
 * (BR-NOTIF-001..005). Se colocan aquí y no en un módulo porque los usan todos:
 * un módulo que necesite otro servicio transversal (correo, push) sigue la
 * misma regla.
 */
export {
  AuditService,
  auditMetaFromRequest,
  sanitizeForAudit,
  type AuditActor,
  type AuditEntryInput,
  type AuditMetaSource,
  type AuditPage,
  type AuditQuery,
  type RequestAuditMeta,
} from './audit.service.js';

export {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationsService,
  type EnqueueNotificationInput,
  type EnqueueNotificationResult,
  type NewNotificationRecord,
  type NotificationData,
  type NotificationDataValue,
  type NotificationPreferencesRecord,
  type NotificationStore,
  type NotificationSuppressionReason,
} from './notifications.service.js';
