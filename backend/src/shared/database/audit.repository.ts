/**
 * Contrato de persistencia de la auditoría (BR-SEC-007).
 *
 * La interfaz no menciona SQL: es la frontera que usarán el service de
 * auditoría compartido (`shared/services/audit.service.ts`) y, en el futuro,
 * `GET /api/v1/audit-logs`. La implementación SQLite vive en
 * `audit.repository.sqlite.ts`.
 *
 * `audit_logs` es **append-only** (DESIGN.md 4.6): no hay `update` ni `delete`
 * en el contrato, y no debe añadirse ninguno. No se borra historia.
 */
import type { Db } from './connection.js';

/** Acción auditada. Coincide con el CHECK `ck_audit_logs_action`. */
export type AuditActionValue = string;

/** Tipo de entidad auditada. Coincide con el CHECK `ck_audit_logs_entity_type`. */
export type AuditEntityTypeValue = string;

/** Fila a insertar en `audit_logs`. */
export interface AuditLogInsert {
  readonly businessId: number;
  readonly action: AuditActionValue;
  readonly entityType: AuditEntityTypeValue;
  readonly userId: number | null;
  readonly userEmail: string | null;
  /** JSON ya saneado, o `null`. */
  readonly beforeData: string | null;
  /** JSON ya saneado, o `null`. */
  readonly afterData: string | null;
  readonly entityId: number | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

/** Fila leída de `audit_logs`, ya en `camelCase` (mapeo del repositorio). */
export interface AuditLogRow {
  readonly id: number;
  readonly userId: number | null;
  readonly userEmail: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly beforeData: unknown;
  readonly afterData: unknown;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
  readonly createdAt: string;
}

/** Filtros de `list`. Todos opcionales; se combinan con AND. */
export interface AuditLogFilter {
  readonly businessId: number;
  readonly userId?: number;
  readonly action?: string;
  readonly entityType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit: number;
  readonly offset: number;
}

/**
 * Repositorio de auditoría. Un método por llamada: la auditoría se escribe
 * desde el service, normalmente DENTRO de la transacción de negocio, para que
 * el rastro y el hecho occurran o fallen juntos (BR-SEC-007).
 */
export interface AuditRepository {
  /** Inserta una fila de auditoría y devuelve su id. */
  insert(entry: AuditLogInsert, db?: Db): number;
  /** Listado paginado para `GET /api/v1/audit-logs`. */
  list(filter: AuditLogFilter, db?: Db): AuditLogRow[];
  /** Total de filas que satisfacen el filtro, sin paginar. */
  count(filter: Omit<AuditLogFilter, 'limit' | 'offset'>, db?: Db): number;
}
