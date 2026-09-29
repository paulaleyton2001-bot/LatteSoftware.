/**
 * Motor de precio de un pedido. Funciones PURAS: sin base de datos, sin
 * `Date.now()` y sin excepciones de negocio.
 *
 * ============================================================================
 * POR QUÉ UN FICHERO PROPIO
 * ============================================================================
 * Esta es la parte del sistema de la que depende el dinero que entra por caja
 * (criterio 1 de DESIGN.md 1.3, CORRECTNESS). Si viviera dentro de
 * `OrdersService`, la única forma de probar el redondeo de un caso como
 * "tres líneas de 33 y un cupón del 10 %" sería montar la base de datos y llamar
 * a un endpoint. Aquí cada caso es una línea de tabla en `tests/orders.spec.ts`.
 *
 * ============================================================================
 * EL ORDEN ES FIJO E INNEGOCIABLE (BR-MONEY-003)
 * ============================================================================
 *   1. LÍNEA     -> (precio producto + addons) x cantidad, redondeado half-up
 *   2. SUBTOTAL  -> suma de los `line_total_minor` YA redondeados
 *   3. DESCUENTO -> cupón sobre la base, recortado a `max_discount_minor` y a
 *                   la propia base; prorrateado entre líneas sin perder centavos
 *   4. IMPUESTO  -> POR LÍNEA, sobre (línea - su parte de descuento), con la tasa
 *                   del producto o, si no tiene, la del negocio
 *   5. SERVICIO  -> `roundHalfUp((subtotal - descuento) * service_fee_bp / 10000)`
 *   6. TOTAL     -> `subtotal - descuento + impuesto + servicio`
 *
 * Cualquier otro orden es un bug, y no uno theoretical: recalcular el total desde
 * el subtotal original, en vez de sumar valores ya redondeados, produce la deriva
 * de un centavo por línea que BR-MONEY-004 prohíbe expresamente.
 *
 * ============================================================================
 * DÓNDE ESTÁ CADA DECISIÓN
 * ============================================================================
 *  - El precio UNITARIO lo resuelve `catalog/catalog.pricing.ts` con la
 *    prioridad `promo > variant.price_minor > base + delta > base` (BR-PRICE-001).
 *    Aquí se recibe ya resuelto: este fichero no consulta el catálogo.
 *  - El IMPORTE DEL CUPÓN lo resuelve el módulo de descuentos
 *    (`DiscountsService.quote`), que es quien conoce `usage_limit`, la ventana y
 *    el ámbito. Aquí se recibe ya resuelto.
 *  - La TASA DE IMPUESTO la decide el llamante por línea, porque puede venir de
 *    `products.tax_rate_bp` o del negocio (BR-TAX-004), y esa decisión necesita
 *    el producto, que no existe en este fichero.
 */
import { addMinor, applyTaxBp, multiplyMinor, roundHalfUp } from '../../shared/utils/money.js';

/** Una línea ya cotizada, tal y como la entrega el llamante. */
export interface PricedLine {
  /**
   * Identificador de la línea. Sólo se usa para ordenar el prorrateo del
   * descuento; no aparece en el resultado (BR-MONEY-005 desempata por `id`
   * ascendente, y aquí el llamante garantiza que coincide con el de la base).
   */
  readonly id: number;
  /** Snapshot del precio unitario del producto, ya con variante y promo. */
  readonly unitPriceMinor: number;
  /** Cantidad. Puede ser fraccional (pesajes). */
  readonly quantity: number;
  /**
   * Suma de `price_minor * quantity` de sus complementos (BR-PRICE-003).
   * Se suman al precio unitario ANTES de multiplicar por la cantidad.
   */
  readonly addonsMinor: number;
  /** Tasa de impuesto en basis points de la LÍNEA (BR-TAX-004). */
  readonly taxRateBp: number;
}

