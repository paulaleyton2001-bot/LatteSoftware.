/**
 * Pruebas de las máquinas de estado.
 *
 * El objetivo es que sea imposible, en tiempo de compilación y de ejecución,
 * una transición prohibida como `COMPLETED -> PREPARING` (BR-ORDER-017).
 */
import { describe, expect, it } from 'vitest';

import {
  ORDER_TRANSITIONS,
  RESERVATION_TRANSITIONS,
  PaymentStatus,
  assertOrderMutable,
  canChairTransition,
  canOrderTransition,
  canPaymentTransition,
  canRentalTransition,
  canReservationTransition,
  isManuallySettable,
  isTerminalOrderStatus,
  isTerminalPaymentStatus,
  nextOrderStatuses,
  nextReservationStatuses,
  OrderStatus,
  ChairStatus,
  RentalStatus,
  ReservationStatus,
} from './index.js';

describe('orders: tabla de transiciones (DESIGN.md 6.1)', () => {
  it('el camino feliz completo está permitido', () => {
    const camino: [OrderStatus, OrderStatus][] = [
      [OrderStatus.DRAFT, OrderStatus.PENDING],
      [OrderStatus.PENDING, OrderStatus.CONFIRMED],
      [OrderStatus.CONFIRMED, OrderStatus.PREPARING],
      [OrderStatus.PREPARING, OrderStatus.READY],
      [OrderStatus.READY, OrderStatus.COMPLETED],
      [OrderStatus.COMPLETED, OrderStatus.REFUNDED],
    ];
    for (const [from, to] of camino) {
      expect(canOrderTransition(from, to)).toBe(true);
    }
  });

  it('BR-ORDER-017: COMPLETED -> PREPARING es IMPOSIBLE', () => {
    expect(canOrderTransition(OrderStatus.COMPLETED, OrderStatus.PREPARING)).toBe(false);
  });

  it('COMPLETED -> COMPLETED es idempotencia prohibida', () => {
    expect(canOrderTransition(OrderStatus.COMPLETED, OrderStatus.COMPLETED)).toBe(false);
  });

  it('CANCELLED y REFUNDED no tienen salida alguna', () => {
    for (const from of [OrderStatus.CANCELLED, OrderStatus.REFUNDED]) {
      for (const to of Object.values(OrderStatus)) {
        expect(canOrderTransition(from, to)).toBe(false);
      }
    }
  });

  it('COMPLETED sólo admite REFUNDED: no se des-completa un pedido', () => {
    const salidas = nextOrderStatuses(OrderStatus.COMPLETED);
    expect(salidas).toEqual([OrderStatus.REFUNDED]);
  });

  it('DRAFT y PENDING no pueden saltar a estados avanzados', () => {
    expect(nextOrderStatuses(OrderStatus.DRAFT)).toEqual([
      OrderStatus.PENDING,
      OrderStatus.CANCELLED,
    ]);
    expect(nextOrderStatuses(OrderStatus.PENDING)).toEqual([
      OrderStatus.CONFIRMED,
      OrderStatus.CANCELLED,
    ]);
  });

  it('CONFIRMED -> READY existe como atajo para productos sin preparación', () => {
    expect(canOrderTransition(OrderStatus.CONFIRMED, OrderStatus.READY)).toBe(true);
  });

  it('CANCELLED y REFUNDED son terminales', () => {
    expect(isTerminalOrderStatus(OrderStatus.CANCELLED)).toBe(true);
    expect(isTerminalOrderStatus(OrderStatus.REFUNDED)).toBe(true);
    expect(isTerminalOrderStatus(OrderStatus.COMPLETED)).toBe(false);
  });

  it('cada transición declara roles y endpoint (API.md 7.19)', () => {
    for (const transition of ORDER_TRANSITIONS) {
      expect(transition.roles.length).toBeGreaterThan(0);
      expect(transition.label.length).toBeGreaterThan(0);
      expect(transition.endpoint).toMatch(/^(POST|PATCH|scheduler:)/);
    }
  });

  it('assertOrderMutable bloquea los estados cerrados (BR-ORDER-017)', () => {
    expect(() => assertOrderMutable(OrderStatus.DRAFT)).not.toThrow();
    expect(() => assertOrderMutable(OrderStatus.PENDING)).not.toThrow();
    expect(() => assertOrderMutable(OrderStatus.COMPLETED)).toThrowError(/cerrado/);
    expect(() => assertOrderMutable(OrderStatus.CANCELLED)).toThrowError(/cerrado/);
    expect(() => assertOrderMutable(OrderStatus.REFUNDED)).toThrowError(/cerrado/);
  });
});

