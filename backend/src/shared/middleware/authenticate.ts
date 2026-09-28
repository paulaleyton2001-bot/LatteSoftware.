/**
 * Autenticación por access token JWT (API.md 2).
 *
 * Flujo:
 *  1. Lee `Authorization: Bearer <token>`. Ausente -> 401 con
 *     `details.code = 'MISSING_TOKEN'`.
 *  2. Verifica firma HS256 y expiración. Un refresh token presentado como
 *     access -> 401 con `details.code = 'WRONG_TOKEN_TYPE'`.
 *  3. Carga el usuario de la base de datos. Un usuario `BLOCKED` o
 *     `INACTIVE`, o soft-deleted, no puede autenticarse (403 por regla de API;
 *     el token en sí es válido, por eso se responde 403 y no 401).
 *  4. Carga roles y permisos efectivos y adjunta el `UserContext` a `req`.
 *
 * El SQL vive en `shared/database/queries.ts`: este middleware no escribe
 * SQL. Los roles y permisos se consultan una vez por petición y se cachean en
 * el propio contexto, nunca globalmente (un cambio de rol debe surtir efecto
 * en la siguiente petición).
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { env } from '../../config/index.js';
import {
  findUserAuthById,
  findUserPermissions,
  findUserRoles,
  type UserRoleName,
} from '../database/queries.js';
import {
  AUTH_DETAIL_CODE,
  AuthenticationError,
  AuthorizationError,
} from '../errors/index.js';
import { Role, UserStatus, isEnumValue, type Role as RoleType, type UserContext } from '../domain/index.js';
import { verifyJwt } from '../utils/jwt.js';

/** Prefijo del esquema de autenticación. */
const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

/** `Request` con el actor resuelto. */
export interface RequestWithAuth extends Request {
  auth?: UserContext;
  /**
   * `sid` del access token: id de la fila vigente en `refresh_tokens`
   * (DESIGN.md 11.2). Es lo que permite a `POST /auth/logout` revocar "esta
   * sesión" sin ambigüedad, y a `GET /auth/sessions` marcar cuál es la actual.
   * Se adjunta aquí, ya verificado, para que los services no tengan que
   * re-verificar el token.
   */
  sessionId?: number | null;
}

/** Extrae el token del encabezado `Authorization`. */
export function extractBearerToken(req: Request): string | null {
  const raw = req.headers.authorization;
  if (typeof raw !== 'string') {
    return null;
  }
  const match = BEARER_PREFIX.exec(raw.trim());
  const token = match?.[1];
  return token === undefined || token.length === 0 ? null : token;
}

/** Convierte los roles de la BD en el tipo de dominio. */
function toDomainRoles(roles: readonly UserRoleName[]): RoleType[] {
  return roles.filter((role): role is RoleType => isEnumValue(Role, role));
}

/**
 * Middleware que exige un access token válido.
 *
 * @throws AuthenticationError 401 (token ausente/inválido/expirado/tipo
 *         equivocado) o AuthorizationError 403 (usuario bloqueado o inactivo).
 */
export const authenticate: RequestHandler = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const token = extractBearerToken(req);
    if (token === null) {
      throw new AuthenticationError('No se recibió el token de autenticación', {
        details: { code: AUTH_DETAIL_CODE.MISSING_TOKEN },
      });
    }

    // `expectedType` rechaza un refresh token usado como access token.
    const claims = verifyJwt(token, env.security.jwtSecret, { expectedType: 'access' });

    const row = findUserAuthById(claims.sub);
    if (row === null) {
      throw new AuthenticationError('El token no corresponde a un usuario válido', {
        details: { code: AUTH_DETAIL_CODE.INVALID_TOKEN },
      });
    }

    if (row.status === UserStatus.BLOCKED) {
      throw new AuthorizationError('El usuario está bloqueado', {
        details: { code: 'USER_BLOCKED' },
      });
    }
    if (row.status === UserStatus.INACTIVE) {
      throw new AuthorizationError('El usuario está inactivo', {
        details: { code: 'USER_INACTIVE' },
      });
    }

    const roles = toDomainRoles(findUserRoles(row.id));
    const permissions = findUserPermissions(row.id);

    const context: UserContext = {
      id: row.id,
      email: row.email,
      fullName: row.full_name,
      businessId: claims.businessId,
      status: row.status,
      isStaff: row.is_staff === 1,
      roles,
      permissions,
    };

    (req as RequestWithAuth).auth = context;
    (req as RequestWithAuth).sessionId = claims.sid ?? null;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Variante que sólo exige un token válido y deja el estado del usuario para
 * el service. Se usa en endpoints públicos con identidad opcional
 * (`GET /orders/:id` de un cliente, que puede ser anónimo).
 */
export const optionalAuthenticate: RequestHandler = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (extractBearerToken(req) === null) {
    next();
    return;
  }
  authenticate(req, _res, next);
};

/** `true` si la petición ya tiene actor resuelto. */
export function hasAuth(req: Request): req is RequestWithAuth & { auth: UserContext } {
  const candidate = req as RequestWithAuth;
  return candidate.auth !== undefined;
}

/** Actor de la petición. Lanza 401 si `authenticate` no se ejecutó. */
export function requireAuth(req: Request): UserContext {
  if (!hasAuth(req)) {
    throw new AuthenticationError('No se recibió el token de autenticación', {
      details: { code: AUTH_DETAIL_CODE.MISSING_TOKEN },
    });
  }
  return req.auth;
}

/**
 * `sid` (id de `refresh_tokens`) de la petición, o `null`.
 *
 * `null` significa "no hay sesión": o no se envió token, o el access token se
 * emitió sin `sid`. Los services de sesión (logout, listado, revocación) lo
 * tratan explícitamente en vez de asumirlo.
 */
export function currentSessionId(req: Request): number | null {
  const candidate = req as RequestWithAuth;
  return candidate.sessionId ?? null;
}
