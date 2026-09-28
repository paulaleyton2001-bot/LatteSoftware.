/**
 * Servicio de contraseñas (BR-SEC-001, DESIGN.md 11.1).
 *
 * RESPONSABILIDADES
 *  1. Hash bcrypt con el coste configurado (`BCRYPT_COST_ROUNDS`, 12 por
 *     defecto) y comparación en tiempo constante.
 *  2. Política de robustez, evaluada en un único sitio y reutilizable por todos
 *     los endpoints que aceptan una contraseña (registro, login, reseteo, cambio
 *     y alta de usuario por un administrador).
 *  3. Generación de contraseñas temporales para altas y reseteos administrativos.
 *
 * POR QUÉ LA POLÍTICA DEVUELVE 400 Y NO 422
 * API.md 7.1 admite `422 PASSWORD_TOO_WEAK` en `POST /auth/change-password`, pero
 * el mismo documento define `password` como un CAMPO del body: un cuerpo con un
 * campo inválido es `400 VALIDATION_ERROR` con `details` por campo (API.md 3.2 y
 * sección 1: "campos desconocidos/erróneos -> 400"). Aquí el mensaje es
 * accionable y aparece en el `path` del campo, así que el frontend lo muestra
 * junto al input sin parsear códigos. Se mantiene además el código estable
 * `PASSWORD_TOO_WEAK` en `details.code` para quien prefiera ramificar por él.
 */
import bcrypt from 'bcryptjs';

import { env, PASSWORD } from '../../config/index.js';
import { ValidationError } from '../../shared/errors/index.js';
import type { ValidationDetail } from '../../shared/http/index.js';

/** Caracteres que cuentan como símbolo. */
const SYMBOLS = /[^A-Za-z0-9]/;

/** Requisito de contraseña que no se cumple. */
export interface PasswordRequirement {
  /** `path` del detalle de validación (siempre `password` o `newPassword`). */
  readonly field: string;
  readonly message: string;
  readonly code: string;
}

/** Resultado del análisis de una contraseña. */
export interface PasswordCheck {
  readonly valid: boolean;
  /** Lista de requisitos incumplidos, en el orden en que deben corregirse. */
  readonly unmet: readonly PasswordRequirement[];
}

/**
 * Comprueba la política de contraseñas.
 *
 * Reglas (DESIGN.md 11.1, endurecidas): 8..72 caracteres, al menos 3 de las 4
 * clases (mayúsculas, minúsculas, dígitos, símbolos) y no ser una contraseña
 * trivial.
 *
 * @param plain contraseña en claro. NUNCA se registra ni se devuelve.
 * @param field  nombre del campo, para el `path` del `details`.
 */
export function checkPasswordPolicy(plain: string, field = 'password'): PasswordCheck {
  const unmet: PasswordRequirement[] = [];

  if (plain.length < PASSWORD.MIN_LENGTH) {
    unmet.push({
      field,
      message: `La contraseña debe tener al menos ${PASSWORD.MIN_LENGTH} caracteres`,
      code: 'PASSWORD_TOO_SHORT',
    });
  }
  if (plain.length > PASSWORD.MAX_LENGTH) {
    unmet.push({
      field,
      message: `La contraseña no puede superar ${PASSWORD.MAX_LENGTH} caracteres`,
      code: 'PASSWORD_TOO_LONG',
    });
  }

  const classes = countClasses(plain);
  if (classes < PASSWORD.REQUIRED_CLASSES) {
    unmet.push({
      field,
      message:
        `La contraseña debe combinar al menos ${PASSWORD.REQUIRED_CLASSES} de estos 4 tipos: ` +
        'mayúsculas, minúsculas, números y símbolos',
      code: 'PASSWORD_TOO_WEAK',
    });
  }

  if (isTrivial(plain)) {
    unmet.push({
      field,
      message: 'La contraseña es demasiado predecible: usa una combinación que no sea una palabra común',
      code: 'PASSWORD_TRIVIAL',
    });
  }

  return { valid: unmet.length === 0, unmet };
}

/** Cuántas de las 4 clases de caracteres aparecen en la contraseña. */
function countClasses(plain: string): number {
  let classes = 0;
  if (/[A-Z]/.test(plain)) classes += 1;
  if (/[a-z]/.test(plain)) classes += 1;
  if (/\d/.test(plain)) classes += 1;
  if (SYMBOLS.test(plain)) classes += 1;
  return classes;
}

