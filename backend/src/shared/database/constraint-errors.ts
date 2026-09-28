/**
 * Traducción de errores de restricción de SQLite al vocabulario de la API.
 *
 * Por qué hace falta aquí y no sólo en `error-handler.ts`: el manejador global
 * traduce `SQLITE_CONSTRAINT_UNIQUE` a `422 BUSINESS_RULE_ERROR` genérico
 * (DESIGN.md 8.2 lo define así para que una violación de unicidad no prevista se
 * vea como problema de integridad). Pero hay una restricción cuya identidad SÍ se
 * conoce y para la que el contrato exige otra respuesta:
 * `ux_users_email` es el email duplicado, que API.md 4 define como
 * `409 CONFLICT_ERROR` con `details.code = 'EMAIL_TAKEN'`.
 *
 * El repositorio es quien sabe qué restricción acaba de saltar, porque es quien
 * ha escrito la sentencia. Traducir aquí mantiene los controllers sin
 * `try/catch` (DESIGN.md 3.2) y deja un único punto de traducción por
 * restricción, tal como pide DESIGN.md 10.2.
 */
import { ConflictError } from '../errors/index.js';
import { CONFLICT_DETAIL_CODE } from '../errors/codes.js';

/** Código de better-sqlite3 para una violación de unicidad. */
const UNIQUE_CONSTRAINT = 'SQLITE_CONSTRAINT_UNIQUE';

/** Lee el `code` del driver si lo hay. */
function driverCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code: unknown = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Opciones de la traducción de una violación de unicidad. */
export interface UniqueConstraintTranslation {
  /** `details.code` estable del contrato, p. ej. `EMAIL_TAKEN`. */
  readonly code: string;
  /** Mensaje en español, accionable. */
  readonly message: string;
  /** Campo de entrada al que se atribuye, si procede. */
  readonly field?: string;
  /** Sólo para este índice. Si no se indica, se traduce cualquier UNIQUE. */
  readonly index?: string;
}

/**
 * Devuelve un `ConflictError` si el error es la violación de unicidad
 * indicada, y el error original en cualquier otro caso. Se usa así:
 *
 * ```ts
 * try {
 *   db.prepare(sql).run(params);
 * } catch (error) {
 *   throw translateUniqueConstraint(error, {
 *     code: 'EMAIL_TAKEN',
 *     message: 'Ya existe una cuenta con ese correo electrónico',
 *     field: 'email',
 *     index: 'ux_users_email',
 *   });
 * }
 * ```
 */
export function translateUniqueConstraint(
  error: unknown,
  translation: UniqueConstraintTranslation,
): unknown {
  if (driverCode(error) !== UNIQUE_CONSTRAINT) {
    return error;
  }
  const message =
    translation.index === undefined || mentionsIndex(error, translation.index)
      ? translation.message
      : CONFLICT_DETAIL_CODE.DUPLICATE;
  return new ConflictError(
    message === CONFLICT_DETAIL_CODE.DUPLICATE ? 'La operación entra en conflicto con el estado actual del recurso' : message,
    {
      details: {
        code: translation.code,
        ...(translation.field === undefined ? {} : { field: translation.field }),
      },
      cause: error,
    },
  );
}

/** `true` si el mensaje del driver menciona el índice indicado. */
function mentionsIndex(error: unknown, index: string): boolean {
  return error instanceof Error && error.message.includes(index);
}
