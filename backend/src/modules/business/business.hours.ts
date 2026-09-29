/**
 * Dominio del horario del negocio: semana, validación de franjas y estado
 * "abierto/cerrado" en una zona horaria concreta.
 *
 * ============================== POR QUÉ ES UN FICHERO APARTE ================
 * Estas funciones son PURAS: reciben datos y un instante, y devuelven datos. No
 * conocen la base de datos, ni Express, ni el reloj global (DESIGN.md 3.2: "el
 * tiempo entra como parámetro"). Eso es lo que permite probar el estado del
 * local con un reloj INYECTADO: la prueba no depende de la hora real.
 *
 * ============================== REGLAS QUE APLICA ============================
 *  - Un día es UN único intervalo `[opens_at, closes_at)`. El esquema congelado
 *    (`0001_init.sql`) NO tiene columnas de descanso: no hay horario de comida
 *    partido. Un tramo de descanso se modela cerrando y reabriendo el día, no
 *    con un campo que no existe.
 *  - `closes_at < opens_at` significaría "cierra de madrugada". `PUT /hours` lo
 *    rechaza con `422` (una cafetería no cierra de madrugada y el cliente móvil
 *    no sabe pintar esa ventana), pero la EVALUACIÓN lo tolera para que una
 *    fila antigua o written a mano no rompa `GET /business/status`.
 *  - `closes_at == opens_at` es un día 24 horas: se acepta.
 *  - Todo se evalúa en la zona IANA del negocio (`businesses.timezone`), que es
 *    la hora que ve el cliente. Por defecto `America/Bogota`.
 */
import { MONEY } from '../../config/constants.js';
import { BusinessRuleError, ValidationError } from '../../shared/errors/index.js';
import { localDateKey, localTimeKey } from '../../shared/utils/datetime.js';
import type { BusinessClosedReason, BusinessHourView, BusinessStatusView } from './business.types.js';

/** Día de la semana: 0 = domingo … 6 = sábado (convención `Date.getDay()`). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Los siete días, en orden. */
export const DAYS_OF_WEEK: readonly DayOfWeek[] = Object.freeze([
  0, 1, 2, 3, 4, 5, 6,
] as const);

/**
 * Semana por defecto: los mismos valores que los `DEFAULT` de las columnas
 * `business_hours` (`08:00`–`20:00`, abierto). La usa el servicio cuando el
 * negocio todavía no tiene filas de horario, porque la semilla de despliegue
 * crea el negocio pero no su semana.
 */
export const DEFAULT_WEEK: readonly BusinessHourView[] = Object.freeze(
  DAYS_OF_WEEK.map((dayOfWeek) =>
    Object.freeze({
      id: null,
      dayOfWeek,
      opensAt: '08:00',
      closesAt: '20:00',
      isClosed: false,
    }),
  ),
) as readonly BusinessHourView[];

/** Festivo relevante para el cálculo de estado. */
export interface HolidaySlot {
  readonly holidayDate: string;
  readonly name: string;
  readonly isClosed: boolean;
}

/** `HH:MM` estricto. El `CHECK` del esquema usa el mismo rango. */
const HH_MM = /^([01][0-9]|2[0-3]):([0-5][0-9])$/;

