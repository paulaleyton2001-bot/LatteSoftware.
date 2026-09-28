/**
 * Utilidades de fecha y hora.
 *
 * CONVENCIÓN GLOBAL (API.md 1): todas las fechas viajan y se almacenan como
 * ISO-8601 **UTC** con milisegundos y `Z` -> `2026-03-14T15:04:05.000Z`.
 * Se acepta entrada con offset (`2026-03-14T10:04:05-05:00`) y se normaliza
 * a UTC. Las fechas de sólo día son `YYYY-MM-DD` en la zona del negocio y las
 * horas locales `HH:MM`; la conversión desde la zona IANA del negocio es
 * responsabilidad del service de negocio, no de estas funciones.
 */
import { ValidationError } from '../errors/index.js';

/** Expresión que valida un instante ISO-8601 (con o sin milisegundos, con Z u offset). */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/i;

/** Milisegundos en un minuto. */
const MS_PER_MINUTE = 60_000;

/** Convierte un `Date` (o número) a ISO-8601 UTC con milisegundos y `Z`. */
export function toIso(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('No se pudo convertir el valor a una fecha ISO válida', {
      details: [{ path: 'date', message: 'Fecha inválida', code: 'INVALID_FORMAT' }],
    });
  }
  return date.toISOString();
}

/** Instante actual en ISO-8601 UTC. Reloj del sistema, siempre UTC. */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Parsea un instante ISO-8601 y lo normaliza a UTC.
 * Lanza `ValidationError` (400) si la cadena no es un instante válido.
 */
export function parseIso(value: string, field = 'date'): Date {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError('La fecha no es válida', {
      details: [{ path: field, message: 'Se requiere una fecha ISO-8601', code: 'INVALID_FORMAT' }],
    });
  }
  const trimmed = value.trim();
  if (!ISO_INSTANT.test(trimmed)) {
    throw new ValidationError('La fecha no es válida', {
      details: [
        {
          path: field,
          message: 'Debe ser un instante ISO-8601 UTC, por ejemplo 2026-03-14T15:04:05.000Z',
          code: 'INVALID_FORMAT',
        },
      ],
    });
  }
  // `2026-03-14T15:04:05.000Z` es parseable por el motor estándar; el
  // constructor normaliza offsets a UTC automáticamente.
  const parsed = new Date(trimmed.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('La fecha no es válida', {
      details: [{ path: field, message: 'Fecha ISO-8601 no interpretable', code: 'INVALID_FORMAT' }],
    });
  }
  return parsed;
}

/** Suma minutos a un instante ISO y devuelve el resultado normalizado en UTC. */
export function addMinutes(value: string | Date, minutes: number): string {
  if (!Number.isFinite(minutes)) {
    throw new ValidationError('La cantidad de minutos debe ser un número finito');
  }
  const base = value instanceof Date ? value : parseIso(value);
  return new Date(base.getTime() + Math.round(minutes * MS_PER_MINUTE)).toISOString();
}

/** Suma días a un instante ISO y devuelve el resultado normalizado en UTC. */
export function addDays(value: string | Date, days: number): string {
  if (!Number.isFinite(days)) {
    throw new ValidationError('La cantidad de días debe ser un número finito');
  }
  const base = value instanceof Date ? value : parseIso(value);
  return new Date(base.getTime() + Math.round(days * 24 * 60 * MS_PER_MINUTE)).toISOString();
}

/**
 * Minutos exactos entre dos instantes. Positivo si `to` es posterior a `from`.
 * El resultado puede ser fraccionario; use {@link ceilDiffMinutes} para
 * facturación pro-rata (BR-RENTAL-002).
 */
export function diffMinutes(from: string | Date, to: string | Date): number {
  const start = from instanceof Date ? from.getTime() : parseIso(from).getTime();
  const end = to instanceof Date ? to.getTime() : parseIso(to).getTime();
  return (end - start) / MS_PER_MINUTE;
}

/**
 * Minutos redondeados **hacia arriba** entre dos instantes.
 * Es la regla de facturación de alquileres (BR-RENTAL-002): el cliente nunca
 * paga de menos por segundos.
 */
export function ceilDiffMinutes(from: string | Date, to: string | Date): number {
  return Math.ceil(diffMinutes(from, to));
}

/** Inicio del día UTC (00:00:00.000Z) que contiene al instante dado. */
export function startOfDayUtc(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : parseIso(value);
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0);
  return new Date(start).toISOString();
}

/** Fin del día UTC (23:59:59.999Z) que contiene al instante dado. */
export function endOfDayUtc(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : parseIso(value);
  const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999);
  return new Date(end).toISOString();
}

/** Inicio del mes UTC que contiene al instante dado (día 1, 00:00:00.000Z). */
export function startOfMonthUtc(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : parseIso(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString();
}

/** Inicio del mes UTC siguiente (límite exclusivo de `lastMonth`). */
export function startOfNextMonthUtc(value: string | Date = new Date()): string {
  const date = value instanceof Date ? value : parseIso(value);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 0, 0, 0, 0)).toISOString();
}

/**
 * `YYYY-MM-DD` del instante, en la zona horaria IANA indicada.
 * Es la única función de esta capa que necesita zona: resuelve los filtros
 * "hoy" / "últimos 30 días" de API.md 5.2 usando `businesses.timezone`.
 */
export function localDateKey(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : parseIso(value);
  // `en-CA` produce exactamente `YYYY-MM-DD`.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** `HH:MM` (24 h) del instante en la zona horaria IANA indicada. */
export function localTimeKey(value: string | Date, timeZone: string): string {
  const date = value instanceof Date ? value : parseIso(value);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/**
 * CRÍTICA PARA RESERVAS (BR-RES-001).
 *
 * Dos intervalos se solapan cuando su intersección **no es vacía**. Los
 * intervalos son semiabiertos `[start, end)`: los extremos que se tocan
 * **NO** se solapan. Un cliente puede soltar la silla a las 12:00 y otro
 * tomarla a las 12:00.
 *
 * Equivalente SQL usado dentro de la transacción:
 *   `NOT (end_at <= :startAt OR start_at >= :endAt)`
 *
 * @returns `true` si hay solapamiento; `false` si son disjuntos o contiguos.
 * @throws ValidationError si algún extremo no es un instante ISO válido.
 */
export function overlaps(
  aStart: string | Date,
  aEnd: string | Date,
  bStart: string | Date,
  bEnd: string | Date,
): boolean {
  const a1 = aStart instanceof Date ? aStart.getTime() : parseIso(aStart, 'startAt').getTime();
  const a2 = aEnd instanceof Date ? aEnd.getTime() : parseIso(aEnd, 'endAt').getTime();
  const b1 = bStart instanceof Date ? bStart.getTime() : parseIso(bStart, 'other.startAt').getTime();
  const b2 = bEnd instanceof Date ? bEnd.getTime() : parseIso(bEnd, 'other.endAt').getTime();

  // Intervalos invertidos: se consideran vacíos (nunca solapan con nada).
  if (a2 <= a1 || b2 <= b1) return false;

  // `end <= start2 || start >= end2` => NO solapan.
  return !(a2 <= b1 || a1 >= b2);
}
