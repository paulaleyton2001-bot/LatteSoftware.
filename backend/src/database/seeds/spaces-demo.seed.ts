/**
 * Semilla de demostración de ESPACIOS: una sede, zonas y sillas.
 *
 * ============================================================================
 * POR QUÉ EXISTE
 * ============================================================================
 * El esquema y la semilla de arranque (`seeds/index.ts`) crean el negocio
 * (`businesses.id = 1`) y la matriz de RBAC, pero no la sede: `locations` queda
 * vacía, y `zones.location_id` es `NOT NULL` con FK a `locations`. Sin una sede no
 * hay forma de crear la primera zona, ni por API ni por test.
 *
 * El módulo de `locations` todavía no existe (API.md 7.5), así que esta semilla
 * siembra la sede mínima que necesita la familia de espacios. Es idempotente: se
 * puede ejecutar tantas veces como haga falta sin duplicar nada.
 *
 * ============================================================================
 * CONECTADA A `seeds/index.ts` (tercer paso del pipeline)
 * ============================================================================
 * `runSeed()` la invoca DESPUÉS de `roles-permissions` y de
 * `development-accounts`, y por tanto después del negocio singleton: el orden
 * lo impone el esquema (`businesses` -> `locations` -> `zones` -> `chairs`).
 * `npm run seed` crea ya la sede, las zonas y las sillas.
 *
 * Sigue siendo EXPORTABLE y se puede llamar sola (los tests lo hacen) porque
 * es idempotente: repetida sobre una base ya sembrada no escribe nada y
 * devuelve los mismos identificadores.
 *
 * ============================================================================
 * QUÉ SIEMBRA
 * ============================================================================
 *  - Sede `Sede Principal` (id 1 en una base nueva).
 *  - Zona `Terraza` con 6 sillas y zona `Interior` con 4 mesas: dos `kind`
 *    distintos para probar que `chairs` modela los cuatro tipos de espacio
 *    (DESIGN.md 4.3, decisión D2).
 *  - Coordenadas de grilla en un reparto 3x2 y 2x2, para que `GET /chairs/map`
 *    devuelva `bounds` con sentido desde el primer momento.
 *  - Precio por hora de $5.000 (500000 centavos), que es el valor por defecto de
 *    `businesses.chair_default_price_minor`, así que los importes de los ejemplos
 *    son los de la documentación.
 */
import { getConnection, type Db } from '../../shared/database/connection.js';
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { logger } from '../../shared/logger/index.js';
import { SqliteSpacesRepository } from '../../modules/spaces/spaces.repository.sqlite.js';
import { AUTH } from '../../config/index.js';

/** Nombre de la sede de demostración. */
export const DEMO_LOCATION_NAME = 'Sede Principal';

/** Zonas de demostración, con su color y su retícula. */
const DEMO_ZONES = [
  { name: 'Terraza', code: 'TRZ', colorHex: '#22C55E', gridWidth: 3, gridHeight: 2 },
  { name: 'Interior', code: 'INT', colorHex: '#3B82F6', gridWidth: 2, gridHeight: 2 },
] as const;

/** Sillas por zona, con `kind`, capacidad y etiqueta. */
const DEMO_CHAIRS: Readonly<Record<string, readonly { code: string; kind: 'CHAIR' | 'TABLE'; capacity: number; label: string }[]>> = {
  Terraza: [
    { code: 'TZ-01', kind: 'CHAIR', capacity: 1, label: '1' },
    { code: 'TZ-02', kind: 'CHAIR', capacity: 1, label: '2' },
    { code: 'TZ-03', kind: 'CHAIR', capacity: 1, label: '3' },
    { code: 'TZ-04', kind: 'CHAIR', capacity: 1, label: '4' },
    { code: 'TZ-05', kind: 'CHAIR', capacity: 1, label: '5' },
    { code: 'TZ-06', kind: 'CHAIR', capacity: 1, label: '6' },
  ],
  Interior: [
    { code: 'IN-M01', kind: 'TABLE', capacity: 4, label: 'M1' },
    { code: 'IN-M02', kind: 'TABLE', capacity: 4, label: 'M2' },
    { code: 'IN-M03', kind: 'TABLE', capacity: 6, label: 'M3' },
    { code: 'IN-M04', kind: 'TABLE', capacity: 2, label: 'M4' },
  ],
};

