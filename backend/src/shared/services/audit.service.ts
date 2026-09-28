/**
 * SERVICIO DE AUDITORÍA COMPARTIDO (BR-SEC-007).
 *
 * ============================== POR QUÉ ESTÁ AQUÍ ==============================
 * La auditoría no pertenece a ningún módulo: la escriben TODOS (auth, users,
 * customers y, en el futuro, orders, payments, inventory...). Por eso vive en
 * `shared/services/` y no dentro de `modules/auth/`. Un módulo que necesite
 * registrar algo importa este servicio del contenedor; nunca reimplementa el
 * `INSERT`.
 *
 * ================================ GARANTÍAS ===================================
 * 1. **Nunca se registra un secreto.** `before_data` y `after_data` pasan por
 *    {@link sanitizeForAudit}, que sustituye por `[REDACTED]` cualquier clave
 *    que parezca una credencial (password, token, hash, cvv, cookie...). La
 *    lista de claves de `shared/logger/index.ts` cubre los logs de aplicación;
 *    esta cubre el `audit_logs`, que es un requisito de negocio y persiste
 *    aunque el nivel de log esté en `silent`.
 * 2. **Nunca lanza.** Un fallo de auditoría no puede tumbar la operación de
 *    negocio que la provoca: se registra como `warn` en el log del servidor y se
 *    sigue. La escritura de auditoría va DENTRO de la transacción de negocio
 *    cuando importa (BR-SEC-007); si esa escritura falla, la transacción ya ha
 *    fallado también.
 * 3. **Sin SQL.** El service sólo conoce {@link AuditRepository}; el SQL está
 *    en `shared/database/audit.repository.sqlite.ts`.
 *
 * Uso típico desde un service:
 *
 * ```ts
 * this.audit.record({
 *   action: AuditAction.UPDATE,
 *   entityType: 'user',
 *   entityId: user.id,
 *   actor,
 *   request: meta,
 *   beforeData: before,
 *   afterData: { ...after, password_hash: undefined },  // sanean igual
 * });
 * ```
 */
import { AUDIT } from '../../config/index.js';
import type { AuditAction, AuditEntityType } from '../domain/index.js';
import type { AuditLogFilter, AuditLogRow, AuditRepository } from '../database/audit.repository.js';
import { logger } from '../logger/index.js';

/** Datos de red de la petición, para la traza del audit log. */
export interface RequestAuditMeta {
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly requestId: string | null;
}

/** Actor que escribe. `null` para eventos sin actor (registro, login fallido). */
export interface AuditActor {
  readonly id: number | null;
  readonly email: string | null;
  /** `businessId` del actor. Sale del token (BR-SEC-008). */
  readonly businessId: number | null;
}

/** Entrada de auditoría de alto nivel, ya en el vocabulario del dominio. */
export interface AuditEntryInput {
  readonly action: AuditAction;
  readonly entityType: AuditEntityType;
  readonly entityId?: number | null;
  readonly actor?: AuditActor | null;
  readonly request?: RequestAuditMeta | null;
  readonly beforeData?: unknown;
  readonly afterData?: unknown;
  /**
   * `businessId` explícito. Sólo para eventos sin actor (p. ej. el alta de un
   * cliente nuevo, que aún no tiene token). Si falta se usa el del actor y, en
   * último caso, el negocio por defecto.
   */
  readonly businessId?: number;
}

/** Longitud máxima de `ip_address` y `user_agent` (columnas TEXT acotadas). */
const MAX_META_LENGTH = 255;

/**
 * Recorta un valor de metadatos a la longitud de la columna.
 * Nunca lanza: un valor no textual se descarta.
 */
function clip(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }
  return value.length > MAX_META_LENGTH ? value.slice(0, MAX_META_LENGTH) : value;
}

/**
 * Sanea un valor para escribirlo en `before_data` / `after_data`.
 *
 * - Sustituye por `[REDACTED]` cualquier clave sensible, a cualquier nivel.
 * - Conserva la forma (objetos, arrays, escalares) para que la UI pueda
 *   dibujar el diff.
 * - Corta la recursión a `MAX_SANITIZE_DEPTH` y convierte lo que sea circular
 *   en `"[UNSERIALIZABLE]"`.
 */
export function sanitizeForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (depth > AUDIT.MAX_SANITIZE_DEPTH) {
    return '[TRUNCADO]';
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForAudit(item, depth + 1));
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = AUDIT.SENSITIVE_KEY_PATTERN.test(key)
        ? AUDIT.REDACTED
        : sanitizeForAudit(item, depth + 1);
    }
    return result;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

