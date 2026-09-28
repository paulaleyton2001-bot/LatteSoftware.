/**
 * Implementación SQLite del repositorio de clientes.
 *
 * ÚNICO fichero del módulo con SQL.
 *
 *  - Un cliente es un `users` con rol `CUSTOMER`: el filtro es un `EXISTS` sobre
 *    `user_roles` + `roles`, y se usa tanto en el listado como en el detalle. Un
 *    empleado con pedidos NO aparece en `/customers` (API.md 7.3).
 *  - Las estadísticas son agregados sobre `orders`, `payments`,
 *    `chair_reservations` y `chair_rentals`, que ya existen en el esquema. Los
 *    importes se suman en enteros (centavos), nunca en `REAL` (P4).
 *  - `last_order_at` no es una columna: es un subselect sobre `orders`. Por eso
 *    `SORT_SQL` traduce el nombre lógico a la expresión real, en lugar de
 *    interpolar lo que llegue del cliente.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { Role, isEnumValue } from '../../shared/domain/index.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import type {
  CustomerListFilter,
  CustomerRow,
  CustomerSortColumn,
  CustomersRepository,
} from './customers.repository.js';
import type { CustomerPatch, CustomerStats } from './customers.types.js';

/** Columnas de la vista de cliente. */
const CUSTOMER_COLUMNS = `
  u.id, u.email, u.full_name, u.phone, u.photo_url, u.status,
  u.created_at, u.updated_at, u.email_verified_at, u.last_login_at
`;

/** Expresión de la última actividad del cliente, usada en listado y detalle. */
const LAST_ORDER_AT_SQL = '(SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = u.id)';

/**
 * Allowlist de columnas ordenables: clave = salida de `parseSort`,
 * valor = expresión SQL. `last_order_at` es un subselect porque el dato vive en
 * `orders`, no en `users`.
 */
const SORT_SQL: Readonly<Record<CustomerSortColumn, string>> = Object.freeze({
  created_at: 'u.created_at',
  full_name: 'u.full_name',
  last_order_at: LAST_ORDER_AT_SQL,
});