/** Características de ejemplo por tipo de mueble. */
const DEMO_FEATURES: readonly string[] = ['wifi', 'outlet'];

/** Resumen de lo que hizo la semilla. */
export interface SpacesDemoSeedResult {
  readonly businessId: number;
  readonly locationId: number;
  readonly createdLocation: boolean;
  readonly zones: readonly { readonly id: number; readonly name: string; readonly chairs: number }[];
  readonly createdZones: number;
  readonly createdChairs: number;
  readonly skipped: boolean;
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

    // --- Zonas --------------------------------------------------------------
    const zones: { id: number; name: string; chairs: number }[] = [];
    let createdZones = 0;
    let createdChairs = 0;
    let chairIndex = 0;

    for (const [zoneIndex, zone] of DEMO_ZONES.entries()) {
      const existingZone = db
        .prepare('SELECT id FROM zones WHERE business_id = ? AND name = ? AND deleted_at IS NULL')
        .get(businessId, zone.name) as { id: number } | undefined;
      const zoneId =
        existingZone?.id ??
        spaces.insertZone({
          businessId,
          locationId,
          name: zone.name,
          code: zone.code,
          colorHex: zone.colorHex,
          sortOrder: zoneIndex + 1,
          isActive: true,
        });
      if (existingZone === undefined) {
        createdZones += 1;
      }

      let zoneChairs = 0;
      for (const chair of DEMO_CHAIRS[zone.name] ?? []) {
        // Rejilla: se recorren de izquierda a derecha y de arriba abajo.
        const gridX = chairIndex % zone.gridWidth;
        const gridY = Math.floor(chairIndex / zone.gridWidth);
        chairIndex += 1;
        if (spaces.findChairByCode(chair.code) !== null) {
          zoneChairs += 1;
          continue;
        }
        spaces.insertChair({
          zoneId,
          code: chair.code,
          name: null,
          numberLabel: chair.label,
          kind: chair.kind,
          capacity: chair.capacity,
          // Sin precio explícito: hereda `businesses.chair_default_price_minor`
          // (BR-CHAIR-002). Se escribe el valor por defecto del negocio para que
          // la semilla no dependa de que exista la fila de `businesses`.
          pricePerHourMinor: defaultPriceMinor(db, businessId),
          gridX,
          gridY,
          mapWidth: chair.kind === 'TABLE' ? 2 : 1,
          mapHeight: 1,
          rotationDeg: 0,
          features: DEMO_FEATURES,
          notes: null,
          isBookable: true,
          isActive: true,
          statusChangedAt: new Date().toISOString(),
        });
        createdChairs += 1;
        zoneChairs += 1;
      }
      // BR-CHAIR-005: la capacidad de la zona es la suma de la de sus sillas.
      spaces.recomputeZoneCapacity(zoneId);
      zones.push({ id: zoneId, name: zone.name, chairs: zoneChairs });
      chairIndex = 0;
    }

    const skipped = createdLocation === false && createdZones === 0 && createdChairs === 0;
    logger.info(
      { locationId, zones: zones.length, createdChairs, skipped },
      'semilla de espacios aplicada',
    );
    return {
      businessId,
      locationId,
      createdLocation,
      zones,
      createdZones,
      createdChairs,
      skipped,
    };
  });
}

/** `businesses.chair_default_price_minor` con un valor de reserva si falta la fila. */
function defaultPriceMinor(db: Db, businessId: number): number {
  const row = db
    .prepare('SELECT chair_default_price_minor FROM businesses WHERE id = ? LIMIT 1')
    .get(businessId) as { chair_default_price_minor: number } | undefined;
  return row?.chair_default_price_minor ?? 500_000;
}
