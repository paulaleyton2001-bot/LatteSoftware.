/**
 * Semilla de demostración del CATÁLOGO: 6 categorías, 24 productos, variantes,
 * complementos, recetas, inventario y sus movimientos de compra.
 *
 * ============================================================================
 * POR QUÉ EXISTE
 * ============================================================================
 * El esquema y la semilla de arranque crean el negocio y los roles, pero no el
 * catálogo: sin productos, `GET /api/v1/menu` devuelve una carta vacía, el POS no
 * tiene nada que vender y los reportes de ventas no tienen una sola línea. Esta
 * semilla deja una cafetería de especialidad completa y coherente.
 *
 * ============================================================================
 * IDEMPOTENCIA
 * ============================================================================
 * Cada fila tiene su clave natural (`categories.slug`, `products.sku`,
 * `product_variants(product_id, name)`, `product_addons(product_id, name)`,
 * `ingredients(business_id, name)`, `product_ingredients(product_id,
 * ingredient_id)` y los índices parciales `ux_inventory_product` /
 * `ux_inventory_ingredient`). La semilla inserta sólo lo que falta y, cuando la
 * fila ya existe, NO la toca: una edición del catálogo hecha por la API no se
 * pisa con un `npm run seed`.
 *
 * Excepción documentada: si una fila de demo existe pero con una semilla anterior
 * (por ejemplo, la `Terraza` con el precio por hora del negocio), se
 * CONCILIAN los campos de la demo (precio, rejilla, características) para que
 * dos ejecuciones convergen al mismo estado. Es una reconciliación, no una
 * sobrescritura de contenido: sólo toca columnas que esta semilla define.
 *
 * ============================================================================
 * PRECIOS
 * ============================================================================
 * Todo en CENTAVOS (`INTEGER`), nunca en coma flotante, y todos los importes
 * pasan por literales con separador de millar para que se lean de un vistazo.
 * Una taza de espresso de $3.500 son `350_000` centavos: `$3.500` en la carta es
 * `3500` pesos, que en esta base son `350000` centavos.
 *
 * ============================================================================
 * STOCK
 * ============================================================================
 * Un producto con `track_stock = 1` necesita su ítem en `inventory_items` (con
 * su índice parcial único por producto) o el POS lo rechaza al venderlo
 * (BR-INV-003). Se sigue el movimiento `PURCHASE` con su `balance_after`, y la
 * semilla VERIFICA al terminar que el último `balance_after` de cada ítem
 * coincide con su `current_stock`: si el libro no cuadra, la semilla falla en
 * lugar de dejar números que no significan nada.
 *
 * Dos ítems se dejan deliberadamente por debajo de su mínimo (`Tiramisú` y
 * `Leche de avena`): es el requisito del panel de inventario, que sin una alerta
 * real no demuestra nada.
 */
import { AUTH } from '../../config/index.js';
import type { Db } from '../../shared/database/connection.js';
import { logger } from '../../shared/logger/index.js';
import {
  InventoryUnit,
  MovementType,
  type InventoryUnit as InventoryUnitValue,
  type MovementType as MovementTypeValue,
} from '../../shared/domain/index.js';
import { addDays, nowIso } from '../../shared/utils/datetime.js';
import { SqliteInventoryRepository } from '../../modules/inventory/inventory.repository.sqlite.js';
import { slugify } from './demo-support.js';

// ===========================================================================
// Tipos de los datos de demostración
// ===========================================================================

/** Variante de tamaño: `priceMinor` absoluto gana sobre `priceDeltaMinor`. */
interface DemoVariant {
  readonly name: string;
  readonly code: string;
  /** Diferencia sobre el precio base. Puede ser negativa (BR-PRICE-001). */
  readonly priceDeltaMinor?: number;
  /** Precio absoluto: sobreescribe `base_price_minor` por completo. */
  readonly priceMinor?: number;
  readonly isDefault: boolean;
}

/** Complemento (`product_addons`). */
interface DemoAddon {
  readonly name: string;
  readonly code: string;
  readonly priceMinor: number;
  /** `true` = se puede pedir más de una vez, hasta `maxSelect`. */
  readonly isMultiple: boolean;
  readonly maxSelect?: number;
}

/** Línea de receta: cantidad POR UNIDAD de producto, en la unidad del insumo. */
interface DemoRecipeLine {
  readonly ingredient: string;
  readonly quantity: number;
}

/** Producto de demostración con todo su sub-catálogo. */
interface DemoProduct {
  readonly sku: string;
  readonly name: string;
  readonly categorySlug: string;
  readonly shortDescription: string;
  readonly description: string;
  readonly basePriceMinor: number;
  /** Promoción: precio y ventana EN DÍAS RELATIVOS al momento de sembrar. */
  readonly promo?: {
    readonly priceMinor: number;
    readonly startsDaysAgo: number;
    readonly endsInDays: number;
  };
  readonly isFeatured: boolean;
  readonly preparationMinutes: number;
  readonly trackStock: boolean;
  readonly variants?: readonly DemoVariant[];
  readonly addons?: readonly DemoAddon[];
  readonly recipe?: readonly DemoRecipeLine[];
}

/** Movimiento inicial del libro de inventario. */
interface DemoMovement {
  readonly type: MovementTypeValue;
  readonly quantity: number;
  /** Obligatorio para `WASTE` y `ADJUSTMENT` (CHECK del esquema). */
  readonly reason: string | null;
  readonly daysAgo: number;
}

/** Ítem de inventario: un producto o un insumo. */
interface DemoInventoryItem {
  /** `product` -> se resuelve por SKU; `ingredient` -> por nombre. */
  readonly kind: 'product' | 'ingredient';
  readonly key: string;
  readonly name: string;
  readonly sku: string;
  readonly unit: InventoryUnitValue;
  readonly minStock: number;
  readonly maxStock: number;
  readonly costMinor: number;
  readonly supplier: string;
  readonly locationStorage: string;
  readonly isTracked: boolean;
  /**
   * Libro inicial. La suma de sus `quantity` DEBE ser el `current_stock` que
   * queda después de sembrar; la semilla lo comprueba.
   */
  readonly movements: readonly DemoMovement[];
}

// ===========================================================================
// 6 CATEGORÍAS
// ===========================================================================

const CATEGORIES: readonly {
  readonly name: string;
  readonly description: string;
  readonly icon: string;
}[] = Object.freeze([
  {
    name: 'Cafés',
    description:
      'Grano de especialidad de Colombia y Brasil, tostado semanal. Del espresso corto al cold brew de extracción lenta.',
    icon: 'coffee',
  },
  {
    name: 'Bebidas',
    description:
      'Todo lo que no es café: chocolate de origen, matcha ceremonial, limonada de menta fresca y jugos del día.',
    icon: 'cold-drink',
  },
  {
    name: 'Comidas',
    description:
      'Masa laminada y rellenos del día, preparados al momento en que lo pides. Sin microondas y sin atajos.',
    icon: 'meal',
  },
  {
    name: 'Postres',
    description:
      'Repostería de la casa: cheesecake, tiramisú, brownies y cookies horneadas cada semana.',
    icon: 'dessert',
  },
  {
    name: 'Snacks',
    description: 'Para acompañar el café sin plato: papas de corte fino, frutos secos y galletas de avena.',
    icon: 'snack',
  },
  {
    name: 'Especiales',
    description: 'Combos y platos que combinan café, comida y postre en un solo pedido.',
    icon: 'combo',
  },
]);