/** `YYYY-MM-DD` con día real del calendario (rechaza `2026-02-30`). */
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` si el texto es una hora `HH:MM` válida. */
export function isHhMm(value: string): boolean {
  return HH_MM.test(value);
}

/** `true` si el texto es una fecha `YYYY-MM-DD` de calendario real. */
export function isCalendarDate(value: string): boolean {
  const match = DATE_KEY.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

/** Minutos desde medianoche de una hora `HH:MM`. `NaN` si no es válida. */
export function minutesOfHhMm(value: string): number {
  const match = HH_MM.exec(value);
  if (match === null) {
    return Number.NaN;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `HH:MM` -> minutos. Lanza `ValidationError` si el formato no es válido. */
export function requireHhMm(field: string, value: string): number {
  const minutes = minutesOfHhMm(value);
  if (Number.isNaN(minutes)) {
    throw new ValidationError('La hora no es válida', {
      details: [
        {
          path: field,
          message: 'Debe tener formato HH:MM en formato de 24 horas, por ejemplo 08:30',
          code: 'INVALID_TIME_FORMAT',
        },
      ],
    });
  }
  return minutes;
}

/** Día de la semana (0 = domingo) de una fecha `YYYY-MM-DD`. */
export function dayOfWeekOf(dateKey: string): number {
  const match = DATE_KEY.exec(dateKey);
  if (match === null) {
    throw new ValidationError('La fecha no es válida', {
      details: [
        { path: 'holidayDate', message: 'Debe tener formato YYYY-MM-DD', code: 'INVALID_FORMAT' },
      ],
    });
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** Desplaza una fecha `YYYY-MM-DD` un número de días. */
export function shiftDateKey(dateKey: string, days: number): string {
  const match = DATE_KEY.exec(dateKey);
  if (match === null) {
    throw new ValidationError('La fecha no es válida', {
      details: [{ path: 'date', message: 'Debe tener formato YYYY-MM-DD', code: 'INVALID_FORMAT' }],
    });
  }
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(base + days * 86_400_000).toISOString().slice(0, 10);
}

/** Desplaza una hora `HH:MM` un número de minutos, con vuelta a medianoche. */
export function shiftHhMm(value: string, minutes: number): string {
  const total = (minutesOfHhMm(value) + minutes + 1440) % 1440;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/**
 * Desplazamiento de la zona horaria, en milisegundos, para un instante dado.
 *
 * `Date` no sabe de zonas IANA; la conversión correcta es restar la "hora de
 * pared" que la zona muestra al instante de la "hora de pared" en UTC.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * Convierte una hora de pared del negocio (`YYYY-MM-DD` + `HH:MM`) al instante
 * ISO-8601 UTC que le corresponde.
 *
 * Se itera dos veces: el primer cálculo usa el desplazamiento vigente en ese
 * instante aproximado, y el segundo lo corrige. Dos pasadas bastan para resolver
 * el caso del cambio de hora de verano, que es el único motivo por el que el
 * desplazamiento puede no coincidir.
 */
export function wallTimeToInstant(dateKey: string, hhmm: string, timeZone: string): string {
  const match = DATE_KEY.exec(dateKey);
  if (match === null || !isHhMm(hhmm)) {
    throw new ValidationError('No se pudo convertir la hora local a un instante', {
      details: [{ path: 'date', message: 'Fecha u hora local inválida', code: 'INVALID_FORMAT' }],
    });
  }
  const wallAsUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(hhmm.slice(0, 2)),
    Number(hhmm.slice(3, 5)),
  );
  let instant = wallAsUtc;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    instant = wallAsUtc - zoneOffsetMs(new Date(instant), timeZone);
  }
  return new Date(instant).toISOString();
}

/** `true` si la zona IANA existe en el runtime de Node. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.trim().length === 0) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Zona horaria por defecto del despliegue (`America/Bogota`). */
export const DEFAULT_TIMEZONE = MONEY.DEFAULT_TIMEZONE;

/**
 * Valida la semana completa que llega en `PUT /business/hours`.
 *
 * Falla con `400` si no llegan exactamente los siete días o si alguno está
 * repetido, y con `422` si una franja abierta no es coherente. Son dos clases
 * de fallo distintas y con códigos distintos: `INCOMPLETE_WEEK` y
 * `DUPLICATE_DAY_OF_WEEK` son forma de la petición; `INVALID_HOURS_RANGE` es una
 * regla de negocio.
 *
 * @returns Los siete días, ordenados de 0 a 6.
 */
export function normalizeWeek(
  days: readonly { readonly dayOfWeek: number; readonly opensAt: string; readonly closesAt: string; readonly isClosed: boolean }[],
): BusinessHourView[] {
  if (days.length !== 7) {
    throw new ValidationError('La semana debe tener los siete días', {
      details: [
        {
          path: 'hours',
          message: `Se recibieron ${days.length} días y se esperaban 7 (uno por cada día de la semana)`,
          code: 'INCOMPLETE_WEEK',
        },
      ],
    });
  }

  const byDay = new Map<number, (typeof days)[number]>();
  for (const day of days) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throw new ValidationError('El día de la semana no es válido', {
        details: [
          {
            path: 'hours',
            message: 'dayOfWeek debe ser un entero entre 0 (domingo) y 6 (sábado)',
            code: 'INVALID_VALUE',
          },
        ],
      });
    }
    if (byDay.has(day.dayOfWeek)) {
      throw new ValidationError('La semana tiene días repetidos', {
        details: [
          {
            path: 'hours',
            message: `El día ${day.dayOfWeek} aparece más de una vez`,
            code: 'DUPLICATE_DAY_OF_WEEK',
          },
        ],
      });
    }
    byDay.set(day.dayOfWeek, day);
  }

  return DAYS_OF_WEEK.map((dayOfWeek) => {
    const day = byDay.get(dayOfWeek);
    if (day === undefined) {
      throw new ValidationError('La semana debe tener los siete días', {
        details: [
          {
            path: 'hours',
            message: `Falta el día ${dayOfWeek} de la semana`,
            code: 'INCOMPLETE_WEEK',
          },
        ],
      });
    }
    return assertValidSlot(day, dayOfWeek);
  });
}

/** Valida un día suelto: formatos de hora y coherencia de la franja. */
function assertValidSlot(
  day: { readonly opensAt: string; readonly closesAt: string; readonly isClosed: boolean },
  dayOfWeek: number,
): BusinessHourView {
  const opensAt = requireHhMm(`hours[${dayOfWeek}].opensAt`, day.opensAt);
  const closesAt = requireHhMm(`hours[${dayOfWeek}].closesAt`, day.closesAt);

  if (day.isClosed) {
    return {
      id: null,
      dayOfWeek,
      opensAt: day.opensAt,
      closesAt: day.closesAt,
      isClosed: true,
    };
  }

  // `closesAt < opensAt` sería un cierre de madrugada: la cafetería no lo permite.
  // `closesAt == opensAt` sí es un día 24 horas y se acepta.
  if (closesAt < opensAt) {
    throw new BusinessRuleError('La hora de cierre no puede ser anterior a la de apertura', {
      details: {
        code: 'INVALID_HOURS_RANGE',
        dayOfWeek,
        opensAt: day.opensAt,
        closesAt: day.closesAt,
        hint: 'Un día es un único intervalo: el cierre debe ser posterior a la apertura (o igual, para un día 24 horas)',
      },
    });
  }

  return { id: null, dayOfWeek, opensAt: day.opensAt, closesAt: day.closesAt, isClosed: false };
}

/** Ventana de apertura de un día, como instantes UTC. `null` si está cerrado. */
function windowOf(
  dateKey: string,
  slot: BusinessHourView,
  timeZone: string,
): { readonly start: string; readonly end: string } | null {
  if (slot.isClosed) {
    return null;
  }
  const start = wallTimeToInstant(dateKey, slot.opensAt, timeZone);
  const end = wallTimeToInstant(dateKey, slot.closesAt, timeZone);
  // Cierre de madrugada (sólo posible en filas antiguas): la ventana termina al
  // día siguiente.
  return end <= start
    ? { start, end: wallTimeToInstant(shiftDateKey(dateKey, 1), slot.closesAt, timeZone) }
    : { start, end };
}

/** Festivo que cierra la fecha dada, o `null`. */
function closingHolidayOn(
  dateKey: string,
  holidays: readonly HolidaySlot[],
): HolidaySlot | null {
  const match = holidays.find((holiday) => holiday.holidayDate === dateKey && holiday.isClosed);
  return match ?? null;
}

/**
 * Calcula si el local está abierto en `at`.
 *
 * Función PURA y con reloj inyectado: `at` es un parámetro, así que la prueba
 * del estado del local no depende de la hora real del momento de ejecutarla.
 *
 * El orden de decisión es el que espera el cliente:
 *  1. Si hoy es festivo con `is_closed = 1`, el local está cerrado.
 *  2. Si el día de la semana está marcado como cerrado, el local está cerrado.
 *  3. Si no hay horario configurado (`week` vacío), no se puede afirmar nada:
 *     se responde cerrado con `NO_SCHEDULE`, que es lo honesto.
 *  4. En otro caso, el local está abierto dentro de `[opens_at, closes_at)`.
 */
export function evaluateOpenState(input: {
  readonly week: readonly BusinessHourView[];
  readonly holidays: readonly HolidaySlot[];
  readonly at: Date;
  readonly timeZone?: string;
}): BusinessStatusView {
  // Una zona que el runtime no conoce no debe tumbar el estado del local: se cae
  // a la del despliegue, que es lo que haría el resto del sistema.
  const requested = input.timeZone;
  const timeZone = requested !== undefined && isValidTimeZone(requested) ? requested : DEFAULT_TIMEZONE;
  const localDate = localDateKey(input.at, timeZone);
  const localTime = localTimeKey(input.at, timeZone);
  const dayOfWeek = dayOfWeekOf(localDate);
  const now = input.at.getTime();

  const holiday = closingHolidayOn(localDate, input.holidays);
  const todaySlot = input.week.find((slot) => slot.dayOfWeek === dayOfWeek);
  const todayWindow = holiday === null && todaySlot !== undefined
    ? windowOf(localDate, todaySlot, timeZone)
    : null;

  const isOpen = todayWindow !== null && now >= Date.parse(todayWindow.start) && now < Date.parse(todayWindow.end);

  let reason: BusinessClosedReason;
  if (isOpen) {
    reason = 'OPEN';
  } else if (holiday !== null) {
    reason = 'CLOSED_HOLIDAY';
  } else if (input.week.length === 0) {
    reason = 'NO_SCHEDULE';
  } else {
    reason = 'CLOSED_SCHEDULE';
  }

  return {
    isOpen,
    reason,
    localDate,
    localTime,
    dayOfWeek,
    timezone: timeZone,
    opensAt: todaySlot === undefined || todaySlot.isClosed ? null : todaySlot.opensAt,
    closesAt: todaySlot === undefined || todaySlot.isClosed ? null : todaySlot.closesAt,
    nextChangeAt: nextChangeAt({
      week: input.week,
      holidays: input.holidays,
      fromDate: localDate,
      now,
      timeZone,
      isOpen,
      todayWindow,
    }),
    holiday: holiday === null ? null : { name: holiday.name },
  };
}

/**
 * Instante del próximo cambio de estado: el cierre de hoy si está abierto, o la
 * apertura del primer día futuro con horario que no sea festivo cerrado.
 *
 * Se recorre como máximo 7 días (una semana completa): más allá del ciclo
 * semanal no puede haber surprises, así que `null` es una respuesta correcta y
 * honesta en lugar de un `"null"` disfrazado.
 */
function nextChangeAt(input: {
  readonly week: readonly BusinessHourView[];
  readonly holidays: readonly HolidaySlot[];
  readonly fromDate: string;
  readonly now: number;
  readonly timeZone: string;
  readonly isOpen: boolean;
  readonly todayWindow: { readonly start: string; readonly end: string } | null;
}): string | null {
  for (let offset = 0; offset <= 7; offset += 1) {
    const dateKey = shiftDateKey(input.fromDate, offset);
    if (closingHolidayOn(dateKey, input.holidays) !== null) {
      continue;
    }
    const slot = input.week.find((candidate) => candidate.dayOfWeek === dayOfWeekOf(dateKey));
    if (slot === undefined) {
      continue;
    }
    const window = windowOf(dateKey, slot, input.timeZone);
    if (window === null) {
      continue;
    }
    if (offset === 0) {
      if (input.isOpen && input.todayWindow !== null) {
        return input.todayWindow.end;
      }
      if (Date.parse(window.start) > input.now) {
        return window.start;
      }
      continue;
    }
    return window.start;
  }
  return null;
}
