/**
 * Servicio del MENÚ PÚBLICO (`GET /api/v1/menu`).
 *
 * ============================ POR QUÉ EXISTE ==============================
 * La carta es pública: la ve un cliente sin cuenta, en la web móvil y en el
 * quiosco del local. `GET /api/v1/products` exige `products:read` y devuelve el
 * catálogo de gestión (SKU, márgenes, recetas, flags), así que no puede ser el
 * que consuma el cliente. Este service expone SÓLO lo que un cliente puede ver y
 * en la forma que la carta necesita.
 *
 * ============================== QUÉ SE OCULTA ==============================
 *  - Productos con `is_active = 0` (fuera del catálogo) o `is_available = 0`
 *    (agotado o fuera de temporada). Un producto desactivado desaparece del menú:
 *    es el requisito explícito del enunciado, y la razón por la que `is_active`
 *    existe separada de `is_available` (BR-PRICE-006).
 *  - Categorías inactivas o borradas lógicamente.
 *  - SKU, precios de coste, recetas, flags de gestión y stock.
 *
 * ============================== PRECIOS ====================================
 * Cada precio publicado pasa por {@link resolveUnitPrice} (BR-PRICE-001): el
 * cliente ve el precio que realmente se le cobrará, incluido el de la promoción
 * vigente y el de la variante por defecto, no el precio base desnudo.
 *
 * ========================= IDENTIDAD DE NEGOCIO ===========================
 * Es un endpoint PÚBLICO: no hay token del que sacar `businessId` (API.md 2), así
 * que se usa el negocio singleton por defecto (`AUTH.DEFAULT_BUSINESS_ID`), igual
 * que hace el módulo `auth` en sus endpoints públicos. En v1 hay un negocio por
 * despliegue (DESIGN.md 4.2); cuando haya varios, este endpoint exigirá un
 * `authenticate` opcional.
 */
import { AUTH } from '../../config/index.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import { resolveUnitPrice } from './catalog.pricing.js';
import type { MenuProductFilter, MenuProductRow, ProductsRepository } from './products.repository.js';
import type {
  CategoryRef,
  MenuAddonView,
  MenuCategoryView,
  MenuProductDetailView,
  MenuProductView,
  MenuVariantView,
  ProductAddonRow,
  ProductVariantRow,
} from './catalog.types.js';

/** Filtros del menú, ya validados por el esquema zod. */
export interface MenuFilter {
  readonly categoryId?: number;
  readonly q?: string;
  readonly featured?: boolean;
}

/** Servicio de lectura del menú público. */
export class MenuService {
  public constructor(private readonly repository: ProductsRepository) {}

  /** `GET /api/v1/menu` — categorías activas con sus productos publicables. */
  public list(filter: MenuFilter): readonly MenuCategoryView[] {
    const businessId = AUTH.DEFAULT_BUSINESS_ID;
    const now = nowIso();
    const categories = this.repository.listMenuCategories(businessId);
    const productFilter: MenuProductFilter = {
      businessId,
      ...(filter.categoryId === undefined ? {} : { categoryId: filter.categoryId }),
      ...(filter.q === undefined ? {} : { q: filter.q }),
      ...(filter.featured === undefined ? {} : { featured: filter.featured }),
      includeInactiveProducts: false,
    };

    // Una sola consulta para TODOS los productos del menú, y las variantes y
    // complementos se cargan en dos consultas más para el conjunto completo.
    // Con 200 productos son 3 consultas, no 1 + 2N.
    const productRows = this.repository.listMenuProducts(productFilter);
    const productIds = productRows.map((row) => row.id);
    const variants = this.groupByProduct(this.repository.listVariantsForProducts(productIds));
    const addons = this.groupByProduct(this.repository.listAddonsForProducts(productIds));

    const productsByCategory = new Map<number, MenuProductView[]>();
    for (const row of productRows) {
      if (row.category_id === null) {
        continue;
      }
      const view = this.toProductView(
        row,
        (variants.get(row.id) ?? []).filter((variant) => variant.is_active === 1),
        (addons.get(row.id) ?? []).filter((addon) => addon.is_active === 1),
        now,
      );
      const bucket = productsByCategory.get(row.category_id);
      if (bucket === undefined) {
        productsByCategory.set(row.category_id, [view]);
      } else {
        bucket.push(view);
      }
    }

    return categories
      // Con `categoryId` en la query, el resto de categorías se omiten; con `q` o
      // `featured` una categoría puede quedarse sin productos y se descarta: un
      // encabezado de sección sin productos es ruido en la carta.
      .filter((category) => (filter.categoryId === undefined ? true : category.id === filter.categoryId))
      .filter((category) => (productsByCategory.get(category.id) ?? []).length > 0)
      .map((category) => ({
        id: category.id,
        name: category.name,
        slug: category.slug,
        description: category.description,
        imageUrl: category.image_url,
        icon: category.icon,
        sortOrder: category.sort_order,
        products: productsByCategory.get(category.id) ?? [],
      }));
  }

