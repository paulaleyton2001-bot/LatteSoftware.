/**
 * Grafo de dependencias del módulo `locations` (DESIGN.md 3.6).
 *
 * ============================== POR QUÉ ES LOCAL ==============================
 * El contenedor oficial es `config/container.ts`, y ese fichero lo está
 * manteniendo otro agente en paralelo (lo cablea el integrador). Añadir aquí las
 * entradas de sedes habría creado un conflicto de edición sobre un archivo
 * compartido, así que este módulo construye SU PROPIO grafo, con las mismas
 * reglas que el contenedor general:
 *
 *  1. Se construye UNA vez por proceso y se reutiliza (perezoso).
 *  2. El repositorio NO guarda la conexión: la pide a `getConnection()` en cada
 *     llamada, así que este singletón no abre la base de datos y los tests
 *     pueden apuntarla a una base en memoria sin reconstruir nada.
 *  3. El `AuditService` se TOMA del contenedor oficial, no se crea otro: la
 *     auditoría es compartida (BR-SEC-007).
 *
 * ================================= MIGRACIÓN ================================
 * Cuando el integrador registre este módulo, el contenido de
 * {@link buildLocations} debe pasar a `build()` de `config/container.ts` y este
 * fichero puede reducirse a reexportar los tipos. La lista exacta de cambios
 * está en el informe de entrega.
 */
import { getContainer } from '../../config/container.js';
import { SqliteLocationsRepository } from './locations.repository.sqlite.js';
import type { LocationsRepository } from './locations.repository.js';
import { LocationsService } from './locations.service.js';

/** Servicios del módulo `locations`. */
export interface LocationsServices {
  readonly locations: LocationsService;
}

let services: LocationsServices | null = null;

/** Construye el grafo del módulo con la implementación SQLite. */
function buildLocations(): LocationsServices {
  const audit = getContainer().services.audit;
  const repository: LocationsRepository = new SqliteLocationsRepository();
  return { locations: new LocationsService(repository, audit) };
}

/**
 * Servicios de sedes, construidos en la primera llamada.
 * `locations.routes.ts` lo llama UNA vez, al construir su controller.
 */
export function getLocationsServices(): LocationsServices {
  services ??= buildLocations();
  return services;
}
