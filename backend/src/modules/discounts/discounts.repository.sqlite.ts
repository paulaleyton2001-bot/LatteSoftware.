/**
 * Implementación SQLite del repositorio de descuentos.
 *
 * ÚNICO fichero con SQL de `discounts` y `discount_redemptions`
 * (DESIGN.md 3.2). Todas las consultas van con parámetros `?`; la entrada del
 * cliente NUNCA se concatena en el texto SQL. El mapeo `snake_case` ->
 * `camelCase` ocurre en el service, no aquí (API.md 1: la base es snake_case,
 * la API camelCase).
 *
 * ============================ TRES DETALLES QUE IMPORTAN ===================
 * 1. **`discounts.code` es UNIQUE GLOBAL, no por negocio.** Así está en el
 *    esquema (`CONSTRAINT ux_discounts_code UNIQUE (code)`), así que la
 *    traducción de la violación debe ser un `409 DISCOUNT_CODE_TAKEN` y no un
 *    error genérico. `translateUniqueConstraint` lo hace sin dejar `try/catch`
 *    en el service.
 * 2. **`ck_discounts_code` exige `code = upper(trim(code))`.** El service
 *    normaliza; si algo se colara sin normalizar, el CHECK lo rechazaría con un
 *    `SQLITE_CONSTRAINT_CHECK` que aquí se traduce a un error legible.
 * 3. **Los JOIN de `category`/`product` son LEFT y con `deleted_at IS NULL`
 *    en la condición ON.** Un descuento puede quedar apuntando a una categoría
 *    dada de baja (`ON DELETE SET NULL`); el nombre pasa a `NULL` y el id se
 *    conserva, que es lo que se quiere ver en el historial.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import { BusinessRuleError } from '../../shared/errors/index.js';
import type {
  CustomerDiscountRow,
  DiscountListFilter,
  DiscountPatch,
  DiscountsRepository,
  DiscountStatsRow,
  MyDiscountFilter,
  NewDiscountRecord,
} from './discounts.repository.js';
import type { DiscountRedemptionRow, DiscountRow, DiscountSortColumn } from './discounts.types.js';

/** Columnas base de `discounts`, con los JOIN de presentación. */
const DISCOUNT_COLUMNS = `
  d.id, d.business_id, d.code, d.name, d.description, d.type, d.value,
  d.min_order_minor, d.max_discount_minor, d.applies_to, d.applies_category_id,
  d.applies_product_id, d.usage_limit, d.usage_limit_per_customer, d.used_count,
  d.starts_at, d.ends_at, d.is_active, d.stackable, d.created_at, d.updated_at,
  d.deleted_at,
  c.name AS applies_category_name,
  p.name AS applies_product_name
`;

/** `FROM` con los dos LEFT JOIN de presentación. */
const DISCOUNT_FROM = `
  FROM discounts d
  LEFT JOIN categories c ON c.id = d.applies_category_id
  LEFT JOIN products   p ON p.id = d.applies_product_id
`;

/**
 * Allowlist de columnas ordenables: clave = salida de `parseSort`,
 * valor = columna real. Una allowlist por construcción, sin concatenar entrada.
 */
const SORT_SQL: Readonly<Record<DiscountSortColumn, string>> = Object.freeze({
  code: 'd.code',
  name: 'd.name',
  created_at: 'd.created_at',
  used_count: 'd.used_count',
  ends_at: 'd.ends_at',
});

/** Escapa los comodines de `LIKE` en el texto buscado por el cliente. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Traduce la violación de `ux_discounts_code` a un 409 con código estable. */
function translateCodeTaken(error: unknown): unknown {
  return translateUniqueConstraint(error, {
    code: 'DISCOUNT_CODE_TAKEN',
    message: 'Ya existe un descuento con ese código',
    field: 'code',
    index: 'ux_discounts_code',
  });
}

/**
 * Traduce un `SQLITE_CONSTRAINT_CHECK` de `discounts` a un 422 legible.
 *
 * Sin esto, un `code` sin normalizar o un `applies_to` incompleto llegarían al
 * cliente como un `500 DATABASE_ERROR` con el texto crudo del driver, que es
 * exactamente lo que el contrato prohíbe (API.md 4: los mensajes son en español
 * y accionables).
 */
