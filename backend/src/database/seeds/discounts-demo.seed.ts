/**
 * Semilla de demostración de DESCUENTOS: cuatro cupones con los cuatro estados
 * que un gerente necesita ver en el panel de promociones.
 *
 * ============================================================================
 * POR QUÉ EXISTE
 * ============================================================================
 * `GET /api/v1/discounts/mine` (la lista pública de promociones que ve el
 * cliente) está vacío en una base recién migrada, y la validación de cupones no
 * tiene con qué jugar. Además, los cuatro estados posibles de un cupón --vigente,
 * con tope, futuro y caducado-- sólo se ven si los cuatro existen.
 *
 * ============================================================================
 * LOS CUATRO CUPONES Y POR QUÉ CADA UNO
 * ============================================================================
 *  1. `BIENVENIDO20`  PERCENT 20 %, vigente AHORA. Con mínimo de pedido y con
 *     tope absoluto: es el cupón que se usa en dos pedidos de la demo, así que su
 *     `used_count` y sus redenciones tienen que cuadrar con ellos.
 *  2. `LUNESFIJO`     FIXED $2.000, vigente, con tope igual al valor y con límite
 *     de un uso por cliente. Es el caso del descuento que no se acumula con otro.
 *  3. `TODOCAFE15`    PERCENT 15 % limitado a la categoría de cafés: el único
 *     camino para ejercitar `applies_to = 'CATEGORY'` y su FK.
 *  4. `ANIVERSARIO25` PERCENT 25 % que AÚN NO EMPIEZA: el panel tiene que poder
 *     mostrar "programado" sin que el cliente pueda aplicarlo todavía.
 *  5. `VERANO2025`    FIXED $1.500 CADUCADO (la ventana terminó hace un mes) y
 *     con la promoción desactivada: es la fila que el gerente archiva, y la que
 *     demuestra que un cupón vencido no se aplica aunque siga en la tabla.
 *
 * ============================================================================
 * VENTANAS EN DÍAS RELATIVOS
 * ============================================================================
 * Las ventanas se calculan desde el instante de la siembra, no con fechas fijas:
 * un cupón "vigente" escrito con una fecha de 2025 lleva un mes vencido cuando
 * alguien clona el repositorio en 2026, y la demo deja de demostrar nada. Con
 * días relativos, la promo sigue vigente un mes después de sembrar.
 *
 * ============================================================================
 * IDEMPOTENCIA
 * ============================================================================
 * `discounts.code` es UNIQUE: se busca antes de insertar y una fila existente no
 * se toca (una promoción editada por la API no se pisa con `npm run seed`).
 * `used_count` NO se escribe aquí: lo calcula la semilla de operaciones a partir
 * de `discount_redemptions`, que es la fuente de verdad (BR-DISC-004).
 */
import { AUTH } from '../../config/index.js';
import type { Db } from '../../shared/database/connection.js';
import { logger } from '../../shared/logger/index.js';
import { DiscountAppliesTo, DiscountType } from '../../shared/domain/index.js';
import { addDays, nowIso } from '../../shared/utils/datetime.js';
import { scalarInt } from './demo-support.js';

/** Un cupón de demostración. Los importes van en centavos. */
interface DemoDiscount {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly type: DiscountType;
  /** PERCENT: basis points (1500 = 15 %). FIXED: centavos. */
  readonly value: number;
  readonly minOrderMinor: number | null;
  readonly maxDiscountMinor: number | null;
  readonly appliesTo: DiscountAppliesTo;
  /** Nombre de la categoría cuando `appliesTo = CATEGORY`. */
  readonly categoryName?: string;
  readonly usageLimit: number | null;
  readonly usageLimitPerCustomer: number | null;
  readonly startsDaysAgo: number | null;
  readonly endsInDays: number | null;
  readonly isActive: boolean;
  readonly stackable: boolean;
}

