/**
 * DTOs de dominio del módulo `spaces` (zonas + sillas) — API.md 7.6 y 7.7.
 *
 * ============================================================================
 * POR QUÉ UNA SOLA ENTIDAD PARA SILLA, MESA, BARRA Y SALÓN
 * ============================================================================
 * `chairs` modela las cuatro variantes de espacio mediante `kind` (CHAIR, TABLE,
 * COUNTER, AREA). No existe tabla `tables` (DESIGN.md 4.3, decisión D2): reserva,
 * alquiler, disponibilidad, precio y estado son idénticos para las cuatro, y
 * duplicar el modelo obligaría a duplicar la máquina de estados, los índices de
 * solapamiento y la lógica de cobro. Este fichero es la traducción de esa idea a
 * tipos: un `ChairView` vale para una silla y para un salón de 8 personas.
 *
 * ============================================================================
 * CONVENCIÓN DE NOMBRES
 * ============================================================================
 * La API habla `camelCase` y la base de datos `snake_case`; el mapeo ocurre en
 * `*.repository.sqlite.ts` (API.md 1). Aquí ya no hay `snake_case`.
 */
import type { ChairKind, ChairStatus } from '../../shared/domain/index.js';

// --------------------------------------------------------------------------
// Contadores por estado (BR-CHAIR-006)
// --------------------------------------------------------------------------

/** Los seis estados de silla de `chairs.status` (DESIGN.md 4.3). */
export const CHAIR_STATUSES: readonly ChairStatus[] = Object.freeze([
  'AVAILABLE',
  'OCCUPIED',
  'RESERVED',
  'BLOCKED',
  'MAINTENANCE',
  'CLEANING',
]);

/**
 * Contadores por estado de silla. Es un objeto COMPLETO (siempre las seis
 * claves) y no un diccionario disperso: la vista de rejilla del admin y la del
 * cliente hacen `counts[status]` sin comprobar si la clave existe, y un `undefined`
 * en un contador se traduce en una celda gris que nadie sabe por qué.
 */
export type ChairStatusCounts = Record<ChairStatus, number>;

/** Contador a cero. `Object.freeze` porque es la plantilla de todos los mapas. */
export function emptyChairStatusCounts(): ChairStatusCounts {
  return {
    AVAILABLE: 0,
    OCCUPIED: 0,
    RESERVED: 0,
    BLOCKED: 0,
    MAINTENANCE: 0,
    CLEANING: 0,
  };
}

/** Suma los contadores de varios lotes (los de cada zona, por ejemplo). */
export function addChairStatusCounts(
  target: ChairStatusCounts,
  source: ChairStatusCounts,
): ChairStatusCounts {
  return {
    AVAILABLE: target.AVAILABLE + source.AVAILABLE,
    OCCUPIED: target.OCCUPIED + source.OCCUPIED,
    RESERVED: target.RESERVED + source.RESERVED,
    BLOCKED: target.BLOCKED + source.BLOCKED,
    MAINTENANCE: target.MAINTENANCE + source.MAINTENANCE,
    CLEANING: target.CLEANING + source.CLEANING,
  };
}

// --------------------------------------------------------------------------
// Recursos
// --------------------------------------------------------------------------

/** Zona de agrupación de espacios (`zones`). */
export interface ZoneView {
  readonly id: number;
  readonly locationId: number;
  readonly locationName: string;
  readonly name: string;
  /** Código corto, `null` si la zona no lo tiene (`code` es NULLABLE en el DDL). */
  readonly code: string | null;
  /** Color de la leyenda en el mapa. El DDL admite `NULL`; la API no lo inventa. */
  readonly colorHex: string | null;
  /**
   * Capacidad cacheada: suma de `chairs.capacity` de las sillas activas de la
   * zona (BR-CHAIR-005). Es un valor derivado, no fuente de verdad.
   */
  readonly capacity: number;
  /** Sillas activas de la zona. */
  readonly chairCount: number;
  /** Sillas de la zona en estado `AVAILABLE`. */
  readonly availableCount: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Contadores por estado de las sillas de la zona. */
  readonly countsByStatus: ChairStatusCounts;
}

