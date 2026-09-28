/**
 * Conexión SQLite: **único punto de apertura** de la base de datos.
 *
 * PRAGMAs aplicados al abrir (DESIGN.md 4.0 y sección 8.1):
 *  - `journal_mode = WAL`      lectores concurrentes sin bloquear al escritor.
 *  - `foreign_keys = ON`       en SQLite están apagadas por defecto; sin esto
 *                             todas las FK del esquema serían decorativas.
 *  - `busy_timeout`            espera ante `SQLITE_BUSY` en vez de fallar.
 *  - `synchronous = NORMAL`    equilibrio correcto con WAL.
 *
 * `better-sqlite3` es síncrono y single-threaded: una única instancia por
 * proceso. El UnitOfWork entrega esta misma instancia dentro de la
 * transacción, nunca se abre una segunda conexión por request.
 */
import Database from 'better-sqlite3';

import { env } from '../../config/index.js';
import { logger } from '../logger/index.js';

/** Tipo de la conexión que maneja toda la capa de persistencia. */
export type Db = Database.Database;

let connection: Db | null = null;

/** Ejecuta un PRAGMA y registra su valor efectivo. */
function applyPragma(db: Db, pragma: string): void {
  db.pragma(pragma);
  logger.debug({ pragma }, 'pragma aplicado');
}

/**
 * Abre (o devuelve) la conexión singleton.
 *
 * Idempotente: llamadas posteriores devuelven la misma instancia. Es
 * intencionado, porque abrir dos conexiones al mismo fichero SQLite con WAL
 * multiplica los conflictos de lock.
 */
export function getConnection(): Db {
  if (connection !== null) {
    return connection;
  }

  const db = new Database(env.database.path);

  // WAL: mejora la concurrencia lectura/escritura. Es un PRAGMA que escribe en
  // la cabecera del fichero, por eso va antes que el resto.
  applyPragma(db, 'journal_mode = WAL');
  applyPragma(db, 'foreign_keys = ON');
  applyPragma(db, `busy_timeout = ${env.database.busyTimeoutMs}`);
  applyPragma(db, 'synchronous = NORMAL');

  connection = db;
  logger.info(
    {
      path: env.database.path,
      journalMode: db.pragma('journal_mode', { simple: true }),
      foreignKeys: db.pragma('foreign_keys', { simple: true }),
      busyTimeoutMs: env.database.busyTimeoutMs,
    },
    'conexión SQLite abierta',
  );

  return db;
}

/** `true` si ya hay una conexión abierta. */
export function isConnectionOpen(): boolean {
  return connection !== null && connection.open;
}

/**
 * Cierra la conexión si sigue abierta. Idempotente y seguro de llamar en el
 * apagado ordenado (`SIGTERM`/`SIGINT`) y en los tests.
 */
export function closeConnection(): void {
  if (connection === null) {
    return;
  }
  if (!connection.open) {
    connection = null;
    return;
  }
  try {
    // Nunca se cierra en mitad de una transacción: un cierre con work
    // pendiente haría un rollback silencioso e inconsistente.
    if (connection.inTransaction) {
      logger.warn('se cierra la conexión con una transacción abierta: se hace rollback');
      connection.exec('ROLLBACK');
    }
    // Compacta el WAL para no dejar archivos `-wal` huérfanos tras el apagado.
    try {
      connection.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // El checkpoint es una optimización: si falla, no impide el cierre.
    }
    connection.close();
    logger.info('conexión SQLite cerrada');
  } finally {
    connection = null;
  }
}

/** Sólo para tests: fuerza el estado del singleton. */
export function setConnectionForTests(db: Db | null): void {
  connection = db;
}
