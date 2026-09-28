/**
 * Implementación SQLite del repositorio de autenticación.
 *
 * ÚNICO fichero del módulo `auth` con SQL (DESIGN.md 3.2). Todas las
 * consultas van con parámetros `?`; nunca se concatena entrada del usuario en
 * el texto SQL. El mapeo `snake_case` -> `camelCase` ocurre AQUÍ, no en el
 * controller (API.md 1).
 *
 * NOTA SOBRE `users.is_staff`: es una desnormalización de `user_roles`
 * (DESIGN.md 4.1) que se escribe en el mismo `INSERT`/`UPDATE` que la fila de
 * rol, dentro de la transacción del service. Si se desincronizara, el único
 * síntoma sería un filtro de listado equivocado, nunca un acceso indebido: el
 * permiso real se resuelve por `role_permissions`.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import { Role, UserStatus, isEnumValue } from '../../shared/domain/index.js';
import type {
  ActiveSessionsFilter,
  AuthRepository,
  NewUserRecord,
  SessionSortColumn,
} from './auth.repository.js';
import type {
  CredentialUser,
  NewRefreshTokenRecord,
  ProfilePatch,
  RefreshTokenRecord,
  UserProfile,
} from './auth.types.js';

/** Fila cruda de `users` (con credenciales). */
interface RawCredentialUser {
  readonly id: number;
  readonly email: string;
  readonly password_hash: string;
  readonly full_name: string;
  readonly status: string;
  readonly is_staff: 0 | 1;
  readonly deleted_at: string | null;
}

/** Fila cruda de `refresh_tokens`. */
interface RawRefreshToken {
  readonly id: number;
  readonly user_id: number;
  readonly token_hash: string;
  readonly device_info: string | null;
  readonly ip_address: string | null;
  readonly expires_at: string;
  readonly revoked_at: string | null;
  readonly replaced_by_id: number | null;
  readonly created_at: string;
}

/** Fila cruda del perfil, con roles y permisos ya agregados. */
interface RawProfile {
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
}

/** `users.status` de la BD al enum del dominio; `null` si el valor es ajeno. */
function toUserStatus(value: string): UserStatus {
  return isEnumValue(UserStatus, value) ? value : 'INACTIVE';
}

/** Convierte una fila de `users` con credenciales al DTO del módulo. */
function toCredentialUser(raw: RawCredentialUser): CredentialUser {
  return {
    id: raw.id,
    email: raw.email,
    passwordHash: raw.password_hash,
    fullName: raw.full_name,
    status: toUserStatus(raw.status),
    isStaff: raw.is_staff === 1,
    deletedAt: raw.deleted_at,
  };
}

/** Convierte una fila de `refresh_tokens` al DTO del módulo. */
function toRefreshTokenRecord(raw: RawRefreshToken): RefreshTokenRecord {
  return {
    id: raw.id,
    userId: raw.user_id,
    tokenHash: raw.token_hash,
    deviceInfo: raw.device_info,
    ipAddress: raw.ip_address,
    expiresAt: raw.expires_at,
    revokedAt: raw.revoked_at,
    replacedById: raw.replaced_by_id,
    createdAt: raw.created_at,
  };
}

/**
 * Allowlist de columnas ordenables en el listado de sesiones.
 * La clave es la salida de `parseSort` (nombre del contrato API), el valor es
 * la columna real: una allowlist por construcción, sin concatenar entrada.
 */
const SESSION_SORT_SQL: Readonly<Record<SessionSortColumn, string>> = Object.freeze({
  created_at: 'created_at',
});

/** Columnas del perfil en `users`, para el SELECT del perfil público. */
const PROFILE_COLUMNS = `
  id, email, full_name, phone, photo_url, status, is_staff,
  email_verified_at, last_login_at, created_at, updated_at
`;

/** Repositorio de autenticación sobre `better-sqlite3`. */
export class SqliteAuthRepository implements AuthRepository {
  // ---------------------------------------------------------------- lectura
  public findCredentialByEmail(email: string, db: Db = getConnection()): CredentialUser | null {
    const row = db
      .prepare(
        `SELECT id, email, password_hash, full_name, status, is_staff, deleted_at
           FROM users
          WHERE email = ?
            AND deleted_at IS NULL`,
      )
      .get(email) as RawCredentialUser | undefined;
    return row === undefined ? null : toCredentialUser(row);
  }

  public findCredentialById(id: number, db: Db = getConnection()): CredentialUser | null {
    const row = db
      .prepare(
        `SELECT id, email, password_hash, full_name, status, is_staff, deleted_at
           FROM users
          WHERE id = ?
            AND deleted_at IS NULL`,
      )
      .get(id) as RawCredentialUser | undefined;
    return row === undefined ? null : toCredentialUser(row);
  }

  public findProfileById(id: number, db: Db = getConnection()): UserProfile | null {
    const row = db
      .prepare(
        `SELECT ${PROFILE_COLUMNS}
           FROM users
          WHERE id = ?
            AND deleted_at IS NULL`,
      )
      .get(id) as RawProfile | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      phone: row.phone,
      photoUrl: row.photo_url,
      status: toUserStatus(row.status),
      isStaff: row.is_staff === 1,
      roles: this.listRoleNames(row.id, db),
      permissions: this.listPermissions(row.id, db),
      emailVerifiedAt: row.email_verified_at,
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // --------------------------------------------------------------- escritura
  public insertUser(record: NewUserRecord, db: Db = getConnection()): number {
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
      // `ux_users_email` es la garantía final de BR-SEC-010: dos registros
      // concurrentes con el mismo correo dejan pasar la comprobación previa del
      // service y chocan aquí, y la respuesta debe seguir siendo 409.
      throw translateUniqueConstraint(error, {
        code: 'EMAIL_TAKEN',
        message: 'Ya existe una cuenta con ese correo electrónico',
        field: 'email',
        index: 'ux_users_email',
      });
    }
  }

