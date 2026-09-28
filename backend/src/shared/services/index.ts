/**
 * Servicios compartidos por todos los módulos.
 *
 * Ahora mismo sólo hay uno: la auditoría (BR-SEC-007). Se coloca aquí y no en
 * un módulo porque la usan todos; un módulo que necesite otro servicio
 * transversal (notificaciones, correo) sigue la misma regla.
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
