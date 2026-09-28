/**
 * Pruebas de fechas y, sobre todo, del solapamiento de intervalos.
 *
 * `overlaps` es la función crítica de las reservas (BR-RES-001): los extremos
 * que se tocan NO deben solaparse, porque un cliente puede soltar la silla a
 * las 12:00 y otro tomarla a las 12:00.
 */
import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMinutes,
  ceilDiffMinutes,
  diffMinutes,
  endOfDayUtc,
  localDateKey,
  localTimeKey,
  nowIso,
  overlaps,
  parseIso,
  startOfDayUtc,
  toIso,
} from './datetime.js';

/** Atajo: intervalo en ISO UTC completo. */
function at(hour: number, minute = 0): string {
  return `2026-03-14T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

describe('nowIso / toIso (API.md 1)', () => {
  it('devuelve ISO-8601 UTC con milisegundos y Z', () => {
    expect(nowIso()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('toIso normaliza a UTC', () => {
    expect(toIso(new Date('2026-03-14T10:04:05-05:00'))).toBe('2026-03-14T15:04:05.000Z');
  });
});

describe('parseIso', () => {
  it('acepta instante con Z', () => {
    expect(parseIso('2026-03-14T15:04:05.000Z').toISOString()).toBe('2026-03-14T15:04:05.000Z');
  });

  it('acepta offset y normaliza a UTC (API.md 1)', () => {
    expect(parseIso('2026-03-14T10:04:05-05:00').toISOString()).toBe('2026-03-14T15:04:05.000Z');
  });

  it('acepta instante sin milisegundos', () => {
    expect(parseIso('2026-03-14T15:04:05Z').toISOString()).toBe('2026-03-14T15:04:05.000Z');
  });

  it('lanza ValidationError con la ruta del campo', () => {
    expect(() => parseIso('14/03/2026', 'startAt')).toThrowError(/no es válida/);
    try {
      parseIso('ayer', 'endAt');
      expect.unreachable('debería lanzar');
    } catch (error) {
      const details = (error as { details: { path: string }[] }).details;
      expect(details[0]?.path).toBe('endAt');
      expect((error as { httpStatus: number }).httpStatus).toBe(400);
    }
  });

  it('rechaza una fecha de sólo día como instante', () => {
    expect(() => parseIso('2026-03-14')).toThrowError(/no es válida/);
  });
});

describe('addMinutes / addDays / diffMinutes', () => {
  it('addMinutes suma exactos', () => {
    expect(addMinutes('2026-03-14T10:00:00.000Z', 90)).toBe('2026-03-14T11:30:00.000Z');
    expect(addMinutes('2026-03-14T23:30:00.000Z', 60)).toBe('2026-03-15T00:30:00.000Z');
  });

  it('addDays cruza el mes', () => {
    expect(addDays('2026-03-14T10:00:00.000Z', 30)).toBe('2026-04-13T10:00:00.000Z');
  });

  it('diffMinutes es exacto y con signo', () => {
    expect(diffMinutes('2026-03-14T10:00:00.000Z', '2026-03-14T11:30:00.000Z')).toBe(90);
    expect(diffMinutes('2026-03-14T11:30:00.000Z', '2026-03-14T10:00:00.000Z')).toBe(-90);
  });

  it('BR-RENTAL-002: ceilDiffMinutes redondea hacia arriba (nunca se paga de menos)', () => {
    expect(ceilDiffMinutes('2026-03-14T10:00:00.000Z', '2026-03-14T10:00:01.000Z')).toBe(1);
    expect(ceilDiffMinutes('2026-03-14T10:00:00.000Z', '2026-03-14T10:00:30.000Z')).toBe(1);
    expect(ceilDiffMinutes('2026-03-14T10:00:00.000Z', '2026-03-14T10:00:00.000Z')).toBe(0);
  });
});

describe('startOfDayUtc / endOfDayUtc', () => {
  it('acota el día UTC completo', () => {
    expect(startOfDayUtc('2026-03-14T15:04:05.123Z')).toBe('2026-03-14T00:00:00.000Z');
    expect(endOfDayUtc('2026-03-14T15:04:05.123Z')).toBe('2026-03-14T23:59:59.999Z');
  });
});

describe('localDateKey / localTimeKey (zona IANA del negocio)', () => {
  it('resuelve el día en la zona del negocio, no en UTC', () => {
    // 02:30 UTC del 15/03 es el 14/03 en Bogotá (UTC-5).
    expect(localDateKey('2026-03-15T02:30:00.000Z', 'America/Bogota')).toBe('2026-03-14');
    expect(localTimeKey('2026-03-15T02:30:00.000Z', 'America/Bogota')).toBe('21:30');
  });
});

describe('overlaps (BR-RES-001) — CRÍTICO PARA RESERVAS', () => {
  it('detecta solapamiento parcial', () => {
    expect(overlaps(at(10), at(12), at(11), at(13))).toBe(true);
    expect(overlaps(at(11), at(13), at(10), at(12))).toBe(true);
  });

  it('detecta contención mutua', () => {
    expect(overlaps(at(10), at(16), at(11), at(12))).toBe(true);
    expect(overlaps(at(11), at(12), at(10), at(16))).toBe(true);
  });

  it('los extremos que se tocan NO se solapan', () => {
    expect(overlaps(at(10), at(12), at(12), at(14))).toBe(false);
    expect(overlaps(at(12), at(14), at(10), at(12))).toBe(false);
  });

  it('intervalos disjuntos', () => {
    expect(overlaps(at(8), at(10), at(14), at(16))).toBe(false);
  });

  it('el mismo intervalo se solapa consigo mismo', () => {
    expect(overlaps(at(10), at(12), at(10), at(12))).toBe(true);
  });

  it('normaliza offsets a UTC antes de comparar', () => {
    // 10:00-12:00 en Bogotá (-05:00) = 15:00-17:00 UTC.
    expect(
      overlaps('2026-03-14T10:00:00-05:00', '2026-03-14T12:00:00-05:00', at(16), at(17)),
    ).toBe(true);
  });

  it('un intervalo invertido (end <= start) está vacío y no solapa', () => {
    expect(overlaps(at(12), at(10), at(11), at(13))).toBe(false);
  });

  it('valida los extremos con ValidationError', () => {
    expect(() => overlaps('basura', at(12), at(11), at(13))).toThrowError(/no es válida/);
  });
});
