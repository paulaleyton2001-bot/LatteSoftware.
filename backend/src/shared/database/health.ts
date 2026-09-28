/**
 * Sonda de salud de la base de datos.
 *
 * `GET /api/v1/health` responde 503 y nunca 500 cuando la base de datos no
 * responde: un fallo de dependencia es `SERVICE_UNAVAILABLE` (API.md 7.19).
 * Aquí no se filtra ruta, DSN ni mensaje de SQLite al cliente.
 */
import { getConnection, isConnectionOpen } from './connection.js';
import { countPending, ensureMigrationsTable } from './migrator.js';

/** Estado de la comprobación de la base de datos. */
export type CheckStatus = 'ok' | 'degraded' | 'down';

/** Resultado de la sonda. EsSerializable: no contiene datos del sistema. */
export interface DatabaseHealth {
  readonly connected: boolean;
  readonly migrationsPending: number;
  readonly check: CheckStatus;
  /** Motivo interno: sólo para el log, nunca para la respuesta. */
  readonly reason?: string;
}

/** Ejecuta `SELECT 1` y devuelve `ok` si responde. */
export function pingDatabase(): CheckStatus {
  try {
    const db = getConnection();
    const row = db.prepare('SELECT 1 AS ok').get() as { ok?: number } | undefined;
    return row?.ok === 1 ? 'ok' : 'degraded';
  } catch {
    return 'down';
  }
}

/**
 * Sonda completa: conexión + integridad del historial de migraciones.
 * Nunca lanza: un fallo se reporta en el resultado.
 */
export function checkDatabaseHealth(): DatabaseHealth {
  try {
    if (!isConnectionOpen()) {
      getConnection();
    }
    const status = pingDatabase();
    if (status !== 'ok') {
      return { connected: false, migrationsPending: 0, check: status, reason: 'PING_FAILED' };
    }
    const db = getConnection();
    ensureMigrationsTable(db);
    return { connected: true, migrationsPending: countPending(), check: 'ok' };
  } catch (error) {
    return {
      connected: false,
      migrationsPending: 0,
      check: 'down',
      reason: error instanceof Error ? error.message : 'UNKNOWN',
    };
  }
}
