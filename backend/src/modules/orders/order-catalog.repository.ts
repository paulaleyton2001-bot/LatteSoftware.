/**
 * Contrato de lectura del CATÁLOGO para las líneas de un pedido.
 *
 * ============================================================================
 * POR QUÉ ESTE MÓDULO LEE EL CATÁLOGO POR SU CUENTA
 * ============================================================================
 * El precio de una línea lo resuelve el catálogo (`catalog.pricing.ts`, regla
 * BR-PRICE-001), pero los DATOS que necesita esa función (`products`,
 * `product_variants`, `product_addons`) están en tablas que el módulo de pedidos
 * no posee. Hay tres salidas y aquí se eligió la tercera:
 *
 *  1. Importar `ProductsRepository` del módulo de catálogo. Se descartó porque
 *     su `findById` devuelve una vista de GESTIÓN con variants, addons, receta y
 *     stock: para 30 líneas de un pedido son 30 consultas que traen cientos de
 *     columnas que aquí se desperdician.
 *  2. Usar `ProductsService`. Peor todavía: un service de otro módulo dentro de
 *     una transacción `BEGIN IMMEDIATE` es exactamente la mezcla de capas que
 *     DESIGN.md 3.3 prohíbe.
 *  3. Una INTERFAZ mínima declarada AQUÍ, en el módulo que la consume, con su
 *     implementación y su SQL en este mismo módulo. Es el mismo criterio que
 *     usan `inventory` y `rentals` para no depender del catálogo, y está
 *     documentado en el tsdoc de `findProductRef` del repositorio de inventario
 *     ("evitan que este módulo dependa del de catálogo").
 *
 * Lo que SÍ se reaprovecha del catálogo es la LÓGICA: `resolveUnitPrice` de
 * `catalog/catalog.pricing.ts` es una función pura y se importa directamente, de
 * modo que la prioridad `promo > variante > base + delta > base` es LITERALMENTE
 * la misma función en el menú, en la ficha de producto y en el pedido. Si algún
 * día esa prioridad cambia, cambia en los tres sitios a la vez.
 *
 * ============================================================================
 * LO QUE ESTA INTERFAZ NO HACE
 * ============================================================================
 * No valida nada: ni disponibilidad, ni existencia, ni que la variante sea del
 * producto. Eso es del service, que es donde están las reglas de negocio
 * (BR-PRICE-006, BR-PRICE-007, BR-PRICE-009, BR-PRICE-011, BR-PRICE-012).
 */
import type { Db } from '../../shared/database/connection.js';

/** Datos de precio y disponibilidad de un producto, para una línea de pedido. */
export interface OrderProductRef {
  readonly id: number;
  readonly business_id: number;
  readonly category_id: number | null;
  readonly sku: string;
  readonly name: string;
  /** Base del BR-PRICE-001. */
  readonly base_price_minor: number;
  readonly promo_price_minor: number | null;
  readonly promo_starts_at: string | null;
  readonly promo_ends_at: string | null;
  /** Tasa propia del producto, o `null` para usar la del negocio (BR-TAX-004). */
  readonly tax_rate_bp: number | null;
  /** `1` = este producto descuenta stock al venderse (BR-INV-003). */
  readonly track_stock: 0 | 1;
  readonly is_available: 0 | 1;
  readonly is_active: 0 | 1;
  readonly preparation_minutes: number;
  readonly deleted_at: string | null;
}

/** Variante elegida para una línea. */
export interface OrderVariantRef {
  readonly id: number;
  readonly product_id: number;
  readonly name: string;
  /** Delta sobre el precio base. Puede ser NEGATIVO (BR-PRICE-009). */
  readonly price_delta_minor: number;
  /** Precio absoluto, que SOBREESCRIBE el base. `null` si la variante no lo tiene. */
  readonly price_minor: number | null;
  readonly is_active: 0 | 1;
}

/** Complemento de una línea, con sus límites de selección. */
export interface OrderAddonRef {
  readonly id: number;
  readonly product_id: number;
  readonly name: string;
  readonly price_minor: number;
  /** `0` = no se puede pedir más de una vez por línea (BR-PRICE-011). */
  readonly is_multiple: 0 | 1;
  /** Tope de unidades cuando `is_multiple = 1`. `null` = sin tope. */
  readonly max_select: number | null;
  readonly is_active: 0 | 1;
}

/** Lectura del catálogo para el módulo de pedidos. */
export interface OrderCatalogReader {
  /** Producto por id. `null` si no existe o está borrado lógicamente. */
  findProduct(productId: number, businessId: number, db?: Db): OrderProductRef | null;
  /** Variante por id. `null` si no existe. */
  findVariant(variantId: number, db?: Db): OrderVariantRef | null;
  /** Complemento por id. `null` si no existe. */
  findAddon(addonId: number, db?: Db): OrderAddonRef | null;
  /**
   * Receta de un producto con los ítems de inventario de sus ingredientes.
   *
   * Es un LEFT JOIN: un producto puede no tener receta, y sus ingredientes
   * pueden no tener un `inventory_item` gestionado. Sólo se devuelven los que sí
   * lo tienen, porque los demás no descuentan nada (BR-INV-003).
   */
  listTrackedIngredients(productId: number, businessId: number, db?: Db): readonly OrderRecipeIngredient[];
  /**
   * Ítem de inventario que controla el stock de un PRODUCTO, o `null`.
   *
   * ============================== POR QUÉ ESTA LECTURA ES DEL PEDIDO ========
   * `InventoryRepository` NO tiene un "buscar el ítem de inventario de este
   * producto": su `findProductRef(productId)` devuelve la fila del PRODUCTO
   * (`id, name, sku` de la tabla `products`), no la del ítem, y `findItemById` busca
   * por `inventory_items.id`. Encadenarlos sólo funciona por casualidad, cuando el
   * id del producto y el del ítem coinciden.
   *
   * Se lee aquí, con el SQL de este módulo, por el mismo motivo por el que
   * `inventory` lee `products` en su `findProductRef` ("evitan que este módulo
   * dependa del de catálogo"): es una lectura de UNA fila sobre una tabla de la
   * que ya se tiene la clave, y no vale la pena arrastrar un contrato de 30
   * métodos para ello. La EXTENSIÓN que haría falta en `InventoryRepository` está
   * en el informe de entrega: un `findItemByProduct(productId, businessId)`.
   */
  findStockItemForProduct(
    productId: number,
    businessId: number,
    db?: Db,
  ): OrderStockItemRef | null;
}

/**
 * Estado de stock de un producto, tal y como lo necesita el pedido.
 *
 * Es un SUBTIPO de lo que devuelve el gateway de inventario: la forma se declara
 * aquí para que la lectura y la escritura usen el mismo tipo, sin que el pedido
 * dependa de `order-gateways.ts` en un fichero que habla de catálogo.
 */
export interface OrderStockItemRef {
  readonly id: number;
  readonly product_id: number | null;
  readonly current_stock: number;
  /** `0` = existe pero no se controla; no genera movimientos (BR-INV-007). */
  readonly is_tracked: 0 | 1;
  readonly cost_minor: number;
  readonly name: string;
}

/** Ingrediente de la receta que TIENEControl de stock. */
export interface OrderRecipeIngredient {
  readonly inventory_item_id: number;
  readonly ingredient_id: number;
  /** Cantidad de insumo por unidad de producto. Puede ser fraccional. */
  readonly quantity_per_unit: number;
  /** `unit_cost_minor` del ítem, para el movimiento de inventario. */
  readonly unit_cost_minor: number;
}
