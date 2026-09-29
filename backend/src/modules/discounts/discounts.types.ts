/**
 * Tipos del módulo `discounts` (tablas `discounts` y `discount_redemptions`).
 *
 * Son tipos PUROS: no importan `express`, `zod` ni el driver de base de datos
 * (DESIGN.md 3.3, P2). Los esquemas viven en `discounts.schemas.ts` y los
 * controllers traducen `req` -> estos tipos.
 *
 * REGLA DE ORO: todo campo `*Minor` es un entero en centavos (BR-MONEY-001) y
 * el `value` de un `PERCENT` son BASIS POINTS, no porcentaje
 * (`2000` = 20 %, BR-DISC-007 y CHECK `ck_discounts_percent_bp`).
 */

/** Columnas ordenables de `GET /api/v1/discounts`. */
export type DiscountSortColumn = 'code' | 'name' | 'created_at' | 'used_count' | 'ends_at';

/** Orden ya validado por el middleware `validate`. */
export interface DiscountSort {
  readonly column: DiscountSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/**
 * Fila cruda de `discounts`, tal y como sale de SQLite.
 *
 * `is_active`, `stackable` y `used_count` viajan como enteros porque así los
 * tiene la tabla: el mapeo a booleano ocurre en el service, que es donde se
 * combinan con el resto de datos para decidir la validez.
 */
export interface DiscountRow {
  readonly id: number;
  readonly business_id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly value: number;
  readonly min_order_minor: number | null;
  readonly max_discount_minor: number | null;
  readonly applies_to: string;
  readonly applies_category_id: number | null;
  readonly applies_product_id: number | null;
  readonly usage_limit: number | null;
  readonly usage_limit_per_customer: number | null;
  readonly used_count: number;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  readonly is_active: 0 | 1;
  readonly stackable: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
  /** JOIN `users.full_name`: nombre de la categoría objetivo, si aplica. */
  readonly applies_category_name: string | null;
  /** JOIN `products.name`: nombre del producto objetivo, si aplica. */
  readonly applies_product_name: string | null;
}

/** Fila mínima de `discount_redemptions` (tabla inmutable). */
export interface DiscountRedemptionRow {
  readonly id: number;
  readonly discount_id: number;
  readonly order_id: number;
  readonly customer_id: number | null;
  readonly amount_minor: number;
  readonly created_at: string;
}

/** Descuento tal y como lo ve el cliente (API.md 6.3, recurso `Discount`). */
export interface DiscountView {
  readonly id: number;
  /** Normalizado a mayúsculas y sin espacios (BR-DISC-007). */
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  /** Basis points si `PERCENT`; centavos si `FIXED`. */
  readonly value: number;
  readonly minOrderMinor: number | null;
  readonly maxDiscountMinor: number | null;
  readonly appliesTo: string;
  readonly appliesCategoryId: number | null;
  readonly appliesProductId: number | null;
  readonly usageLimit: number | null;
  readonly usageLimitPerCustomer: number | null;
  readonly usedCount: number;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly isActive: boolean;
  readonly stackable: boolean;
  /**
   * `true` si el descuento se puede aplicar AHORA a cualquier pedido:
   * activo, no borrado, dentro de la ventana temporal y con usos disponibles
   * (BR-DISC-003 y BR-DISC-004).
   */
  readonly isCurrentlyValid: boolean;
  /** Usos que quedan, o `null` si el descuento es ilimitado. */
  readonly usageRemaining: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `GET /discounts/:id`: el descuento con su categoría, producto y estadísticas. */
export interface DiscountDetailView extends DiscountView {
  readonly business: { readonly id: number; readonly name: string };
  readonly category: { readonly id: number; readonly name: string } | null;
  readonly product: { readonly id: number; readonly name: string } | null;
  readonly stats: {
    readonly usedCount: number;
    readonly totalDiscountedMinor: number;
    readonly uniqueCustomers: number;
    readonly lastUsedAt: string | null;
  };
}

/** Página de descuentos. */
export interface DiscountPage {
  readonly items: readonly DiscountView[];
  readonly total: number;
}

/** Cupón del cliente autenticado (`GET /api/v1/discounts/mine`). */
export interface MyDiscountView {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: string;
  readonly value: number;
  readonly maxDiscountMinor: number | null;
  readonly appliesTo: string;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly isActive: boolean;
  /** `true` si el cliente puede canjearlo ahora mismo. */
  readonly isValid: boolean;
  /** Último canje del cliente, o `null` si nunca lo usó. */
  readonly usedAt: string | null;
  readonly usedCount: number;
}

/**
 * Resultado de la validación de un cupón (`POST /api/v1/discounts/validate`).
 *
 * IMPORTANTE (BR-DISC-001): este resultado es una PREVISUALIZACIÓN. Aunque
 * `isValid` sea `true` y `discountMinor` cuadre, `POST /orders` vuelve a
 * validar y a calcular el importe en el servidor. El importe devuelto aquí NO
 * es una promesa de cobro.
 */
export interface DiscountValidationView {
  readonly isValid: boolean;
  readonly code: string | null;
  readonly name: string | null;
  readonly type: string | null;
  readonly value: number | null;
  /**
   * Base sobre la que se calcula el descuento: el subtotal completo si
   * `appliesTo = ALL`, o la suma de las líneas afectadas si es
   * `CATEGORY`/`PRODUCT` (BR-DISC-002).
   */
  readonly applicableSubtotalMinor: number;
  /** Importe del descuento en centavos. Nunca mayor que la base aplicable. */
  readonly discountMinor: number;
  /** `true` si `max_discount_minor` recortó el importe calculado. */
  readonly cappedByMaxDiscount: boolean;
  /** Usos globales que quedan, o `null` si es ilimitado. */
  readonly remainingUses: number | null;
  /** `true` si el subtotal alcanza `min_order_minor` (BR-DISC-009). */
  readonly minOrderMet: boolean;
  /** Motivo de la invalidez, o `null` si el cupón es válido. */
  readonly reason: string | null;
  /** `details.code` estable del motivo, para que el cliente ramifique. */
  readonly reasonCode: string | null;
  /** Identificadores de `DESIGN.md` aplicados, para la traza. */
  readonly ruleIds: readonly string[];
}

/** Datos que el service necesita para validar un cupón. */
export interface DiscountValidationInput {
  readonly code: string;
  /** Subtotal que el cliente ya conoce (o el real, si se manda `orderId`). */
  readonly subtotalMinor: number;
  /** Cliente para validar `usage_limit_per_customer`. */
  readonly customerId: number | null;
  /**
   * Líneas del pedido, necesarias cuando `appliesTo != ALL`. Cada línea lleva
   * su categoría y su importe para poder resolver la base aplicable.
   */
  readonly lines: readonly DiscountValidationLine[];
}

/** Una línea de pedido para el cálculo del ámbito de un descuento. */
export interface DiscountValidationLine {
  readonly productId: number | null;
  readonly categoryId: number | null;
  readonly quantity: number;
  readonly lineTotalMinor: number;
}

/** Page de cupones del cliente. */
export interface MyDiscountPage {
  readonly items: readonly MyDiscountView[];
  readonly total: number;
}
