/**
 * Grafo de dependencias del módulo `discounts` (DESIGN.md 3.6).
 *
 * ============================ POR QUÉ ES LOCAL ==============================
 * El contenedor oficial es `config/container.ts`, y ese fichero lo mantiene otro
 * agente en paralelo (lo cablea el integrador al final). Añadir aquí las
 * entradas de descuentos habría creado un conflicto de edición sobre un archivo
 * compartido, así que este módulo construye SU PROPIO grafo, con las mismas
 * reglas que el contenedor general:
 *
 *  1. Se construye UNA vez por proceso y se reutiliza (perezoso).
 *  2. Los repositorios NO guardan la conexión: la piden a `getConnection()` en
 *     cada llamada, así que este singletón no abre la base de datos y los tests
 *     pueden apuntarla a una base en memoria sin reconstruir nada.
 *  3. El `AuditService` se TOMA del contenedor oficial, no se crea otro: la
 *     auditoría es compartida (BR-SEC-007) y tener dos instancias significaría
 *     dos `defaultBusinessId` distintos conviviendo.
 *
 * ====================== POR QUÉ IMPORTA EL PUERTO DE PEDIDOS ===============
 * `POST /discounts/validate` acepta `orderId` para cotizar sobre el subtotal REAL
 * (BR-DISC-001), y eso exige leer `orders`. El módulo de descuentos no debe
 * conocer esa tabla, así que se declara un PUERTO
 * (`discounts.order-lookup.ts`) y la implementación —que sí vive junto a los
 * datos— se conecta aquí.
 *
 * La importación es en un solo sentido: `orders/order-discount-lookup.ts` importa
 * el contrato del repositorio de pedidos y el tipo del puerto, nunca el service
 * de descuentos. Por eso no hay ciclo entre los dos módulos aunque los dos se
 * necesiten (el pedido aplica cupones y el cupón se cotiza sobre el pedido).
 *
 * ================================= MIGRACIÓN ================================
 * Cuando el integrador registre este módulo, el contenido de
 * {@link buildDiscounts} debe pasar a `build()` de `config/container.ts`.
 */
import { getContainer } from '../../config/container.js';
import { buildOrderDiscountLookup } from '../orders/order-discount-lookup.js';
import { SqliteDiscountsRepository } from './discounts.repository.sqlite.js';
import type { DiscountsRepository } from './discounts.repository.js';
import { DiscountsService } from './discounts.service.js';

/** Servicios del módulo `discounts`. */
export interface DiscountsServices {
  readonly discounts: DiscountsService;
  readonly repository: DiscountsRepository;
}

let services: DiscountsServices | null = null;

/** Construye el grafo del módulo con las implementaciones SQLite. */
function buildDiscounts(): DiscountsServices {
  // Mismo servicio de auditoría que el resto de la aplicación: una sola fuente
  // de verdad para `audit_logs` y un solo `defaultBusinessId`.
  const audit = getContainer().services.audit;
  const repository: DiscountsRepository = new SqliteDiscountsRepository();
  const discounts = new DiscountsService(repository, audit);
  discounts.attachOrderLookup(buildOrderDiscountLookup());
  return { discounts, repository };
}

/**
 * Servicios de descuentos, construidos en la primera llamada.
 *
 * `discounts.routes.ts` lo llama UNA vez, al construir su controller, que es lo
 * que hacen `catalog.routes.ts` y `customers.routes.ts` con sus contenedores.
 */
export function getDiscountsServices(): DiscountsServices {
  services ??= buildDiscounts();
  return services;
}
