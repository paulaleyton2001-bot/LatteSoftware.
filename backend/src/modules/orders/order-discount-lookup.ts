/**
 * Implementación del puerto de descuentos que lee el subtotal REAL de un pedido.
 *
 * Existe para que `POST /api/v1/discounts/validate` acepte un `orderId` y cotice
 * sobre los valores que el servidor escribió, no sobre lo que dice el cliente
 * (BR-DISC-001). El módulo de descuentos NO lee `orders`: declara el puerto
 * (`discounts/discounts.order-lookup.ts`) y esta clase, que vive junto a los
 * datos, lo implementa.
 *
 * ============================================================================
 * POR QUÉ NO HAY CICLO ENTRE LOS MÓDULOS
 * ============================================================================
 * Este fichero importa el CONTRATO (`orders.repository.ts`), la IMPLEMENTACIÓN
 * (`orders.repository.sqlite.ts`) y el TIPO del puerto. Ninguno de esos tres
 * importa el service de descuentos, así que la cadena de imports va en un solo
 * sentido y los dos módulos pueden necesitarse sin ciclo, aunque el pedido aplique
 * cupones y el cupón se cotice sobre el pedido.
 *
 * Se usa el repositorio real y no una implementación parcial a propósito: un
 * doble con quince métodos que lanzan `Error` escondería un uso accidental de
 * escritura desde el módulo de descuentos detrás de una excepción en runtime, y
 * esa clase de fallo es la peor que puede tener un puerto de solo lectura.
 */
import { SqliteOrdersRepository } from './orders.repository.sqlite.js';
import type { OrdersRepository } from './orders.repository.js';
import type {
  DiscountOrderLookup,
  DiscountOrderSnapshot,
} from '../discounts/discounts.order-lookup.js';

/** Implementación del puerto sobre `OrdersRepository`. */
export class SqliteOrderDiscountLookup implements DiscountOrderLookup {
  public readonly available = true;

  public constructor(private readonly orders: OrdersRepository) {}

  /**
   * Instantánea de un pedido para cotizar un cupón.
   *
   * Devuelve `null` si el pedido no existe en el negocio, con lo que el controller
   * responde `404` en lugar de cotizar sobre una base inventada.
   */
  public findOrderSnapshot(orderId: number, businessId: number): DiscountOrderSnapshot | null {
    const snapshot = this.orders.findSnapshot(orderId, businessId);
    if (snapshot === null) {
      return null;
    }
    const items = this.orders.listItems(orderId);
    return {
      orderId: snapshot.id,
      customerId: snapshot.customer_id,
      subtotalMinor: snapshot.subtotal_minor,
      lines: items.map((item) => ({
        productId: item.product_id,
        categoryId: item.category_id,
        quantity: item.quantity,
        lineTotalMinor: item.line_total_minor,
      })),
    };
  }
}

/** Construye el puerto listo para inyectar en `DiscountsService`. */
export function buildOrderDiscountLookup(): DiscountOrderLookup {
  return new SqliteOrderDiscountLookup(new SqliteOrdersRepository());
}
