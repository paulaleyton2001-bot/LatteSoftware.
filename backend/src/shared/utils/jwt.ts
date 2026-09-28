/**
 * Implementación mínima y estricta de **HS256 JWT** sobre `node:crypto`.
 *
 * POR QUÉ SIN LIBRERÍA: el contrato de la fundación no incluye `jsonwebtoken`
 * ni `jose`, pero `authenticate` debe verificar firma y expiración. HS256 es
 * HMAC-SHA256, que `node:crypto` resuelve de forma nativa y verificable, así
 * que se implementa aquí sin añadir dependencias al proyecto.
 *
 * LO QUE ESTE MÓDULO HACE:
 *  - Firmar y verificar HS256 (el único algoritmo admitido; `alg: none` y RS/ES se
 *    rechazan).
 *  - Validar `exp`, `nbf`, `iat` y `typ` con tolerancia de reloj configurable.
 *  - Comparar la firma en tiempo constante.
 *
 * LO QUE NO HACE (y por tanto no debe usarse para):
 *  - JWK / rotación de claves / RS256. Si alguna vez hace falta, se cambia por
 *    `jose` y este módulo desaparece; la forma del token no cambia.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { AUTH_DETAIL_CODE, AuthenticationError, type AuthDetailCode } from '../errors/index.js';

/** Algoritmo único admitido. Un token con otro `alg` es inválido. */
const ALGORITHM = 'HS256' as const;

/** Separador JWT: `base64url(header).base64url(payload).base64url(signature)`. */
const TOKEN_PARTS = 3;

/**
 * Tolerancia de reloj por defecto, en segundos.
 *
 * Es 0 a propósito: un token expirado se rechaza, sin excepciones. Un balance
 * de 5 s ampliaría la ventana de un token robado sin necesidad real, porque
 * `exp` e `iat` los genera este mismo proceso y ambos relojos son el mismo.
 */
const DEFAULT_CLOCK_TOLERANCE_SECONDS = 0;

/** Forma de un claimset de la aplicación. */
export interface JwtClaims {
  /** `sub` = id del usuario. */
  readonly sub: number;
  /** `businessId` del actor. Nunca se acepta desde body o query. */
  readonly businessId: number;
  /** `typ`: `access` o `refresh`. Distingue el uso de un token. */
  readonly typ: 'access' | 'refresh';
  /** `sid`: id de `refresh_tokens`. Sólo en refresh tokens. */
  readonly sid?: number;
  readonly email?: string;
  readonly roles?: readonly string[];
  /** `exp` (segundos Unix). */
  readonly exp: number;
  /** `iat` (segundos Unix). */
  readonly iat: number;
  /** `nbf` (segundos Unix). */
  readonly nbf?: number;
  /** `iss` emisor. */
  readonly iss?: string;
  /** `aud` audiencia. */
  readonly aud?: string;
  /** `jti` identificador único del token. */
  readonly jti?: string;
}

