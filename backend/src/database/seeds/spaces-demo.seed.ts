/**
 * Semilla de demostración de ESPACIOS: una sede, cinco zonas y veinticinco
 * sillas con coordenadas de rejilla.
 *
 * ============================================================================
 * POR QUÉ EXISTE
 * ============================================================================
 * El esquema y la semilla de arranque crean el negocio (`businesses.id = 1`) y
 * la matriz de RBAC, pero no la sede: `locations` queda vacía, y
 * `zones.location_id` es `NOT NULL` con FK a `locations`. Sin una sede no hay
 * forma de crear la primera zona, ni por API ni por test.
 *
 * ============================================================================
 * QUÉ SIEMBRA: 5 ZONAS Y 25 SILLAS
 * ============================================================================
 *  - Sede `Sede Principal` (id 1 en una base nueva).
 *  - `Terraza` (6 sillas), `Interior` (4 mesas), `Ventana` (5 puestos de barra),
 *    `Zona Premium` (4 áreas) y `Sala de Trabajo` (6 mesas): cinco zonas con
 *    precios por hora distintos, para que el mapa virtual y los reportes de
 *    ingreso por alquiler tengan de dónde sacar distribución.
 *  - Los cuatro `kind` del modelo (DESIGN.md 4.3, decisión D2): `CHAIR`, `TABLE`,
 *    `COUNTER` y `AREA`. Una sola tabla los modela porque reserva, alquiler,
 *    precio y estado son idénticos para los cuatro.
 *  - Coordenadas de rejilla EXPLÍCITAS por silla, no calculadas por índice: las
 *    mesas ocupan dos celdas de ancho (`map_width = 2`), así que una rejilla
 *    calculada por `i % ancho` las solaparía. Con coordenadas fijas no hay dos
 *    muebles en la misma celda dentro de una zona.
 *
 * ============================================================================
 * PRECIOS Y CONCILIACIÓN
 * ============================================================================
 * `price_per_hour_minor` está CONGELADO por silla (BR-RENTAL-003), y el valor
 * inicial se escribe explícito para que la demo no dependa del ajuste del
 * negocio. Cuando la silla ya existe pero con otro precio --una base sembrada por
 * una versión anterior de esta semilla-- se CONCILIA a la tarifa de la demo:
 * ejecutar el seeder dos veces converge al mismo estado, que es lo que significa
 * "idempotente" aquí.
 *
 * Lo que NO se hace nunca: borrar nada. Si una base ya tiene sillas de más en una
 * zona (porque una persona las creó por la API), la semilla las respeta.
 *
 * ============================================================================
 * IDEMPOTENCIA
 * ============================================================================
 *  - Sede: `locations(business_id, name)`.
 *  - Zonas: `zones(business_id, location_id, name)`.
 *  - Sillas: `chairs.code` es UNIQUE GLOBAL (`ux_chairs_code`).
 *  - `zones.capacity` se deriva de las sillas (BR-CHAIR-005) y sólo se recalcula
 *    cuando la zona ha cambiado, para que una segunda ejecución no escriba nada.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { logger } from '../../shared/logger/index.js';
import { SqliteSpacesRepository } from '../../modules/spaces/spaces.repository.sqlite.js';
import { ChairKind, type ChairKind as ChairKindValue } from '../../shared/domain/index.js';
import { AUTH } from '../../config/index.js';
import { nowIso } from '../../shared/utils/datetime.js';

/** Nombre de la sede de demostración. */
export const DEMO_LOCATION_NAME = 'Sede Principal';

/** Zona de demostración con su color, su tarifa y sus características. */
export interface DemoZoneSpec {
  readonly name: string;
  readonly code: string;
  readonly colorHex: string;
  /** Centavos por hora. La tarifa de la zona se copia a cada silla. */
  readonly pricePerHourMinor: number;
  /** Etiquetas del vocabulario cerrado de `chairs.features`. */
  readonly features: readonly string[];
}

/**
 * Las cinco zonas de la cafetería, en el orden en que salen en el mapa
 * (`zones.sort_order`).
 */
