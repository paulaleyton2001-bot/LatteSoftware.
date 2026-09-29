/**
 * Seeder de datos de arranque.
 *
 * `npm run seed` (y `src/server.ts` cuando `SEED_ON_MIGRATE=true`) ejecutan este
 * fichero. Compone las semillas, en este orden y dentro de UNA SOLA transacción
 * (`runInTransactionSync`, que abre con `BEGIN IMMEDIATE`):
 *
 *   1. `roles-permissions.seed.ts`  -> 6 roles, 83 permisos y la matriz de
 *      DESIGN.md 9.3. Es la fuente de verdad de la autorización: `requirePermission`
 *      lee `role_permissions`, y `GET /api/v1/meta/roles` publica lo que hay
 *      aquí. Sin esta semilla la API responde 503 en `/meta/roles` y ningún
 *      endpoint protegido deja pasar a nadie.
 *   2. `development-accounts.seed.ts` -> negocio singleton (`businesses.id = 1`,
 *      obligatorio porque `audit_logs.business_id` es FK `NOT NULL`) y las
 *      cuentas de sistema mínimas, desactivadas en producción.
 *   3. `spaces-demo.seed.ts` -> sede, 5 zonas y 25 sillas de demostración
 *      (API.md 7.6/7.7). Va LA CUARTA a propósito: `zones.location_id` es
 *      `NOT NULL` con FK a `locations` y `locations.business_id` con FK a
 *      `businesses`, así que el negocio (paso 2) tiene que existir antes que la
 *      sede, y la sede antes que las zonas.
 *   4. `catalog-demo.seed.ts` -> 6 categorías, 24 productos, variantes,
 *      complementos, recetas e inventario. Necesita el negocio, nada más.
 *   5. `discounts-demo.seed.ts` -> 5 cupones. Uno de ellos es de categoría, así
 *      que va DESPUÉS del catálogo.
 *   6. `operations-demo.seed.ts` -> empleados, clientes, horario del local,
 *      reservas, alquileres y 18 pedidos con su historial y sus cobros. Necesita
 *      el catálogo (para cotizar las líneas), los descuentos (para aplicar los
 *      cupones) y las sillas (para las reservas).
 *
 * El orden no es una preferencia: cada paso depende de las claves foráneas del
 * anterior y la transacción es única, así que un fallo en cualquiera no deja
 * negocio sin sede ni sede a medias.
 *
 * Los pasos 3 a 6 son DATOS DE DEMOSTRACIÓN y sólo se escriben fuera de
 * producción, o cuando `SEED_DEMO_DATA` esté apagado (ver `demo-support.ts`).
 *
 * Es IDEMPOTENTE: `npm run seed` dos veces seguidas no duplica nada, no toca
 * contraseñas ya cambiadas y no pisa la matriz de RBAC si ya es correcta. Si
 * falta el esquema inicial, falla con un mensaje accionable en vez de escribir en
 * tablas que no existen.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { logger } from '../../shared/logger/index.js';
import { seedRolesPermissions } from './roles-permissions.seed.js';
import { seedDeployment } from './development-accounts.seed.js';
import { seedSpacesDemo } from './spaces-demo.seed.js';
import { seedCatalogDemo, assertLedgerConsistency } from './catalog-demo.seed.js';
import { seedDiscountsDemo } from './discounts-demo.seed.js';
import { registerCatalogGuard, seedOperationsDemo } from './operations-demo.seed.js';
import { demoSeedEnabled } from './demo-support.js';

export {
  SYSTEM_ACCOUNTS,
  expectedSystemAccountEmails,
  seedBusiness,
  seedDeployment,
  seedSystemAccounts,
  type DeploymentSeedResult,
  type SystemAccount,
} from './development-accounts.seed.js';

export {
  DEMO_CHAIR_COUNT,
  DEMO_CHAIRS,
  DEMO_ZONES,
  DEMO_LOCATION_NAME,
  seedSpacesDemo,
  type DemoChairSpec,
  type DemoZoneSpec,
  type SpacesDemoSeedResult,
} from './spaces-demo.seed.js';

export { seedRolesPermissions, type RolesPermissionsSeedResult } from './roles-permissions.seed.js';

export { seedCatalogDemo, type CatalogDemoSeedResult } from './catalog-demo.seed.js';
export { seedDiscountsDemo, type DiscountsDemoSeedResult } from './discounts-demo.seed.js';
export { seedOperationsDemo, type OperationsDemoSeedResult } from './operations-demo.seed.js';
export { demoSeedEnabled, DEMO_DATA_ENV } from './demo-support.js';

// La semilla de operaciones necesita la comprobación de cuadre del libro de
// inventario, que vive en el catálogo. Se registra aquí, en el único módulo que
// conoce a las dos, para que el orden de los imports no importre.
registerCatalogGuard({ assertLedgerConsistency });

/** Resumen de lo que hizo una ejecución del seeder. */
export interface SeedSummary {
  /** Grupos de datos aplicados (RBAC, despliegue, espacios, demo). */
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
  readonly spaces: {
    readonly locationId: number;
    readonly locationCreated: boolean;
    readonly createdZones: number;
    readonly createdChairs: number;
    readonly reconciledChairs: number;
    readonly skipped: boolean;
  };
  /** `null` cuando los datos de demostración no se siembran (producción o flag). */
  readonly demo: {
    readonly enabled: boolean;
    readonly categories: number;
    readonly products: number;
    readonly variants: number;
    readonly addons: number;
    readonly ingredients: number;
    readonly recipes: number;
    readonly inventoryItems: number;
    readonly discounts: number;
    readonly users: number;
    readonly reservations: number;
    readonly rentals: number;
    readonly orders: number;
    readonly orderItems: number;
    readonly payments: number;
    readonly movements: number;
  } | null;
}

