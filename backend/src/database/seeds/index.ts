/**
 * Seeder de datos de arranque.
 *
 * `npm run seed` (y `src/server.ts` cuando `SEED_ON_MIGRATE=true`) ejecutan este
 * fichero. Compone tres semillas, en este orden y dentro de UNA SOLA
 * transacción (`runInTransactionSync`, que abre con `BEGIN IMMEDIATE`):
 *
 *   1. `roles-permissions.seed.ts`  -> 6 roles, 84 permisos y la matriz de
 *      DESIGN.md 9.3. Es la fuente de verdad de la autorización: `requirePermission`
 *      lee `role_permissions`, y `GET /api/v1/meta/roles` publica lo que hay
 *      aquí. Sin esta semilla la API responde 503 en `/meta/roles` y ningún
 *      endpoint protegido deja pasar a nadie.
 *   2. `development-accounts.seed.ts` -> negocio singleton (`businesses.id = 1`,
 *      obligatorio porque `audit_logs.business_id` es FK `NOT NULL`) y las
 *      cuentas de sistema mínimas, desactivadas en producción.
 *
 * Es IDEMPOTENTE: `npm run seed` dos veces seguidas no duplica nada, no toca
 * contraseñas ya cambiadas y no pisa la matriz de RBAC si ya es correcta.
 * Si falta el esquema inicial, falla con un mensaje accionable en vez de
 * escribir en tablas que no existen.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { logger } from '../../shared/logger/index.js';
import { seedRolesPermissions } from './roles-permissions.seed.js';
import { seedDeployment } from './development-accounts.seed.js';

export {
  SYSTEM_ACCOUNTS,
  expectedSystemAccountEmails,
  seedBusiness,
  seedDeployment,
  seedSystemAccounts,
  type DeploymentSeedResult,
  type SystemAccount,
} from './development-accounts.seed.js';

export { seedRolesPermissions, type RolesPermissionsSeedResult } from './roles-permissions.seed.js';

/** Resumen de lo que hizo una ejecución del seeder. */
export interface SeedSummary {
  /** Grupos de datos aplicados (RBAC, despliegue). */
  readonly applied: number;
  /** `true` si la semilla ya estaba completa y no hizo falta escribir. */
  readonly skipped: boolean;
  /** Detalle por grupo, para el log y para los tests. */
  readonly rbac: {
    readonly roles: number;
    readonly permissions: number;
    readonly grants: number;
    readonly skipped: boolean;
  };
  readonly deployment: {
    readonly businessCreated: boolean;
    readonly accountsCreated: number;
    readonly accountsSkipped: number;
    readonly accountsDisabled: boolean;
  };
}

/** Tablas que deben existir para poder sembrar. */
const REQUIRED_TABLES = ['roles', 'permissions', 'role_permissions', 'users', 'user_roles', 'businesses'] as const;

/**
 * Aplica la semilla de arranque. Es segura de reejecutar.
 *
 * @param db conexión a usar. Por defecto, la singleton del proceso.
 */
export function runSeed(db: Db = getConnection()): SeedSummary {
  assertSchemaReady(db);

  return runInTransactionSync(() => {
    // 1. RBAC antes que nada: las cuentas de sistema necesitan los roles para
    //    poder asignárselos, y `/meta/roles` depende de la matriz.
    const rbac = seedRolesPermissions(db);

    // 2. Negocio singleton y cuentas de sistema.
    const deployment = seedDeployment(db);

    const skipped = rbac.skipped && !deployment.businessCreated && deployment.accountsCreated === 0;
    if (skipped) {
      logger.info('semilla: la base ya estaba sembrada, no se ha escrito nada');
    } else {
      logger.info(
        {
          roles: rbac.roles,
          permissions: rbac.permissions,
          rolePermissions: rbac.grants,
          businessCreated: deployment.businessCreated,
          accountsCreated: deployment.accountsCreated,
        },
        'semilla de arranque aplicada',
      );
    }

    return {
      applied: skipped ? 0 : 2,
      skipped,
      rbac: {
        roles: rbac.roles,
        permissions: rbac.permissions,
        grants: rbac.grants,
        skipped: rbac.skipped,
      },
      deployment: {
        businessCreated: deployment.businessCreated,
        accountsCreated: deployment.accountsCreated,
        accountsSkipped: deployment.accountsSkipped,
        accountsDisabled: deployment.accountsDisabled,
      },
    } satisfies SeedSummary;
  });
}

/** Falla con un mensaje accionable si el esquema inicial no está aplicado. */
function assertSchemaReady(db: Db): void {
  const placeholders = REQUIRED_TABLES.map(() => '?').join(', ');
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type = 'table'
          AND name IN (${placeholders})`,
    )
    .get(...REQUIRED_TABLES) as { total: number } | undefined;
  const present = row?.total ?? 0;
  if (present < REQUIRED_TABLES.length) {
    throw new Error(
      `La semilla requiere el esquema inicial: faltan ${REQUIRED_TABLES.length - present} de ` +
        `${REQUIRED_TABLES.length} tablas. Ejecute \`npm run migrate\` antes de \`npm run seed\`.`,
    );
  }
}