  /**
   * `GET /api/v1/menu/:productId` — un producto del menú con su categoría.
   *
   * 404 si el producto no existe, está borrado, está inactivo, no está
   * disponible o su categoría no es pública: desde fuera del menú, un producto
   * no publicable y un producto inexistente son indistinguibles.
   */
  public getProduct(productId: number): MenuProductDetailView {
    const businessId = AUTH.DEFAULT_BUSINESS_ID;
    const row = this.repository.findMenuProductById(productId, businessId);
    if (row === null) {
      throw new NotFoundError('El producto no está disponible en el menú', {
        details: { id: productId, type: 'product', code: 'PRODUCT_NOT_FOUND' },
      });
    }
    const now = nowIso();
    const product = this.toProductView(
      row,
      this.repository.listActiveVariants(productId),
      this.repository.listActiveAddons(productId),
      now,
    );
    return { ...product, category: this.categoryRefOf(row) };
  }

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  private toProductView(
    row: MenuProductRow,
    variants: readonly ProductVariantRow[],
    addons: readonly ProductAddonRow[],
    now: string,
  ): MenuProductView {
    const priced = {
      basePriceMinor: row.base_price_minor,
      promoPriceMinor: row.promo_price_minor,
      promoStartsAt: row.promo_starts_at,
      promoEndsAt: row.promo_ends_at,
    };
    const defaultVariant = variants.find((variant) => variant.is_default === 1) ?? variants[0] ?? null;

    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      shortDescription: row.short_description,
      description: row.description,
      imageUrl: row.image_url,
      // Precio de la entrada del producto, sin variantes: es lo que se ve en la
      // carta cuando el producto tiene una sola forma.
      unitPriceMinor: resolveUnitPrice(priced, null, now).unitPriceMinor,
      defaultUnitPriceMinor:
        defaultVariant === null
          ? null
          : resolveUnitPrice(
              priced,
              {
                priceDeltaMinor: defaultVariant.price_delta_minor,
                priceMinor: defaultVariant.price_minor,
              },
              now,
            ).unitPriceMinor,
      basePriceMinor: row.base_price_minor,
      promoPriceMinor: row.promo_price_minor,
      isFeatured: row.is_featured === 1,
      preparationMinutes: row.preparation_minutes,
      variants: variants.map((variant) => this.toVariantView(variant, priced, now)),
      addons: addons.map((addon) => this.toAddonView(addon)),
    };
  }

  private toVariantView(
    row: ProductVariantRow,
    priced: {
      readonly basePriceMinor: number;
      readonly promoPriceMinor: number | null;
      readonly promoStartsAt: string | null;
      readonly promoEndsAt: string | null;
    },
    now: string,
  ): MenuVariantView {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      unitPriceMinor: resolveUnitPrice(
        priced,
        { priceDeltaMinor: row.price_delta_minor, priceMinor: row.price_minor },
        now,
      ).unitPriceMinor,
      isDefault: row.is_default === 1,
    };
  }

  private toAddonView(row: ProductAddonRow): MenuAddonView {
    return {
      id: row.id,
      name: row.name,
      priceMinor: row.price_minor,
      isMultiple: row.is_multiple === 1,
      maxSelect: row.max_select,
    };
  }

  private categoryRefOf(row: MenuProductRow): CategoryRef | null {
    if (row.category_id === null || row.category_name === null || row.category_slug === null) {
      return null;
    }
    return { id: row.category_id, name: row.category_name, slug: row.category_slug };
  }

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
}