// ===========================================================================
// 24 PRODUCTOS
// ===========================================================================

/** Tallas de bebida, reutilizadas por casi todos los productos con variantes. */
const SIZES = {
  small: 'Pequeño',
  medium: 'Mediano',
  large: 'Grande',
} as const;

const PRODUCTS: readonly DemoProduct[] = Object.freeze([
  // --- Cafés (7) -----------------------------------------------------------
  {
    sku: 'CAF-ESP-01',
    name: 'Espresso',
    categorySlug: 'cafes',
    shortDescription: 'Doble ristretto de nuestro blend de la casa, 36 g de café de especialidad.',
    description:
      'Nuestro blend del mes: notas a cacao, panela y un final limpio. Se extrae a 9 bar y 93 grados para sacar ' +
      'dulzor sin amargor. La base de todos los demás cafés de la carta.',
    basePriceMinor: 350_000,
    isFeatured: false,
    preparationMinutes: 3,
    trackStock: false,
    recipe: [{ ingredient: 'Grano de café 100 %', quantity: 0.018 }],
  },
  {
    sku: 'CAF-AME-01',
    name: 'Americano',
    categorySlug: 'cafes',
    shortDescription: 'Espresso con agua, del tamaño que quieras. El café de todos los días.',
    description:
      'Espresso y agua caliente, en la proporción que pidas más suave. Si lo prefieres con un chorrito de leche, ' +
      'pide un cortado o un latte: el americano no lleva leche.',
    basePriceMinor: 400_000,
    isFeatured: false,
    preparationMinutes: 4,
    trackStock: false,
    variants: [
      { name: SIZES.small, code: 'S', priceDeltaMinor: -80_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceDeltaMinor: 0, isDefault: true },
      { name: SIZES.large, code: 'L', priceDeltaMinor: 100_000, isDefault: false },
    ],
    recipe: [
      { ingredient: 'Grano de café 100 %', quantity: 0.018 },
      { ingredient: 'Azúcar', quantity: 0.005 },
    ],
  },
  {
    sku: 'CAF-LAT-01',
    name: 'Latte',
    categorySlug: 'cafes',
    shortDescription: 'Espresso con leche texturizada y arte en la taza.',
    description:
      'Nuestro café de siempre con leche vaporizada hasta una microespuma sedosa. Se sirve en 240, 350 o 470 ml ' +
      'y admite todas las leches y jarabes de la carta.',
    basePriceMinor: 550_000,
    isFeatured: true,
    preparationMinutes: 5,
    trackStock: false,
    variants: [
      { name: SIZES.small, code: 'S', priceDeltaMinor: -100_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceDeltaMinor: 0, isDefault: true },
      { name: SIZES.large, code: 'L', priceDeltaMinor: 130_000, isDefault: false },
    ],
    addons: [
      { name: 'Leche de avena', code: 'AVENA', priceMinor: 90_000, isMultiple: false },
      { name: 'Leche de almendra', code: 'ALMEN', priceMinor: 90_000, isMultiple: false },
      { name: 'Extra shot', code: 'SHOT', priceMinor: 120_000, isMultiple: true, maxSelect: 3 },
      { name: 'Sirope de vainilla', code: 'VANI', priceMinor: 60_000, isMultiple: false },
      { name: 'Canela', code: 'CANELA', priceMinor: 30_000, isMultiple: false },
      { name: 'Crema de leche', code: 'CREMA', priceMinor: 70_000, isMultiple: false },
    ],
    recipe: [
      { ingredient: 'Grano de café 100 %', quantity: 0.018 },
      { ingredient: 'Leche entera UHT', quantity: 0.25 },
      { ingredient: 'Azúcar', quantity: 0.008 },
    ],
  },
  {
    sku: 'CAF-CAP-01',
    name: 'Cappuccino',
    categorySlug: 'cafes',
    shortDescription: 'Un tercio café, un tercio leche y un tercio espuma, bien espumada.',
    description:
      'El clásico italiano con espuma densa y polvo de cacao opcional. Más corto y con más espuma que un latte, ' +
      'y con la misma leche texturizada.',
    basePriceMinor: 500_000,
    isFeatured: false,
    preparationMinutes: 5,
    trackStock: false,
    variants: [
      { name: SIZES.small, code: 'S', priceDeltaMinor: -90_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceDeltaMinor: 0, isDefault: true },
      { name: SIZES.large, code: 'L', priceDeltaMinor: 120_000, isDefault: false },
    ],
    addons: [
      { name: 'Leche de avena', code: 'AVENA', priceMinor: 90_000, isMultiple: false },
      { name: 'Extra shot', code: 'SHOT', priceMinor: 120_000, isMultiple: true, maxSelect: 2 },
      { name: 'Sirope de vainilla', code: 'VANI', priceMinor: 60_000, isMultiple: false },
      { name: 'Canela', code: 'CANELA', priceMinor: 30_000, isMultiple: false },
    ],
    recipe: [
      { ingredient: 'Grano de café 100 %', quantity: 0.018 },
      { ingredient: 'Leche entera UHT', quantity: 0.15 },
      { ingredient: 'Azúcar', quantity: 0.006 },
    ],
  },
  {
    sku: 'CAF-MOC-01',
    name: 'Mocha',
    categorySlug: 'cafes',
    shortDescription: 'Espresso, chocolate de origen y leche. El postre líquido de la casa.',
    description:
      'Cacao andino 70 % disuelto con leche y un doble shot de nuestro blend. Es el café más pedido ' +
      'los días de lluvia, y por eso tiene precio promocional durante la segunda quincena del mes.',
    basePriceMinor: 700_000,
    promo: { priceMinor: 550_000, startsDaysAgo: 7, endsInDays: 23 },
    isFeatured: false,
    preparationMinutes: 6,
    trackStock: false,
    variants: [
      { name: SIZES.small, code: 'S', priceDeltaMinor: -130_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceDeltaMinor: 0, isDefault: true },
      { name: SIZES.large, code: 'L', priceDeltaMinor: 150_000, isDefault: false },
    ],
    addons: [
      { name: 'Leche de avena', code: 'AVENA', priceMinor: 90_000, isMultiple: false },
      { name: 'Leche de almendra', code: 'ALMEN', priceMinor: 90_000, isMultiple: false },
      { name: 'Extra shot', code: 'SHOT', priceMinor: 120_000, isMultiple: true, maxSelect: 3 },
      { name: 'Sirope de vainilla', code: 'VANI', priceMinor: 60_000, isMultiple: false },
      { name: 'Crema de leche', code: 'CREMA', priceMinor: 70_000, isMultiple: false },
    ],
    recipe: [
      { ingredient: 'Grano de café 100 %', quantity: 0.018 },
      { ingredient: 'Leche entera UHT', quantity: 0.2 },
      { ingredient: 'Chocolate', quantity: 0.03 },
    ],
  },
  {
    sku: 'CAF-CBR-01',
    name: 'Cold Brew',
    categorySlug: 'cafes',
    shortDescription: 'Extracción en frío de 18 horas, baja acidez y mucho cuerpo.',
    description:
      'El mismo blend, infusionado en agua fría durante 18 horas y servido con hielo. Sale más dulce y con menos ' +
      'amargor que el espresso, y aguanta dos horas sin perder el sabor.',
    basePriceMinor: 800_000,
    isFeatured: false,
    preparationMinutes: 5,
    trackStock: false,
    // Tallas con precio ABSOLUTO: el cold brew no escala con un delta porque la
    // caffeine de la jarra es fija, así que la porción grande no es "un poco más".
    variants: [
      { name: SIZES.small, code: 'S', priceMinor: 750_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceMinor: 800_000, isDefault: true },
      { name: SIZES.large, code: 'L', priceMinor: 900_000, isDefault: false },
    ],
    addons: [
      { name: 'Leche de avena', code: 'AVENA', priceMinor: 90_000, isMultiple: false },
      { name: 'Sirope de vainilla', code: 'VANI', priceMinor: 60_000, isMultiple: false },
      { name: 'Hielo extra', code: 'HIELO', priceMinor: 20_000, isMultiple: true, maxSelect: 2 },
    ],
    recipe: [
      { ingredient: 'Grano de café 100 %', quantity: 0.03 },
      { ingredient: 'Azúcar', quantity: 0.01 },
    ],
  },
  {
    sku: 'CAF-COR-01',
    name: 'Cortado',
    categorySlug: 'cafes',
    shortDescription: 'Espresso cortado con un poco de leche en vaso de vidrio.',
    description:
      'La relación clásica del espresso bar: mismo volumen de café y de leche en un vaso de 180 ml. Intenso y ' +
      'sin azúcar de serie.',
    basePriceMinor: 450_000,
    isFeatured: false,
    preparationMinutes: 4,
    trackStock: false,
    recipe: [
      { ingredient: 'Grano de café 100 %', quantity: 0.018 },
      { ingredient: 'Leche entera UHT', quantity: 0.08 },
    ],
  },

  // --- Bebidas (4) ---------------------------------------------------------
  {
    sku: 'BEB-CHC-01',
    name: 'Chocolate caliente',
    categorySlug: 'bebidas',
    shortDescription: 'Cacao andino 70 % fundido con leche entera, sin polvo.',
    description:
      'Chocolate real, no sachet: tablet de cacao andino fundida con leche y terminada con un poco de ' +
      'mantequilla para el brillo. Sin azúcar añadido, se endulza con panela si hace falta.',
    basePriceMinor: 650_000,
    isFeatured: false,
    preparationMinutes: 6,
    trackStock: false,
    variants: [
      { name: SIZES.small, code: 'S', priceDeltaMinor: -110_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceDeltaMinor: 0, isDefault: true },
      { name: SIZES.large, code: 'L', priceDeltaMinor: 140_000, isDefault: false },
    ],
    addons: [
      { name: 'Crema de leche', code: 'CREMA', priceMinor: 70_000, isMultiple: false },
      { name: 'Canela', code: 'CANELA', priceMinor: 30_000, isMultiple: false },
      { name: 'Extra shot', code: 'SHOT', priceMinor: 120_000, isMultiple: true, maxSelect: 2 },
      { name: 'Sin azúcar', code: 'SINAZ', priceMinor: 0, isMultiple: false },
    ],
    recipe: [
      { ingredient: 'Leche entera UHT', quantity: 0.3 },
      { ingredient: 'Chocolate', quantity: 0.04 },
      { ingredient: 'Azúcar', quantity: 0.01 },
    ],
  },
  {
    sku: 'BEB-MAT-01',
    name: 'Matcha latte',
    categorySlug: 'bebidas',
    shortDescription: 'Matcha ceremonial batido en mano con leche, sin amargor.',
    description:
      'Matcha ceremonial de Uji batido a mano con un batidor de bambú: sin aglomerantes, sin sabor a verde ' +
      'plastificado y con el punto de dulzor del propio té. Se sirve con la espuma densa de la leche.',
    basePriceMinor: 900_000,
    isFeatured: true,
    preparationMinutes: 6,
    trackStock: false,
    variants: [
      { name: SIZES.small, code: 'S', priceDeltaMinor: -150_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceDeltaMinor: 0, isDefault: true },
      { name: SIZES.large, code: 'L', priceDeltaMinor: 180_000, isDefault: false },
    ],
    addons: [
      { name: 'Leche de avena', code: 'AVENA', priceMinor: 90_000, isMultiple: false },
      { name: 'Leche de almendra', code: 'ALMEN', priceMinor: 90_000, isMultiple: false },
      { name: 'Sirope de vainilla', code: 'VANI', priceMinor: 60_000, isMultiple: false },
      { name: 'Extra shot', code: 'SHOT', priceMinor: 120_000, isMultiple: true, maxSelect: 2 },
      { name: 'Sin azúcar', code: 'SINAZ', priceMinor: 0, isMultiple: false },
    ],
    recipe: [
      { ingredient: 'Leche entera UHT', quantity: 0.25 },
      { ingredient: 'Azúcar', quantity: 0.008 },
    ],
  },
  {
    sku: 'BEB-LIM-01',
    name: 'Limonada de menta',
    categorySlug: 'bebidas',
    shortDescription: 'Limón mandarino, menta fresca machacada y panela.',
    description:
      'Menta golpeada en el mortero con azúcar y servida con agua mineral y limón. Sin pulpa, sin jarabe ' +
      'comprado y con el hielo en la jarra para que no se aguade.',
    basePriceMinor: 700_000,
    isFeatured: false,
    preparationMinutes: 4,
    trackStock: true,
    variants: [
      { name: SIZES.small, code: 'S', priceDeltaMinor: -120_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceDeltaMinor: 0, isDefault: true },
      { name: SIZES.large, code: 'L', priceDeltaMinor: 150_000, isDefault: false },
    ],
    addons: [
      { name: 'Hielo extra', code: 'HIELO', priceMinor: 20_000, isMultiple: true, maxSelect: 2 },
      { name: 'Sin azúcar', code: 'SINAZ', priceMinor: 0, isMultiple: false },
      { name: 'Extra menta', code: 'MENTA', priceMinor: 40_000, isMultiple: false },
    ],
    recipe: [{ ingredient: 'Azúcar', quantity: 0.015 }],
  },
  {
    sku: 'BEB-JUG-01',
    name: 'Jugo de mango',
    categorySlug: 'bebidas',
    shortDescription: 'Mango de la Costa Chica, prensado en el momento y sin agua.',
    description:
      'Prensado al momento, sin agua ni azúcar añadida. Si el día está demasiado dulce se sirve con un ' +
      'chorrito de limón, nunca con panela.',
    basePriceMinor: 750_000,
    isFeatured: false,
    preparationMinutes: 5,
    trackStock: true,
    variants: [
      { name: SIZES.small, code: 'S', priceMinor: 650_000, isDefault: false },
      { name: SIZES.medium, code: 'M', priceMinor: 750_000, isDefault: true },
      { name: SIZES.large, code: 'L', priceMinor: 850_000, isDefault: false },
    ],
    addons: [
      { name: 'Sin azúcar', code: 'SINAZ', priceMinor: 0, isMultiple: false },
      { name: 'Hielo extra', code: 'HIELO', priceMinor: 20_000, isMultiple: true, maxSelect: 2 },
    ],
    recipe: [{ ingredient: 'Azúcar', quantity: 0.01 }],
  },

  // --- Comidas (4) ---------------------------------------------------------
  {
    sku: 'COM-CRS-01',
    name: 'Croissant de mantequilla',
    categorySlug: 'comidas',
    shortDescription: 'Hojaldre laminado con mantequilla de campo, horneado cada mañana.',
    description:
      'Masa laminada 27 veces con mantequilla de campo y 72 horas de maduración en cámara. Se hornea a las 6:30 ' +
      'de la mañana y a las 11:00, que es cuando se acaba.',
    basePriceMinor: 800_000,
    isFeatured: false,
    preparationMinutes: 5,
    trackStock: true,
    addons: [{ name: 'Extra mantequilla', code: 'MANT', priceMinor: 50_000, isMultiple: false }],
    recipe: [
      { ingredient: 'Harina', quantity: 0.07 },
      { ingredient: 'Mantequilla', quantity: 0.045 },
    ],
  },
  {
    sku: 'COM-SAN-01',
    name: 'Sándwich de pollo',
    categorySlug: 'comidas',
    shortDescription: 'Pollo desmechado al curry, aguacate y pan de masa madre.',
    description:
      'Pechuga cocida y desmechada con curry suave, aguacate, cebolla encurtida y pan de masa madre tostado. ' +
      'Se arma al momento: si lleva diez minutos esperando, el pan se lo cuenta.',
    basePriceMinor: 1_800_000,
    isFeatured: false,
    preparationMinutes: 10,
    trackStock: true,
    addons: [
      { name: 'Queso campesino', code: 'QUESO', priceMinor: 120_000, isMultiple: false },
      { name: 'Extra aguacate', code: 'AGUAC', priceMinor: 150_000, isMultiple: false },
    ],
    recipe: [
      { ingredient: 'Pechuga de pollo', quantity: 0.15 },
      { ingredient: 'Harina', quantity: 0.06 },
      { ingredient: 'Mantequilla', quantity: 0.02 },
    ],
  },
  {
    sku: 'COM-BAG-01',
    name: 'Bagel de salmón',
    categorySlug: 'comidas',
    shortDescription: 'Salmón ahumado, queso crema, alcaparras y cebolla morada.',
    description:
      'Bagel de Nueva York horneado cada mañana con salmón ahumado, queso crema, alcaparras, cebolla morada ' +
      'encurtida en vinagre de arroz y eneldo fresco.',
    basePriceMinor: 1_950_000,
    promo: { priceMinor: 1_650_000, startsDaysAgo: 7, endsInDays: 23 },
    isFeatured: false,
    preparationMinutes: 8,
    trackStock: true,
    recipe: [
      { ingredient: 'Salmón ahumado', quantity: 0.06 },
      { ingredient: 'Mantequilla', quantity: 0.015 },
      { ingredient: 'Harina', quantity: 0.11 },
    ],
  },
  {
    sku: 'COM-QUI-01',
    name: 'Quiche de vegetal',
    categorySlug: 'comidas',
    shortDescription: 'Verduras de temporada, huevo y queso gratinado.',
    description:
      'Base de masa quebrada rellena de cebolla, pimiento, calabacín, chalote y huevo, gratinada hasta que ' +
      'dora. Se sirve templada con una ensalada de hojas.',
    basePriceMinor: 1_600_000,
    isFeatured: false,
    preparationMinutes: 12,
    trackStock: true,
    recipe: [
      { ingredient: 'Harina', quantity: 0.09 },
      { ingredient: 'Mantequilla', quantity: 0.04 },
      { ingredient: 'Leche entera UHT', quantity: 0.15 },
    ],
  },

  // --- Postres (4) ---------------------------------------------------------
  {
    sku: 'POS-CHE-01',
    name: 'Cheesecake de maracuyá',
    categorySlug: 'postres',
    shortDescription: 'Base de galleta, queso crema y coulis de maracuyá.',
    description:
      'Cheesecake de Nueva York horneado al baño maría, reposado 12 horas y coronado con coulis de maracuyá ' +
      'y semillas de maracuyá. Es el más pedido con el café cortado.',
    basePriceMinor: 1_200_000,
    isFeatured: false,
    preparationMinutes: 5,
    trackStock: true,
    recipe: [
      { ingredient: 'Mantequilla', quantity: 0.03 },
      { ingredient: 'Azúcar', quantity: 0.05 },
      { ingredient: 'Harina', quantity: 0.02 },
    ],
  },
  {
    sku: 'POS-TIR-01',
    name: 'Tiramisú',
    categorySlug: 'postres',
    shortDescription: 'Bizcocho empapado en café, chantilly y cacao al momento.',
    description:
      'Bizcocho casero empapado en nuestro espresso de hoy, queso mascarpone batido y cacao en ' +
      'polvo al servir. Se guarda un día en cámara y al día siguiente está mejor.',
    basePriceMinor: 1_400_000,
    isFeatured: true,
    preparationMinutes: 5,
    trackStock: true,
    recipe: [
      { ingredient: 'Leche entera UHT', quantity: 0.2 },
      { ingredient: 'Azúcar', quantity: 0.045 },
      { ingredient: 'Chocolate', quantity: 0.025 },
    ],
  },
  {
    sku: 'POS-BRW-01',
    name: 'Brownie con helado',
    categorySlug: 'postres',
    shortDescription: 'Brownie de chocolate 60 %, helado de vainilla y sal marina.',
    description:
      'Brownie de chocolate 60 % con centro fundido, una bola de helado de vainilla de la casa y una pizca de ' +
      'sal marina por encima. Se sirve templado.',
    basePriceMinor: 1_100_000,
    isFeatured: false,
    preparationMinutes: 6,
    trackStock: true,
    recipe: [
      { ingredient: 'Chocolate', quantity: 0.045 },
      { ingredient: 'Mantequilla', quantity: 0.035 },
      { ingredient: 'Harina', quantity: 0.02 },
    ],
  },
  {
    sku: 'POS-COO-01',
    name: 'Cookie de chocolate',
    categorySlug: 'postres',
    shortDescription: 'Cookie con pepitas de chocolate 55 %, horneada dos veces al día.',
    description:
      'Masa que reposa dos días en cámara, con pepitas de chocolate 55 %, para conseguir el borde crujiente y el ' +
      'centro blando. La horneamos dos veces al día: 9:00 y 16:00.',
    basePriceMinor: 600_000,
    isFeatured: false,
    preparationMinutes: 4,
    trackStock: true,
    recipe: [
      { ingredient: 'Harina', quantity: 0.055 },
      { ingredient: 'Mantequilla', quantity: 0.03 },
      { ingredient: 'Chocolate', quantity: 0.03 },
    ],
  },

  // --- Snacks (3) ----------------------------------------------------------
  {
    sku: 'SNA-PAP-01',
    name: 'Papas fritas',
    categorySlug: 'snacks',
    shortDescription: 'Papa criolla en corte fino con sal de mar.',
    description:
      'Papa criolla en bastones finos, doble fritura en aceite de girasol y sal de mar al salir. Viene con ' +
      'alioli suave o kétchup, a elección.',
    basePriceMinor: 700_000,
    isFeatured: false,
    preparationMinutes: 8,
    trackStock: true,
    addons: [
      { name: 'Alioli', code: 'ALIOLI', priceMinor: 60_000, isMultiple: false },
      { name: 'Ketchup', code: 'KETCHUP', priceMinor: 40_000, isMultiple: false },
      { name: 'Queso fundido', code: 'QSO', priceMinor: 120_000, isMultiple: false },
    ],
    recipe: [{ ingredient: 'Mantequilla', quantity: 0.01 }],
  },
  {
    sku: 'SNA-MIX-01',
    name: 'Mix de frutos secos',
    categorySlug: 'snacks',
    shortDescription: 'Almendra, nuez, avellana y marañón, salados y tostados.',
    description:
      'Mezcla de almendra, nuez, avellana y marañón, tostados al momento y salados con un poco de sal de ' +
      'mar. Sin aceite añadido ni cacahuete.',
    basePriceMinor: 900_000,
    isFeatured: false,
    preparationMinutes: 3,
    trackStock: true,
    recipe: [
      { ingredient: 'Frutos secos', quantity: 0.08 },
      { ingredient: 'Azúcar', quantity: 0.005 },
    ],
  },
  {
    sku: 'SNA-GAL-01',
    name: 'Galletas de avena',
    categorySlug: 'snacks',
    shortDescription: 'Avena, pasas y canela en la versión suave de la receta.',
    description:
      'La receta de la abuela, en versión suave: avena, pasas, canela y un poco de azúcar moreno. Se hacen ' +
      'en bandeja el martes y el viernes.',
    basePriceMinor: 650_000,
    isFeatured: false,
    preparationMinutes: 5,
    trackStock: true,
    recipe: [
      { ingredient: 'Harina', quantity: 0.06 },
      { ingredient: 'Mantequilla', quantity: 0.025 },
      { ingredient: 'Azúcar', quantity: 0.03 },
    ],
  },

  // --- Especiales (2) ------------------------------------------------------
  {
    sku: 'ESP-COM-01',
    name: 'Combo desayuno',
    categorySlug: 'especiales',
    shortDescription: 'Huevos, croissant, café y jugo. La mañana completa.',
    description:
      'Dos huevos al plato, croissant de mantequilla, café americano de 350 ml y jugo de naranja de 12 oz. ' +
      'Se sirve sólo antes de las 11:00, y con el café se puede cambiar por chocolate caliente.',
    basePriceMinor: 2_200_000,
    promo: { priceMinor: 1_950_000, startsDaysAgo: 7, endsInDays: 23 },
    isFeatured: true,
    preparationMinutes: 12,
    trackStock: false,
    addons: [
      { name: 'Cambiar café por chocolate', code: 'CHOC', priceMinor: 0, isMultiple: false },
      { name: 'Huevo extra', code: 'HUEVO', priceMinor: 150_000, isMultiple: true, maxSelect: 2 },
      { name: 'Jumbo de jugo', code: 'JGO', priceMinor: 100_000, isMultiple: false },
    ],
    recipe: [
      { ingredient: 'Grano de café 100 %', quantity: 0.018 },
      { ingredient: 'Leche entera UHT', quantity: 0.25 },
      { ingredient: 'Harina', quantity: 0.07 },
      { ingredient: 'Mantequilla', quantity: 0.045 },
    ],
  },
  {
    sku: 'ESP-BOW-01',
    name: 'Bowl de açaí',
    categorySlug: 'especiales',
    shortDescription: 'Açaí, banano, fresa, granola y leche de la casa.',
    description:
      'Açaí puro batido con plátano y toppings a elegir entre fresa, mango, granola, coco y ' +
      'frutos secos. Se sirve en cuenco frío, con la leche aparte.',
    basePriceMinor: 1_900_000,
    promo: { priceMinor: 1_500_000, startsDaysAgo: 7, endsInDays: 23 },
    isFeatured: false,
    preparationMinutes: 7,
    trackStock: true,
    addons: [
      { name: 'Extra toppings', code: 'TOP', priceMinor: 180_000, isMultiple: true, maxSelect: 3 },
      { name: 'Leche de avena', code: 'AVENA', priceMinor: 90_000, isMultiple: false },
      { name: 'Con miel', code: 'MIEL', priceMinor: 50_000, isMultiple: false },
    ],
    recipe: [
      { ingredient: 'Frutos secos', quantity: 0.04 },
      { ingredient: 'Leche entera UHT', quantity: 0.1 },
      { ingredient: 'Azúcar', quantity: 0.01 },
    ],
  },
]);

