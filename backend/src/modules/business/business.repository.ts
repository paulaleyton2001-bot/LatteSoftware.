/**
 * Contrato de persistencia de la configuración del negocio.
 *
 * Es una INTERFAZ y no una clase: el service depende de este contrato, nunca de
 * SQLite (DESIGN.md 3.1, regla P3). La implementación vive en
 * `business.repository.sqlite.ts`, único fichero del módulo con SQL.
 *
 * REGLAS QUE RESPETA:
 *  - Ningún método abre ni cierra transacción: la abre el service con
 *    `runInTransactionSync`.
 *  - Los identificadores dinámicos (columna de orden) NO se interpolan desde
 *    fuera: se interpolan desde una allowlist interna de la implementación.
 *  - Un método = una cosa. Nada de "updateAndReorderAndAudit".
 *  - Aquí NO hay reglas de negocio: que la moneda no cambie con pedidos
 *    existentes, que la semana tenga siete días o que un festivo esté repetido
 *    lo decide `business.service.ts`.
 */
import type { Db } from '../../shared/database/connection.js';
import type {
  BusinessHolidayRow,
  BusinessHourRow,
  BusinessRow,
} from './business.types.js';

/** Campos actualizables de `businesses`, ya validados por el service. */
export interface BusinessPatch {
  readonly name?: string;
  readonly legalName?: string | null;
  readonly logoUrl?: string | null;
  readonly taxId?: string | null;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly addressLine1?: string | null;
  readonly addressLine2?: string | null;
  readonly city?: string | null;
  readonly country?: string | null;
  readonly currencyCode?: string;
  readonly currencySymbol?: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly taxRateBp?: number;
  readonly taxInclusive?: boolean;
  readonly serviceFeeBp?: number;
  readonly tipEnabled?: boolean;
  /** Ya serializado como CSV (API.md 7.4: en la API es `string[]`). */
  readonly defaultTipsBpCsv?: string;
  readonly maxReservationMinutes?: number;
  readonly chairDefaultPriceMinor?: number;
  readonly allowNegativeStock?: boolean;
  readonly lowStockAlertThreshold?: number;
  readonly orderPrefix?: string;
}

/** Filtros de `GET /api/v1/business/holidays`. */
export interface HolidayListFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  /** `YYYY-MM-DD` inclusive. */
  readonly from?: string;
  /** `YYYY-MM-DD` inclusive. */
  readonly to?: string;
  /** `false` oculta los festivos ya pasados (por defecto se incluyen). */
  readonly includePast?: boolean;
}

/** Datos insertados en `business_holidays`. */
export interface NewHolidayRecord {
  readonly businessId: number;
  readonly holidayDate: string;
  readonly name: string;
  readonly isClosed: boolean;
}

/** Fila de `business_hours` a insertar o actualizar. */
export interface NewHourRecord {
  readonly businessId: number;
  readonly dayOfWeek: number;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly isClosed: boolean;
}

/** Repositorio de la configuración del negocio. */
export interface BusinessRepository {
  /**
   * Negocio por id. `null` si no existe: en v1 es un singleton sembrado con
   * `id = 1`, y un despliegue sin sembrar no tiene nada que devolver.
   */
  findById(id: number, db?: Db): BusinessRow | null;

  /** Actualiza sólo los campos presentes. */
  update(id: number, patch: BusinessPatch, db?: Db): void;

  /**
   * Número de pedidos del negocio. Lo usa el service para bloquear el cambio de
   * moneda: un pedido guarda sus importes en la moneda con la que se creó y un
   * histórico en COP no puede reinterpretarse en USD.
   */
  countOrders(businessId: number, db?: Db): number;

  // --- Horario -------------------------------------------------------------

  /**
   * Días de horario realmente persistidos. Puede devolver menos de siete (o
   * ninguno) si el despliegue no ha configurado el horario: el service decide
   * qué mostrar en ese caso.
   */
  listHours(businessId: number, db?: Db): readonly BusinessHourRow[];

  /** Inserta o actualiza el día indicado (`UNIQUE(business_id, day_of_week)`). */
  upsertHour(record: NewHourRecord, db?: Db): void;

  // --- Festivos ------------------------------------------------------------

  /** Listado paginado por fecha, de más reciente a más antiguo. */
  listHolidays(filter: HolidayListFilter, db?: Db): readonly BusinessHolidayRow[];

  /** Total de festivos que satisfacen el filtro. */
  countHolidays(
    filter: Omit<HolidayListFilter, 'limit' | 'offset'>,
    db?: Db,
  ): number;

  /** Festivo por id dentro del negocio. `null` si no existe. */
  findHolidayById(id: number, businessId: number, db?: Db): BusinessHolidayRow | null;

  /**
   * Festivo por fecha, INCLUDING el borrado. La tabla no tiene `deleted_at`, así
   * que "borrado" es físico, pero el método existe para dejar explícito que la
   * comprobación de duplicados es contra el `UNIQUE(business_id, holiday_date)`.
   */
  findHolidayByDate(date: string, businessId: number, db?: Db): BusinessHolidayRow | null;

  /** Festivos entre dos fechas, para el cálculo de "abre/cierra" (sin paging). */
  listHolidaysBetween(
    businessId: number,
    from: string,
    to: string,
    db?: Db,
  ): readonly BusinessHolidayRow[];

  /** Inserta el festivo y devuelve su id. */
  insertHoliday(record: NewHolidayRecord, db?: Db): number;

  /** Borra físicamente el festivo. Devuelve las filas afectadas. */
  deleteHoliday(id: number, businessId: number, db?: Db): number;
}
