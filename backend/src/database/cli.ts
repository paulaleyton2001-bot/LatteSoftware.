/**
 * CLI de base de datos.
 *
 * Comandos:
 *   up        aplica las migraciones pendientes (idempotente)
 *   status    muestra aplicadas / pendientes con su checksum
 *   rollback  revierte la última aplicada usando su fichero `.down.sql`
 *   seed      siembra los datos de arranque (roles, permisos, negocio)
 *
 * El esquema NUNCA se crea al arrancar el servidor: es un comando explícito.
 */
import { env } from '../config/index.js';
import { closeConnection, getConnection } from '../shared/database/connection.js';
import { resolveMigrationsDir, rollback, status, up } from '../shared/database/migrator.js';
import { logger } from '../shared/logger/index.js';
import { runSeed } from './seeds/index.js';

/** Comandos aceptados. */
const COMMANDS = ['up', 'status', 'rollback', 'seed'] as const;

type Command = (typeof COMMANDS)[number];

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

const STATUS_LABEL = {
  applied: 'aplicada',
  pending: 'PENDIENTE',
  divergent: 'ALTERADA',
} as const;

/** Imprime el estado de las migraciones en texto plano. */
function printStatus(): void {
  const rows = status();
  const pending = rows.filter((row) => row.status === 'pending').length;
  const applied = rows.filter((row) => row.status === 'applied').length;
  const divergent = rows.filter((row) => row.status === 'divergent').length;

  process.stdout.write(
    `Migraciones: ${rows.length} en disco | aplicadas: ${applied} | pendientes: ${pending}` +
      (divergent > 0 ? ` | ALTERADAS: ${divergent}` : '') +
      '\n',
  );
  for (const row of rows) {
    const marker = STATUS_LABEL[row.status];
    const appliedAt = row.appliedAt ?? '-';
    const ms = row.executionMs === null ? '-' : `${row.executionMs} ms`;
    const down = row.downAvailable ? 'down: sí' : 'down: no';
    process.stdout.write(
      `  [${marker.padEnd(8)}] ${row.name.padEnd(28)} ${row.checksum.slice(0, 12)}  ` +
        `aplicada=${appliedAt}  ${ms}  ${down}\n`,
    );
  }
  if (divergent > 0) {
    process.stdout.write(
      'ERROR DE INTEGRIDAD: el contenido de una migracion ya aplicada cambio. ' +
        'Cree una migracion nueva en vez de editar la existente.\n',
    );
  }
  if (pending > 0) {
    process.stdout.write('Ejecute `npm run migrate` para aplicar las pendientes.\n');
  }
}

function main(): void {
  const requested = process.argv[2] ?? 'up';
  if (!isCommand(requested)) {
    process.stderr.write(
      `Comando desconocido: "${requested}".\nComandos: ${COMMANDS.join(', ')}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const dir = resolveMigrationsDir();
  getConnection();
  logger.debug({ dir, database: env.database.path }, 'migraciones: contexto listo');

  switch (requested) {
    case 'up': {
      const result = up(dir);
      if (result.applied.length === 0) {
        process.stdout.write(
          `Nada que hacer: ${result.skipped.length} migración(es) ya aplicada(s). ` +
            'El esquema está al día.\n',
        );
      } else {
        for (const name of result.applied) {
          process.stdout.write(`Aplicada: ${name}\n`);
        }
        process.stdout.write(
          `Migraciones aplicadas: ${result.applied.length} de ${result.applied.length + result.skipped.length}.\n`,
        );
      }
      return;
    }
    case 'status': {
      printStatus();
      return;
    }
    case 'rollback': {
      const result = rollback(dir);
      if (result.reverted === null) {
        process.stdout.write('No hay migraciones aplicadas que revertir.\n');
        return;
      }
      process.stdout.write(`Revertida: ${result.reverted}\n`);
      return;
    }
    case 'seed': {
      const summary = runSeed();
      process.stdout.write(`Seed completado: ${summary.applied} grupo(s) aplicado(s).\n`);
      return;
    }
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`ERROR: ${message}\n`);
  if (error instanceof Error && error.stack !== undefined && !env.isProduction) {
    process.stderr.write(`${error.stack}\n`);
  }
  process.exitCode = 1;
} finally {
  closeConnection();
}
