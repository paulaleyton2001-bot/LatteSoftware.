/**
 * Contrato de persistencia del módulo `users` (directorio de usuarios).
 *
 * Se separa del repositorio de `auth` a propósito. `auth` necesita lo mínimo
 * para decidir si una petición es válida (credenciales, roles, sesiones);
 * `users` necesita el directorio completo: filtros, orden, soft delete y gestión
 * de roles. Cada repositorio hace UNA cosa por llamada y ninguno abre
 * transacciones (DESIGN.md 3.2/3.3); el service decide el orden y las
 * entidades.
 */
import type { Db } from '../../shared/database/connection.js';
import type { Role, UserStatus } from '../../shared/domain/index.js';
import type { AdminUserView, UserListFilter, UserSort, UserSortColumn } from './users.types.js';

// Reexportados para que controller y service importen el contrato del
// repositorio sin llegar a `*.types`.
export type { UserListFilter, UserSort, UserSortColumn };

/** Datos para insertar un usuario desde el panel de administración. */
export interface NewDirectoryUser {
  readonly email: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly photoUrl: string | null;
  readonly isStaff: boolean;
}

/** Campos editables de un usuario por administración. */
export interface DirectoryUserPatch {
  readonly fullName?: string;
  readonly phone?: string | null;
  readonly photoUrl?: string | null;
  readonly email?: string;
}

/** Rol de sistema con su id, para validar `POST /users/:id/roles`. */
export interface RoleRef {
  readonly id: number;
  readonly name: Role;
  readonly isSystem: boolean;
}

/** Repositorio del directorio de usuarios. */
export interface UsersRepository {
  // --- Lecturas ------------------------------------------------------------
  /** Listado paginado con roles y permisos resueltos (3 consultas, sin N+1). */
  list(filter: UserListFilter, db?: Db): readonly AdminUserView[];
  /** Total de filas que satisfacen el filtro, sin paginar. */
  count(filter: Omit<UserListFilter, 'limit' | 'offset'>, db?: Db): number;
  /** Usuario por id con roles y permisos. `null` si no existe. */
  findById(id: number, db?: Db): AdminUserView | null;
  /** `id` de un usuario por email normalizado, o `null`. */
  findIdByEmail(email: string, db?: Db): number | null;
  /** Rol por nombre. `null` si no existe. */
  findRoleByName(name: Role, db?: Db): RoleRef | null;
  /** Rol por id. `null` si no existe. */
  findRoleById(id: number, db?: Db): RoleRef | null;
  /** Ids de los roles asignados al usuario. */
  listRoleIds(userId: number, db?: Db): readonly number[];
  /** `true` si el usuario tiene ese rol. */
  hasRole(userId: number, roleId: number, db?: Db): boolean;
  /** Cuántos usuarios no borrados tienen ese rol. Para `LAST_OWNER_PROTECTED`. */
  countUsersWithRole(roleId: number, db?: Db): number;

  // --- Escrituras ----------------------------------------------------------
  /** Inserta en `users` y devuelve el id generado. */
  insert(record: NewDirectoryUser, db?: Db): number;
  /** Inserta la fila en `user_roles`. Idempotente. */
  assignRole(userId: number, roleId: number, db?: Db): void;
  /** Borra la fila de `user_roles`. `false` si no estaba asignada. */
  removeRole(userId: number, roleId: number, db?: Db): boolean;
  /**
   * Recalcula `users.is_staff` a partir de `user_roles`: 1 si tiene algún rol
   * distinto de `CUSTOMER`, 0 si sólo es cliente. Se llama SIEMPRE después de
   * cambiar roles, dentro de la misma transacción.
   */
  syncIsStaff(userId: number, db?: Db): void;
  /** Actualiza los campos indicados. Sin cambios: no escribe nada. */
  update(userId: number, patch: DirectoryUserPatch, db?: Db): void;
  /** Soft delete: `deleted_at` + `status = 'INACTIVE'`. */
  softDelete(userId: number, deletedAt: string, db?: Db): void;
  /** Cambia `users.status`. */
  updateStatus(userId: number, status: UserStatus, db?: Db): void;
  /** Sustituye `password_hash`. */
  updatePassword(userId: number, passwordHash: string, db?: Db): void;
  /** Guarda el hash sha256 de un token de reseteo administrativo. */
  setPasswordReset(userId: number, tokenHash: string, expiresAt: string, db?: Db): void;
  /** Invalida el token de reseteo. */
  clearPasswordReset(userId: number, db?: Db): void;
  /** Revoca todas las sesiones vivas del usuario. Devuelve cuántas revocó. */
  revokeAllSessions(userId: number, revokedAt: string, db?: Db): number;
}
