/**
 * Validación y carga de variables de entorno.
 *
 * Reglas de la fundación (fase 1):
 *  - Se valida `process.env` con zod **antes** de construir nada más.
 *  - El arranque falla rápido (throw) si falta cualquier variable obligatoria
 *    o si el secreto JWT es débil en producción.
 *  - El objeto exportado es de sólo lectura (congelado): nadie lo muta por
 *    accidente desde un service.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';
import { z } from 'zod';

/** Raíz del paquete (`backend/`), calculada desde este módulo. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Carga `.env` sin sobrescribir variables ya presentes en el proceso.
 * En producción `.env` no suele existir (inyectado por el orquestador).
 */
function loadDotenv(): void {
  const explicit = process.env['DOTENV_CONFIG_PATH'];
  const candidates = [explicit, resolve(PACKAGE_ROOT, '.env')].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const parsed = dotenv.parse(readFileSync(candidate));
      for (const [key, value] of Object.entries(parsed)) {
        process.env[key] ??= value;
      }
      return;
    }
  }
}

loadDotenv();

/** Marca de entorno de aplicación. `APP_ENV` manda sobre `NODE_ENV`. */
const appEnvSchema = z
  .enum(['development', 'test', 'staging', 'production'])
  .default('development')
  .describe('Entorno de la aplicación (contrato de despliegue).');

/** `true`/`false`/`1`/`0` en texto. */
const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
    throw new Error(`Valor booleano no reconocido: "${value}". Usar true/false/1/0.`);
  });

/** Lista separada por comas -> `string[]` sin entradas vacías. */
const csvList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

/** Segundos o formato con sufijo ("15m", "1h", "900"). */
const ttlSchema = z.string().min(1);

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    APP_ENV: appEnvSchema.optional(),
    PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
    HOST: z.string().min(1).default('0.0.0.0'),
    APP_NAME: z.string().min(1).default('LatteCoffe API'),
    APP_VERSION: z.string().regex(/^\d+\.\d+\.\d+$/, 'Debe ser semver, p. ej. 1.0.0').default('1.0.0'),

    DATABASE_PATH: z.string().min(1).default('./data/lattecoffe.sqlite'),
    DATABASE_BUSY_TIMEOUT_MS: z.coerce.number().int().min(0).max(120_000).default(5_000),

    DATABASE_JWT_SECRET: z.string().min(1, 'DATABASE_JWT_SECRET es obligatoria'),
    JWT_ACCESS_TTL: ttlSchema.default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    BCRYPT_COST_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
    /** Vigencia del token de reseteo de contraseña (DESIGN.md 4.1: 30 min). */
    PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(1).max(1_440).default(30),
    /** Base del enlace de reseteo. Sólo se usa para el log de desarrollo. */
    RESET_PASSWORD_LINK_BASE_URL: z.string().min(1).default('http://localhost:5173/reset-password'),

    CORS_ORIGINS: csvList.default(() => ['http://localhost:3000']),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(20),
    // Límite reforzado de recuperación de contraseña: ventana de 1 hora.
    AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(3_600_000),
    AUTH_PASSWORD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(3),

    PAYMENT_PROVIDER: z.string().min(1).default('MOCK'),
    PAYMENT_SECRET: z.string().default(''),

    DEFAULT_CURRENCY: z.string().length(3, 'Código ISO-4217 de 3 letras').default('COP'),
    DEFAULT_TIMEZONE: z.string().min(1).default('America/Bogota'),

    SEED_ON_MIGRATE: booleanFromEnv.default(false),
    /**
     * Cuentas de sistema mínimas (admin, cajero, gerente, propietario) que crea
     * `npm run seed`. Se ignoran SIEMPRE en producción: ver `buildEnv`.
     */
    SEED_SYSTEM_ACCOUNTS: booleanFromEnv.optional(),
    /** Contraseña de las cuentas de sistema. Sólo de desarrollo. */
    SEED_SYSTEM_ACCOUNTS_PASSWORD: z.string().min(1).default('LatteCofee#2026'),
  })
  .passthrough();

