/**
 * Grafo de dependencias del módulo de REPORTES (DESIGN.md 3.6).
 *
 * ============ POR QUÉ ES LOCAL Y NO EN `config/container.ts` ===============
 * El contenedor oficial lo mantiene el integrador y tocarlo crearía un
 * conflicto de edición sobre un fichero compartido. Se aplican aquí las mismas
 * reglas que el contenedor general:
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
 * El contenido de {@link buildReports} debe pasar a `build()` de
 * `config/container.ts` cuando el integrador registre este módulo.
 */
import { getContainer } from '../../config/container.js';
import { SqliteReportsRepository } from './reports.repository.sqlite.js';
import type { ReportsRepository } from './reports.repository.js';
import { ReportsService } from './reports.service.js';

/** Servicios del módulo `reports`. */
export interface ReportsServices {
  readonly reports: ReportsService;
}

let services: ReportsServices | null = null;

/** Construye el grafo del módulo con la implementación SQLite. */
function buildReports(): ReportsServices {
  const audit = getContainer().services.audit;
  const repository: ReportsRepository = new SqliteReportsRepository();
  return { reports: new ReportsService(repository, audit) };
}

/**
 * Servicios de reportes, construidos en la primera llamada.
 * `reports.routes.ts` lo llama UNA vez, al construir su controller.
 */
export function getReportsServices(): ReportsServices {
  services ??= buildReports();
  return services;
}

/** Sólo para tests: descarta el grafo del módulo. */
export function resetReportsServicesForTests(): void {
  services = null;
}
