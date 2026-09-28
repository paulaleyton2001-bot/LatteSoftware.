/**
 * Controller del módulo `catalog` para productos y sus sub-recursos
 * (API.md 7.11).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: el precio, el slug, la unicidad del SKU, la
 *    variante por defecto y el saldo de stock los resuelve el service.
 *  - La selección `fields=basic` SÍ es de este fichero (es una decisión de
 *    transporte, no de dominio) y por eso se pasa como argumento al service
 *    en vez de recortar la respuesta aquí: recortar en el controller obligaría a
 *    haber cargado antes lo que se pretende no cargar.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`.
 */
import type { Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import { auditMetaFromRequest } from '../../shared/services/index.js';
import type { ProductRequestContext, ProductsService } from './products.service.js';
import type {
  IngredientListFilter,
  IngredientSortColumn,
  ProductListFilter,
  ProductSortColumn,
} from './products.repository.js';
import { INGREDIENT_SORT_DEFAULT, PRODUCT_SORT_DEFAULT } from './catalog.schemas.js';
import type {
  AddProductIngredientBody,
  CreateAddonBody,
  CreateIngredientBody,
  CreateProductBody,
  CreateVariantBody,
  DeleteIngredientBody,
  DeleteProductBody,
  DuplicateProductBody,
  ListIngredientsQuery,
  ListProductsQuery,
  ProductActiveBody,
  ProductAvailabilityBody,
  UpdateAddonBody,
  UpdateIngredientBody,
  UpdateProductBody,
  UpdateVariantBody,
} from './catalog.schemas.js';

/** `req` con actor y cuerpo/query/params validados. */
type ProductRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables de productos, replicadas para acotar `parseSort`. */
const PRODUCT_SORT_COLUMNS: readonly ProductSortColumn[] = [
  'sort_order',
  'name',
  'base_price_minor',
  'created_at',
  'preparation_minutes',
];

/** Columnas ordenables de insumos. */
const INGREDIENT_SORT_COLUMNS: readonly IngredientSortColumn[] = ['name', 'created_at', 'cost_minor'];

/** Contexto de auditoría de la petición. */
function contextOf(req: ProductRequest): ProductRequestContext {
  return { actor: requireAuth(req), request: auditMetaFromRequest(req) };
}

/** Traduce la query de listado al filtro del repositorio. */
function listFilterOf(
  query: ListProductsQuery,
  pagination: { readonly page: number; readonly pageSize: number },
  column: ProductSortColumn,
  direction: 'ASC' | 'DESC',
): Omit<ProductListFilter, 'businessId'> {
  return {
    limit: pagination.pageSize,
    offset: (pagination.page - 1) * pagination.pageSize,
    sort: { column, direction },
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.q === undefined ? {} : { q: query.q }),
    ...(query.featured === undefined ? {} : { featured: query.featured }),
    ...(query.available === undefined ? {} : { available: query.available }),
    ...(query.trackStock === undefined ? {} : { trackStock: query.trackStock }),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    // `includeInactive` manda sobre el filtro por defecto (`is_active = 1`);
    // un `isActive` explícito es más concreto y gana.
    includeInactive: query.isActive === undefined ? query.includeInactive === true : false,
    ...(query.minPrice === undefined ? {} : { minPrice: query.minPrice }),
    ...(query.maxPrice === undefined ? {} : { maxPrice: query.maxPrice }),
    ...(query.inStockOnly === undefined ? {} : { inStockOnly: query.inStockOnly }),
  };
}

/** Controller de productos. */
export class ProductsController {
  public constructor(private readonly products: ProductsService) {}

  // ==========================================================================
  // Listado y detalle
  // ==========================================================================