type RawEnv = z.infer<typeof rawEnvSchema>;

/** Patrones que un secreto JWT nunca debe contener. */
const WEAK_SECRET_PATTERNS = [
  'cambie',
  'changeme',
  'change-me',
  'change_me',
  'secret',
  'password',
  'contrasena',
  'admin',
  'root',
  'test',
  'demo',
  'example',
  'placeholder',
  '1234567890',
  'abcdefghij',
  'qwerty',
  'lattecoffe',
];

/**
 * Detecta secretos débiles. Solo es bloqueante en producción: en desarrollo
 * se permite un valor de relleno siempre que tenga 32 caracteres.
 */
export function isWeakSecret(secret: string): boolean {
  const normalized = secret.trim().toLowerCase();
  if (normalized.length < 32) return true;
  // Un único carácter repetido ("aaaa...") o una secuencia trivial.
  if (/^(.)\1+$/.test(normalized)) return true;
  const uniqueChars = new Set(normalized).size;
  if (uniqueChars < 8) return true;
  return WEAK_SECRET_PATTERNS.some((pattern) => normalized.includes(pattern));
}

/** Falla rápido con un mensaje accionable. */
class EnvironmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'EnvironmentError';
  }
}

/** Convierte el error de zod en un listado legible de `CAMPO: problema`. */
function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(raíz)';
      return `  - ${path}: ${issue.message}`;
    })
    .join('\n');
}

/** Normaliza `DATABASE_PATH` a absoluta respecto de la raíz del paquete. */
function resolveDatabasePath(rawPath: string): string {
  if (rawPath === ':memory:') return ':memory:';
  return isAbsolute(rawPath) ? rawPath : resolve(PACKAGE_ROOT, rawPath);
}

/** Tipo público del entorno ya validado. */
export interface AppEnv {
  readonly nodeEnv: 'development' | 'test' | 'staging' | 'production';
  readonly appEnv: 'development' | 'test' | 'staging' | 'production';
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly port: number;
  readonly host: string;
  readonly appName: string;
  readonly appVersion: string;
  readonly database: {
    readonly path: string;
    readonly busyTimeoutMs: number;
  };
  readonly security: {
    readonly jwtSecret: string;
    readonly accessTtl: string;
    readonly refreshTtlDays: number;
    readonly bcryptCostRounds: number;
    readonly passwordResetTtlMinutes: number;
    readonly resetPasswordLinkBaseUrl: string;
  };
  readonly corsOrigins: readonly string[];
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  readonly rateLimit: {
    readonly windowMs: number;
    readonly max: number;
    readonly authMax: number;
    /** Ventana del límite reforzado de recuperación de contraseña. */
    readonly passwordWindowMs: number;
    /** Máximo del límite reforzado de recuperación de contraseña. */
    readonly passwordMax: number;
  };
  readonly payment: {
    readonly provider: string;
    readonly secret: string;
  };
  readonly defaults: {
    readonly currency: string;
    readonly timezone: string;
  };
  readonly seedOnMigrate: boolean;
  readonly seed: {
    /** Crear las cuentas de sistema mínimas de desarrollo. */
    readonly systemAccounts: boolean;
    /** Contraseña de las cuentas de sistema. Sólo de desarrollo. */
    readonly systemAccountsPassword: string;
  };
}

