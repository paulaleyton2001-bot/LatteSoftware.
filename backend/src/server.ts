/**
 * Arranque del proceso.
 *
 * Responsabilidades:
 *  1. Abrir la base de datos (una sola conexión) y comprobar su salud.
 *  2. Ejecutar migraciones SÓLO si `SEED_ON_MIGRATE` está activo. Por
 *     defecto las migraciones son un comando explícito (`npm run migrate`):
 *     un despliegue nunca debe crear el esquema por sorpresa.
 *  3. `listen` con apagado ordenado (SIGTERM/SIGINT) que cierra servidor y
 *     base de datos sin perder trabajo en curso.
 *
 * `app.ts` no se importa aquí para el `listen`: se importa para construir la
 * app, que sigue sin escuchar por sí misma.
 */
import type { Server } from 'node:http';

import { createApp } from './app.js';
import { env } from './config/index.js';
import { closeConnection, getConnection } from './shared/database/connection.js';
import { checkDatabaseHealth } from './shared/database/health.js';
import { countPending, up } from './shared/database/migrator.js';
import { logger } from './shared/logger/index.js';
import { publicRouteSummary } from './modules/index.js';
import { runSeed } from './database/seeds/index.js';

/** Tiempo máximo para drenar conexiones abiertas al apagar. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Servidor activo, para poder cerrarlo desde las señales del sistema. */
let server: Server | null = null;

/** `true` cuando ya se está apagando, para no repetir el trabajo. */
let shuttingDown = false;

/**
 * Aplica migraciones si el arranque lo pide. Con `SEED_ON_MIGRATE=false`
 * (por defecto) sólo avisa de cuántas faltan, sin tocar el esquema.
 */
function prepareDatabase(): void {
  getConnection();
  const health = checkDatabaseHealth();
  if (!health.connected) {
    logger.error({ reason: health.reason }, 'la base de datos no responde; revise DATABASE_PATH');
  }

  if (env.seedOnMigrate) {
    const result = up();
    if (result.applied.length > 0) {
      logger.info({ applied: result.applied }, 'migraciones aplicadas en el arranque');
    }
    const seed = runSeed();
    if (!seed.skipped) {
      logger.info('semilla de arranque aplicada');
    }
    return;
  }

  const pending = countPending();
  if (pending > 0) {
    logger.warn(
      { pending },
      'hay migraciones pendientes: ejecute `npm run migrate`. ' +
        'SEED_ON_MIGRATE está desactivado, el arranque NO crea el esquema.',
    );
  }
}

/** Apagado ordenado: deja de aceptar conexiones, drena y cierra la base. */
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'apagado ordenado iniciado');

  const forceExit = setTimeout(() => {
    logger.error('apagado forzado: se agota el tiempo de drenaje');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    if (server !== null) {
      await new Promise<void>((resolve) => {
        server?.close(() => {
          resolve();
        });
      });
      logger.info('servidor HTTP cerrado');
    }
    closeConnection();
    clearTimeout(forceExit);
    logger.info('apagado completado');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'error durante el apagado');
    process.exit(1);
  }
}

/** Registra las señales del sistema y los errores no capturados. */
function registerProcessHandlers(): void {
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'promesa rechazada sin manejar');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ error, stack: error.stack }, 'excepción no capturada: se apaga');
    void shutdown('uncaughtException');
  });
}

function start(): void {
  registerProcessHandlers();
  // La base de datos se prepara ANTES de escuchar: si el esquema no está listo,
  // es preferible no abrir el puerto y fallar con un mensaje claro.
  prepareDatabase();

  const app = createApp();
  server = app.listen(env.port, env.host, () => {
    logger.info(
      {
        host: env.host,
        port: env.port,
        env: env.appEnv,
        version: env.appVersion,
        database: env.database.path,
        routes: publicRouteSummary(),
      },
      'LatteCoffe API escuchando',
    );
  });

  server.on('error', (error) => {
    logger.error({ error }, 'no se pudo abrir el socket HTTP');
    process.exit(1);
  });
}

try {
  start();
} catch (error) {
  // Fallo de arranque: mensaje accionable, sin stack en producción.
  const message = error instanceof Error ? error.message : String(error);
  logger.fatal(
    { message, ...(env.isProduction ? {} : { stack: error instanceof Error ? error.stack : undefined }) },
    'el arranque ha fallado',
  );
  closeConnection();
  process.exit(1);
}
