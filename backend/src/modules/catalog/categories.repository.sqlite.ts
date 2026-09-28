/**
 * Implementación SQLite del repositorio de categorías.
 *
 * ÚNICO fichero con SQL de `categories` (DESIGN.md 3.2). Todas las consultas
 * van con parámetros `?`; la entrada del cliente NUNCA se concatena en el texto
 * SQL. El mapeo `snake_case` -> `camelCase` ocurre aquí, no en el controller
 * (API.md 1).
 *
 * ============================== DOS DETALLES QUE IMPORTAN =================
 * 1. **`LIKE` parametrizado y escapado.** `q` llega del cliente y se usa con
 *    `LIKE '%q%'`. El valor va SIEMPRE como parámetro `?`, nunca concatenado; y
 *    además se escapan `%`, `_` y `\` para que buscar "100%" no devuelva todo.
 * 2. **Conteos de producto por subconsulta, no por `JOIN` + `GROUP BY`.** Un
 *    `LEFT JOIN products` multiplicaría las filas y obligaría a agrupar por
 *    todas las columnas de `categories`; dos subconsultas escalares dan el
 *    mismo número con una consulta legible y con el índice
 *    `idx_products_category` (category_id, is_active, sort_order) detrás.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import type {
  CategoriesRepository,
  CategoryListFilter,
  CategoryPatch,
  NewCategoryRecord,
} from './categories.repository.js';
import type { CategoryCountedRow, CategoryRow, CategorySortColumn } from './catalog.types.js';

/** Columnas base de `categories`. */
const CATEGORY_COLUMNS = `
  c.id, c.business_id, c.name, c.slug, c.description, c.image_url, c.icon,
  c.sort_order, c.is_active, c.created_at, c.updated_at
`;

/**
 * Allowlist de columnas ordenables: clave = salida de `parseSort`,
 * valor = columna real. Una allowlist por construcción, sin concatenar entrada.
 */
const SORT_SQL: Readonly<Record<CategorySortColumn, string>> = Object.freeze({
  sort_order: 'c.sort_order',
  name: 'c.name',
  created_at: 'c.created_at',
});

/** Conteos de producto por categoría, como escalares correlacionados. */
const PRODUCT_COUNTS_SQL = `
  (SELECT COUNT(*) FROM products p
    WHERE p.category_id = c.id AND p.deleted_at IS NULL) AS product_count,
  (SELECT COUNT(*) FROM products p
    WHERE p.category_id = c.id AND p.deleted_at IS NULL AND p.is_active = 1) AS active_product_count
`;

