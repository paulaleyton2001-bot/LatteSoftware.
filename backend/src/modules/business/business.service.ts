/**
 * Servicio de configuración del negocio: `/api/v1/business/*` (API.md 7.4) más el
 * endpoint auxiliar `GET /api/v1/business/status`.
 *
 * ============================== CAPAS =======================================
 * No conoce Express, ni zod, ni SQLite. Recibe entradas tipadas, decide,
 * orquesta la transacción y devuelve DTOs. El SQL vive en
 * `business.repository.sqlite.ts` (DESIGN.md 3.1 y 3.6).
 *
 * ========================== REGLAS QUE APLICA ==============================
 *  - **Negocio singleton.** En v1 hay un negocio por despliegue, sembrado con
 *    `id = 1`. El `businessId` sale SIEMPRE del token (`context.actor
 *    .businessId`); en las lecturas públicas, donde no hay token, se usa
 *    `AUTH.DEFAULT_BUSINESS_ID`. Nunca del body ni de la query (API.md 2).
 *  - **No se puede cambiar `id`.** El esquema de `PATCH /business` no lo admite:
 *    un campo desconocido es `400 UNKNOWN_FIELD` (`.strict()`), no un cambio
 *    silencioso.
 *  - **La moneda es inmutable en cuanto hay pedidos** (`BR-BUS-002`, decisión
 *    propia documentada): los importes de `orders` no guardan la moneda, así que
 *    reinterpretar un histórico en otra moneda sería falsificarlo. Antes del
 *    primer pedido se puede corregir sin problema; después, `409
 *    CURRENCY_CHANGE_BLOCKED` con el número de pedidos en `details`.
 *  - **Todo cambio de configuración se audita** con `before_data` y
 *    `after_data` completos (BR-SEC-007). Un `PATCH` que no cambia nada no
 *    escribe fila: el audit log es para explicar cambios, no para marcar que
 *    alguien escribió.
 *  - **No hay pasarela de pagos.** La configuración expone magnitudes del
 *    mostrador (precio de silla por defecto, tarifa, impuesto, propina, tope de
 *    reserva) y NADA de proveedores o claves: todo se cobra en el local, en
 *    efectivo o con tarjeta.
 */
import { AUTH } from '../../config/index.js';
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { AuditAction, AuditEntityType, type UserContext } from '../../shared/domain/index.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { localDateKey, nowIso } from '../../shared/utils/datetime.js';
import {
  DEFAULT_WEEK,
  evaluateOpenState,
  isCalendarDate,
  isValidTimeZone,
  normalizeWeek,
  shiftDateKey,
  type HolidaySlot,
} from './business.hours.js';
import type {
  BusinessHolidayDeleteResult,
  BusinessHolidayView,
  BusinessHourView,
  BusinessRow,
  BusinessStatusView,
  BusinessView,
  BusinessViewMode,
  PublicBusinessView,
} from './business.types.js';
import type {
  BusinessRepository,
  HolidayListFilter,
  NewHourRecord,
} from './business.repository.js';

/** Contexto de petición para auditoría y negocio. */
export interface BusinessRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/**
 * Entradas de los casos de uso. Todos los campos son opcionales: es un
 * `PATCH`. Un campo ausente significa "no lo toques"; `null` significa
 * "vacíalo" (sólo en los campos de texto que admiten `NULL`).
 *
 * `id` NO aparece: la identidad del negocio sale del token y no es editable
 * (un campo desconocido sería `400 UNKNOWN_FIELD`).
 */
export interface BusinessPatchInput {
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
  /** `string[]` en la API; el service lo serializa a CSV para la columna. */
  readonly defaultTipsBp?: readonly string[];
  readonly maxReservationMinutes?: number;
  readonly chairDefaultPriceMinor?: number;
  readonly allowNegativeStock?: boolean;
  readonly lowStockAlertThreshold?: number;
  readonly orderPrefix?: string;
}

/** Entrada de `POST /api/v1/business/holidays`. */
export interface CreateHolidayInput {
  readonly holidayDate: string;
  readonly name: string;
  readonly isClosed: boolean;
}

/** Filtros de `GET /api/v1/business/holidays` (sin `businessId`). */
export interface BusinessHolidayListFilter {
  readonly limit: number;
  readonly offset: number;
  readonly from?: string;
  readonly to?: string;
  readonly includePast?: boolean;
}

