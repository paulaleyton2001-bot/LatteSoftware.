/**
 * Autorización por RBAC (DESIGN.md sección 9, API.md sección 2).
 *
 * La comprobación se hace SIEMPRE contra la base de datos (`role_permissions`
 * y `permissions`), nunca contra una matriz hardcodeada en el código: la
 * matriz de DESIGN.md 9.3 es la semilla, y `GET /api/v1/meta/roles` la lee de
 * la base de datos, así que ambas quedan sincronizadas por construcción.
 *
 * La caché es **por petición**: `authenticate` ya cargó los permisos efectivos
 * al construir el `UserContext`, y `requirePermission` los reutiliza. No hay
 * caché global, de modo que revocar un permiso surte efecto en la siguiente
 * petición sin reiniciar el proceso.
 *
 * Semántica de roles: OR. Si el actor tiene varios roles, basta con que uno
 * conceda el permiso.
 *
 * Un permiso ausente produce 403 `AUTHORIZATION_ERROR` con
 * `details.required`, nunca 404 (API.md 2).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { AuthorizationError } from '../errors/index.js';
import { isEnumValue, Role, type Role as RoleType } from '../domain/index.js';
import { requireAuth, type RequestWithAuth } from './authenticate.js';

/**
 * Roles de sistema a los que se concede control total.
 *
 * BR-RBAC-002: `OWNER` y `ADMIN` tienen implícitos todos los permisos del
 * sistema y el middleware los deja pasar sin consultar la tabla. La tabla sigue
 * siendo la fuente de verdad para los demás roles, y `GET /auth/me` sigue
 * devolviendo la lista completa leída de `role_permissions`.
 */
const SUPERUSERS: readonly RoleType[] = [Role.OWNER, Role.ADMIN];

/** Actor de la petición, o `null` si no hay token. */
function actorOf(req: Request): { roles: readonly RoleType[]; permissions: readonly string[] } | null {
  const candidate = req as RequestWithAuth;
  const auth = candidate.auth;
  if (auth === undefined) {
    return null;
  }
  return { roles: auth.roles, permissions: auth.permissions };
}

/** `true` si el actor tiene el rol indicado. */
export function hasRole(req: Request, role: RoleType): boolean {
  const actor = actorOf(req);
  return actor !== null && actor.roles.includes(role);
}

/** `true` si el actor tiene alguno de los roles indicados (semántica OR). */
export function hasAnyRole(req: Request, roles: readonly RoleType[]): boolean {
  const actor = actorOf(req);
  if (actor === null) {
    return false;
  }
  return roles.some((role) => actor.roles.includes(role));
}

/** `true` si el actor posee el permiso, leyendo de los roles ya cargados. */
export function hasPermission(req: Request, permission: string): boolean {
  const actor = actorOf(req);
  if (actor === null) {
    return false;
  }
  if (actor.roles.some((role) => SUPERUSERS.includes(role))) {
    return true;
  }
  return actor.permissions.includes(permission);
}

/**
 * Exige el permiso `modulo:accion`.
 *
 * @example
 * router.post('/', requirePermission('orders:create'), createOrder);
 */
export function requirePermission(permission: string): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const actor = requireAuth(req);
      if (!hasPermission(req, permission)) {
        throw new AuthorizationError('No tiene permisos para realizar esta acción', {
          details: {
            code: 'INSUFFICIENT_PERMISSIONS',
            required: permission,
            roles: [...actor.roles],
          },
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Exige uno de los roles indicados (OR). Múltiples roles se acumulan:
 * `requireRoles(Role.MANAGER, Role.ADMIN)`.
 */
export function requireRoles(...roles: readonly RoleType[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      const actor = requireAuth(req);
      if (!hasAnyRole(req, roles)) {
        throw new AuthorizationError('No tiene el rol necesario para realizar esta acción', {
          details: {
            code: 'INSUFFICIENT_ROLE',
            required: [...roles],
            actual: [...actor.roles],
          },
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Atajo de `requireRoles` para un único rol. */
export function requireRole(role: RoleType): RequestHandler {
  return requireRoles(role);
}

/**
 * Convierte un string de configuración en `Role` validado. Falla ruidosamente
 * si el rol no existe, en vez de castear a ciegas.
 */
export function toRole(value: string): RoleType {
  if (!isEnumValue(Role, value)) {
    throw new Error(`Rol desconocido: "${value}"`);
  }
  return value;
}
