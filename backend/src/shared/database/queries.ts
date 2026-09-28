/**
 * Consultas de sólo lectura usadas por los middlewares y por el módulo system.
 *
 * ESTE ES EL ÚNICO LUGAR (junto con `migrator.ts`) donde el middleware puede
 * tocar SQL. Los services futureiros usarán repositorios propios; esta capa
 * existe para que `authenticate`/`authorize` y `GET /api/v1/meta/*` no
 * escriban SQL fuera de la capa de persistencia.
 *
 * Todas las consultas leen de una vista ya filtrada por `deleted_at`; ningún
 * middleware asume la existencia de tablas: si la migración inicial no se ha
 * aplicado, la consulta falla y el endpoint responde 503, nunca 500.
 */
import { getConnection, type Db } from './connection.js';

/** Fila de `users` con los campos que el middleware necesita. Nunca el hash. */
export interface UserAuthRow {
  readonly id: number;
  readonly email: string;
  readonly full_name: string;
  readonly status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  readonly is_staff: 0 | 1;
  readonly deleted_at: string | null;
}

/** Rol del usuario (`roles.name`). */
export type UserRoleName =
  | 'CUSTOMER'
  | 'STAFF'
  | 'CASHIER'
  | 'MANAGER'
  | 'ADMIN'
  | 'OWNER';

/** Ajustes de negocio usados por `GET /api/v1/meta/enums`. */
export interface BusinessSettingsRow {
  readonly id: number;
  readonly currency_code: string;
  readonly currency_symbol: string;
  readonly locale: string;
  readonly timezone: string;
}

/** Carga el usuario por id. Devuelve `null` si no existe o está soft-deleted. */
export function findUserAuthById(userId: number, db: Db = getConnection()): UserAuthRow | null {
  const row = db
    .prepare(
      `SELECT id, email, full_name, status, is_staff, deleted_at
         FROM users
        WHERE id = ?
          AND deleted_at IS NULL`,
    )
    .get(userId) as UserAuthRow | undefined;
  return row ?? null;
}

/** Carga el usuario por correo (siempre en minúsculas, ver DESIGN.md 4.1). */
export function findUserAuthByEmail(email: string, db: Db = getConnection()): UserAuthRow | null {
  const row = db
    .prepare(
      `SELECT id, email, full_name, status, is_staff, deleted_at
         FROM users
        WHERE email = ?
          AND deleted_at IS NULL`,
    )
    .get(email.trim().toLowerCase()) as UserAuthRow | undefined;
  return row ?? null;
}

/** Roles del usuario a través de `user_roles` + `roles`. */
export function findUserRoles(userId: number, db: Db = getConnection()): UserRoleName[] {
  const rows = db
    .prepare(
      `SELECT r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
        ORDER BY r.id ASC`,
    )
    .all(userId) as { name: UserRoleName }[];
  return rows.map((row) => row.name);
}

/**
 * Permisos efectivos del usuario: unión de los de todos sus roles.
 * La comprobación real de RBAC se hace contra estas filas, no contra una
 * matriz hardcodeada (DESIGN.md 9.3).
 */
export function findUserPermissions(userId: number, db: Db = getConnection()): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = ?
        ORDER BY p.key ASC`,
    )
    .all(userId) as { key: string }[];
  return rows.map((row) => row.key);
}

/** Ajustes del negocio activo. `null` si aún no se ha sembrado `businesses`. */
export function findActiveBusiness(db: Db = getConnection()): BusinessSettingsRow | null {
  const row = db
    .prepare(
      `SELECT id, currency_code, currency_symbol, locale, timezone
         FROM businesses
        ORDER BY id ASC
        LIMIT 1`,
    )
    .get() as BusinessSettingsRow | undefined;
  return row ?? null;
}

/** `true` si la tabla de migraciones existe y no hay pendientes críticos. */
export function hasSchema(db: Db = getConnection()): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total
         FROM sqlite_master
        WHERE type = 'table'
          AND name = 'users'`,
    )
    .get() as { total: number } | undefined;
  return (row?.total ?? 0) > 0;
}

/** Fila de `roles` para `GET /meta/roles`. */
export interface RoleRow {
  readonly id: number;
  readonly name: string;
  readonly description: string | null;
  readonly is_system: 0 | 1;
}

/** Fila de `permissions` para `GET /meta/roles`. */
export interface PermissionRow {
  readonly key: string;
  readonly module: string;
  readonly description: string | null;
}

/** Par (rol, permiso) de `role_permissions`. */
export interface RolePermissionRow {
  readonly role_name: string;
  readonly permission_key: string;
}

/** Filas de `roles` ordenadas por id. */
export function listRoles(db: Db = getConnection()): RoleRow[] {
  return db
    .prepare('SELECT id, name, description, is_system FROM roles ORDER BY id ASC')
    .all() as RoleRow[];
}

/** Filas de `permissions` ordenadas por clave. */
export function listPermissions(db: Db = getConnection()): PermissionRow[] {
  return db
    .prepare('SELECT key, module, description FROM permissions ORDER BY key ASC')
    .all() as PermissionRow[];
}

/** Pares (rol, permiso) que rellenan la matriz de RBAC. */
export function listRolePermissions(db: Db = getConnection()): RolePermissionRow[] {
  return db
    .prepare(
      `SELECT r.name AS role_name, p.key AS permission_key
         FROM role_permissions rp
         JOIN roles r        ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        ORDER BY r.id ASC, p.key ASC`,
    )
    .all() as RolePermissionRow[];
}
