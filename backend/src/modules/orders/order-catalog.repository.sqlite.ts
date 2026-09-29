/**
 * Implementación SQLite de la lectura de CATÁLOGO para las líneas de pedido.
 *
 * Único fichero con SQL sobre `products`, `product_variants` y
 * `product_addons` DENTRO del módulo de pedidos. El módulo de catálogo no se
 * modifica en absoluto (ver el tsdoc de `order-catalog.repository.ts` para el
 * porqué de no importar su repositorio).
 *
 * Todas las consultas son de UNA fila por clave primaria o por FK, y todas
 * aceptan la conexión de la transacción del pedido: si el producto cambia de
 * precio entre el `SELECT` y el `INSERT` de la línea, la transacción abierta
 * impide que eso ocurra (DESIGN.md 8.2).
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import type {
  OrderAddonRef,
  OrderCatalogReader,
  OrderProductRef,
  OrderRecipeIngredient,
  OrderStockItemRef,
  OrderVariantRef,
} from './order-catalog.repository.js';

/** Repositorio de lectura del catálogo para pedidos. */
export class SqliteOrderCatalogReader implements OrderCatalogReader {
  public findProduct(
    productId: number,
    businessId: number,
    db: Db = getConnection(),
  ): OrderProductRef | null {
    const row = db
      .prepare(
        `SELECT id, business_id, category_id, sku, name, base_price_minor, promo_price_minor,
                promo_starts_at, promo_ends_at, tax_rate_bp, track_stock, is_available,
                is_active, preparation_minutes, deleted_at
           FROM products
          WHERE id = ? AND business_id = ?`,
      )
      .get(productId, businessId) as OrderProductRef | undefined;
    return row ?? null;
  }

  public findVariant(variantId: number, db: Db = getConnection()): OrderVariantRef | null {
    const row = db
      .prepare(
        `SELECT id, product_id, name, price_delta_minor, price_minor, is_active
           FROM product_variants
          WHERE id = ?`,
      )
      .get(variantId) as OrderVariantRef | undefined;
    return row ?? null;
  }

  public findAddon(addonId: number, db: Db = getConnection()): OrderAddonRef | null {
    const row = db
      .prepare(
        `SELECT id, product_id, name, price_minor, is_multiple, max_select, is_active
           FROM product_addons
          WHERE id = ?`,
      )
      .get(addonId) as OrderAddonRef | undefined;
    return row ?? null;
  }

  /**
   * Receta con control de stock.
   *
   * El `JOIN` con `inventory_items` es INNER a propósito: un ingrediente sin
   * ítem de inventario no descuenta nada y no tiene sentido materializar un
   * movimiento para él (BR-INV-003). `is_tracked = 1` filtra los ítems que
   * existen pero no se controlan (BR-INV-007).
   */
  public listTrackedIngredients(
    productId: number,
    businessId: number,
    db: Db = getConnection(),
  ): readonly OrderRecipeIngredient[] {
    return db
      .prepare(
        `SELECT ii.id AS inventory_item_id,
                pi.ingredient_id,
                pi.quantity AS quantity_per_unit,
                ii.cost_minor AS unit_cost_minor
           FROM product_ingredients pi
           JOIN inventory_items ii
             ON ii.ingredient_id = pi.ingredient_id
            AND ii.business_id = ?
            AND ii.deleted_at IS NULL
            AND ii.is_tracked = 1
          WHERE pi.product_id = ?`,
      )
      .all(businessId, productId) as OrderRecipeIngredient[];
  }

  /**
   * Ítem de inventario que controla el stock de un producto.
   *
   * El `ux_inventory_product` parcial garantiza que hay como máximo uno, así que
   * `LIMIT 1` no oculta ninguna ambigüedad. El filtro `is_tracked = 1` se deja
   * FUERA a propósito: el service de pedidos necesita distinguir "no hay ítem" de
   * "hay ítem pero no se controla" (BR-INV-007), y esa distinción es la que
   * produce el error legible en vez de un movimiento silencioso.
   */
  public findStockItemForProduct(
    productId: number,
    businessId: number,
    db: Db = getConnection(),
  ): OrderStockItemRef | null {
    const row = db
      .prepare(
        `SELECT id, product_id, current_stock, is_tracked, cost_minor, name
           FROM inventory_items
          WHERE product_id = ? AND business_id = ? AND deleted_at IS NULL
          LIMIT 1`,
      )
      .get(productId, businessId) as OrderStockItemRef | undefined;
    return row ?? null;
  }
}