/** Una línea con su resultado, para persistir en `order_items`. */
export interface ComputedLine extends PricedLine {
  /** `roundHalfUp((unitPrice + addons) * quantity)` (BR-PRICE-002/003). */
  readonly lineTotalMinor: number;
  /** Parte del descuento del pedido prorrateada a esta línea. */
  readonly discountMinor: number;
  /** Impuesto de la línea: `roundHalfUp((lineTotal - discount) * taxRateBp/10000)`. */
  readonly taxMinor: number;
  /** `lineTotal - discount + tax`: lo que ocupa la línea en el total. */
  readonly effectiveTotalMinor: number;
}

/** Ajustes del negocio que afectan al cálculo (de `businesses`). */
export interface PricingSettings {
  /** `businesses.tax_rate_bp`, usada cuando la línea no trae tasa propia. */
  readonly taxRateBp: number;
  /**
   * `true` si `businesses.tax_inclusive = 1`: los precios del catálogo ya
   * incluyen impuesto, así que `tax_minor` se registra en 0 y el total es igual a
   * la base (BR-TAX-003).
   */
  readonly taxInclusive: boolean;
  /** `businesses.service_fee_bp` (BR-TAX-005). */
  readonly serviceFeeBp: number;
}

/** Entrada de {@link computeOrderTotals}. */
export interface OrderTotalsInput {
  /** Líneas de producto, ya con su precio unitario resuelto. */
  readonly lines: readonly PricedLine[];
  /**
   * Importe del cupón, ya validado y recortado por el módulo de descuentos.
   * `0` o `null` si el pedido no lleva cupón.
   */
  readonly discountMinor: number;
  readonly settings: PricingSettings;
  /**
   * Base adicional que entra en el subtotal sin ser línea de producto: el
   * `total_minor` de un alquiler de silla (BR-ORDER-012 impide mezclar líneas de
   * producto con un alquiler, así que no hay los dos a la vez).
   */
  readonly rentalBaseMinor?: number;
  /**
   * Tasa del NEGOCIO para la base de alquiler (BR-TAX-007: el alquiler se grava
   * a la tasa del negocio, nunca a la de un producto).
   */
  readonly rentalTaxRateBp?: number;
}

/** Resultado completo del cálculo, en centavos enteros. */
export interface OrderTotals {
  /** Suma de `line_total_minor` más la base de alquiler, ANTES de descuento. */
  readonly subtotalMinor: number;
  /** Descuento aplicado, ya recortado. Nunca mayor que el subtotal. */
  readonly discountMinor: number;
  /**
   * Impuesto a sumar al total. Con `taxInclusive = 1` vale 0 y
   * {@link taxIncludedMinor} lleva el importe INFORMATIVO que paga el cliente
   * dentro del precio (BR-TAX-003).
   */
  readonly taxMinor: number;
  /** `taxInclusive` es `false` y se registra en 0; BR-TAX-003. */
  readonly taxInclusive: boolean;
  /**
   * Impuesto contenido en el precio cuando `taxInclusive = 1`:
   * `roundHalfUp(base * rate / (10000 + rate))`. Sólo informativo: NO altera
   * ningún total almacenado, es lo que el recibo desglosa como "incluido".
   */
  readonly taxIncludedMinor: number;
  /** `roundHalfUp((subtotal - discount) * service_fee_bp / 10000)`. */
  readonly serviceFeeMinor: number;
  /** `subtotal - discount + tax + serviceFee` (BR-MONEY-003). */
  readonly totalMinor: number;
  /** Líneas con su parte de descuento y su impuesto ya prorrateados. */
  readonly lines: readonly ComputedLine[];
  /** Identificadores de `DESIGN.md` aplicados, para `meta.appliedRules`. */
  readonly appliedRules: readonly string[];
}

/** Reglas que este fichero cumple siempre, en el orden de aplicación. */
const APPLIED_RULES = [
  'BR-PRICE-002',
  'BR-PRICE-003',
  'BR-MONEY-003',
  'BR-MONEY-004',
  'BR-MONEY-005',
  'BR-TAX-002',
  'BR-TAX-004',
  'BR-TAX-005',
] as const;

