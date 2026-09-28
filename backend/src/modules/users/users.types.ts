/**
 * DTOs de dominio del módulo `users` (API.md 7.2, recurso `User` de 6.3).
 *
 * El recurso expuesto es el mismo que devuelve `GET /auth/me`, pero la vista
 * administrativa añade `deletedAt` para que la interfaz pueda mostrar los
 * borrados lógicos. Ni aquí ni en ninguna respuesta aparece `password_hash`,
 * `password_reset_token_hash` ni ningún token: esa garantía la da
 * `auth.schemas`/`users.schemas` por el lado de la entrada y
 * `sanitizeForAudit` por el lado de la auditoría, pero el primer filtro es que
 * estos tipos no tienen esos campos.
 */
import type { Role, UserStatus } from '../../shared/domain/index.js';

// --------------------------------------------------------------------------
// Lecturas
// --------------------------------------------------------------------------

/** Usuario tal y como lo ve un administrador (API.md 6.3 `User`). */
export interface AdminUserView {
  readonly id: number;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly photoUrl: string | null;
  readonly status: UserStatus;
  readonly isStaff: boolean;
  readonly roles: readonly Role[];
  readonly permissions: readonly string[];
  readonly emailVerifiedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** `null` si el usuario está vivo; fecha ISO si está soft-deleted. */
  readonly deletedAt: string | null;
}

/** Filtros de `GET /users` (API.md 7.2). Todos opcionales. */
export interface UserListFilter {
  readonly role?: Role;
  readonly status?: UserStatus;
  /** Búsqueda por email o nombre, ya acotada a 2..100 caracteres. */
  readonly q?: string;
  readonly isStaff?: boolean;
  readonly limit: number;
  readonly offset: number;
  readonly sort: UserSort;
}

/** Orden validado contra la allowlist del endpoint. */
export interface UserSort {
  readonly column: UserSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** Columnas por las que se permite ordenar `GET /users`. */
export type UserSortColumn = 'created_at' | 'full_name' | 'last_login_at';

/** Página de usuarios. */
export interface UserPage {
  readonly items: readonly AdminUserView[];
  readonly total: number;
}

// --------------------------------------------------------------------------
// Escrituras
// --------------------------------------------------------------------------

/** `POST /users` (API.md 7.2). */
export interface CreateUserInput {
  readonly email: string;
  /** Si falta, el service genera una contraseña aleatoria que nadie conoce. */
  readonly password?: string | null;
  readonly fullName: string;
  readonly phone?: string | null;
  readonly photoUrl?: string | null;
  readonly roles: readonly Role[];
  readonly sendInvitation: boolean;
}

/**
 * Resultado del alta. `temporaryPassword` SÓlo se rellena si el admin no envió
 * contraseña y `sendInvitation` es `false`: es la única vez que se conoce y no se
 * vuelve a exponer.
 */
export interface CreateUserResult {
  readonly user: AdminUserView;
  readonly temporaryPassword: string | null;
}

/** `PATCH /users/:id` (API.md 7.2). El email sí se permite aquí. */
export interface UpdateUserInput {
  readonly fullName?: string;
  readonly phone?: string | null;
  readonly photoUrl?: string | null;
  readonly email?: string;
}

/** `DELETE /users/:id` (API.md 7.2). */
export interface DeleteUserResult {
  readonly id: number;
  readonly deletedAt: string;
  readonly revokedSessions: number;
}

/** `POST /users/:id/roles` (API.md 7.2). */
export interface AssignRoleResult {
  readonly user: AdminUserView;
  readonly assignedRoles: readonly Role[];
  /** Sesiones revocadas por el cambio de permisos (BR-RBAC-007). */
  readonly revokedSessions: number;
}

/** `DELETE /users/:id/roles/:roleId` (API.md 7.2). */
export interface RemoveRoleResult {
  readonly userId: number;
  readonly roleId: number;
  readonly removedAt: string;
  readonly revokedSessions: number;
}

/** `POST /users/:id/reset-password` (API.md 7.2). */
export interface AdminPasswordResetResult {
  readonly userId: number;
  readonly revokedSessions: number;
  /**
   * Token de un solo uso para que el usuario elija su contraseña. Se devuelve
   * SÓLO con `sendEmail = false` y NUNCA junto con la contraseña: el
   * administrador nunca ve una contraseña.
   */
  readonly resetToken: string | null;
  readonly expiresAt: string | null;
}