function buildEnv(): AppEnv {
  const parsed = rawEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new EnvironmentError(
      `Configuración de entorno inválida:\n${formatIssues(parsed.error)}\n\n` +
        'Revise `backend/.env` o las variables inyectadas por el orquestador. ' +
        'Plantilla disponible en `backend/.env.example`.',
    );
  }

  const raw: RawEnv = parsed.data;
  const appEnv = raw.APP_ENV ?? raw.NODE_ENV;
  const isProduction = appEnv === 'production';

  if (raw.DATABASE_JWT_SECRET.length < 32) {
    throw new EnvironmentError(
      'DATABASE_JWT_SECRET debe tener al menos 32 caracteres ' +
        `(actualmente ${raw.DATABASE_JWT_SECRET.length}).`,
    );
  }
  if (isProduction && isWeakSecret(raw.DATABASE_JWT_SECRET)) {
    throw new EnvironmentError(
      'DATABASE_JWT_SECRET es débil para APP_ENV=production. Debe ser aleatorio y ' +
        'no contener patrones de ejemplo (changeme, secret, password, test...). ' +
        'Genere uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  if (isProduction && raw.PAYMENT_PROVIDER.toUpperCase() !== 'MOCK' && raw.PAYMENT_SECRET.length === 0) {
    throw new EnvironmentError(
      'PAYMENT_SECRET es obligatoria en producción cuando PAYMENT_PROVIDER no es MOCK.',
    );
  }

  // Crea el directorio del fichero SQLite para que la apertura no falle.
  const databasePath = resolveDatabasePath(raw.DATABASE_PATH);
  if (databasePath !== ':memory:') {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  // Las cuentas de sistema son para poder operar el POS recién migrado. En
  // producción NUNCA se crean, ni siquiera si alguien pone el flag a `true`:
  // una contraseña compartida en el repositorio es una puerta abierta.
  const seedSystemAccounts = isProduction ? false : (raw.SEED_SYSTEM_ACCOUNTS ?? true);
  if (isProduction && raw.SEED_SYSTEM_ACCOUNTS === true) {
    throw new EnvironmentError(
      'SEED_SYSTEM_ACCOUNTS no puede activarse en APP_ENV=production: las cuentas de ' +
        'sistema comparten una contraseña conocida. Cree el primer OWNER a mano.',
    );
  }

  return Object.freeze({
    nodeEnv: raw.NODE_ENV,
    appEnv,
    isProduction,
    isTest: appEnv === 'test',
    port: raw.PORT,
    host: raw.HOST,
    appName: raw.APP_NAME,
    appVersion: raw.APP_VERSION,
    database: Object.freeze({
      path: databasePath,
      busyTimeoutMs: raw.DATABASE_BUSY_TIMEOUT_MS,
    }),
    security: Object.freeze({
      jwtSecret: raw.DATABASE_JWT_SECRET,
      accessTtl: raw.JWT_ACCESS_TTL,
      refreshTtlDays: raw.JWT_REFRESH_TTL_DAYS,
      bcryptCostRounds: raw.BCRYPT_COST_ROUNDS,
      passwordResetTtlMinutes: raw.PASSWORD_RESET_TOKEN_TTL_MINUTES,
      resetPasswordLinkBaseUrl: raw.RESET_PASSWORD_LINK_BASE_URL,
    }),
    corsOrigins: Object.freeze(raw.CORS_ORIGINS),
    logLevel: raw.LOG_LEVEL,
    rateLimit: Object.freeze({
      windowMs: raw.RATE_LIMIT_WINDOW_MS,
      max: raw.RATE_LIMIT_MAX,
      authMax: raw.AUTH_RATE_LIMIT_MAX,
      passwordWindowMs: raw.AUTH_PASSWORD_RATE_LIMIT_WINDOW_MS,
      passwordMax: raw.AUTH_PASSWORD_RATE_LIMIT_MAX,
    }),
    payment: Object.freeze({
      provider: raw.PAYMENT_PROVIDER.toUpperCase(),
      secret: raw.PAYMENT_SECRET,
    }),
    defaults: Object.freeze({
      currency: raw.DEFAULT_CURRENCY.toUpperCase(),
      timezone: raw.DEFAULT_TIMEZONE,
    }),
    seedOnMigrate: raw.SEED_ON_MIGRATE,
    seed: Object.freeze({
      systemAccounts: seedSystemAccounts,
      systemAccountsPassword: raw.SEED_SYSTEM_ACCOUNTS_PASSWORD,
    }),
  });
}

/**
 * Entorno validado y congelado. Importarlo valida `process.env`: cualquier
 * error de configuración se lanza durante la importación del módulo, lo que
 * aborta el arranque antes de abrir conexiones o escuchar en un puerto.
 */
export const env: AppEnv = Object.freeze(buildEnv());
