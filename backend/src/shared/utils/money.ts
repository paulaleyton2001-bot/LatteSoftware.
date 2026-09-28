/**
 * Aritmética de dinero en enteros.
 *
 * REGLAS INVARIANTES (DESIGN.md 7.2, BR-MONEY-001..011):
 *  1. El dinero se representa SIEMPRE como `INTEGER` en centavos. Nunca se
 *     almacena un `float`. `500000` = $5.000 COP.
 *  2. Los cálculos intermedios pueden ser `float` por comodidad, pero el
 *     resultado de cada operación pública SIEMPRE se redondea a entero.
 *  3. El redondeo es **half-up**: `roundHalfUp(v) = Math.floor(v + 0.5)`.
 *     No se usa `Math.round` para que el comportamiento sea idéntico en
 *     cualquier runtime y testeable de forma determinista.
 *  4. `roundHalfUp` es simétrico: `-0.5` produce `-0`, que se normaliza a `0`
 *     para que nunca exista un total negativo "-0" en la base de datos.
 *  5. Cada paso del pipeline redondea a centavo y el total se obtiene
 *     **sumando valores ya redondeados** (BR-MONEY-004), evitando la deriva de
 *     un centavo por línea.
 */

/** Base del redondeo half-up explícita y documentada (BR-MONEY-002). */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundHalfUp requiere un número finito, recibido: ${String(value)}`);
  }
  // `Math.floor(v + 0.5)` es half-up para positivos y, por simetría, half-up
  // "hacia el infinito en magnitud"; el `-0` se normaliza a `0`.
  const rounded = Math.floor(value + 0.5);
  return rounded === 0 ? 0 : rounded;
}

/** Valida que un valor sea un entero de centavos representable. */
function assertMinor(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} debe ser un número finito, recibido: ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(
      `${label} debe ser un entero en centavos (BR-MONEY-001), recibido: ${String(value)}`,
    );
  }
}

/** Suma exacta de importes en centavos. Sin punto flotante. */
export function addMinor(...amounts: readonly number[]): number {
  let total = 0;
  for (const amount of amounts) {
    assertMinor(amount, 'Importe a sumar');
    total += amount;
  }
  return total;
}

/** Resta exacta de importes en centavos. El resultado puede ser negativo. */
export function subtractMinor(minuend: number, subtrahend: number): number {
  assertMinor(minuend, 'Minuendo');
  assertMinor(subtrahend, 'Sustraendo');
  return minuend - subtrahend;
}

/** Negación de un importe. */
export function negateMinor(amount: number): number {
  assertMinor(amount, 'Importe');
  return -amount;
}

/**
 * Multiplica centavos por un factor y redondea half-up al entero más cercano.
 *
 * Es la operación central del sistema: precio de línea (`unit * quantity`,
 * BR-PRICE-002), minutos de alquiler (`minutes / 60 * price`, BR-RENTAL-001)
 * y base imponible.
 *
 * @example
 * multiplyMinor(500000, 1.5)   // 750000
 * multiplyMinor(100, 2.5)       // 250   (exacto, sin deriva)
 * multiplyMinor(101, 1.5)       // 152   (151.5 -> 152, half-up)
 */
export function multiplyMinor(minor: number, factor: number): number {
  assertMinor(minor, 'Importe base');
  if (!Number.isFinite(factor)) {
    throw new RangeError(`El factor debe ser un número finito, recibido: ${String(factor)}`);
  }
  return roundHalfUp(minor * factor);
}

/**
 * Aplica una tasa en **basis points** (1 bp = 0.01 %) sobre una base.
 *
 * `tax_rate_bp = 1900` significa 19.00 % (BR-TAX-001).
 * El cargo por servicio usa la misma fórmula (BR-TAX-005).
 *
 * @example
 * applyTaxBp(100_000, 1900)  // 19_000
 */
export function applyTaxBp(minor: number, basisPoints: number, denominator = 10_000): number {
  assertMinor(minor, 'Base imponible');
  if (!Number.isInteger(basisPoints)) {
    throw new RangeError('La tasa debe ser un entero en basis points');
  }
  if (denominator <= 0) {
    throw new RangeError('El denominador debe ser mayor que cero');
  }
  return roundHalfUp((minor * basisPoints) / denominator);
}

/**
 * Aplica un porcentaje (0-100) sobre una base y redondea half-up.
 * Es un alias explícito de {@link applyTaxBp} con el divisor 100 para dejar
 * claro que el porcentaje no es la unidad de negocio.
 */
export function applyPercent(minor: number, percent: number): number {
  assertMinor(minor, 'Base imponible');
  if (!Number.isFinite(percent)) {
    throw new RangeError(`El porcentaje debe ser finito, recibido: ${String(percent)}`);
  }
  return roundHalfUp((minor * percent) / 100);
}

/** Resultado de {@link allocateMinor}. */
export interface AllocationResult {
  /** Parte asignada a cada línea, en el mismo orden de entrada. */
  readonly shares: readonly number[];
  /** Suma de las partes. Igual a `total` salvo residuo no distribuible. */
  readonly allocatedTotal: number;
  /** Centavos que no se pudieron distribuir (sólo si `parts` es 0). */
  readonly remainder: number;
}

/**
 * Reparte un total entre N partes **sin perder ni inventar centavos**.
 *
 * Segundo argumento, dos formas:
 *  - `number`  -> número de partes con reparto uniforme.
 *  - `array`   -> pesos no negativos; `null` equivale a peso 1.
 *
 * Algoritmo (mayor resto primero, determinista):
 *  1. Se calcula el reparto exacto en coma flotante: `exact_i = total * w_i / Σw`.
 *  2. Cada parte recibe `floor(exact_i)`.
 *  3. Los centavos sobrantes se asignan de mayor residuo a menor; a igualdad de
 *     residuo, a la parte de **menor índice**, lo que hace el resultado
 *     reproducible ante el mismo input.
 *
 * Invariante: `shares.reduce(+)` es SIEMPRE igual a `total`, incluso cuando
 * `total` no es divisible por el número de partes.
 *
 * @example
 * allocateMinor(100, [1, 1, 1])  // { shares: [34, 33, 33] }  suma 100 exacto
 * allocateMinor(10, 3)            // { shares: [4, 3, 3] }
 * allocateMinor(1000, [7, 3])     // { shares: [700, 300] }
 */
export function allocateMinor(
  total: number,
  weightsOrParts: readonly (number | null)[] | number,
): AllocationResult {
  assertMinor(total, 'Total a repartir');

  const isUniform = typeof weightsOrParts === 'number';
  const count = isUniform
    ? weightsOrParts
    : (weightsOrParts as readonly (number | null)[]).length;

  if (!Number.isInteger(count) || count <= 0) {
    throw new RangeError('El número de partes debe ser un entero mayor que cero');
  }

  const effective: readonly number[] = isUniform
    ? new Array<number>(count).fill(1)
    : (weightsOrParts as readonly (number | null)[]).map((weight) => weight ?? 1);

  for (const weight of effective) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`Los pesos deben ser no negativos, recibido: ${String(weight)}`);
    }
  }

  const weightSum = effective.reduce<number>((acc, weight) => acc + weight, 0);
  if (weightSum <= 0) {
    // Todos los pesos son cero: reparto uniforme.
    const base = Math.floor(total / count);
    const remainder = total - base * count;
    const shares = new Array<number>(count).fill(base);
    for (let index = 0; index < remainder; index += 1) {
      shares[index] = (shares[index] ?? 0) + 1;
    }
    return { shares, allocatedTotal: total, remainder: 0 };
  }

  const exact = effective.map((weight) => (total * weight) / weightSum);
  const shares = exact.map((value) => Math.floor(value));

  let residual = total - shares.reduce<number>((acc, share) => acc + share, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => {
      if (b.fraction !== a.fraction) return b.fraction - a.fraction;
      return a.index - b.index;
    });

  let cursor = 0;
  while (residual > 0 && order.length > 0) {
    const target = order[cursor % order.length];
    if (target === undefined) break;
    shares[target.index] = (shares[target.index] ?? 0) + 1;
    residual -= 1;
    cursor += 1;
  }

  const allocatedTotal = shares.reduce<number>((acc, share) => acc + share, 0);
  return { shares, allocatedTotal, remainder: total - allocatedTotal };
}

/** Restricciones de la base de datos en columnas `*_minor`. */
export const MINOR_LIMIT = {
  /** CHECK `*_minor >= 0`. */
  NON_NEGATIVE: 0,
  /** CHECK `amount_minor > 0` en pagos. */
  STRICTLY_POSITIVE: 1,
  /** `tax_rate_bp` / `service_fee_bp` admiten de 0 a 100 % (10000 bp). */
  MAX_BASIS_POINTS: 10_000,
} as const;

/** Divisores y tamaños de los códigos ISO-4217 admitidos para presentación. */
const CURRENCY_MINOR_DIGITS: Readonly<Record<string, number>> = {
  COP: 0,
  CLP: 0,
  JPY: 0,
  KRW: 0,
  VND: 0,
  USD: 2,
  EUR: 2,
  MXN: 2,
  COP_PRECISE: 2,
};

/** Formatea centavos como texto presentable. NUNCA usar como valor numérico. */
export function formatMinor(minor: number, currency: string, locale = 'es-CO'): string {
  assertMinor(minor, 'Importe a formatear');
  const code = currency.toUpperCase();
  const digits = CURRENCY_MINOR_DIGITS[code] ?? 2;
  const value = minor / 10 ** digits;
  try {
    const formatted = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
    // Intl inserta un espacio (NBSP U+00A0 o U+202F) entre el símbolo y la
    // cifra: "$ 5.000". API.md 6.1 exige "$5.000", así que se elimina
    // cualquier espacio de separación.
    return formatted.replace(/[\u00a0\u202f\s]+/g, '');
  } catch {
    // Currency no reconocida por Intl: se degrada a un formato numérico
    // estable en lugar de romper la respuesta.
    return `${value.toFixed(digits)} ${code}`;
  }
}
