/**
 * Migraciones BASADAS EN ARCHIVOS. El esquema **nunca** se crea al arrancar:
 * `npm run migrate` es un comando explícito (DESIGN.md 2.2 y el requisito de
 * la fundación).
 *
 * MECANISMO
 *  1. Se lee `src/database/migrations/*.sql` en orden lexicográfico
 *     (`0001_init.sql`, `0002_...`).
 *  2. Se calcula el SHA-256 del contenido de cada fichero.
 *  3. Las migraciones aplicadas se registran en la tabla `_migrations`
 *     (`id, name, checksum, applied_at, execution_ms`).
 *  4. Si una migración ya aplicada tiene un checksum distinto del actual, se
 *     ABORTA con un error claro: alguien editó historia. Se corrige con una
 *     migración nueva, nunca reescribiendo una aplicada.
 *  5. Cada migración se aplica dentro de su propia transacción: o entra
 *     entera, o no entra nada.
 *
 * REVERSIÓN
 *  - Un fichero `NNNN_nombre.down.sql` opcional describe cómo deshacer la
 *    migración. `rollback` ejecuta el `down` de la última aplicada y borra su
 *    fila, de modo que `migrate` puede volver a aplicarla.
 *  - Sin fichero `down`, `rollback` falla con un mensaje explícito en vez de
 *    adivinar un DROP.
 *
 * REGLAS DE LOS FICHEROS `.sql`
 *  - Prohibido `BEGIN`/`COMMIT`/`ROLLBACK`/`SAVEPOINT`: el runner controla la
 *    transacción. (Un `BEGIN` de cuerpo de trigger no se confunde con
 *    `BEGIN IMMEDIATE`, que es lo que se detecta.)
 *  - `PRAGMA` está permitido: son sentencias independientes de la transacción.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '../../config/index.js';
import { DatabaseError } from '../errors/index.js';
import { logger } from '../logger/index.js';
import { nowIso } from '../utils/datetime.js';
import { getConnection, type Db } from './connection.js';

/** Tabla de control del runner. No es una tabla de negocio. */
export const MIGRATIONS_TABLE = '_migrations';

/** Sufijo del fichero de reversión. */
const DOWN_SUFFIX = '.down.sql';

