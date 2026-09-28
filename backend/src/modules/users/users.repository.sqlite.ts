/**
 * Implementación SQLite del repositorio de usuarios.
 *
 * ÚNICO fichero del módulo con SQL. Puntos que merecen atención:
 *
 *  - **Sin N+1**: `list()` y `findById()` resuelven roles y permisos con
 *    consultas aparte agrupadas por `user_id`, no con una consulta por fila. Con
 *    20 usuarios por página son 3 consultas, no 40 (DESIGN.md 1.3, prioridad 5).
 *  - **Orden estable**: `ORDER BY <columna validada> <dir>, u.id <dir>`. La
 *    columna sale de una allowlist interna; el cliente nunca la escribe en el SQL.
 *  - **Soft delete**: todo filtro de listado y de lectura exige
 *    `deleted_at IS NULL`. Un usuario borrado lógicamente sigue teniendo pedidos
 *    y auditoría, y por eso no se borra físicamente.
 *  - **Roles de cliente**: un cliente es un `users` con rol `CUSTOMER`, así que
 *    el filtro por rol se resuelve con un `EXISTS` sobre `user_roles`.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import { Role, UserStatus, isEnumValue } from '../../shared/domain/index.js';
import type {
  DirectoryUserPatch,
  NewDirectoryUser,
  RoleRef,
  UserSortColumn,
  UsersRepository,
  UserListFilter,
} from './users.repository.js';
import type { AdminUserView } from './users.types.js';

/** Fila cruda de `users` para la vista administrativa. */
interface RawDirectoryUser {
  readonly id: number;
  readonly email: string;
  readonly full_name: string;
  readonly phone: string | null;
  readonly photo_url: string | null;
  readonly status: string;
  readonly is_staff: 0 | 1;
  readonly email_verified_at: string | null;
  readonly last_login_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

/** Fila de `roles` con la información que necesita el service. */
interface RawRoleRef {
  readonly id: number;
  readonly name: string;
  readonly is_system: 0 | 1;
}

/** Par (user_id, role name) de la consulta agrupada de roles. */
interface RawUserRole {
  readonly user_id: number;
  readonly name: string;
}

/** Par (user_id, permission key) de la consulta agrupada de permisos. */
interface RawUserPermission {
  readonly user_id: number;
  readonly key: string;
}

/** Columnas de la vista de usuario. */
const USER_COLUMNS = `
  id, email, full_name, phone, photo_url, status, is_staff,
  email_verified_at, last_login_at, created_at, updated_at, deleted_at
`;

/**
 * Allowlist de columnas ordenables (clave = salida de `parseSort`,
 * valor = columna real). `last_login_at` es la de uso más frecuente para auditar
 * accesos, y `full_name` para ordenar la agenda.
 */
const SORT_SQL: Readonly<Record<UserSortColumn, string>> = Object.freeze({
  created_at: 'u.created_at',
  full_name: 'u.full_name',
  last_login_at: 'u.last_login_at',
});

/** Traduce el `status` de la BD al enum del dominio. */
function toUserStatus(value: string): UserStatus {
  return isEnumValue(UserStatus, value) ? value : UserStatus.INACTIVE;
}

/** Convierte la fila cruda en la vista de administración, sin roles. */
function toView(raw: RawDirectoryUser): AdminUserView {
  return {
    id: raw.id,
    email: raw.email,
    fullName: raw.full_name,
    phone: raw.phone,
    photoUrl: raw.photo_url,
    status: toUserStatus(raw.status),
    isStaff: raw.is_staff === 1,
    roles: [],
    permissions: [],
    emailVerifiedAt: raw.email_verified_at,
    lastLoginAt: raw.last_login_at,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    deletedAt: raw.deleted_at,
  };
}

/** Convierte la fila de `roles` en el DTO del service. */
function toRoleRef(raw: RawRoleRef): RoleRef {
  return {
    id: raw.id,
    name: isEnumValue(Role, raw.name) ? raw.name : Role.CUSTOMER,
    isSystem: raw.is_system === 1,
  };
}

/** Roles por usuario, indexados para no repetir la consulta por fila. */
function rolesByUser(userIds: readonly number[], db: Db): Map<number, Role[]> {
  const result = new Map<number, Role[]>();
  if (userIds.length === 0) {
    return result;
  }
  const placeholders = userIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT ur.user_id, r.name
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id IN (${placeholders})
        ORDER BY r.id ASC`,
    )
    .all(...userIds) as RawUserRole[];
  for (const row of rows) {
    if (!isEnumValue(Role, row.name)) {
      continue;
    }
    const list = result.get(row.user_id) ?? [];
    list.push(row.name);
    result.set(row.user_id, list);
  }
  return result;
}

/** Permisos por usuario (unión de los de todos sus roles, BR-RBAC-001). */
function permissionsByUser(userIds: readonly number[], db: Db): Map<number, string[]> {
  const result = new Map<number, string[]>();
  if (userIds.length === 0) {
    return result;
  }
  const placeholders = userIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT ur.user_id, p.key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p        ON p.id = rp.permission_id
        WHERE ur.user_id IN (${placeholders})
        GROUP BY ur.user_id, p.key
        ORDER BY p.key ASC`,
    )
    .all(...userIds) as RawUserPermission[];
  for (const row of rows) {
    const list = result.get(row.user_id) ?? [];
    list.push(row.key);
    result.set(row.user_id, list);
  }
  return result;
}