export const DEMO_ZONES: readonly DemoZoneSpec[] = Object.freeze([
  {
    name: 'Terraza',
    code: 'TRZ',
    colorHex: '#22C55E',
    pricePerHourMinor: 600_000,
    features: ['wifi', 'view'],
  },
  {
    name: 'Interior',
    code: 'INT',
    colorHex: '#3B82F6',
    pricePerHourMinor: 500_000,
    features: ['wifi'],
  },
  {
    name: 'Ventana',
    code: 'VNT',
    colorHex: '#F59E0B',
    pricePerHourMinor: 550_000,
    features: ['wifi', 'view', 'outlet'],
  },
  {
    name: 'Zona Premium',
    code: 'PRM',
    colorHex: '#8B5CF6',
    pricePerHourMinor: 900_000,
    features: ['wifi', 'outlet', 'tv', 'accessible'],
  },
  {
    name: 'Sala de Trabajo',
    code: 'TRB',
    colorHex: '#10B981',
    pricePerHourMinor: 400_000,
    features: ['wifi', 'outlet', 'quiet'],
  },
]);

/** Silla de demostración: tipo, capacidad, etiqueta y celda de la rejilla. */
export interface DemoChairSpec {
  readonly code: string;
  readonly kind: ChairKindValue;
  readonly capacity: number;
  readonly label: string;
  readonly name: string | null;
  readonly gridX: number;
  readonly gridY: number;
  /** Ancho en celdas: las mesas ocupan dos para que quepan los sitios. */
  readonly mapWidth: number;
}

/**
 * Las 25 sillas de la demo, agrupadas por zona con su celda explícita.
 *
 * `map_width = 2` en mesas y áreas: por eso los `grid_x` de esa zona van de dos en
 * dos (0, 2, 4) en lugar de seguidos. Con el mismo patrón, ninguna celda queda
 * compartida por dos muebles.
 */
export const DEMO_CHAIRS: Readonly<Record<string, readonly DemoChairSpec[]>> = Object.freeze({
  Terraza: [
    { code: 'TZ-01', kind: ChairKind.CHAIR, capacity: 1, label: '1', name: 'Terraza 1', gridX: 0, gridY: 0, mapWidth: 1 },
    { code: 'TZ-02', kind: ChairKind.CHAIR, capacity: 1, label: '2', name: 'Terraza 2', gridX: 1, gridY: 0, mapWidth: 1 },
    { code: 'TZ-03', kind: ChairKind.CHAIR, capacity: 1, label: '3', name: 'Terraza 3', gridX: 2, gridY: 0, mapWidth: 1 },
    { code: 'TZ-04', kind: ChairKind.CHAIR, capacity: 1, label: '4', name: 'Terraza 4', gridX: 0, gridY: 1, mapWidth: 1 },
    { code: 'TZ-05', kind: ChairKind.CHAIR, capacity: 1, label: '5', name: 'Terraza 5', gridX: 1, gridY: 1, mapWidth: 1 },
    { code: 'TZ-06', kind: ChairKind.CHAIR, capacity: 1, label: '6', name: 'Terraza 6', gridX: 2, gridY: 1, mapWidth: 1 },
  ],
  Interior: [
    { code: 'IN-M01', kind: ChairKind.TABLE, capacity: 4, label: 'M1', name: 'Mesa 1', gridX: 0, gridY: 0, mapWidth: 2 },
    { code: 'IN-M02', kind: ChairKind.TABLE, capacity: 4, label: 'M2', name: 'Mesa 2', gridX: 2, gridY: 0, mapWidth: 2 },
    { code: 'IN-M03', kind: ChairKind.TABLE, capacity: 6, label: 'M3', name: 'Mesa 3', gridX: 0, gridY: 1, mapWidth: 2 },
    { code: 'IN-M04', kind: ChairKind.TABLE, capacity: 2, label: 'M4', name: 'Mesa 4', gridX: 2, gridY: 1, mapWidth: 2 },
  ],
  Ventana: [
    { code: 'VN-01', kind: ChairKind.COUNTER, capacity: 1, label: 'B1', name: 'Barra 1', gridX: 0, gridY: 0, mapWidth: 1 },
    { code: 'VN-02', kind: ChairKind.COUNTER, capacity: 1, label: 'B2', name: 'Barra 2', gridX: 1, gridY: 0, mapWidth: 1 },
    { code: 'VN-03', kind: ChairKind.COUNTER, capacity: 1, label: 'B3', name: 'Barra 3', gridX: 2, gridY: 0, mapWidth: 1 },
    { code: 'VN-04', kind: ChairKind.COUNTER, capacity: 1, label: 'B4', name: 'Barra 4', gridX: 3, gridY: 0, mapWidth: 1 },
    { code: 'VN-05', kind: ChairKind.COUNTER, capacity: 1, label: 'B5', name: 'Barra 5', gridX: 4, gridY: 0, mapWidth: 1 },
  ],
  'Zona Premium': [
    { code: 'PR-A1', kind: ChairKind.AREA, capacity: 4, label: 'A1', name: 'Salón premium 1', gridX: 0, gridY: 0, mapWidth: 2 },
    { code: 'PR-A2', kind: ChairKind.AREA, capacity: 4, label: 'A2', name: 'Salón premium 2', gridX: 2, gridY: 0, mapWidth: 2 },
    { code: 'PR-A3', kind: ChairKind.AREA, capacity: 4, label: 'A3', name: 'Salón premium 3', gridX: 0, gridY: 1, mapWidth: 2 },
    { code: 'PR-A4', kind: ChairKind.AREA, capacity: 4, label: 'A4', name: 'Salón premium 4', gridX: 2, gridY: 1, mapWidth: 2 },
  ],
  'Sala de Trabajo': [
    { code: 'TW-01', kind: ChairKind.TABLE, capacity: 2, label: 'W1', name: 'Mesa de trabajo 1', gridX: 0, gridY: 0, mapWidth: 2 },
    { code: 'TW-02', kind: ChairKind.TABLE, capacity: 2, label: 'W2', name: 'Mesa de trabajo 2', gridX: 2, gridY: 0, mapWidth: 2 },
    { code: 'TW-03', kind: ChairKind.TABLE, capacity: 2, label: 'W3', name: 'Mesa de trabajo 3', gridX: 4, gridY: 0, mapWidth: 2 },
    { code: 'TW-04', kind: ChairKind.TABLE, capacity: 2, label: 'W4', name: 'Mesa de trabajo 4', gridX: 0, gridY: 1, mapWidth: 2 },
    { code: 'TW-05', kind: ChairKind.TABLE, capacity: 2, label: 'W5', name: 'Mesa de trabajo 5', gridX: 2, gridY: 1, mapWidth: 2 },
    { code: 'TW-06', kind: ChairKind.TABLE, capacity: 2, label: 'W6', name: 'Mesa de trabajo 6', gridX: 4, gridY: 1, mapWidth: 2 },
  ],
});

