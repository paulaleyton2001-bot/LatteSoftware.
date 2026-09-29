/**
 * Utilidades compartidas por las SEMILLAS DE DEMOSTRACIÓN.
 *
 * ============================================================================
 * QUÉ ES ESTE FICHERO
 * ============================================================================
 * Las tres semillas de demo (`catalog-demo`, `discounts-demo` y
 * `operations-demo`) necesitan las mismas cuatro cosas:
 *
 *   1. Saber si deben escribirse (política de entorno).
 *   2. Un slug estable a partir de un nombre.
 *   3. Códigos de negocio DETERMINISTAS, que son la clave de idempotencia de los
 *      pedidos, reservas, alquileres y cobros de la demo.
 *   4. Convertir una hora de RELOJ LOCAL de la cafetería a un instante UTC.
 *
 * Ninguna de las cuatro pertenece a un módulo de negocio, así que viven aquí en
 * vez de duplicarse tres veces.
 *
 * ============================================================================
 * LA POLÍTICA: ¿SE SIEMBRA DATOS DE DEMOSTRACIÓN?
 * ============================================================================
 * Regla dura: **nunca en producción**. Un catálogo de ejemplo con veinte productos
 * y una lista de clientes de mentira en una base real es un problema de datos,
 * no de negocio, así que `APP_ENV=production` lo desactiva aunque alguien pase
 * `SEED_DEMO_DATA=true`.
 *
 * En el resto de entornos está ACTIVADO por defecto (que es lo que pide el
 * enunciado: `npm run seed` deja una cafetería demostrable) y se apaga con
 * `SEED_DEMO_DATA=false`. La lectura es perezosa, en tiempo de llamada, y no al
 * importar el módulo: los tests encolan su variable antes de sembrar.
 *
 * ============================================================================
 * CÓDIGOS DE LA DEMO: LA CLAVE DE IDEMPOTENCIA
 * ============================================================================
 * `generateOrderNumber()` y compañía derivan el siguiente código del `MAX` de la
 * columna, así que son únicos pero NO deterministas: sembrar dos veces produciría
 * `ORD-000001` la primera vez y `ORD-000019` la segunda, duplicando el pedido.
 *
 * Aquí los códigos de la demo son FIJOS y predecibles: prefijo real más un
 * número de serie que empieza en 900000 (`ORD-900001`, `RES-900001`,
 * `RENT-900001`, `PAY-900001`). Consecuencias:
 *   - La segunda ejecución encuentra la fila y no escribe nada.
 *   - Un humano reconoce de un vistazo qué filas son de demostración.
 *   - La colisión con un pedido creado por la API es prácticamente imposible
 *     (habría que haber creado 900.000 pedidos a mano), y si ocurriera la
 *     semilla lo detecta y avisa en vez de duplicar.
 */
import { env } from '../../config/index.js';
import type { Db } from '../../shared/database/connection.js';
import { localDateKey, parseIso } from '../../shared/utils/datetime.js';

/** Variable de entorno que apaga la demo (`SEED_DEMO_DATA=false`). */
export const DEMO_DATA_ENV = 'SEED_DEMO_DATA';

/** Primer número de serie de los códigos de demostración. */
export const DEMO_CODE_BASE = 900_000;

/**
 * `true` si las semillas de demostración deben escribir en esta base.
 *
 * Se evalúa en cada llamada (no al importar) para que un test pueda cambiar la
 * variable después de que `config/env.ts` ya haya congelado el entorno.
 */
