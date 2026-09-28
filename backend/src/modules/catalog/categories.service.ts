/**
 * Servicio de categorías: casos de uso de `/api/v1/categories/*` (API.md 7.10).
 *
 * ============================== CAPAS =======================================
 * No conoce Express, ni zod, ni SQLite. Recibe entradas tipadas, decide,
 * orquesta la transacción y devuelve DTOs. El SQL vive en
 * `categories.repository.sqlite.ts` (DESIGN.md 3.1 y 3.6).
 *
 * ========================== REGLAS QUE APLICA ==============================
 *  - Borrado LÓGICO siempre (`deleted_at`). Un producto que estuvo en el
 *    histórico de un pedido conserva su categoría en el snapshot, así que
 *    reinsertar la fila nunca es necesario.
 *  - Al borrar una categoría sus productos NO se borran: quedan huérfanos
 *    (`category_id = NULL`, el mismo efecto del `ON DELETE SET NULL` del
 *    esquema, ejecutado a mano porque el borrado es lógico). Si hay productos
 *    y el cliente no confirma, es `422 CATEGORY_HAS_PRODUCTS`.
 *  - `sortOrder` por defecto = `max + 1`: una categoría nueva va al final, que es
 *    lo que espera quien la crea.
 *  - El slug es único POR NEGOCIO, y también entre las categorías dadas de baja:
 *    reutilizar el slug de una categoría eliminada rompería los enlaces públicos
 *    que aún apuntan a ella.
 *  - Toda escritura deja fila en `audit_logs` con `before`/`after` (BR-SEC-007).
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { AuditAction, AuditEntityType, type UserContext } from '../../shared/domain/index.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import type {
  CategoriesRepository,
  CategoryListFilter,
  CategoryPatch,
} from './categories.repository.js';
import type {
  CategoryCountedRow,
  CategoryDeleteResult,
  CategoryDetailView,
  CategoryRow,
  CategoryView,
  ProductBasicView,
} from './catalog.types.js';
import { slugify } from './catalog.schemas.js';

/** Productos embebidos en `GET /categories/:id` (API.md 7.10: "paginados a 50"). */
const CATEGORY_PRODUCT_LIMIT = 50;

/** Contexto de petición para auditoría y negocio. */
export interface CategoryRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Entradas de los casos de uso. */
export interface CreateCategoryInput {
  readonly name: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly icon?: string | null;
  readonly sortOrder?: number;
  readonly isActive: boolean;
}

export interface UpdateCategoryInput {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly icon?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

/** Página de categorías. */
export interface CategoryPage {
  readonly items: readonly CategoryView[];
  readonly total: number;
}

/** Servicio de categorías. */
export class CategoriesService {
  public constructor(
    private readonly repository: CategoriesRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /** `GET /api/v1/categories` — listado paginado y ordenado por `sort_order`. */
  public list(filter: CategoryListFilter, context: CategoryRequestContext): CategoryPage {
    const safeFilter: CategoryListFilter = { ...filter, businessId: context.actor.businessId };
    const rows = this.repository.list(safeFilter);
    return {
      items: rows.map((row) => this.toView(row, true)),
      total: this.repository.count(safeFilter),
    };
  }

  /** `GET /api/v1/categories/:id` — la categoría con sus productos activos. */
  public getById(id: number, context: CategoryRequestContext): CategoryDetailView {
    const row = this.requireCategory(id, context.actor.businessId);
    const products = this.repository
      .listActiveProductBasics(id, CATEGORY_PRODUCT_LIMIT)
      .map((raw) => this.toBasicView(raw));
    return { ...this.toView(row, true), products };
  }

  // ==========================================================================
  // Escrituras
  // ==========================================================================

  /**
   * `POST /api/v1/categories` — alta.
   *
   * El slug se valida contra las categorías VIVAS y también contra las borradas
   * (`findBySlugIncludingDeleted`): el `UNIQUE(business_id, slug)` sigue
   * incluyendo la fila borrada, así que reutilizarlo produciría un 500 de
   * restricción en lugar de un 409 con mensaje útil.
   */
  public create(input: CreateCategoryInput, context: CategoryRequestContext): CategoryView {
    const businessId = context.actor.businessId;
    const slug = this.resolveSlug(input.slug, input.name);
    this.assertSlugAvailable(slug, businessId, null);

    return runInTransactionSync(() => {
      const sortOrder = input.sortOrder ?? this.repository.maxSortOrder(businessId) + 1;
      const id = this.repository.insert({
        businessId,
        name: input.name,
        slug,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        icon: input.icon ?? null,
        sortOrder,
        isActive: input.isActive,
      });

      const after = this.requireCategory(id, businessId);
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.business,
        entityId: id,
        actor: context.actor,
        request: context.request,
        afterData: { resource: 'category', ...this.auditFields(after) },
      });
      return this.toView(after, true);
    });
  }

