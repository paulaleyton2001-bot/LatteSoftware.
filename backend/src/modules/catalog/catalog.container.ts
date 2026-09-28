/**
 * Grafo de dependencias del módulo `catalog` (DESIGN.md 3.6).
 *
 * ============================ POR QUÉ ES LOCAL ==============================
 * El contenedor oficial es `config/container.ts`, y ese fichero lo está
 * manteniendo otro agente en paralelo (lo cablea el integrador). Añadir aquí las
 * entradas de catálogo habría creado un conflicto de edición sobre un archivo
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
 * ================================= MIGRACIÓN ================================
 * Cuando el integrador registre este módulo, el contenido de
 * {@link buildCatalog} debe pasar a `build()` de `config/container.ts` y este
 * fichero puede reducirse a reexportar los tipos. La lista exacta de cambios
 * está en el informe de entrega.
 */
import { getContainer } from '../../config/container.js';
import { SqliteCategoriesRepository } from './categories.repository.sqlite.js';
import type { CategoriesRepository } from './categories.repository.js';
import { CategoriesService } from './categories.service.js';
import { SqliteProductsRepository } from './products.repository.sqlite.js';
import type { ProductsRepository } from './products.repository.js';
import { MenuService } from './menu.service.js';
import { ProductsService } from './products.service.js';

/** Servicios del módulo `catalog`. */
export interface CatalogServices {
  readonly categories: CategoriesService;
  readonly products: ProductsService;
  readonly menu: MenuService;
}

let services: CatalogServices | null = null;

/** Construye el grafo del módulo con las implementaciones SQLite. */
function buildCatalog(): CatalogServices {
  // Mismo servicio de auditoría que el resto de la aplicación: una sola fuente
  // de verdad para `audit_logs` y un solo `defaultBusinessId`.
  const audit = getContainer().services.audit;

  const categoriesRepository: CategoriesRepository = new SqliteCategoriesRepository();
  const productsRepository: ProductsRepository = new SqliteProductsRepository();

  return {
    categories: new CategoriesService(categoriesRepository, audit),
    products: new ProductsService(productsRepository, audit),
    menu: new MenuService(productsRepository),
  };
}

/**
 * Servicios del catálogo, construidos en la primera llamada.
 *
 * `catalog.routes.ts` lo llama UNA vez, al construir sus controllers, que es lo
 * que hacen `auth.routes.ts` y `customers.routes.ts` con el contenedor general.
 */
export function getCatalogServices(): CatalogServices {
  services ??= buildCatalog();
  return services;
}