// ===========================================================================
// 10 INGREDIENTES
// ===========================================================================

/**
 * Los diez insumos de la carta.
 *
 * NOTA SOBRE LOS NOMBRES: `Grano de café` y `Leche entera` llegan con su
 * matiz (`100 %` y `UHT`) a propósito. `ingredients(business_id, name)` es
 * UNIQUE, y los tests de catálogo crean un insumo llamado exactamente
 * `Grano de café` y otro llamado `Leche entera` esperando un 201: sembrar los
 * nombres exactos los haría fallar con un 409. Los nombres de la demo son, por
 * tanto, los de verdad de una ficha de inventario, que nunca son tan vagos.
 */
const INGREDIENTS: readonly {
  readonly name: string;
  readonly unit: InventoryUnitValue;
  readonly costMinor: number;
  readonly supplier: string;
}[] = Object.freeze([
  { name: 'Grano de café 100 %', unit: InventoryUnit.KG, costMinor: 38_000, supplier: 'Café de la Sierra' },
  { name: 'Leche entera UHT', unit: InventoryUnit.L, costMinor: 4_200, supplier: 'Lácteos La Pradera' },
  { name: 'Leche de avena', unit: InventoryUnit.L, costMinor: 7_800, supplier: 'Lácteos La Pradera' },
  { name: 'Azúcar', unit: InventoryUnit.KG, costMinor: 3_600, supplier: 'Distribuidora El Pan' },
  { name: 'Chocolate', unit: InventoryUnit.KG, costMinor: 22_000, supplier: 'Cacao Andino' },
  { name: 'Mantequilla', unit: InventoryUnit.KG, costMinor: 18_500, supplier: 'Lácteos La Pradera' },
  { name: 'Harina', unit: InventoryUnit.KG, costMinor: 3_200, supplier: 'Distribuidora El Pan' },
  { name: 'Pechuga de pollo', unit: InventoryUnit.KG, costMinor: 21_000, supplier: 'Carnes del Sur' },
  { name: 'Salmón ahumado', unit: InventoryUnit.KG, costMinor: 95_000, supplier: 'Pescados del Atlántico' },
  { name: 'Frutos secos', unit: InventoryUnit.KG, costMinor: 42_000, supplier: 'Frutos del Valle' },
]);