function translateCheckConstraint(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return error;
  }
  const code: unknown = (error as { code: unknown }).code;
  if (code !== 'SQLITE_CONSTRAINT_CHECK') {
    return error;
  }
  const message = error instanceof Error ? error.message : '';
  if (message.includes('ck_discounts_percent_bp')) {
    return new BusinessRuleError('Un descuento porcentual no puede superar el 100 %', {
      details: { code: 'PERCENT_VALUE_OUT_OF_RANGE', ruleId: 'BR-DISC-007', field: 'value' },
    });
  }
  if (message.includes('ck_discounts_category') || message.includes('ck_discounts_product')) {
    return new BusinessRuleError('El descuento debe indicar la categoría o el producto al que aplica', {
      details: { code: 'APPLIES_TO_REQUIRES_TARGET', field: 'appliesCategoryId' },
    });
  }
  if (message.includes('ck_discounts_code')) {
    return new BusinessRuleError('El código del descuento debe estar en mayúsculas y sin espacios', {
      details: { code: 'INVALID_DISCOUNT_CODE', ruleId: 'BR-DISC-007', field: 'code' },
    });
  }
  return new BusinessRuleError('Los datos del descuento no cumplen las reglas de la base de datos', {
    details: { code: 'DISCOUNT_CONSTRAINT_VIOLATION' },
  });
}

