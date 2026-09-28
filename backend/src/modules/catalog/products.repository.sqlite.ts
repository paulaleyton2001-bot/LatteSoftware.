/**
 * Implementación SQLite del repositorio de productos.
 *
 * ÚNICO fichero del módulo `catalog` con SQL de productos, variantes,
 * complementos, insumos y recetas (DESIGN.md 3.2).
 *
 * ================================ SEGURIDAD SQL =============================
 *  - Todas las consultas usan parámetros `?`. La entrada del cliente NUNCA se
 *    concatena en el texto SQL.
 *  - `q` (búsqueda por nombre, SKU o descripción) va como parámetro de `LIKE`,
 *    con `%`, `_` y `\` escapados: buscar "50%" no devuelve el catálogo entero.
 *  - La columna de `ORDER BY` sale de una allowlist interna (`SORT_SQL`).
 *
 * ========================== `fields=basic` Y EL POS ========================
 * `listBasic` proyecta SÓLO las 10 columnas de `ProductBasic` (API.md 6.3). Con
 * 500 productos, la versión completa carga además variantes y complementos de
 * cada uno; para pintar la rejilla del POS eso es trabajo que se tira. Las dos
 * listas comparten el MISMO `buildWhere`, de modo que `total` y los filtros
 * nunca divergen entre `basic` y `full`.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import type {
  AddonPatch,
  IngredientListFilter,
  IngredientPatch,
  MenuCategoryRow,
  MenuProductFilter,
  MenuProductRow,
  NewAddonRecord,
  NewIngredientRecord,
  NewProductRecord,
  NewVariantRecord,
  ProductBasicRow,
  ProductListFilter,
  ProductPatch,
  ProductsRepository,
  ProductStockRow,
  VariantPatch,
} from './products.repository.js';
import type {
  CategoryProductCount,
  IngredientRow,
  ProductAddonRow,
  ProductIngredientRow,
  ProductRow,
  ProductSortColumn,
  ProductVariantRow,
} from './catalog.types.js';

/** Columnas completas de `products`. */
const PRODUCT_COLUMNS = `
  p.id, p.business_id, p.category_id, p.sku, p.name, p.slug,
  p.short_description, p.description, p.image_url, p.base_price_minor,
  p.promo_price_minor, p.promo_starts_at, p.promo_ends_at, p.tax_rate_bp,
  p.track_stock, p.is_featured, p.is_available, p.is_active,
  p.preparation_minutes, p.sort_order, p.created_at, p.updated_at, p.deleted_at
`;

/** Las 10 columnas de `ProductBasic` (API.md 6.3). Ni una más. */
const PRODUCT_BASIC_COLUMNS = `
  p.id, p.sku, p.name, p.image_url, p.base_price_minor, p.promo_price_minor,
  p.is_available, p.is_featured, p.preparation_minutes, p.category_id
`;

/** Columnas de `product_variants`. */
const VARIANT_COLUMNS = `
  v.id, v.product_id, v.name, v.code, v.price_delta_minor, v.price_minor,
  v.is_default, v.sort_order, v.is_active, v.created_at, v.updated_at
`;

/** Columnas de `product_addons`. */
const ADDON_COLUMNS = `
  a.id, a.product_id, a.name, a.code, a.price_minor, a.is_multiple,
  a.max_select, a.sort_order, a.is_active
`;

/** Columnas de `ingredients`. */
const INGREDIENT_COLUMNS = `
  i.id, i.business_id, i.name, i.unit, i.cost_minor, i.supplier, i.is_active,
  i.created_at, i.updated_at
`;

/** Columnas ordenables de productos: allowlist por construcción. */
const SORT_SQL: Readonly<Record<ProductSortColumn, string>> = Object.freeze({
  sort_order: 'p.sort_order',
  name: 'p.name',
  base_price_minor: 'p.base_price_minor',
  created_at: 'p.created_at',
  preparation_minutes: 'p.preparation_minutes',
});

/** Columnas ordenables de insumos. */
const INGREDIENT_SORT_SQL = Object.freeze({
  name: 'i.name',
  created_at: 'i.created_at',
  cost_minor: 'i.cost_minor',
});