const DISCOUNTS: readonly DemoDiscount[] = Object.freeze([
  {
    code: 'BIENVENIDO20',
    name: 'Bienvenida 20 %',
    description: 'Veinte por ciento de descuento en tu primera visita, hasta $4.000.',
    type: DiscountType.PERCENT,
    value: 2_000,
    minOrderMinor: 300_000,
    maxDiscountMinor: 400_000,
    appliesTo: DiscountAppliesTo.ALL,
    usageLimit: 500,
    usageLimitPerCustomer: 1,
    startsDaysAgo: 30,
    endsInDays: 60,
    isActive: true,
    stackable: false,
  },
  {
    code: 'LUNESFIJO',
    name: 'Lunes de fijo',
    description: 'Descuento fijo de $2.000 en pedidos de $8.000 o más.',
    type: DiscountType.FIXED,
    value: 200_000,
    minOrderMinor: 800_000,
    // El tope coincide con el valor: un cupón fijo no puede "valer más" que sí mismo.
    maxDiscountMinor: 200_000,
    appliesTo: DiscountAppliesTo.ALL,
    usageLimit: 200,
    usageLimitPerCustomer: 1,
    startsDaysAgo: 30,
    endsInDays: 45,
    isActive: true,
    stackable: false,
  },
  {
    code: 'TODOCAFE15',
    name: 'Café de la casa 15 %',
    description: 'Quince por ciento de descuento en todo lo que sea café de la carta.',
    type: DiscountType.PERCENT,
    value: 1_500,
    minOrderMinor: null,
    maxDiscountMinor: 250_000,
    appliesTo: DiscountAppliesTo.CATEGORY,
    categoryName: 'Cafés',
    usageLimit: null,
    usageLimitPerCustomer: null,
    startsDaysAgo: 20,
    endsInDays: 40,
    isActive: true,
    stackable: false,
  },
  {
    code: 'ANIVERSARIO25',
    name: 'Aniversario 25 %',
    description: 'Promoción del aniversario: veinticinco por ciento durante toda la semana.',
    type: DiscountType.PERCENT,
    value: 2_500,
    minOrderMinor: 500_000,
    maxDiscountMinor: 500_000,
    appliesTo: DiscountAppliesTo.ALL,
    usageLimit: null,
    usageLimitPerCustomer: null,
    // Todavía no empieza: la fila existe y el panel la muestra como programada.
    startsDaysAgo: null,
    endsInDays: 45,
    isActive: true,
    stackable: false,
  },
  {
    code: 'VERANO2025',
    name: 'Promo de verano (caducada)',
    description: 'Campaña de la temporada pasada. Se conserva para el histórico de ventas.',
    type: DiscountType.FIXED,
    value: 150_000,
    minOrderMinor: 400_000,
    maxDiscountMinor: 150_000,
    appliesTo: DiscountAppliesTo.ALL,
    usageLimit: 100,
    usageLimitPerCustomer: null,
    startsDaysAgo: 120,
    // Terminó: `ends_at <= now` la hace inválida (BR-DISC-003).
    endsInDays: -30,
    isActive: false,
    stackable: false,
  },
]);

/** Resumen de lo que hizo la semilla de descuentos. */
export interface DiscountsDemoSeedResult {
  readonly businessId: number;
  readonly created: number;
  /** `código -> id` de los cupones sembrados o ya existentes. */
  readonly idsByCode: ReadonlyMap<string, number>;
  readonly skipped: boolean;
}

/**
 * Siembra los cupones de demostración. Idempotente.
 *
 * @param db Conexión dentro de la transacción que abre `seeds/index.ts`.
 */
export function seedDiscountsDemo(db: Db): DiscountsDemoSeedResult {
  const businessId = AUTH.DEFAULT_BUSINESS_ID;
  const now = nowIso();
  const idsByCode = new Map<string, number>();
  let created = 0;

  for (const discount of DISCOUNTS) {
    const existing = db
      .prepare('SELECT id FROM discounts WHERE code = ?')
      .get(discount.code) as { id: number } | undefined;
    if (existing !== undefined) {
      idsByCode.set(discount.code, existing.id);
      continue;
    }

    let categoryId: number | null = null;
    if (discount.appliesTo === DiscountAppliesTo.CATEGORY) {
      const name = discount.categoryName;
      if (name === undefined) {
        throw new Error(`El cupón ${discount.code} es de categoría y no declara cuál es`);
      }
      const found = scalarInt(
        db,
        'SELECT id FROM categories WHERE business_id = ? AND name = ?',
        businessId,
        name,
      );
      if (found === null) {
        throw new Error(
          `El cupón ${discount.code} necesita la categoría "${name}": ejecuta la semilla de catálogo antes que esta.`,
        );
      }
      categoryId = found;
    }

    const inserted = db
      .prepare(
        `INSERT INTO discounts (
           business_id, code, name, description, type, value,
           min_order_minor, max_discount_minor, applies_to, applies_category_id,
           usage_limit, usage_limit_per_customer, used_count, starts_at, ends_at,
           is_active, stackable
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(
        businessId,
        discount.code,
        discount.name,
        discount.description,
        discount.type,
        discount.value,
        discount.minOrderMinor,
        discount.maxDiscountMinor,
        discount.appliesTo,
        categoryId,
        discount.usageLimit,
        discount.usageLimitPerCustomer,
        discount.startsDaysAgo === null ? null : addDays(now, -discount.startsDaysAgo),
        discount.endsInDays === null ? null : addDays(now, discount.endsInDays),
        discount.isActive ? 1 : 0,
        discount.stackable ? 1 : 0,
      );

    idsByCode.set(discount.code, Number(inserted.lastInsertRowid));
    created += 1;
  }

  logger.info({ created, total: DISCOUNTS.length, skipped: created === 0 }, 'semilla de descuentos aplicada');

  return { businessId, created, idsByCode, skipped: created === 0 };
}
