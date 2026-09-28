/**
 * Generadores de códigos de negocio.
 *
 * Formato: `<prefijo><número con relleno de ceros>`, p. ej. `ORD-083921`,
 * `RES-000042`, `RENT-001029`, `PAY-000007` (BR-ORDER-001 y secciones 4.3/4.6).
 *
 * GARANTÍA DE UNICIDAD:
 *  1. El siguiente número se deriva del `MAX` actual **leído dentro de la
 *     misma transacción** que va a insertar. Como el UnitOfWork abre con
 *     `BEGIN IMMEDIATE`, el lock de escritura se toma al empezar: ninguna
 *     otra conexión puede leer ni escribir entre el `MAX` y el `INSERT`.
 *  2. Aun así, se comprueba que el candidato no exista (códigos heredados,
 *     huecos en la secuencia, prefijos distintos en la misma columna) y se
 *     incrementa hasta encontrar uno libre. El `UNIQUE` de la columna es la
 *     garantía final.
 *  3. La llamada **debe** hacerse dentro de `runInTransaction`; fuera de ella
 *     la secuencia no es atómica y puede duplicar.
 *
 * NOTA DE CAPAS: este módulo contiene SQL por decisión explícita del
 * contrato de la fundación (es el generador de códigos). Es la única
 * excepción a "sólo la capa de persistencia escribe SQL" y está aislada aquí.
 */
import type { Db } from '../database/connection.js';

/** Relleno por defecto del sufijo numérico (BR-ORDER-001: 6 dígitos). */
export const DEFAULT_CODE_PAD = 6;

/** Intentos máximos antes de declarar conflicto de secuencia. */
const MAX_ATTEMPTS = 1_000;

/**
 * Identificadores SQL seguros: minúsculas, `_` y dígitos, empezando por letra.
 * Las tablas y columnas **nunca** vienen de la entrada del usuario: son
 * literales del código, pero se validan igualmente para que un descuido
 * futuro no convierta esto en una inyección.
 */
const SAFE_IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function assertSqlIdentifier(value: string, label: string): void {
  if (!SAFE_IDENTIFIER.test(value)) {
    throw new Error(
      `Identificador SQL no permitido en generateCode: "${value}" (${label}). ` +
        'Sólo se admiten minúsculas, dígitos y guion bajo empezando por letra.',
    );
  }
}

export interface GenerateCodeOptions {
  /**
   * Dígitos de relleno del sufijo. `6` -> `000042`. Por defecto
   * {@link DEFAULT_CODE_PAD}.
   */
  readonly pad?: number;
  /**
   * Prefijo de la secuencia, normalmente con su separador: `'ORD-'`,
   * `'RES-'`, `'RENT-'`, `'PAY-'`.
   */
  readonly prefix: string;
  /** Número de intentos antes de fallar. Por defecto 1000. */
  readonly maxAttempts?: number;
}

/**
 * Devuelve el siguiente código libre para `(table, column)`.
 *
 * El prefijo se compara con `LIKE 'prefijo%'`, de modo que un prefijo más
 * corto (`ORD-`) nunca captura los códigos de otro prefijo (`ORD2-`).
 *
 * @param tx Conexión de la transacción en curso (la misma del UnitOfWork).
 * @param table Tabla donde vive la columna, p. ej. `'orders'`.
 * @param column Columna del código, p. ej. `'order_number'`.
 * @throws Error si el SQL viola una restricción `UNIQUE` o la secuencia no
 *         encuentra hueco tras `maxAttempts` intentos.
 */
export function generateCode(
  tx: Db,
  table: string,
  column: string,
  prefix: string,
  pad: number = DEFAULT_CODE_PAD,
): string {
  return generateCodeWithOptions(tx, table, column, { prefix, pad });
}

/** Igual que {@link generateCode} pero con opciones tipadas. */
export function generateCodeWithOptions(
  tx: Db,
  table: string,
  column: string,
  options: GenerateCodeOptions,
): string {
  const { prefix, pad = DEFAULT_CODE_PAD, maxAttempts = MAX_ATTEMPTS } = options;

  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new Error('El prefijo del código de negocio es obligatorio');
  }
  if (!Number.isInteger(pad) || pad < 1 || pad > 20) {
    throw new RangeError('El relleno del código debe ser un entero entre 1 y 20');
  }
  assertSqlIdentifier(table, 'table');
  assertSqlIdentifier(column, 'column');

  const selectMax = tx.prepare(
    `SELECT MAX(CAST(SUBSTR(${column}, ?) AS INTEGER)) AS max_value
       FROM ${table}
      WHERE ${column} LIKE ? ESCAPE '\\'`,
  );
  const exists = tx.prepare(`SELECT 1 AS present FROM ${table} WHERE ${column} = ? LIMIT 1`);

  const row = selectMax.get(prefix.length + 1, `${escapeLike(prefix)}%`) as
    | { max_value: number | null }
    | undefined;
  const currentMax = row?.max_value;
  let sequence =
    typeof currentMax === 'number' && Number.isFinite(currentMax) ? currentMax : 0;

  const run = (): string => {
    sequence += 1;
    return `${prefix}${String(sequence).padStart(pad, '0')}`;
  };

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = run();
    if (exists.get(candidate) === undefined) {
      return candidate;
    }
  }

  throw new Error(
    `No se pudo generar un código libre para ${table}.${column} con el prefijo "${prefix}" ` +
      `tras ${maxAttempts} intentos.`,
  );
}

/** Escapa los comodines de `LIKE` en el prefijo. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** `businesses.order_prefix` + 6 dígitos: `ORD-083921` (BR-ORDER-001). */
export function generateOrderNumber(tx: Db, orderPrefix: string, pad = DEFAULT_CODE_PAD): string {
  return generateCode(tx, 'orders', 'order_number', orderPrefix, pad);
}

/** `chair_reservations.code`: `RES-000042`. */
export function generateReservationCode(tx: Db, pad = DEFAULT_CODE_PAD): string {
  return generateCode(tx, 'chair_reservations', 'code', 'RES-', pad);
}

/** `chair_rentals.code`: `RENT-001029`. */
export function generateRentalCode(tx: Db, pad = DEFAULT_CODE_PAD): string {
  return generateCode(tx, 'chair_rentals', 'code', 'RENT-', pad);
}

/** `payments.payment_number`: `PAY-000007`. */
export function generatePaymentNumber(tx: Db, pad = DEFAULT_CODE_PAD): string {
  return generateCode(tx, 'payments', 'payment_number', 'PAY-', pad);
}
