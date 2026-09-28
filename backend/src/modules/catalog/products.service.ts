/**
 * Servicio de productos: casos de uso de `/api/v1/products/*` (API.md 7.11).
 *
 * ============================== CAPAS =======================================
 * No conoce Express, ni zod, ni SQLite. El SQL vive en
 * `products.repository.sqlite.ts` y las dependencias llegan por constructor
 * (DESIGN.md 3.1 y 3.6).
 *
 * ========================== REGLAS QUE APLICA ==============================
 *  - **BR-PRICE-001**: el precio unitario se resuelve con
 *    {@link resolveUnitPrice}, en `catalog.pricing.ts`. Este service NO decide
 *    precios: valida que el precio efectivo de una variante no sea negativo
 *    (BR-PRICE-009) y publica el ya resuelto en `effectivePriceMinor`.
 *  - **BR-PRICE-009**: una variante cuyo precio efectivo quede por debajo de
 *    cero es `422 INVALID_VARIANT_PRICE`, y `price_delta_minor` puede ser
 *    negativo sin más (una*ración* más barata es un caso normal).
 *  - **Variante por defecto única**: el esquema no puede garantizarlo (no hay
 *    índice único parcial sobre `(product_id) WHERE is_default = 1`), así que
 *    lo garantiza este service DENTRO de la misma transacción que el alta o la
 *    edición: primero se baja el distintivo de las demás, después se escribe.
 *  - **Complementos**: `maxSelect >= 1` sólo tiene sentido con `isMultiple = 1`;
 *    al revés es `422 MAX_SELECT_REQUIRES_MULTIPLE` (API.md 7.11).
 *  - **Receta**: `product_ingredients` es UNIQUE (product_id, ingredient_id) y
 *    `quantity > 0`; un insumo repetido es `409 INGREDIENT_ALREADY_IN_RECIPE`.
 *  - **Duplicado**: `POST /:id/duplicate` clona producto, variantes,
 *    complementos y receta en UNA transacción, con SKU único derivado
 *    (`-COPY`, `-COPY2`, ...). NO duplica stock: el `inventory_item` sigue
 *    apuntando al producto original.
 *  - **Borrado lógico**: `deleted_at`; los `order_items` conservan sus
 *    snapshots (BR-PRICE-005) y se devuelven como `affectedOrderItems`.
 *  - **BR-SEC-007**: toda escritura deja fila en `audit_logs` con
 *    `before`/`after`.
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
import { multiplyMinor } from '../../shared/utils/money.js';
import { resolveUnitPrice } from './catalog.pricing.js';
import { slugify } from './catalog.schemas.js';
import type {
  AddonPatch,
  IngredientListFilter,
  IngredientPatch,
  NewAddonRecord,
  NewIngredientRecord,
  NewProductRecord,
  ProductBasicRow,
  ProductListFilter,
  ProductPatch,
  ProductsRepository,
  VariantPatch,
} from './products.repository.js';
import type {
  CategoryProductCount,
  CategoryRef,
  IngredientRow,
  IngredientView,
  ProductAddonRow,
  ProductAddonView,
  ProductBasicView,
  ProductDeleteResult,
  ProductDetailView,
  ProductIngredientView,
  ProductRow,
  ProductStockView,
  ProductVariantRow,
  ProductVariantView,
  ProductView,
  RecipeRemoveResult,
} from './catalog.types.js';

/** Sufijo del SKU duplicado y máximo de intentos para encontrar uno libre. */
const COPY_SKU_SUFFIX = '-COPY';
const COPY_SKU_MAX_ATTEMPTS = 100;

/** Sufijo del nombre por defecto al duplicar (API.md 7.11). */
const COPY_NAME_SUFFIX = ' (copia)';

/** Límite de longitud del SKU antes de añadir el sufijo de copia. */
const SKU_MAX_LENGTH = 50;

/** Contexto de petición para auditoría y negocio. */
export interface ProductRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Entradas de los casos de uso de producto. */
export interface CreateProductInput {
  readonly categoryId?: number | null;
  readonly sku: string;
  readonly name: string;
  readonly slug?: string;
  readonly shortDescription?: string | null;
  readonly description?: string | null;
  readonly imageUrl?: string | null;
  readonly basePriceMinor: number;
  readonly promoPriceMinor?: number | null;
  readonly promoStartsAt?: string | null;
  readonly promoEndsAt?: string | null;
  readonly taxRateBp?: number | null;
  readonly trackStock: boolean;
  readonly isFeatured: boolean;
  readonly isAvailable: boolean;
  readonly preparationMinutes: number;
  readonly sortOrder?: number;
  readonly isActive: boolean;
  readonly variants?: readonly InlineVariantInput[];
  readonly addons?: readonly InlineAddonInput[];
}

