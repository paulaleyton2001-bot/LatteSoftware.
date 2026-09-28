/**
 * Contrato de persistencia de categorías del módulo `catalog`.
 *
 * Es una INTERFAZ y no una clase: el service depende de este contrato, nunca de
 * SQLite (DESIGN.md 3.1, regla P3). La implementación vive en
 * `categories.repository.sqlite.ts`, único fichero del módulo con SQL de
 * categorías.
 *
 * REGLAS QUE RESPETA:
 *  - Ningún método abre ni cierra transacción: la abre el service con
 *    `runInTransactionSync`.
 *  - Los identificadores dinámicos (columna de orden) NO se interpolan desde
 *    fuera: se interpolan desde una allowlist interna de la implementación.
 *  - Un método = una cosa. Nada de "updateAndReorderAndAudit".
 */
import type { Db } from '../../shared/database/connection.js';
import type {
  CategoryCountedRow,
  CategoryRow,
  CategorySort,
  CategorySortColumn,
} from './catalog.types.js';

export type { CategorySort, CategorySortColumn };

/** Columnas actualizables de una categoría, ya validadas por el service. */
export interface CategoryPatch {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly icon?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

/** Datos insertados en `categories`. */
export interface NewCategoryRecord {
  readonly businessId: number;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly icon: string | null;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

/** Filtros de `GET /api/v1/categories`. */
export interface CategoryListFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: CategorySort;
  /** `q`: busca por nombre o slug. `LIKE` siempre parametrizado. */
  readonly q?: string;
  /** Filtro explícito por estado. */
  readonly isActive?: boolean;
  /** `includeInactive = false` (por defecto) oculta las inactivas. */
  readonly includeInactive?: boolean;
}

/** Repositorio de categorías. */
export interface CategoriesRepository {
  /** Listado paginado, con los conteos de producto resueltos. */
  list(filter: CategoryListFilter, db?: Db): readonly CategoryCountedRow[];
  /** Total de categorías que satisfacen el filtro. */
  count(
    filter: Omit<CategoryListFilter, 'limit' | 'offset' | 'sort'>,
    db?: Db,
  ): number;
  /** Categoría por id, dentro del negocio. `null` si no existe o está borrada. */
  findById(id: number, businessId: number, db?: Db): CategoryCountedRow | null;
  /**
   * Categoría por slug dentro del negocio, INCLUDING las borradas lógicamente.
   * Existe para no reutilizar el slug de una categoría dada de baja: el
   * `UNIQUE(business_id, slug)` sigue vigente sobre la fila borrada.
   */
  findBySlugIncludingDeleted(slug: string, businessId: number, db?: Db): CategoryRow | null;
  /** Máximo `sort_order` del negocio, para colocar la categoría al final. */
  maxSortOrder(businessId: number, db?: Db): number;
  /** Inserta la categoría y devuelve su id. */
  insert(record: NewCategoryRecord, db?: Db): number;
  /** Actualiza sólo los campos presentes. */
  update(id: number, patch: CategoryPatch, db?: Db): void;
  /** Marca `deleted_at`. Idempotente. */
  softDelete(id: number, deletedAt: string, db?: Db): void;
  /** Fija `sort_order` de una categoría (usado por `POST /reorder`). */
  updateSortOrder(id: number, sortOrder: number, db?: Db): void;
  /**
   * Número de productos no borrados lógicamente de la categoría. Es el
   * `orphanedProducts` del soft delete: los productos NO se borran, se quedan
   * sin categoría (`ON DELETE SET NULL` en el esquema, ejecutado a mano aquí
   * porque el borrado es lógico).
   */
  countProducts(id: number, db?: Db): number;
  /** Desvincula los productos de la categoría (`category_id = NULL`). */
  detachProducts(id: number, db?: Db): number;
  /** Productos activos de la categoría, limitado a `limit` (API.md 7.10). */
  listActiveProductBasics(id: number, limit: number, db?: Db): readonly {
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
  }[];
}