/** Serializa un valor saneado, o `null` si no hay nada que escribir. */
function toJsonColumn(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  try {
    return JSON.stringify(sanitizeForAudit(value));
  } catch (error) {
    // Un valor no serializable no puede romper la operación que se audita.
    logger.warn({ error }, 'auditoría: el snapshot no es serializable');
    return JSON.stringify('[UNSERIALIZABLE]');
  }
}

/**
 * Filtros de listado, en el vocabulario del dominio.
 * `businessId` es obligatorio: el audit log nunca se consulta sin acotar al
 * negocio del actor (BR-SEC-008).
 */
export interface AuditQuery {
  readonly businessId: number;
  readonly userId?: number;
  readonly action?: string;
  readonly entityType?: string;
  readonly from?: string;
  readonly to?: string;
  readonly page: number;
  readonly pageSize: number;
}

/** Página de registros de auditoría. */
export interface AuditPage {
  readonly items: readonly AuditLogRow[];
  readonly total: number;
}

/**
 * Lector de contexto de petición para los services.
 *
 * Tipo ESTRUCTURAL a propósito: el servicio no importa `express` (P2), así que
 * cualquier objeto con `ip`, `headers` y `res.locals.requestId` le sirve. Lo
 * usan los controllers, que sí conocen Express.
 */
export interface AuditMetaSource {
  readonly ip?: string | undefined;
  readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly res?: unknown;
}

/** Extrae IP, user agent y requestId de una petición. */
export function auditMetaFromRequest(req: AuditMetaSource): RequestAuditMeta {
  const rawUserAgent = req.headers?.['user-agent'];
  const userAgent = Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent;

  return {
    ipAddress: clip(req.ip),
    userAgent: clip(typeof userAgent === 'string' ? userAgent : null),
    requestId: readRequestId(req.res),
  };
}

/** Lee `res.locals.requestId` sin depender del tipo `Response` de Express. */
function readRequestId(res: unknown): string | null {
  if (typeof res !== 'object' || res === null || !('locals' in res)) {
    return null;
  }
  const locals: unknown = (res as { locals: unknown }).locals;
  if (typeof locals !== 'object' || locals === null || !('requestId' in locals)) {
    return null;
  }
  const value: unknown = (locals as { requestId: unknown }).requestId;
  return typeof value === 'string' && value.length > 0 ? clip(value) : null;
}

/**
 * Servicio de auditoría. Una instancia por proceso, construida en
 * `config/container.ts` e inyectada por constructor en los services.
 */
export class AuditService {
  public constructor(
    private readonly repository: AuditRepository,
    /** `businessId` usado cuando el evento no tiene actor. */
    private readonly defaultBusinessId: number,
  ) {}

  /**
   * Escribe una entrada de auditoría.
   *
   * NUNCA lanza: un `audit_logs` caído no puede impedir un login correcto ni un
   * cambio de contraseña válido. El error se ve en el log del servidor.
   *
   * @returns El id de la fila escrita, o `null` si no se pudo escribir.
   */
  public record(input: AuditEntryInput): number | null {
    try {
      const businessId =
        input.businessId ?? input.actor?.businessId ?? this.defaultBusinessId;
      return this.repository.insert({
        businessId,
        action: input.action,
        entityType: input.entityType,
        userId: input.actor?.id ?? null,
        userEmail: input.actor?.email ?? null,
        entityId: input.entityId ?? null,
        beforeData: toJsonColumn(input.beforeData),
        afterData: toJsonColumn(input.afterData),
        ipAddress: input.request?.ipAddress ?? null,
        userAgent: input.request?.userAgent ?? null,
        requestId: input.request?.requestId ?? null,
      });
    } catch (error) {
      logger.warn(
        { error, action: input.action, entityType: input.entityType, entityId: input.entityId },
        'auditoría: no se pudo escribir la entrada (la operación sigue adelante)',
      );
      return null;
    }
  }

  /** Listado paginado. Lo usará `GET /api/v1/audit-logs` (`audit:read`). */
  public list(query: AuditQuery): AuditPage {
    const filter: AuditLogFilter = {
      businessId: query.businessId,
      ...(query.userId === undefined ? {} : { userId: query.userId }),
      ...(query.action === undefined ? {} : { action: query.action }),
      ...(query.entityType === undefined ? {} : { entityType: query.entityType }),
      ...(query.from === undefined ? {} : { from: query.from }),
      ...(query.to === undefined ? {} : { to: query.to }),
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    };
    const items = this.repository.list(filter);
    const total = this.repository.count(filter);
    return { items, total };
  }
}