/** Silla, mesa, puesto de barra o salón (`chairs`). */
export interface ChairView {
  readonly id: number;
  readonly zoneId: number;
  readonly zoneName: string;
  /** Sede a la que pertenece la zona; permite filtrar el mapa sin segundo JOIN. */
  readonly locationId: number;
  /** Identificador visible para el cliente, único GLOBAL (BR-CHAIR-001). */
  readonly code: string;
  readonly name: string | null;
  readonly numberLabel: string | null;
  readonly kind: ChairKind;
  readonly capacity: number;
  /** Centavos por hora. Es el precio VIGENTE; el congelado vive en la reserva. */
  readonly pricePerHourMinor: number;
  readonly status: ChairStatus;
  /** Base de "ocupada desde hace X" (DESIGN.md 4.3). */
  readonly statusChangedAt: string;
  readonly gridX: number;
  readonly gridY: number;
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly rotationDeg: number;
  /** Etiquetas: `wifi`, `outlet`, `view`, `accessible`, `tv`, `quiet`. */
  readonly features: readonly string[];
  readonly notes: string | null;
  readonly isBookable: boolean;
  readonly isActive: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// --------------------------------------------------------------------------
// Mapa visual (API.md 7.7, `GET /chairs/map`)
// --------------------------------------------------------------------------

/** Rectángulo que ocupa una zona en la grilla del mapa. */
export interface ZoneBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Zona del mapa: la zona más su rectángulo y sus sillas. */
export interface ZoneMapView extends ZoneView {
  /** `null` si la zona no tiene sillas: no hay rectángulo que dibujar. */
  readonly bounds: ZoneBounds | null;
  readonly chairs: readonly ChairView[];
}

/** Totales del mapa, con el porcentaje de ocupación ya calculado en el servidor. */
export interface MapTotals {
  readonly chairs: number;
  readonly available: number;
  readonly occupied: number;
  readonly reserved: number;
  readonly blocked: number;
  readonly maintenance: number;
  readonly cleaning: number;
  /** Sillas no reservables mostradas en el mapa. */
  readonly notBookable: number;
  /** Puestos que suman `chairs.capacity` en el mapa. */
  readonly capacity: number;
  /** Puestos ocupados: suma de `capacity` de las sillas `OCCUPIED`. */
  readonly occupiedSeats: number;
  /**
   * Porcentaje de ocupación en basis points enteros (`1900` = 19,00 %).
   * Entero y no `number` en coma flotante por P1.4/BR-MONEY-001: el mismo valor
   * que se pinta en pantalla es el que se puede comparar y registrar.
   */
  readonly occupancyRateBp: number;
}

/**
 * Respuesta completa de `GET /chairs/map`.
 *
 * Es el endpoint que consumen las DOS vistas de rejilla (la del admin y la del
 * cliente) y por eso devuelve todo lo necesario para pintar sin un solo cálculo
 * adicional en el cliente (BR-CHAIR-006): zonas con coordenadas, sillas con su
 * celda, contadores por estado y porcentaje de ocupación.
 */
export interface ChairMapView {
  readonly location: { readonly id: number; readonly name: string } | null;
  readonly zones: readonly ZoneMapView[];
  readonly countsByStatus: ChairStatusCounts;
  readonly totals: MapTotals;
}

// --------------------------------------------------------------------------
// Disponibilidad e historial (API.md 7.7)
// --------------------------------------------------------------------------

/** Estado de una celda de disponibilidad. No es `ChairStatus`: incluye `FREE`. */
export const AVAILABILITY_STATUSES = ['FREE', 'RESERVED', 'OCCUPIED', 'BLOCKED', 'MAINTENANCE', 'CLEANING'] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

/** Granularidad admitida en `GET /chairs/:id/availability`. */
export const AVAILABILITY_GRANULARITIES = [15, 30, 60] as const;
export type AvailabilityGranularity = (typeof AVAILABILITY_GRANULARITIES)[number];

/** Una celda del calendario de disponibilidad. */
export interface AvailabilitySlot {
  readonly startAt: string;
  readonly endAt: string;
  readonly status: AvailabilityStatus;
  readonly reservationId: number | null;
  readonly reservationCode: string | null;
  readonly rentalId: number | null;
}

/**
 * Disponibilidad de una silla en un rango.
 *
 * `bookedMinutes` cuenta los minutos cubiertos por reservas y alquileres, sin
 * solaparse entre sí: una reserva futura dentro de un alquiler ya abierto no se
 * cuenta dos veces, porque el alquiler manda sobre la silla mientras dura.
 */
export interface ChairAvailabilityView {
  readonly chairId: number;
  readonly code: string;
  readonly from: string;
  readonly to: string;
  readonly totalMinutes: number;
  readonly bookedMinutes: number;
  readonly availableMinutes: number;
  /** Ocupación del rango en basis points enteros (`10000` = 100 %). */
  readonly utilizationRateBp: number;
  /** Estado operativo de la silla mientras el rango no tenga nada encima. */
  readonly chairStatus: ChairStatus;
  readonly slots: readonly AvailabilitySlot[];
}

/** Tipo de sesión del historial de una silla. */
export const CHAIR_HISTORY_TYPES = ['reservation', 'rental'] as const;
export type ChairHistoryType = (typeof CHAIR_HISTORY_TYPES)[number];

/** Una sesión (reserva o alquiler) del historial de una silla. */
export interface ChairHistoryEntry {
  readonly id: number;
  readonly type: ChairHistoryType;
  readonly code: string;
  readonly status: string;
  readonly startAt: string;
  readonly endAt: string;
  /** Duración planificada. En alquileres, `billed_minutes` si ya se facturó. */
  readonly durationMinutes: number;
  readonly billedMinutes: number | null;
  /** Importe en centavos. En reservas, la proyección `rental_total_minor`. */
  readonly totalMinor: number;
  readonly customerId: number | null;
  readonly customerName: string | null;
}

/** Totales del historial de una silla. */
export interface ChairHistoryTotals {
  readonly sessions: number;
  readonly totalMinutes: number;
  readonly totalRevenueMinor: number;
}

/** Página del historial de una silla. */
export interface ChairHistoryPage {
  readonly items: readonly ChairHistoryEntry[];
  readonly totals: ChairHistoryTotals;
}

// --------------------------------------------------------------------------
// Ficha completa de silla
// --------------------------------------------------------------------------

/** Ocupación acumulada de una silla, en ventana de 30 días. */
export interface ChairStats {
  readonly totalReservations: number;
  /** Minutos facturados en alquileres cerrados. */
  readonly totalRentalMinutes: number;
  /** Centavos facturados: `total_minor` de alquileres cerrados. */
  readonly totalRevenueMinor: number;
  /** Aprovechamiento en basis points sobre los últimos 30 días. */
  readonly utilizationRateBp: number;
  readonly windowFrom: string;
  readonly windowTo: string;
}

/** Sesión viva (reserva confirmada o alquiler abierto) de una silla. */
export interface ChairCurrentOccupancy {
  readonly reservation: ReservationSummary | null;
  readonly rental: RentalSummary | null;
}

/** Datos mínimos de una reserva, para incrustar en otros recursos. */
export interface ReservationSummary {
  readonly id: number;
  readonly code: string;
  readonly status: string;
  readonly startAt: string;
  readonly endAt: string;
}

/** Datos mínimos de un alquiler, para incrustar en otros recursos. */
export interface RentalSummary {
  readonly id: number;
  readonly code: string;
  readonly status: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly totalMinor: number;
}

// --------------------------------------------------------------------------
// Filtros, parches y resultados de escritura
// --------------------------------------------------------------------------

/** Columnas por las que se permite ordenar `GET /zones` (API.md 7.6). */
export type ZoneSortColumn = 'sort_order' | 'name' | 'capacity';

/** Columnas por las que se permite ordenar `GET /chairs` (API.md 7.7). */
export type ChairSortColumn =
  | 'code'
  | 'name'
  | 'capacity'
  | 'price_per_hour_minor'
  | 'status_changed_at'
  | 'sort_order';

/** Orden ya validado contra la allowlist del endpoint. */
export interface SortSpecLite {
  readonly column: string;
  readonly direction: 'ASC' | 'DESC';
}

/** Filtro de `GET /zones`. `businessId` sale SIEMPRE del token (BR-SEC-008). */
export interface ZoneListFilter {
  readonly businessId: number;
  readonly locationId: number;
  readonly isActive?: boolean;
  readonly includeInactive: boolean;
  readonly q?: string;
  readonly limit: number;
  readonly offset: number;
  readonly sort: SortSpecLite;
}

/** Filtro de `GET /chairs`. */
export interface ChairListFilter {
  readonly businessId: number;
  readonly locationId?: number;
  readonly zoneId?: number;
  readonly status?: ChairStatus;
  readonly kind?: ChairKind;
  readonly q?: string;
  readonly isBookable?: boolean;
  readonly includeInactive: boolean;
  readonly limit: number;
  readonly offset: number;
  readonly sort: SortSpecLite;
}

/** Filtro de `GET /chairs/map`. */
export interface ChairMapFilter {
  readonly businessId: number;
  readonly locationId: number;
  readonly zoneId?: number;
  readonly includeInactive: boolean;
}

/** Filtro de `GET /chairs/:id/history`. */
export interface ChairHistoryFilter {
  readonly chairId: number;
  readonly businessId: number;
  readonly from: string;
  readonly to: string;
  readonly type?: ChairHistoryType;
}

/** Filtro del rango de `GET /chairs/:id/availability`. */
export interface AvailabilityRange {
  readonly from: string;
  readonly to: string;
  readonly granularityMinutes: AvailabilityGranularity;
}

/** Campos editables de una zona. `capacity` NO es editable: es derivado. */
export interface ZonePatch {
  readonly name?: string;
  readonly code?: string | null;
  readonly colorHex?: string;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

/** Campos editables de una silla. */
export interface ChairPatch {
  readonly zoneId?: number;
  readonly name?: string | null;
  readonly numberLabel?: string | null;
  readonly kind?: ChairKind;
  readonly capacity?: number;
  readonly pricePerHourMinor?: number;
  readonly gridX?: number;
  readonly gridY?: number;
  readonly mapWidth?: number;
  readonly mapHeight?: number;
  readonly rotationDeg?: number;
  readonly features?: readonly string[];
  readonly notes?: string | null;
  readonly isBookable?: boolean;
  readonly isActive?: boolean;
}

/** Parche de una silla más los avisos no bloqueantes del `meta`. */
export interface ChairPatchResult {
  readonly chair: ChairView;
  /** p. ej. `PRICE_CHANGE_AFFECTS_ONLY_NEW` (BR-PRICE-010). */
  readonly warnings: readonly string[];
}

/** Elemento de `POST /zones/reorder`. */
export interface ZoneOrderItem {
  readonly id: number;
  readonly sortOrder: number;
}

/** Entrada de `POST /zones/reorder`. */
export interface ZoneReorderInput {
  readonly locationId: number;
  readonly items: readonly ZoneOrderItem[];
}

/** Resultado de un borrado lógico, para `data` de la respuesta. */
export interface SoftDeleteResult {
  readonly id: number;
  readonly deletedAt: string;
  readonly reason?: string;
}