  /** `PATCH /api/v1/categories/:id` — edición parcial. */
  public update(
    id: number,
    input: UpdateCategoryInput,
    context: CategoryRequestContext,
  ): CategoryView {
    const businessId = context.actor.businessId;
    if (input.slug !== undefined) {
      this.assertSlugAvailable(input.slug, businessId, id);
    }

    return runInTransactionSync(() => {
      const before = this.requireCategory(id, businessId);
      const patch: CategoryPatch = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
        ...(input.icon === undefined ? {} : { icon: input.icon }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };
      this.repository.update(id, patch);
      const after = this.requireCategory(id, businessId);

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.business,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'category', ...this.auditFields(before) },
        afterData: { resource: 'category', ...this.auditFields(after) },
      });
      return this.toView(after, true);
    });
  }

  /**
   * `DELETE /api/v1/categories/:id` — baja lógica.
   *
   * Los productos se desvinculan en la MISMA transacción que el borrado: si
   * se hiciera después, un fallo intermedio dejaría productos apuntando a una
   * categoría borrada, que es exactamente el estado que `ON DELETE SET NULL`
   * evita en el borrado físico.
   */
  public remove(
    id: number,
    input: { readonly confirmOrphan: boolean; readonly reason?: string | null },
    context: CategoryRequestContext,
  ): CategoryDeleteResult {
    const businessId = context.actor.businessId;

    return runInTransactionSync(() => {
      const before = this.requireCategory(id, businessId);
      const orphanedProducts = this.repository.countProducts(id);
      if (orphanedProducts > 0 && input.confirmOrphan !== true) {
        throw new BusinessRuleError(
          `La categoría tiene ${orphanedProducts} producto(s): confirma la operación para dejarlos sin categoría`,
          {
            details: {
              code: 'CATEGORY_HAS_PRODUCTS',
              ruleId: 'BR-CATALOG-002',
              id,
              orphanedProducts,
              hint: 'Repita la petición con confirmOrphan = true',
            },
          },
        );
      }

      const deletedAt = nowIso();
      this.repository.softDelete(id, deletedAt);
      this.repository.detachProducts(id);

      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.business,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'category', ...this.auditFields(before) },
        afterData: {
          resource: 'category',
          deletedAt,
          orphanedProducts,
          reason: input.reason ?? null,
        },
      });

      return { id, deletedAt, orphanedProducts };
    });
  }

  /**
   * `POST /api/v1/categories/reorder` — reordenar el catálogo.
   *
   * Todo el lote o nada: si un id no existe o está repetido, no se cambia ninguno.
   * Un id duplicado es `400 DUPLICATE_ID` porque es un fallo de forma de la
   * petición, no un conflicto de estado.
   */
  public reorder(
    items: readonly { readonly id: number; readonly sortOrder: number }[],
    context: CategoryRequestContext,
  ): readonly CategoryView[] {
    const businessId = context.actor.businessId;
    const seen = new Set<number>();
    for (const item of items) {
      if (seen.has(item.id)) {
        throw new ValidationError('La lista de categorías contiene identificadores repetidos', {
          details: [
            {
              path: `items[${items.findIndex((candidate) => candidate.id === item.id)}].id`,
              message: 'Cada categoría puede aparecer una sola vez',
              code: 'DUPLICATE_ID',
            },
          ],
        });
      }
      seen.add(item.id);
    }

    return runInTransactionSync(() => {
      // Se comprueba la existencia de TODAS antes de tocar ninguna: un lote con
      // un id inexistente no debe haber reordenado la mitad.
      for (const item of items) {
        this.requireCategory(item.id, businessId);
      }
      const before = new Map(
        items.map((item) => [item.id, this.requireCategory(item.id, businessId)] as const),
      );
      for (const item of items) {
        this.repository.updateSortOrder(item.id, item.sortOrder);
      }

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.business,
        entityId: null,
        actor: context.actor,
        request: context.request,
        beforeData: {
          resource: 'category',
          sortOrder: items.map((item) => ({
            id: item.id,
            sortOrder: before.get(item.id)?.sort_order ?? null,
          })),
        },
        afterData: {
          resource: 'category',
          sortOrder: items.map((item) => ({ id: item.id, sortOrder: item.sortOrder })),
        },
      });

      return items.map((item) => this.toView(this.requireCategory(item.id, businessId), true));
    });
  }

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  /** Categoría obligatoria: 404 si no existe, está borrada o es de otro negocio. */
  private requireCategory(id: number, businessId: number): CategoryCountedRow {
    const row = this.repository.findById(id, businessId);
    if (row === null) {
      throw new NotFoundError('La categoría no existe', { details: { id, type: 'category' } });
    }
    return row;
  }

  /**
   * Resuelve el slug final: el del cliente si viene (ya validado por zod) o el
   * derivado del nombre. Un nombre que no produce ningún carácter válido da
   * `400 INVALID_SLUG` en vez de un slug vacío que rompería el `CHECK`.
   */
  private resolveSlug(slug: string | undefined, name: string): string {
    if (slug !== undefined) {
      return slug;
    }
    const derived = slugify(name);
    if (derived.length === 0) {
      throw new ValidationError('El nombre no permite generar un identificador (slug) válido', {
        details: [
          {
            path: 'name',
            message: 'Use un nombre con letras o números, o envíe el slug explícitamente',
            code: 'INVALID_SLUG',
          },
        ],
      });
    }
    return derived;
  }

  /**
   * El slug debe ser libre en el negocio. `excludeId` permite el propio recurso
   * cuando se edita (cambiar el nombre no debe chocar con su propio slug).
   */
  private assertSlugAvailable(slug: string, businessId: number, excludeId: number | null): void {
    const existing = this.repository.findBySlugIncludingDeleted(slug, businessId);
    if (existing !== null && existing.id !== excludeId) {
      throw new ConflictError('Ya existe una categoría con ese identificador (slug) en este negocio', {
        details: { code: 'CATEGORY_SLUG_TAKEN', field: 'slug' },
      });
    }
  }

  /** Proyecta la fila de `categories` a la vista del contrato. */
  private toView(row: CategoryCountedRow, includeCounts: boolean): CategoryView {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageUrl: row.image_url,
      icon: row.icon,
      sortOrder: row.sort_order,
      isActive: row.is_active === 1,
      productCount: includeCounts ? row.product_count : 0,
      activeProductCount: includeCounts ? row.active_product_count : 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Proyecta la fila mínima de producto al recurso `ProductBasic`. */
  private toBasicView(raw: {
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
  }): ProductBasicView {
    return {
      id: raw.id,
      sku: raw.sku,
      name: raw.name,
      imageUrl: raw.image_url,
      basePriceMinor: raw.base_price_minor,
      promoPriceMinor: raw.promo_price_minor,
      isAvailable: raw.is_available === 1,
      isFeatured: raw.is_featured === 1,
      preparationMinutes: raw.preparation_minutes,
      categoryId: raw.category_id,
    };
  }

  /** Campos de la categoría que van al audit log. */
  private auditFields(row: CategoryRow | CategoryCountedRow): Record<string, unknown> {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageUrl: row.image_url,
      icon: row.icon,
      sortOrder: row.sort_order,
      isActive: row.is_active === 1,
    };
  }
}