describe('chair_reservations: tabla de transiciones (DESIGN.md 6.2)', () => {
  it('PENDING -> ACTIVE es imposible: la confirmación valida el solapamiento', () => {
    expect(canReservationTransition(ReservationStatus.PENDING, ReservationStatus.ACTIVE)).toBe(false);
  });

  it('CONFIRMED -> ACTIVE -> COMPLETED es el camino de check-in/check-out', () => {
    expect(canReservationTransition(ReservationStatus.CONFIRMED, ReservationStatus.ACTIVE)).toBe(true);
    expect(canReservationTransition(ReservationStatus.ACTIVE, ReservationStatus.COMPLETED)).toBe(true);
    expect(canReservationTransition(ReservationStatus.CONFIRMED, ReservationStatus.COMPLETED)).toBe(false);
  });

  it('CANCELLED, EXPIRED y COMPLETED son terminales', () => {
    expect(nextReservationStatuses(ReservationStatus.CANCELLED)).toEqual([]);
    expect(nextReservationStatuses(ReservationStatus.EXPIRED)).toEqual([]);
    expect(nextReservationStatuses(ReservationStatus.COMPLETED)).toEqual([]);
  });

  it('BR-RES-004: expirar es exclusivo del scheduler', () => {
    const expiraciones = RESERVATION_TRANSITIONS.filter(
      (transition) => transition.to === ReservationStatus.EXPIRED,
    );
    expect(expiraciones).toHaveLength(2);
    for (const transition of expiraciones) {
      expect(transition.roles).toEqual(['SYSTEM']);
    }
  });
});

describe('chair_rentals (DESIGN.md 6.3)', () => {
  it('EXTENDED -> EXTENDED es válida (extensiones sucesivas)', () => {
    expect(canRentalTransition(RentalStatus.EXTENDED, RentalStatus.EXTENDED)).toBe(true);
  });

  it('COMPLETED y CANCELLED son terminales', () => {
    expect(canRentalTransition(RentalStatus.COMPLETED, RentalStatus.ACTIVE)).toBe(false);
    expect(canRentalTransition(RentalStatus.CANCELLED, RentalStatus.EXTENDED)).toBe(false);
  });
});

describe('chairs (DESIGN.md 6.4 y BR-CHAIR-003)', () => {
  it('OCCUPIED -> BLOCKED es imposible: hay gente en la silla', () => {
    expect(canChairTransition(ChairStatus.OCCUPIED, ChairStatus.BLOCKED)).toBe(false);
  });

  it('CLEANING -> OCCUPIED es imposible: una silla sin limpiar no recibe clientes', () => {
    expect(canChairTransition(ChairStatus.CLEANING, ChairStatus.OCCUPIED)).toBe(false);
  });

  it('PATCH /chairs/:id/status no puede fijar OCCUPIED ni RESERVED', () => {
    expect(isManuallySettable(ChairStatus.AVAILABLE)).toBe(true);
    expect(isManuallySettable(ChairStatus.BLOCKED)).toBe(true);
    expect(isManuallySettable(ChairStatus.MAINTENANCE)).toBe(true);
    expect(isManuallySettable(ChairStatus.CLEANING)).toBe(true);
    expect(isManuallySettable(ChairStatus.OCCUPIED)).toBe(false);
    expect(isManuallySettable(ChairStatus.RESERVED)).toBe(false);
  });
});

describe('payments (DESIGN.md 6.5)', () => {
  it('un pago aprobado no se desaprueba: se reembolsa', () => {
    expect(canPaymentTransition(PaymentStatus.APPROVED, PaymentStatus.FAILED)).toBe(false);
    expect(canPaymentTransition(PaymentStatus.APPROVED, PaymentStatus.CANCELLED)).toBe(false);
    expect(canPaymentTransition(PaymentStatus.APPROVED, PaymentStatus.PARTIALLY_REFUNDED)).toBe(true);
    expect(canPaymentTransition(PaymentStatus.APPROVED, PaymentStatus.REFUNDED)).toBe(true);
  });

  it('un intento fallido nunca pasa a aprobado', () => {
    expect(canPaymentTransition(PaymentStatus.FAILED, PaymentStatus.APPROVED)).toBe(false);
    expect(isTerminalPaymentStatus(PaymentStatus.FAILED)).toBe(true);
  });

  it('REFUNDED es terminal absoluto', () => {
    for (const to of Object.values(PaymentStatus)) {
      if (to === PaymentStatus.REFUNDED) continue;
      expect(canPaymentTransition(PaymentStatus.REFUNDED, to)).toBe(false);
    }
  });
});
