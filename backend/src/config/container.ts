/**
 * Contenedor de dependencias (DESIGN.md 3.6).
 *
 * Construye el grafo UNA vez por proceso y lo pasa por constructor. No hay
 * `reflect-metadata`, ni contenedor de IoC, ni singletons mutables de
 * repositorio: `DESIGN.md` 3.3 (punto 5) lo prohíbe expresamente y este fichero
 * es la única forma de que un repository llegue a un service.
 *
 * ===================== POR QUÉ ES UN SINGLETON PERESOSO ====================
 * `getContainer()` construye la primera vez que se llama y reutiliza después.
 * Los repositorios SQLite NO guardan la conexión: cada método llama a
 * `getConnection()`, que sí es singleton (justificado por `better-sqlite3`:
 * síncrono y single-threaded). Así el grafo puede construirse en el momento de
 * importar los routers, antes de que exista ninguna conexión, y los tests
 * siguen poder apuntar la conexión a una base en memoria.
 *
 * Para qué sirve la pereza: `modules/auth/auth.routes.ts` construye su
 * controller al importarse, y ese import ocurre desde `modules/index.ts`, que
 * `app.ts` importa para montar la API. Construir el grafo en ese momento es
 * correcto y no abre la base de datos.
 */
import { AUTH } from './constants.js';
import { env } from './env.js';
import { SqliteAuditRepository } from '../shared/database/audit.repository.sqlite.js';
import type { AuditRepository } from '../shared/database/audit.repository.js';
import { AuditService } from '../shared/services/audit.service.js';
import { SqliteAuthRepository } from '../modules/auth/auth.repository.sqlite.js';
import type { AuthRepository } from '../modules/auth/auth.repository.js';
import { AuthService } from '../modules/auth/auth.service.js';
import { TokenService } from '../modules/auth/token.service.js';
import { SqliteUsersRepository } from '../modules/users/users.repository.sqlite.js';
import type { UsersRepository } from '../modules/users/users.repository.js';
import { UsersService } from '../modules/users/users.service.js';
import { SqliteCustomersRepository } from '../modules/customers/customers.repository.sqlite.js';
import type { CustomersRepository } from '../modules/customers/customers.repository.js';
import { CustomersService } from '../modules/customers/customers.service.js';

/** Repositorios construidos. Útil para los tests y para los próximos módulos. */
export interface Repositories {
  readonly audit: AuditRepository;
  readonly auth: AuthRepository;
  readonly users: UsersRepository;
  readonly customers: CustomersRepository;
}

/** Servicios de la aplicación. */
export interface Services {
  readonly audit: AuditService;
  readonly auth: AuthService;
  readonly users: UsersService;
  readonly customers: CustomersService;
}

/** Grafo completo: repositorios y servicios ya conectados. */
export interface Container {
  readonly repositories: Repositories;
  readonly services: Services;
}

let container: Container | null = null;

/** Construye el grafo completo con las implementaciones SQLite. */
function build(): Container {
  const repositories: Repositories = {
    audit: new SqliteAuditRepository(),
    auth: new SqliteAuthRepository(),
    users: new SqliteUsersRepository(),
    customers: new SqliteCustomersRepository(),
  };

  // El servicio de tokens comparte el repositorio de auth: las sesiones son su
  // agregado, no el de un módulo distinto.
  const tokens = new TokenService(repositories.auth);

  const audit = new AuditService(repositories.audit, AUTH.DEFAULT_BUSINESS_ID);

  const services: Services = {
    audit,
    auth: new AuthService(repositories.auth, tokens, audit),
    users: new UsersService(repositories.users, tokens, audit),
    customers: new CustomersService(repositories.customers, audit),
  };

  return { repositories, services };
}

/**
 * Devuelve el contenedor, construyéndolo en la primera llamada.
 *
 * Un módulo debe llamar a `getContainer()` UNA vez, al construirse su
 * controller, y capturar el resultado. Nunca dentro de un handler: eso
 * recrearía el grafo por petición.
 */
export function getContainer(): Container {
  container ??= build();
  return container;
}

/**
 * Descarta el grafo. Sólo para tests que cambian la base de datos entre casos.
 * Como los repositorios vuelven a pedir la conexión en cada llamada, no es
 * necesario para cambiar de base, pero deja el estado limpio.
 */
export function resetContainerForTests(): void {
  container = null;
}

/** `true` si el grafo ya está construido. Sólo informativo (arranque, tests). */
export function isContainerBuilt(): boolean {
  return container !== null;
}

/** Descripción del entorno, para el log de arranque. */
export function containerSummary(): Record<string, unknown> {
  return {
    modules: ['auth', 'users', 'customers'],
    repositories: ['audit', 'auth', 'users', 'customers'],
    appEnv: env.appEnv,
    defaultBusinessId: AUTH.DEFAULT_BUSINESS_ID,
  };
}