  public assignRole(userId: number, roleId: number, db: Db = getConnection()): void {
    // `OR IGNORE` hace la operación idempotente (BR-RBAC-001 admite varios roles,
    // pero no dos filas del mismo rol).
    db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleId);
  }

  public touchLastLogin(userId: number, at: string, db: Db = getConnection()): void {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(at, userId);
  }

  public updateProfile(userId: number, patch: ProfilePatch, db: Db = getConnection()): void {
    // Sólo se escriben los campos presentes: un PATCH parcial no borra lo demás.
    // Los nombres de columna salen de una lista cerrada, nunca del cliente.
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
    if (assignments.length === 0) {
      return;
    }
    params.push(userId);
    db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
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

  // ------------------------------------------------------------------ roles
  public findRoleIdByName(name: Role, db: Db = getConnection()): number | null {
    const row = db.prepare('SELECT id FROM roles WHERE name = ?').get(name) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }

  public listRoleNames(userId: number, db: Db = getConnection()): Role[] {
    const rows = db
      .prepare(
        `SELECT r.name
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ?
          ORDER BY r.id ASC`,
      )
      .all(userId) as { name: string }[];
    return rows
      .map((row) => row.name)
      .filter((name): name is Role => isEnumValue(Role, name));
  }

  public listPermissions(userId: number, db: Db = getConnection()): string[] {
    const rows = db
      .prepare(
        `SELECT DISTINCT p.key
           FROM user_roles ur
           JOIN role_permissions rp ON rp.role_id = ur.role_id
           JOIN permissions p        ON p.id = rp.permission_id
          WHERE ur.user_id = ?
          ORDER BY p.key ASC`,
      )
      .all(userId) as { key: string }[];
    return rows.map((row) => row.key);
  }

  // -------------------------------------------------------- token de reseteo
  public findUserIdByPasswordResetHash(tokenHash: string, db: Db = getConnection()): number | null {
    const row = db
      .prepare(
        `SELECT id
           FROM users
          WHERE password_reset_token_hash = ?
            AND password_reset_expires_at IS NOT NULL
            AND password_reset_expires_at > ?
            AND deleted_at IS NULL`,
      )
      .get(tokenHash, new Date().toISOString()) as { id: number } | undefined;
    return row?.id ?? null;
  }

  // ---------------------------------------------------------------- sesiones
  public insertRefreshToken(record: NewRefreshTokenRecord, db: Db = getConnection()): number {
    const result = db
      .prepare(
        `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.userId,
        record.tokenHash,
        record.deviceInfo,
        record.ipAddress,
        record.expiresAt,
      );
    return Number(result.lastInsertRowid);
  }

  public findRefreshTokenByHash(tokenHash: string, db: Db = getConnection()): RefreshTokenRecord | null {
    const row = db
      .prepare(
        `SELECT id, user_id, token_hash, device_info, ip_address,
                expires_at, revoked_at, replaced_by_id, created_at
           FROM refresh_tokens
          WHERE token_hash = ?`,
      )
      .get(tokenHash) as RawRefreshToken | undefined;
    return row === undefined ? null : toRefreshTokenRecord(row);
  }

  public findRefreshTokenByIdForUser(id: number, userId: number, db: Db = getConnection()): RefreshTokenRecord | null {
    const row = db
      .prepare(
        `SELECT id, user_id, token_hash, device_info, ip_address,
                expires_at, revoked_at, replaced_by_id, created_at
           FROM refresh_tokens
          WHERE id = ?
            AND user_id = ?`,
      )
      .get(id, userId) as RawRefreshToken | undefined;
    return row === undefined ? null : toRefreshTokenRecord(row);
  }

  public revokeRefreshToken(
    id: number,
    revokedAt: string,
    replacedById: number | null,
    db: Db = getConnection(),
  ): boolean {
    // `revoked_at IS NULL` en el WHERE hace la operación idempotente: una
    // sesión ya revocada no se vuelve a tocar y `changes` vale 0.
    const result = db
      .prepare(
        `UPDATE refresh_tokens
            SET revoked_at = ?,
                replaced_by_id = COALESCE(?, replaced_by_id)
          WHERE id = ?
            AND revoked_at IS NULL`,
      )
      .run(revokedAt, replacedById, id);
    return result.changes > 0;
  }

  public revokeAllRefreshTokens(userId: number, revokedAt: string, db: Db = getConnection()): number {
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

  public listActiveSessions(filter: ActiveSessionsFilter, db: Db = getConnection()): RefreshTokenRecord[] {
    // La columna sale de una allowlist interna: nunca del cliente.
    const column = SESSION_SORT_SQL[filter.sort.column];
    const direction = filter.sort.direction;
    const rows = db
      .prepare(
        `SELECT id, user_id, token_hash, device_info, ip_address,
                expires_at, revoked_at, replaced_by_id, created_at
           FROM refresh_tokens
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND expires_at > ?
          ORDER BY ${column} ${direction}, id ${direction}
          LIMIT ? OFFSET ?`,
      )
      .all(filter.userId, new Date().toISOString(), filter.limit, filter.offset) as RawRefreshToken[];
    return rows.map(toRefreshTokenRecord);
  }

  public countActiveSessions(userId: number, db: Db = getConnection()): number {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total
           FROM refresh_tokens
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND expires_at > ?`,
      )
      .get(userId, new Date().toISOString()) as { total: number } | undefined;
    return row?.total ?? 0;
  }
}