  /**
   * `GET /api/v1/products` — listado paginado.
   *
   * Con `fields=basic` devuelve `ProductBasic[]` (10 columnas, sin variantes ni
   * complementos); sin él, `Product[]` con el árbol completo.
   */
  public list = async (req: ProductRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListProductsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? PRODUCT_SORT_DEFAULT;
    const column = (PRODUCT_SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as ProductSortColumn)
      : (PRODUCT_SORT_DEFAULT as ProductSortColumn);
    const direction = req.validated?.sort?.direction ?? 'ASC';
    const context = contextOf(req);
    const filter = {
      ...listFilterOf(query, pagination, column, direction),
      businessId: context.actor.businessId,
    };

    const page =
      query.fields === 'basic'
        ? this.products.listBasic(filter, context)
        : this.products.list(filter, context);

    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      // `meta.categories` alimenta los filtros por categoría de la pantalla del
      // POS sin una segunda petición.
      { categories: page.categories.map((entry) => ({ id: entry.id, name: entry.name, count: entry.count })) },
    );
  };

  /** `GET /api/v1/products/:id` — producto con receta, variantes y stock. */
  public getById = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.products.getById(params.id, contextOf(req)));
  };

  // ==========================================================================
  // Escrituras del producto
  // ==========================================================================

  /** `POST /api/v1/products` — alta con variantes y complementos (201). */
  public create = async (req: ProductRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateProductBody;
    const result = this.products.create(
      {
        sku: body.sku,
        name: body.name,
        ...(body.categoryId === undefined ? {} : { categoryId: body.categoryId }),
        ...(body.slug === undefined ? {} : { slug: body.slug }),
        ...(body.shortDescription === undefined ? {} : { shortDescription: body.shortDescription }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.imageUrl === undefined ? {} : { imageUrl: body.imageUrl }),
        basePriceMinor: body.basePriceMinor,
        ...(body.promoPriceMinor === undefined ? {} : { promoPriceMinor: body.promoPriceMinor }),
        ...(body.promoStartsAt === undefined ? {} : { promoStartsAt: body.promoStartsAt }),
        ...(body.promoEndsAt === undefined ? {} : { promoEndsAt: body.promoEndsAt }),
        ...(body.taxRateBp === undefined ? {} : { taxRateBp: body.taxRateBp }),
        trackStock: body.trackStock,
        isFeatured: body.isFeatured,
        isAvailable: body.isAvailable,
        preparationMinutes: body.preparationMinutes,
        ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
        isActive: body.isActive,
        ...(body.variants === undefined
          ? {}
          : { variants: body.variants.map((variant) => this.toInlineVariant(variant)) }),
        ...(body.addons === undefined
          ? {}
          : { addons: body.addons.map((addon) => this.toInlineAddon(addon)) }),
      },
      contextOf(req),
    );
    sendCreated(res, result.product, { warnings: result.warnings });
  };

  /** `PATCH /api/v1/products/:id` — edición parcial. */
  public update = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as UpdateProductBody;
    const result = this.products.update(
      params.id,
      {
        ...(body.categoryId === undefined ? {} : { categoryId: body.categoryId }),
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.slug === undefined ? {} : { slug: body.slug }),
        ...(body.shortDescription === undefined ? {} : { shortDescription: body.shortDescription }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.imageUrl === undefined ? {} : { imageUrl: body.imageUrl }),
        ...(body.basePriceMinor === undefined ? {} : { basePriceMinor: body.basePriceMinor }),
        ...(body.promoPriceMinor === undefined ? {} : { promoPriceMinor: body.promoPriceMinor }),
        ...(body.promoStartsAt === undefined ? {} : { promoStartsAt: body.promoStartsAt }),
        ...(body.promoEndsAt === undefined ? {} : { promoEndsAt: body.promoEndsAt }),
        ...(body.taxRateBp === undefined ? {} : { taxRateBp: body.taxRateBp }),
        ...(body.trackStock === undefined ? {} : { trackStock: body.trackStock }),
        ...(body.isFeatured === undefined ? {} : { isFeatured: body.isFeatured }),
        ...(body.preparationMinutes === undefined ? {} : { preparationMinutes: body.preparationMinutes }),
        ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
        ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      },
      contextOf(req),
    );
    sendSuccess(res, result.product, { warnings: result.warnings });
  };

  /**
   * `PATCH /api/v1/products/:id/availability` — disponibilidad comercial.
   * NO cambia `is_active` (BR-PRICE-006).
   */
  public setAvailability = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as ProductAvailabilityBody;
    sendSuccess(
      res,
      this.products.setAvailability(
        params.id,
        { isAvailable: body.isAvailable, ...(body.reason === undefined ? {} : { reason: body.reason }) },
        contextOf(req),
      ),
    );
  };

  /** `PATCH /api/v1/products/:id/active` — activar o desactivar del catálogo. */
  public setActive = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as ProductActiveBody;
    sendSuccess(
      res,
      this.products.setActive(
        params.id,
        { isActive: body.isActive, ...(body.reason === undefined ? {} : { reason: body.reason }) },
        contextOf(req),
      ),
    );
  };

  /** `DELETE /api/v1/products/:id` — baja lógica. */
  public remove = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = (req.validated?.body ?? {}) as DeleteProductBody;
    sendSuccess(
      res,
      this.products.remove(
        params.id,
        { ...(body.reason === undefined ? {} : { reason: body.reason }) },
        contextOf(req),
      ),
    );
  };

  /**
   * `POST /api/v1/products/:id/duplicate` — clon transaccional (201).
   * Sin `sku` en el cuerpo, el service deriva uno libre con sufijo `-COPY`.
   */
  public duplicate = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = (req.validated?.body ?? {}) as DuplicateProductBody;
    sendCreated(
      res,
      this.products.duplicate(
        params.id,
        {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.sku === undefined ? {} : { sku: body.sku }),
          ...(body.categoryId === undefined ? {} : { categoryId: body.categoryId }),
          copyVariants: body.copyVariants !== false,
          copyAddons: body.copyAddons !== false,
          copyIngredients: body.copyIngredients !== false,
          isActive: body.isActive === true,
        },
        contextOf(req),
      ),
    );
  };

  // ==========================================================================
  // Variantes
  // ==========================================================================

  /** `GET /api/v1/products/:id/variants`. */
  public listVariants = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const items = this.products.listVariants(params.id, contextOf(req));
    sendSuccess(res, items, { total: items.length });
  };

  /** `POST /api/v1/products/:id/variants` (201). */
  public createVariant = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as CreateVariantBody;
    sendCreated(
      res,
      this.products.createVariant(
        params.id,
        this.toInlineVariant(body),
        contextOf(req),
      ),
    );
  };

  /** `PATCH /api/v1/products/variants/:variantId`. */
  public updateVariant = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { variantId: number };
    const body = req.validated?.body as UpdateVariantBody;
    sendSuccess(
      res,
      this.products.updateVariant(
        params.variantId,
        {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.code === undefined ? {} : { code: body.code }),
          ...(body.priceDeltaMinor === undefined ? {} : { priceDeltaMinor: body.priceDeltaMinor }),
          ...(body.priceMinor === undefined ? {} : { priceMinor: body.priceMinor }),
          ...(body.isDefault === undefined ? {} : { isDefault: body.isDefault }),
          ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
          ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        },
        contextOf(req),
      ),
    );
  };

  /** `DELETE /api/v1/products/variants/:variantId`. */
  public removeVariant = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { variantId: number };
    sendSuccess(res, this.products.removeVariant(params.variantId, contextOf(req)));
  };

  // ==========================================================================
  // Complementos
  // ==========================================================================

  /** `GET /api/v1/products/:id/addons`. */
  public listAddons = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const items = this.products.listAddons(params.id, contextOf(req));
    sendSuccess(res, items, { total: items.length });
  };

  /** `POST /api/v1/products/:id/addons` (201). */
  public createAddon = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as CreateAddonBody;
    sendCreated(
      res,
      this.products.createAddon(params.id, this.toInlineAddon(body), contextOf(req)),
    );
  };

  /** `PATCH /api/v1/products/addons/:addonId`. */
  public updateAddon = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { addonId: number };
    const body = req.validated?.body as UpdateAddonBody;
    sendSuccess(
      res,
      this.products.updateAddon(
        params.addonId,
        {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.code === undefined ? {} : { code: body.code }),
          ...(body.priceMinor === undefined ? {} : { priceMinor: body.priceMinor }),
          ...(body.isMultiple === undefined ? {} : { isMultiple: body.isMultiple }),
          ...(body.maxSelect === undefined ? {} : { maxSelect: body.maxSelect }),
          ...(body.sortOrder === undefined ? {} : { sortOrder: body.sortOrder }),
          ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        },
        contextOf(req),
      ),
    );
  };

  /** `DELETE /api/v1/products/addons/:addonId`. */
  public removeAddon = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { addonId: number };
    sendSuccess(res, this.products.removeAddon(params.addonId, contextOf(req)));
  };

  // ==========================================================================
  // Receta
  // ==========================================================================

  /** `GET /api/v1/products/:id/ingredients` — la receta con su costo total. */
  public listRecipe = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const items = this.products.listRecipe(params.id, contextOf(req));
    sendSuccess(res, items, {
      total: items.length,
      // `totalCostMinor` es el costo de UNA unidad del producto según la receta.
      totalCostMinor: items.reduce((sum, item) => sum + item.lineCostMinor, 0),
    });
  };

  /** `POST /api/v1/products/:id/ingredients` — añadir insumo a la receta (201). */
  public addIngredient = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    const body = req.validated?.body as AddProductIngredientBody;
    sendCreated(
      res,
      this.products.addIngredient(
        params.id,
        {
          ingredientId: body.ingredientId,
          quantity: body.quantity,
          updateStock: body.updateStock !== false,
        },
        contextOf(req),
      ),
    );
  };

  /**
   * `DELETE /api/v1/products/:id/ingredients/:ingredientId` — quitar de la receta.
   * NO toca el inventario del insumo.
   */
  public removeRecipeIngredient = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number; ingredientId: number };
    sendSuccess(
      res,
      this.products.removeRecipeIngredient(params.id, params.ingredientId, contextOf(req)),
    );
  };

  // ==========================================================================
  // Catálogo de insumos
  // ==========================================================================

  /** `GET /api/v1/products/ingredients` — catálogo de insumos. */
  public listIngredients = async (req: ProductRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListIngredientsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? INGREDIENT_SORT_DEFAULT;
    const column = (INGREDIENT_SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as IngredientSortColumn)
      : (INGREDIENT_SORT_DEFAULT as IngredientSortColumn);
    const context = contextOf(req);

    const filter: IngredientListFilter = {
      businessId: context.actor.businessId,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
      sort: { column, direction: req.validated?.sort?.direction ?? 'ASC' },
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.supplier === undefined ? {} : { supplier: query.supplier }),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.unit === undefined ? {} : { unit: query.unit }),
      includeInactive: query.isActive === undefined ? query.includeInactive === true : false,
    };

    const page = this.products.listIngredients(filter, context);
    sendPaginated(res, page.items, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: page.total,
    });
  };

  /** `POST /api/v1/products/ingredients` — alta de insumo (201). */
  public createIngredient = async (req: ProductRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as CreateIngredientBody;
    sendCreated(
      res,
      this.products.createIngredient(
        {
          name: body.name,
          unit: body.unit,
          costMinor: body.costMinor,
          ...(body.supplier === undefined ? {} : { supplier: body.supplier }),
          isActive: body.isActive,
        },
        contextOf(req),
      ),
    );
  };

  /** `PATCH /api/v1/products/ingredients/:ingredientId`. */
  public updateIngredient = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { ingredientId: number };
    const body = req.validated?.body as UpdateIngredientBody;
    sendSuccess(
      res,
      this.products.updateIngredient(
        params.ingredientId,
        {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.unit === undefined ? {} : { unit: body.unit }),
          ...(body.costMinor === undefined ? {} : { costMinor: body.costMinor }),
          ...(body.supplier === undefined ? {} : { supplier: body.supplier }),
          ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
        },
        contextOf(req),
      ),
    );
  };

  /** `DELETE /api/v1/products/ingredients/:ingredientId` — baja lógica. */
  public removeIngredient = async (req: ProductRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { ingredientId: number };
    const body = (req.validated?.body ?? {}) as DeleteIngredientBody;
    sendSuccess(
      res,
      this.products.removeIngredient(
        params.ingredientId,
        { ...(body.reason === undefined ? {} : { reason: body.reason }) },
        contextOf(req),
      ),
    );
  };

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  /**
   * Traduce el esquema de variante a la entrada del service, rellenando los
   * valores por defecto del esquema. El service recibe datos ya completos: no
   * conoce zod ni sus defaults.
   */
  private toInlineVariant(variant: CreateVariantBody): {
    readonly name: string;
    readonly code?: string | null;
    readonly priceDeltaMinor: number;
    readonly priceMinor?: number | null;
    readonly isDefault: boolean;
    readonly sortOrder?: number;
    readonly isActive: boolean;
  } {
    return {
      name: variant.name,
      ...(variant.code === undefined ? {} : { code: variant.code }),
      priceDeltaMinor: variant.priceDeltaMinor,
      ...(variant.priceMinor === undefined ? {} : { priceMinor: variant.priceMinor }),
      isDefault: variant.isDefault,
      ...(variant.sortOrder === undefined ? {} : { sortOrder: variant.sortOrder }),
      isActive: variant.isActive,
    };
  }

  /** Igual que {@link toInlineVariant} para complementos. */
  private toInlineAddon(addon: CreateAddonBody): {
    readonly name: string;
    readonly code?: string | null;
    readonly priceMinor: number;
    readonly isMultiple: boolean;
    readonly maxSelect?: number | null;
    readonly sortOrder?: number;
    readonly isActive: boolean;
  } {
    return {
      name: addon.name,
      ...(addon.code === undefined ? {} : { code: addon.code }),
      priceMinor: addon.priceMinor,
      isMultiple: addon.isMultiple,
      ...(addon.maxSelect === undefined ? {} : { maxSelect: addon.maxSelect }),
      ...(addon.sortOrder === undefined ? {} : { sortOrder: addon.sortOrder }),
      isActive: addon.isActive,
    };
  }
}