/** `WHERE` compartido por `list` y `count`. */
function buildWhere(filter: Omit<CustomerListFilter, 'limit' | 'offset' | 'sort'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [
    'u.deleted_at IS NULL',
    'EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = ?)',
  ];
  const params: unknown[] = [Role.CUSTOMER];

  if (filter.status !== undefined) {
    clauses.push('u.status = ?');
    params.push(filter.status);
  }
  if (filter.q !== undefined) {
    const pattern = `%${filter.q}%`;
    clauses.push('(u.email LIKE ? OR u.full_name LIKE ? OR u.phone LIKE ?)');
    params.push(pattern, pattern, pattern);
  }
  if (filter.hasOrders !== undefined) {
    const subquery = 'EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = u.id AND o.deleted_at IS NULL)';
    clauses.push(filter.hasOrders ? subquery : `NOT ${subquery}`);
  }
  if (filter.createdFrom !== undefined) {
    clauses.push('u.created_at >= ?');
    params.push(filter.createdFrom);
  }
  if (filter.createdTo !== undefined) {
    clauses.push('u.created_at < ?');
    params.push(filter.createdTo);
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de clientes sobre `better-sqlite3`. */
export class SqliteCustomersRepository implements CustomersRepository {
  public list(filter: CustomerListFilter, db: Db = getConnection()): readonly CustomerRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${CUSTOMER_COLUMNS}
           FROM users u
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, u.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as CustomerRow[];
  }

  public count(
    filter: Omit<CustomerListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM users u WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findById(id: number, db: Db = getConnection()): CustomerRow | null {
    const row = db
      .prepare(
        `SELECT ${CUSTOMER_COLUMNS}
           FROM users u
          WHERE u.id = ?
            AND u.deleted_at IS NULL
            AND EXISTS (
              SELECT 1 FROM user_roles ur
              JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id AND r.name = ?
            )`,
      )
      .get(id, Role.CUSTOMER) as CustomerRow | undefined;
    return row ?? null;
  }

  public findIdByEmail(email: string, db: Db = getConnection()): number | null {
    const row = db
      .prepare('SELECT id FROM users WHERE email = ? AND deleted_at IS NULL')
      .get(email) as { id: number } | undefined;
    return row?.id ?? null;
  }

  public update(id: number, patch: CustomerPatch, db: Db = getConnection()): void {
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.fullName !== undefined) {
      assignments.push('full_name = ?');
      params.push(patch.fullName);
    }
    if (patch.phone !== undefined) {
      assignments.push('phone = ?');
      params.push(patch.phone);
    }
    if (patch.photoUrl !== undefined) {
      assignments.push('photo_url = ?');
      params.push(patch.photoUrl);
    }
    if (patch.email !== undefined) {
      assignments.push('email = ?');
      params.push(patch.email);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(id);
    try {
      db.prepare(`UPDATE users SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateUniqueConstraint(error, {
        code: 'EMAIL_TAKEN',
        message: 'Ya existe una cuenta con ese correo electrónico',
        field: 'email',
        index: 'ux_users_email',
      });
    }
  }

  /**
   * Estadísticas del cliente, en tres consultas de agregado.
   *
   *  - `totalSpentMinor` suma `payments.amount_minor` de los pagos APROBADOS:
   *    dinero cobrado de verdad. Sumar `orders.total_minor` contaría pedidos
   *    impagados y duplicaría el importe en un pedido con dos pagos.
   *  - `totalOrders` excluye `DRAFT` (pedido en borrador) y `CANCELLED`.
   *  - `totalRentalMinutes` suma `billed_minutes` de alquileres `COMPLETED`: es
   *    el tiempo facturado, que es el que el cliente pagó (BR-RENTAL-002).
   */
  public stats(customerId: number, db: Db = getConnection()): CustomerStats {
    const orders = db
      .prepare(
        `SELECT COUNT(*) AS total,
                MIN(created_at) AS first_at,
                MAX(created_at) AS last_at
           FROM orders
          WHERE customer_id = ?
            AND deleted_at IS NULL
            AND status NOT IN ('DRAFT', 'CANCELLED')`,
      )
      .get(customerId) as { total: number; first_at: string | null; last_at: string | null } | undefined;

    const spent = db
      .prepare(
        `SELECT COALESCE(SUM(amount_minor), 0) AS total
           FROM payments
          WHERE customer_id = ?
            AND status = 'APPROVED'`,
      )
      .get(customerId) as { total: number } | undefined;

    const reservations = db
      .prepare(
        `SELECT
            SUM(CASE WHEN status IN ('PENDING','CONFIRMED','ACTIVE') THEN 1 ELSE 0 END) AS active,
            SUM(CASE WHEN status <> 'CANCELLED' THEN 1 ELSE 0 END) AS total
           FROM chair_reservations
          WHERE customer_id = ?`,
      )
      .get(customerId) as { active: number | null; total: number | null } | undefined;

    const rentals = db
      .prepare(
        `SELECT
            SUM(CASE WHEN status IN ('ACTIVE','EXTENDED') THEN 1 ELSE 0 END) AS active,
            COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN billed_minutes ELSE 0 END), 0) AS minutes
           FROM chair_rentals
          WHERE customer_id = ?`,
      )
      .get(customerId) as { active: number | null; minutes: number } | undefined;

    return {
      totalOrders: orders?.total ?? 0,
      totalSpentMinor: spent?.total ?? 0,
      firstOrderAt: orders?.first_at ?? null,
      lastOrderAt: orders?.last_at ?? null,
      totalReservations: reservations?.total ?? 0,
      totalRentalMinutes: rentals?.minutes ?? 0,
      activeReservations: reservations?.active ?? 0,
      activeRentals: rentals?.active ?? 0,
    };
  }

  public listRoleNames(customerId: number, db: Db = getConnection()): Role[] {
    const rows = db
      .prepare(
        `SELECT r.name
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = ?
          ORDER BY r.id ASC`,
      )
      .all(customerId) as { name: string }[];
    return rows.map((row) => row.name).filter((name): name is Role => isEnumValue(Role, name));
  }
}
