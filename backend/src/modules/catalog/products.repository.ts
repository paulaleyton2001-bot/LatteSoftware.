/**
 * Contrato de persistencia de productos del módulo `catalog`.
 *
 * Cubre `products`, `product_variants`, `product_addons`, `ingredients` y
 * `product_ingredients`. Es una INTERFAZ: el service nunca ve SQLite
 * (DESIGN.md 3.1, P3). El SQL está en `products.repository.sqlite.ts`.
 *
 * NOTA DE DISEÑO SOBRE `inventory_items`:
 * `GET /products/:id` expone `stock`, que es una PROYECCIÓN de solo lectura de
 * la tabla del módulo de inventario (API.md 6.3 lo declara como campo del
 * recurso `Product`). Se lee aquí para que el catálogo no dependa del módulo de
 * inventario ni al revés, y porque el dato es de una sola fila por producto. TODA
 * escritura de stock (movimientos, ajustes) vive exclusivamente en el módulo
 * `inventory`: aquí no hay ni un solo `UPDATE` sobre `inventory_items`, salvo el
 * alta automática de un ítem al añadir un insumo a una receta, que exige la misma
 * fila y está described en `ensureInventoryItemForIngredient`.
 */
import type { Db } from '../../shared/database/connection.js';
import type {
  CategoryProductCount,
  IngredientRow,
  IngredientSort,
  IngredientSortColumn,
  ProductAddonRow,
  ProductIngredientRow,
  ProductRow,
  ProductSort,
  ProductSortColumn,
  ProductVariantRow,
} from './catalog.types.js';

export type { IngredientSort, IngredientSortColumn, ProductSort, ProductSortColumn };

/** Subconjunto de columnas de `ProductBasic` (API.md 7.11, `fields=basic`). */
export interface ProductBasicRow {
  readonly id: number;
  readonly sku: string;
  readonly name: string;
  readonly image_url: string | null;
  readonly base_price_minor: number;
  readonly promo_price_minor: number | null;
  readonly is_available: 0 | 1;
  readonly is_featured: 0 | 1;
  readonly preparation_minutes: number;
  readonly category_id: number | null;
}