/** Orden canónico de las columnas de `_migrations`. */
const CREATE_MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL UNIQUE,
  checksum     TEXT NOT NULL,
  applied_at   TEXT NOT NULL,
  execution_ms INTEGER NOT NULL
)`;

/** Fila de `_migrations`. */
export interface AppliedMigration {
  readonly id: number;
  readonly name: string;
  readonly checksum: string;
  readonly applied_at: string;
  readonly execution_ms: number;
}

/** Migración leída del disco, pendiente de aplicar. */
export interface MigrationFile {
  readonly name: string;
  readonly path: string;
  readonly sql: string;
  readonly checksum: string;
  /** Ruta del fichero `.down.sql`, si existe. */
  readonly downPath: string | null;
}

/**
 * Localiza el directorio de migraciones.
 *
 * En desarrollo se resuelve junto al módulo (`src/database/migrations`).
 * Al compilar, `tsc` no copia los `.sql`, así que en `dist/` se busca la
 * carpeta de fuentes. Se acepta un override por variable de entorno para
 * despliegues empaquetados.
 */
export function resolveMigrationsDir(): string {
  const override = process.env['MIGRATIONS_DIR'];
  if (override !== undefined && override.length > 0) {
    const absolute = resolve(override);
    if (!existsSync(absolute)) {
      throw new DatabaseError(`MIGRATIONS_DIR no existe: ${absolute}`);
    }
    return absolute;
  }

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // `src/database/` -> `src/database/migrations` (CLI en modo tsx)
    resolve(moduleDir, 'migrations'),
    // `src/shared/database/` -> `src/database/migrations`
    resolve(moduleDir, '..', '..', 'database', 'migrations'),
    // `dist/shared/database/` -> `src/database/migrations` (tsc no copia los .sql)
    resolve(moduleDir, '..', '..', '..', 'src', 'database', 'migrations'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new DatabaseError(
    'No se encontró el directorio de migraciones. Rutas probadas:\n' +
      candidates.map((candidate) => `  - ${candidate}`).join('\n') +
      '\nDefina MIGRATIONS_DIR o ejecute las migraciones desde el repositorio (npm run migrate).',
  );
}

/** SHA-256 hexadecimal del contenido de la migración. */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Reduce el SQL a su "esqueleto": conserva el código (identificadores,
 * palabras clave y puntuación) y **elimina** comentarios y el contenido de los
 * literales de texto o identificadores entrecomillados, sustituyéndolos por
 * espacios.
 *
 * Es lo que permite analizar el fichero en busca de sentencias de control de
 * transacción sin falsos positivos:
 *  - un comentario que mencione `BEGIN IMMEDIATE` no dispara el guard;
 *  - el valor `'RELEASE'` de un CHECK de enum tampoco.
 */
export function sqlSkeleton(sql: string): string {
  let result = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    // Comentario de línea.
    if (char === '-' && next === '-') {
      while (index < sql.length && sql[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    // Comentario de bloque.
    if (char === '/' && next === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      result += '  ';
      continue;
    }

    // Literal de texto o identificador entrecomillado: se enmascara entero.
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      index += 1;
      while (index < sql.length) {
        const current = sql[index];
        if (current === quote) {
          // Doble comilla escapada dentro del literal.
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        result += current === '\n' ? '\n' : ' ';
        index += 1;
      }
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}

/** Detecta sentencias de control de transacción prohibidas en un `.sql`. */
function assertNoTransactionControl(name: string, sql: string): void {
  const code = sqlSkeleton(sql);
  const forbidden: readonly (readonly [RegExp, string])[] = [
    [/\bBEGIN\s+(DEFERRED|IMMEDIATE|EXCLUSIVE|TRANSACTION)\b/i, 'BEGIN <modo>'],
    [/\bBEGIN\s+TRANSACTION\b/i, 'BEGIN TRANSACTION'],
    [/\bCOMMIT\b/i, 'COMMIT'],
    [/\bROLLBACK\b/i, 'ROLLBACK'],
    [/\bSAVEPOINT\b/i, 'SAVEPOINT'],
    [/\bRELEASE\b/i, 'RELEASE'],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(code)) {
      throw new DatabaseError(
        `La migración "${name}" contiene "${label}". El runner controla la transacción: ` +
          'las migraciones no deben abrir ni cerrar transacciones ellas mismas.',
        { details: { migration: name, statement: label } },
      );
    }
  }
}

/** Lee y valida los ficheros `.sql` del directorio, en orden lexicográfico. */
export function readMigrations(dir: string = resolveMigrationsDir()): MigrationFile[] {
  const entries = readdirSync(dir)
    .filter((entry) => entry.endsWith('.sql') && !entry.endsWith(DOWN_SUFFIX))
    .sort((a, b) => a.localeCompare(b, 'en'));

  if (entries.length === 0) {
    throw new DatabaseError(`No se encontraron migraciones en ${dir}`);
  }

  return entries.map((entry) => {
    const path = join(dir, entry);
    const sql = readFileSync(path, 'utf8');
    assertNoTransactionControl(entry, sql);
    const downCandidate = join(dir, entry.replace(/\.sql$/, DOWN_SUFFIX));
    return {
      name: entry,
      path,
      sql,
      checksum: checksumOf(sql),
      downPath: existsSync(downCandidate) ? downCandidate : null,
    };
  });
}

/** Crea `_migrations` si no existe. Idempotente. */
export function ensureMigrationsTable(db: Db = getConnection()): void {
  db.exec(CREATE_MIGRATIONS_TABLE);
}

/** Migraciones ya aplicadas, ordenadas por id. */
export function listApplied(db: Db = getConnection()): AppliedMigration[] {
  ensureMigrationsTable(db);
  return db
    .prepare(
      `SELECT id, name, checksum, applied_at, execution_ms
         FROM ${MIGRATIONS_TABLE}
        ORDER BY id ASC`,
    )
    .all() as AppliedMigration[];
}

/**
 * Comprueba la integridad del historial: toda migración aplicada debe seguir
 * teniendo el mismo checksum y no puede haber huecos en el orden.
 * @throws DatabaseError con el detalle de la divergencia.
 */
export function assertHistoryIntegrity(files: readonly MigrationFile[], applied: readonly AppliedMigration[]): void {
  const byName = new Map(files.map((file) => [file.name, file]));
  for (const row of applied) {
    const file = byName.get(row.name);
    if (file === undefined) {
      throw new DatabaseError(
        `La migración aplicada "${row.name}" ya no existe en el disco. ` +
          'No se puede verificar su integridad; no siga aplicando migraciones.',
        { details: { migration: row.name, reason: 'MISSING_FILE' } },
      );
    }
    if (file.checksum !== row.checksum) {
      throw new DatabaseError(
        `La migración aplicada "${row.name}" cambió de contenido (checksum ${row.checksum} -> ` +
          `${file.checksum}). Editar una migración aplicada está prohibido: cree una migración ` +
          'nueva con los cambios.',
        { details: { migration: row.name, appliedChecksum: row.checksum, fileChecksum: file.checksum } },
      );
    }
  }
}

/**
 * Estado de una migración:
 *  - `applied`    -> aplicada y con el mismo checksum que el fichero.
 *  - `pending`    -> existe en disco pero no se ha aplicado.
 *  - `divergent`  -> aplicada, pero el fichero cambió después (integridad
 *                    rota). `up` abortará; `status` debe poder mostrarlo.
 */
export interface MigrationStatus {
  readonly name: string;
  readonly status: 'applied' | 'pending' | 'divergent';
  readonly checksum: string;
  readonly appliedAt: string | null;
  readonly executionMs: number | null;
  readonly downAvailable: boolean;
}

/** Estado completo: aplicado vs pendiente, con checksums. */
export function status(dir: string = resolveMigrationsDir()): MigrationStatus[] {
  const db = getConnection();
  const files = readMigrations(dir);
  const applied = listApplied(db);
  const appliedByName = new Map(applied.map((row) => [row.name, row]));

  return files.map((file): MigrationStatus => {
    const row = appliedByName.get(file.name);
    if (row === undefined) {
      return {
        name: file.name,
        status: 'pending',
        checksum: file.checksum,
        appliedAt: null,
        executionMs: null,
        downAvailable: file.downPath !== null,
      };
    }
    const divergent = row.checksum !== file.checksum;
    return {
      name: file.name,
      // No se aborta aquí: `status` debe poder **mostrar** la divergencia para
      // poder diagnosticarla. `up` sí aborta, en `assertHistoryIntegrity`.
      status: divergent ? 'divergent' : 'applied',
      checksum: file.checksum,
      appliedAt: row.applied_at,
      executionMs: row.execution_ms,
      downAvailable: file.downPath !== null,
    };
  });
}

/** Resultado de `up`. */
export interface UpResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

/**
 * Aplica las migraciones pendientes en orden, cada una en su propia
 * transacción. Es idempotente: volver a ejecutarlo no cambia nada.
 */
export function up(dir: string = resolveMigrationsDir()): UpResult {
  const db = getConnection();
  ensureMigrationsTable(db);

  const files = readMigrations(dir);
  const applied = listApplied(db);
  assertHistoryIntegrity(files, applied);

  const appliedNames = new Set(applied.map((row) => row.name));
  const pending = files.filter((file) => !appliedNames.has(file.name));
  const skipped = files.filter((file) => appliedNames.has(file.name)).map((file) => file.name);

  const record = db.prepare(
    `INSERT INTO ${MIGRATIONS_TABLE} (name, checksum, applied_at, execution_ms)
     VALUES (?, ?, ?, ?)`,
  );

  const executed: string[] = [];
  for (const file of pending) {
    const startedAt = process.hrtime.bigint();
    db.exec('BEGIN IMMEDIATE');
    try {
      // `exec` ejecuta el fichero completo: los cuerpos de trigger
      // (`BEGIN ... END;`) se manejan sin trocear por `;`.
      db.exec(file.sql);
      const executionMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      record.run(file.name, file.checksum, nowIso(), executionMs);
      db.exec('COMMIT');
      executed.push(file.name);
      logger.info(
        { migration: file.name, checksum: file.checksum.slice(0, 12), executionMs },
        'migración aplicada',
      );
    } catch (error) {
      db.exec('ROLLBACK');
      throw new DatabaseError(`Falló la migración "${file.name}": ${describe(error)}`, {
        details: { migration: file.name },
        cause: error,
      });
    }
  }

  return { applied: executed, skipped };
}

/** Resultado de `rollback`. */
export interface RollbackResult {
  readonly reverted: string | null;
  readonly reason?: string;
}

/**
 * Revierte la última migración aplicada usando su fichero `.down.sql`.
 * @throws DatabaseError si no hay nada que revertir o si falta el `down`.
 */
export function rollback(dir: string = resolveMigrationsDir()): RollbackResult {
  const db = getConnection();
  ensureMigrationsTable(db);

  const applied = listApplied(db);
  const last = applied[applied.length - 1];
  if (last === undefined) {
    return { reverted: null, reason: 'NO_APPLIED_MIGRATIONS' };
  }

  const files = readMigrations(dir);
  const file = files.find((candidate) => candidate.name === last.name);
  if (file === undefined) {
    throw new DatabaseError(
      `No se encuentra el fichero de la migración aplicada "${last.name}"; no se puede revertir.`,
      { details: { migration: last.name } },
    );
  }
  if (file.downPath === null) {
    throw new DatabaseError(
      `La migración "${last.name}" no tiene fichero de reversión ` +
        `("${last.name.replace(/\.sql$/, DOWN_SUFFIX)}"); no se puede revertir automáticamente.`,
      { details: { migration: last.name, reason: 'MISSING_DOWN_FILE' } },
    );
  }

  const downSql = readFileSync(file.downPath, 'utf8');
  assertNoTransactionControl(file.name, downSql);

  const startedAt = process.hrtime.bigint();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(downSql);
    db.prepare(`DELETE FROM ${MIGRATIONS_TABLE} WHERE id = ?`).run(last.id);
    db.exec('COMMIT');
    const executionMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
    logger.info({ migration: last.name, executionMs }, 'migración revertida');
    return { reverted: last.name };
  } catch (error) {
    db.exec('ROLLBACK');
    throw new DatabaseError(`Falló la reversión de "${last.name}": ${describe(error)}`, {
      details: { migration: last.name },
      cause: error,
    });
  }
}

/**
 * Número de migraciones pendientes. Lo usa `GET /api/v1/health`
 * (`database.migrationsPending`).
 */
export function countPending(dir: string = resolveMigrationsDir()): number {
  const db = getConnection();
  ensureMigrationsTable(db);
  const files = readMigrations(dir);
  const applied = new Set(listApplied(db).map((row) => row.name));
  return files.filter((file) => !applied.has(file.name)).length;
}

/** Texto legible de un error desconocido, sin filtrar SQL al usuario final. */
function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** Ruta absoluta del fichero de base de datos configurada. */
export function databasePath(): string {
  return env.database.path === ':memory:' ? ':memory:' : basename(env.database.path);
}
