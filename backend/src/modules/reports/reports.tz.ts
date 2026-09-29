/**
 * CORTE POR ZONA HORARIA PARA REPORTES.
 *
 * ============================================================================
 * POR QUÉ ESTE FICHERO EXISTE Y NO ESTÁ EN `shared/utils/datetime.ts`
 * ============================================================================
 * `shared/utils/datetime.ts` es compartido y su encabezado dice, con razón, que
 * "la conversión desde la zona IANA del negocio es responsabilidad del service
 * de negocio, no de estas funciones". Estas son esas funciones, y viven aquí
 * porque son de uso EXCLUSIVO del módulo de reportes. No se edita el fichero
 * compartido para no tocar código que otros módulos ya dependen y verifican.
 *
 * ============================================================================
 * EL PROBLEMA QUE RESUELVE
 * ============================================================================
 * En la base de datos TODO instante está guardado como ISO-8601 **UTC**
 * (`2026-09-28T22:18:21.738Z`). El negocio, en cambio, razona en hora local de
 * Bogotá (`America/Bogota`, UTC-5): su día va de las 00:00:00 a las 24:00:00
 * **locales**, no de las 00:00:00 a las 24:00:00 UTC.
 *
 * La diferencia no es cosmética: un café vendido a las 21:30 hora de Bogotá está
 * a las 02:30 UTC del día SIGUIENTE. Si un reporte agrupara por `substr(created_at,1,10)`
 * en UTC, esa venta aparecería en el día equivocado del gráfico y el total del
 * "hoy" del administrador no cuadraría con la caja. Ése es exactamente el
 * error que este módulo evita.
 *
 * ============================================================================
 * MECANISMO, EN CUATRO PASOS
 * ============================================================================
 *  1. Un instante UTC se proyecta a la zona con `Intl.DateTimeFormat` y se lee
 *     el desfase real (offset) que la zona tenía EN ESE INSTANTE. El offset se
 *     obtiene restando el "reloj de pared" del instante UTC; no hay tabla de
 *     offsets hardcodeada, así que funciona con cualquier zona IANA y con el
 *     horario de verano de los países que lo tienen.
 *  2. Un instante UTC se bringa a la zona restando ese offset en milisegundos
 *     (`utc - offset * 60_000`).
 *  3. Para construir un rango se parte de la MEDIANOCHE LOCAL y se resuelve su
 *     instante UTC con dos iteraciones de punto fijo, porque la midnight local
 *     puede caer en el lado ambiguo de un cambio de horario de verano.
 *  4. Para **agrupar en SQL** se devuelve un `TimeZonePlan`: una lista de
 *     tramos `{ desdeUtc, offsetMinutos }` ordenados. El repositorio lo
 *     traduce a un `CASE` de `strftime`; para `America/Bogota` (sin horario de
 *     verano desde 1993) el plan tiene UN solo tramo, que es el caso normal.
 */

/** Milisegundos en un minuto. */
const MS_PER_MINUTE = 60_000;

/** Milisegundos en un día. */
const MS_PER_DAY = 86_400_000;

/** Paso de muestreo para detectar cambios de offset dentro de un rango. */
const OFFSET_PROBE_STEP_MS = 12 * 60 * MS_PER_MINUTE;