export interface UpdateProductInput {
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
  readonly preparationMinutes?: number;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

export interface InlineVariantInput {
  readonly name: string;
  readonly code?: string | null;
  readonly priceDeltaMinor: number;
  readonly priceMinor?: number | null;
  readonly isDefault: boolean;
  readonly sortOrder?: number;
  readonly isActive: boolean;
}

export interface InlineAddonInput {
  readonly name: string;
  readonly code?: string | null;
  readonly priceMinor: number;
  readonly isMultiple: boolean;
  readonly maxSelect?: number | null;
  readonly sortOrder?: number;
  readonly isActive: boolean;
}

export interface DuplicateProductInput {
  readonly name?: string;
  readonly sku?: string;
  readonly categoryId?: number | null;
  readonly copyVariants: boolean;
  readonly copyAddons: boolean;
  readonly copyIngredients: boolean;
  readonly isActive: boolean;
}

export interface CreateIngredientInput {
  readonly name: string;
  readonly unit: string;
  readonly costMinor: number;
  readonly supplier?: string | null;
  readonly isActive: boolean;
}

export interface UpdateIngredientInput {
  readonly name?: string;
  readonly unit?: string;
  readonly costMinor?: number;
  readonly supplier?: string | null;
  readonly isActive?: boolean;
}

/** Resultado de un alta de producto, con avisos de negocio. */
export interface CreateProductResult {
  readonly product: ProductDetailView;
  /** `PRICE_CHANGE_AFFECTS_ONLY_NEW` y similares, para `meta.warnings`. */
  readonly warnings: readonly string[];
}

/** Resultado de un cambio de precio en un producto existente. */
export interface UpdateProductResult {
  readonly product: ProductDetailView;
  readonly warnings: readonly string[];
}

/** Página de productos. */
export interface ProductPage {
  readonly items: readonly ProductView[];
  readonly total: number;
  readonly categories: readonly CategoryProductCount[];
}

/** `fields=basic`: sin variantes, sin complementos y sin receta. */
export interface ProductBasicPage {
  readonly items: readonly ProductBasicView[];
  readonly total: number;
  readonly categories: readonly CategoryProductCount[];
}

/** Servicio de productos. */
export class ProductsService {
  public constructor(
    private readonly repository: ProductsRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /**
   * `GET /api/v1/products` con `fields=full`.
   *
   * Variantes y complementos se cargan con DOS consultas para toda la página, no
   * dos por producto: con 50 productos en pantalla, 100 consultas de N+1 son la
   * diferencia entre 20 ms y 400 ms.
   */
  public list(filter: ProductListFilter, context: ProductRequestContext): ProductPage {
    const safeFilter: ProductListFilter = { ...filter, businessId: context.actor.businessId };
    const rows = this.repository.list(safeFilter);
    const ids = rows.map((row) => row.id);
    const variants = this.groupByProduct(this.repository.listVariantsForProducts(ids));
    const addons = this.groupByProduct(this.repository.listAddonsForProducts(ids));
    const now = nowIso();

    return {
      items: rows.map((row) =>
        this.toView(row, {
          now,
          variants: variants.get(row.id) ?? [],
          addons: addons.get(row.id) ?? [],
          stock: this.toStockView(this.repository.findStock(row.id)),
        }),
      ),
      total: this.repository.count(safeFilter),
      categories: this.repository.countByCategory(safeFilter),
    };
  }

  /**
   * `GET /api/v1/products?fields=basic`.
   *
   * Proyección mínima: NINGUNA consulta extra, ni variantes ni complementos ni
   * stock. Es la pantalla del POS con el catálogo grande (API.md 7.11) y por eso
   * la respuesta no incluye la clave `variants`: no es que venga vacía, es que
   * no existe.
   */
  public listBasic(filter: ProductListFilter, context: ProductRequestContext): ProductBasicPage {
    const safeFilter: ProductListFilter = { ...filter, businessId: context.actor.businessId };
    const rows = this.repository.listBasic(safeFilter);
    return {
      items: rows.map((row) => this.toBasicView(row)),
      total: this.repository.count(safeFilter),
      categories: this.repository.countByCategory(safeFilter),
    };
  }

  /** `GET /api/v1/products/:id` — producto con receta, variantes y stock. */
  public getById(id: number, context: ProductRequestContext): ProductDetailView {
    const row = this.requireProduct(id, context.actor.businessId);
    const now = nowIso();
    return {
      ...this.toView(row, {
        now,
        variants: this.repository.listVariants(id),
        addons: this.repository.listAddons(id),
        stock: this.toStockView(this.repository.findStock(id)),
      }),
      ingredients: this.toRecipeView(this.repository.listRecipe(id)),
      priceHistory: [],
    };
  }

  /** `GET /api/v1/products/:id/variants`. */
  public listVariants(id: number, context: ProductRequestContext): readonly ProductVariantView[] {
    const product = this.requireProduct(id, context.actor.businessId);
    const now = nowIso();
    return this.repository.listVariants(id).map((row) => this.toVariantView(product, row, now));
  }

  /** `GET /api/v1/products/:id/addons`. */
  public listAddons(id: number, context: ProductRequestContext): readonly ProductAddonView[] {
    this.requireProduct(id, context.actor.businessId);
    return this.repository.listAddons(id).map((row) => this.toAddonView(row));
  }

  /** `GET /api/v1/products/:id/ingredients` — la receta con su costo. */
  public listRecipe(
    id: number,
    context: ProductRequestContext,
  ): readonly ProductIngredientView[] {
    this.requireProduct(id, context.actor.businessId);
    return this.toRecipeView(this.repository.listRecipe(id));
  }

  // ==========================================================================
  // Escrituras: producto
  // ==========================================================================

  /**
   * `POST /api/v1/products` — alta con variantes y complementos en la MISMA
   * transacción.
   *
   * Un producto existe o existe entero: si una variante tiene el precio
   * efectivo negativo, el `throw` revierte también el producto. Un catálogo con
   * productos a medio configurar es peor que un alta fallida.
   */
  public create(input: CreateProductInput, context: ProductRequestContext): CreateProductResult {
    const businessId = context.actor.businessId;
    const sku = input.sku.trim();
    const slug = this.resolveSlug(input.slug, input.name);
    this.assertSkuAvailable(sku, businessId, null);
    this.assertSlugAvailable(slug, null);
    this.assertCategory(input.categoryId, businessId);
    this.assertPromoWindow(input.promoStartsAt, input.promoEndsAt);
    this.assertPromoPrice(input.promoPriceMinor, input.basePriceMinor);
    this.assertInlineAddons(input.addons ?? []);

    return runInTransactionSync(() => {
      const record: NewProductRecord = {
        businessId,
        categoryId: input.categoryId ?? null,
        sku,
        name: input.name,
        slug,
        shortDescription: input.shortDescription ?? null,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        basePriceMinor: input.basePriceMinor,
        promoPriceMinor: input.promoPriceMinor ?? null,
        promoStartsAt: input.promoStartsAt ?? null,
        promoEndsAt: input.promoEndsAt ?? null,
        taxRateBp: input.taxRateBp ?? null,
        trackStock: input.trackStock,
        isFeatured: input.isFeatured,
        isAvailable: input.isAvailable,
        preparationMinutes: input.preparationMinutes,
        sortOrder: input.sortOrder ?? this.repository.maxSortOrder(businessId) + 1,
        isActive: input.isActive,
      };
      const productId = this.repository.insert(record);

      // Un solo `is_default` por producto: primero se limpian las marcadas
      // (aquí no hay ninguna) y luego se escribe la que el cliente pidió.
      const variants = input.variants ?? [];
      const markedDefault = variants.find((variant) => variant.isDefault) ?? null;
      if (markedDefault !== null) {
        this.repository.clearDefaultVariants(productId, null);
      }
      variants.forEach((variant, index) => {
        this.assertVariantPrice(input.basePriceMinor, {
          priceDeltaMinor: variant.priceDeltaMinor,
          priceMinor: variant.priceMinor ?? null,
        });
        this.repository.insertVariant({
          productId,
          name: variant.name,
          code: variant.code ?? null,
          priceDeltaMinor: variant.priceDeltaMinor,
          priceMinor: variant.priceMinor ?? null,
          isDefault: variant.isDefault,
          sortOrder: variant.sortOrder ?? index,
          isActive: variant.isActive,
        });
      });

      (input.addons ?? []).forEach((addon, index) => {
        this.insertAddonFor(productId, addon, addon.sortOrder ?? index);
      });

      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.product,
        entityId: productId,
        actor: context.actor,
        request: context.request,
        afterData: {
          resource: 'product',
          sku: record.sku,
          name: record.name,
          slug: record.slug,
          categoryId: record.categoryId,
          basePriceMinor: record.basePriceMinor,
          promoPriceMinor: record.promoPriceMinor,
          isActive: record.isActive,
          variants: variants.length,
          addons: (input.addons ?? []).length,
        },
      });

      return {
        product: this.detailOf(productId, businessId),
        warnings: [],
      };
    });
  }