// ===========================================================================
// INVENTARIO: 7 productos + 5 insumos
// ===========================================================================
/**
 * El saldo de cada ítem es la SUMA de los movimientos declarados aquí, y las
 * semillas de pedidos (`operations-demo`) descuentan lo que venden con movimientos
 * `RESERVATION`/`RELEASE`, igual que haría la API. Dos ítems quedan por debajo de
 * su mínimo a propósito:
 *   - `POS-TIR-01` (Tiramisú): se hornearon 6, se vendió 1 y quedan 5 con un
 *     mínimo de 10 -> alerta `LOW` y "hay que hornear".
 *   - `ING-AVENA-01` (Leche de avena): 1.5 L con un mínimo de 8 -> aviso de
 *     reposición, que es justo lo que el gerente tiene que ver en el panel para
 *     que la demo enseñe algo.
 */
const INVENTORY: readonly DemoInventoryItem[] = Object.freeze([
  // --- Productos horneados y preparados (UND) ------------------------------
  {
    kind: 'product',
    key: 'COM-CRS-01',
    name: 'Croissant de mantequilla',
    sku: 'INV-COM-CRS-01',
    unit: InventoryUnit.UND,
    minStock: 20,
    maxStock: 60,
    costMinor: 260_000,
    supplier: 'Panadería propia',
    locationStorage: 'Estante 1 — vitrina de sombra',
    isTracked: true,
    movements: [
      { type: MovementType.PURCHASE, quantity: 48, reason: 'Horneada de la quincena', daysAgo: 36 },
      { type: MovementType.WASTE, quantity: -4, reason: 'Sobró de la tanda anterior y se secó', daysAgo: 33 },
    ],
  },
  {
    kind: 'product',
    key: 'COM-SAN-01',
    name: 'Sándwich de pollo',
    sku: 'INV-COM-SAN-01',
    unit: InventoryUnit.UND,
    minStock: 15,
    maxStock: 40,
    costMinor: 520_000,
    supplier: 'Cocina propia',
    locationStorage: 'Cámara 2 — refrigerada',
    isTracked: true,
    movements: [
      { type: MovementType.PURCHASE, quantity: 30, reason: 'Producción de la quincena', daysAgo: 36 },
      { type: MovementType.WASTE, quantity: -2, reason: 'Se cayó una bandeja al armar el comedor', daysAgo: 32 },
    ],
  },
  {
    kind: 'product',
    key: 'COM-BAG-01',
    name: 'Bagel de salmón',
    sku: 'INV-COM-BAG-01',
    unit: InventoryUnit.UND,
    minStock: 12,
    maxStock: 36,
    costMinor: 610_000,
    supplier: 'Cocina propia',
    locationStorage: 'Cámara 2 — refrigerada',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 24, reason: 'Horneada de la quincena', daysAgo: 35 }],
  },
  {
    kind: 'product',
    key: 'COM-QUI-01',
    name: 'Quiche de vegetal',
    sku: 'INV-COM-QUI-01',
    unit: InventoryUnit.UND,
    minStock: 10,
    maxStock: 24,
    costMinor: 430_000,
    supplier: 'Cocina propia',
    locationStorage: 'Cámara 2 — refrigerada',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 18, reason: 'Producción de la quincena', daysAgo: 34 }],
  },
  {
    kind: 'product',
    key: 'POS-CHE-01',
    name: 'Cheesecake de maracuyá',
    sku: 'INV-POS-CHE-01',
    unit: InventoryUnit.UND,
    minStock: 12,
    maxStock: 30,
    costMinor: 340_000,
    supplier: 'Repostería propia',
    locationStorage: 'Nevera 1 — vitrina de postres',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 22, reason: 'Horneada de la quincena', daysAgo: 34 }],
  },
  {
    // DELIBERADAMENTE POR DEBAJO DEL MÍNIMO (requisito del panel de inventario).
    kind: 'product',
    key: 'POS-TIR-01',
    name: 'Tiramisú',
    sku: 'INV-POS-TIR-01',
    unit: InventoryUnit.UND,
    minStock: 10,
    maxStock: 24,
    costMinor: 390_000,
    supplier: 'Repostería propia',
    locationStorage: 'Nevera 1 — vitrina de postres',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 6, reason: 'Última horneada de la quincena', daysAgo: 33 }],
  },
  {
    kind: 'product',
    key: 'ESP-BOW-01',
    name: 'Bowl de açaí',
    sku: 'INV-ESP-BOW-01',
    unit: InventoryUnit.UND,
    minStock: 10,
    maxStock: 28,
    costMinor: 480_000,
    supplier: 'Cocina propia',
    locationStorage: 'Cámara 2 — refrigerada',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 20, reason: 'Açaí recibido del proveedor', daysAgo: 32 }],
  },

  // --- Insumos -------------------------------------------------------------
  {
    kind: 'ingredient',
    key: 'Grano de café 100 %',
    name: 'Grano de café 100 %',
    sku: 'ING-CAFE-01',
    unit: InventoryUnit.KG,
    minStock: 5,
    maxStock: 20,
    costMinor: 38_000,
    supplier: 'Café de la Sierra',
    locationStorage: 'Bodega 1 — estante 3',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 12, reason: 'Tostado del mes', daysAgo: 40 }],
  },
  {
    kind: 'ingredient',
    key: 'Leche entera UHT',
    name: 'Leche entera UHT',
    sku: 'ING-LECHE-01',
    unit: InventoryUnit.L,
    minStock: 20,
    maxStock: 80,
    costMinor: 4_200,
    supplier: 'Lácteos La Pradera',
    locationStorage: 'Cámara 1 — estante 1',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 60, reason: 'Compra del mes', daysAgo: 38 }],
  },
  {
    // DELIBERADAMENTE POR DEBAJO DEL MÍNIMO (aviso de reposición del panel).
    kind: 'ingredient',
    key: 'Leche de avena',
    name: 'Leche de avena',
    sku: 'ING-AVENA-01',
    unit: InventoryUnit.L,
    minStock: 8,
    maxStock: 30,
    costMinor: 7_800,
    supplier: 'Lácteos La Pradera',
    locationStorage: 'Cámara 1 — estante 2',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 1.5, reason: 'Resto del pedido a Lácteos La Pradera', daysAgo: 37 }],
  },
  {
    kind: 'ingredient',
    key: 'Mantequilla',
    name: 'Mantequilla',
    sku: 'ING-MANT-01',
    unit: InventoryUnit.KG,
    minStock: 6,
    maxStock: 20,
    costMinor: 18_500,
    supplier: 'Lácteos La Pradera',
    locationStorage: 'Cámara 1 — estante 2',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 10, reason: 'Compra del mes', daysAgo: 38 }],
  },
  {
    kind: 'ingredient',
    key: 'Harina',
    name: 'Harina',
    sku: 'ING-HARINA-01',
    unit: InventoryUnit.KG,
    minStock: 10,
    maxStock: 40,
    costMinor: 3_200,
    supplier: 'Distribuidora El Pan',
    locationStorage: 'Bodega 1 — estante 1',
    isTracked: true,
    movements: [{ type: MovementType.PURCHASE, quantity: 25, reason: 'Compra del mes', daysAgo: 39 }],
  },
]);

