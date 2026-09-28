/**
 * Servicio de tokens (DESIGN.md 11.2 y 4.1).
 *
 * EMISIÓN
 *  - **Access token**: JWT HS256 firmado con `shared/utils/jwt.ts`. Claims:
 *    `sub` (id), `email`, `roles`, `businessId`, `sid` (id de la sesión) y
 *    `typ: 'access'`, más `iat`/`exp` calculados a partir de `JWT_ACCESS_TTL`.
 *    No se persiste: es stateless.
 *  - **Refresh token**: valor opaco de 48 bytes (`crypto.randomBytes`), en
 *    base64url. A la base de datos SOLO va su SHA-256 (`refresh_tokens.token_hash`,
 *    `UNIQUE`). El valor en claro se devuelve una única vez y no se registra ni
 *    se audita jamás.
 *  - **Token de reseteo**: opaco de 32 bytes; a `users` sólo su SHA-256.
 *
 * ROTACIÓN Y REUSO (DESIGN.md 11.2, paso 6 y regla 3)
 *  Al refrescar se emite un token nuevo y el anterior se marca `revoked_at` +
 *  `replaced_by_id`. Si un token YA REVOCADO se presenta, es robo: este servicio
 *  no decide la respuesta (eso es del `auth.service`), pero facilita el
 *  `revokeAll` y la auditoría.
 *
 * Este servicio NO escribe SQL: usa el repositorio inyectado.
 */
import { env } from '../../config/index.js';
import { AUTH } from '../../config/index.js';
import { Role } from '../../shared/domain/index.js';
import { randomToken, sha256Hex } from '../../shared/utils/random.js';
import { signAccessToken, ttlToSeconds } from '../../shared/utils/jwt.js';
import type { AuthRepository } from './auth.repository.js';
import type { IssuedRefreshToken, NewRefreshTokenRecord } from './auth.types.js';

/** Claims que se firman en el access token, sin `iat`/`exp`. */
export interface AccessTokenClaims {
  readonly userId: number;
  readonly email: string;
  readonly roles: readonly Role[];
  readonly businessId: number;
  /** `id` de la sesión en `refresh_tokens`. */
  readonly sessionId: number;
}

/** Metadatos del cliente que se guardan con la sesión. */
export interface SessionContext {
  readonly deviceInfo: string | null;
  readonly ipAddress: string | null;
}

/** Token opaco emitido y su hash persistido. */
export interface IssuedOpaqueToken extends IssuedRefreshToken {
  /** SHA-256 hexadecimal: es lo que se guarda en la tabla. */
  readonly tokenHash: string;
}

/**
 * Emisor y verificador de tokens.
 *
 * Se instancia una vez en `config/container.ts` y se inyecta por constructor.
 * No hay estado mutable: es seguro compartirlo entre peticiones.
 */
export class TokenService {
  public constructor(private readonly repository: AuthRepository) {}

  /** Vigencia del access token en segundos, leída de `JWT_ACCESS_TTL`. */
  public get accessTokenTtlSeconds(): number {
    return ttlToSeconds(env.security.accessTtl);
  }

  /** Vigencia del refresh token en ISO-8601 UTC, desde `now`. */
  public refreshTokenExpiresAt(nowIso: string): string {
    const ms = env.security.refreshTtlDays * 24 * 60 * 60 * 1000;
    return new Date(Date.parse(nowIso) + ms).toISOString();
  }

  /** Firmar un access token HS256 para un usuario y una sesión. */
  public signAccessToken(claims: AccessTokenClaims): string {
    return signAccessToken(
      {
        sub: claims.userId,
        email: claims.email,
        roles: [...claims.roles],
        businessId: claims.businessId,
        sid: claims.sessionId,
        typ: AUTH.TOKEN_TYPE.ACCESS,
        ttlSeconds: this.accessTokenTtlSeconds,
      },
      env.security.jwtSecret,
    );
  }

  /**
   * Emite un refresh token: genera el valor opaco, guarda su SHA-256 y devuelve
   * ambos. El valor en claro sale de aquí una sola vez.
   */
  public issueRefreshToken(
    userId: number,
    nowIso: string,
    context: SessionContext,
  ): IssuedOpaqueToken {
    const token = randomToken(AUTH.REFRESH_TOKEN_BYTES);
    const tokenHash = sha256Hex(token);
    const expiresAt = this.refreshTokenExpiresAt(nowIso);
    const record: NewRefreshTokenRecord = {
      userId,
      tokenHash,
      expiresAt,
      deviceInfo: context.deviceInfo,
      ipAddress: context.ipAddress,
    };
    const id = this.repository.insertRefreshToken(record);
    return { id, token, tokenHash, expiresAt };
  }

  /**
   * Emite un token de reseteo de contraseña. El valor en claro NO se persiste
   * en ningún sitio: sólo su SHA-256, y el service lo entrega por email.
   */
  public issuePasswordResetToken(): IssuedOpaqueToken {
    const token = randomToken(AUTH.RESET_TOKEN_BYTES);
    return {
      id: 0,
      token,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + env.security.passwordResetTtlMinutes * 60_000).toISOString(),
    };
  }

  /** SHA-256 de un refresh token recibido: la clave con la que se busca. */
  public hashRefreshToken(token: string): string {
    return sha256Hex(token);
  }

  /**
   * Rota una sesión: revoca la anterior apuntando a la nueva.
   * El orden importa: primero se inserta la nueva (para conocer su id) y después
   * se revoca la vieja, porque `replaced_by_id` la referencia.
   */
  public rotateSession(previousId: number, revokedAt: string, replacementId: number): boolean {
    return this.repository.revokeRefreshToken(previousId, revokedAt, replacementId);
  }

  /** Revoca la sesión actual. Devuelve `false` si ya estaba revocada. */
  public revokeSession(id: number, revokedAt: string): boolean {
    return this.repository.revokeRefreshToken(id, revokedAt, null);
  }

  /** Revoca todas las sesiones vivas del usuario y devuelve cuántas eran. */
  public revokeAllSessions(userId: number, revokedAt: string): number {
    return this.repository.revokeAllRefreshTokens(userId, revokedAt);
  }
}