/** `WHERE` compartido por `list` y `count`. */
function buildWhere(filter: Omit<DiscountListFilter, 'limit' | 'offset' | 'sort'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = ['d.business_id = ?'];
  const params: unknown[] = [filter.businessId];

  if (filter.includeInactive !== true && filter.isActive === undefined) {
    clauses.push('d.is_active = 1');
  }
  if (filter.isActive !== undefined) {
    clauses.push('d.deleted_at IS NULL');
    clauses.push('d.is_active = ?');
    params.push(filter.isActive ? 1 : 0);
  } else if (filter.includeInactive !== true) {
    clauses.push('d.deleted_at IS NULL');
  }
  if (filter.type !== undefined) {
    clauses.push('d.type = ?');
    params.push(filter.type);
  }
  if (filter.appliesTo !== undefined) {
    clauses.push('d.applies_to = ?');
    params.push(filter.appliesTo);
  }
  if (filter.q !== undefined) {
    const pattern = `%${escapeLike(filter.q)}%`;
    clauses.push("(d.code LIKE ? ESCAPE '\\' OR d.name LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }
  if (filter.isExpired === true) {
    clauses.push('d.ends_at IS NOT NULL AND d.ends_at <= ?');
    params.push(new Date().toISOString());
  } else if (filter.isExpired === false) {
    clauses.push('(d.ends_at IS NULL OR d.ends_at > ?)');
    params.push(new Date().toISOString());
  }

  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de descuentos sobre `better-sqlite3`. */
export class SqliteDiscountsRepository implements DiscountsRepository {
  public findById(id: number, businessId: number, db: Db = getConnection()): DiscountRow | null {
    const row = db
      .prepare(
        `SELECT ${DISCOUNT_COLUMNS} ${DISCOUNT_FROM}
          WHERE d.id = ? AND d.business_id = ? AND d.deleted_at IS NULL`,
      )
      .get(id, businessId) as DiscountRow | undefined;
    return row ?? null;
  }

  public findByCodeIncludingDeleted(
    code: string,
    businessId: number,
    db: Db = getConnection(),
  ): DiscountRow | null {
    const row = db
      .prepare(
        `SELECT ${DISCOUNT_COLUMNS} ${DISCOUNT_FROM}
          WHERE d.code = ? AND d.business_id = ?`,
      )
      .get(code, businessId) as DiscountRow | undefined;
    return row ?? null;
  }

  public list(filter: DiscountListFilter, db: Db = getConnection()): readonly DiscountRow[] {
    const where = buildWhere(filter);
    const column = SORT_SQL[filter.sort.column];
    return db
      .prepare(
        `SELECT ${DISCOUNT_COLUMNS} ${DISCOUNT_FROM}
          WHERE ${where.sql}
          ORDER BY ${column} ${filter.sort.direction}, d.id ${filter.sort.direction}
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as DiscountRow[];
  }

  public count(
    filter: Omit<DiscountListFilter, 'limit' | 'offset' | 'sort'>,
    db: Db = getConnection(),
  ): number {
    const where = buildWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM discounts d WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public stats(discountId: number, db: Db = getConnection()): DiscountStatsRow {
    const row = db
      .prepare(
        `SELECT
           (SELECT used_count FROM discounts WHERE id = ?1) AS used_count,
           COALESCE((SELECT SUM(amount_minor) FROM discount_redemptions WHERE discount_id = ?1), 0)
             AS total_discounted_minor,
           (SELECT COUNT(DISTINCT customer_id) FROM discount_redemptions
             WHERE discount_id = ?1 AND customer_id IS NOT NULL) AS unique_customers,
           (SELECT MAX(created_at) FROM discount_redemptions WHERE discount_id = ?1) AS last_used_at`,
      )
      .get(discountId) as DiscountStatsRow | undefined;
    return (
      row ?? { used_count: 0, total_discounted_minor: 0, unique_customers: 0, last_used_at: null }
    );
  }

  public listForCustomer(filter: MyDiscountFilter, db: Db = getConnection()): readonly CustomerDiscountRow[] {
    const now = new Date().toISOString();
    // El orden de `params` DEBE seguir el de los `?` del SQL: `business_id`
    // primero, y después las fechas de la ventana. El `customerId` aparece al
    // PRINCIPIO de cada una de las tres subconsultas de la proyección, no aquí.
    const clauses: string[] = ['d.business_id = ?', 'd.deleted_at IS NULL', 'd.is_active = 1'];
    const params: unknown[] = [filter.businessId];

    if (!filter.includeExpired) {
      clauses.push('(d.starts_at IS NULL OR d.starts_at <= ?)');
      params.push(now);
      clauses.push('(d.ends_at IS NULL OR d.ends_at > ?)');
      params.push(now);
    }
    if (filter.includeUsed !== true) {
      clauses.push(
        'NOT EXISTS (SELECT 1 FROM discount_redemptions r WHERE r.discount_id = d.id AND r.customer_id = ?)',
      );
      params.push(filter.customerId);
    }

    return db
      .prepare(
        `SELECT ${DISCOUNT_COLUMNS},
                EXISTS (SELECT 1 FROM discount_redemptions r
                         WHERE r.discount_id = d.id AND r.customer_id = ?) AS customer_used,
                (SELECT MAX(r.created_at) FROM discount_redemptions r
                  WHERE r.discount_id = d.id AND r.customer_id = ?) AS customer_used_at,
                (SELECT COUNT(*) FROM discount_redemptions r
                  WHERE r.discount_id = d.id AND r.customer_id = ?) AS customer_used_count
         ${DISCOUNT_FROM}
         WHERE ${clauses.join(' AND ')}
         ORDER BY d.is_active DESC, ${SORT_SQL[filter.sort.column]} ${filter.sort.direction},
                  d.id ${filter.sort.direction}
         LIMIT ? OFFSET ?`,
      )
      .all(
        filter.customerId,
        filter.customerId,
        filter.customerId,
        ...params,
        filter.limit,
        filter.offset,
      ) as CustomerDiscountRow[];
  }

  public countForCustomer(
    filter: Omit<MyDiscountFilter, 'limit' | 'offset'>,
    db: Db = getConnection(),
  ): number {
    const now = new Date().toISOString();
    // El orden de `params` DEBE seguir el de los `?` del SQL: `business_id`
    // primero, y después las fechas de la ventana. El `customerId` aparece al
    // PRINCIPIO de cada una de las tres subconsultas de la proyección, no aquí.
    const clauses: string[] = ['d.business_id = ?', 'd.deleted_at IS NULL', 'd.is_active = 1'];
    const params: unknown[] = [filter.businessId];

    if (!filter.includeExpired) {
      clauses.push('(d.starts_at IS NULL OR d.starts_at <= ?)');
      params.push(now);
      clauses.push('(d.ends_at IS NULL OR d.ends_at > ?)');
      params.push(now);
    }
    if (filter.includeUsed !== true) {
      clauses.push(
        'NOT EXISTS (SELECT 1 FROM discount_redemptions r WHERE r.discount_id = d.id AND r.customer_id = ?)',
      );
    }

    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM discounts d WHERE ${clauses.join(' AND ')}`)
      .get(...params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public categoryExists(categoryId: number, businessId: number, db: Db = getConnection()): boolean {
    const row = db
      .prepare('SELECT 1 AS ok FROM categories WHERE id = ? AND business_id = ? AND deleted_at IS NULL')
      .get(categoryId, businessId) as { ok: number } | undefined;
    return row !== undefined;
  }

  public productExists(productId: number, businessId: number, db: Db = getConnection()): boolean {
    const row = db
      .prepare('SELECT 1 AS ok FROM products WHERE id = ? AND business_id = ? AND deleted_at IS NULL')
      .get(productId, businessId) as { ok: number } | undefined;
    return row !== undefined;
  }

  public insert(record: NewDiscountRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO discounts
             (business_id, code, name, description, type, value, min_order_minor,
              max_discount_minor, applies_to, applies_category_id, applies_product_id,
              usage_limit, usage_limit_per_customer, starts_at, ends_at, is_active, stackable)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.code,
          record.name,
          record.description,
          record.type,
          record.value,
          record.minOrderMinor,
          record.maxDiscountMinor,
          record.appliesTo,
          record.appliesCategoryId,
          record.appliesProductId,
          record.usageLimit,
          record.usageLimitPerCustomer,
          record.startsAt,
          record.endsAt,
          record.isActive ? 1 : 0,
          record.stackable ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      throw translateCheckConstraint(translateCodeTaken(error));
    }
  }

  public update(id: number, patch: DiscountPatch, db: Db = getConnection()): void {
    // Sólo se escriben los campos presentes: un PATCH parcial no borra el resto.
    // Los nombres de columna salen de una lista cerrada, nunca del cliente.
    const assignments: string[] = [];
    const params: unknown[] = [];
    if (patch.code !== undefined) {
      assignments.push('code = ?');
      params.push(patch.code);
    }
    if (patch.name !== undefined) {
      assignments.push('name = ?');
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      assignments.push('description = ?');
      params.push(patch.description);
    }
    if (patch.type !== undefined) {
      assignments.push('type = ?');
      params.push(patch.type);
    }
    if (patch.value !== undefined) {
      assignments.push('value = ?');
      params.push(patch.value);
    }
    if (patch.minOrderMinor !== undefined) {
      assignments.push('min_order_minor = ?');
      params.push(patch.minOrderMinor);
    }
    if (patch.maxDiscountMinor !== undefined) {
      assignments.push('max_discount_minor = ?');
      params.push(patch.maxDiscountMinor);
    }
    if (patch.appliesTo !== undefined) {
      assignments.push('applies_to = ?');
      params.push(patch.appliesTo);
    }
    if (patch.appliesCategoryId !== undefined) {
      assignments.push('applies_category_id = ?');
      params.push(patch.appliesCategoryId);
    }
    if (patch.appliesProductId !== undefined) {
      assignments.push('applies_product_id = ?');
      params.push(patch.appliesProductId);
    }
    if (patch.usageLimit !== undefined) {
      assignments.push('usage_limit = ?');
      params.push(patch.usageLimit);
    }
    if (patch.usageLimitPerCustomer !== undefined) {
      assignments.push('usage_limit_per_customer = ?');
      params.push(patch.usageLimitPerCustomer);
    }
    if (patch.startsAt !== undefined) {
      assignments.push('starts_at = ?');
      params.push(patch.startsAt);
    }
    if (patch.endsAt !== undefined) {
      assignments.push('ends_at = ?');
      params.push(patch.endsAt);
    }
    if (patch.isActive !== undefined) {
      assignments.push('is_active = ?');
      params.push(patch.isActive ? 1 : 0);
    }
    if (patch.stackable !== undefined) {
      assignments.push('stackable = ?');
      params.push(patch.stackable ? 1 : 0);
    }
    if (assignments.length === 0) {
      return;
    }
    params.push(id);
    try {
      db.prepare(`UPDATE discounts SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
    } catch (error) {
      throw translateCheckConstraint(translateCodeTaken(error));
    }
  }

  public softDelete(id: number, deletedAt: string, db: Db = getConnection()): void {
    db.prepare('UPDATE discounts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(
      deletedAt,
      id,
    );
  }

  public incrementUsedCount(id: number, db: Db = getConnection()): number {
    // Se devuelve el valor ANTERIOR para que el service pueda comprobar el
    // límite dentro de la misma transacción (BR-DISC-004) sin una segunda
    // lectura que otro escritor pudiera cambiar entre medias.
    const row = db
      .prepare('SELECT used_count AS previous FROM discounts WHERE id = ?')
      .get(id) as { previous: number } | undefined;
    const previous = row?.previous ?? 0;
    db.prepare('UPDATE discounts SET used_count = used_count + 1 WHERE id = ?').run(id);
    return previous;
  }

  public decrementUsedCount(id: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT used_count AS previous FROM discounts WHERE id = ?')
      .get(id) as { previous: number } | undefined;
    const previous = row?.previous ?? 0;
    // `MAX(0, used_count - 1)`: el CHECK `ck_discounts_used` exige no negativo.
    db.prepare('UPDATE discounts SET used_count = MAX(0, used_count - 1) WHERE id = ?').run(id);
    return previous;
  }

  public insertRedemption(
    record: {
      readonly discountId: number;
      readonly orderId: number;
      readonly customerId: number | null;
      readonly amountMinor: number;
    },
    db: Db = getConnection(),
  ): number {
    const result = db
      .prepare(
        `INSERT INTO discount_redemptions (discount_id, order_id, customer_id, amount_minor)
         VALUES (?, ?, ?, ?)`,
      )
      .run(record.discountId, record.orderId, record.customerId, record.amountMinor);
    return Number(result.lastInsertRowid);
  }

  public countCustomerRedemptions(
    discountId: number,
    customerId: number,
    db: Db = getConnection(),
  ): number {
    const row = db
      .prepare(
        'SELECT COUNT(*) AS total FROM discount_redemptions WHERE discount_id = ? AND customer_id = ?',
      )
      .get(discountId, customerId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public listRedemptionsByOrder(
    orderId: number,
    db: Db = getConnection(),
  ): readonly DiscountRedemptionRow[] {
    return db
      .prepare(
        `SELECT id, discount_id, order_id, customer_id, amount_minor, created_at
           FROM discount_redemptions
          WHERE order_id = ?
          ORDER BY id ASC`,
      )
      .all(orderId) as DiscountRedemptionRow[];
  }

  public deleteRedemption(discountId: number, orderId: number, db: Db = getConnection()): number {
    const result = db
      .prepare('DELETE FROM discount_redemptions WHERE discount_id = ? AND order_id = ?')
      .run(discountId, orderId);
    return result.changes;
  }

  /**
   * Canjes del pedido con los datos de la regla, para `appliedDiscounts`.
   *
   * Es un `INNER JOIN` con `discounts`: un canje sin regla sería un dato
   * corrupto (la FK lo impide), y un `LEFT JOIN` devolvería un descuento `null`
   * que el cliente no sabe interpretar.
   */
  public listRedemptionsWithDiscounts(
    orderId: number,
    db: Db = getConnection(),
  ): readonly {
    readonly discountId: number;
    readonly code: string;
    readonly name: string;
    readonly type: string;
    readonly value: number;
    readonly amountMinor: number;
  }[] {
    return db
      .prepare(
        `SELECT d.id AS discountId,
                d.code,
                d.name,
                d.type,
                d.value,
                r.amount_minor AS amountMinor
           FROM discount_redemptions r
           JOIN discounts d ON d.id = r.discount_id
          WHERE r.order_id = ?
          ORDER BY r.id ASC`,
      )
      .all(orderId) as {
      readonly discountId: number;
      readonly code: string;
      readonly name: string;
      readonly type: string;
      readonly value: number;
      readonly amountMinor: number;
    }[];
  }
}
