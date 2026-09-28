/**
 * Pruebas de la aritmética de dinero.
 *
 * DESIGN.md 7.2 (BR-MONEY-002 y BR-MONEY-011) exige explícitamente que esta
 * fichero cubra `0.4 -> 0`, `0.5 -> 1`, `0.6 -> 1` y `-0.5 -> -0` (normalizado
 * a `0`). Cada prueba lleva el identificador de la regla que verifica.
 */
import { describe, expect, it } from 'vitest';

import {
  addMinor,
  allocateMinor,
  applyPercent,
  applyTaxBp,
  formatMinor,
  multiplyMinor,
  negateMinor,
  roundHalfUp,
  subtractMinor,
} from './money.js';

describe('roundHalfUp (BR-MONEY-002, BR-MONEY-011)', () => {
  it('BR-MONEY-011: 0.4 sube-trunca a 0', () => {
    expect(roundHalfUp(0.4)).toBe(0);
  });

  it('BR-MONEY-011: 0.5 sube a 1 (half-up, sin redondeo bancario)', () => {
    expect(roundHalfUp(0.5)).toBe(1);
  });

  it('BR-MONEY-011: 0.6 sube a 1', () => {
    expect(roundHalfUp(0.6)).toBe(1);
  });

  it('BR-MONEY-011: -0.5 se normaliza a 0, nunca a -0', () => {
    expect(roundHalfUp(-0.5)).toBe(0);
    expect(Object.is(roundHalfUp(-0.5), -0)).toBe(false);
  });

  it('es simétrico en la mitad positiva y negativa', () => {
    expect(roundHalfUp(1.5)).toBe(2);
    expect(roundHalfUp(2.5)).toBe(3);
  });

  it('rechaza valores no finitos', () => {
    expect(() => roundHalfUp(Number.NaN)).toThrow(RangeError);
    expect(() => roundHalfUp(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('addMinor / subtractMinor / negateMinor', () => {
  it('BR-MONEY-001: la suma es exacta, sin coma flotante', () => {
    expect(addMinor(100, 200, 300)).toBe(600);
    expect(addMinor(1, 1)).toBe(2);
    expect(addMinor(5_000_000, 4_999_999)).toBe(9_999_999);
  });

  it('la resta puede dar negativo', () => {
    expect(subtractMinor(1000, 250)).toBe(750);
    expect(subtractMinor(250, 1000)).toBe(-750);
  });

  it('la negación conserva el signo', () => {
    expect(negateMinor(750)).toBe(-750);
  });

  it('BR-MONEY-001: rechaza importes que no son enteros', () => {
    expect(() => addMinor(1.5, 1)).toThrow(RangeError);
    expect(() => subtractMinor(Number.NaN, 1)).toThrow(RangeError);
  });
});

describe('multiplyMinor', () => {
  it('BR-PRICE-002: precio de línea con cantidad entera', () => {
    expect(multiplyMinor(500000, 3)).toBe(1_500_000);
  });

  it('BR-PRICE-002: cantidad fraccional (pesajes)', () => {
    expect(multiplyMinor(500000, 1.5)).toBe(750000);
  });

  it('BR-MONEY-002: 101 * 1.5 = 151.5 -> 152 (half-up)', () => {
    expect(multiplyMinor(101, 1.5)).toBe(152);
  });

  it('BR-RENTAL-001: minutos / 60 * precio por hora', () => {
    expect(multiplyMinor(10_000, 35 / 60)).toBe(5833);
    expect(multiplyMinor(50_000, 0.5)).toBe(25_000);
  });

  it('rechaza un factor no finito', () => {
    expect(() => multiplyMinor(100, Number.NaN)).toThrow(RangeError);
  });
});

describe('applyTaxBp / applyPercent', () => {
  it('BR-TAX-001: 1900 bp = 19.00 %', () => {
    expect(applyTaxBp(100_000, 1900)).toBe(19_000);
  });

  it('BR-TAX-001: redondea a centavo el resultado', () => {
    expect(applyTaxBp(333, 1900)).toBe(63);
    expect(applyTaxBp(1000, 1250)).toBe(125);
  });

  it('BR-TAX-005: el cargo por servicio usa la misma fórmula', () => {
    expect(applyTaxBp(100_000, 800)).toBe(8000);
  });

  it('brind 10000 (100 %) no se pasa de la base', () => {
    expect(applyTaxBp(100_000, 10_000)).toBe(100_000);
  });

  it('rechaza basis points no enteros', () => {
    expect(() => applyTaxBp(100, 12.5)).toThrow(RangeError);
  });

  it('applyPercent es el caso base=100', () => {
    expect(applyPercent(10_000, 15)).toBe(1500);
  });
});

describe('allocateMinor (BR-MONEY-005)', () => {
  it('reparte sin perder centavos: 100 entre 3', () => {
    expect(allocateMinor(100, [1, 1, 1]).shares).toEqual([34, 33, 33]);
  });

  it('número de partes sin pesos: 10 entre 3', () => {
    expect(allocateMinor(10, 3).shares).toEqual([4, 3, 3]);
  });

  it('respeta los pesos', () => {
    expect(allocateMinor(1000, [7, 3]).shares).toEqual([700, 300]);
  });

  it('el total分配 es SIEMPRE exacto, para cualquier entrada', () => {
    for (const total of [0, 1, 7, 99, 100, 1000, 123_457]) {
      for (const parts of [1, 2, 3, 7, 11]) {
        const result = allocateMinor(total, parts);
        expect(result.shares.reduce((a, b) => a + b, 0)).toBe(total);
        expect(result.shares.every((share) => Number.isInteger(share))).toBe(true);
        expect(result.remainder).toBe(0);
      }
    }
  });

  it('asigna el resto a la parte de mayor residuo (determinista)', () => {
    const result = allocateMinor(10, [1, 1, 1]);
    expect(result.shares[0]).toBe(4);
    // Repetición con la misma entrada produce exactamente el mismo reparto.
    expect(allocateMinor(10, [1, 1, 1]).shares).toEqual(result.shares);
  });

  it('rechaza pesos negativos o número de partes inválido', () => {
    expect(() => allocateMinor(100, [1, -1])).toThrow(RangeError);
    expect(() => allocateMinor(100, 0)).toThrow(RangeError);
  });
});

describe('formatMinor (API.md 6.1)', () => {
  it('BR-MONEY-009: COP sin decimales y sin espacio tras el símbolo', () => {
    expect(formatMinor(500_000, 'COP', 'es-CO')).toBe('$500.000');
  });

  it('una moneda de dos decimales los muestra', () => {
    expect(formatMinor(199_900, 'USD', 'es-CO')).toBe('US$1.999,00');
  });

  it('nunca devuelve un float', () => {
    expect(typeof formatMinor(1, 'USD', 'es-CO')).toBe('string');
  });

  it('degrada con elegancia ante una moneda desconocida', () => {
    expect(formatMinor(100, 'XXXXX', 'es-CO')).toContain('XXXXX');
  });
});
