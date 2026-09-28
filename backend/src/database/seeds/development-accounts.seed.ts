/**
 * Semilla de despliegue: negocio singleton y cuentas de sistema mínimas.
 *
 * ============================== POR QUÉ EXISTE ==============================
 * 1. `businesses` (DESIGN.md 4.2): en v1 hay un negocio por despliegue y el
 *    documento dice que está sembrado con `id = 1`. La migración `0001_init.sql`
 *    NO lo hace (crea el esquema, no datos), así que el negocio se siembra aquí.
 *    Es obligatorio: `audit_logs.business_id` es `NOT NULL` con FK a
 *    `businesses(id)`, y sin esta fila la auditoría de un login fallaría.
 * 2. Cuentas de sistema (admin, cajero, gerente, propietario) para poder operar
 *    el POS recién migrado. NO son datos de negocio: la semilla de empleados y
 *    clientes reales es de otra fase.
 *
 * ============================== SEGURIDAD ===================================
 *  - Las cuentas se crean SÓLO si `env.seed.systemAccounts` es `true`, y
 *    `config/env.ts` lo fuerza a `false` en `APP_ENV=production` (y aborta el
 *    arranque si alguien intenta activarlo ahí). Una contraseña compartida en un
 *    repositorio es una puerta abierta.
 *  - La contraseña sale de `SEED_SYSTEM_ACCOUNTS_PASSWORD` (nunca hardcodeada en
 *    el código) y se valida contra la política de contraseñas.
 *  - Es IDEMPOTENTE y NO destructiva: si la cuenta ya existe no se toca. En
 *    particular no se RESTABLECE la contraseña de una cuenta existente, porque
 *    eso dejaría a un humano fuera de su propia cuenta en cada `npm run seed`.
 *  - `email_verified_at` se rellena: son cuentas creadas por el despliegue, no
 *    direcciones que un usuario tenga que confirmar.
 */
import { env } from '../../config/index.js';
import { AUTH } from '../../config/constants.js';
import { getConnection, type Db } from '../../shared/database/connection.js';
import { Role, type Role as RoleValue } from '../../shared/domain/index.js';
import { logger } from '../../shared/logger/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import { assertPasswordPolicy, hashPassword } from '../../modules/auth/password.service.js';

/** Nombre por defecto del negocio singleton. */
export const DEFAULT_BUSINESS_NAME = 'LatteCoffe';

/** Cuentas de sistema mínimas, con su rol (DESIGN.md 9.1). */
export interface SystemAccount {
  readonly email: string;
  readonly fullName: string;
  readonly role: RoleValue;
}

export const SYSTEM_ACCOUNTS: readonly SystemAccount[] = Object.freeze([
  { email: 'owner@lattecoffe.co', fullName: 'Propietario', role: Role.OWNER },
  { email: 'admin@lattecoffe.co', fullName: 'Administrador', role: Role.ADMIN },
  { email: 'manager@lattecoffe.co', fullName: 'Gerente', role: Role.MANAGER },
  { email: 'cajero@lattecoffe.co', fullName: 'Cajero', role: Role.CASHIER },
]);

/** Resultado de aplicar la semilla de despliegue. */
export interface DeploymentSeedResult {
  /** `true` si el negocio ya existía y no se escribió. */
  readonly businessCreated: boolean;
  /** Cuentas creadas en esta ejecución. */
  readonly accountsCreated: number;
  /** Cuentas omitidas por existir ya. */
  readonly accountsSkipped: number;
  /** `true` si las cuentas están desactivadas (producción, o flag apagado). */
  readonly accountsDisabled: boolean;
}

/**
 * Siembra el negocio singleton con los valores por defecto de DESIGN.md 4.2
 * (COP, es_CO, America/Bogota, IVA 19 %, prefijo de pedidos `ORD`).
 *
 * `INSERT OR IGNORE` sobre `id = 1`: si el despliegue ya tiene un negocio
 * configurado, esta semilla no toca sus ajustes.
 */
export function seedBusiness(db: Db = getConnection()): boolean {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO businesses (id, name, country, currency_code, currency_symbol, locale, timezone)
       VALUES (?, ?, 'CO', 'COP', '$', 'es_CO', 'America/Bogota')`,
    )
    .run(AUTH.DEFAULT_BUSINESS_ID, DEFAULT_BUSINESS_NAME);
  return result.changes > 0;
}

/**
 * Crea las cuentas de sistema que falten.
 *
 * @param db conexión dentro de la transacción del seeder.
 * @param password contraseña de desarrollo, ya validada por el llamador.
 * @returns cuántas se crearon y cuántas ya existían.
 */
export function seedSystemAccounts(
  password: string,
  db: Db = getConnection(),
): { readonly created: number; readonly skipped: number } {
  if (!env.seed.systemAccounts) {
    logger.info('semilla de despliegue: cuentas de sistema desactivadas (producción o flag apagado)');
    return { created: 0, skipped: SYSTEM_ACCOUNTS.length };
  }

  assertPasswordPolicy(password, 'password');

  // Consulta SIN placeholders a propósito: better-sqlite3 exige que el número de
  // parámetros coincida exactamente con los `?`, así que un `?` sin parámetro (o
  // un parámetro sin `?`) revienta. Aquí se listan los correos ya usados para no
  // chocar con `ux_users_email`.
  const existing = db.prepare('SELECT email FROM users').all() as { email: string }[];
  const known = new Set(existing.map((row) => row.email));

  const findRole = db.prepare('SELECT id FROM roles WHERE name = ?');
  const insertUser = db.prepare(
    `INSERT INTO users (email, password_hash, full_name, status, email_verified_at, is_staff)
     VALUES (?, ?, ?, 'ACTIVE', ?, 1)`,
  );
  const insertRole = db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)');
  const hash = hashPassword(password);
  const verifiedAt = nowIso();

  let created = 0;
  let skipped = 0;
  for (const account of SYSTEM_ACCOUNTS) {
    if (known.has(account.email)) {
      skipped += 1;
      continue;
    }
    const role = findRole.get(account.role) as { id: number } | undefined;
    if (role === undefined) {
      throw new Error(
        `No se puede crear la cuenta ${account.email}: el rol ${account.role} no está sembrado. ` +
          'Ejecute la semilla de RBAC antes que esta.',
      );
    }
    const inserted = insertUser.run(account.email, hash, account.fullName, verifiedAt);
    insertRole.run(Number(inserted.lastInsertRowid), role.id);
    created += 1;
  }

  if (created > 0) {
    logger.warn(
      { created, emails: SYSTEM_ACCOUNTS.map((account) => account.email) },
      'semilla de despliegue: cuentas de sistema creadas con contraseña de DESARROLLO. ' +
        'Cambie estas contraseñas antes de abrir el local.',
    );
  }

  return { created, skipped };
}

/**
 * Aplica la semilla de despliegue. La transacción la abre `seeds/index.ts`.
 *
 * @param db conexión dentro de la transacción del seeder.
 */
export function seedDeployment(db: Db = getConnection()): DeploymentSeedResult {
  const businessCreated = seedBusiness(db);
  const accounts = seedSystemAccounts(env.seed.systemAccountsPassword, db);
  return {
    businessCreated,
    accountsCreated: accounts.created,
    accountsSkipped: accounts.skipped,
    accountsDisabled: !env.seed.systemAccounts,
  };
}

/** Cuentas de sistema que se esperan en una base de desarrollo sembrada. */
export function expectedSystemAccountEmails(): readonly string[] {
  return SYSTEM_ACCOUNTS.map((account) => account.email);
}
