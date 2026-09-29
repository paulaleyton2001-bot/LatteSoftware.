/**
 * Implementación SQLite del repositorio de la configuración del negocio.
 *
 * ÚNICO fichero con SQL de `businesses`, `business_hours` y `business_holidays`
 * (DESIGN.md 3.2). Todas las consultas van con parámetros `?`: la entrada del
 * cliente NUNCA se concatena en el texto SQL. El mapeo `snake_case` ->
 * `camelCase` ocurre en el service, no aquí (esta capa devuelve filas crudas).
 *
 * ============================== TRES DETALLES QUE IMPORTAN =================
 * 1. **`default_tips_bp` es un CSV.** La API lo expone como `string[]` y la
 *    columna es `TEXT`: la conversión va en el service, no aquí.
 * 2. **`upsertHour` usa `ON CONFLICT`.** `UNIQUE(business_id, day_of_week)`
 *    convierte `PUT /hours` en un reemplazo idempotente de la semana: 7 filas,
 *    ni una más, aunque se llame 100 veces.
 * 3. **Festivos en rango para el estado del local.** `listHolidaysBetween` trae
 *    los 7 días siguientes en UNA consulta, para que `GET /business/status` no
 *    tenga que recorrer la tabla entera.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { translateUniqueConstraint } from '../../shared/database/constraint-errors.js';
import type {
  BusinessPatch,
  BusinessRepository,
  HolidayListFilter,
  NewHolidayRecord,
  NewHourRecord,
} from './business.repository.js';
import type {
  BusinessHolidayRow,
  BusinessHourRow,
  BusinessRow,
} from './business.types.js';

/** Columnas de `businesses`, en el orden de la interfaz `BusinessRow`. */
const BUSINESS_COLUMNS = `
  id, name, legal_name, logo_url, tax_id, email, phone,
  address_line1, address_line2, city, country,
  currency_code, currency_symbol, locale, timezone,
  tax_rate_bp, tax_inclusive, service_fee_bp, tip_enabled, default_tips_bp,
  max_reservation_minutes, chair_default_price_minor,
  allow_negative_stock, low_stock_alert_threshold, order_prefix,
  created_at, updated_at
`;

/** Columnas de `business_hours`. */
const HOUR_COLUMNS = 'id, business_id, day_of_week, opens_at, closes_at, is_closed';

/** Columnas de `business_holidays`. */
const HOLIDAY_COLUMNS = 'id, business_id, holiday_date, name, is_closed';

/** Traducción de la violación de unicidad de un festivo duplicado. */
const HOLIDAY_DUPLICATE = {
  code: 'HOLIDAY_ALREADY_EXISTS',
  message: 'Ya existe un festivo registrado para esa fecha',
  field: 'holidayDate',
  index: 'ux_business_holidays_date',
} as const;

/** `WHERE` compartido por `listHolidays` y `countHolidays`. */
function buildHolidayWhere(filter: Omit<HolidayListFilter, 'limit' | 'offset'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = ['business_id = ?'];
  const params: unknown[] = [filter.businessId];
  if (filter.from !== undefined) {
    clauses.push('holiday_date >= ?');
    params.push(filter.from);
  }
  if (filter.to !== undefined) {
    clauses.push('holiday_date <= ?');
    params.push(filter.to);
  }
  return { sql: clauses.join(' AND '), params };
}

/** Repositorio de la configuración del negocio sobre `better-sqlite3`. */
export class SqliteBusinessRepository implements BusinessRepository {
  public findById(id: number, db: Db = getConnection()): BusinessRow | null {
    const row = db
      .prepare(`SELECT ${BUSINESS_COLUMNS} FROM businesses WHERE id = ? LIMIT 1`)
      .get(id) as BusinessRow | undefined;
    return row ?? null;
  }

