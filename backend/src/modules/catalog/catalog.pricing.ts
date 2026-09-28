/**
 * Resolución del precio unitario de una línea (BR-PRICE-001).
 *
 * ============================== POR QUÉ UN FICHERO PROPIO ==================
 * La prioridad del precio es la regla más fina del catálogo y la única que se
 * cumple en tres sitios a la vez: al mostrar el menú, al listar las variantes con
 * su `effectivePriceMinor` y al crear un pedido. Si cada uno reimplementara la
 * cascada, divergirían en el borde (una promo caducada, un delta negativo) y el
 * total del pedido dejaría de cuadrar con el precio mostrado.
 *
 * Por eso la decisión vive AQUÍ, en funciones PURAS: sin `Date.now()` (el
 * instante se recibe como parámetro), sin base de datos, sin excepciones de
 * negocio. `tests/catalog.spec.ts` las verifica con las cuatro rutas de la
 * prioridad, incluida la regla de oro: la promo gana sobre todo lo demás.
 *
 * ============================== LA PRIORIDAD ==============================
 * De DESIGN.md 7.1, literalmente y en este orden:
 *
 *   1. `promo`               -> `promo_price_minor` si la promo está ACTIVA
 *                               (`promo_starts_at <= now < promo_ends_at`).
 *   2. `variantAbsoluto`     -> `product_variants.price_minor`, que SOBREESCRIBE
 *                               el precio base.
 *   3. `baseMasDelta`        -> `products.base_price_minor + price_delta_minor`
 *                               (el delta puede ser negativo, BR-PRICE-009).
 *   4. `base`                -> `products.base_price_minor`, sin variante.
 *
 * Los importes son SIEMPRE enteros en centavos: el resultado no se redondea
 * porque ninguna de las cuatro operaciones introduce fracciones
 * (BR-MONEY-001/BR-MONEY-002).
 */
import type { PricedProduct, PricedVariant } from './catalog.types.js';

/** Crea un objeto frozen con clave igual a valor, y su tipo unión. */
function enumOf<const T extends readonly string[]>(values: T): Readonly<Record<T[number], T[number]>> {
  const result: Record<string, string> = {};
  for (const value of values) {
    result[value] = value;
  }
  return Object.freeze(result) as Readonly<Record<T[number], T[number]>>;
}

/**
 * De qué regla salió el precio unitario.
 *
 * Viaja en la respuesta de la API (`GET /products/:id/variants`) para que el
 * cliente pueda depurar un precio sin tener que reproducir la cascada, y en
 * `meta.appliedRules` cuando una promo está activa.
 */
export const UnitPriceSource = enumOf([
  'PROMO',
  'VARIANT_ABSOLUTE',
  'BASE_PLUS_DELTA',
  'BASE',
] as const);
export type UnitPriceSource = (typeof UnitPriceSource)[keyof typeof UnitPriceSource];

/** Precio unitario resuelto y la regla que lo produjo. */
export interface ResolvedUnitPrice {
  /** Precio en centavos, entero. Puede ser negativo si los datos lo permiten. */
  readonly unitPriceMinor: number;
  /** Regla de BR-PRICE-001 que ganó. */
  readonly source: UnitPriceSource;
}

/**
 * `true` si la promoción está vigente en el instante `now`.
 *
 * BR-PRICE-001 exige las TRES condiciones: precio no nulo y ventana
 * `promo_starts_at <= now < promo_ends_at`. Una promoción sin ventana
 * (ambos extremos nulos) NO se aplica: sin fecha de fin no hay forma de saber
 * si sigue viva, y aplicación de un precio caducado es peor que no aplicar
 * ninguno. Un producto con `promo_price_minor` y sin ventana es un dato
 * incompleto, y el service lo rechaza al escribir con `PROMO_WINDOW_INVALID`.
 *
 * La comparación es lexicográfica sobre el texto ISO-8601 UTC, que es la que
 * usa el resto del sistema (DESIGN.md 10.1) y la que SQLite usa al comparar
 * `TEXT`.
 */
export function isPromoActive(product: PricedProduct, now: string): boolean {
  if (product.promoPriceMinor === null) {
    return false;
  }
  if (product.promoStartsAt === null || product.promoEndsAt === null) {
    return false;
  }
  return product.promoStartsAt <= now && now < product.promoEndsAt;
}

/**
 * Resuelve el precio unitario efectivo de una línea (BR-PRICE-001).
 *
 * Es la función que el prompt exige que sea pura y testeable: no lee el reloj,
 * no lanza y no depende de nada del entorno. El precio negativo que puede
 * producir un delta excesivo NO se corrige aquí a propósito (silenciarlo sería
 * un bug escondido): lo rechaza el service con `INVALID_VARIANT_PRICE`
 * (BR-PRICE-009) al crear o editar la variante.
 *
 * @param product Datos de precio del producto.
 * @param variant Variante elegida, o `null` si la línea no lleva variante.
 * @param now     Instante de evaluación, ISO-8601 UTC. Se pasa para que el
 *                resultado sea reproducible en un test.
 * @example
 * resolveUnitPrice({ basePriceMinor: 5000, promoPriceMinor: 4000,
 *                   promoStartsAt: '2026-01-01T00:00:00.000Z',
 *                   promoEndsAt: '2026-12-31T00:00:00.000Z' },
 *                  { priceDeltaMinor: 500, priceMinor: null },
 *                  '2026-06-01T00:00:00.000Z');
 * // { unitPriceMinor: 4000, source: 'PROMO' }  <- la promo gana a la variante
 */
export function resolveUnitPrice(
  product: PricedProduct,
  variant: PricedVariant | null,
  now: string,
): ResolvedUnitPrice {
  // (1) Promo activa: gana sobre TODO, incluida una variante con precio propio.
  if (isPromoActive(product, now)) {
    return { unitPriceMinor: product.promoPriceMinor as number, source: UnitPriceSource.PROMO };
  }

  if (variant !== null) {
    // (2) Precio absoluto de la variante: sobreescribe el precio base.
    if (variant.priceMinor !== null) {
      return { unitPriceMinor: variant.priceMinor, source: UnitPriceSource.VARIANT_ABSOLUTE };
    }
    // (3) Precio base más el delta de la variante.
    return {
      unitPriceMinor: product.basePriceMinor + variant.priceDeltaMinor,
      source: UnitPriceSource.BASE_PLUS_DELTA,
    };
  }

  // (4) Sin variante: precio base del producto.
  return { unitPriceMinor: product.basePriceMinor, source: UnitPriceSource.BASE };
}

/**
 * Precio unitario de un producto concreto, ya resuelto.
 *
 * Es la forma que consumen las vistas (`ProductVariantView.effectivePriceMinor`,
 * el detalle de producto y el menú). Devuelve sólo el importe porque la regla
 * que ganó ya está implícita en la respuesta; quien necesite la traza usa
 * {@link resolveUnitPrice}.
 */
export function unitPriceOf(
  product: PricedProduct,
  variant: PricedVariant | null,
  now: string,
): number {
  return resolveUnitPrice(product, variant, now).unitPriceMinor;
}
