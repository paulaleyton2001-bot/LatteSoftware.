/**
 * Punto de composición de la FAMILIA DE ESPACIOS: zonas/sillas, reservas y
 * alquileres.
 *
 * ============================================================================
 * POR QUÉ EXISTE ESTE FICHERO
 * ============================================================================
 * El grafo de dependencias lo construye `config/container.ts` (DESIGN.md 3.6) y
 * los routers de cada módulo leen sus services de ahí, igual que hacen `auth`,
 * `users` y `customers`. Este fichero hace EXACTAMENTE lo mismo para los tres
 * services de esta familia, con la única diferencia de que construye sus
 * repositorios aquí en vez de en el contenedor.
 *
 * Motivo: `config/container.ts` y `modules/index.ts` están siendo editados por
 * otro agente en paralelo, y este módulo no los toca. Es un punto de extensión
 * provisional y su propia documentación dice qué hacer con él (abajo).
 *
 * ============================================================================
 * CÓMO SE USA
 * ============================================================================
 *   import { getReservationsService } from '../spaces/spaces.provider.js';
 *   const controller = new ReservationsController(getReservationsService());
 *
 * Los tres services se construyen UNA vez (perezosos) y se reutilizan. Son
 * stateless: no guardan ni conexión ni estado de negocio, todo va al UnitOfWork.
 *
 * ============================================================================
 * CÓMO SUSTITUIRLO AL INTEGRAR
 * ============================================================================
 * Lo natural es mover estas tres líneas a `build()` de `config/container.ts`:
 *
 *   spaces:       new SpacesService(SqliteSpacesRepository, SqliteReservationsRepository, SqliteRentalsRepository, audit)
 *   rentals:      new RentalsService(SqliteRentalsRepository, services.spaces, SqliteReservationsRepository, audit)
 *   reservations: new ReservationsService(SqliteReservationsRepository, services.rentals, services.spaces, audit)
 *
 * y cambiar una línea en cada routes:
 *
 *   const controller = new ReservationsController(getContainer().services.reservations);
 *
 * Con esa change, este fichero se borra y no queda ninguna referencia a él. Las
 * dependencias de constructor de los tres services están YA en ese orden, así que
 * el cambio es mecánico.
 *
 * ============================================================================
 * EL GRAFO ES UN DAG, NO UN CICLO
 * ============================================================================
 *   SpacesService  -> (repositorios: espacios, reservas, alquileres)
 *   RentalsService -> (repositorio: alquileres) + SpacesService + (reservas)
 *   ReservationsService -> (repositorio: reservas) + RentalsService + SpacesService
 *
 * `SpacesService` NO depende de los otros dos services, sólo de sus
 * repositorios: por eso puede ser la raíz sin que ningún par se importe mutuamente.
 * Los tres constructores reciben interfaces de repositorio, nunca
 * implementaciones, así que un test puede inyectar dobles sin tocar este fichero.
 */
import { getContainer } from '../../config/container.js';
import { SqliteReservationsRepository } from '../reservations/reservations.repository.sqlite.js';
import type { ReservationsRepository } from '../reservations/reservations.repository.js';
import { ReservationsService } from '../reservations/reservations.service.js';
import { SqliteRentalsRepository } from '../rentals/rentals.repository.sqlite.js';
import type { RentalsRepository } from '../rentals/rentals.repository.js';
import { RentalsService } from '../rentals/rentals.service.js';
import { SqliteSpacesRepository } from './spaces.repository.sqlite.js';
import type { SpacesRepository } from './spaces.repository.js';
import { SpacesService } from './spaces.service.js';

let spacesRepository: SpacesRepository | null = null;
let reservationsRepository: ReservationsRepository | null = null;
let rentalsRepository: RentalsRepository | null = null;
let spacesService: SpacesService | null = null;
let rentalsService: RentalsService | null = null;
let reservationsService: ReservationsService | null = null;

/** Repositorio de zonas y sillas. */
export function getSpacesRepository(): SpacesRepository {
  spacesRepository ??= new SqliteSpacesRepository();
  return spacesRepository;
}

/** Repositorio de reservas (`chair_reservations`). */
export function getReservationsRepository(): ReservationsRepository {
  reservationsRepository ??= new SqliteReservationsRepository();
  return reservationsRepository;
}

/** Repositorio de alquileres y sus extensiones. */
export function getRentalsRepository(): RentalsRepository {
  rentalsRepository ??= new SqliteRentalsRepository();
  return rentalsRepository;
}

/** Servicio de zonas y sillas. */
export function getSpacesService(): SpacesService {
  spacesService ??= new SpacesService(
    getSpacesRepository(),
    getReservationsRepository(),
    getRentalsRepository(),
    // La auditoría es transversal y ya la construye el contenedor (BR-SEC-007).
    getContainer().services.audit,
  );
  return spacesService;
}

/** Servicio de alquileres. */
export function getRentalsService(): RentalsService {
  rentalsService ??= new RentalsService(
    getRentalsRepository(),
    getSpacesService(),
    getReservationsRepository(),
    getContainer().services.audit,
  );
  return rentalsService;
}

/** Servicio de reservas. */
export function getReservationsService(): ReservationsService {
  reservationsService ??= new ReservationsService(
    getReservationsRepository(),
    getRentalsService(),
    getSpacesService(),
    getContainer().services.audit,
  );
  return reservationsService;
}

/** Sólo para tests: descarta los services construidos. */
export function resetSpacesProviderForTests(): void {
  spacesRepository = null;
  reservationsRepository = null;
  rentalsRepository = null;
  spacesService = null;
  rentalsService = null;
  reservationsService = null;
}
