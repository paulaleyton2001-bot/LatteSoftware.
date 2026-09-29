/**
 * Puerto de lectura de un pedido para la validación de cupones.
 *
 * ============================================================================
 * POR QUÉ ESTE FICHERO EXISTE
 * ============================================================================
 * `POST /api/v1/discounts/validate` acepta un `orderId` para cotizar sobre el
 * subtotal REAL del pedido en vez del subtotal estimado que dice el cliente
 * (API.md 7.14, BR-DISC-001). El módulo de descuentos, sin embargo, NO debe
 * conocer la tabla `orders`: eso pertenece al módulo de pedidos.
 *
 * La solución es un PUERTO: una interfaz mínima declarada aquí, declarada en el
 * módulo que la CONSUME, y cuya implementación vive en el módulo que tiene los
 * DATOS (`orders/order-discount-lookup.ts`). Es el mismo patrón que usa
 * `inventory` para el descuento de stock, y evita que los dos módulos se
 * importen mutuamente.
 *
 * Lo que hace falta es exactamente una cosa: leer el subtotal y las líneas de un
 * pedido. Nada más.
 */
import type { DiscountValidationLine } from './discounts.types.js';

/** Instantánea mínima de un pedido para poder cotizar un cupón sobre él. */
export interface DiscountOrderSnapshot {
  readonly orderId: number;
  /** Cliente dueño del pedido; base de `usage_limit_per_customer`. */
  readonly customerId: number | null;
  /** `subtotal_minor` REAL, ya escrito por el servidor. */
  readonly subtotalMinor: number;
  /** Líneas con su categoría, para descuentos de ámbito `CATEGORY`/`PRODUCT`. */
  readonly lines: readonly DiscountValidationLine[];
}

/**
 * Implementación del puerto. La resuelve el contenedor de descuentos al
 * construirse; si el módulo de pedidos no está presente, `available` vale
 * `false` y el service responde con un error legible en vez de cotizar con un
 * subtotal inventado.
 */
export interface DiscountOrderLookup {
  /** `true` si hay un backend de pedidos conectado. */
  readonly available: boolean;
  /** Instantánea del pedido, o `null` si no existe en el negocio. */
  findOrderSnapshot(orderId: number, businessId: number): DiscountOrderSnapshot | null;
}

/** Puerto no conectado: responde siempre `null` y lo declara en `available`. */
export const UNAVAILABLE_ORDER_LOOKUP: DiscountOrderLookup = Object.freeze({
  available: false,
  findOrderSnapshot: (): null => null,
});
