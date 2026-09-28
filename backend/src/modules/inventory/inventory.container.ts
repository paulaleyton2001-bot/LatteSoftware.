/**
 * Grafo de dependencias del módulo `inventory` (DESIGN.md 3.6).
 *
 * ============ POR QUÉ ES LOCAL Y NO EN `config/container.ts` ===============
 * El contenedor oficial lo está manteniendo otro agente en paralelo (lo cablea
 * el integrador) y tocarlo crearía un conflicto de edición sobre un archivo
 * compartido. Se aplican aquí exactamente las mismas reglas que el contenedor
 * general:
 *
 *  1. Se construye UNA vez por proceso y se reutiliza.
 *  2. El repositorio NO guarda la conexión: la pide a `getConnection()` en cada
 *     llamada, así que este singletón no abre la base de datos y los tests
 *     pueden apuntarla a una base en memoria sin reconstruir nada.
 *  3. El `AuditService` se TOMA del contenedor oficial, no se crea otro: la
 *     auditoría es compartida (BR-SEC-007) y dos instancias tendrían dos
 *     `defaultBusinessId` distintos conviviendo.
 *
 * ================================= MIGRACIÓN ================================
 * El contenido de {@link buildInventory} debe pasar a `build()` de
 * `config/container.ts` cuando el integrador registre este módulo.
 */
import { getContainer } from '../../config/container.js';
import { SqliteInventoryRepository } from './inventory.repository.sqlite.js';
import type { InventoryRepository } from './inventory.repository.js';
import { InventoryService } from './inventory.service.js';

/** Servicios del módulo `inventory`. */
export interface InventoryServices {
  readonly inventory: InventoryService;
}

let services: InventoryServices | null = null;

/** Construye el grafo del módulo con la implementación SQLite. */
function buildInventory(): InventoryServices {
  const audit = getContainer().services.audit;
  const repository: InventoryRepository = new SqliteInventoryRepository();
  return { inventory: new InventoryService(repository, audit) };
}

/**
 * Servicios de inventario, construidos en la primera llamada.
 * `inventory.routes.ts` lo llama UNA vez, al construir su controller.
 */
export function getInventoryServices(): InventoryServices {
  services ??= buildInventory();
  return services;
}