/** Datos insertados en `products`. */
export interface NewProductRecord {
  readonly businessId: number;
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
  readonly preparationMinutes: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/**
 * Campos actualizables de `products`.
 *
 * `sku` NO está: es inmutable en v1 (API.md 7.11). `isAvailable` SÍ está, pero
 * sólo lo escribe `PATCH /products/:id/availability`, que es su único_ENDPOINT
 * con permiso: mezclar la disponibilidad comercial con el resto de la edición
 * fue justo lo que BR-PRICE-006 quiso evitar.
 */
export interface ProductPatch {
  readonly categoryId?: number | null;
  readonly name?: string;
  readonly slug?: string;
  readonly shortDescription?: string | null;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly basePriceMinor?: number;
  readonly promoPriceMinor?: number | null;
  readonly promoStartsAt?: string | null;
  readonly promoEndsAt?: string | null;
  readonly taxRateBp?: number | null;
  readonly trackStock?: boolean;
  readonly isFeatured?: boolean;
  readonly isAvailable?: boolean;
  readonly preparationMinutes?: number;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

/** Filtros de `GET /api/v1/products`. */
export interface ProductListFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: ProductSort;
  readonly categoryId?: number;
  /** `q`: busca en `name`, `sku` y `short_description` (API.md 5.3). */
  readonly q?: string;
  readonly featured?: boolean;
  readonly available?: boolean;
  readonly trackStock?: boolean;
  readonly isActive?: boolean;
  readonly includeInactive?: boolean;
  readonly minPrice?: number;
  readonly maxPrice?: number;
  /** Sólo productos con existencias disponibles en inventario. */
  readonly inStockOnly?: boolean;
}

/** Filtro del menú público: sólo productos publicables. */
export interface MenuProductFilter {
  readonly businessId: number;
  readonly categoryId?: number;
  readonly q?: string;
  readonly featured?: boolean;
  /** `true` para incluir los que están en la categoría pero inactivos. */
  readonly includeInactiveProducts: boolean;
}

/** Fila de producto del menú, con el nombre y el slug de su categoría. */
export interface MenuProductRow extends ProductRow {
  readonly category_name: string | null;
  readonly category_slug: string | null;
}

/** Fila de categoría activa del menú, con su orden de carta. */
export interface MenuCategoryRow {
  readonly id: number;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly image_url: string | null;
  readonly icon: string | null;
  readonly sort_order: number;
}

/** Datos insertados en `product_variants`. */
export interface NewVariantRecord {
  readonly productId: number;
  readonly name: string;
  readonly code: string | null;
  readonly priceDeltaMinor: number;
  readonly priceMinor: number | null;
  readonly isDefault: boolean;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/** Campos actualizables de `product_variants`. */
export interface VariantPatch {
  readonly name?: string;
  readonly code?: string | null;
  readonly priceDeltaMinor?: number;
  readonly priceMinor?: number | null;
  readonly isDefault?: boolean;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

/** Datos insertados en `product_addons`. */
export interface NewAddonRecord {
  readonly productId: number;
  readonly name: string;
  readonly code: string | null;
  readonly priceMinor: number;
  readonly isMultiple: boolean;
  readonly maxSelect: number | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/** Campos actualizables de `product_addons`. */
export interface AddonPatch {
  readonly name?: string;
  readonly code?: string | null;
  readonly priceMinor?: number;
  readonly isMultiple?: boolean;
  readonly maxSelect?: number | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

/** Datos insertados en `ingredients`. */
export interface NewIngredientRecord {
  readonly businessId: number;
  readonly name: string;
  readonly unit: string;
  readonly costMinor: number;
  readonly supplier: string | null;
  readonly isActive: boolean;
}

/** Campos actualizables de `ingredients`. */
export interface IngredientPatch {
  readonly name?: string;
  readonly unit?: string;
  readonly costMinor?: number;
  readonly supplier?: string | null;
  readonly isActive?: boolean;
}

/** Filtros del catálogo de insumos. */
export interface IngredientListFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: IngredientSort;
  readonly q?: string;
  readonly supplier?: string;
  readonly unit?: string;
  readonly isActive?: boolean;
  readonly includeInactive?: boolean;
}

/** Fila de `inventory_items` leída como proyección de stock del producto. */
export interface ProductStockRow {
  readonly current_stock: number;
  readonly min_stock: number;
  readonly max_stock: number;
  readonly is_tracked: 0 | 1;
}

/** Repositorio de productos y sus sub-recursos. */
export interface ProductsRepository {
  // --- Productos: lecturas ------------------------------------------------
  /** Listado paginado de `products` (sin variantes ni complementos). */
  list(filter: ProductListFilter, db?: Db): readonly ProductRow[];
  /** Listado paginado con SÓLO las columnas de `ProductBasic`. */
  listBasic(filter: ProductListFilter, db?: Db): readonly ProductBasicRow[];
  /** Total de productos que satisfacen el filtro. */
  count(filter: Omit<ProductListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Producto por id dentro del negocio. `null` si no existe o está borrado. */
  findById(id: number, businessId: number, db?: Db): ProductRow | null;
  /** Producto por slug, INCLUDING los borrados (para no reutilizar el slug). */
  findBySlugIncludingDeleted(slug: string, db?: Db): ProductRow | null;
  /** Producto por SKU dentro del negocio, para validar duplicados. */
  findBySku(sku: string, businessId: number, db?: Db): ProductRow | null;
  /** Referencia de la categoría a la que pertenece un producto. */
  findCategoryRef(categoryId: number, db?: Db): { id: number; name: string; slug: string } | null;
  /** Categoría por id; `null` si no existe o está borrada lógicamente. */
  findCategory(categoryId: number, businessId: number, db?: Db): { id: number; name: string; slug: string } | null;
  /** Máximo `sort_order` del negocio, para colocar el producto al final. */
  maxSortOrder(businessId: number, db?: Db): number;
  /** Conteo por categoría de los productos que satisfacen el filtro. */
  countByCategory(
    filter: Omit<ProductListFilter, 'limit' | 'offset' | 'sort'>,
    db?: Db,
  ): readonly CategoryProductCount[];
  /** Proyección de stock del producto desde `inventory_items`. */
  findStock(productId: number, db?: Db): ProductStockRow | null;
  // --- Productos: escrituras ----------------------------------------------
  /** Inserta el producto y devuelve su id. */
  insert(record: NewProductRecord, db?: Db): number;
  /** Actualiza sólo los campos presentes. `sku` no se puede tocar. */
  update(id: number, patch: ProductPatch, db?: Db): void;
  /** Marca `deleted_at`. Idempotente. */
  softDelete(id: number, deletedAt: string, db?: Db): void;

  // --- Menú público --------------------------------------------------------
  /** Categorías activas y no borradas, en orden de carta. */
  listMenuCategories(businessId: number, db?: Db): readonly MenuCategoryRow[];
  /** Productos publicables del menú, con su categoría resuelta. */
  listMenuProducts(filter: MenuProductFilter, db?: Db): readonly MenuProductRow[];
  /**
   * Un producto del menú por id. `null` si no existe, está borrado, inactivo, no
   * disponible o su categoría no es pública.
   */
  findMenuProductById(id: number, businessId: number, db?: Db): MenuProductRow | null;

  // --- Variantes -----------------------------------------------------------
  /** Variantes del producto, ordenadas. */
  listVariants(productId: number, db?: Db): readonly ProductVariantRow[];
  /** Variantes de varios productos de una vez, para el listado `fields=full`. */
  listVariantsForProducts(productIds: readonly number[], db?: Db): readonly ProductVariantRow[];
  /** Variante por id, con su `product_id`. */
  findVariantById(variantId: number, db?: Db): ProductVariantRow | null;
  /** Variante por id acotada a un producto. */
  findVariantByIdForProduct(variantId: number, productId: number, db?: Db): ProductVariantRow | null;
  /** Inserta una variante y devuelve su id. */
  insertVariant(record: NewVariantRecord, db?: Db): number;
  /** Actualiza una variante. */
  updateVariant(variantId: number, patch: VariantPatch, db?: Db): void;
  /** Quita el distintivo `is_default` de las demás variantes del producto. */
  clearDefaultVariants(productId: number, excludingVariantId: number | null, db?: Db): number;
  /** Variante `is_default = 1` del producto, o `null`. */
  findDefaultVariant(productId: number, db?: Db): ProductVariantRow | null;
  /** Variantes activas del producto, para el menú. */
  listActiveVariants(productId: number, db?: Db): readonly ProductVariantRow[];
  /** Número de variantes del producto. */
  countVariants(productId: number, db?: Db): number;

  // --- Complementos --------------------------------------------------------
  /** Complementos del producto, ordenados. */
  listAddons(productId: number, db?: Db): readonly ProductAddonRow[];
  /** Complementos de varios productos de una vez (listado `fields=full`). */
  listAddonsForProducts(productIds: readonly number[], db?: Db): readonly ProductAddonRow[];
  /** Complemento por id, con su `product_id`. */
  findAddonById(addonId: number, db?: Db): ProductAddonRow | null;
  /** Complemento por id acotado a un producto. */
  findAddonByIdForProduct(addonId: number, productId: number, db?: Db): ProductAddonRow | null;
  /** Inserta un complemento y devuelve su id. */
  insertAddon(record: NewAddonRecord, db?: Db): number;
  /** Actualiza un complemento. */
  updateAddon(addonId: number, patch: AddonPatch, db?: Db): void;
  /** Complementos activos del producto, para el menú. */
  listActiveAddons(productId: number, db?: Db): readonly ProductAddonRow[];
  /** Máximo `sort_order` de complementos del producto. */
  maxAddonSortOrder(productId: number, db?: Db): number;

  // --- Ingredientes --------------------------------------------------------
  /** Insumo por id dentro del negocio. `null` si no existe o está borrado. */
  findIngredientById(id: number, businessId: number, db?: Db): IngredientRow | null;
  /** Insumo por nombre normalizado dentro del negocio. */
  findIngredientByName(name: string, businessId: number, db?: Db): IngredientRow | null;
  /** Listado paginado del catálogo de insumos. */
  listIngredients(filter: IngredientListFilter, db?: Db): readonly IngredientRow[];
  /** Total de insumos que satisfacen el filtro. */
  countIngredients(filter: Omit<IngredientListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Inserta un insumo y devuelve su id. */
  insertIngredient(record: NewIngredientRecord, db?: Db): number;
  /** Actualiza un insumo. */
  updateIngredient(id: number, patch: IngredientPatch, db?: Db): void;
  /** Marca `deleted_at` del insumo. Idempotente. */
  softDeleteIngredient(id: number, deletedAt: string, db?: Db): void;
  /** Receta del producto con el nombre, unidad y stock del insumo. */
  listRecipe(productId: number, db?: Db): readonly ProductIngredientRow[];
  /** Línea de receta por producto e insumo, o `null`. */
  findRecipeLine(productId: number, ingredientId: number, db?: Db): { id: number } | null;
  /** Inserta una línea de receta y devuelve su id. */
  insertRecipeLine(productId: number, ingredientId: number, quantity: number, db?: Db): number;
  /** Elimina la línea de receta (baja física: no hay histórico de recetas). */
  deleteRecipeLine(productId: number, ingredientId: number, db?: Db): number;
  /** `true` si el insumo aparece en la receta de algún producto vivo. */
  isIngredientInAnyRecipe(ingredientId: number, db?: Db): boolean;
  /**
   * Devuelve el `inventory_item` del insumo, creándolo con `current_stock = 0`
   * y `is_tracked = 1` si no existía. Es el comportamiento de
   * `updateStock = true` de `POST /products/:id/ingredients` (API.md 7.11).
   */
  ensureInventoryItemForIngredient(
    ingredientId: number,
    businessId: number,
    db?: Db,
  ): { readonly id: number; readonly created: boolean };
  /** Número de `order_items` que apuntan al producto. */
  countOrderItemsForProduct(productId: number, db?: Db): number;
  /**
   * Número de `order_items` que usaron la variante. Sólo para el aviso del
   * borrado: los snapshots sobreviven a la variante (BR-PRICE-004).
   */
  countOrderItemsForVariant(variantId: number, db?: Db): number;
  /** Número de `order_items` que usaron el complemento. */
  countOrderItemsForAddon(addonId: number, db?: Db): number;
}