/** Tablas que deben existir para poder sembrar. */
const REQUIRED_TABLES = [
  'roles',
  'permissions',
  'role_permissions',
  'users',
  'user_roles',
  'businesses',
  'locations',
  'zones',
  'chairs',
] as const;

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

    // 3. Sede, zonas y sillas. `seedSpacesDemo` abre su propia unidad de trabajo,
    //    que aquí anida como SAVEPOINT: si algo falla, el rollback es el de esta
    //    transacción y no queda negocio sin sede ni sede a medias.
    const spaces = seedSpacesDemo(db);

    // 4..6. Datos de demostración. El orden lo imponen las FK: catálogo ->
    //    descuentos (uno es de categoría) -> operaciones (cotiza líneas, aplica
    //    cupones y reserva sillas).
    const demo = demoSeedEnabled()
      ? (() => {
          const catalog = seedCatalogDemo(db);
          const discounts = seedDiscountsDemo(db);
          const operations = seedOperationsDemo(db);
          return {
            enabled: true,
            categories: catalog.createdCategories,
            products: catalog.createdProducts,
            variants: catalog.createdVariants,
            addons: catalog.createdAddons,
            ingredients: catalog.createdIngredients,
            recipes: catalog.createdRecipes,
            inventoryItems: catalog.createdInventoryItems,
            discounts: discounts.created,
            users: operations.createdUsers,
            reservations: operations.createdReservations,
            rentals: operations.createdRentals,
            orders: operations.createdOrders,
            orderItems: operations.createdOrderItems,
            payments: operations.createdPayments,
            movements: operations.createdMovements,
          };
        })()
      : null;

    const demoSkipped =
      demo === null ||
      (demo.categories === 0 &&
        demo.products === 0 &&
        demo.discounts === 0 &&
        demo.users === 0 &&
        demo.reservations === 0 &&
        demo.orders === 0);

    const skipped =
      rbac.skipped &&
      !deployment.businessCreated &&
      deployment.accountsCreated === 0 &&
      spaces.skipped &&
      demoSkipped;

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
          locationId: spaces.locationId,
          zonesCreated: spaces.createdZones,
          chairsCreated: spaces.createdChairs,
          demo:
            demo === null
              ? 'desactivada'
              : {
                  categories: demo.categories,
                  products: demo.products,
                  variants: demo.variants,
                  addons: demo.addons,
                  ingredients: demo.ingredients,
                  recipes: demo.recipes,
                  inventoryItems: demo.inventoryItems,
                  discounts: demo.discounts,
                  users: demo.users,
                  reservations: demo.reservations,
                  rentals: demo.rentals,
                  orders: demo.orders,
                  orderItems: demo.orderItems,
                  payments: demo.payments,
                  movements: demo.movements,
                },
        },
        'semilla de arranque aplicada',
      );
    }

    return {
      applied: skipped ? 0 : 3 + (demo === null || demoSkipped ? 0 : 3),
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
      spaces: {
        locationId: spaces.locationId,
        locationCreated: spaces.createdLocation,
        createdZones: spaces.createdZones,
        createdChairs: spaces.createdChairs,
        reconciledChairs: spaces.reconciledChairs,
        skipped: spaces.skipped,
      },
      demo,
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
