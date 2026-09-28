/**
 * Variables de entorno de los tests. SE IMPORTA PRIMERO, SIEMPRE.
 *
 * `config/env.ts` valida `process.env` en el momento de importarse y `dotenv`
 * sólo rellena variables que estén a undefined, así que todo lo de aquí tiene
 * que existir ANTES de que se importe nada de `src/`. Por eso este módulo no
 * importa nada del proyecto: sólo asigna variables, y su cuerpo se ejecuta en el
 * primer `import` de la cadena.
 *
 * Cada fichero de test de `tests/` importa `./helpers/harness.js` como PRIMER
 * import, y el harness importa este fichero antes que nada. ESM evalúa los
 * módulos en orden de aparición, así que el orden está garantizado.
 *
 * Por qué `.env` del repositorio no molesta: `loadDotenv()` usa
 * `process.env[clave] ??= valor`, de modo que lo que pongamos aquí gana.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raíz de `backend/`, para no depender del directorio de trabajo. */
const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Base de datos EN MEMORIA.
 *
 * Una base por fichero de test: vitest aísla cada fichero en su propio contexto
 * de módulos y, por tanto, en su propio proceso, así que cada uno abre su
 * conexión `:memory:` y aplica migraciones y semilla desde cero. Aísla por
 * proceso, no por nombre de fichero: un solo fichero con un solo contexto.
 */
process.env['DATABASE_PATH'] = ':memory:';
process.env['APP_ENV'] = 'test';
process.env['NODE_ENV'] = 'test';

/** Silencia el log: los tests Fallan si algo está mal, no si hay ruido. */
process.env['LOG_LEVEL'] = 'silent';

/**
 * Secreto de prueba. Debe cumplir las reglas de `env.ts` (32 caracteres, no ser
 * débil) porque el validador no distingue entornos. No es un secreto: sólo firma
 * JWT dentro de este proceso.
 */
process.env['DATABASE_JWT_SECRET'] =
  'secreto-de-pruebas-no-usar-en-produccion-9f2c1a7b4e3d6c5a';

/** Access token de 15 minutos, como en producción: los TTL no se falsean. */
process.env['JWT_ACCESS_TTL'] = '15m';
process.env['JWT_REFRESH_TTL_DAYS'] = '30';

/**
 * Coste de bcrypt = 10 en lugar de 12 (BR-SEC-001 pide 12).
 *
 * La política de contraseña NO se toca: lo que se prueba es la longitud, las
 * clases de caracteres y la lista de triviales, no el coste del hash. Con 12
 * cada login del test costaría ~250 ms y la suite tardaría minutos; con 10 son
 * ~60 ms. En producción el valor sigue siendo 12 (`BCRYPT_COST_ROUNDS`).
 */
process.env['BCRYPT_COST_ROUNDS'] = '10';

/** Ventana de los tokens de reseteo, igual que en producción. */
process.env['PASSWORD_RESET_TOKEN_TTL_MINUTES'] = '30';

/** Límites de tasa altos por defecto: los tests que los verifican los bajan. */
process.env['RATE_LIMIT_MAX'] = '1000000';
process.env['AUTH_RATE_LIMIT_MAX'] = '1000000';

/**
 * Límite reforzado de recuperación de contraseña: 3 por hora.
 * `tests/validation.spec.ts` lo usa para comprobar el 429 de verdad.
 */
process.env['AUTH_PASSWORD_RATE_LIMIT_MAX'] = '3';
process.env['AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS'] = '3600000';

/** Cuentas de sistema: se siembran con una contraseña de test explícita. */
process.env['SEED_SYSTEM_ACCOUNTS'] = 'true';
process.env['SEED_SYSTEM_ACCOUNTS_PASSWORD'] = 'LatteCofee#2026';

/** CORS irrelevante en tests, pero la variable es obligatoria. */
process.env['CORS_ORIGINS'] = 'http://localhost:3000';

/** Raíz de `backend/`, exportada por comodidad. */
export const backendRoot = BACKEND_ROOT;