/** Total de sillas de la demostración, para los tests y el log. */
export const DEMO_CHAIR_COUNT = Object.values(DEMO_CHAIRS).reduce<number>(
  (total, chairs) => total + chairs.length,
  0,
);

/** Resumen de lo que hizo la semilla. */
export interface SpacesDemoSeedResult {
  readonly businessId: number;
  readonly locationId: number;
  readonly createdLocation: boolean;
  readonly zones: readonly { readonly id: number; readonly name: string; readonly chairs: number }[];
  readonly createdZones: number;
  readonly createdChairs: number;
  /** Sillas ya existentes a las que sólo se les concilió algún campo. */
  readonly reconciledChairs: number;
  readonly skipped: boolean;
}

/** Columnas de `chairs` leídas para decidir la conciliación. */
interface ChairSnapshot {
  readonly id: number;
  readonly capacity: number;
  readonly price_per_hour_minor: number;
  readonly grid_x: number;
  readonly grid_y: number;
  readonly map_width: number;
  readonly map_height: number;
  readonly features: string | null;
  readonly number_label: string | null;
  readonly name: string | null;
}

/**
 * Siembra la sede, las zonas y las sillas de demostración. Idempotente.
 *
 * @param db Conexión a usar. Por defecto, la singleton del proceso.
 */
