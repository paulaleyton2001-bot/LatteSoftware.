/**
 * Contrato de persistencia del módulo `customers`.
 *
 * El filtro `EXISTS (rol = CUSTOMER)` es la condición que hace que este módulo
 * sea el directorio de clientes: no hay tabla `customers` (DESIGN.md 4.7) y un
 * empleado con rol `STAFF` no debe aparecer en `/customers` aunque tenga pedidos.
 */
import type { Db } from '../../shared/database/connection.js';
import type { Role } from '../../shared/domain/index.js';
import type {
  CustomerListFilter,
  CustomerPatch,
  CustomerSort,
  CustomerSortColumn,
  CustomerStats,
} from './customers.types.js';

// El contrato y el controller hablan de filtros y orden: se reexportan desde
// aquí para que quien importa el repositorio no tenga que conocer `*.types`.
export type { CustomerListFilter, CustomerSort, CustomerSortColumn, CustomerPatch, CustomerStats };

/** Fila de cliente sin estadísticas, tal y como sale de `users`. */
export interface CustomerRow {
  readonly id: number;
  readonly email: string;
  readonly full_name: string;
  readonly phone: string | null;
  readonly photo_url: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly email_verified_at: string | null;
  readonly last_login_at: string | null;
}

/** Repositorio del directorio de clientes. */
export interface CustomersRepository {
  /** Listado paginado de clientes, sin estadísticas. */
  list(filter: CustomerListFilter, db?: Db): readonly CustomerRow[];
  /** Total de clientes que satisfacen el filtro. */
  count(filter: Omit<CustomerListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Cliente por id. `null` si no existe o no tiene el rol `CUSTOMER`. */
  findById(id: number, db?: Db): CustomerRow | null;
  /**
   * Usuario por id, SIN exigir el rol `CUSTOMER`.
   *
   * Es lo que necesita `GET /customers/me`: el actor siempre es un `users` vivo,
   * tenga o no ficha de cliente. Devolver `null` significa que el usuario no
   * existe o está borrado lógicamente, que sí es un 404 legítimo.
   */
  findUserById(id: number, db?: Db): CustomerRow | null;
  /** `id` de un cliente por email normalizado, o `null`. */
  findIdByEmail(email: string, db?: Db): number | null;
  /** Actualiza los campos del cliente. Sin cambios: no escribe nada. */
  update(id: number, patch: CustomerPatch, db?: Db): void;
  /** Estadísticas agregadas de un cliente. */
  stats(customerId: number, db?: Db): CustomerStats;
  /** Nombres de los roles del usuario (sólo se espera `['CUSTOMER']`). */
  listRoleNames(userId: number, db?: Db): Role[];
}
