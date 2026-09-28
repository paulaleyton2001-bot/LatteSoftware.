/**
 * Semilla de RBAC: los 6 roles, los 84 permisos y la matriz rol × permiso.
 *
 * FUENTE NORMATIVA: DESIGN.md 9.1 (roles), 9.2 (permisos) y 9.3 (matriz). Este
 * fichero es la transcripción LITERAL de la matriz; no hay ninguna lógica ni
 * ningún permiso "derivado". Si mañana cambia el documento, cambia esta tabla.
 *
 * ---------------------------------------------------------------------------
 * DISCREPANCIA DEL DOCUMENTO (documentada, no corregida por nosotros)
 * ---------------------------------------------------------------------------
 * La prosa de DESIGN.md 9.3 dice "Total: 84 permisos", pero los dos apartados
 * normativos contienen 83:
 *   - 9.2 lista 83 claves `modulo:accion` en 18 módulos (7+7+2+4+3+4+7+7+6+4+6
 *     +4+5+8+4+2+2+1 = 83).
 *   - 9.3 tiene 83 filas, y sus 83 claves son EXACTAMENTE las 83 de 9.2 (mismo
 *     conjunto, sin repeticiones ni sobrantes).
 * El error esta en la prosa, no en las tablas. Se siembran 83 porque son las
 * únicas claves que el documento define en algún sitio: inventar una clave
 * "para llegar a 84" sería fabricar un permiso que ninguna ruta usa y que nadie
 * ha definido, y `GET /api/v1/meta/roles` publicaría una fila sin origen.
 * `shared/domain/permissions.ts` declara esas mismas 83 claves y una comprobación
 * cruzada en tiempo de semilla aborta si `MATRIX` y `PERMISSION_KEYS` divergen.
 * ---------------------------------------------------------------------------
 *
 * LA MATRIZ SE ESCRIBE ENTERA EN CADA EJECUCIÓN, PERO ES IDEMPOTENTE
 * (BR-RBAC-008): `role_permissions` sólo se modifica por migración o por una
 * semilla, nunca por la API. Se borra lo sembrado y se vuelve a insertar, dentro
 * de una transacción, para que el resultado sea exactamente la matriz del
 * documento y no la unión con lo que hubiera de una versión anterior. Los
 * permisos que una versión anterior hubiera asignado de más se pierden a propósito:
 * `role_permissions` no tiene columna de "asignado a mano".
 *
 * MARCAS DE LA MATRIZ (DESIGN.md 9.3)
 *  - `C` completo -> hay fila en `role_permissions`.
 *  - `P` parcial  -> TAMBIÉN hay fila. La marca significa que el SERVICE añade un
 *    filtro de pertenencia (`customerId = auth.userId`); el middleware resuelve el
 *    permiso, el service resuelve el alcance. Si `P` no se sembrara, el
 *    middleware rechazaría a un `CUSTOMER` con 403 en `PATCH /auth/me`.
 *  - `-` denegado -> sin fila, y por tanto 403.
 */
import {
  PERMISSION,
  PERMISSION_DESCRIPTION,
  PERMISSION_KEYS,
  PERMISSION_MODULE_OF,
  Role,
  type PermissionKey,
  type Role as RoleValue,
} from '../../shared/domain/index.js';
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { getConnection, type Db } from '../../shared/database/connection.js';
import { logger } from '../../shared/logger/index.js';

/** Descripción de cada rol de sistema (DESIGN.md 9.1). */
const ROLES: readonly { readonly name: RoleValue; readonly description: string }[] = Object.freeze([
  { name: Role.CUSTOMER, description: 'Cliente externo: sus pedidos, reservas, alquileres, pagos y perfil' },
  { name: Role.STAFF, description: 'Empleado interno de sala: mapa, reservas y check-in. No cobra' },
  { name: Role.CASHIER, description: 'Cajero: todo lo de STAFF más cobro, recibos y consulta de pedidos del día' },
  { name: Role.MANAGER, description: 'Gerente: catálogo, inventario, descuentos, zonas, sillas, reportes y reembolsos' },
  { name: Role.ADMIN, description: 'Administrador: todo lo de MANAGER más usuarios, roles, configuración y auditoría' },
  { name: Role.OWNER, description: 'Propietario: control total del despliegue, incluida la matriz de permisos' },
]);

