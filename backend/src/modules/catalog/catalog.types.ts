/**
 * DTOs de dominio del módulo `catalog` (categorías, productos, variantes,
 * complementos e ingredientes).
 *
 * Son tipos PUROS: no importan `express`, `zod` ni el driver de base de datos
 * (DESIGN.md 3.3, P2). Los esquemas de validación viven en
 * `catalog.schemas.ts` y los controllers traducen `req` -> estos tipos.
 *
 * REGLA DE ORO: todo campo `*Minor` es un entero en centavos (BR-MONEY-001) y
 * toda cantidad de stock es un `number` que puede ser fraccional (BR-MONEY-001
 * sólo prohíbe `REAL` para importes, no para cantidades).
 */

/** Columnas ordenables de `GET /api/v1/categories`. */
export type CategorySortColumn = 'sort_order' | 'name' | 'created_at';

/** Orden ya validado por el middleware `validate`. */
export interface CategorySort {
  readonly column: CategorySortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** Categoría tal y como la ve el cliente (API.md 6.3, recurso `Category`). */
export interface CategoryView {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly icon: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
  /** Productos no borrados lógicamente, de cualquier estado. */
  readonly productCount: number;
  /** Productos no borrados lógicamente y activos. */
  readonly activeProductCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `GET /categories/:id`: la categoría con sus productos activos. */
export interface CategoryDetailView extends CategoryView {
  readonly products: readonly ProductBasicView[];
}

/** Referencia mínima a una categoría, embebida en el producto. */
export interface CategoryRef {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
}

/** Resultado de un soft delete de categoría. */
export interface CategoryDeleteResult {
  readonly id: number;
  readonly deletedAt: string;
  /** Productos que quedaron sin categoría al borrarla. */
  readonly orphanedProducts: number;
}

/** Fila de `categories` tal y como sale de la base de datos. */
export interface CategoryRow {
  readonly id: number;
  readonly business_id: number;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly image_url: string | null;
  readonly icon: string | null;
  readonly sort_order: number;
  readonly is_active: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Fila de `categories` con los conteos de producto resueltos. */
export interface CategoryCountedRow extends CategoryRow {
  readonly product_count: number;
  readonly active_product_count: number;
}

// --------------------------------------------------------------------------
// Productos
// --------------------------------------------------------------------------

/** Columnas ordenables de `GET /api/v1/products`. */
export type ProductSortColumn =
  | 'sort_order'
  | 'name'
  | 'base_price_minor'
  | 'created_at'
  | 'preparation_minutes';

/** Orden ya validado por el middleware `validate`. */
export interface ProductSort {
  readonly column: ProductSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** `ProductBasic` de API.md 6.3: el subconjunto de `?fields=basic`. */
export interface ProductBasicView {
  readonly id: number;
  readonly sku: string;
  readonly name: string;
  readonly imageUrl: string | null;
  readonly basePriceMinor: number;
  readonly promoPriceMinor: number | null;
  readonly isAvailable: boolean;
  readonly isFeatured: boolean;
  readonly preparationMinutes: number;
  readonly categoryId: number | null;
}

/** Fila de `products` con las columnas crudas de la tabla, sin mapear. */
export interface ProductRow {
  readonly id: number;
  readonly business_id: number;
  readonly category_id: number | null;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly short_description: string | null;
  readonly description: string | null;
  readonly image_url: string | null;
  readonly base_price_minor: number;
  readonly promo_price_minor: number | null;
  readonly promo_starts_at: string | null;
  readonly promo_ends_at: string | null;
  readonly tax_rate_bp: number | null;
  readonly track_stock: 0 | 1;
  readonly is_featured: 0 | 1;
  readonly is_available: 0 | 1;
  readonly is_active: 0 | 1;
  readonly preparation_minutes: number;
  readonly sort_order: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly deleted_at: string | null;
}

/** Datos de entrada de `resolveUnitPrice` (BR-PRICE-001). */
export interface PricedProduct {
  readonly basePriceMinor: number;
  readonly promoPriceMinor: number | null;
  readonly promoStartsAt: string | null;
  readonly promoEndsAt: string | null;
}

/** Datos de entrada de `resolveUnitPrice` para una variante. */
export interface PricedVariant {
  readonly priceDeltaMinor: number;
  readonly priceMinor: number | null;
}

/** `stock` de un producto: proyección de `inventory_items` (API.md 6.3). */
export interface ProductStockView {
  readonly currentStock: number;
  readonly minStock: number;
  readonly maxStock: number;
  readonly isTracked: boolean;
  readonly isLowStock: boolean;
}

/** Variante de producto (API.md 7.11). */
export interface ProductVariantView {
  readonly id: number;
  readonly productId: number;
  readonly name: string;
  readonly code: string | null;
  readonly priceDeltaMinor: number;
  readonly priceMinor: number | null;
  /** Precio ya resuelto con BR-PRICE-001, para que el cliente no lo calcule. */
  readonly effectivePriceMinor: number;
  readonly isDefault: boolean;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Fila cruda de `product_variants`. */
export interface ProductVariantRow {
  readonly id: number;
  readonly product_id: number;
  readonly name: string;
  readonly code: string | null;
  readonly price_delta_minor: number;
  readonly price_minor: number | null;
  readonly is_default: 0 | 1;
  readonly sort_order: number;
  readonly is_active: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Complemento de producto (API.md 7.11). */
export interface ProductAddonView {
  readonly id: number;
  readonly productId: number;
  readonly name: string;
  readonly code: string | null;
  readonly priceMinor: number;
  readonly isMultiple: boolean;
  readonly maxSelect: number | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/** Fila cruda de `product_addons`. */
export interface ProductAddonRow {
  readonly id: number;
  readonly product_id: number;
  readonly name: string;
  readonly code: string | null;
  readonly price_minor: number;
  readonly is_multiple: 0 | 1;
  readonly max_select: number | null;
  readonly sort_order: number;
  readonly is_active: 0 | 1;
}

/** Línea de la receta de un producto (API.md 7.11). */
export interface ProductIngredientView {
  readonly id: number;
  readonly productId: number;
  readonly ingredientId: number;
  readonly ingredientName: string;
  readonly unit: string;
  readonly quantity: number;
  readonly costMinor: number;
  /** Costo de UNA unidad del producto según la receta. */
  readonly lineCostMinor: number;
  readonly stock: { readonly currentStock: number; readonly isLowStock: boolean } | null;
}

/** Fila de `product_ingredients` unida a `ingredients` e `inventory_items`. */
export interface ProductIngredientRow {
  readonly id: number;
  readonly product_id: number;
  readonly ingredient_id: number;
  readonly quantity: number;
  readonly ingredient_name: string;
  readonly unit: string;
  readonly cost_minor: number;
  readonly current_stock: number | null;
  readonly is_tracked: number | null;
}

/** Producto completo del catálogo (API.md 6.3, recurso `Product`). */
export interface ProductView {
  readonly id: number;
  readonly categoryId: number | null;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly shortDescription: string | null;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly basePriceMinor: number;
  readonly promoPriceMinor: number | null;
  readonly promoStartsAt: string | null;
  readonly promoEndsAt: string | null;
  readonly taxRateBp: number | null;
  readonly trackStock: boolean;
  readonly isFeatured: boolean;
  readonly isAvailable: boolean;
  readonly isActive: boolean;
  readonly preparationMinutes: number;
  readonly sortOrder: number;
  readonly category: CategoryRef | null;
  readonly variants: readonly ProductVariantView[];
  readonly addons: readonly ProductAddonView[];
  readonly stock: ProductStockView | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `GET /products/:id`: el producto con su receta. */
export interface ProductDetailView extends ProductView {
  readonly ingredients: readonly ProductIngredientView[];
  /**
   * Historial de precios. La tabla no existe en el esquema congelado
   * (`0001_init.sql`): siempre vacío hasta que exista una migración que la
   * añada. Se devuelve como `[]` porque el contrato lo declara.
   */
  readonly priceHistory: readonly PriceHistoryEntry[];
}

/** Entrada del historial de precios. Hoy siempre inexistente (ver arriba). */
export interface PriceHistoryEntry {
  readonly priceMinor: number;
  readonly changedAt: string;
}

/** Conteo de productos por categoría para `meta.categories` (API.md 7.11). */
export interface CategoryProductCount {
  readonly id: number;
  readonly name: string;
  readonly count: number;
}

/** Resultado de un soft delete de producto. */
export interface ProductDeleteResult {
  readonly id: number;
  readonly deletedAt: string;
  /** Líneas de pedido que quedan apuntando a un producto borrado. */
  readonly affectedOrderItems: number;
}

// --------------------------------------------------------------------------
// Ingredientes
// --------------------------------------------------------------------------

/** Ingrediente del catálogo (tabla `ingredients`). */
export interface IngredientView {
  readonly id: number;
  readonly name: string;
  readonly unit: string;
  readonly costMinor: number;
  readonly supplier: string | null;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Columnas ordenables del catálogo de insumos. */
export type IngredientSortColumn = 'name' | 'created_at' | 'cost_minor';

/** Orden del catálogo de insumos, ya validado. */
export interface IngredientSort {
  readonly column: IngredientSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** Fila cruda de `ingredients`. */
export interface IngredientRow {
  readonly id: number;
  readonly business_id: number;
  readonly name: string;
  readonly unit: string;
  readonly cost_minor: number;
  readonly supplier: string | null;
  readonly is_active: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Resultado de quitar un insumo de la receta. */
export interface RecipeRemoveResult {
  readonly id: number;
  readonly productId: number;
  readonly ingredientId: number;
  readonly removedAt: string;
}

// --------------------------------------------------------------------------
// Menú público
// --------------------------------------------------------------------------

/** Variante en el menú, con el precio ya resuelto. */
export interface MenuVariantView {
  readonly id: number;
  readonly name: string;
  readonly code: string | null;
  readonly unitPriceMinor: number;
  readonly isDefault: boolean;
}

/** Complemento en el menú. */
export interface MenuAddonView {
  readonly id: number;
  readonly name: string;
  readonly priceMinor: number;
  readonly isMultiple: boolean;
  readonly maxSelect: number | null;
}

/** Producto del menú público. Nunca lleva datos de gestión. */
export interface MenuProductView {
  readonly id: number;
  readonly sku: string;
  readonly name: string;
  readonly shortDescription: string | null;
  readonly description: string | null;
  readonly imageUrl: string | null;
  /** Precio de la entrada del producto, ya resuelto con BR-PRICE-001. */
  readonly unitPriceMinor: number;
  /** Precio de la entrada por defecto, si el producto tiene variantes. */
  readonly defaultUnitPriceMinor: number | null;
  readonly basePriceMinor: number;
  readonly promoPriceMinor: number | null;
  readonly isFeatured: boolean;
  readonly preparationMinutes: number;
  readonly variants: readonly MenuVariantView[];
  readonly addons: readonly MenuAddonView[];
}

/** Categoría del menú público con sus productos. */
export interface MenuCategoryView {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly icon: string | null;
  readonly sortOrder: number;
  readonly products: readonly MenuProductView[];
}

/** `GET /menu/:productId`: un producto del menú con su categoría. */
export interface MenuProductDetailView extends MenuProductView {
  readonly category: CategoryRef | null;
}