/** Resultado de un `PATCH /business`: la vista y los avisos no bloqueantes. */
export interface BusinessUpdateResult {
  readonly business: BusinessView;
  /** `TIMEZONE_CHANGED`, `CURRENCY_UNCHANGED`… (API.md 3.1). */
  readonly warnings: readonly string[];
}

/** Resultado de `PUT /business/hours`. */
export interface BusinessHoursUpdateResult {
  readonly hours: readonly BusinessHourView[];
  readonly warnings: readonly string[];
}

/** Página de festivos. */
export interface BusinessHolidayPage {
  readonly items: readonly BusinessHolidayView[];
  readonly total: number;
}

/**
 * Días de vista previa del estado del local: 7 bastan para "abre mañana a las
 * ocho" sin recorrer la tabla de festivos.
 */
const STATUS_HORIZON_DAYS = 7;

/** Servicio de configuración del negocio. */
export class BusinessService {
  public constructor(
    private readonly repository: BusinessRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /**
   * `GET /api/v1/business` — configuración del negocio.
   *
   * `mode` decide la vista y lo elige el controller según la identidad:
   *  - `full`: el actor tiene `business:read`, así que ve la configuración
   *    completa, incluidos `taxId` y `legalName`.
   *  - `public`: petición sin credencial. Se devuelve SÓLO lo que el cliente
   *    necesita para pintar precios (API.md 7.4 + 6.3), nunca datos fiscales ni
   *    de contacto. Es una proyección por construcción: el método no recibe la
   *    fila completa, así que no puede filtrarla "de memoria".
   */
  public get(mode: BusinessViewMode, businessId: number = AUTH.DEFAULT_BUSINESS_ID): BusinessView | PublicBusinessView {
    const row = this.requireBusiness(businessId);
    return mode === 'full' ? toFullView(row) : toPublicView(row);
  }

  /**
   * `GET /api/v1/business/hours` — los siete días, siempre ordenados.
   *
   * Si el negocio no tiene horario persistido se devuelven los valores por
   * defecto (`DEFAULT_WEEK`, los mismos que los `DEFAULT` de las columnas) y
   * se dejan persistidos: un cliente que lee el horario antes de configurarlo
   * recibe una respuesta completa, y el `PUT` posterior sobrescribe esos mismos
   * valores. Es un autocorrección de configuración, no una escritura de negocio.
   */
  public getHours(businessId: number = AUTH.DEFAULT_BUSINESS_ID): readonly BusinessHourView[] {
    this.ensureDefaultWeek(businessId);
    return this.repository.listHours(businessId).map((row) => toHourView(row));
  }

  /** `GET /api/v1/business/holidays` — listado paginado por fecha. */
  public listHolidays(
    filter: Omit<BusinessHolidayListFilter, 'businessId'>,
    businessId: number = AUTH.DEFAULT_BUSINESS_ID,
  ): BusinessHolidayPage {
    const safe: HolidayListFilter = { ...filter, businessId };
    return {
      items: this.repository.listHolidays(safe).map((row) => toHolidayView(row)),
      total: this.repository.countHolidays(safe),
    };
  }

  /**
   * `GET /api/v1/business/status` — ¿está el local abierto ahora?
   *
   * Es el endpoint que la home del cliente necesita antes de iniciar sesión, así
   * que es PÚBLICO y no filtra nada de la configuración: sólo horario, zona y
   * veredicto.
   *
   * @param at Reloj INYECTADO. Por defecto, el instante actual. Los tests y el
   *          futuro worker lo pasan explícitamente para no depender de la hora
   *          real del momento de ejecutarse.
   */
  public getStatus(
    at: Date = new Date(),
    businessId: number = AUTH.DEFAULT_BUSINESS_ID,
  ): BusinessStatusView {
    const row = this.requireBusiness(businessId);
    const today = localDateKey(at, row.timezone);
    return evaluateOpenState({
      week: this.getHours(businessId),
      holidays: this.repository
        .listHolidaysBetween(
          businessId,
          today,
          shiftDateKey(today, STATUS_HORIZON_DAYS),
        )
        .map((holiday) => toHolidaySlot(holiday)),
      at,
      timeZone: row.timezone,
    });
  }

  // ==========================================================================
  // Escrituras
  // ==========================================================================

  /**
   * `PATCH /api/v1/business` — edición parcial de la configuración.
   *
   * Valida en el service lo que depende del estado (moneda contra pedidos,
   * zona horaria contra el runtime, código de moneda real) y deja en el esquema
   * zod sólo la forma (longitudes y formatos). Todo cambio se audita con
   * `before`/`after` completos.
   */
  public update(
    input: BusinessPatchInput,
    context: BusinessRequestContext,
  ): BusinessUpdateResult {
    const businessId = context.actor.businessId;

    if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) {
      throw new BusinessRuleError('La zona horaria no es válida', {
        details: {
          code: 'INVALID_TIMEZONE',
          field: 'timezone',
          value: input.timezone,
          hint: 'Debe ser un identificador IANA, por ejemplo America/Bogota',
        },
      });
    }
    if (input.currencyCode !== undefined && !isSupportedCurrency(input.currencyCode)) {
      throw new BusinessRuleError('El código de moneda no es válido', {
        details: {
          code: 'INVALID_CURRENCY',
          field: 'currencyCode',
          value: input.currencyCode,
          hint: 'Debe ser un código ISO-4217 de tres letras admitido por el runtime',
        },
      });
    }

    return runInTransactionSync(() => {
      const before = this.requireBusiness(businessId);
      const warnings: string[] = [];
      const patch = this.buildPatch(input, before, warnings);

      if (Object.keys(patch).length === 0) {
        return { business: toFullView(before), warnings };
      }

      this.repository.update(businessId, patch);
      const after = this.requireBusiness(businessId);

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.business,
        entityId: businessId,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'business', ...toAuditFields(before) },
        afterData: { resource: 'business', ...toAuditFields(after) },
      });