export interface VerifyOptions {
  /**
   * Segundos de tolerancia para `exp`, `nbf` e `iat`. Por defecto 0 (fallo
   * cerrado). Sólo debe subirse si hay relojes realmente desincronizados.
   */
  readonly clockToleranceSeconds?: number;
  /** Instante actual en ms. Inyectable para poder testear sin reloj real. */
  readonly nowMs?: number;
  /** `typ` exigido. Si no coincide, el token es rechazado (401). */
  readonly expectedType?: 'access' | 'refresh';
  /** Emisor exigido (`iss`). */
  readonly issuer?: string;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

/** Firma HS256 de `header.payload` con el secreto dado. */
function sign(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest();
}

function detail(code: AuthDetailCode, message: string): AuthenticationError {
  return new AuthenticationError(message, { details: { code } });
}

/**
 * Firma un token HS256.
 *
 * @param claims Claims sin `exp`/`iat`: se calculan aquí a partir de `ttlSeconds`.
 * @param secret Secreto HS256 (mínimo 32 caracteres, validado al arrancar).
 * @param ttlSeconds Vigencia del access token.
 */
export function signAccessToken(
  claims: Omit<JwtClaims, 'exp' | 'iat'> & { readonly ttlSeconds: number },
  secret: string,
  nowMs: number = Date.now(),
): string {
  const issuedAt = Math.floor(nowMs / 1000);
  const header = { alg: ALGORITHM, typ: 'JWT' };
  const payload: JwtClaims = {
    sub: claims.sub,
    businessId: claims.businessId,
    typ: claims.typ,
    ...(claims.sid === undefined ? {} : { sid: claims.sid }),
    ...(claims.email === undefined ? {} : { email: claims.email }),
    ...(claims.roles === undefined ? {} : { roles: claims.roles }),
    ...(claims.iss === undefined ? {} : { iss: claims.iss }),
    ...(claims.aud === undefined ? {} : { aud: claims.aud }),
    ...(claims.jti === undefined ? {} : { jti: claims.jti }),
    iat: issuedAt,
    exp: issuedAt + claims.ttlSeconds,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(secret, `${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature.toString('base64url')}`;
}

/**
 * Verifica firma, estructura y temporally un token HS256.
 *
 * Lanza `AuthenticationError` (401) con `details.code` en
 * {`MISSING_TOKEN`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `WRONG_TOKEN_TYPE`},
 * tal como exige API.md 2.
 */
export function verifyJwt(token: string, secret: string, options: VerifyOptions = {}): JwtClaims {
  const tolerance = options.clockToleranceSeconds ?? DEFAULT_CLOCK_TOLERANCE_SECONDS;
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);

  if (typeof token !== 'string' || token.length === 0) {
    throw detail(AUTH_DETAIL_CODE.MISSING_TOKEN, 'No se recibió el token de autenticación');
  }

  const parts = token.split('.');
  if (parts.length !== TOKEN_PARTS) {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación no es válido');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];

  let header: { alg?: unknown; typ?: unknown };
  try {
    header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8')) as typeof header;
  } catch {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación no es válido');
  }
  // Rechazo explícito de `alg: none` y de algoritmos asimétricos: la
  // verificación siempre es HMAC con el secreto del servidor.
  if (header.alg !== ALGORITHM) {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación no es válido');
  }

  const expected = sign(secret, `${encodedHeader}.${encodedPayload}`);
  const provided = base64UrlDecode(encodedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación no es válido');
  }

  let claims: JwtClaims;
  try {
    claims = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8')) as JwtClaims;
  } catch {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación no es válido');
  }

  if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación no es válido');
  }
  if (claims.exp + tolerance <= nowSeconds) {
    throw detail(AUTH_DETAIL_CODE.TOKEN_EXPIRED, 'El token de autenticación ha expirado');
  }
  if (typeof claims.nbf === 'number' && claims.nbf - tolerance > nowSeconds) {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación aún no es válido');
  }
  if (typeof claims.iat === 'number' && claims.iat - tolerance > nowSeconds) {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación no es válido');
  }
  if (options.issuer !== undefined && claims.iss !== options.issuer) {
    throw detail(AUTH_DETAIL_CODE.INVALID_TOKEN, 'El token de autenticación no es válido');
  }
  if (options.expectedType !== undefined && claims.typ !== options.expectedType) {
    // Un refresh token presentado como access (o al revés) es un error
    // explícito, no un "token corrupto": el cliente debe rotar.
    throw detail(
      AUTH_DETAIL_CODE.WRONG_TOKEN_TYPE,
      'El tipo de token no corresponde a este endpoint',
    );
  }

  return claims;
}

/** Lee el `exp` de un token **sin verificar**. Sólo para cliente y métricas. */
export function peekExpiryMs(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== TOKEN_PARTS) return null;
  const payload = parts[1];
  if (payload === undefined) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(payload).toString('utf8')) as { exp?: unknown };
    return typeof parsed.exp === 'number' ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Convierte un TTL de configuración ("15m", "1h", "900") a segundos.
 * Lanza si el formato no es recognized.
 */
export function ttlToSeconds(ttl: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d)?$/i.exec(ttl.trim());
  if (match === null) {
    throw new Error(`JWT_ACCESS_TTL inválido: "${ttl}". Formato esperado 15m, 1h o 900.`);
  }
  const value = Number.parseInt(match[1] ?? '0', 10);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Readonly<Record<string, number>> = {
    ms: 0.001,
    s: 1,
    m: 60,
    h: 3_600,
    d: 86_400,
  };
  const multiplier = multipliers[unit];
  if (multiplier === undefined) {
    throw new Error(`JWT_ACCESS_TTL inválido: unidad "${unit}" no reconocida`);
  }
  const seconds = Math.floor(value * multiplier);
  if (seconds <= 0) {
    throw new Error(`JWT_ACCESS_TTL inválido: "${ttl}" debe ser mayor que cero`);
  }
  return seconds;
}