/** Sólo letras y dígitos, en minúsculas: la "forma núcleo" de la contraseña. */
function coreOf(plain: string): string {
  return plain.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Contraseña trivial: vacía, repetitiva, o derivada de la lista negra.
 *
 * La comparación contra la lista usa la FORMA NÚCLEO (sin símbolos): si no,
 * `Password#1` pasaría como "nueva" cuando es `password1` con dos caracteres
 * añadidos, que es exactamente el truco que usan los diccionarios. Se exige
 * además que no sea una sola palabra alfabética: una contraseña de una palabra
 * sin cifras ni símbolos es una contraseña de diccionario.
 */
function isTrivial(plain: string): boolean {
  const normalized = plain.trim().toLowerCase();
  if (normalized.length === 0) {
    return true;
  }
  const core = coreOf(normalized);
  if ((PASSWORD.TRIVIAL_DENYLIST as readonly string[]).includes(core)) {
    return true;
  }
  // Un solo carácter repetido ("aaaaaaaa") o dos alternados ("abababab").
  if (/^(.)\1+$/.test(plain)) {
    return true;
  }
  if (/^(..)\1{3,}$/.test(plain)) {
    return true;
  }
  // Una sola palabra sin cifras ni símbolos delataría una contraseña de
  // diccionario; se exige además que tenga una classe no alfabética.
  if (!/[^A-Za-z]/.test(plain) && countClasses(plain) < PASSWORD.REQUIRED_CLASSES) {
    return true;
  }
  return false;
}

/**
 * Lanza `ValidationError` (400) si la contraseña no cumple la política.
 * `details` es un array de `{ path, message, code }`, el formato de API.md 3.2.
 */
export function assertPasswordPolicy(plain: string, field = 'password'): void {
  const check = checkPasswordPolicy(plain, field);
  if (check.valid) {
    return;
  }
  const details: ValidationDetail[] = check.unmet.map((requirement) => ({
    path: requirement.field,
    message: requirement.message,
    code: requirement.code,
  }));
  throw new ValidationError('La contraseña no cumple la política de seguridad', {
    details:
      details.length > 0
        ? details
        : [{ path: field, message: 'La contraseña no cumple la política de seguridad', code: 'PASSWORD_TOO_WEAK' }],
  });
}

/**
 * Hash de una contraseña con bcrypt y el coste configurado.
 *
 * @returns `$2b$<coste>$...`. Nunca se registra ni se devuelve por la API.
 */
export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, env.security.bcryptCostRounds);
}

/** Compara una contraseña con su hash bcrypt. `false` si el hash no es válido. */
export function verifyPassword(plain: string, hash: string): boolean {
  if (typeof hash !== 'string' || hash.length === 0) {
    return false;
  }
  return bcrypt.compareSync(plain, hash);
}

/**
 * Hash señuelo para igualar el tiempo de respuesta del login (DESIGN.md 11.1).
 *
 * Cuando el email no existe, el login debe igualmente "comparar" contra un hash
 * bcrypt válido: si se salta el `compare`, el tiempo de respuesta delata si la
 * cuenta existe. Se genera UNA vez por proceso y se reutiliza, de forma que el
 * coste es idéntico al de un login real.
 */
let decoyHash: string | null = null;

/** Hash bcrypt de un valor aleatorio, generado una sola vez. */
export function decoyPasswordHash(): string {
  if (decoyHash === null) {
    // Se hashea una cadena aleatoria: nadie la conoce, así que ningún `compare`
    // puede devolver `true` por accidente.
    const random = `${Date.now()}-${Math.random()}-${Math.random()}`;
    decoyHash = bcrypt.hashSync(random, env.security.bcryptCostRounds);
  }
  return decoyHash;
}

/**
 * Ejecuta un `compare` bcrypt señuelo para igualar el coste de un login que falla
 * por email inexistente. El resultado se descarta a propósito.
 */
export function burnTimingForUnknownUser(plain: string): void {
  verifyPassword(plain, decoyPasswordHash());
}

/**
 * Comprobación de "no es la misma contraseña" para `change-password`.
 * Evita que un usuario "cambie" su contraseña por la misma y crea la falsa
 * impresión de haberla protegido.
 */
export function isSamePassword(plain: string, currentHash: string): boolean {
  return verifyPassword(plain, currentHash);
}