/**
 * Precio de una línea antes de descuentos e impuestos (BR-PRICE-002/003).
 *
 * El redondeo ocurre UNA vez, al final, y es half-up (BR-MONEY-011): `0.5` sube
 * a `1`, que es lo que espera un cajero.
 *
 * @example
 * lineTotalMinor({ unitPriceMinor: 12_000, addonsMinor: 500, quantity: 1.5 })
 * // 18_750
 */
export function lineTotalMinor(line: PricedLine): number {
  const unitWithAddons = addMinor(line.unitPriceMinor, line.addonsMinor);
  return multiplyMinor(unitWithAddons, line.quantity);
}

/**
 * Prorratea un descuento entre líneas SIN perder ni inventar centavos.
 *
 * ============================================================================
 * POR QUÉ NO `allocateMinor` DE `money.ts`
 * ============================================================================
 * `allocateMinor` reparte por "mayor resto primero", que es lo correcto para un
 * reparto estadístico. BR-MONEY-005 pide algo distinto y más legible para un
 * cajero: el centavo de ajuste va a la línea de MAYOR `line_total_minor`, con
 * desempate por `order_item.id` ascendente. Con un pedido de tres cafés idénticos
 * el resultado es el mismo; con un pedido de 9.999, 9.999 y 4.002 la diferencia
 * es visible en el recibo y el criterio tiene que ser el del diseño.
 *
 * Invariante: `shares.reduce(+)` es SIEMPRE igual a `discountMinor`.
 */
export function allocateDiscountMinor(
  discountMinor: number,
  lines: readonly { readonly id: number; readonly lineTotalMinor: number }[],
): readonly number[] {
  if (lines.length === 0) {
    return [];
  }
  if (discountMinor <= 0) {
    return new Array<number>(lines.length).fill(0);
  }

  const weights = lines.map((line) => line.lineTotalMinor);
  const totalWeight = weights.reduce<number>((accumulator, weight) => accumulator + weight, 0);
  if (totalWeight <= 0) {
    // Todas las líneas a cero: el descuento entero va a la primera, que es la
    // única distribución posible sin inventar centavos.
    const shares = new Array<number>(lines.length).fill(0);
    shares[0] = discountMinor;
    return shares;
  }

  // 1. Reparto exacto en coma flotante, una parte por línea.
  const exact = weights.map((weight) => (discountMinor * weight) / totalWeight);
  // 2. Cada línea recibe el suelo de su parte.
  const shares = exact.map((value) => Math.floor(value));
  let residual = discountMinor - shares.reduce<number>((accumulator, share) => accumulator + share, 0);

  // 3. Los centavos sobrantes van, en este orden exacto, a la línea de mayor
  //    `line_total_minor` y, a igualdad, a la de menor `id`.
  const byPriority = lines
    .map((line, index) => ({ index, lineTotalMinor: line.lineTotalMinor, id: line.id }))
    .sort((a, b) =>
      b.lineTotalMinor !== a.lineTotalMinor
        ? b.lineTotalMinor - a.lineTotalMinor
        : a.id - b.id,
    );

  let cursor = 0;
  while (residual > 0 && byPriority.length > 0) {
    const target = byPriority[cursor % byPriority.length];
    if (target === undefined) break;
    shares[target.index] = (shares[target.index] ?? 0) + 1;
    residual -= 1;
    cursor += 1;
  }

  return shares;
}

/**
 * IMPUESTO CONTENIDO en un precio con `taxInclusive = 1` (BR-TAX-003).
 *
 * Sólo informativo: el recibo lo muestra desglosado, pero ni `tax_minor` ni
 * `total_minor` cambian. La fórmula invierte `base * (1 + rate)`:
 * `impuesto = base * rate / (10_000 + rate)`.
 */
export function taxIncludedIn(baseMinor: number, taxRateBp: number): number {
  if (taxRateBp <= 0) {
    return 0;
  }
  return roundHalfUp((baseMinor * taxRateBp) / (10_000 + taxRateBp));
}

