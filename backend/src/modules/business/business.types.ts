/**
 * DTOs de dominio del módulo `business` (configuración, horario y festivos).
 *
 * Son tipos PUROS: no importan `express`, `zod` ni el driver de base de datos
 * (DESIGN.md 3.2). Los esquemas de validación viven en `business.schemas.ts` y
 * los controllers traducen `req` -> estos tipos.
 *
 * REGLA DE ORO: todo campo `*Minor` es un entero en centavos (BR-MONEY-001) y
 * todo importe de negocio (`chairDefaultPriceMinor`) también, aunque la
 * cafetería cobre en efectivo o tarjeta: **no hay pasarela de pagos**, así que
 * la configuración NO expone proveedores ni claves de pasarela, sólo las
 * magnitudes que el mostrador necesita (precio de silla por defecto, tarifa de
 * servicio, propina, impuesto y duración máxima de reserva).
 */

/** Modo de la vista de negocio que se devuelve al cliente. */
export type BusinessViewMode = 'full' | 'public';

/** Configuración del negocio tal y como la expone el contrato (API.md 6.3). */
export interface BusinessView {
  readonly id: number;
  readonly name: string;
  readonly legalName: string | null;
  readonly logoUrl: string | null;
  /**
   * NIT / RUT. **Nunca** viaja en la vista pública: son datos fiscales del
   * negocio y el cliente móvil no los necesita para mostrar precios.
   */
  readonly taxId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly currencyCode: string;
  readonly currencySymbol: string;
  readonly locale: string;
  readonly timezone: string;
  readonly taxRateBp: number;
  readonly taxInclusive: boolean;
  readonly serviceFeeBp: number;
  readonly tipEnabled: boolean;
  /** CSV en la base de datos, `string[]` en la API (API.md 7.4). */
  readonly defaultTipsBp: readonly string[];
  readonly maxReservationMinutes: number;
  /** Precio por hora por defecto al crear una silla (alquiler de espacios). */
  readonly chairDefaultPriceMinor: number;
  readonly allowNegativeStock: boolean;
  readonly lowStockAlertThreshold: number;
  readonly orderPrefix: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Proyección PÚBLICA de la configuración.
 *
 * Es lo que devuelve `GET /api/v1/business` sin token: lo mínimo que el cliente
 * necesita para pintar precios, el nombre del local y su estado. NO incluye
 * `taxId`, `legalName` ni los datos de contacto, que son configuración interna
 * o fiscal. `GET /api/v1/business/status` es la fuente del estado (abre/cierra).
 */
export interface PublicBusinessView {
  readonly id: number;
  readonly name: string;
  readonly logoUrl: string | null;
  readonly currencyCode: string;
  readonly currencySymbol: string;
  readonly locale: string;
  readonly timezone: string;
  readonly taxRateBp: number;
  readonly taxInclusive: boolean;
  readonly serviceFeeBp: number;
  readonly tipEnabled: boolean;
  readonly defaultTipsBp: readonly string[];
  readonly maxReservationMinutes: number;
  readonly chairDefaultPriceMinor: number;
}

/** Un día del horario. 0 = domingo … 6 = sábado (convención `Date.getDay()`). */
export interface BusinessHourView {
  readonly id: number | null;
  readonly dayOfWeek: number;
  /** `HH:MM` local del negocio. */
  readonly opensAt: string;
  readonly closesAt: string;
  readonly isClosed: boolean;
}

/** Fila cruda de `businesses`. */
export interface BusinessRow {
  readonly id: number;
  readonly name: string;
  readonly legal_name: string | null;
  readonly logo_url: string | null;
  readonly tax_id: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly address_line1: string | null;
  readonly address_line2: string | null;
  readonly city: string | null;
  readonly country: string | null;
  readonly currency_code: string;
  readonly currency_symbol: string;
  readonly locale: string;
  readonly timezone: string;
  readonly tax_rate_bp: number;
  readonly tax_inclusive: 0 | 1;
  readonly service_fee_bp: number;
  readonly tip_enabled: 0 | 1;
  readonly default_tips_bp: string;
  readonly max_reservation_minutes: number;
  readonly chair_default_price_minor: number;
  readonly allow_negative_stock: 0 | 1;
  readonly low_stock_alert_threshold: number;
  readonly order_prefix: string;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Fila cruda de `business_hours`. */
export interface BusinessHourRow {
  readonly id: number;
  readonly business_id: number;
  readonly day_of_week: number;
  readonly opens_at: string;
  readonly closes_at: string;
  readonly is_closed: 0 | 1;
}

/** Fila cruda de `business_holidays`. */
export interface BusinessHolidayRow {
  readonly id: number;
  readonly business_id: number;
  readonly holiday_date: string;
  readonly name: string;
  readonly is_closed: 0 | 1;
}

/** Festivo tal y como lo expone el contrato (API.md 7.4). */
export interface BusinessHolidayView {
  readonly id: number;
  /** `YYYY-MM-DD` en hora local del negocio. */
  readonly holidayDate: string;
  readonly name: string;
  readonly isClosed: boolean;
}

/**
 * Resultado de borrar un festivo.
 *
 * `business_holidays` NO tiene columna `deleted_at` en el esquema congelado
 * (`0001_init.sql`), así que el borrado es FÍSICO. `deletedAt` es el instante
 * de la baja, que es lo que el contrato promete.
 */
export interface BusinessHolidayDeleteResult {
  readonly id: number;
  readonly deletedAt: string;
}

/**
 * Por qué el local está abierto o cerrado.
 *
 * `NO_SCHEDULE` existe porque el horario puede no existir todavía: la siembra de
 * despliegue crea el negocio pero no sus siete días, y el cliente móvil tiene
 * que poder pintar "cerrado" sin romperse.
 */
export type BusinessClosedReason =
  | 'OPEN'
  | 'CLOSED_SCHEDULE'
  | 'CLOSED_HOLIDAY'
  | 'NO_SCHEDULE';

/** Estado del local en un instante dado (`GET /api/v1/business/status`). */
export interface BusinessStatusView {
  readonly isOpen: boolean;
  readonly reason: BusinessClosedReason;
  /** `YYYY-MM-DD` local del negocio. */
  readonly localDate: string;
  /** `HH:MM` local del negocio. */
  readonly localTime: string;
  /** 0 = domingo … 6 = sábado. */
  readonly dayOfWeek: number;
  readonly timezone: string;
  /** Horario del día de hoy, o `null` si el día está cerrado o no hay semana. */
  readonly opensAt: string | null;
  readonly closesAt: string | null;
  /**
   * Instante ISO-8601 UTC del próximo cambio (cierre de hoy o apertura del
   * próximo día con horario). `null` si no hay ninguno en los 7 días siguientes.
   */
  readonly nextChangeAt: string | null;
  /** Festivo que closes hoy, si lo hay. */
  readonly holiday: { readonly name: string } | null;
}
