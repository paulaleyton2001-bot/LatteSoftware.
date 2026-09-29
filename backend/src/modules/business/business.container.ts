/**
 * Grafo de dependencias del módulo `business` (DESIGN.md 3.6).
 *
 * ============================== POR QUÉ ES LOCAL ==============================
 * El contenedor oficial es `config/container.ts`, y ese fichero lo está
 * manteniendo otro agente en paralelo (lo cablea el integrador). Añadir aquí las
 * entradas de negocio habría creado un conflicto de edición sobre un archivo
 * compartido, así que este módulo construye SU PROPIO grafo, con las mismas
 * reglas que el contenedor general:
 *
 *  1. Se construye UNA vez por proceso y se reutiliza (perezoso).
 *  2. El repositorio NO guarda la conexión: la pide a `getConnection()` en cada
 *     llamada, así que este singletón no abre la base de datos y los tests
 *     pueden apuntarla a una base en memoria sin reconstruir nada.
 *  3. El `AuditService` se TOMA del contenedor oficial, no se crea otro: la
 *     auditoría es compartida (BR-SEC-007) y tener dos instancias significaría
 *     dos `defaultBusinessId` distintos conviviendo.
 *
 * ================================= MIGRACIÓN ================================
 * Cuando el integrador registre este módulo, el contenido de
 * {@link buildBusiness} debe pasar a `build()` de `config/container.ts` y este
 * fichero puede reducirse a reexportar los tipos. La lista exacta de cambios
 * está en el informe de entrega.
 */
import { getContainer } from '../../config/container.js';
import { SqliteBusinessRepository } from './business.repository.sqlite.js';
import type { BusinessRepository } from './business.repository.js';
import { BusinessService } from './business.service.js';

/** Servicios del módulo `business`. */
export interface BusinessServices {
  readonly business: BusinessService;
}

let services: BusinessServices | null = null;

/** Construye el grafo del módulo con la implementación SQLite. */
function buildBusiness(): BusinessServices {
  // Mismo servicio de auditoría que el resto de la aplicación: una sola fuente
  // de verdad para `audit_logs` y un solo `defaultBusinessId`.
  const audit = getContainer().services.audit;
  const repository: BusinessRepository = new SqliteBusinessRepository();
  return { business: new BusinessService(repository, audit) };
}

/**
 * Servicios del negocio, construidos en la primera llamada.
 *
 * `business.routes.ts` lo llama UNA vez, al construir su controller, que es lo
 * que hacen `catalog.routes.ts` y `customers.routes.ts` con el contenedor
 * general.
 */
export function getBusinessServices(): BusinessServices {
  services ??= buildBusiness();
  return services;
}
