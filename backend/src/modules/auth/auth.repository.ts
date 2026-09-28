/**
 * Contrato de persistencia del módulo `auth`.
 *
 * ============ POR QUÉ ES UNA INTERFAZ Y NO UNA CLASE ==================
 * El service de autenticación depende de ESTE contrato, nunca de SQLite
 * (DESIGN.md 3.1, regla P3). La implementación vive en
 * `auth.repository.sqlite.ts`, que es el único fichero del módulo con SQL.
 * Gracias a esto, los tests pueden sustituir el repositorio por un doble sin
 * tocar la base de datos, y la migración a PostgreSQL (DESIGN.md 10) sólo
 * obliga a reescribir la implementación.
 *
 * REGLAS DE DISEÑO QUE RESPETA (DESIGN.md 3.2/3.3):
 *  - Un método = una cosa. Nada de "insertUserWithRolesAndAudit".
 *  - Ningún método abre ni cierra transacción: la abre el service con
 *    `runInTransactionSync` y la conexión llega por parámetro o por el
 *    singleton de `shared/database/connection.ts`.
 *  - Los identificadores dinámicos (columna de orden) NO se interpolan desde
 *    fuera: se interpolan desde una allowlist interna del repositorio.
 */
import type { Db } from '../../shared/database/connection.js';
import type { Role } from '../../shared/domain/index.js';
import type {
  CredentialUser,
  NewRefreshTokenRecord,
  ProfilePatch,
  RefreshTokenRecord,
  UserProfile,
} from './auth.types.js';

/** Columnas permitidas como criterio de orden en `GET /auth/sessions`. */
export type SessionSortColumn = 'created_at';

/** Orden ya validado por el middleware `validate`. */
export interface SessionSort {
  readonly column: SessionSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** Datos mínimos para insertar un usuario nuevo. */
export interface NewUserRecord {
  readonly email: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly photoUrl: string | null;
  readonly isStaff: boolean;
}

/** Filtros del listado de sesiones activas. */
export interface ActiveSessionsFilter {
  readonly userId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: SessionSort;
}

/**
 * Repositorio de autenticación: credenciales, perfil, roles y sesiones.
 *
 * El módulo `users` tiene su propio repositorio para el DIRECTORIO de usuarios
 * (listados, filtros, soft delete, gestión de roles). La división es
 * intencionada: aquí vive lo que la autenticación necesita para decidir si una
 * petición es válida.
 */
export interface AuthRepository {
  // --- Identidad: lecturas con credencial -------------------------------
  /** Usuario por email normalizado. `null` si no existe o está soft-deleted. */
  findCredentialByEmail(email: string, db?: Db): CredentialUser | null;
  /** Usuario por id. `null` si no existe o está soft-deleted. */
  findCredentialById(id: number, db?: Db): CredentialUser | null;
  /** Perfil público (con roles y permisos resueltos) por id. */
  findProfileById(id: number, db?: Db): UserProfile | null;

  // --- Identidad: escrituras --------------------------------------------
  /** Inserta en `users` y devuelve el id generado. */
  insertUser(record: NewUserRecord, db?: Db): number;
  /** Inserta la fila en `user_roles`. Idempotente (`INSERT OR IGNORE`). */
  assignRole(userId: number, roleId: number, db?: Db): void;
  /** Registra el último login efectivo. */
  touchLastLogin(userId: number, at: string, db?: Db): void;
  /** Actualiza los campos de perfil indicados. `patch` ya viene validado. */
  updateProfile(userId: number, patch: ProfilePatch, db?: Db): void;
  /** Sustituye `password_hash`. */
  updatePassword(userId: number, passwordHash: string, db?: Db): void;
  /** Guarda el hash sha256 del token de reseteo y su expiración. */
  setPasswordReset(userId: number, tokenHash: string, expiresAt: string, db?: Db): void;
  /** Invalida el token de reseteo (uso único). */
  clearPasswordReset(userId: number, db?: Db): void;

  // --- Roles y permisos ---------------------------------------------------
  /** `id` de un rol por nombre, o `null` si el rol no existe. */
  findRoleIdByName(name: Role, db?: Db): number | null;
  /** Nombres de los roles del usuario, ordenados por `roles.id`. */
  listRoleNames(userId: number, db?: Db): Role[];
  /** Unión de los permisos de todos sus roles (BR-RBAC-001). */
  listPermissions(userId: number, db?: Db): string[];

  // --- Tokens de reseteo --------------------------------------------------
  /** Busca el usuario con ese hash de reseteo vigente. */
  findUserIdByPasswordResetHash(tokenHash: string, db?: Db): number | null;

  // --- Sesiones (refresh_tokens) ------------------------------------------
  /** Inserta una sesión y devuelve su id (= `sid` del access token). */
  insertRefreshToken(record: NewRefreshTokenRecord, db?: Db): number;
  /** Sesión por sha256 del token. Incluye las revocadas: hay que distinguirlas. */
  findRefreshTokenByHash(tokenHash: string, db?: Db): RefreshTokenRecord | null;
  /** Sesión por id, acotada a un usuario. */
  findRefreshTokenByIdForUser(id: number, userId: number, db?: Db): RefreshTokenRecord | null;
  /**
   * Revoca una sesión. Devuelve `false` si ya estaba revocada (así el endpoint
   * `DELETE /auth/sessions/:id` puede responder con `ALREADY_REVOKED`).
   */
  revokeRefreshToken(id: number, revokedAt: string, replacedById: number | null, db?: Db): boolean;
  /** Revoca todas las sesiones vivas del usuario. Devuelve cuántas revocó. */
  revokeAllRefreshTokens(userId: number, revokedAt: string, db?: Db): number;
  /** Sesiones no revocadas y no expiradas del usuario. */
  listActiveSessions(filter: ActiveSessionsFilter, db?: Db): RefreshTokenRecord[];
  /** Total de sesiones activas del usuario (para `meta.total`). */
  countActiveSessions(userId: number, db?: Db): number;
}