  public update(id: number, patch: BusinessPatch, db: Db = getConnection()): void {
    // Sólo se escriben los campos presentes: un PATCH parcial no borra el resto.
    // Los nombres de columna salen de esta lista cerrada, nunca del cliente.
    const assignments: string[] = [];
    const params: unknown[] = [];

    const setText = (column: string, value: string | null | undefined): void => {
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        params.push(value);
      }
    };
    const setNumber = (column: string, value: number | undefined): void => {
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        params.push(value);
      }
    };
    const setFlag = (column: string, value: boolean | undefined): void => {
      if (value !== undefined) {
        assignments.push(`${column} = ?`);
        params.push(value ? 1 : 0);
      }
    };

    setText('name', patch.name);
    setText('legal_name', patch.legalName);
    setText('logo_url', patch.logoUrl);
    setText('tax_id', patch.taxId);
    setText('email', patch.email);
    setText('phone', patch.phone);
    setText('address_line1', patch.addressLine1);
    setText('address_line2', patch.addressLine2);
    setText('city', patch.city);
    setText('country', patch.country);
    setText('currency_code', patch.currencyCode);
    setText('currency_symbol', patch.currencySymbol);
    setText('locale', patch.locale);
    setText('timezone', patch.timezone);
    setNumber('tax_rate_bp', patch.taxRateBp);
    setFlag('tax_inclusive', patch.taxInclusive);
    setNumber('service_fee_bp', patch.serviceFeeBp);
    setFlag('tip_enabled', patch.tipEnabled);
    setText('default_tips_bp', patch.defaultTipsBpCsv);
    setNumber('max_reservation_minutes', patch.maxReservationMinutes);
    setNumber('chair_default_price_minor', patch.chairDefaultPriceMinor);
    setFlag('allow_negative_stock', patch.allowNegativeStock);
    setNumber('low_stock_alert_threshold', patch.lowStockAlertThreshold);
    setText('order_prefix', patch.orderPrefix);

    if (assignments.length === 0) {
      return;
    }
    params.push(id);
    db.prepare(`UPDATE businesses SET ${assignments.join(', ')} WHERE id = ?`).run(...params);
  }

  public countOrders(businessId: number, db: Db = getConnection()): number {
    const row = db
      .prepare('SELECT COUNT(*) AS total FROM orders WHERE business_id = ?')
      .get(businessId) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  // --- Horario -------------------------------------------------------------

  public listHours(businessId: number, db: Db = getConnection()): readonly BusinessHourRow[] {
    return db
      .prepare(
        `SELECT ${HOUR_COLUMNS}
           FROM business_hours
          WHERE business_id = ?
          ORDER BY day_of_week ASC`,
      )
      .all(businessId) as BusinessHourRow[];
  }

  public upsertHour(record: NewHourRecord, db: Db = getConnection()): void {
    db.prepare(
      `INSERT INTO business_hours (business_id, day_of_week, opens_at, closes_at, is_closed)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (business_id, day_of_week)
       DO UPDATE SET opens_at = excluded.opens_at,
                     closes_at = excluded.closes_at,
                     is_closed = excluded.is_closed`,
    ).run(
      record.businessId,
      record.dayOfWeek,
      record.opensAt,
      record.closesAt,
      record.isClosed ? 1 : 0,
    );
  }

  // --- Festivos ------------------------------------------------------------

  public listHolidays(filter: HolidayListFilter, db: Db = getConnection()): readonly BusinessHolidayRow[] {
    const where = buildHolidayWhere(filter);
    return db
      .prepare(
        `SELECT ${HOLIDAY_COLUMNS}
           FROM business_holidays
          WHERE ${where.sql}
          ORDER BY holiday_date DESC, id DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...where.params, filter.limit, filter.offset) as BusinessHolidayRow[];
  }

  public countHolidays(
    filter: Omit<HolidayListFilter, 'limit' | 'offset'>,
    db: Db = getConnection(),
  ): number {
    const where = buildHolidayWhere(filter);
    const row = db
      .prepare(`SELECT COUNT(*) AS total FROM business_holidays WHERE ${where.sql}`)
      .get(...where.params) as { total: number } | undefined;
    return row?.total ?? 0;
  }

  public findHolidayById(id: number, businessId: number, db: Db = getConnection()): BusinessHolidayRow | null {
    const row = db
      .prepare(
        `SELECT ${HOLIDAY_COLUMNS}
           FROM business_holidays
          WHERE id = ?
            AND business_id = ?
          LIMIT 1`,
      )
      .get(id, businessId) as BusinessHolidayRow | undefined;
    return row ?? null;
  }

  public findHolidayByDate(date: string, businessId: number, db: Db = getConnection()): BusinessHolidayRow | null {
    const row = db
      .prepare(
        `SELECT ${HOLIDAY_COLUMNS}
           FROM business_holidays
          WHERE holiday_date = ?
            AND business_id = ?
          LIMIT 1`,
      )
      .get(date, businessId) as BusinessHolidayRow | undefined;
    return row ?? null;
  }

  public listHolidaysBetween(
    businessId: number,
    from: string,
    to: string,
    db: Db = getConnection(),
  ): readonly BusinessHolidayRow[] {
    return db
      .prepare(
        `SELECT ${HOLIDAY_COLUMNS}
           FROM business_holidays
          WHERE business_id = ?
            AND holiday_date >= ?
            AND holiday_date <= ?
          ORDER BY holiday_date ASC`,
      )
      .all(businessId, from, to) as BusinessHolidayRow[];
  }

  public insertHoliday(record: NewHolidayRecord, db: Db = getConnection()): number {
    try {
      const result = db
        .prepare(
          `INSERT INTO business_holidays (business_id, holiday_date, name, is_closed)
           VALUES (?, ?, ?, ?)`,
        )
        .run(
          record.businessId,
          record.holidayDate,
          record.name,
          record.isClosed ? 1 : 0,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // `ux_business_holidays_date` es la garantía final contra dos festivos en
      // la misma fecha, aunque dos altas simultáneas esquiven la comprobación
      // previa del service.
      throw translateUniqueConstraint(error, HOLIDAY_DUPLICATE);
    }
  }

  public deleteHoliday(id: number, businessId: number, db: Db = getConnection()): number {
    const result = db
      .prepare('DELETE FROM business_holidays WHERE id = ? AND business_id = ?')
      .run(id, businessId);
    return result.changes;
  }
}