export function demoSeedEnabled(): boolean {
  // En producción no hay excepción: una base real no se siembra con datos falsos.
  if (env.isProduction) {
    return false;
  }
  const raw = process.env[DEMO_DATA_ENV];
  if (raw === undefined || raw.trim() === '') {
    return true;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * Slug estable a partir de un nombre: sin acentos, en minúsculas, con guiones.
 *
 * Es la misma normalización que usa el módulo de catálogo para sus slugs, y se
 * aplica aquí para que la fila sembrada y la que crearía la API coincidan.
 *
 * @example slugify('Quiche de VEGETAL') // 'quiche-de-vegetal'
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Código de negocio de la demostración, determinista.
 *
 * @example demoCode('ORD-', 1) // 'ORD-900001'
 */
export function demoCode(prefix: string, index: number): string {
  if (!Number.isInteger(index) || index < 1) {
    throw new RangeError(`El índice del código de demo debe ser un entero >= 1, recibido: ${String(index)}`);
  }
  return `${prefix}${String(DEMO_CODE_BASE + index).padStart(6, '0')}`;
}

/** Desplazamiento de una zona horaria IANA respecto de UTC, en milisegundos. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((part) => part.type === type);
    return found === undefined ? 0 : Number(found.value);
  };

  // `hour12: false` puede devolver "24" para medianoche en algunos runtimes.
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Instante ISO-8601 UTC de una hora de RELOJ LOCAL de la cafetería.
 *
 * Sin esto, "un pedido de las 8 de la mañana" acabaría a las 8 UTC, que en
 * Bogotá son las 3 de la madrugada, y los gráficos por hora del panel
 * enseñarian una cafetería que abre de madrugada.
 *
 * El algoritmo es el de dos pasadas habitual: se toma la hora local como si
 * fuera UTC, se mide el desplazamiento real de la zona en ese instante y se
 * corrige. La segunda pasada cubre el caso de los cambios de hora, donde el
 * desplazamiento depende del propio instante (en `America/Bogota` no hay, pero
 * el código no depende de que los haya).
 *
 * @param dateKey `YYYY-MM-DD` en la zona del negocio (`localDateKey`).
 * @param hour    Hora local, 0..23.
 * @param minute  Minuto local, 0..59.
 * @param timeZone Zona IANA del negocio (`businesses.timezone`).
 */
export function zonedLocalIso(
  dateKey: string,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`La hora local debe ser un entero entre 0 y 23, recibido: ${String(hour)}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`El minuto local debe ser un entero entre 0 y 59, recibido: ${String(minute)}`);
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  const naive = Date.parse(`${dateKey}T${pad(hour)}:${pad(minute)}:00.000Z`);
  if (Number.isNaN(naive)) {
    throw new Error(`No se pudo interpretar la fecha local "${dateKey}"`);
  }
  const firstPass = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  return new Date(naive - zoneOffsetMs(firstPass, timeZone)).toISOString();
}

/**
 * `YYYY-MM-DD` local de hace `daysAgo` días, en la zona del negocio.
 *
 * Es la clave con la que se describen las fechas de la demo ("un pedido de hace
 * 12 días"): expresarlas en días locales y no en UTC evita que un pedido de la
 * tarde caiga en el día anterior al que dice la demo. Un valor NEGATIVO es un
 * día en el futuro, que es lo que necesita la reserva de mañana.
 */
export function localDayKey(daysAgo: number, now: string, timeZone: string): string {
  if (!Number.isInteger(daysAgo)) {
    throw new RangeError(`daysAgo debe ser un entero, recibido: ${String(daysAgo)}`);
  }
  const shifted = new Date(parseIso(now).getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return localDateKey(shifted, timeZone);
}

/**
 * Valor entero de la primera columna de una consulta, o `null` si no hay fila.
 *
 * Las semillas leen sus propias filas para decidir qué insertar; con esto no
 * hay `as { id: number } | undefined` repetido quince veces ni casts inseguros.
 */
export function scalarInt(db: Db, sql: string, ...params: readonly unknown[]): number | null {
  const row = db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
  if (row === undefined) {
    return null;
  }
  const first = Object.values(row)[0];
  return typeof first === 'number' ? first : null;
}

/**
 * Falla con un mensaje accionable si una tabla de la demo está vacía.
 *
 * Es la red de seguridad del orden de siembra: si alguien invoca
 * `seedOperationsDemo` sin el catálogo, es mejor un error explícito que pedidos
 * con `product_id` a NULL o sin variante por defecto.
 */
export function assertSeeded(table: string, db: Db, hint: string): void {
  const total = scalarInt(db, `SELECT COUNT(*) AS total FROM ${table}`);
  if (total === null || total === 0) {
    throw new Error(
      `La semilla de demostración necesita datos en "${table}": ${hint}`,
    );
  }
}