      return { business: toFullView(after), warnings };
    });
  }

  /**
   * `PUT /api/v1/business/hours` — reemplazo de la semana completa.
   *
   * Los siete días se escriben en UNA transacción: o queda la semana nueva
   * entera, o no cambia nada. Un `PATCH` parcial del horario dejaría el local
   * con una semana incoherente, y el estado "abierto/cerrado" se calcula sobre
   * ella entera.
   */
  public replaceHours(
    days: readonly {
      readonly dayOfWeek: number;
      readonly opensAt: string;
      readonly closesAt: string;
      readonly isClosed: boolean;
    }[],
    context: BusinessRequestContext,
  ): BusinessHoursUpdateResult {
    const businessId = context.actor.businessId;
    // Validación de forma y de regla de negocio ANTES de abrir la transacción.
    const normalized = normalizeWeek(days);

    return runInTransactionSync(() => {
      const before = this.repository.listHours(businessId).map((row) => toHourView(row));

      const records: NewHourRecord[] = normalized.map((slot) => ({
        businessId,
        dayOfWeek: slot.dayOfWeek,
        opensAt: slot.opensAt,
        closesAt: slot.closesAt,
        isClosed: slot.isClosed,
      }));
      for (const record of records) {
        this.repository.upsertHour(record);
      }
      const after = this.repository.listHours(businessId).map((row) => toHourView(row));

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.business,
        entityId: businessId,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'business_hours', hours: before },
        afterData: { resource: 'business_hours', hours: after },
      });

      // Aviso no bloqueante: cambiar el horario afecta a las reservas de mañana,
      // así que quien lo cambia tiene que saberlo aunque la operación sea un 200.
      const changed =
        before.length !== after.length ||
        before.some((slot, index) =>
          slot.opensAt !== after[index]?.opensAt ||
          slot.closesAt !== after[index]?.closesAt ||
          slot.isClosed !== after[index]?.isClosed);
      return { hours: after, warnings: changed ? ['BUSINESS_HOURS_CHANGED'] : [] };
    });
  }

  /**
   * `POST /api/v1/business/holidays` — alta de festivo.
   *
   * `UNIQUE(business_id, holiday_date)`: el duplicado es `409` con
   * `details.code = 'HOLIDAY_ALREADY_EXISTS'`, no un 500 de restricción.
   */
  public createHoliday(
    input: CreateHolidayInput,
    context: BusinessRequestContext,
  ): BusinessHolidayView {
    const businessId = context.actor.businessId;
    if (!isCalendarDate(input.holidayDate)) {
      throw new ValidationError('La fecha del festivo no es válida', {
        details: [
          {
            path: 'holidayDate',
            message: 'Debe ser una fecha real con formato YYYY-MM-DD, por ejemplo 2026-12-25',
            code: 'INVALID_FORMAT',
          },
        ],
      });
    }
    if (this.repository.findHolidayByDate(input.holidayDate, businessId) !== null) {
      throw new ConflictError('Ya existe un festivo registrado para esa fecha', {
        details: { code: 'HOLIDAY_ALREADY_EXISTS', field: 'holidayDate', holidayDate: input.holidayDate },
      });
    }

    return runInTransactionSync(() => {
      const id = this.repository.insertHoliday({
        businessId,
        holidayDate: input.holidayDate,
        name: input.name,
        isClosed: input.isClosed,
      });
      const after = this.requireHoliday(id, businessId);
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.business,
        entityId: businessId,
        actor: context.actor,
        request: context.request,
        afterData: { resource: 'business_holiday', holiday: toAuditHoliday(after) },
      });
      return toHolidayView(after);
    });
  }

  /**
   * `DELETE /api/v1/business/holidays/:id` — baja de festivo.
   *
   * `business_holidays` no tiene `deleted_at` en el esquema congelado, así que
   * la baja es física y `deletedAt` es el instante en que ocurrió. Se audita con
   * `before`/`after` para que quede constancia del festivo que se quitó.
   */
  public deleteHoliday(id: number, context: BusinessRequestContext): BusinessHolidayDeleteResult {
    const businessId = context.actor.businessId;

    return runInTransactionSync(() => {
      const before = this.requireHoliday(id, businessId);
      const deletedAt = nowIso();
      this.repository.deleteHoliday(id, businessId);

      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.business,
        entityId: businessId,
        actor: context.actor,
        request: context.request,
        beforeData: { resource: 'business_holiday', holiday: toAuditHoliday(before) },
        afterData: { resource: 'business_holiday', deletedAt },
      });

      return { id, deletedAt };
    });
  }

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  /** Negocio obligatorio: `404` si el despliegue no lo tiene sembrado. */
  private requireBusiness(businessId: number): BusinessRow {
    const row = this.repository.findById(businessId);
    if (row === null) {
      throw new NotFoundError('El negocio no está configurado', {
        details: { id: businessId, type: 'business' },
      });
    }
    return row;
  }

  /** Festivo obligatorio: `404` si no existe o es de otro negocio. */
  private requireHoliday(id: number, businessId: number) {
    const row = this.repository.findHolidayById(id, businessId);
    if (row === null) {
      throw new NotFoundError('El festivo no existe', { details: { id, type: 'business_holiday' } });
    }
    return row;
  }

  /**
   * Persiste la semana por defecto si el negocio no tiene NINGÚN día
   * configurado.
   *
   * Es idempotente y sólo actúa sobre una semana vacía: en cuanto hay un solo
   * día configurado, esta función no hace nada y manda lo que haya escrito el
   * usuario. Se ejecuta dentro de la transacción que abre el llamador, o
   * sola si no hay ninguna abierta.
   */
  private ensureDefaultWeek(businessId: number): void {
    if (this.repository.listHours(businessId).length > 0) {
      return;
    }
    runInTransactionSync(() => {
      // Doble comprobación dentro de la transacción: otra petición could've
      // escrito la semana entre la lectura y la escritura.
      if (this.repository.listHours(businessId).length > 0) {
        return;
      }
      for (const slot of DEFAULT_WEEK) {
        this.repository.upsertHour({
          businessId,
          dayOfWeek: slot.dayOfWeek,
          opensAt: slot.opensAt,
          closesAt: slot.closesAt,
          isClosed: slot.isClosed,
        });
      }
    });
  }

  /**
   * Traduce la entrada del controller al patch del repositorio y decide los
   * avisos. Sólo incluye los campos PRESENTES: un PATCH parcial no borra nada.
   */
  private buildPatch(
    input: BusinessPatchInput,
    before: BusinessRow,
    warnings: string[],
  ): Parameters<BusinessRepository['update']>[1] {
    const patch: Record<string, unknown> = {};

    const put = (key: string, column: string, value: string | number | boolean | null): void => {
      // Un valor idéntico no se escribe: `updated_at` no debe saltar por un
      // PATCH que no cambió nada.
      if ((before as unknown as Record<string, unknown>)[column] === value) {
        return;
      }
      patch[key] = value;
    };

    if (input.name !== undefined) put('name', 'name', input.name);
    if (input.legalName !== undefined) put('legalName', 'legal_name', input.legalName);
    if (input.logoUrl !== undefined) put('logoUrl', 'logo_url', input.logoUrl);
    if (input.taxId !== undefined) put('taxId', 'tax_id', input.taxId);
    if (input.email !== undefined) put('email', 'email', input.email);
    if (input.phone !== undefined) put('phone', 'phone', input.phone);
    if (input.addressLine1 !== undefined) put('addressLine1', 'address_line1', input.addressLine1);
    if (input.addressLine2 !== undefined) put('addressLine2', 'address_line2', input.addressLine2);
    if (input.city !== undefined) put('city', 'city', input.city);
    if (input.country !== undefined) put('country', 'country', input.country);
    if (input.currencySymbol !== undefined) put('currencySymbol', 'currency_symbol', input.currencySymbol);
    if (input.locale !== undefined) put('locale', 'locale', input.locale);
    if (input.taxRateBp !== undefined) put('taxRateBp', 'tax_rate_bp', input.taxRateBp);
    if (input.taxInclusive !== undefined) put('taxInclusive', 'tax_inclusive', input.taxInclusive);
    if (input.serviceFeeBp !== undefined) put('serviceFeeBp', 'service_fee_bp', input.serviceFeeBp);
    if (input.tipEnabled !== undefined) put('tipEnabled', 'tip_enabled', input.tipEnabled);
    if (input.maxReservationMinutes !== undefined) {
      put('maxReservationMinutes', 'max_reservation_minutes', input.maxReservationMinutes);
    }
    if (input.chairDefaultPriceMinor !== undefined) {
      put('chairDefaultPriceMinor', 'chair_default_price_minor', input.chairDefaultPriceMinor);
    }
    if (input.allowNegativeStock !== undefined) {
      put('allowNegativeStock', 'allow_negative_stock', input.allowNegativeStock);
    }
    if (input.lowStockAlertThreshold !== undefined) {
      put('lowStockAlertThreshold', 'low_stock_alert_threshold', input.lowStockAlertThreshold);
    }
    if (input.orderPrefix !== undefined) put('orderPrefix', 'order_prefix', input.orderPrefix);

    if (input.timezone !== undefined && input.timezone !== before.timezone) {
      patch['timezone'] = input.timezone;
      // API.md 7.4: cambiar la zona afecta al cálculo de las reservas existentes.
      warnings.push('TIMEZONE_CHANGED');
    }

    if (input.defaultTipsBp !== undefined) {
      const csv = input.defaultTipsBp.join(',');
      if (csv !== before.default_tips_bp) {
        patch['defaultTipsBpCsv'] = csv;
      }
    }

    if (input.currencyCode !== undefined && input.currencyCode !== before.currency_code) {
      const orders = this.repository.countOrders(before.id);
      if (orders > 0) {
        // Decisión documentada (BR-BUS-002): los importes de `orders` no
        // guardan la moneda, así que cambiar la moneda reinterpretaría un
        // histórico ya cobrado. Con pedidos vivos, se bloquea.
        throw new ConflictError(
          'No se puede cambiar la moneda del negocio porque ya existen pedidos',
          {
            details: {
              code: 'CURRENCY_CHANGE_BLOCKED',
              field: 'currencyCode',
              orders,
              current: before.currency_code,
              requested: input.currencyCode,
            },
          },
        );
      }
      patch['currencyCode'] = input.currencyCode;
    }

    return patch as Parameters<BusinessRepository['update']>[1];
  }
}