/** Escapa los comodines de `LIKE` en el texto buscado por el cliente. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** `WHERE` compartido por `list` y `count`. */
function buildWhere(filter: Omit<CategoryListFilter, 'limit' | 'offset' | 'sort'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = ['c.business_id = ?', 'c.deleted_at IS NULL'];
  const params: unknown[] = [filter.businessId];

  if (filter.includeInactive !== true) {
    clauses.push('c.is_active = 1');
  }
  if (filter.isActive !== undefined) {
    clauses.push('c.is_active = ?');
    params.push(filter.isActive ? 1 : 0);
  }
  if (filter.q !== undefined) {
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push("(c.name LIKE ? ESCAPE '\\' OR c.slug LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de categorías sobre `better-sqlite3`. */
export class SqliteCategoriesRepository implements CategoriesRepository {
  public list(filter: CategoryListFilter, db: Db = getConnection()): readonly CategoryCountedRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${CATEGORY_COLUMNS}, ${PRODUCT_COUNTS_SQL}
           FROM categories c
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, c.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as CategoryCountedRow[];
  }

  public count(
    filter: Omit<CategoryListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM categories c WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findById(id: number, businessId: number, db: Db = getConnection()): CategoryCountedRow | null {
    const row = db
      .prepare(
        `SELECT ${CATEGORY_COLUMNS}, ${PRODUCT_COUNTS_SQL}
           FROM categories c
          WHERE c.id = ?
            AND c.business_id = ?
            AND c.deleted_at IS NULL`,
      )
      .get(id, businessId) as CategoryCountedRow | undefined;
    return row ?? null;
  }

  public findBySlugIncludingDeleted(
    slug: string,
    businessId: number,
    db: Db = getConnection(),
  ): CategoryRow | null {
    const row = db
      .prepare(
        `SELECT c.id, c.business_id, c.name, c.slug, c.description, c.image_url, c.icon,
                c.sort_order, c.is_active, c.created_at, c.updated_at
           FROM categories c
          WHERE c.slug = ?
            AND c.business_id = ?`,
      )
      .get(slug, businessId) as CategoryRow | undefined;
    return row ?? null;
  }

  public maxSortOrder(businessId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS value FROM categories WHERE business_id = ?')
      .get(businessId) as { value: number } | undefined;
    return row?.value ?? -1;
  }

  public insert(record: NewCategoryRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO categories
             (business_id, name, slug, description, image_url, icon, sort_order, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.name,
          record.slug,
          record.description,
          record.imageUrl,
          record.icon,
          record.sortOrder,
          record.isActive ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // `ux_categories_business_slug` es la garantía final contra dos categorías
      // con el mismo slug en el mismo negocio, aunque dos altas simultáneas
      // esquiven la comprobación previa del service.
      throw translateUniqueConstraint(error, {
        code: 'CATEGORY_SLUG_TAKEN',
        message: 'Ya existe una categoría con ese identificador (slug) en este negocio',
        field: 'slug',
        index: 'ux_categories_business_slug',
      });
    }
  }

  public update(id: number, patch: CategoryPatch, db: Db = getConnection()): void {
    // Sólo se escriben los campos presentes: un PATCH parcial no borra el resto.
    // Los nombres de columna salen de una lista cerrada, nunca del cliente.
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      assignments.push('name = ?');
      params.push(patch.name);
    }
    if (patch.slug !== undefined) {
      assignments.push('slug = ?');
      params.push(patch.slug);
    }
    if (patch.description !== undefined) {
      assignments.push('description = ?');
      params.push(patch.description);
    }
    if (patch.imageUrl !== undefined) {
      assignments.push('image_url = ?');
      params.push(patch.imageUrl);
    }
    if (patch.icon !== undefined) {
      assignments.push('icon = ?');
      params.push(patch.icon);
    }
    if (patch.sortOrder !== undefined) {
      assignments.push('sort_order = ?');
      params.push(patch.sortOrder);
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
      db.prepare(`UPDATE categories SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'CATEGORY_SLUG_TAKEN',
        message: 'Ya existe una categoría con ese identificador (slug) en este negocio',
        field: 'slug',
        index: 'ux_categories_business_slug',
      });
    }
  }

  public softDelete(id: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare('UPDATE categories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
      deletedAt,
      id,
    );
  }

  public updateSortOrder(id: number, sortOrder: number, db: Db = getConnection()): void {
    db.prepare('UPDATE categories SET sort_order = ? WHERE id = ? AND deleted_at IS NULL').run(
      sortOrder,
      id,
    );
  }

  public countProducts(id: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COUNT(*) AS total FROM products WHERE category_id = ? AND deleted_at IS NULL')
      .get(id) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public detachProducts(id: number, db: Db = getConnection()): number {
    const result = db
      .prepare('UPDATE products SET category_id = NULL WHERE category_id = ? AND deleted_at IS NULL')
      .run(id);
    return result.changes;
  }

  public listActiveProductBasics(id: number, limit: number, db: Db = getConnection()) {
    return db
      .prepare(
        `SELECT id, sku, name, image_url, base_price_minor, promo_price_minor,
                is_available, is_featured, preparation_minutes, category_id
           FROM products
          WHERE category_id = ?
            AND is_active = 1
            AND deleted_at IS NULL
          ORDER BY sort_order ASC, id ASC
          LIMIT ?`,
      )
      .all(id, limit) as {
      id: number;
      sku: string;
      name: string;
      image_url: string | null;
      base_price_minor: number;
      promo_price_minor: number | null;
      is_available: 0 | 1;
      is_featured: 0 | 1;
      preparation_minutes: number;
      category_id: number | null;
    }[];
  }
}