/** Marcas de la matriz de DESIGN.md 9.3. */
type Mark = 'C' | 'P' | '-';

/**
 * Matriz rol × permiso, transcrita del documento.
 *
 * Las COLS son los roles en el orden EXACTO de la tabla de DESIGN.md 9.3
 * (CUSTOMER | STAFF | CASHIER | MANAGER | ADMIN | OWNER) y las FILAS los
 * permisos en el orden de DESIGN.md 9.2. Cada fila tiene 6 marcas y el orden
 * importa: una marca desplazada concedería a un cliente el alta de usuarios, o
 * se lo negaría a un propietario.
 *
 * `ANCHORS` fija esa correspondencia con filas de contraste del propio
 * documento, de modo que una transposición de columnas o de marcas haga fallar
 * la semilla en lugar de abrir un agujero de privilegios.
 */
const MATRIX: readonly { readonly key: PermissionKey; readonly marks: readonly Mark[] }[] = Object.freeze([
  // --- auth (7) ---
  { key: PERMISSION.AUTH_REGISTER, marks: ['C', '-', '-', '-', '-', '-'] },
  { key: PERMISSION.AUTH_LOGIN, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.AUTH_REFRESH, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.AUTH_LOGOUT, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.AUTH_PASSWORD_RESET, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.AUTH_PROFILE_READ, marks: ['P', 'P', 'P', 'P', 'P', 'P'] },
  { key: PERMISSION.AUTH_PROFILE_UPDATE, marks: ['P', 'P', 'P', 'P', 'P', 'P'] },

  // --- users (7) ---
  { key: PERMISSION.USERS_READ, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.USERS_CREATE, marks: ['-', '-', '-', '-', 'C', 'C'] },
  { key: PERMISSION.USERS_UPDATE, marks: ['-', '-', '-', '-', 'C', 'C'] },
  { key: PERMISSION.USERS_DELETE, marks: ['-', '-', '-', '-', 'C', 'C'] },
  { key: PERMISSION.USERS_ROLES_ASSIGN, marks: ['-', '-', '-', '-', 'C', 'C'] },
  { key: PERMISSION.USERS_STATUS_UPDATE, marks: ['-', '-', '-', '-', 'C', 'C'] },
  { key: PERMISSION.USERS_PASSWORD_RESET, marks: ['-', '-', '-', '-', 'C', 'C'] },

  // --- customers (2) ---
  { key: PERMISSION.CUSTOMERS_READ, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.CUSTOMERS_UPDATE, marks: ['P', '-', 'C', 'C', 'C', 'C'] },

  // --- business (4) ---
  { key: PERMISSION.BUSINESS_READ, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.BUSINESS_UPDATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.BUSINESS_HOURS_UPDATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.BUSINESS_HOLIDAYS_MANAGE, marks: ['-', '-', '-', 'C', 'C', 'C'] },

  // --- locations (3) ---
  { key: PERMISSION.LOCATIONS_READ, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.LOCATIONS_CREATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.LOCATIONS_UPDATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },

  // --- zones (4) ---
  { key: PERMISSION.ZONES_READ, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.ZONES_CREATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.ZONES_UPDATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.ZONES_DELETE, marks: ['-', '-', '-', 'C', 'C', 'C'] },

  // --- chairs (7) ---
  { key: PERMISSION.CHAIRS_READ, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.CHAIRS_MAP, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.CHAIRS_CREATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.CHAIRS_UPDATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.CHAIRS_DELETE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.CHAIRS_STATUS_UPDATE, marks: ['-', 'P', 'P', 'C', 'C', 'C'] },
  { key: PERMISSION.CHAIRS_HISTORY_READ, marks: ['-', '-', 'C', 'C', 'C', 'C'] },

  // --- reservations (8) ---
  { key: PERMISSION.RESERVATIONS_READ, marks: ['P', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RESERVATIONS_READ_ANY, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RESERVATIONS_CREATE, marks: ['P', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RESERVATIONS_UPDATE, marks: ['P', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RESERVATIONS_CANCEL, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RESERVATIONS_CHECKIN, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RESERVATIONS_EXTEND, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },

  // --- rentals (6) ---
  { key: PERMISSION.RENTALS_READ, marks: ['P', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RENTALS_READ_ANY, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RENTALS_CREATE, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RENTALS_EXTEND, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RENTALS_COMPLETE, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.RENTALS_CANCEL, marks: ['-', '-', '-', 'C', 'C', 'C'] },

  // --- categories (4) ---
  { key: PERMISSION.CATEGORIES_READ, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.CATEGORIES_CREATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.CATEGORIES_UPDATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.CATEGORIES_DELETE, marks: ['-', '-', '-', 'C', 'C', 'C'] },

  // --- products (6) ---
  { key: PERMISSION.PRODUCTS_READ, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.PRODUCTS_CREATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.PRODUCTS_UPDATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.PRODUCTS_DELETE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.PRODUCTS_AVAILABILITY_UPDATE, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.PRODUCTS_DUPLICATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },

  // --- inventory (4) ---
  { key: PERMISSION.INVENTORY_READ, marks: ['-', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.INVENTORY_WRITE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.INVENTORY_ADJUST, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.INVENTORY_MOVEMENTS_READ, marks: ['-', '-', 'C', 'C', 'C', 'C'] },

  // --- discounts (5) ---
  { key: PERMISSION.DISCOUNTS_READ, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.DISCOUNTS_CREATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.DISCOUNTS_UPDATE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.DISCOUNTS_DELETE, marks: ['-', '-', '-', 'C', 'C', 'C'] },
  { key: PERMISSION.DISCOUNTS_VALIDATE, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },

  // --- orders (8) ---
  { key: PERMISSION.ORDERS_READ, marks: ['P', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.ORDERS_READ_ANY, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.ORDERS_CREATE, marks: ['C', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.ORDERS_UPDATE, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.ORDERS_DELETE, marks: ['-', '-', '-', '-', 'C', 'C'] },
  { key: PERMISSION.ORDERS_CANCEL, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.ORDERS_STATUS_UPDATE, marks: ['-', 'C', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.ORDERS_RECEIPT_READ, marks: ['P', 'C', 'C', 'C', 'C', 'C'] },

  // --- payments (4) ---
  { key: PERMISSION.PAYMENTS_READ, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.PAYMENTS_READ_ANY, marks: ['-', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.PAYMENTS_CREATE, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.PAYMENTS_REFUND, marks: ['-', '-', '-', 'C', 'C', 'C'] },

  // --- reports (2) ---
  { key: PERMISSION.REPORTS_READ, marks: ['-', '-', 'C', 'C', 'C', 'C'] },
  { key: PERMISSION.REPORTS_EXPORT, marks: ['-', '-', '-', '-', 'C', 'C'] },

  // --- notifications (2) ---
  { key: PERMISSION.NOTIFICATIONS_READ, marks: ['P', 'P', 'P', 'P', 'P', 'P'] },
  { key: PERMISSION.NOTIFICATIONS_UPDATE_PREFERENCES, marks: ['P', 'P', 'P', 'P', 'P', 'P'] },

  // --- audit (1) ---
  { key: PERMISSION.AUDIT_READ, marks: ['-', '-', '-', '-', 'C', 'C'] },
]);

/**
 * Orden de las COLUMNAS de la matriz: el de la tabla de DESIGN.md 9.3, de menor a
 * mayor privilegio. NO es el orden jerárquico de 9.1 (`ROLE_HIERARCHY` va al
 * revés), y ése es exactamente el error que una transposición hiding.
 */
const MATRIX_ROLES: readonly RoleValue[] = Object.freeze([
  Role.CUSTOMER,
  Role.STAFF,
  Role.CASHIER,
  Role.MANAGER,
  Role.ADMIN,
  Role.OWNER,
]);

/**
 * Filas de contraste: permisos cuya fila en DESIGN.md 9.3 es inconfundible.
 * Si una marca se desplaza de columna, estas aserciones fallan al sembrar.
 */
const ANCHORS: readonly { readonly key: PermissionKey; readonly marks: readonly Mark[] }[] = Object.freeze([
  // Sólo un cliente puede registrarse: nadie más necesita `auth:register`.
  { key: PERMISSION.AUTH_REGISTER, marks: ['C', '-', '-', '-', '-', '-'] },
  // `users:create` es exclusivo de ADMIN y OWNER.
  { key: PERMISSION.USERS_CREATE, marks: ['-', '-', '-', '-', 'C', 'C'] },
  // `audit:read` también.
  { key: PERMISSION.AUDIT_READ, marks: ['-', '-', '-', '-', 'C', 'C'] },
  // El cajero cobra (`payments:create`) y el empleado de sala no.
  { key: PERMISSION.PAYMENTS_CREATE, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  // Un cliente sólo ve sus propias reservas: marca `P`.
  { key: PERMISSION.RESERVATIONS_CANCEL, marks: ['P', '-', 'C', 'C', 'C', 'C'] },
  // Nadie borra pedidos salvo administración superior.
  { key: PERMISSION.ORDERS_DELETE, marks: ['-', '-', '-', '-', 'C', 'C'] },
]);

/** Resultado de aplicar la semilla de RBAC. */
export interface RolesPermissionsSeedResult {
  readonly roles: number;
  readonly permissions: number;
  readonly grants: number;
  /** `true` si ya estaba sembrada y no se escribió nada. */
  readonly skipped: boolean;
}

/**
 * Aplica la semilla de RBAC. Idempotente: se puede ejecutar tantas veces como se
 * quiera y el resultado es siempre la matriz de DESIGN.md 9.3.
 *
 * Se espera a estar dentro de una transacción: el llamador (`seeds/index.ts`) la
 * abre con `runInTransactionSync`, de modo que roles, permisos y matriz entran
 * juntos o no entra nada.
 */
export function seedRolesPermissions(db: Db = getConnection()): RolesPermissionsSeedResult {
  assertMatrixIsWellFormed();

  // Idempotencia por detección: si el conteo ya coincide con la matriz, no se
  // escribe nada. Evita incluso el borrado masivo en un arranque repetido.
  const currentGrants = countRows(db, 'role_permissions');
  if (currentGrants > 0 && isAlreadySeeded(db)) {
    return {
      roles: ROLES.length,
      permissions: MATRIX.length,
      grants: currentGrants,
      skipped: true,
    };
  }

  upsertRoles(db);
  const permissionIds = upsertPermissions(db);
  const grants = rebuildRolePermissions(db, permissionIds);

  return {
    roles: ROLES.length,
    permissions: permissionIds.size,
    grants,
    skipped: false,
  };
}

/**
 * Valida la transcripción ANTES de escribir nada.
 *
 * Tres invariantes, porque una matriz mal transcrita concede permisos que nadie
 * pidió y deniega los que sí (un cajero que no puede cobrar):
 *  1. Una fila por permiso, sin duplicados.
 *  2. Seis marcas por fila: una por cada rol de `MATRIX_ROLES`.
 *  3. `MATRIX` y el catálogo `PERMISSION_KEYS` del dominio describen EXACTAMENTE
 *     el mismo conjunto. Es la comprobación cruzada que detecta que la matriz se
 *     quedó corta o que alguien añadió una clave sin darle marcas.
 */
function assertMatrixIsWellFormed(): void {
  const seen = new Set<PermissionKey>();
  for (const row of MATRIX) {
    if (seen.has(row.key)) {
      throw new Error(`La matriz de RBAC repite el permiso ${row.key}`);
    }
    seen.add(row.key);
    if (row.marks.length !== MATRIX_ROLES.length) {
      throw new Error(
        `El permiso ${row.key} tiene ${row.marks.length} marcas y cada fila debe tener ` +
          `${MATRIX_ROLES.length} (una por rol).`,
      );
    }
  }

  assertAnchors();

  const missingInMatrix = PERMISSION_KEYS.filter((key) => !seen.has(key));
  const missingInCatalog = MATRIX.map((row) => row.key).filter((key) => !PERMISSION_KEYS.includes(key));
  if (missingInMatrix.length > 0 || missingInCatalog.length > 0) {
    throw new Error(
      'La matriz de RBAC y el catálogo de permisos no coinciden. ' +
        (missingInMatrix.length > 0 ? `Sin fila en la matriz: ${missingInMatrix.join(', ')}. ` : '') +
        (missingInCatalog.length > 0 ? `Sin declarar en el dominio: ${missingInCatalog.join(', ')}.` : '') +
        ' Revise DESIGN.md 9.2/9.3 y shared/domain/permissions.ts.',
    );
  }
}

/**
 * Comprueba las filas de contraste contra la matriz completa.
 *
 * Sin esto, invertir el orden de las columnas de la matriz pasaría todos los
 *alh los demás invariantes: seguiría habiendo 6 marcas por fila, seguirían
 * siendo 83 filas y ninguna clave cambiaría de nombre. Lo único que delataría el
 * error es que un cliente tuviera `users:create`.
 */
function assertAnchors(): void {
  for (const anchor of ANCHORS) {
    const row = MATRIX.find((candidate) => candidate.key === anchor.key);
    if (row === undefined) {
      throw new Error(`Fila de contraste ausente de la matriz: ${anchor.key}`);
    }
    if (row.marks.join('') !== anchor.marks.join('')) {
      throw new Error(
        `La fila ${anchor.key} no coincide con DESIGN.md 9.3. ` +
          `Esperado ${anchor.marks.join('/')}, encontrado ${row.marks.join('/')} ` +
          `(orden de columnas: ${MATRIX_ROLES.join(', ')}).`,
      );
    }
  }
}

/**
 * `true` si `roles`, `permissions` y `role_permissions` ya coinciden EXACTAMENTE
 * con el documento.
 *
 * No basta con comparar conteos: la transposición de las columnas de la matriz
 * deja el número de filas intacto (350) y sólo permuta QUIÉN tiene cada permiso.
 * Por eso se compara el conjunto completo de pares (rol, permiso) con el que
 * exige la matriz. Son ~350 filas: coste irrelevante y comprobación real.
 */
function isAlreadySeeded(db: Db): boolean {
  if (countRows(db, 'roles') !== ROLES.length) {
    return false;
  }
  if (countRows(db, 'permissions') !== MATRIX.length) {
    return false;
  }
  if (countRows(db, 'role_permissions') !== expectedGrantCount()) {
    return false;
  }

  const actual = db
    .prepare(
      `SELECT r.name AS role, p.key AS permission
         FROM role_permissions rp
         JOIN roles r       ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id`,
    )
    .all() as { role: string; permission: string }[];
  const actualSet = new Set(actual.map((row) => `${row.role}|${row.permission}`));

  const expectedSet = new Set<string>();
  for (const row of MATRIX) {
    row.marks.forEach((mark, index) => {
      if (mark === '-') {
        return;
      }
      const role = MATRIX_ROLES[index];
      if (role !== undefined) {
        expectedSet.add(`${role}|${row.key}`);
      }
    });
  }
  if (actualSet.size !== expectedSet.size) {
    return false;
  }
  for (const pair of expectedSet) {
    if (!actualSet.has(pair)) {
      return false;
    }
  }
  return true;
}

/** Cuántas filas debe tener `role_permissions` con esta matriz. */
function expectedGrantCount(): number {
  let total = 0;
  for (const row of MATRIX) {
    for (const mark of row.marks) {
      if (mark !== '-') {
        total += 1;
      }
    }
  }
  return total;
}

/** Cuenta filas de una tabla. */
function countRows(db: Db, table: string): number {
  // `table` es un literal de este fichero, nunca entrada del cliente.
  const row = db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number } | undefined;
  return row?.total ?? 0;
}

/** Inserta o actualiza los 6 roles de sistema, con `is_system = 1`. */
function upsertRoles(db: Db): Map<RoleValue, number> {
  const statement = db.prepare(
    `INSERT INTO roles (name, description, is_system)
     VALUES (?, ?, 1)
     ON CONFLICT (name) DO UPDATE SET description = excluded.description, is_system = 1`,
  );
  const ids = new Map<RoleValue, number>();
  for (const role of ROLES) {
    statement.run(role.name, role.description);
  }
  for (const role of ROLES) {
    const row = db.prepare('SELECT id FROM roles WHERE name = ?').get(role.name) as { id: number };
    ids.set(role.name, row.id);
  }
  return ids;
}

/** Inserta o actualiza los 84 permisos y devuelve `clave -> id`. */
function upsertPermissions(db: Db): Map<PermissionKey, number> {
  const statement = db.prepare(
    `INSERT INTO permissions (key, module, description)
     VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET module = excluded.module, description = excluded.description`,
  );
  for (const row of MATRIX) {
    statement.run(row.key, PERMISSION_MODULE_OF[row.key], PERMISSION_DESCRIPTION[row.key]);
  }

  const ids = new Map<PermissionKey, number>();
  const all = db.prepare('SELECT id, key FROM permissions').all() as { id: number; key: string }[];
  for (const row of all) {
    ids.set(row.key as PermissionKey, row.id);
  }
  return ids;
}

/**
 * Reconstruye `role_permissions` desde la matriz.
 *
 * Se borra y se reinserta dentro de la transacción del seeder: el resultado es
 * exactamente el documento, sin herencias de una versión anterior de la matriz.
 * `role_permissions` no guarda historial (es un catálogo, no un registro de
 * auditoría), así que no se pierde nada por reescribirlo.
 */
function rebuildRolePermissions(db: Db, permissionIds: Map<PermissionKey, number>): number {
  const roleIds = new Map<RoleValue, number>();
  for (const role of ROLES) {
    const found = db.prepare('SELECT id FROM roles WHERE name = ?').get(role.name) as { id: number };
    roleIds.set(role.name, found.id);
  }

  db.prepare('DELETE FROM role_permissions').run();

  const insert = db.prepare('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)');
  let grants = 0;
  for (const row of MATRIX) {
    const permissionId = permissionIds.get(row.key);
    if (permissionId === undefined) {
      throw new Error(`El permiso ${row.key} no se pudo insertar: la matriz lo referencia pero no existe`);
    }
    row.marks.forEach((mark, index) => {
      if (mark === '-') {
        return;
      }
      const role = MATRIX_ROLES[index];
      if (role === undefined) {
        throw new Error(`La matriz de ${row.key} tiene una marca de más`);
      }
      const roleId = roleIds.get(role);
      if (roleId === undefined) {
        throw new Error(`El rol ${role} no se pudo insertar: la matriz lo referencia pero no existe`);
      }
      insert.run(roleId, permissionId);
      grants += 1;
    });
  }
  return grants;
}

/**
 * Aplica la semilla dentro de su propia transacción.
 *
 * Se exporta separada de `seedRolesPermissions` para que quien la llame desde
 * `seeds/index.ts` comparta una única transacción con el resto de la semilla, y
 * para que los tests puedan aplicarla sin más dependencias.
 */
export function applyRolesPermissionsSeed(): RolesPermissionsSeedResult {
  const result = runInTransactionSync(() => seedRolesPermissions());
  if (result.skipped) {
    logger.info({ grants: result.grants }, 'semilla RBAC: ya aplicada, sin cambios');
  } else {
    logger.info(
      { roles: result.roles, permissions: result.permissions, grants: result.grants },
      'semilla RBAC: 6 roles, 84 permisos y la matriz de DESIGN.md 9.3 aplicados',
    );
  }
  return result;
}