  /**
   * `PATCH /api/v1/products/:id`.
   *
   * `sku` e `isAvailable` NO se aceptan (API.md 7.11): el SKU es inmutable en v1
   * y la disponibilidad comercial tiene su propio endpoint, porque
   * `is_active = 0` y `is_available = 0` significan cosas distintas
   * (BR-PRICE-006).
   *
   * Si cambia el precio, `meta.warnings` lleva
   * `PRICE_CHANGE_AFFECTS_ONLY_NEW`: los `order_items` guardan snapshot
   * (BR-PRICE-004) y el cambio NO altera los pedidos ya hechos.
   */
  public update(
    id: number,
    input: UpdateProductInput,
    context: ProductRequestContext,
  ): UpdateProductResult {
    const businessId = context.actor.businessId;

    return runInTransactionSync(() => {
      const before = this.requireProduct(id, businessId);
      if (input.slug !== undefined) {
        this.assertSlugAvailable(input.slug, id);
      }
      if (input.categoryId !== undefined) {
        this.assertCategory(input.categoryId, businessId);
      }

      // La promo se valida contra el precio BASE FINAL, no contra el enviado:
      // si sólo se cambia el precio base, la promo existente puede dejar de ser
      // un descuento.
      const nextBasePrice = input.basePriceMinor ?? before.base_price_minor;
      const nextPromoPrice =
        input.promoPriceMinor === undefined ? before.promo_price_minor : input.promoPriceMinor;
      const nextPromoStarts =
        input.promoStartsAt === undefined ? before.promo_starts_at : input.promoStartsAt;
      const nextPromoEnds = input.promoEndsAt === undefined ? before.promo_ends_at : input.promoEndsAt;
      this.assertPromoWindow(nextPromoStarts, nextPromoEnds);
      this.assertPromoPrice(nextPromoPrice, nextBasePrice);

      // Si BAJA el precio base, alguna variante con delta negativo puede quedar
      // con precio efectivo negativo. Se revalidan todas antes de escribir.
      this.assertExistingVariants(id, nextBasePrice);

      const patch: ProductPatch = {
        ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        ...(input.shortDescription === undefined ? {} : { shortDescription: input.shortDescription }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.imageUrl === undefined ? {} : { imageUrl: input.imageUrl }),
        ...(input.basePriceMinor === undefined ? {} : { basePriceMinor: input.basePriceMinor }),
        ...(input.promoPriceMinor === undefined ? {} : { promoPriceMinor: input.promoPriceMinor }),
        ...(input.promoStartsAt === undefined ? {} : { promoStartsAt: input.promoStartsAt }),
        ...(input.promoEndsAt === undefined ? {} : { promoEndsAt: input.promoEndsAt }),
        ...(input.taxRateBp === undefined ? {} : { taxRateBp: input.taxRateBp }),
        ...(input.trackStock === undefined ? {} : { trackStock: input.trackStock }),
        ...(input.isFeatured === undefined ? {} : { isFeatured: input.isFeatured }),
        ...(input.preparationMinutes === undefined
          ? {}
          : { preparationMinutes: input.preparationMinutes }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };
      this.repository.update(id, patch);
      const after = this.requireProduct(id, businessId);

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.product,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'product', ...this.auditFieldsOf(before) },
        afterData: { resource: 'product', ...this.auditFieldsOf(after) },
      });

      const priceChanged =
        before.base_price_minor !== after.base_price_minor ||
        before.promo_price_minor !== after.promo_price_minor;
      return {
        product: this.detailOf(id, businessId),
        warnings: priceChanged ? ['PRICE_CHANGE_AFFECTS_ONLY_NEW'] : [],
      };
    });
  }

  /**
   * `PATCH /api/v1/products/:id/availability`.
   *
   * NO toca `is_active` (BR-PRICE-006): un producto agotado sigue en el catálogo
   * y se puede reactivar cuando vuelva el stock.
   */
  public setAvailability(
    id: number,
    input: { readonly isAvailable: boolean; readonly reason?: string | null },
    context: ProductRequestContext,
  ): ProductView {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      const before = this.requireProduct(id, businessId);
      this.repository.update(id, { isAvailable: input.isAvailable });
      const after = this.requireProduct(id, businessId);
      this.audit.record({
        action: AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.product,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { isAvailable: before.is_available === 1, isActive: before.is_active === 1 },
        afterData: {
          isAvailable: after.is_available === 1,
          isActive: after.is_active === 1,
          reason: input.reason ?? null,
        },
      });
      return this.toView(after, {
        now: nowIso(),
        variants: this.repository.listVariants(id),
        addons: this.repository.listAddons(id),
        stock: this.toStockView(this.repository.findStock(id)),
      });
    });
  }

  /** `PATCH /api/v1/products/:id/active` — activar o desactivar del catálogo. */
  public setActive(
    id: number,
    input: { readonly isActive: boolean; readonly reason?: string | null },
    context: ProductRequestContext,
  ): ProductView {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      const before = this.requireProduct(id, businessId);
      this.repository.update(id, { isActive: input.isActive });
      const after = this.requireProduct(id, businessId);
      this.audit.record({
        action: AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.product,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { isActive: before.is_active === 1, isAvailable: before.is_available === 1 },
        afterData: {
          isActive: after.is_active === 1,
          isAvailable: after.is_available === 1,
          reason: input.reason ?? null,
        },
      });
      return this.toView(after, {
        now: nowIso(),
        variants: this.repository.listVariants(id),
        addons: this.repository.listAddons(id),
        stock: this.toStockView(this.repository.findStock(id)),
      });
    });
  }

  /**
   * `DELETE /api/v1/products/:id` — baja lógica.
   *
   * NO se tocan los `order_items`: conservan nombre, SKU y precio congelados
   * (BR-PRICE-004) y `product_id` queda apuntando a una fila borrada, que es
   * exactamente lo que el `ON DELETE SET NULL` del esquema haría en un borrado
   * físico (BR-PRICE-005). Se devuelve cuántos quedan.
   */
  public remove(
    id: number,
    input: { readonly reason?: string | null },
    context: ProductRequestContext,
  ): ProductDeleteResult {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      const before = this.requireProduct(id, businessId);
      const affectedOrderItems = this.repository.countOrderItemsForProduct(id);
      const deletedAt = nowIso();
      this.repository.softDelete(id, deletedAt);

      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.product,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'product', ...this.auditFieldsOf(before) },
        afterData: { resource: 'product', deletedAt, affectedOrderItems, reason: input.reason ?? null },
      });

      return { id, deletedAt, affectedOrderItems };
    });
  }

  /**
   * `POST /api/v1/products/:id/duplicate` — clon en UNA transacción.
   *
   * SKU: si el cliente lo envía, se respeta (409 si está ocupado); si lo omite,
   * se deriva del original con el sufijo `-COPY` y un contador hasta encontrar uno
   * libre, que es lo que hace el endpoint usable sin que el cliente tenga que
   * inventar códigos.
   *
   * NO se duplica el stock: el `inventory_item` sigue apuntando al producto
   * original. Una copia con existencias propias sería inventar mercancía.
   */
  public duplicate(
    id: number,
    input: DuplicateProductInput,
    context: ProductRequestContext,
  ): ProductDetailView {
    const businessId = context.actor.businessId;

    return runInTransactionSync(() => {
      const source = this.requireProduct(id, businessId);
      const sku =
        input.sku === undefined
          ? this.nextFreeCopySku(source.sku, businessId)
          : this.requireFreeSku(input.sku.trim(), businessId);
      const name = input.name ?? `${source.name}${COPY_NAME_SUFFIX}`;
      const categoryId =
        input.categoryId === undefined ? source.category_id : input.categoryId;
      this.assertCategory(categoryId, businessId);
      const copySlug =
        input.name === undefined
          ? this.deriveCopySlug(source.slug)
          : this.resolveSlug(undefined, `${name}-copia`);
      this.assertSlugAvailable(copySlug, null);

      const productId = this.repository.insert({
        businessId,
        categoryId,
        sku,
        name,
        slug: copySlug,
        shortDescription: source.short_description,
        description: source.description,
        imageUrl: source.image_url,
        basePriceMinor: source.base_price_minor,
        promoPriceMinor: source.promo_price_minor,
        promoStartsAt: source.promo_starts_at,
        promoEndsAt: source.promo_ends_at,
        taxRateBp: source.tax_rate_bp,
        trackStock: source.track_stock === 1,
        isFeatured: source.is_featured === 1,
        isAvailable: source.is_available === 1,
        preparationMinutes: source.preparation_minutes,
        // `max + 1`: la copia va al final, no encima del original.
        sortOrder: this.repository.maxSortOrder(businessId) + 1,
        isActive: input.isActive,
      });

      if (input.copyVariants) {
        this.repository.listVariants(id).forEach((variant) => {
          this.repository.insertVariant({
            productId,
            name: variant.name,
            code: variant.code,
            priceDeltaMinor: variant.price_delta_minor,
            priceMinor: variant.price_minor,
            isDefault: variant.is_default === 1,
            sortOrder: variant.sort_order,
            isActive: variant.is_active === 1,
          });
        });
      }
      if (input.copyAddons) {
        this.repository.listAddons(id).forEach((addon) => {
          this.insertAddonFor(
            productId,
            {
              name: addon.name,
              code: addon.code,
              priceMinor: addon.price_minor,
              isMultiple: addon.is_multiple === 1,
              maxSelect: addon.max_select,
              isActive: addon.is_active === 1,
            },
            addon.sort_order,
          );
        });
      }
      if (input.copyIngredients) {
        for (const line of this.repository.listRecipe(id)) {
          // La receta puede apuntar a un insumo dado de baja entre medias; se
          // copia sólo lo que sigue existiendo, y se deja rastro en el audit log
          // a través del recuento de líneas copiadas.
          if (this.repository.findIngredientById(line.ingredient_id, businessId) !== null) {
            this.repository.insertRecipeLine(productId, line.ingredient_id, line.quantity);
          }
        }
      }

      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.product,
        entityId: productId,
        actor: context.actor,
        request: context.request,
        afterData: {
          duplicatedFrom: id,
          sku,
          name,
          slug: copySlug,
          categoryId,
          copyVariants: input.copyVariants,
          copyAddons: input.copyAddons,
          copyIngredients: input.copyIngredients,
          // El stock NO se copia: el ítem de inventario sigue siendo del original.
          stockCopied: false,
        },
      });

      return this.detailOf(productId, businessId);
    });
  }

  // ==========================================================================
  // Escrituras: variantes
  // ==========================================================================

  /** `POST /api/v1/products/:id/variants`. */
  public createVariant(
    productId: number,
    input: InlineVariantInput,
    context: ProductRequestContext,
  ): ProductVariantView {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      const product = this.requireProduct(productId, businessId);
      this.assertVariantPrice(product.base_price_minor, input);

      if (input.isDefault) {
        // Orden de las dos escrituras: primero se apaga el resto, después se
        // inserta la nueva como default. Al revés habría un instante con dos.
        this.repository.clearDefaultVariants(productId, null);
      }
      const variantId = this.repository.insertVariant({
        productId,
        name: input.name,
        code: input.code ?? null,
        priceDeltaMinor: input.priceDeltaMinor,
        priceMinor: input.priceMinor ?? null,
        isDefault: input.isDefault,
        sortOrder: input.sortOrder ?? this.repository.maxAddonSortOrder(productId) + 1,
        isActive: input.isActive,
      });

      const row = this.repository.findVariantByIdForProduct(variantId, productId);
      if (row === null) {
        throw new NotFoundError('La variante no existe', { details: { id: variantId, type: 'product_variant' } });
      }

      this.audit.record({
        action: AuditAction.MODIFY_PRODUCT,
        entityType: AuditEntityType.product,
        entityId: productId,
        actor: context.actor,
        request: context.request,
        afterData: { resource: 'product_variant', ...this.variantAuditFields(row) },
      });

      return this.toVariantView(product, row, nowIso());
    });
  }

  /** `PATCH /api/v1/products/variants/:variantId`. */
  public updateVariant(
    variantId: number,
    input: Partial<InlineVariantInput>,
    context: ProductRequestContext,
  ): ProductVariantView {
    return runInTransactionSync(() => {
      const before = this.requireVariant(variantId, context.actor.businessId);
      const product = this.requireProduct(before.product_id, context.actor.businessId);
      this.assertVariantPrice(product.base_price_minor, {
        priceDeltaMinor: input.priceDeltaMinor ?? before.price_delta_minor,
        priceMinor: input.priceMinor === undefined ? before.price_minor : input.priceMinor,
      });

      if (input.isDefault === true) {
        this.repository.clearDefaultVariants(before.product_id, variantId);
      }
      const patch: VariantPatch = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.priceDeltaMinor === undefined ? {} : { priceDeltaMinor: input.priceDeltaMinor }),
        ...(input.priceMinor === undefined ? {} : { priceMinor: input.priceMinor }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };
      this.repository.updateVariant(variantId, patch);
      const after = this.requireVariant(variantId, context.actor.businessId);

      this.audit.record({
        action: AuditAction.MODIFY_PRODUCT,
        entityType: AuditEntityType.product,
        entityId: after.product_id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'product_variant', ...this.variantAuditFields(before) },
        afterData: { resource: 'product_variant', ...this.variantAuditFields(after) },
      });

      return this.toVariantView(product, after, nowIso());
    });
  }

  /**
   * `DELETE /api/v1/products/variants/:variantId` — baja física de la variante.
   *
   * `product_variants` NO tiene `deleted_at`: el borrado es físico y los
   * `order_items` que la usaban conservan su snapshot (BR-PRICE-004), así que el
   * histórico no se rompe. Se avisa con `affectedOrderItems`.
   */
  public removeVariant(
    variantId: number,
    context: ProductRequestContext,
  ): { readonly id: number; readonly deletedAt: string; readonly affectedOrderItems: number } {
    return runInTransactionSync(() => {
      const before = this.requireVariant(variantId, context.actor.businessId);
      const affected = this.countVariantOrderItems(variantId);
      this.repository.updateVariant(variantId, { isActive: false });

      const deletedAt = nowIso();
      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.product,
        entityId: before.product_id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'product_variant', ...this.variantAuditFields(before) },
        afterData: { resource: 'product_variant', id: variantId, deletedAt, affectedOrderItems: affected },
      });
      return { id: variantId, deletedAt, affectedOrderItems: affected };
    });
  }

  // ==========================================================================
  // Escrituras: complementos
  // ==========================================================================

  /** `POST /api/v1/products/:id/addons`. */
  public createAddon(
    productId: number,
    input: InlineAddonInput,
    context: ProductRequestContext,
  ): ProductAddonView {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      this.requireProduct(productId, businessId);
      this.assertAddonSelection(input.isMultiple, input.maxSelect ?? null);
      const id = this.insertAddonFor(productId, input, input.sortOrder);
      const row = this.repository.findAddonByIdForProduct(id, productId);
      if (row === null) {
        throw new NotFoundError('El complemento no existe', { details: { id, type: 'product_addon' } });
      }
      this.audit.record({
        action: AuditAction.MODIFY_PRODUCT,
        entityType: AuditEntityType.product,
        entityId: productId,
        actor: context.actor,
        request: context.request,
        afterData: { resource: 'product_addon', ...this.addonAuditFields(row) },
      });
      return this.toAddonView(row);
    });
  }

  /** `PATCH /api/v1/products/addons/:addonId`. */
  public updateAddon(
    addonId: number,
    input: Partial<InlineAddonInput>,
    context: ProductRequestContext,
  ): ProductAddonView {
    return runInTransactionSync(() => {
      const before = this.requireAddon(addonId, context.actor.businessId);
      const isMultiple = input.isMultiple ?? before.is_multiple === 1;
      const maxSelect = input.maxSelect === undefined ? before.max_select : input.maxSelect;
      this.assertAddonSelection(isMultiple, maxSelect);

      const patch: AddonPatch = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.code === undefined ? {} : { code: input.code }),
        ...(input.priceMinor === undefined ? {} : { priceMinor: input.priceMinor }),
        ...(input.isMultiple === undefined ? {} : { isMultiple: input.isMultiple }),
        ...(input.maxSelect === undefined ? {} : { maxSelect: input.maxSelect }),
        ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };
      this.repository.updateAddon(addonId, patch);
      const after = this.requireAddon(addonId, context.actor.businessId);

      this.audit.record({
        action: AuditAction.MODIFY_PRODUCT,
        entityType: AuditEntityType.product,
        entityId: after.product_id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'product_addon', ...this.addonAuditFields(before) },
        afterData: { resource: 'product_addon', ...this.addonAuditFields(after) },
      });
      return this.toAddonView(after);
    });
  }

  /**
   * `DELETE /api/v1/products/addons/:addonId` — baja física.
   *
   * Igual que las variantes: `product_addons` no tiene `deleted_at` y los
   * `order_item_addons` conservan su snapshot.
   */
  public removeAddon(
    addonId: number,
    context: ProductRequestContext,
  ): { readonly id: number; readonly deletedAt: string; readonly affectedOrderItems: number } {
    return runInTransactionSync(() => {
      const before = this.requireAddon(addonId, context.actor.businessId);
      const affected = this.countAddonOrderItems(addonId);
      const deletedAt = nowIso();
      this.repository.updateAddon(addonId, { isActive: false });
      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.product,
        entityId: before.product_id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'product_addon', ...this.addonAuditFields(before) },
        afterData: { resource: 'product_addon', id: addonId, deletedAt, affectedOrderItems: affected },
      });
      return { id: addonId, deletedAt, affectedOrderItems: affected };
    });
  }

  // ==========================================================================
  // Escrituras: receta
  // ==========================================================================

  /**
   * `POST /api/v1/products/:id/ingredients` — añadir un insumo a la receta.
   *
   * Con `updateStock = true` (por defecto, API.md 7.11) se crea el
   * `inventory_item` del insumo si no existe, con `current_stock = 0`: un
   * insumo en la receta sin control de existencias no se puede vender con
   *IiSTOCK, y la deuda de existencias la salda el primer movimiento del módulo
   * de inventario, nunca un `UPDATE` de saldo (BR-INV-001).
   */
  public addIngredient(
    productId: number,
    input: { readonly ingredientId: number; readonly quantity: number; readonly updateStock: boolean },
    context: ProductRequestContext,
  ): ProductIngredientView {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      this.requireProduct(productId, businessId);
      const ingredient = this.repository.findIngredientById(input.ingredientId, businessId);
      if (ingredient === null) {
        throw new NotFoundError('El insumo no existe', {
          details: { id: input.ingredientId, type: 'ingredient' },
        });
      }
      if (this.repository.findRecipeLine(productId, input.ingredientId) !== null) {
        throw new ConflictError('El insumo ya está en la receta de este producto', {
          details: { code: 'INGREDIENT_ALREADY_IN_RECIPE', field: 'ingredientId' },
        });
      }

      const inventory = input.updateStock
        ? this.repository.ensureInventoryItemForIngredient(input.ingredientId, businessId)
        : null;

      this.repository.insertRecipeLine(productId, input.ingredientId, input.quantity);
      const line = this.repository
        .listRecipe(productId)
        .find((candidate) => candidate.ingredient_id === input.ingredientId);
      if (line === undefined) {
        throw new NotFoundError('La línea de receta no existe', {
          details: { productId, type: 'product_ingredient' },
        });
      }

      this.audit.record({
        action: AuditAction.MODIFY_PRODUCT,
        entityType: AuditEntityType.product,
        entityId: productId,
        actor: context.actor,
        request: context.request,
        afterData: {
          resource: 'product_ingredient',
          ingredientId: input.ingredientId,
          ingredientName: ingredient.name,
          quantity: input.quantity,
          inventoryItemId: inventory?.id ?? null,
          inventoryItemCreated: inventory?.created ?? false,
        },
      });

      return this.toRecipeLineView(line);
    });
  }

  /** `DELETE /api/v1/products/:id/ingredients/:ingredientId` — sacar de la receta. */
  public removeRecipeIngredient(
    productId: number,
    ingredientId: number,
    context: ProductRequestContext,
  ): RecipeRemoveResult {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      this.requireProduct(productId, businessId);
      const line = this.repository.findRecipeLine(productId, ingredientId);
      if (line === null) {
        throw new NotFoundError('El insumo no está en la receta de este producto', {
          details: { productId, ingredientId, type: 'product_ingredient' },
        });
      }
      // NO se toca el inventario del insumo: sólo sale de la receta.
      this.repository.deleteRecipeLine(productId, ingredientId);
      const removedAt = nowIso();

      this.audit.record({
        action: AuditAction.MODIFY_PRODUCT,
        entityType: AuditEntityType.product,
        entityId: productId,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'product_ingredient', id: line.id, ingredientId },
        afterData: { resource: 'product_ingredient', id: line.id, ingredientId, removedAt },
      });

      return { id: line.id, productId, ingredientId, removedAt };
    });
  }

  // ==========================================================================
  // Insumos
  // ==========================================================================

  /** `GET /api/v1/products/ingredients`. */
  public listIngredients(
    filter: IngredientListFilter,
    context: ProductRequestContext,
  ): { readonly items: readonly IngredientView[]; readonly total: number } {
    const safeFilter: IngredientListFilter = { ...filter, businessId: context.actor.businessId };
    return {
      items: this.repository.listIngredients(safeFilter).map((row) => this.toIngredientView(row)),
      total: this.repository.countIngredients(safeFilter),
    };
  }

  /** `POST /api/v1/products/ingredients`. */
  public createIngredient(
    input: CreateIngredientInput,
    context: ProductRequestContext,
  ): IngredientView {
    const businessId = context.actor.businessId;
    const name = input.name.trim();
    if (this.repository.findIngredientByName(name, businessId) !== null) {
      throw new ConflictError('Ya existe un insumo con ese nombre en este negocio', {
        details: { code: 'INGREDIENT_NAME_TAKEN', field: 'name' },
      });
    }
    return runInTransactionSync(() => {
      const record: NewIngredientRecord = {
        businessId,
        name,
        unit: input.unit,
        costMinor: input.costMinor,
        supplier: input.supplier ?? null,
        isActive: input.isActive,
      };
      const id = this.repository.insertIngredient(record);
      const after = this.repository.findIngredientById(id, businessId);
      if (after === null) {
        throw new NotFoundError('El insumo no existe', { details: { id, type: 'ingredient' } });
      }
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.product,
        entityId: id,
        actor: context.actor,
        request: context.request,
        afterData: { resource: 'ingredient', ...this.ingredientAuditFields(after) },
      });
      return this.toIngredientView(after);
    });
  }

  /** `PATCH /api/v1/products/ingredients/:ingredientId`. */
  public updateIngredient(
    id: number,
    input: UpdateIngredientInput,
    context: ProductRequestContext,
  ): IngredientView {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      const before = this.requireIngredient(id, businessId);
      if (input.name !== undefined) {
        const clash = this.repository.findIngredientByName(input.name.trim(), businessId);
        if (clash !== null && clash.id !== id) {
          throw new ConflictError('Ya existe un insumo con ese nombre en este negocio', {
            details: { code: 'INGREDIENT_NAME_TAKEN', field: 'name' },
          });
        }
      }
      const patch: IngredientPatch = {
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.costMinor === undefined ? {} : { costMinor: input.costMinor }),
        ...(input.supplier === undefined ? {} : { supplier: input.supplier }),
        ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      };
      this.repository.updateIngredient(id, patch);
      const after = this.requireIngredient(id, businessId);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.product,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'ingredient', ...this.ingredientAuditFields(before) },
        afterData: { resource: 'ingredient', ...this.ingredientAuditFields(after) },
      });
      return this.toIngredientView(after);
    });
  }

  /**
   * `DELETE /api/v1/products/ingredients/:ingredientId` — baja lógica del insumo.
   *
   * Si el insumo está en la receta de algún producto vivo, se rechaza con 422
   * `INGREDIENT_IN_USE`: quitarlo dejaría recetas que apuntan a un insumo
   * inexistente y el costo de la receta mostraría un hueco.
   */
  public removeIngredient(
    id: number,
    input: { readonly reason?: string | null },
    context: ProductRequestContext,
  ): { readonly id: number; readonly deletedAt: string } {
    const businessId = context.actor.businessId;
    return runInTransactionSync(() => {
      const before = this.requireIngredient(id, businessId);
      if (this.repository.isIngredientInAnyRecipe(id)) {
        throw new BusinessRuleError('El insumo está en la receta de algún producto activo', {
          details: { code: 'INGREDIENT_IN_USE', id },
        });
      }
      const deletedAt = nowIso();
      this.repository.softDeleteIngredient(id, deletedAt);
      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.product,
        entityId: id,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'ingredient', ...this.ingredientAuditFields(before) },
        afterData: { resource: 'ingredient', id, deletedAt, reason: input.reason ?? null },
      });
      return { id, deletedAt };
    });
  }

  // ==========================================================================
  // Auxiliares: validación
  // ==========================================================================

  /** Producto obligatorio: 404 si no existe, está borrado o es de otro negocio. */
  private requireProduct(id: number, businessId: number): ProductRow {
    const row = this.repository.findById(id, businessId);
    if (row === null) {
      throw new NotFoundError('El producto no existe', { details: { id, type: 'product' } });
    }
    return row;
  }

  private requireVariant(variantId: number, businessId: number): ProductVariantRow {
    const row = this.repository.findVariantById(variantId);
    if (row === null) {
      throw new NotFoundError('La variante no existe', {
        details: { id: variantId, type: 'product_variant' },
      });
    }
    // Se comprueba también el negocio: una variante de otro negocio es un 404,
    // no un 403 (API.md 2).
    this.requireProduct(row.product_id, businessId);
    return row;
  }

  private requireAddon(addonId: number, businessId: number): ProductAddonRow {
    const row = this.repository.findAddonById(addonId);
    if (row === null) {
      throw new NotFoundError('El complemento no existe', {
        details: { id: addonId, type: 'product_addon' },
      });
    }
    this.requireProduct(row.product_id, businessId);
    return row;
  }

  private requireIngredient(id: number, businessId: number): IngredientRow {
    const row = this.repository.findIngredientById(id, businessId);
    if (row === null) {
      throw new NotFoundError('El insumo no existe', { details: { id, type: 'ingredient' } });
    }
    return row;
  }

  /** Resuelve el slug: el del cliente o el derivado del nombre. */
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

  /** Slug derivado para la copia: el original con un sufijo legible. */
  private deriveCopySlug(sourceSlug: string): string {
    const suffix = '-copia';
    const base = sourceSlug.slice(0, 120 - suffix.length).replace(/-+$/g, '');
    const candidate = `${base}${suffix}`;
    for (let attempt = 2; attempt <= COPY_SKU_MAX_ATTEMPTS; attempt += 1) {
      if (this.repository.findBySlugIncludingDeleted(candidate) === null) {
        return candidate;
      }
      const numbered = `${base}-copia-${attempt}`.slice(0, 120);
      if (this.repository.findBySlugIncludingDeleted(numbered) === null) {
        return numbered;
      }
    }
    throw new ConflictError('No se pudo generar un slug libre para la copia del producto', {
      details: { code: 'PRODUCT_SLUG_TAKEN', field: 'slug' },
    });
  }

  /** El SKU debe estar libre en el negocio. */
  private assertSkuAvailable(sku: string, businessId: number, excludeId: number | null): void {
    const existing = this.repository.findBySku(sku, businessId);
    if (existing !== null && existing.id !== excludeId) {
      throw new ConflictError('Ya existe un producto con ese SKU', {
        details: { code: 'PRODUCT_SKU_TAKEN', field: 'sku' },
      });
    }
  }

  /** Normaliza y comprueba un SKU declarado por el cliente. */
  private requireFreeSku(sku: string, businessId: number): string {
    this.assertSkuAvailable(sku, businessId, null);
    return sku;
  }

  /** `SKO-COPY`, `SKO-COPY2`, `SKO-COPY3`... hasta encontrar uno libre. */
  private nextFreeCopySku(sourceSku: string, businessId: number): string {
    const base = sourceSku.slice(0, SKU_MAX_LENGTH - COPY_SKU_SUFFIX.length).replace(/-+$/g, '');
    for (let attempt = 1; attempt <= COPY_SKU_MAX_ATTEMPTS; attempt += 1) {
      const candidate =
        attempt === 1 ? `${base}${COPY_SKU_SUFFIX}` : `${base}${COPY_SKU_SUFFIX}${attempt}`;
      if (this.repository.findBySku(candidate, businessId) === null) {
        return candidate;
      }
    }
    throw new ConflictError('No se pudo generar un SKU libre para la copia del producto', {
      details: { code: 'PRODUCT_SKU_TAKEN', field: 'sku' },
    });
  }

  /** El slug debe estar libre, incluidos los productos dados de baja. */
  private assertSlugAvailable(slug: string, excludeId: number | null): void {
    const existing = this.repository.findBySlugIncludingDeleted(slug);
    if (existing !== null && existing.id !== excludeId) {
      throw new ConflictError('Ya existe un producto con ese identificador (slug)', {
        details: { code: 'PRODUCT_SLUG_TAKEN', field: 'slug' },
      });
    }
  }

  /** La categoría, si se envía, debe existir y ser del negocio. */
  private assertCategory(categoryId: number | null | undefined, businessId: number): void {
    if (categoryId === null || categoryId === undefined) {
      return;
    }
    if (this.repository.findCategory(categoryId, businessId) === null) {
      throw new NotFoundError('La categoría no existe', {
        details: { id: categoryId, type: 'category', field: 'categoryId' },
      });
    }
  }

  /**
   * La ventana promocional es de ambas o de ninguna, y `endsAt > startsAt`
   * (API.md 7.11). Una promo con precio y sin ventana nunca se aplicaría
   * (BR-PRICE-001), así que se rechaza en el borde en vez de aceptarse en
   * silencio.
   */
  private assertPromoWindow(startsAt: string | null | undefined, endsAt: string | null | undefined): void {
    const from = startsAt ?? null;
    const to = endsAt ?? null;
    if (from === null && to === null) {
      return;
    }
    if (from === null || to === null) {
      throw new ValidationError('La promoción necesita inicio y fin, o ninguno de los dos', {
        details: [
          {
            path: from === null ? 'promoStartsAt' : 'promoEndsAt',
            message: 'Envíe las dos fechas de la promoción o ninguna',
            code: 'PROMO_WINDOW_INVALID',
          },
        ],
      });
    }
    if (to <= from) {
      throw new ValidationError('La ventana de la promoción no es válida', {
        details: [
          {
            path: 'promoEndsAt',
            message: 'El fin de la promoción debe ser posterior a su inicio',
            code: 'PROMO_WINDOW_INVALID',
          },
        ],
      });
    }
  }

  /** El precio promocional tiene que ser MENOR que el base (CHECK de la tabla). */
  private assertPromoPrice(promoPriceMinor: number | null | undefined, basePriceMinor: number): void {
    if (promoPriceMinor === null || promoPriceMinor === undefined) {
      return;
    }
    if (promoPriceMinor >= basePriceMinor) {
      throw new ValidationError('El precio promocional debe ser menor que el precio base', {
        details: [
          {
            path: 'promoPriceMinor',
            message: 'Una promoción que no abarata el producto no es una promoción',
            code: 'PROMO_PRICE_NOT_LOWER',
          },
        ],
      });
    }
  }

  /**
   * BR-PRICE-009: el precio efectivo de la variante tiene que ser `>= 0`.
   * Se resuelve con la misma función pura del catálogo, así que el precio que se
   * valida y el que se muestra no pueden divergir.
   */
  private assertVariantPrice(
    basePriceMinor: number,
    variant: {
      readonly priceDeltaMinor: number;
      readonly priceMinor?: number | null;
    },
  ): void {
    const resolved = resolveUnitPrice(
      {
        basePriceMinor,
        promoPriceMinor: null,
        promoStartsAt: null,
        promoEndsAt: null,
      },
      { priceDeltaMinor: variant.priceDeltaMinor, priceMinor: variant.priceMinor ?? null },
      // La promo se ignora a propósito: una promo baja el precio, nunca lo sube,
      // así que no puede ser la causa de un precio negativo.
      '9999-12-31T23:59:59.999Z',
    );
    if (resolved.unitPriceMinor < 0) {
      throw new BusinessRuleError(
        'El precio de la variante no puede quedar por debajo de cero',
        {
          details: {
            code: 'INVALID_VARIANT_PRICE',
            ruleId: 'BR-PRICE-009',
            basePriceMinor,
            priceDeltaMinor: variant.priceDeltaMinor,
            priceMinor: variant.priceMinor ?? null,
            effectivePriceMinor: resolved.unitPriceMinor,
          },
        },
      );
    }
  }

  /** Revalida las variantes existentes tras un cambio del precio base. */
  private assertExistingVariants(productId: number, basePriceMinor: number): void {
    for (const variant of this.repository.listVariants(productId)) {
      this.assertVariantPrice(basePriceMinor, {
        priceDeltaMinor: variant.price_delta_minor,
        priceMinor: variant.price_minor,
      });
    }
  }

  /**
   * `maxSelect` exige `isMultiple = 1`, y `maxSelect >= 1` (BR-PRICE-011).
   * Un tope con selección única no tiene sentido; es mejor un 422 explícito que
   * un dato que el motor de pedidos tendría que ignorar.
   */
  private assertAddonSelection(isMultiple: boolean, maxSelect: number | null): void {
    if (maxSelect === null) {
      return;
    }
    if (!isMultiple) {
      throw new BusinessRuleError(
        'Un complemento de selección única no admite máximo de selección',
        {
          details: {
            code: 'MAX_SELECT_REQUIRES_MULTIPLE',
            maxSelect,
            hint: 'Ponga isMultiple = true o deje maxSelect en null',
          },
        },
      );
    }
    if (maxSelect < 1) {
      throw new BusinessRuleError('El máximo de selección debe ser al menos 1', {
        details: { code: 'MAX_SELECT_REQUIRES_MULTIPLE', maxSelect },
      });
    }
  }

  /** Valida por adelantado los complementos que vienen en el alta. */
  private assertInlineAddons(addons: readonly InlineAddonInput[]): void {
    const seen = new Set<string>();
    for (const addon of addons) {
      this.assertAddonSelection(addon.isMultiple, addon.maxSelect ?? null);
      const key = addon.name.trim().toLowerCase();
      if (seen.has(key)) {
        throw new ConflictError('Ya existe un complemento con ese nombre en este producto', {
          details: { code: 'ADDON_NAME_TAKEN', field: 'name' },
        });
      }
      seen.add(key);
    }
  }

  // ==========================================================================
  // Auxiliares: escritura y proyección
  // ==========================================================================

  /** Inserta un complemento del producto. Devuelve el id nuevo. */
  private insertAddonFor(
    productId: number,
    addon: InlineAddonInput,
    sortOrder: number | undefined,
  ): number {
    const record: NewAddonRecord = {
      productId,
      name: addon.name,
      code: addon.code ?? null,
      priceMinor: addon.priceMinor,
      isMultiple: addon.isMultiple,
      maxSelect: addon.maxSelect ?? null,
      sortOrder: sortOrder ?? this.repository.maxAddonSortOrder(productId) + 1,
      isActive: addon.isActive,
    };
    return this.repository.insertAddon(record);
  }

  /** Detalle completo de un producto ya guardado, dentro de la transacción. */
  private detailOf(productId: number, businessId: number): ProductDetailView {
    const row = this.requireProduct(productId, businessId);
    return {
      ...this.toView(row, {
        now: nowIso(),
        variants: this.repository.listVariants(productId),
        addons: this.repository.listAddons(productId),
        stock: this.toStockView(this.repository.findStock(productId)),
      }),
      ingredients: this.toRecipeView(this.repository.listRecipe(productId)),
      priceHistory: [],
    };
  }

  /** Proyecta la fila de `products` al recurso `Product` del contrato. */
  private toView(
    row: ProductRow,
    extras: {
      readonly now: string;
      readonly variants: readonly ProductVariantRow[];
      readonly addons: readonly ProductAddonRow[];
      readonly stock: ProductStockView | null;
    },
  ): ProductView {
    return {
      id: row.id,
      categoryId: row.category_id,
      sku: row.sku,
      name: row.name,
      slug: row.slug,
      shortDescription: row.short_description,
      description: row.description,
      imageUrl: row.image_url,
      basePriceMinor: row.base_price_minor,
      promoPriceMinor: row.promo_price_minor,
      promoStartsAt: row.promo_starts_at,
      promoEndsAt: row.promo_ends_at,
      taxRateBp: row.tax_rate_bp,
      trackStock: row.track_stock === 1,
      isFeatured: row.is_featured === 1,
      isAvailable: row.is_available === 1,
      isActive: row.is_active === 1,
      preparationMinutes: row.preparation_minutes,
      sortOrder: row.sort_order,
      category: this.categoryRefOf(row),
      variants: extras.variants.map((variant) => this.toVariantView(row, variant, extras.now)),
      addons: extras.addons.map((addon) => this.toAddonView(addon)),
      stock: extras.stock,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Proyecta la variante con su `effectivePriceMinor` ya resuelto. */
  private toVariantView(
    product: ProductRow,
    row: ProductVariantRow,
    now: string,
  ): ProductVariantView {
    return {
      id: row.id,
      productId: row.product_id,
      name: row.name,
      code: row.code,
      priceDeltaMinor: row.price_delta_minor,
      priceMinor: row.price_minor,
      effectivePriceMinor: resolveUnitPrice(
        {
          basePriceMinor: product.base_price_minor,
          promoPriceMinor: product.promo_price_minor,
          promoStartsAt: product.promo_starts_at,
          promoEndsAt: product.promo_ends_at,
        },
        { priceDeltaMinor: row.price_delta_minor, priceMinor: row.price_minor },
        now,
      ).unitPriceMinor,
      isDefault: row.is_default === 1,
      sortOrder: row.sort_order,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toAddonView(row: ProductAddonRow): ProductAddonView {
    return {
      id: row.id,
      productId: row.product_id,
      name: row.name,
      code: row.code,
      priceMinor: row.price_minor,
      isMultiple: row.is_multiple === 1,
      maxSelect: row.max_select,
      sortOrder: row.sort_order,
      isActive: row.is_active === 1,
    };
  }

  private toBasicView(row: ProductBasicRow): ProductBasicView {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      imageUrl: row.image_url,
      basePriceMinor: row.base_price_minor,
      promoPriceMinor: row.promo_price_minor,
      isAvailable: row.is_available === 1,
      isFeatured: row.is_featured === 1,
      preparationMinutes: row.preparation_minutes,
      categoryId: row.category_id,
    };
  }

  private toIngredientView(row: IngredientRow): IngredientView {
    return {
      id: row.id,
      name: row.name,
      unit: row.unit,
      costMinor: row.cost_minor,
      supplier: row.supplier,
      isActive: row.is_active === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * `stock` del producto. `null` si no hay ítem de inventario: es la diferencia
   * entre "no se controla" y "cero existencias" (API.md 6.3).
   */
  private toStockView(
    row: { readonly current_stock: number; readonly min_stock: number; readonly max_stock: number; readonly is_tracked: 0 | 1 } | null,
  ): ProductStockView | null {
    if (row === null) {
      return null;
    }
    return {
      currentStock: row.current_stock,
      minStock: row.min_stock,
      maxStock: row.max_stock,
      isTracked: row.is_tracked === 1,
      isLowStock: row.is_tracked === 1 && row.current_stock <= row.min_stock,
    };
  }

  /** Referencia de la categoría, resuelta una vez por producto. */
  private categoryRefOf(row: ProductRow): CategoryRef | null {
    if (row.category_id === null) {
      return null;
    }
    const category = this.repository.findCategoryRef(row.category_id);
    return category === null ? null : { id: category.id, name: category.name, slug: category.slug };
  }

  /**
   * Proyecta la receta y calcula el costo de una unidad del producto.
   * `lineCostMinor` = `cost_minor * quantity`, redondeado half-up (BR-MONEY-002).
   */
  private toRecipeView(
    rows: readonly {
      id: number;
      product_id: number;
      ingredient_id: number;
      quantity: number;
      ingredient_name: string;
      unit: string;
      cost_minor: number;
      current_stock: number | null;
      is_tracked: number | null;
    }[],
  ): readonly ProductIngredientView[] {
    return rows.map((row) => this.toRecipeLineView(row));
  }

  private toRecipeLineView(row: {
    readonly id: number;
    readonly product_id: number;
    readonly ingredient_id: number;
    readonly quantity: number;
    readonly ingredient_name: string;
    readonly unit: string;
    readonly cost_minor: number;
    readonly current_stock: number | null;
    readonly is_tracked: number | null;
  }): ProductIngredientView {
    const tracked = row.is_tracked === 1;
    return {
      id: row.id,
      productId: row.product_id,
      ingredientId: row.ingredient_id,
      ingredientName: row.ingredient_name,
      unit: row.unit,
      quantity: row.quantity,
      costMinor: row.cost_minor,
      lineCostMinor: multiplyMinor(row.cost_minor, row.quantity),
      stock:
        row.current_stock === null
          ? null
          : { currentStock: row.current_stock, isLowStock: tracked && row.current_stock <= 0 },
    };
  }

  /** Agrupa filas hijas por `product_id`, para las consultas en lote. */
  private groupByProduct<T extends { readonly product_id: number }>(rows: readonly T[]): Map<number, T[]> {
    const grouped = new Map<number, T[]>();
    for (const row of rows) {
      const bucket = grouped.get(row.product_id);
      if (bucket === undefined) {
        grouped.set(row.product_id, [row]);
      } else {
        bucket.push(row);
      }
    }
    return grouped;
  }

  /** Líneas de pedido que usaron la variante (para el aviso de borrado). */
  private countVariantOrderItems(variantId: number): number {
    // `order_items` conserva el snapshot aunque la variante desaparezca; el
    // conteo se hace con el repositorio de productos a través del mismo
    // acceso de sólo lectura del catálogo.
    return this.repository.countOrderItemsForVariant(variantId);
  }

  private countAddonOrderItems(addonId: number): number {
    return this.repository.countOrderItemsForAddon(addonId);
  }

  /** Campos de la fila de `products` que van al audit log. Nunca el stock. */
  private auditFieldsOf(row: ProductRow): Record<string, unknown> {
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      slug: row.slug,
      categoryId: row.category_id,
      basePriceMinor: row.base_price_minor,
      promoPriceMinor: row.promo_price_minor,
      promoStartsAt: row.promo_starts_at,
      promoEndsAt: row.promo_ends_at,
      taxRateBp: row.tax_rate_bp,
      trackStock: row.track_stock === 1,
      isFeatured: row.is_featured === 1,
      isAvailable: row.is_available === 1,
      isActive: row.is_active === 1,
      preparationMinutes: row.preparation_minutes,
      sortOrder: row.sort_order,
    };
  }

  private variantAuditFields(row: ProductVariantRow): Record<string, unknown> {
    return {
      id: row.id,
      productId: row.product_id,
      name: row.name,
      code: row.code,
      priceDeltaMinor: row.price_delta_minor,
      priceMinor: row.price_minor,
      isDefault: row.is_default === 1,
      sortOrder: row.sort_order,
      isActive: row.is_active === 1,
    };
  }

  private addonAuditFields(row: ProductAddonRow): Record<string, unknown> {
    return {
      id: row.id,
      productId: row.product_id,
      name: row.name,
      code: row.code,
      priceMinor: row.price_minor,
      isMultiple: row.is_multiple === 1,
      maxSelect: row.max_select,
      sortOrder: row.sort_order,
      isActive: row.is_active === 1,
    };
  }

  private ingredientAuditFields(row: IngredientRow): Record<string, unknown> {
    return {
      id: row.id,
      name: row.name,
      unit: row.unit,
      costMinor: row.cost_minor,
      supplier: row.supplier,
      isActive: row.is_active === 1,
    };
  }
}
