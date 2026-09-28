/**
 * Unidad de trabajo (Unit of Work) sobre `better-sqlite3`.
 *
 * ============================ CONTRATO =============================
 * `runInTransaction(fn)` envuelve la ejecución en `BEGIN IMMEDIATE`,
 * confirma con `COMMIT` y revierte con `ROLLBACK` si `fn` lanza. Las llamadas
 * anidadas reutilizan la transacción abierta mediante `SAVEPOINT`: sólo la
 * llamada más externa decide confirmar o revertir (DESIGN.md 3.4).
 *
 * ======================== POR QUÉ `IMMEDIATE` ========================
 * Con `BEGIN DEFERRED`, dos transacciones pueden leer el mismo snapshot y
 * ambas intentar escribir; la segunda recibe `SQLITE_BUSY` en el commit y el
 * usuario ve un error en lugar de, por ejemplo, una reserva duplicada.
 * `IMMEDIATE` toma el lock de escritura al abrir y serializa desde el inicio
 * (DESIGN.md 8.2). Es la defensa real frente al caso de los dos clientes que
 * reservan la misma silla a la misma hora.
 *
 * ===================== LIMITES Y SATURACIÓN ========================
 * 1. `better-sqlite3` es SÍNCRONO. Todo lo que se ejecuta dentro de `fn`
 *    debería ser síncrono. `fn` puede devolver una promesa por comodidad de
 *    firma, pero **no se debe hacer `await` dentro de la transacción**: el
 *    control pasa al event loop, otra petición puede entrar en la misma
 *    conexión y modificar la misma transacción abierta o disparar
 *    `SQLITE_BUSY` por el lock de escritura. Con `runInTransactionSync` el
 *    riesgo desaparece: no hay ningún salto al event loop.
 * 2. Los efectos externos (correo, push, webhooks) NUNCA van dentro de la
 *    transacción: se ejecutan después del commit (DESIGN.md 3.5, paso 6).
 * 3. La transacción se detecta por contexto, no por bandera global: un
 *    `AsyncLocalStorage` lleva la profundidad, así que dos peticiones
 *    simultáneas nunca se cuelan en la transacción de la otra.
 * 4. Si se detecta una transacción abierta **sin** contexto (una fuga
 *    anterior dejó el `BEGIN` a medias), se hace rollback y se lanza
 *    `DatabaseError`. Falla de forma ruidosa en lugar de confirmar trabajo
 *    ajeno a la transacción equivocada.
 * 5. El lock de escritura se mantiene mientras dure la transacción. Las
 *    transacciones largas (importaciones, reportes pesados) bloquean a todos
 *    los escritores: partir el trabajo en lotes pequeños.
 * 6. `SQLITE_BUSY` tras agotar `busy_timeout` se traduce a
 *    `ConflictError` con `details.code = 'RESOURCE_BUSY'` (API.md 4), no a un
 *    500: es un conflicto esperable, no un fallo del servidor.
 * ===================================================================
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { ConflictError, DatabaseError } from '../errors/index.js';
import { logger } from '../logger/index.js';
import { CONFLICT_DETAIL_CODE } from '../errors/codes.js';
import { getConnection, type Db } from './connection.js';

/** Estado de la transacción actual. `depth` es 1 en el nivel más externo. */
interface TransactionScope {
  depth: number;
  savepoints: number;
}

/** Profundidad de la transacción actual: 0 fuera de una transacción. */
const transactionScope = new AsyncLocalStorage<TransactionScope>();

/** Profundidad de la transacción en curso. 0 = fuera de transacción. */
export function transactionDepth(): number {
  return transactionScope.getStore()?.depth ?? 0;
}

/** `true` si la llamada actual está dentro de una transacción. */
export function inTransaction(): boolean {
  return transactionScope.getStore() !== undefined;
}

/** Falla si la operación se intenta fuera de una transacción. */
export function assertInTransaction(db: Db = getConnection()): void {
  if (!inTransaction() || !db.inTransaction) {
    throw new DatabaseError('La operación requiere una transacción abierta', {
      details: { reason: 'TRANSACTION_REQUIRED' },
    });
  }
}

/** Detecta un `BEGIN` huérfano de una petición anterior. */
function recoverOrphanedTransaction(db: Db): void {
  logger.error(
    { inTransaction: db.inTransaction },
    'transacción huérfana detectada: se revierte y se aborta la nueva operación',
  );
  try {
    db.exec('ROLLBACK');
  } catch (error) {
    logger.error({ error }, 'no se pudo revertir la transacción huérfana');
  }
  throw new DatabaseError(
    'Se detectó una transacción abierta sin contexto. Se revirtió; reintente la operación.',
    { details: { reason: 'ORPHANED_TRANSACTION' }, cause: undefined },
  );
}

type WorkResult<T> = T | Promise<T>;

