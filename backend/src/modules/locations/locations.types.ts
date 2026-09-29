/**
 * DTOs de dominio del módulo `locations` (API.md 7.5).
 *
 * Son tipos PUROS: no importan `express`, `zod` ni el driver de base de datos
 * (DESIGN.md 3.2). Los esquemas viven en `locations.schemas.ts` y los
 * controllers traducen `req` -> estos tipos.
 *
 * La cafetería puede tener varias sedes: cada sede tiene sus zonas, sus sillas y
 * su horario propio en el futuro. En v1 el horario es del NEGOCIO
 * (`business_hours`), no de la sede: el modelo ya tiene `business_id` en todas
 * las tablas para permitir afinarlo sin migración.
 */

/** Zona tal y como la expone el contrato dentro de `GET /locations/:id`. */
export interface LocationZoneView {
  readonly id: number;
  readonly locationId: number;
  readonly name: string;
  readonly code: string | null;
  readonly colorHex: string | null;
  readonly capacity: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
  readonly chairCount: number;
  readonly availableCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Columnas ordenables de `GET /api/v1/locations` (API.md 7.5).
 */
export type LocationSortColumn = 'name' | 'created_at' | 'updated_at';

/** Sede del contrato (API.md 6.3 y 7.5). */
export interface LocationView {
  readonly id: number;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly isActive: boolean;
  /** Zonas no borradas lógicamente. */
  readonly zonesCount: number;
  /** Sillas no borradas lógicamente y con `is_active = 1`. */
  readonly activeChairsCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Sede con su detalle (API.md 7.5: `zones[]` y `stats`). */
export interface LocationDetailView extends LocationView {
  readonly zones: readonly LocationZoneView[];
  readonly stats: {
    readonly totalChairs: number;
    readonly availableChairs: number;
    readonly occupiedChairs: number;
  };
}

/** Fila cruda de `locations`. */
export interface LocationRow {  readonly id: number;
  readonly business_id: number;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
  readonly is_active: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Fila de `locations` con los conteos de zonas y sillas resueltos. */
export interface LocationCountedRow extends LocationRow {
  readonly zones_count: number;
  readonly active_chairs_count: number;
}

/** Fila de `zones` con los conteos de sillas, para el detalle de la sede. */
export interface LocationZoneRow {
  readonly id: number;
  readonly business_id: number;
  readonly location_id: number;
  readonly name: string;
  readonly code: string | null;
  readonly color_hex: string | null;
  readonly capacity: number;
  readonly sort_order: number;
  readonly is_active: 0 | 1;
  readonly created_at: string;
  readonly updated_at: string;
  readonly chair_count: number;
  readonly available_count: number;
}

/** Conteos de sillas por estado de la sede. */
export interface LocationChairStats {
  readonly totalChairs: number;
  readonly availableChairs: number;
  readonly occupiedChairs: number;
}

/** Conteos de zonas de la sede, por estado. */
export interface LocationZoneCounts {
  readonly total: number;
  readonly active: number;
}

/**
 * Reservas vivas de la sede (pedidos y reservas en curso).
 *
 * Es lo que impide "borrar" una sede con actividad: desactivar una sede NO
 * cancela lo que ya está reservado (API.md 7.5), así que la operación devuelve
 * un aviso, no un error.
 */
export interface LocationBookingsCount {
  readonly orders: number;
  readonly reservations: number;
}

/** Resultado de una baja lógica de sede. */
export interface LocationDeleteResult {
  readonly id: number;
  readonly deletedAt: string;
  /** Zonas que quedan colgadas de la sede dada de baja. */
  readonly zonesCount: number;
}