/** Escapa los comodines de `LIKE` en el texto buscado por el cliente. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** `WHERE` compartido por `list`, `listBasic` y `count`. */
function buildProductWhere(
  filter: Omit<ProductListFilter, 'limit' | 'offset' | 'sort'>,
): { sql: string; params: unknown[] } {
  const clauses: string[] = ['p.business_id = ?', 'p.deleted_at IS NULL'];
  const params: unknown[] = [filter.businessId];

  // `includeInactive` (API.md 7.11) es el interruptor general; `isActive` es el
  // filtro explícito y manda sobre él cuando viene.
  if (filter.includeInactive === true) {
    if (filter.isActive !== undefined) {
      clauses.push('p.is_active = ?');
      params.push(filter.isActive ? 1 : 0);
    }
  } else {
    clauses.push('p.is_active = 1');
  }
  if (filter.categoryId !== undefined) {
    clauses.push('p.category_id = ?');
    params.push(filter.categoryId);
  }
  if (filter.q !== undefined) {
    // API.md 5.3: en productos `q` busca por `name`, `sku` y
    // `shortDescription`. Los tres LIKE comparten el mismo patrón.
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push(
      "(p.name LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR IFNULL(p.short_description, '') LIKE ? ESCAPE '\\')",
    );
    params.push(pattern, pattern, pattern);
  }
  if (filter.featured !== undefined) {
    clauses.push('p.is_featured = ?');
    params.push(filter.featured ? 1 : 0);
  }
  if (filter.available !== undefined) {
    clauses.push('p.is_available = ?');
    params.push(filter.available ? 1 : 0);
  }
  if (filter.trackStock !== undefined) {
    clauses.push('p.track_stock = ?');
    params.push(filter.trackStock ? 1 : 0);
  }
  if (filter.minPrice !== undefined) {
    clauses.push('p.base_price_minor >= ?');
    params.push(filter.minPrice);
  }
  if (filter.maxPrice !== undefined) {
    clauses.push('p.base_price_minor <= ?');
    params.push(filter.maxPrice);
  }
  if (filter.inStockOnly === true) {
    // Existencias de verdad: un ítem de inventario vivo, con seguimiento y con
    // saldo positivo. Un producto sin ítem no entra, que es lo que espera quien
    // filtra "sólo lo que hay".
    clauses.push(
      `EXISTS (
         SELECT 1 FROM inventory_items ii
          WHERE ii.product_id = p.id
            AND ii.deleted_at IS NULL
            AND ii.is_tracked = 1
            AND ii.current_stock > 0
       )`,
    );
  }

  return { sql: clauses.join(' AND '), params };
}

/** `WHERE` del menú público: sólo productos publicables. */
function buildMenuWhere(filter: MenuProductFilter): { sql: string; params: unknown[] } {
  const clauses: string[] = [
    'p.business_id = ?',
    'p.deleted_at IS NULL',
    'p.is_active = 1',
    'p.is_available = 1',
    'c.is_active = 1',
    'c.deleted_at IS NULL',
  ];
  const params: unknown[] = [filter.businessId];

  if (filter.categoryId !== undefined) {
    clauses.push('c.id = ?');
    params.push(filter.categoryId);
  }
  if (filter.q !== undefined) {
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push(
      "(p.name LIKE ? ESCAPE '\\' OR IFNULL(p.short_description, '') LIKE ? ESCAPE '\\')",
    );
    params.push(pattern, pattern);
  }
  if (filter.featured !== undefined) {
    clauses.push('p.is_featured = ?');
    params.push(filter.featured ? 1 : 0);
  }

  return { sql: clauses.join(' AND '), params };
}