export function seedSpacesDemo(db: Db = getConnection()): SpacesDemoSeedResult {
  const businessId = AUTH.DEFAULT_BUSINESS_ID;
  return runInTransactionSync(() => {
    const spaces = new SqliteSpacesRepository();
    const at = nowIso();

    // --- Sede ---------------------------------------------------------------
    const existingLocation = db
      .prepare('SELECT id FROM locations WHERE business_id = ? AND name = ? AND deleted_at IS NULL')
      .get(businessId, DEMO_LOCATION_NAME) as { id: number } | undefined;
    const createdLocation = existingLocation === undefined;
    const locationId =
      existingLocation?.id ??
      Number(
        db
          .prepare('INSERT INTO locations (business_id, name, is_active) VALUES (?, ?, 1)')
          .run(businessId, DEMO_LOCATION_NAME).lastInsertRowid,
      );

    // --- Zonas y sillas -----------------------------------------------------
    const zones: { id: number; name: string; chairs: number }[] = [];
    let createdZones = 0;
    let createdChairs = 0;
    let reconciledChairs = 0;

    DEMO_ZONES.forEach((zoneSpec, zoneIndex) => {
      const existingZone = db
        .prepare('SELECT id FROM zones WHERE business_id = ? AND name = ? AND deleted_at IS NULL')
        .get(businessId, zoneSpec.name) as { id: number } | undefined;
      const zoneId =
        existingZone?.id ??
        spaces.insertZone({
          businessId,
          locationId,
          name: zoneSpec.name,
          code: zoneSpec.code,
          colorHex: zoneSpec.colorHex,
          sortOrder: zoneIndex + 1,
          isActive: true,
        });
      if (existingZone === undefined) {
        createdZones += 1;
      }

      let zoneChairs = 0;
      let zoneChanged = false;
      for (const chair of DEMO_CHAIRS[zoneSpec.name] ?? []) {
        const existing = spaces.findChairByCode(chair.code);
        if (existing === null) {
          spaces.insertChair({
            zoneId,
            code: chair.code,
            name: chair.name,
            numberLabel: chair.label,
            kind: chair.kind,
            capacity: chair.capacity,
            // Tarifa CONGELADA de la zona, escrita explícita para que la demo no
            // dependa de `businesses.chair_default_price_minor` (BR-CHAIR-002).
            pricePerHourMinor: zoneSpec.pricePerHourMinor,
            gridX: chair.gridX,
            gridY: chair.gridY,
            mapWidth: chair.mapWidth,
            mapHeight: 1,
            rotationDeg: 0,
            features: zoneSpec.features,
            notes: null,
            isBookable: true,
            isActive: true,
            statusChangedAt: at,
          });
          createdChairs += 1;
          zoneChanged = true;
        } else if (reconcileChair(spaces, existing.id, chair, zoneSpec, db)) {
          // Fila de una versión anterior de la semilla: se concilia para que dos
          // ejecuciones converjan al mismo estado. NUNCA se cambia el `status`.
          reconciledChairs += 1;
          zoneChanged = true;
        }
        zoneChairs += 1;
      }
      // BR-CHAIR-005: la capacidad de la zona es la suma de la de sus sillas.
      if (zoneChanged) {
        spaces.recomputeZoneCapacity(zoneId);
      }
      zones.push({ id: zoneId, name: zoneSpec.name, chairs: zoneChairs });
    });

    const skipped =
      createdLocation === false && createdZones === 0 && createdChairs === 0 && reconciledChairs === 0;
    logger.info(
      {
        locationId,
        zones: zones.length,
        chairs: DEMO_CHAIR_COUNT,
        createdChairs,
        reconciledChairs,
        skipped,
      },
      'semilla de espacios aplicada',
    );
    return {
      businessId,
      locationId,
      createdLocation,
      zones,
      createdZones,
      createdChairs,
      reconciledChairs,
      skipped,
    };
  });
}

/**
 * Ajusta una silla ya existente a la definición de la demo.
 *
 * Sólo compara y escribe las columnas que la semilla define (capacidad, tarifa,
 * rejilla, tamaño en el mapa, características y etiquetas). El `status`, los
 * pedidos, las reservas y los alquileres de esa silla no se tocan: son datos de
 * negocio, no de la semilla.
 *
 * @returns `true` si hubo que escribir algo.
 */
function reconcileChair(
  spaces: SqliteSpacesRepository,
  chairId: number,
  spec: DemoChairSpec,
  zoneSpec: DemoZoneSpec,
  db: Db,
): boolean {
  const row = db
    .prepare(
      `SELECT id, capacity, price_per_hour_minor, grid_x, grid_y, map_width, map_height,
              features, number_label, name
         FROM chairs WHERE id = ?`,
    )
    .get(chairId) as ChairSnapshot;
  // `insertChair` guarda las características como JSON: se compara el mismo texto
  // que se escribiría, o la reconciliación detectaría una diferencia inexistente
  // en cada ejecución.
  const features = JSON.stringify(zoneSpec.features);
  const unchanged =
    row.capacity === spec.capacity &&
    row.price_per_hour_minor === zoneSpec.pricePerHourMinor &&
    row.grid_x === spec.gridX &&
    row.grid_y === spec.gridY &&
    row.map_width === spec.mapWidth &&
    row.map_height === 1 &&
    row.features === features &&
    row.number_label === spec.label &&
    row.name === spec.name;
  if (unchanged) {
    return false;
  }
  spaces.updateChair(
    chairId,
    {
      capacity: spec.capacity,
      pricePerHourMinor: zoneSpec.pricePerHourMinor,
      gridX: spec.gridX,
      gridY: spec.gridY,
      mapWidth: spec.mapWidth,
      mapHeight: 1,
      rotationDeg: 0,
      features: zoneSpec.features,
      numberLabel: spec.label,
      name: spec.name,
    },
    db,
  );
  return true;
}