/** `WHERE` compartido por `list` y `count`, con sus parámetros en orden. */
function buildWhere(filter: Omit<UserListFilter, 'limit' | 'offset' | 'sort'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = ['u.deleted_at IS NULL'];
  const params: unknown[] = [];

  if (filter.status !== undefined) {
    clauses.push('u.status = ?');
    params.push(filter.status);
  }
  if (filter.isStaff !== undefined) {
    clauses.push('u.is_staff = ?');
    params.push(filter.isStaff ? 1 : 0);
  }
  if (filter.q !== undefined) {
    // El comodín va en el parámetro, no en el SQL: el texto del cliente jamás se
    // concatena. `LIKE` es case-insensitive para ASCII en SQLite, así que
    // cubre la búsqueda por email sin duplicar la columna en minúsculas.
    const pattern = `%${filter.q}%`;
    clauses.push('(u.email LIKE ? OR u.full_name LIKE ?)');
    params.push(pattern, pattern);
  }
  if (filter.role !== undefined) {
    clauses.push(
      'EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = ?)',
    );
    params.push(filter.role);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio del directorio de usuarios sobre `better-sqlite3`. */
export class SqliteUsersRepository implements UsersRepository {
  public list(filter: UserListFilter, db: Db = getConnection()): readonly AdminUserView[] {
    const where = buildWhere(filter);
    // La columna sale de la allowlist interna: nunca del cliente.
    const column = SORT_SQL[filter.sort.column];
    const rows = db
      .prepare(
        `SELECT ${USER_COLUMNS}
           FROM users u
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, u.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as RawDirectoryUser[];

    const views = rows.map(toView);
    const roles = rolesByUser(views.map((view) => view.id), db);
    const permissions = permissionsByUser(views.map((view) => view.id), db);
    return views.map((view) => ({
      ...view,
      roles: roles.get(view.id) ?? [],
      permissions: permissions.get(view.id) ?? [],
    }));
  }

  public count(filter: Omit<UserListFilter, 'limit' | 'offset'>, db: Db = getConnection()): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findById(id: number, db: Db = getConnection()): AdminUserView | null {
    // `deleted_at IS NULL` es obligatorio: API.md 4 dice que un recurso
    // soft-deleted responde 404, igual que si no existiera. Sin este filtro un
    // usuario dado de baja seguiría siendo editable por el panel.
    const row = db
      .prepare(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = ? AND u.deleted_at IS NULL`)
      .get(id) as RawDirectoryUser | undefined;
    if (row === undefined) {
      return null;
    }
    const view = toView(row);
    const roles = rolesByUser([view.id], db).get(view.id) ?? [];
    const permissions = permissionsByUser([view.id], db).get(view.id) ?? [];
    return { ...view, roles, permissions };
  }

  public findIdByEmail(email: string, db: Db = getConnection()): number | null {
    const row = db
      .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
      .get(email) as { id: number } | undefined;
    return row?.id ?? null;
  }

  public findRoleByName(name: Role, db: Db = getConnection()): RoleRef | null {
    const row = db
      .prepare('SELECT id, name, is_system FROM roles WHERE name = ?')
      .get(name) as RawRoleRef | undefined;
    return row === undefined ? null : toRoleRef(row);
  }

  public findRoleById(id: number, db: Db = getConnection()): RoleRef | null {
    const row = db
      .prepare('SELECT id, name, is_system FROM roles WHERE id = ?')
      .get(id) as RawRoleRef | undefined;
    return row === undefined ? null : toRoleRef(row);
  }

  public listRoleIds(userId: number, db: Db = getConnection()): readonly number[] {
    const rows = db
      .prepare('SELECT role_id FROM user_roles WHERE user_id = ? ORDER BY role_id ASC')
      .all(userId) as { role_id: number }[];
    return rows.map((row) => row.role_id);
  }

  public hasRole(userId: number, roleId: number, db: Db = getConnection()): boolean {
    const row = db
      .prepare('SELECT 1 AS found FROM user_roles WHERE user_id = ? AND role_id = ?')
      .get(userId, roleId) as { found: number } | undefined;
    return row !== undefined;
  }

  public countUsersWithRole(roleId: number, db: Db = getConnection()): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM user_roles ur
           JOIN users u ON u.id = ur.user_id
          WHERE ur.role_id = ?
            AND u.deleted_at IS NULL`,
      )
      .get(roleId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public insert(record: NewDirectoryUser, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO users (email, password_hash, full_name, phone, photo_url, is_staff)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.email,
          record.passwordHash,
          record.fullName,
          record.phone,
          record.photoUrl,
          record.isStaff ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'EMAIL_TAKEN',
        message: 'Ya existe una cuenta con ese correo electrónico',
        field: 'email',
        index: 'ux_users_email',
      });
    }
  }

  public assignRole(userId: number, roleId: number, db: Db = getConnection()): void {
    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleId);
  }

  public removeRole(userId: number, roleId: number, db: Db = getConnection()): boolean {
    const result = db
      .prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?')
      .run(userId, roleId);
    return result.changes > 0;
  }

  public syncIsStaff(userId: number, db: Db = getConnection()): void {
    // `is_staff` es la desnormalización de DESIGN.md 4.1: 1 si el usuario tiene
    // algún rol interno. Se recalcula aquí y no se mantiene "a ojo" en cada
    // endpoint, para que un alta con dos roles no deje la columna a medias.
    db.prepare(
      `UPDATE users
          SET is_staff = (
            SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
              FROM user_roles ur
              JOIN roles r ON r.id = ur.role_id
             WHERE ur.user_id = users.id
               AND r.name <> ?
          )
        WHERE id = ?`,
    ).run(Role.CUSTOMER, userId);
  }

  public update(userId: number, patch: DirectoryUserPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.fullName !== undefined) {
      assignments.push('full_name = ?');
      params.push(patch.fullName);
    }
    if (patch.phone !== undefined) {
      assignments.push('phone = ?');
      params.push(patch.phone);
    }
    if (patch.photoUrl !== undefined) {
      assignments.push('photo_url = ?');
      params.push(patch.photoUrl);
    }
    if (patch.email !== undefined) {
      assignments.push('email = ?');
      params.push(patch.email);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(userId);
    try {
      db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      // El email es la única columna con unicidad en un UPDATE, así que una
      // violación aquí sólo puede ser `ux_users_email`.
      throw translateUniqueConstraint(error, {
        code: 'EMAIL_TAKEN',
        message: 'Ya existe una cuenta con ese correo electrónico',
        field: 'email',
        index: 'ux_users_email',
      });
    }
  }

  public softDelete(userId: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare("UPDATE users SET deleted_at = ?, status = 'INACTIVE' WHERE id = ?").run(
      deletedAt,
      userId,
    );
  }

  public updateStatus(userId: number, status: UserStatus, db: Db = getConnection()): void {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
  }

  public updatePassword(userId: number, passwordHash: string, db: Db = getConnection()): void {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
  }

  public setPasswordReset(userId: number, tokenHash: string, expiresAt: string, db: Db = getConnection()): void {
    db.prepare(
      'UPDATE users SET password_reset_token_hash = ?, password_reset_expires_at = ? WHERE id = ?',
    ).run(tokenHash, expiresAt, userId);
  }

  public clearPasswordReset(userId: number, db: Db = getConnection()): void {
    db.prepare(
      'UPDATE users SET password_reset_token_hash = NULL, password_reset_expires_at = NULL WHERE id = ?',
    ).run(userId);
  }

  public revokeAllSessions(userId: number, revokedAt: string, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `UPDATE refresh_tokens
            SET revoked_at = ?
          WHERE user_id = ?
            AND revoked_at IS NULL`,
      )
      .run(revokedAt, userId);
    return result.changes;
  }
}