/** Fecha civil local: `{ año, mes, día }`, mes 1-12. */
export interface LocalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Fecha y hora local. */
export interface LocalDateTime extends LocalDate {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/**
 * Un tramo del rango en el que el desfase de la zona es CONSTANTE.
 * `fromUtc` es el instante (inclusive) en el que empieza a aplicar `offsetMinutes`.
 */
export interface OffsetSegment {
  readonly fromUtc: string;
  readonly offsetMinutes: number;
}

/**
 * Plan de zona horaria de un rango concreto.
 *
 * Es lo que el repositorio necesita para traducir un `created_at` guardado en
 * UTC a su fecha/hora local dentro de SQL, sin que SQL tenga que saber nada de
 * `Intl` ni de zonas IANA.
 */
export interface TimeZonePlan {
  /** Zona IANA efectiva, tal y como está en `businesses.timezone`. */
  readonly timezone: string;
  /** Tramos ordenados de más antiguo a más reciente. Nunca vacío. */
  readonly segments: readonly OffsetSegment[];
  /** `true` si todo el rango comparte un único offset (caso de Bogotá). */
  readonly singleOffset: boolean;
  /** Desfase único cuando `singleOffset` es `true`; `null` en caso contrario. */
  readonly offsetMinutes: number | null;
}

/** `true` si la cadena es un identificador de zona horaria IANA válido. */
export function isValidTimeZone(value: string): boolean {
  try {
    // `Intl` lanza `RangeError` si la zona no existe: es el validador oficial.
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Caché de formateadores por zona: construir uno cuesta más que formatear. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/** `Intl.DateTimeFormat` reutilizable para una zona. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached !== undefined) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  FORMATTERS.set(timeZone, created);
  return created;
}

/** Partes de un instante tal y como las ve la zona IANA indicada. */
function partsIn(instant: Date, timeZone: string): LocalDateTime {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((part) => part.type === type);
    return found?.value ?? '0';
  };
  return {
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    // `Intl` puede devolver "24" en medianoche con `hourCycle: 'h23'` en algunas
    // versiones de ICU; se normaliza a 0 porque 24:00 ES el día siguiente 00:00.
    hour: Number(read('hour')) % 24,
    minute: Number(read('minute')),
    second: Number(read('second')),
  };
}

/**
 * Desfase de la zona IANA, en MINUTOS, respecto de UTC, EN ESE INSTANTE.
 *
 * Positivo hacia el este (`Asia/Tokyo` = +540), negativo hacia el oeste
 * (`America/Bogota` = -300). Se calcula comparando el reloj de pared local con
 * el propio instante, por lo que respeta el horario de verano sin tablas
 * externas: si la zona cambia de offset, el valor cambia con ella.
 */
export function offsetMinutesAt(instant: Date, timeZone: string): number {
  const wall = partsIn(instant, timeZone);
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  // Se trunca a segundos porque `Date.UTC` no conserva milisegundos y sin
  // truncar aparecería un offset fraccionario espurio (p. ej. -300.0166).
  const instantTruncated = Math.floor(instant.getTime() / 1000) * 1000;
  return Math.round((asUtc - instantTruncated) / MS_PER_MINUTE);
}

/**
 * Instante UTC que corresponde a una fecha-hora de PARED en la zona IANA.
 *
 * Dos iteraciones de punto fijo: la primera puede fallar cuando la hora local
 * cae en el tramo repetido de un cambio de horario de verano, y la segunda
 * corrige usando el offset ya calculado sobre el instante correcto.
 */
export function zonedToUtc(wall: LocalDateTime, timeZone: string): Date {
  const naive = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  const firstOffset = offsetMinutesAt(new Date(naive), timeZone);
  const firstGuess = naive - firstOffset * MS_PER_MINUTE;
  const secondOffset = offsetMinutesAt(new Date(firstGuess), timeZone);
  if (secondOffset === firstOffset) return new Date(firstGuess);
  return new Date(naive - secondOffset * MS_PER_MINUTE);
}

/** Fecha civil local que contiene el instante. */
export function localDateOf(instant: Date, timeZone: string): LocalDate {
  const parts = partsIn(instant, timeZone);
  return { year: parts.year, month: parts.month, day: parts.day };
}

/** `YYYY-MM-DD` local del instante. Coincide con `shared/utils/datetime.localDateKey`. */
export function localDateKey(instant: Date, timeZone: string): string {
  const date = localDateOf(instant, timeZone);
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/** Hora local (0-23) del instante. */
export function localHourOf(instant: Date, timeZone: string): number {
  return partsIn(instant, timeZone).hour;
}

/** Día de la semana local: 0 = domingo … 6 = sábado (convención `getDay`). */
export function localWeekdayOf(instant: Date, timeZone: string): number {
  const date = localDateOf(instant, timeZone);
  // `Date.UTC` con las partes civiles locales da el día de la semana correcto
  // aunque el instante original esté desplazado: lo que importa es el calendario.
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/**
 * Suma días de CALENDARIO a una fecha local.
 *
 * Se hace con aritmética civil en UTC, no con milisegundos: sumar 86 400 000 ms
 * a un instante también suma días, pero aquí lo que se suma son DÍAS LOCALES y
 * un cambio de horario de verano los haría valer 23 o 25 horas.
 */
export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * MS_PER_DAY);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Primer día del mes de la fecha local. */
export function startOfLocalMonth(date: LocalDate): LocalDate {
  return { year: date.year, month: date.month, day: 1 };
}

/** Mes anterior al de la fecha local (enero -> diciembre del año anterior). */
export function previousLocalMonth(date: LocalDate): LocalDate {
  return date.month === 1
    ? { year: date.year - 1, month: 12, day: 1 }
    : { year: date.year, month: date.month - 1, day: 1 };
}

/**
 * Instante UTC de las 00:00:00.000 **locales** del día indicado.
 *
 * Ésta es la pieza que convierte "hoy" del negocio en un intervalo de UTC: el
 * `today` de Bogotá empieza a las 05:00:00Z en invierno, no a las 00:00:00Z.
 */
export function startOfLocalDayUtc(date: LocalDate, timeZone: string): Date {
  return zonedToUtc({ ...date, hour: 0, minute: 0, second: 0 }, timeZone);
}

/**
 * Convierte una clave `YYYY-MM-DD` en sus tres partes numéricas.
 *
 * Es la inversa de {@link localDateKey} y la usan tanto el service (preset
 * `custom`) como los tests, que necesitan construir exactamente la misma
 * medianoche local que construye el service: si el test usara su propia
 * aritmética, estaría probando dos implementaciones en lugar de una.
 */
export function parseLocalDateKey(key: string): LocalDate {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (parts === null) {
    throw new RangeError(`"${key}" no es una fecha local YYYY-MM-DD`);
  }
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new RangeError(`"${key}" no es una fecha local válida`);
  }
  return { year, month, day };
}

/** Instante UTC de las 00:00:00.000 locales del día siguiente. */
export function startOfNextLocalDayUtc(date: LocalDate, timeZone: string): Date {
  return startOfLocalDayUtc(addLocalDays(date, 1), timeZone);
}

/** Minutos exactos entre dos instantes. */
export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / MS_PER_MINUTE;
}

/** `true` si la fecha local es domingo. */
export function isSunday(date: LocalDate): boolean {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay() === 0;
}

/**
 * Localizadores de fecha dentro de un rango, en zona local.
 *
 * Se usa para rellenar los huecos de una serie (`/sales-by-day`): la consulta
 * agrupada en SQL sólo devuelve los días con actividad, y el gráfico no puede
 * tener huecos, así que el service completa la serie con ceros.
 */
export function localDatesInRange(from: Date, to: Date, timeZone: string): LocalDate[] {
  const dates: LocalDate[] = [];
  let cursor = localDateOf(from, timeZone);
  const last = localDateOf(new Date(to.getTime() - 1), timeZone);
  // Tope defensivo: un rango de reportes está acotado por REPORT.MAX_RANGE_DAYS.
  for (let guard = 0; guard < 800; guard += 1) {
    dates.push(cursor);
    if (cursor.year === last.year && cursor.month === last.month && cursor.day === last.day) break;
    cursor = addLocalDays(cursor, 1);
  }
  return dates;
}

/**
 * Devuelve los puntos donde el offset de la zona cambia dentro de `[from, to)`.
 *
 * Estrategia: se sondea el offset cada 12 horas (ningún cambio de horario de
 * verano del mundo dura menos de eso, así que ningún tramo se pierde) y, cada
 * vez que el valor cambia, se acota el instante exacto con búsqueda binaria al
 * segundo. El resultado son `{ desdeUtc, offsetMinutos }` listos para el `CASE`
 * de SQL. Para `America/Bogota` el array sale con un único tramo, que es lo
 * correcto: Colombia no aplica horario de verano desde 1993.
 */
function findOffsetSegments(from: Date, to: Date, timeZone: string): OffsetSegment[] {
  if (to.getTime() <= from.getTime()) {
    return [{ fromUtc: from.toISOString(), offsetMinutes: offsetMinutesAt(from, timeZone) }];
  }

  const startOffset = offsetMinutesAt(from, timeZone);
  const boundaries: number[] = [from.getTime()];

  let previousMs = from.getTime();
  let previousOffset = startOffset;
  for (let probe = from.getTime() + OFFSET_PROBE_STEP_MS; probe < to.getTime(); probe += OFFSET_PROBE_STEP_MS) {
    const offset = offsetMinutesAt(new Date(probe), timeZone);
    if (offset !== previousOffset) {
      // Acota el cambio al segundo exacto entre el último sondeo estable y este.
      let low = previousMs;
      let high = probe;
      while (high - low > 1000) {
        const mid = low + Math.floor((high - low) / 2);
        if (offsetMinutesAt(new Date(mid), timeZone) === previousOffset) low = mid;
        else high = mid;
      }
      boundaries.push(high);
      previousOffset = offset;
    }
    previousMs = probe;
  }

  const boundariesIso = [...new Set(boundaries)].sort((a, b) => a - b);
  // El offset de cada frontera se recalcula SOBRE ESA FRONTERA, y no se arrastra
  // del tramo anterior: en el instante del cambio el valor nuevo ya es el
  // vigente, que es justo lo que el `CASE` de SQL necesita en ese lado.
  return boundariesIso.map((boundaryMs) => ({
    fromUtc: new Date(boundaryMs).toISOString(),
    offsetMinutes: offsetMinutesAt(new Date(boundaryMs), timeZone),
  }));
}

/**
 * Plan de zona horaria para un rango, listo para que el repositorio construya
 * el `strftime` con offset en SQL.
 *
 * @param fromUtc Inicio del rango (inclusive).
 * @param toUtc   Fin del rango (exclusive).
 */
export function buildTimeZonePlan(fromUtc: Date, toUtc: Date, timeZone: string): TimeZonePlan {
  const segments = findOffsetSegments(fromUtc, toUtc, timeZone);
  const first = segments[0];
  const singleOffset = segments.length === 1;
  return {
    timezone: timeZone,
    segments,
    singleOffset,
    offsetMinutes: first === undefined ? offsetMinutesAt(fromUtc, timeZone) : first.offsetMinutes,
  };
}