/** `WHERE` del catálogo de insumos. */
function buildIngredientWhere(
  filter: Omit<IngredientListFilter, 'limit' | 'offset' | 'sort'>,
): { sql: string; params: unknown[] } {
  const clauses: string[] = ['i.business_id = ?', 'i.deleted_at IS NULL'];
  const params: unknown[] = [filter.businessId];

  if (filter.includeInactive !== true) {
    clauses.push('i.is_active = 1');
  }
  if (filter.isActive !== undefined) {
    clauses.push('i.is_active = ?');
    params.push(filter.isActive ? 1 : 0);
  }
  if (filter.q !== undefined) {
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push("(i.name LIKE ? ESCAPE '\\' OR IFNULL(i.supplier, '') LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (filter.supplier !== undefined) {
    clauses.push('i.supplier = ?');
    params.push(filter.supplier);
  }
  if (filter.unit !== undefined) {
    clauses.push('i.unit = ?');
    params.push(filter.unit);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Construye los `?` de una lista de ids para un `IN (...)`. */
function placeholders(count: number): string {
  return new Array<unknown>(count).fill('?').join(', ');
}

/** Repositorio de productos sobre `better-sqlite3`. */
export class SqliteProductsRepository implements ProductsRepository {
  // ---------------------------------------------------------------- productos
  public list(filter: ProductListFilter, db: Db = getConnection()): readonly ProductRow[] {
    const where = buildProductWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${PRODUCT_COLUMNS}
           FROM products p
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, p.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as ProductRow[];
  }

  public listBasic(filter: ProductListFilter, db: Db = getConnection()): readonly ProductBasicRow[] {
    const where = buildProductWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${PRODUCT_BASIC_COLUMNS}
           FROM products p
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, p.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as ProductBasicRow[];
  }

  public count(
    filter: Omit<ProductListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildProductWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM products p WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findById(id: number, businessId: number, db: Db = getConnection()): ProductRow | null {
    const row = db
      .prepare(
        `SELECT ${PRODUCT_COLUMNS}
           FROM products p
          WHERE p.id = ?
            AND p.business_id = ?
            AND p.deleted_at IS NULL`,
      )
      .get(id, businessId) as ProductRow | undefined;
    return row ?? null;
  }

  public findBySlugIncludingDeleted(slug: string, db: Db = getConnection()): ProductRow | null {
    const row = db
      .prepare(`SELECT ${PRODUCT_COLUMNS} FROM products p WHERE p.slug = ?`)
      .get(slug) as ProductRow | undefined;
    return row ?? null;
  }

  public findBySku(sku: string, businessId: number, db: Db = getConnection()): ProductRow | null {
    const row = db
      .prepare(
        `SELECT ${PRODUCT_COLUMNS}
           FROM products p
          WHERE p.sku = ?
            AND p.business_id = ?`,
      )
      .get(sku, businessId) as ProductRow | undefined;
    return row ?? null;
  }

  public findCategoryRef(
    categoryId: number,
    db: Db = getConnection(),
  ): { id: number; name: string; slug: string } | null {
    const row = db
      .prepare(
        `SELECT id, name, slug FROM categories
          WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(categoryId) as { id: number; name: string; slug: string } | undefined;
    return row ?? null;
  }

  public findCategory(
    categoryId: number,
    businessId: number,
    db: Db = getConnection(),
  ): { id: number; name: string; slug: string } | null {
    const row = db
      .prepare(
        `SELECT id, name, slug FROM categories
          WHERE id = ? AND business_id = ? AND deleted_at IS NULL`,
      )
      .get(categoryId, businessId) as { id: number; name: string; slug: string } | undefined;
    return row ?? null;
  }

  public maxSortOrder(businessId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM products WHERE business_id = ?')
      .get(businessId) as { value: number } | undefined;
    return row?.value ?? -1;
  }

  public countByCategory(
    filter: Omit<ProductListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): readonly CategoryProductCount[] {
    const where = buildProductWhere(filter);
    return db
      .prepare(
        `SELECT c.id AS id, c.name AS name, COUNT(p.id) AS count
           FROM categories c
           JOIN products p
             ON p.category_id = c.id
            AND p.deleted_at IS NULL
          WHERE c.deleted_at IS NULL
            AND c.is_active = 1
            AND c.business_id = ?
            AND ${where.sql}
          GROUP BY c.id, c.name
          ORDER BY count DESC, c.name ASC`,
      )
      .all(filter.businessId, ...where.params) as CategoryProductCount[];
  }

  public findStock(productId: number, db: Db = getConnection()): ProductStockRow | null {
    const row = db
      .prepare(
        `SELECT current_stock, min_stock, max_stock, is_tracked
           FROM inventory_items
          WHERE product_id = ?
            AND deleted_at IS NULL`,
      )
      .get(productId) as ProductStockRow | undefined;
    return row ?? null;
  }

  public countOrderItemsForProduct(productId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COUNT(*) AS total FROM order_items WHERE product_id = ?')
      .get(productId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public countOrderItemsForVariant(variantId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COUNT(*) AS total FROM order_items WHERE variant_id = ?')
      .get(variantId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public countOrderItemsForAddon(addonId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COUNT(*) AS total FROM order_item_addons WHERE product_addon_id = ?')
      .get(addonId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public insert(record: NewProductRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO products (
             business_id, category_id, sku, name, slug, short_description, description,
             image_url, base_price_minor, promo_price_minor, promo_starts_at, promo_ends_at,
             tax_rate_bp, track_stock, is_featured, is_available, preparation_minutes,
             sort_order, is_active
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.categoryId,
          record.sku,
          record.name,
          record.slug,
          record.shortDescription,
          record.description,
          record.imageUrl,
          record.basePriceMinor,
          record.promoPriceMinor,
          record.promoStartsAt,
          record.promoEndsAt,
          record.taxRateBp,
          record.trackStock ? 1 : 0,
          record.isFeatured ? 1 : 0,
          record.isAvailable ? 1 : 0,
          record.preparationMinutes,
          record.sortOrder,
          record.isActive ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // `ux_products_sku` y `ux_products_slug` son UNIQUE GLOBALES (no por
      // negocio): por eso se traducen con su propio mensaje.
      throw translateUniqueConstraint(error, {
        code: 'PRODUCT_SKU_TAKEN',
        message: 'Ya existe un producto con ese SKU',
        field: 'sku',
        index: 'ux_products_sku',
      });
    }
  }

  public update(id: number, patch: ProductPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.categoryId !== undefined) push('category_id', patch.categoryId);
    if (patch.name !== undefined) push('name', patch.name);
    if (patch.slug !== undefined) push('slug', patch.slug);
    if (patch.shortDescription !== undefined) push('short_description', patch.shortDescription);
    if (patch.description !== undefined) push('description', patch.description);
    if (patch.imageUrl !== undefined) push('image_url', patch.imageUrl);
    if (patch.basePriceMinor !== undefined) push('base_price_minor', patch.basePriceMinor);
    if (patch.promoPriceMinor !== undefined) push('promo_price_minor', patch.promoPriceMinor);
    if (patch.promoStartsAt !== undefined) push('promo_starts_at', patch.promoStartsAt);
    if (patch.promoEndsAt !== undefined) push('promo_ends_at', patch.promoEndsAt);
    if (patch.taxRateBp !== undefined) push('tax_rate_bp', patch.taxRateBp);
    if (patch.trackStock !== undefined) push('track_stock', patch.trackStock ? 1 : 0);
    if (patch.isFeatured !== undefined) push('is_featured', patch.isFeatured ? 1 : 0);
    if (patch.isAvailable !== undefined) push('is_available', patch.isAvailable ? 1 : 0);
    if (patch.preparationMinutes !== undefined) {
      push('preparation_minutes', patch.preparationMinutes);
    }
    if (patch.sortOrder !== undefined) push('sort_order', patch.sortOrder);
    if (patch.isActive !== undefined) push('is_active', patch.isActive ? 1 : 0);

    if (assignments.length === 0) {
      return;
    }
    params.push(id);
    try {
      db.prepare(`UPDATE products SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'PRODUCT_SLUG_TAKEN',
        message: 'Ya existe un producto con ese identificador (slug)',
        field: 'slug',
        index: 'ux_products_slug',
      });
    }
  }

  public softDelete(id: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare('UPDATE products SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
      deletedAt,
      id,
    );
  }

  // ---------------------------------------------------------------- menú
  public listMenuCategories(businessId: number, db: Db = getConnection()): readonly MenuCategoryRow[] {
    return db
      .prepare(
        `SELECT id, name, slug, description, image_url, icon, sort_order
           FROM categories
          WHERE business_id = ?
            AND is_active = 1
            AND deleted_at IS NULL
          ORDER BY sort_order ASC, id ASC`,
      )
      .all(businessId) as MenuCategoryRow[];
  }

  public listMenuProducts(filter: MenuProductFilter, db: Db = getConnection()): readonly MenuProductRow[] {
    const where = buildMenuWhere(filter);
    return db
      .prepare(
        `SELECT ${PRODUCT_COLUMNS}, c.name AS category_name, c.slug AS category_slug
           FROM products p
           JOIN categories c
             ON c.id = p.category_id
            AND c.is_active = 1
            AND c.deleted_at IS NULL
          WHERE ${where.sql}
          ORDER BY c.sort_order ASC, p.sort_order ASC, p.id ASC`,
      )
      .all(...where.params) as MenuProductRow[];
  }

  public findMenuProductById(id: number, businessId: number, db: Db = getConnection()): MenuProductRow | null {
    const row = db
      .prepare(
        `SELECT ${PRODUCT_COLUMNS}, c.name AS category_name, c.slug AS category_slug
           FROM products p
           JOIN categories c
             ON c.id = p.category_id
            AND c.is_active = 1
            AND c.deleted_at IS NULL
          WHERE p.id = ?
            AND p.business_id = ?
            AND p.deleted_at IS NULL
            AND p.is_active = 1
            AND p.is_available = 1`,
      )
      .get(id, businessId) as MenuProductRow | undefined;
    return row ?? null;
  }

  // ----------------------------------------------------------------- variantes
  public listVariants(productId: number, db: Db = getConnection()): readonly ProductVariantRow[] {
    return db
      .prepare(
        `SELECT ${VARIANT_COLUMNS}
           FROM product_variants v
          WHERE v.product_id = ?
          ORDER BY v.sort_order ASC, v.id ASC`,
      )
      .all(productId) as ProductVariantRow[];
  }

  public listVariantsForProducts(
    productIds: readonly number[],
    db: Db = getConnection(),
  ): readonly ProductVariantRow[] {
    if (productIds.length === 0) {
      return [];
    }
    return db
      .prepare(
        `SELECT ${VARIANT_COLUMNS}
           FROM product_variants v
          WHERE v.product_id IN (${placeholders(productIds.length)})
          ORDER BY v.product_id ASC, v.sort_order ASC, v.id ASC`,
      )
      .all(...productIds) as ProductVariantRow[];
  }

  public findVariantById(variantId: number, db: Db = getConnection()): ProductVariantRow | null {
    const row = db
      .prepare(`SELECT ${VARIANT_COLUMNS} FROM product_variants v WHERE v.id = ?`)
      .get(variantId) as ProductVariantRow | undefined;
    return row ?? null;
  }

  public findVariantByIdForProduct(
    variantId: number,
    productId: number,
    db: Db = getConnection(),
  ): ProductVariantRow | null {
    const row = db
      .prepare(
        `SELECT ${VARIANT_COLUMNS} FROM product_variants v WHERE v.id = ? AND v.product_id = ?`,
      )
      .get(variantId, productId) as ProductVariantRow | undefined;
    return row ?? null;
  }

  public insertVariant(record: NewVariantRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO product_variants
             (product_id, name, code, price_delta_minor, price_minor, is_default, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.productId,
          record.name,
          record.code,
          record.priceDeltaMinor,
          record.priceMinor,
          record.isDefault ? 1 : 0,
          record.sortOrder,
          record.isActive ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'VARIANT_NAME_TAKEN',
        message: 'Ya existe una variante con ese nombre en este producto',
        field: 'name',
        index: 'ux_product_variants_product_name',
      });
    }
  }

  public updateVariant(variantId: number, patch: VariantPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.name !== undefined) push('name', patch.name);
    if (patch.code !== undefined) push('code', patch.code);
    if (patch.priceDeltaMinor !== undefined) push('price_delta_minor', patch.priceDeltaMinor);
    if (patch.priceMinor !== undefined) push('price_minor', patch.priceMinor);
    if (patch.isDefault !== undefined) push('is_default', patch.isDefault ? 1 : 0);
    if (patch.sortOrder !== undefined) push('sort_order', patch.sortOrder);
    if (patch.isActive !== undefined) push('is_active', patch.isActive ? 1 : 0);

    if (assignments.length === 0) {
      return;
    }
    params.push(variantId);
    try {
      db.prepare(`UPDATE product_variants SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'VARIANT_NAME_TAKEN',
        message: 'Ya existe una variante con ese nombre en este producto',
        field: 'name',
        index: 'ux_product_variants_product_name',
      });
    }
  }

  public clearDefaultVariants(
    productId: number,
    excludingVariantId: number | null,
    db: Db = getConnection(),
  ): number {
    const result =
      excludingVariantId === null
        ? db
            .prepare('UPDATE product_variants SET is_default = 0 WHERE product_id = ? AND is_default = 1')
            .run(productId)
        : db
            .prepare(
              'UPDATE product_variants SET is_default = 0 WHERE product_id = ? AND is_default = 1 AND id <> ?',
            )
            .run(productId, excludingVariantId);
    return result.changes;
  }

  public findDefaultVariant(productId: number, db: Db = getConnection()): ProductVariantRow | null {
    const row = db
      .prepare(
        `SELECT ${VARIANT_COLUMNS}
           FROM product_variants v
          WHERE v.product_id = ?
            AND v.is_default = 1
          ORDER BY v.id ASC
          LIMIT 1`,
      )
      .get(productId) as ProductVariantRow | undefined;
    return row ?? null;
  }

  public listActiveVariants(productId: number, db: Db = getConnection()): readonly ProductVariantRow[] {
    return db
      .prepare(
        `SELECT ${VARIANT_COLUMNS}
           FROM product_variants v
          WHERE v.product_id = ?
            AND v.is_active = 1
          ORDER BY v.sort_order ASC, v.id ASC`,
      )
      .all(productId) as ProductVariantRow[];
  }

  public countVariants(productId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COUNT(*) AS total FROM product_variants WHERE product_id = ?')
      .get(productId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  // -------------------------------------------------------------- complementos
  public listAddons(productId: number, db: Db = getConnection()): readonly ProductAddonRow[] {
    return db
      .prepare(
        `SELECT ${ADDON_COLUMNS}
           FROM product_addons a
          WHERE a.product_id = ?
          ORDER BY a.sort_order ASC, a.id ASC`,
      )
      .all(productId) as ProductAddonRow[];
  }

  public listAddonsForProducts(
    productIds: readonly number[],
    db: Db = getConnection(),
  ): readonly ProductAddonRow[] {
    if (productIds.length === 0) {
      return [];
    }
    return db
      .prepare(
        `SELECT ${ADDON_COLUMNS}
           FROM product_addons a
          WHERE a.product_id IN (${placeholders(productIds.length)})
          ORDER BY a.product_id ASC, a.sort_order ASC, a.id ASC`,
      )
      .all(...productIds) as ProductAddonRow[];
  }

  public findAddonById(addonId: number, db: Db = getConnection()): ProductAddonRow | null {
    const row = db
      .prepare(`SELECT ${ADDON_COLUMNS} FROM product_addons a WHERE a.id = ?`)
      .get(addonId) as ProductAddonRow | undefined;
    return row ?? null;
  }

  public findAddonByIdForProduct(
    addonId: number,
    productId: number,
    db: Db = getConnection(),
  ): ProductAddonRow | null {
    const row = db
      .prepare(`SELECT ${ADDON_COLUMNS} FROM product_addons a WHERE a.id = ? AND a.product_id = ?`)
      .get(addonId, productId) as ProductAddonRow | undefined;
    return row ?? null;
  }

  public insertAddon(record: NewAddonRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO product_addons
             (product_id, name, code, price_minor, is_multiple, max_select, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.productId,
          record.name,
          record.code,
          record.priceMinor,
          record.isMultiple ? 1 : 0,
          record.maxSelect,
          record.sortOrder,
          record.isActive ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'ADDON_NAME_TAKEN',
        message: 'Ya existe un complemento con ese nombre en este producto',
        field: 'name',
        index: 'ux_product_addons_product_name',
      });
    }
  }

  public updateAddon(addonId: number, patch: AddonPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    const push = (column: string, value: unknown): void => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (patch.name !== undefined) push('name', patch.name);
    if (patch.code !== undefined) push('code', patch.code);
    if (patch.priceMinor !== undefined) push('price_minor', patch.priceMinor);
    if (patch.isMultiple !== undefined) push('is_multiple', patch.isMultiple ? 1 : 0);
    if (patch.maxSelect !== undefined) push('max_select', patch.maxSelect);
    if (patch.sortOrder !== undefined) push('sort_order', patch.sortOrder);
    if (patch.isActive !== undefined) push('is_active', patch.isActive ? 1 : 0);

    if (assignments.length === 0) {
      return;
    }
    params.push(addonId);
    try {
      db.prepare(`UPDATE product_addons SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'ADDON_NAME_TAKEN',
        message: 'Ya existe un complemento con ese nombre en este producto',
        field: 'name',
        index: 'ux_product_addons_product_name',
      });
    }
  }

  public listActiveAddons(productId: number, db: Db = getConnection()): readonly ProductAddonRow[] {
    return db
      .prepare(
        `SELECT ${ADDON_COLUMNS}
           FROM product_addons a
          WHERE a.product_id = ?
            AND a.is_active = 1
          ORDER BY a.sort_order ASC, a.id ASC`,
      )
      .all(productId) as ProductAddonRow[];
  }

  public maxAddonSortOrder(productId: number, db: Db = getConnection()): number {
    const row = db
      .prepare(
        'SELECT COALESCE(MAX(sort_order), -1) AS value FROM product_addons WHERE product_id = ?',
      )
      .get(productId) as { value: number } | undefined;
    return row?.value ?? -1;
  }

  // ---------------------------------------------------------------- ingredientes
  public findIngredientById(id: number, businessId: number, db: Db = getConnection()): IngredientRow | null {
    const row = db
      .prepare(
        `SELECT ${INGREDIENT_COLUMNS}
           FROM ingredients i
          WHERE i.id = ? AND i.business_id = ? AND i.deleted_at IS NULL`,
      )
      .get(id, businessId) as IngredientRow | undefined;
    return row ?? null;
  }

  public findIngredientByName(name: string, businessId: number, db: Db = getConnection()): IngredientRow | null {
    const row = db
      .prepare(
        `SELECT ${INGREDIENT_COLUMNS}
           FROM ingredients i
          WHERE i.name = ? AND i.business_id = ?`,
      )
      .get(name, businessId) as IngredientRow | undefined;
    return row ?? null;
  }

  public listIngredients(filter: IngredientListFilter, db: Db = getConnection()): readonly IngredientRow[] {
    const where = buildIngredientWhere(filter);
    const column = INGREDIENT_SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${INGREDIENT_COLUMNS}
           FROM ingredients i
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, i.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as IngredientRow[];
  }

  public countIngredients(
    filter: Omit<IngredientListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildIngredientWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM ingredients i WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public insertIngredient(record: NewIngredientRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO ingredients (business_id, name, unit, cost_minor, supplier, is_active)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.name,
          record.unit,
          record.costMinor,
          record.supplier,
          record.isActive ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'INGREDIENT_NAME_TAKEN',
        message: 'Ya existe un insumo con ese nombre en este negocio',
        field: 'name',
        index: 'ux_ingredients_business_name',
      });
    }
  }

  public updateIngredient(id: number, patch: IngredientPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      assignments.push('name = ?');
      params.push(patch.name);
    }
    if (patch.unit !== undefined) {
      assignments.push('unit = ?');
      params.push(patch.unit);
    }
    if (patch.costMinor !== undefined) {
      assignments.push('cost_minor = ?');
      params.push(patch.costMinor);
    }
    if (patch.supplier !== undefined) {
      assignments.push('supplier = ?');
      params.push(patch.supplier);
    }
    if (patch.isActive !== undefined) {
      assignments.push('is_active = ?');
      params.push(patch.isActive ? 1 : 0);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(id);
    try {
      db.prepare(`UPDATE ingredients SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'INGREDIENT_NAME_TAKEN',
        message: 'Ya existe un insumo con ese nombre en este negocio',
        field: 'name',
        index: 'ux_ingredients_business_name',
      });
    }
  }

  public softDeleteIngredient(id: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare('UPDATE ingredients SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
      deletedAt,
      id,
    );
  }

  // -------------------------------------------------------------------- receta
  public listRecipe(productId: number, db: Db = getConnection()): readonly ProductIngredientRow[] {
    return db
      .prepare(
        `SELECT pi.id, pi.product_id, pi.ingredient_id, pi.quantity,
                i.name AS ingredient_name, i.unit AS unit, i.cost_minor AS cost_minor,
                ii.current_stock AS current_stock, ii.is_tracked AS is_tracked
           FROM product_ingredients pi
           JOIN ingredients i ON i.id = pi.ingredient_id
           LEFT JOIN inventory_items ii
             ON ii.ingredient_id = pi.ingredient_id
            AND ii.deleted_at IS NULL
          WHERE pi.product_id = ?
          ORDER BY i.name ASC, pi.id ASC`,
      )
      .all(productId) as ProductIngredientRow[];
  }

  public findRecipeLine(productId: number, ingredientId: number, db: Db = getConnection()): { id: number } | null {
    const row = db
      .prepare('SELECT id FROM product_ingredients WHERE product_id = ? AND ingredient_id = ?')
      .get(productId, ingredientId) as { id: number } | undefined;
    return row ?? null;
  }

  public insertRecipeLine(
    productId: number,
    ingredientId: number,
    quantity: number,
    db: Db = getConnection(),
  ): number {
    const result = db
      .prepare('INSERT INTO product_ingredients (product_id, ingredient_id, quantity) VALUES (?, ?, ?)')
      .run(productId, ingredientId, quantity);
    return Number(result.lastInsertRowid);
  }

  public deleteRecipeLine(productId: number, ingredientId: number, db: Db = getConnection()): number {
    const result = db
      .prepare('DELETE FROM product_ingredients WHERE product_id = ? AND ingredient_id = ?')
      .run(productId, ingredientId);
    return result.changes;
  }

  public isIngredientInAnyRecipe(ingredientId: number, db: Db = getConnection()): boolean {
    const row = db
      .prepare(
        `SELECT 1 AS present
           FROM product_ingredients pi
           JOIN products p ON p.id = pi.product_id
          WHERE pi.ingredient_id = ?
            AND p.deleted_at IS NULL
          LIMIT 1`,
      )
      .get(ingredientId) as { present: number } | undefined;
    return row !== undefined;
  }

  /**
   * Devuelve el ítem de inventario del insumo, creándolo si hace falta.
   *
   * Es el único `INSERT` del catálogo sobre `inventory_items` y responde a
   * `updateStock = true` de `POST /products/:id/ingredients` (API.md 7.11): un
   * insumo sin control de existencias no puede tener receta, porque no hay forma
   * de saber si se puede preparar. El alta es con `current_stock = 0`: la
   * deuda de existencias la resuelve el primer movimiento del módulo de
   * inventario, nunca un `UPDATE` de saldo (BR-INV-001).
   */
  public ensureInventoryItemForIngredient(
    ingredientId: number,
    businessId: number,
    db: Db = getConnection(),
  ): { readonly id: number; readonly created: boolean } {
    const existing = db
      .prepare(
        `SELECT id, name, unit FROM inventory_items
          WHERE ingredient_id = ? AND deleted_at IS NULL`,
      )
      .get(ingredientId) as { id: number; name: string; unit: string } | undefined;
    if (existing !== undefined) {
      return { id: existing.id, created: false };
    }

    const ingredient = db
      .prepare('SELECT name, unit FROM ingredients WHERE id = ?')
      .get(ingredientId) as { name: string; unit: string } | undefined;
    if (ingredient === undefined) {
      // El service ya ha validado que el insumo existe; si desaparece aquí es
      // una carrera imposible dentro de la transacción.
      throw new Error(`El insumo ${ingredientId} no existe`);
    }

    const result = db
      .prepare(
        `INSERT INTO inventory_items
           (business_id, ingredient_id, name, unit, current_stock, min_stock, max_stock,
            cost_minor, is_tracked)
         VALUES (?, ?, ?, ?, 0, 0, 0, ?, 1)`,
      )
      .run(businessId, ingredientId, ingredient.name, ingredient.unit, 0);
    return { id: Number(result.lastInsertRowid), created: true };
  }
}