/**
 * Calcula TODOS los totales de un pedido.
 *
 * Verifica internamente el invariante de BR-DISC-002 (`discountMinor <=
 * subtotalMinor`) y recorta el descuento si llega mayor, en vez de dejar que el
 * CHECK de la base de datos rechace la escritura con un 500. El recorte, no el
 * error, es la regla: un cupón que vale más que el pedido se aplica por su
 * valor real, que es cero, y por eso el módulo de descuentos lo avisa antes.
 *
 * @example
 * computeOrderTotals({
 *   lines: [{ id: 1, unitPriceMinor: 20_000, addonsMinor: 0, quantity: 2, taxRateBp: 1900 }],
 *   discountMinor: 2_000,
 *   settings: { taxRateBp: 1900, taxInclusive: false, serviceFeeBp: 0 },
 * });
 * // subtotal 40_000, discount 2_000, tax 7_220, total 45_220
 * //   (línea 38_000 * 19 % = 7_220 exactos)
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  const { settings } = input;
  const rentalBaseMinor = input.rentalBaseMinor ?? 0;

  // --- 1. LÍNEA -------------------------------------------------------------
  // El precio unitario de la línea es el producto YA resuelto (promo, variante o
  // base). Este fichero no vuelve a mirar el catálogo: BR-PRICE-008 dice que el
  // único total válido es el que devuelve el servidor al crear el pedido.
  const baseLines = input.lines.map((line) => ({
    ...line,
    lineTotalMinor: lineTotalMinor(line),
  }));

  // --- 2. SUBTOTAL ----------------------------------------------------------
  // Suma de importes YA redondeados (BR-MONEY-004), nunca un recálculo.
  const lineSubtotal = baseLines.reduce<number>(
    (accumulator, line) => accumulator + line.lineTotalMinor,
    0,
  );
  const subtotalMinor = addMinor(lineSubtotal, rentalBaseMinor);

  // --- 3. DESCUENTO ---------------------------------------------------------
  // BR-DISC-002 / BR-MONEY-010: `discount_minor <= subtotal_minor`. Se recorta en
  // memoria para que el CHECK de `orders` nunca salte por una cifra de negocio.
  const discountMinor = Math.max(0, Math.min(input.discountMinor, subtotalMinor));
  const baseAfterDiscount = subtotalMinor - discountMinor;

  // --- 4. IMPUESTO ----------------------------------------------------------
  // POR LÍNEA (BR-TAX-004): dos productos con tasas distintas no se pueden
  // gravar con una media, así que cada línea usa la suya y se suman.
  //
  // Con `taxInclusive = 1` el precio ya lo incluye: `tax_minor` se registra en 0
  // (BR-TAX-003) y el importe real se devuelve aparte, sólo para el recibo.
  const rentalTaxRateBp = input.rentalTaxRateBp ?? settings.taxRateBp;
  // BR-ORDER-012: un pedido es de productos O de alquiler, nunca de los dos. Por
  // eso la base de alquiler, cuando existe, define la tasa efectiva del recibo.
  const effectiveRateBp = rentalBaseMinor > 0 ? rentalTaxRateBp : settings.taxRateBp;

  const discountShares = allocateDiscountMinor(
    discountMinor,
    baseLines.map((line) => ({ id: line.id, lineTotalMinor: line.lineTotalMinor })),
  );

  const lines: ComputedLine[] = baseLines.map((line, index) => {
    const lineDiscount = discountShares[index] ?? 0;
    const lineTax = settings.taxInclusive
      ? 0
      : applyTaxBp(Math.max(0, line.lineTotalMinor - lineDiscount), line.taxRateBp);
    return {
      ...line,
      discountMinor: lineDiscount,
      taxMinor: lineTax,
      effectiveTotalMinor: addMinor(line.lineTotalMinor, -lineDiscount, lineTax),
    };
  });

  const lineTaxTotal = lines.reduce<number>((accumulator, line) => accumulator + line.taxMinor, 0);
  // Con líneas de producto, TODO el descuento ya está prorrateado entre ellas y
  // el alquiler no existe. Sin líneas, el descuento completo corresponde al
  // alquiler. Por eso `rentalDiscount` es la diferencia entre lo pedido y lo
  // repartido, y sólo es distinta de cero cuando no hay líneas.
  const allocatedToLines = discountShares.reduce<number>((accumulator, share) => accumulator + share, 0);
  const rentalDiscount = Math.max(0, discountMinor - allocatedToLines);
  // El alquiler se grava a la tasa del NEGOCIO, nunca a la de un producto
  // (BR-TAX-007), y también sobre su parte proporcional de descuento.
  const rentalTax = settings.taxInclusive
    ? 0
    : applyTaxBp(Math.max(0, rentalBaseMinor - rentalDiscount), rentalTaxRateBp);
  const taxMinor = addMinor(lineTaxTotal, rentalTax);

  // --- 5. SERVICIO ----------------------------------------------------------
  // Sobre la base post-descuento, y SIN impuesto encima (BR-TAX-002/005).
  const serviceFeeMinor = applyTaxBp(baseAfterDiscount, settings.serviceFeeBp);

  // --- 6. TOTAL -------------------------------------------------------------
  // Suma de valores ya redondeados (BR-MONEY-004).
  const totalMinor = addMinor(baseAfterDiscount, taxMinor, serviceFeeMinor);

  return {
    subtotalMinor,
    discountMinor,
    taxMinor,
    taxInclusive: settings.taxInclusive,
    // Sólo informativo, y sólo cuando el precio ya incluía impuesto.
    taxIncludedMinor: settings.taxInclusive
      ? taxIncludedIn(baseAfterDiscount, effectiveRateBp)
      : 0,
    serviceFeeMinor,
    totalMinor,
    lines,
    appliedRules: APPLIED_RULES,
  };
}

/**
 * Reparto de un cobro en efectivo entre el pedido y el cambio (BR-MONEY-007/008).
 *
 * ============================================================================
 * LAS DOS REGLAS QUE CUSTAN DINERO
 * ============================================================================
 *  1. `orders.paid_minor` NUNCA puede superar `total_minor`. Lo que se imputa al
 *     pedido es, como mucho, el saldo pendiente; lo que el cliente entregó de más
 *     es CAMBIO y se devuelve en la respuesta, nunca se guarda como pago. Si se
 *     guardara, el saldo quedaría en negativo y `orders.paid_minor` contaría
 *     dinero que nadie debe.
 *  2. Un pago en efectivo NUNCA deja `balance_minor` negativo. El exceso es
 *     cambio, no un favor: por eso `appliedMinor` está acotado por el saldo y
 *     `changeDueMinor` es lo que sobra de lo entregado.
 *
 * @param amountMinor    Importe que el cajero imputa al cobro.
 * @param receivedMinor  Efectivo que entregó el cliente. Puede ser MAYOR.
 * @param balanceMinor   Saldo pendiente del pedido en este instante.
 * @returns `appliedMinor` (lo que suma a `paid_minor`) y `changeDueMinor`.
 *
 * @example
 * // Cliente entrega 20.000 por un pedido de 11.900.
 * settleCashPayment({ amountMinor: 20_000, receivedMinor: 20_000, balanceMinor: 11_900 })
 * // { appliedMinor: 11_900, changeDueMinor: 8_100 }
 */
export function settleCashPayment(params: {
  readonly amountMinor: number;
  /** Efectivo entregado por el cliente. Sólo tiene sentido con `CASH`. */
  readonly receivedMinor: number;
  /** Saldo pendiente del pedido, en el momento del cobro. */
  readonly balanceMinor: number;
}): { readonly appliedMinor: number; readonly changeDueMinor: number } {
  const outstanding = Math.max(0, params.balanceMinor);
  // Lo que entra al pedido nunca es más que lo que el pedido debe.
  const appliedMinor = Math.min(params.amountMinor, outstanding);
  // El cambio es lo entregado menos lo imputado. Si el cajero imputa 20.000 pero
  // el pedido debe 11.900, se devuelven 8.100; si imputa 5.000 de un saldo de
  // 11.900, no hay cambio y el pedido sigue debiendo 6.900.
  const changeDueMinor = Math.max(0, params.receivedMinor - appliedMinor);
  return { appliedMinor, changeDueMinor };
}