/**
 * Ejecuta `fn` detectando si devuelve una promesa.
 * Si la devuelve, se registra el aviso de la limitación documentada arriba.
 */
async function runWork<T>(fn: (tx: Db) => WorkResult<T>): Promise<T> {
  const result = fn(getConnection());
  if (isThenable(result)) {
    logger.warn(
      'fn de runInTransaction devolvió una promesa: se admitirá, pero no se debe hacer ' +
        'await dentro de la transacción (el lock de escritura queda retenido durante el ' +
        'salto al event loop). Use runInTransactionSync si no necesita asincronía.',
    );
    return await result;
  }
  return result;
}

function isThenable<T>(value: WorkResult<T>): value is Promise<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then: unknown }).then === 'function'
  );
}

/**
 * Unidad de trabajo asíncrona. Firma del contrato de la fundación.
 *
 * @param fn Cuerpo de la unidad de trabajo. Recibe la conexión ya abierta en
 *            `BEGIN IMMEDIATE` (o dentro de un `SAVEPOINT` si es anidada).
 * @returns Lo que devuelva `fn`.
 * @throws El error original de `fn`, tras revertir la transacción.
 */
export async function runInTransaction<T>(fn: (tx: Db) => Promise<T> | T): Promise<T> {
  const db = getConnection();
  const scope = transactionScope.getStore();

  // ── Anidada: SAVEPOINT, la más externa sigue siendo dueña del commit ──
  if (scope !== undefined) {
    scope.depth += 1;
    scope.savepoints += 1;
    const savepoint = `sp_${scope.savepoints}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = await runWork(fn);
      db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      // `ROLLBACK TO` deshace sólo el savepoint; `RELEASE` lo destruye para
      // que la transacción externa pueda seguir.
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally {
      scope.depth -= 1;
    }
  }

  if (db.inTransaction) {
    recoverOrphanedTransaction(db);
  }

  db.exec('BEGIN IMMEDIATE');
  const rootScope: TransactionScope = { depth: 1, savepoints: 0 };
  try {
    const result = await transactionScope.run(rootScope, () => runWork(fn));
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.inTransaction) {
      try {
        db.exec('ROLLBACK');
      } catch (rollbackError) {
        logger.error({ rollbackError }, 'fallo al hacer ROLLBACK');
      }
    }
    throw error;
  }
}

/**
 * Variante **síncrona** de la unidad de trabajo.
 *
 * Es la forma recomendada: no hay salto al event loop, así que ninguna otra
 * petición puede entrar en la transacción y el tipo de retorno es exacto.
 * Mantiene `BEGIN IMMEDIATE` y los `SAVEPOINT` anidados.
 */
export function runInTransactionSync<T>(fn: (tx: Db) => T): T {
  const db = getConnection();
  const scope = transactionScope.getStore();

  if (scope !== undefined) {
    scope.depth += 1;
    scope.savepoints += 1;
    const savepoint = `sp_${scope.savepoints}`;
    db.exec(`SAVEPOINT ${savepoint}`);
    try {
      const result = fn(db);
      db.exec(`RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      db.exec(`ROLLBACK TO ${savepoint}`);
      db.exec(`RELEASE ${savepoint}`);
      throw error;
    } finally {
      scope.depth -= 1;
    }
  }

  if (db.inTransaction) {
    recoverOrphanedTransaction(db);
  }

  db.exec('BEGIN IMMEDIATE');
  const rootScope: TransactionScope = { depth: 1, savepoints: 0 };
  // `AsyncLocalStorage.run` establece el contexto durante la ejecución SÍNCRONA
  // de `fn` y lo restaura al salir, sin contaminar al llamador. Es
  // equivalente a `enterWith` pero sin dejar estado residual.
  return transactionScope.run(rootScope, () => {
    try {
      const result = fn(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      if (db.inTransaction) {
        try {
          db.exec('ROLLBACK');
        } catch (rollbackError) {
          logger.error({ rollbackError }, 'fallo al hacer ROLLBACK');
        }
      }
      throw error;
    }
  });
}

/**
 * Traduce un error de SQLite al error de aplicación correcto.
 *
 * `SQLITE_BUSY` / `SQLITE_LOCKED` -> `409 CONFLICT_ERROR` con
 * `details.code = 'RESOURCE_BUSY'`: es un conflicto esperable por
 * concurrencia, nunca un 500 (API.md 4).
 * Violaciones de integridad -> `DatabaseError` (500) para que la capa de
 * servicio la reinterprete y exprese como regla de negocio si procede.
 */
export function translateSqliteError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;

  const code = (error as { code?: unknown }).code;
  if (code !== 'SQLITE_BUSY' && code !== 'SQLITE_LOCKED') {
    return error;
  }
  return new ConflictError('La operación no pudo completarse porque el recurso está ocupado', {
    details: { code: CONFLICT_DETAIL_CODE.RESOURCE_BUSY },
    cause: error,
  });
}
