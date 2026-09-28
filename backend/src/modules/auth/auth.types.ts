/**
 * DTOs de dominio del módulo `auth`.
 *
 * Son tipos PUROS: no importan `express`, `zod` ni el driver de base de datos
 * (P2). Los esquemas de zod viven en `auth.schemas.ts` y los controllers
 * traducen `req` -> estos tipos; el service no sabe de dónde salieron.
 *
 * REGLA DE ORO: ningún tipo de este fichero que salga hacia la API puede llevar
 * `passwordHash` ni ningún token. `CredentialUser` existe precisamente para el
 * servicio de autenticación, y nunca se serializa.
 */
import type { Role, UserStatus } from '../../shared/domain/index.js';

// --------------------------------------------------------------------------
// Identidad
// --------------------------------------------------------------------------

/**
 * Usuario CON credenciales. Uso exclusivo del interior del módulo `auth`
 * (login, cambio de contraseña, reseteo). Prohibido devolverlo por la API.
 */
export interface CredentialUser {
  readonly id: number;
  readonly email: string;
  readonly passwordHash: string;
  readonly fullName: string;
  readonly status: UserStatus;
  readonly isStaff: boolean;
  readonly deletedAt: string | null;
}

/**
 * Perfil público de un usuario (API.md 6.3, recurso `User`).
 * `roles` y `permissions` vienen resueltos de `user_roles` y `role_permissions`
 * (BR-RBAC-001: unión de los permisos de todos sus roles).
 */
export interface UserProfile {
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
}

/** Campos del perfil que un usuario puede cambiar sobre sí mismo. */
export interface ProfilePatch {
  readonly fullName?: string;
  readonly phone?: string | null;
  readonly photoUrl?: string | null;
}

// --------------------------------------------------------------------------
// Sesiones
// --------------------------------------------------------------------------

/** Fila de `refresh_tokens`. `tokenHash` NUNCA sale del service. */
export interface RefreshTokenRecord {
  readonly id: number;
  readonly userId: number;
  readonly tokenHash: string;
  readonly deviceInfo: string | null;
  readonly ipAddress: string | null;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly replacedById: number | null;
  readonly createdAt: string;
}

/** Sesión tal y como la ve el cliente (API.md 7.1 `GET /auth/sessions`). */
export interface SessionView {
  readonly id: number;
  readonly deviceInfo: string | null;
  readonly ipAddress: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly isCurrent: boolean;
}

/** Token opaco recién emitido: `id` es el `sid` del access token. */
export interface IssuedRefreshToken {
  readonly id: number;
  /** Token EN CLARO. Viaja una sola vez, al cliente, y no se persiste. */
  readonly token: string;
  readonly expiresAt: string;
}

/** Datos insertados en `refresh_tokens`. */
export interface NewRefreshTokenRecord {
  readonly userId: number;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly deviceInfo: string | null;
  readonly ipAddress: string | null;
}

/** Par de tokens devueltos al cliente. */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: string;
  /** Vigencia del access token en SEGUNDOS (API.md 7.1: `expiresIn: 900`). */
  readonly expiresIn: number;
  /** `id` de `refresh_tokens` = `sid` del access token. */
  readonly sessionId: number;
}

/** Resultado de login, registro y refresh. */
export interface AuthResult {
  readonly user: UserProfile;
  readonly tokens: IssuedTokens;
}

// --------------------------------------------------------------------------
// Entradas de los casos de uso
// --------------------------------------------------------------------------

/** `POST /auth/register`. */
export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly fullName: string;
  readonly phone?: string | null;
}

/** `POST /auth/login`. */
export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

/** `POST /auth/refresh`. */
export interface RefreshInput {
  readonly refreshToken: string;
}

/** `POST /auth/forgot-password`. */
export interface ForgotPasswordInput {
  readonly email: string;
}

/** `POST /auth/reset-password`. */
export interface ResetPasswordInput {
  readonly token: string;
  readonly password: string;
  readonly confirmPassword: string;
}

/** `POST /auth/change-password`. */
export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
  readonly confirmPassword: string;
  /** Mantener la sesión actual rotando su refresh token. Por defecto `true`. */
  readonly keepCurrentSession: boolean;
}

/** `POST /auth/logout-all`. `currentPassword` es opcional. */
export interface LogoutAllInput {
  readonly currentPassword?: string | null;
}

/** Revocación de una sesión concreta: `DELETE /auth/sessions/:id`. */
export interface RevokeSessionResult {
  readonly revokedAt: string;
  /** `true` si la sesión ya estaba revocada (idempotencia, API.md 6.4). */
  readonly alreadyRevoked: boolean;
}