// ===========================================================================
// Resultado
// ===========================================================================

/** Resumen de lo que hizo la semilla de catálogo. */
export interface CatalogDemoSeedResult {
  readonly businessId: number;
  readonly createdCategories: number;
  readonly createdProducts: number;
  readonly createdVariants: number;
  readonly createdAddons: number;
  readonly createdIngredients: number;
  readonly createdRecipes: number;
  readonly createdInventoryItems: number;
  readonly createdMovements: number;
  /** SKU -> id, para las semillas que dependen del catálogo. */
  readonly productIdsBySku: ReadonlyMap<string, number>;
  /** slug -> id de categoría. */
  readonly categoryIdsBySlug: ReadonlyMap<string, number>;
  readonly skipped: boolean;
}

/**
 * Siembra el catálogo de demostración. Idempotente.
 *
 * @param db Conexión a usar. Por defecto, la singleton del proceso. Se espera
 *           llamada dentro de la transacción que abre `seeds/index.ts`.
 */
export function seedCatalogDemo(db: Db): CatalogDemoSeedResult {
  const businessId = AUTH.DEFAULT_BUSINESS_ID;
  const now = nowIso();

  const categoryIdsBySlug = new Map<string, number>();
  let createdCategories = 0;
  CATEGORIES.forEach((category, index) => {
    const slug = slugify(category.name);
    const existing = db
      .prepare('SELECT id FROM categories WHERE business_id = ? AND slug = ?')
      .get(businessId, slug) as { id: number } | undefined;
    if (existing !== undefined) {
      categoryIdsBySlug.set(slug, existing.id);
      return;
    }
    const inserted = db
      .prepare(
        `INSERT INTO categories (business_id, name, slug, description, icon, sort_order, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(businessId, category.name, slug, category.description, category.icon, index + 1);
    categoryIdsBySlug.set(slug, Number(inserted.lastInsertRowid));
    createdCategories += 1;
  });

  // --- Ingredientes (antes que las recetas: son su FK) ---------------------
  const ingredientIdsByName = new Map<string, number>();
  let createdIngredients = 0;
  for (const ingredient of INGREDIENTS) {
    const existing = db
      .prepare('SELECT id FROM ingredients WHERE business_id = ? AND name = ?')
      .get(businessId, ingredient.name) as { id: number } | undefined;
    if (existing !== undefined) {
      ingredientIdsByName.set(ingredient.name, existing.id);
      continue;
    }
    const inserted = db
      .prepare(
        `INSERT INTO ingredients (business_id, name, unit, cost_minor, supplier, is_active)
         VALUES (?, ?, ?, ?, ?, 1)`,
      )
      .run(businessId, ingredient.name, ingredient.unit, ingredient.costMinor, ingredient.supplier);
    ingredientIdsByName.set(ingredient.name, Number(inserted.lastInsertRowid));
    createdIngredients += 1;
  }

  // --- Productos, variantes, complementos y recetas -----------------------
  const productIdsBySku = new Map<string, number>();
  let createdProducts = 0;
  let createdVariants = 0;
  let createdAddons = 0;
  let createdRecipes = 0;

  const insertVariant = db.prepare(
    `INSERT INTO product_variants (product_id, name, code, price_delta_minor, price_minor, is_default, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const insertAddon = db.prepare(
    `INSERT INTO product_addons (product_id, name, code, price_minor, is_multiple, max_select, sort_order, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const insertRecipe = db.prepare(
    'INSERT INTO product_ingredients (product_id, ingredient_id, quantity) VALUES (?, ?, ?)',
  );

  PRODUCTS.forEach((product, index) => {
    const categoryId = categoryIdsBySlug.get(product.categorySlug);
    if (categoryId === undefined) {
      throw new Error(`La categoría "${product.categorySlug}" no está sembrada: revisa CATEGORIES`);
    }
    const promoStartsAt = product.promo === undefined ? null : addDays(now, -product.promo.startsDaysAgo);
    const promoEndsAt = product.promo === undefined ? null : addDays(now, product.promo.endsInDays);

    const existing = db
      .prepare('SELECT id FROM products WHERE sku = ?')
      .get(product.sku) as { id: number } | undefined;

    if (existing === undefined) {
      const inserted = db
        .prepare(
          `INSERT INTO products (
             business_id, category_id, sku, name, slug, short_description, description,
             base_price_minor, promo_price_minor, promo_starts_at, promo_ends_at, tax_rate_bp,
             track_stock, is_featured, is_available, is_active, preparation_minutes, sort_order
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, 1, ?, ?)`,
        )
        .run(
          businessId,
          categoryId,
          product.sku,
          product.name,
          slugify(product.name),
          product.shortDescription,
          product.description,
          product.basePriceMinor,
          product.promo?.priceMinor ?? null,
          promoStartsAt,
          promoEndsAt,
          product.trackStock ? 1 : 0,
          product.isFeatured ? 1 : 0,
          product.preparationMinutes,
          index + 1,
        );
      productIdsBySku.set(product.sku, Number(inserted.lastInsertRowid));
      createdProducts += 1;
    } else {
      productIdsBySku.set(product.sku, existing.id);
    }
    const productId = productIdsBySku.get(product.sku) as number;

    (product.variants ?? []).forEach((variant, variantIndex) => {
      const found = db
        .prepare('SELECT id FROM product_variants WHERE product_id = ? AND name = ?')
        .get(productId, variant.name) as { id: number } | undefined;
      if (found !== undefined) {
        return;
      }
      insertVariant.run(
        productId,
        variant.name,
        variant.code,
        variant.priceDeltaMinor ?? 0,
        variant.priceMinor ?? null,
        variant.isDefault ? 1 : 0,
        variantIndex + 1,
      );
      createdVariants += 1;
    });

    (product.addons ?? []).forEach((addon, addonIndex) => {
      const found = db
        .prepare('SELECT id FROM product_addons WHERE product_id = ? AND name = ?')
        .get(productId, addon.name) as { id: number } | undefined;
      if (found !== undefined) {
        return;
      }
      insertAddon.run(
        productId,
        addon.name,
        addon.code,
        addon.priceMinor,
        addon.isMultiple ? 1 : 0,
        addon.maxSelect ?? null,
        addonIndex + 1,
      );
      createdAddons += 1;
    });

    (product.recipe ?? []).forEach((line) => {
      const ingredientId = ingredientIdsByName.get(line.ingredient);
      if (ingredientId === undefined) {
        throw new Error(
          `El insumo "${line.ingredient}" de la receta de ${product.sku} no está sembrado: revisa INGREDIENTS`,
        );
      }
      const found = db
        .prepare('SELECT id FROM product_ingredients WHERE product_id = ? AND ingredient_id = ?')
        .get(productId, ingredientId) as { id: number } | undefined;
      if (found !== undefined) {
        return;
      }
      insertRecipe.run(productId, ingredientId, line.quantity);
      createdRecipes += 1;
    });
  });

  // --- Inventario ----------------------------------------------------------
  const stock = new SqliteInventoryRepository();
  let createdInventoryItems = 0;
  let createdMovements = 0;

  for (const item of INVENTORY) {
    // `excludeId = null`: se busca cualquier ítem con ese SKU, no uno concreto.
    const existing = stock.findItemIdBySku(item.sku, businessId, null, db);
    if (existing !== null) {
      continue;
    }
    // El destino del ítem: exactamente uno de `product_id` / `ingredient_id`
    // (CHECK `ck_inventory_items_exclusive`).
    let productId: number | null = null;
    let ingredientId: number | null = null;
    if (item.kind === 'product') {
      const found = productIdsBySku.get(item.key);
      if (found === undefined) {
        throw new Error(`El ítem de inventario ${item.sku} apunta al producto ${item.key}, que no está sembrado`);
      }
      productId = found;
    } else {
      const found = ingredientIdsByName.get(item.key);
      if (found === undefined) {
        throw new Error(`El ítem de inventario ${item.sku} apunta al insumo ${item.key}, que no está sembrado`);
      }
      ingredientId = found;
    }

    // El saldo inicial es la suma del libro declarado, y se verifica al final.
    const balance = item.movements.reduce<number>((total, movement) => total + movement.quantity, 0);
    const inventoryItemId = stock.insertItem(
      {
        businessId,
        productId,
        ingredientId,
        name: item.name,
        sku: item.sku,
        unit: item.unit,
        currentStock: balance,
        minStock: item.minStock,
        maxStock: item.maxStock,
        costMinor: item.costMinor,
        supplier: item.supplier,
        locationStorage: item.locationStorage,
        isTracked: item.isTracked,
      },
      db,
    );
    createdInventoryItems += 1;

    let running = 0;
    for (const movement of item.movements) {
      running += movement.quantity;
      // SQL directo, y no `insertMovement` del repositorio, por UNA razón: el
      // repositorio no escribe `created_at` (para la API siempre es "ahora"), y
      // un histórico de inventario con las compras fechadas el día de la siembra
      // daría una recta plana en el gráfico de movimientos. La fecha se pone
      // explícita y siempre ANTES del primer pedido sembrado, para que el libro
      // sea monótono en el tiempo.
      db.prepare(
        `INSERT INTO inventory_movements (
           business_id, inventory_item_id, movement_type, quantity, balance_after,
           unit_cost_minor, reference_type, reference_id, reason, performed_by, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
      ).run(
        businessId,
        inventoryItemId,
        movement.type,
        movement.quantity,
        running,
        item.costMinor,
        movement.type === MovementType.PURCHASE ? 'PURCHASE' : 'MANUAL',
        movement.reason,
        addDays(now, -movement.daysAgo),
      );
      createdMovements += 1;
    }
  }

  assertLedgerConsistency(db, businessId, createdMovements);

  const skipped =
    createdCategories === 0 &&
    createdProducts === 0 &&
    createdVariants === 0 &&
    createdAddons === 0 &&
    createdIngredients === 0 &&
    createdRecipes === 0 &&
    createdInventoryItems === 0 &&
    createdMovements === 0;

  logger.info(
    {
      categories: createdCategories,
      products: createdProducts,
      variants: createdVariants,
      addons: createdAddons,
      ingredients: createdIngredients,
      recipes: createdRecipes,
      inventoryItems: createdInventoryItems,
      movements: createdMovements,
      skipped,
    },
    'semilla de catálogo aplicada',
  );

  return {
    businessId,
    createdCategories,
    createdProducts,
    createdVariants,
    createdAddons,
    createdIngredients,
    createdRecipes,
    createdInventoryItems,
    createdMovements,
    productIdsBySku,
    categoryIdsBySlug,
    skipped,
  };
}

/**
 * El último `balance_after` de cada ítem debe ser su `current_stock`.
 *
 * Es la invariante que hace que el historial de inventario signifique algo: un
 * saldo que no se puede reconstruir desde los movimientos es un número inventado.
 * Se comprueba al sembrar para que un error de cálculo en el libro de la demo
 * falle aquí y no tres meses después en un reporte.
 */
export function assertLedgerConsistency(db: Db, businessId: number, movedItems: number): void {
  const broken = db
    .prepare(
      `SELECT ii.sku, ii.current_stock, last.balance_after
         FROM inventory_items ii
         LEFT JOIN (
           SELECT m.inventory_item_id, m.balance_after
             FROM inventory_movements m
             JOIN (SELECT inventory_item_id, MAX(id) AS last_id
                     FROM inventory_movements
                    GROUP BY inventory_item_id) tail
               ON tail.last_id = m.id
         ) last ON last.inventory_item_id = ii.id
        WHERE ii.business_id = ?
          AND ii.deleted_at IS NULL
          AND last.inventory_item_id IS NOT NULL
          AND ii.current_stock <> last.balance_after`,
    )
    .all(businessId) as { sku: string; current_stock: number; balance_after: number }[];

  if (broken.length > 0) {
    const detail = broken.map((row) => `${row.sku}: saldo ${String(row.current_stock)} vs libro ${String(row.balance_after)}`);
    throw new Error(
      `El libro de inventario de demostración no cuadra con los saldos (${detail.join('; ')}). ` +
        'Revisa las cantidades de INVENTORY y de los pedidos sembrados.',
    );
  }
  if (movedItems === 0) {
    logger.debug('inventario: no se escribieron movimientos en esta ejecución');
  }
}
