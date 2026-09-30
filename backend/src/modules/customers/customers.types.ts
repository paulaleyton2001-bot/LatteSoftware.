/**
 * DTOs de dominio del módulo `customers` (API.md 7.3).
 *
 * RECORDATORIO IMPORTANTE: **no existe una tabla `customers`**. DESIGN.md 4.7
 * fija 34 tablas y ninguna es de clientes; API.md 7.3 lo dice literalmente:
 * "`customers` son usuarios con rol `CUSTOMER`". Por eso este módulo trabaja
 * sobre `users` filtradas por rol y no inventa una entidad nueva: un cliente que
 * se da de baja deja de tener el rol, no una fila que borrar.
 *
 * Las estadísticas se calculan de las tablas que YA existen en el esquema
 * (`orders`, `payments`, `chair_reservations`, `chair_rentals`). Son consultas
 * de sólo lectura sobre tablas vacías mientras no haya módulos de pedidos: con
 * cero filas devuelven 0, que es la respuesta correcta.
 */
import type { Role, UserStatus } from '../../shared/domain/index.js';

/** Cliente visto por un operador. */
export interface CustomerView {
  readonly id: number;
  readonly email: string;
  readonly fullName: string;
  readonly phone: string | null;
  readonly photoUrl: string | null;
  readonly status: UserStatus;
  readonly roles: readonly Role[];
  readonly emailVerifiedAt: string | null;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stats: CustomerStats;
}

/**
 * Respuesta de `GET /customers/me`.
 *
 * Es la vista de cliente MÁS un indicador explícito de si el actor tiene ficha
 * de cliente (es decir, si su usuario tiene el rol `CUSTOMER`). Existe para no
 * tener que deducirlo de un 404: el endpoint responde 200 para cualquier usuario
 * autenticado, y quien no tenga ficha lo dice con `hasCustomerProfile: false`.
 *
 * No se anida en `customerProfile: CustomerView | null` a propósito: el cliente
 * (Flutter) y las pruebas ya leen `data.stats` y `data.email` en la raíz, y un
 * envoltorio anulado obligaría a cambiar el contrato de un caso que hoy funciona
 * para no arreglar el otro.
 */
export interface CustomerProfileView extends CustomerView {
  /** `false` si el usuario existe pero no tiene rol `CUSTOMER` (personal). */
  readonly hasCustomerProfile: boolean;
}

/**
 * Estadísticas de cliente. Los importes son SIEMPRE enteros en centavos
 * (`INTEGER`, nunca `REAL`): P4 de DESIGN.md.
 */
export interface CustomerStats {
  /** Pedidos no cancelados del cliente. */
  readonly totalOrders: number;
  /** Suma de los pagos APROBADOS: es dinero realmente cobrado, no pendiente. */
  readonly totalSpentMinor: number;
  readonly firstOrderAt: string | null;
  readonly lastOrderAt: string | null;
  readonly totalReservations: number;
  /** Minutos facturados en alquileres completados. */
  readonly totalRentalMinutes: number;
  /** Reservas en curso (`PENDING`, `CONFIRMED`, `ACTIVE`). */
  readonly activeReservations: number;
  /** Alquileres abiertos (`ACTIVE`, `EXTENDED`). */
  readonly activeRentals: number;
}

/** Campos que un cliente puede editar sobre su propio registro. */
export interface CustomerPatch {
  readonly fullName?: string;
  readonly phone?: string | null;
  readonly photoUrl?: string | null;
  readonly email?: string;
}

/** Filtros de `GET /customers` (API.md 7.3). */
export interface CustomerListFilter {
  readonly q?: string;
  readonly status?: UserStatus;
  readonly hasOrders?: boolean;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly limit: number;
  readonly offset: number;
  readonly sort: CustomerSort;
}

/** Orden validado contra la allowlist del endpoint. */
export interface CustomerSort {
  readonly column: CustomerSortColumn;
  readonly direction: 'ASC' | 'DESC';
}

/** Columnas por las que se permite ordenar `GET /customers`. */
export type CustomerSortColumn = 'created_at' | 'full_name' | 'last_order_at';

/** Página de clientes. */
export interface CustomerPage {
  readonly items: readonly CustomerView[];
  readonly total: number;
}