// --------------------------------------------------------------------------
// Proyecciones de fila a DTO
// --------------------------------------------------------------------------

/** CSV de propinas -> `string[]` (API.md 7.4). */
function parseTipsCsv(csv: string): readonly string[] {
  return csv
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Configuración completa (actor con `business:read`). */
function toFullView(row: BusinessRow): BusinessView {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    logoUrl: row.logo_url,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    country: row.country,
    currencyCode: row.currency_code,
    currencySymbol: row.currency_symbol,
    locale: row.locale,
    timezone: row.timezone,
    taxRateBp: row.tax_rate_bp,
    taxInclusive: row.tax_inclusive === 1,
    serviceFeeBp: row.service_fee_bp,
    tipEnabled: row.tip_enabled === 1,
    defaultTipsBp: parseTipsCsv(row.default_tips_bp),
    maxReservationMinutes: row.max_reservation_minutes,
    chairDefaultPriceMinor: row.chair_default_price_minor,
    allowNegativeStock: row.allow_negative_stock === 1,
    lowStockAlertThreshold: row.low_stock_alert_threshold,
    orderPrefix: row.order_prefix,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Proyección pública: sin `taxId`, sin `legalName` y sin datos de contacto.
 * Los campos se nombran uno a uno (no se clona y se borra) para que añadir un
 * campo fiscal a `businesses` no lo Filtrado por accidente.
 */
function toPublicView(row: BusinessRow): PublicBusinessView {
  return {
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url,
    currencyCode: row.currency_code,
    currencySymbol: row.currency_symbol,
    locale: row.locale,
    timezone: row.timezone,
    taxRateBp: row.tax_rate_bp,
    taxInclusive: row.tax_inclusive === 1,
    serviceFeeBp: row.service_fee_bp,
    tipEnabled: row.tip_enabled === 1,
    defaultTipsBp: parseTipsCsv(row.default_tips_bp),
    maxReservationMinutes: row.max_reservation_minutes,
    chairDefaultPriceMinor: row.chair_default_price_minor,
  };
}

/** Fila de `business_hours` -> vista del contrato. */
function toHourView(row: {
  readonly id: number;
  readonly day_of_week: number;
  readonly opens_at: string;
  readonly closes_at: string;
  readonly is_closed: 0 | 1;
}): BusinessHourView {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    isClosed: row.is_closed === 1,
  };
}

/** Fila de `business_holidays` -> vista del contrato. */
function toHolidayView(row: {
  readonly id: number;
  readonly holiday_date: string;
  readonly name: string;
  readonly is_closed: 0 | 1;
}): BusinessHolidayView {
  return {
    id: row.id,
    holidayDate: row.holiday_date,
    name: row.name,
    isClosed: row.is_closed === 1,
  };
}

/** Fila de `business_holidays` -> hueco del cálculo de estado. */
function toHolidaySlot(row: {
  readonly holiday_date: string;
  readonly name: string;
  readonly is_closed: 0 | 1;
}): HolidaySlot {
  return {
    holidayDate: row.holiday_date,
    name: row.name,
    isClosed: row.is_closed === 1,
  };
}

/** Snapshot completo de la configuración para `audit_logs`. */
function toAuditFields(row: BusinessRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    logoUrl: row.logo_url,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    country: row.country,
    currencyCode: row.currency_code,
    currencySymbol: row.currency_symbol,
    locale: row.locale,
    timezone: row.timezone,
    taxRateBp: row.tax_rate_bp,
    taxInclusive: row.tax_inclusive === 1,
    serviceFeeBp: row.service_fee_bp,
    tipEnabled: row.tip_enabled === 1,
    defaultTipsBp: parseTipsCsv(row.default_tips_bp),
    maxReservationMinutes: row.max_reservation_minutes,
    chairDefaultPriceMinor: row.chair_default_price_minor,
    allowNegativeStock: row.allow_negative_stock === 1,
    lowStockAlertThreshold: row.low_stock_alert_threshold,
    orderPrefix: row.order_prefix,
  };
}

/** Snapshot de un festivo para `audit_logs`. */
function toAuditHoliday(row: {
  readonly id: number;
  readonly holiday_date: string;
  readonly name: string;
  readonly is_closed: 0 | 1;
}): Record<string, unknown> {
  return {
    id: row.id,
    holidayDate: row.holiday_date,
    name: row.name,
    isClosed: row.is_closed === 1,
  };
}

/**
 * `true` si el runtime conoce la moneda.
 *
 * Se valida con `Intl` en lugar de con una lista propia: la lista se
 * desactualizaría con cada moneda nueva y el runtime no.
 */
function isSupportedCurrency(currencyCode: string): boolean {
  try {
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: currencyCode });
    return true;
  } catch {
    return false;
  }
}
