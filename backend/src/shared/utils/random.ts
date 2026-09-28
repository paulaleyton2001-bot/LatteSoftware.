/**
 * Generación de valores aleatorios y de identificadores seguros.
 *
 * Se usa `node:crypto` directamente: sin dependencias externas para evitar
 * que un token de sesión dependa de la cadena de suministro de una librería.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Token opaco en **base64url** (URL-safe, sin `+`, `/` ni `=`).
 * Es el formato de los refresh tokens y de los tokens de reseteo de contraseña,
 * que viajan en la URL o en cabeceras.
 *
 * @param bytes Longitud entropíaica en bytes. 32 -> 43 caracteres (~256 bits).
 */
export function randomToken(bytes = 32): string {
  if (!Number.isInteger(bytes) || bytes < 16) {
    throw new RangeError('El token requiere al menos 16 bytes de entropía');
  }
  return randomBytes(bytes).toString('base64url');
}

/** UUID v4. Se usa para `requestId` y para `Idempotency-Key`. */
export function randomUuid(): string {
  return randomUUID();
}

/**
 * SHA-256 en hexadecimal minúscula.
 * Así se persisten los tokens opacos (`refresh_tokens.token_hash`,
 * `users.password_reset_token_hash`): el token en claro sólo viaja al cliente
 * y nunca se guarda ni se registra.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Comparación en tiempo constante, para no filtrar el valor esperado. */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    // `timingSafeEqual` exige longitudes iguales; se mantiene el coste fijo
    // comparando igualmente antes de devolver `false`.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
