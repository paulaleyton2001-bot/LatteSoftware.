/**
 * ============================================================================
 * REGRESIÓN: cobrar un pedido `CHAIR_RENTAL` tiene que cerrar el alquiler
 * ============================================================================
 *
 * ============================================================================
 * EL FALLO QUE ESTE FICHERO ATA
 * ============================================================================
 * `orders.status = 'COMPLETED'` tiene DOS escritores, y sólo uno hacía los efectos
 * secundarios que la columna "Efecto secundario" de DESIGN.md 6.1 exige para
 * `... -> COMPLETED`:
 *
 *   - `OrdersService.transition()` (el `POST /orders/:id/status`) sí cerraba el
 *     alquiler, hacía el check-out de la reserva y mandaba la silla a `CLEANING`.
 *   - `PaymentsService.maybeCompleteOrder()` (el `POST /payments`, que es el
 *     camino real del mostrador) escribía el estado con un `UPDATE` directo y se
 *     saltaba todo lo demás.
 *
 * El síntoma era: cobro correcto, pedido `COMPLETED` con `balance_minor = 0`, y
 * alquiler `ACTIVE` + silla `OCCUPIED` PARA SIEMPRE. El cliente no podía volver
 * a sentarse y nadie podía cerrar la sesión.
 *
 * ============================================================================
 * LO QUE COMPRUEBA CADA BLOQUE
 * ============================================================================
 *  - `Cobro completo`: la regresión principal. Con el bug, el primer test falla.
 *  - `Cobro parcial`: el alquiler tiene que SEGUIR abierto mientras el pedido no
 *    está pagado, y cerrarse en cuanto se cobre el resto. Es la ruta clara que
 *    faltaba: con pago parcial, `POST /orders/:id/status -> COMPLETED` es un 422
 *    (`PENDING -> COMPLETED` está prohibido), así que el segundo cobro es la
 *    única forma de cerrar la sesión.
 *  - `Idempotencia`: cerrar a mano y cobrar después (y al revés) no rompe nada ni
 *    duplica el cierre.
 *  - `Transaccionalidad`: si el cierre del alquiler falla, el cobro tampoco se
 *    aplica. Nada a medias.
 *  - `Sin alquiler`: el camino que ya funcionaba (un `TAKEAWAY` normal) sigue
 *    intacto, porque el puerto nuevo también pasa por él.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { API_PREFIX } from '../src/config/index.js';
import { createApiV1Router } from '../src/modules/index.js';
import { categoriesRouter, productsRouter } from '../src/modules/catalog/catalog.routes.js';
import { chairsRouter, zonesRouter } from '../src/modules/spaces/spaces.routes.js';
import { reservationsRouter } from '../src/modules/reservations/reservations.routes.js';
import { rentalsRouter } from '../src/modules/rentals/rentals.routes.js';
import { ordersRouter } from '../src/modules/orders/orders.routes.js';
import { paymentsRouter } from '../src/modules/payments/payments.routes.js';
import { seedSpacesDemo } from '../src/database/seeds/spaces-demo.seed.js';
import {
  corsMiddleware,
  errorHandler,
  jsonBody,
  notFound,
  requestContext,
  securityHeaders,
  setRateLimitingEnabled,
} from '../src/shared/middleware/index.js';

let ctx: TestContext;
let agent: TestAgent;
let adminToken: string;
let cashierToken: string;
let customerId: number;
let locationId: number;

let sequence = 0;

/** $50.000 la hora = 5.000.000 centavos. Una hora exacta da un subtotal redondo. */
const PRICE_PER_HOUR_MINOR = 5_000_000;
const PLANNED_MINUTES = 60;
/** 60 min a 5.000.000 = 5.000.000; con el 19 % del negocio, 5.950.000. */
const RENTAL_BASE_MINOR = 5_000_000;

function buildTestApp(): Express {
  const app = express();
  setRateLimitingEnabled(false);
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(requestContext);
  app.use(jsonBody);
  const api = createApiV1Router({ disableRateLimit: true });
  api.use('/categories', categoriesRouter);
  api.use('/products', productsRouter);
  api.use('/zones', zonesRouter);
  api.use('/chairs', chairsRouter);
  api.use('/reservations', reservationsRouter);
  api.use('/rentals', rentalsRouter);
  api.use('/orders', ordersRouter);
  api.use('/payments', paymentsRouter);
  app.use(API_PREFIX, api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

function get(path: string, token?: string): request.Test {
  return token === undefined ? agent.get(path) : agent.get(path).set('Authorization', `Bearer ${token}`);
}
function post(path: string, body: object, token?: string): request.Test {
  return (token === undefined ? agent.post(path) : agent.post(path).set('Authorization', `Bearer ${token}`)).send(body);
}
function postWithKey(path: string, body: object, key: string, token?: string): request.Test {
  const test = token === undefined ? agent.post(path) : agent.post(path).set('Authorization', `Bearer ${token}`);
  return test.set('Idempotency-Key', key).send(body);
}

function num(value: unknown): number {
  return Number(value);
}

function obj(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('El valor no es un objeto');
  }
  return value as Record<string, unknown>;
}

function nextSeq(): number {
  sequence += 1;
  return sequence;
}

/**
 * Clave de idempotencia válida: `payments.schemas.ts` exige un `uuid` v4 (o sus
 * 32 hex sin guiones), no una cadena arbitraria.
 */
function idempotencyKey(): string {
  sequence += 1;
  return `9f2c1a7b-4e3d-4c5a-8b12-${String(sequence).padStart(12, '0')}`;
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeRentalSettlementTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');
  const registered = await ctx
    .post('/api/v1/auth/register', {
      email: ctx.uniqueEmail('liquidacion'),
      password: VALID_TEST_PASSWORD,
      fullName: 'Cliente Liquidacion',
    })
    .expect(201);
  customerId = num(obj(registered.body.data.user).id);
  locationId = seedSpacesDemo().locationId;
});

afterAll(() => {
  ctx.close();
});

// --------------------------------------------------------------------------
// Utilidades de preparación
// --------------------------------------------------------------------------

/** Zona de la sede sembrada. */
async function firstZoneId(): Promise<number> {
  const zones = await get(`/api/v1/zones?locationId=${locationId}`, adminToken).expect(200);
  const rows = zones.body.data as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error('La semilla de espacios no dejó ninguna zona');
  }
  return num(rows[0]?.id);
}

/** Silla nueva y reservable, con el precio por hora del negocio. */
async function createChair(): Promise<number> {
  const n = nextSeq();
  const zoneId = await firstZoneId();
  const response = await post(
    '/api/v1/chairs',
    { zoneId, code: `LIQ-${String(n).padStart(4, '0')}`, pricePerHourMinor: PRICE_PER_HOUR_MINOR },
    adminToken,
  ).expect(201);
  return num(response.body.data.id);
}

/** Reserva `CONFIRMED` que empieza ya: el caso del alquiler walk-in del POS. */
async function createConfirmedReservation(chairId: number, minutes: number): Promise<number> {
  const created = await post(
    '/api/v1/reservations',
    {
      chairId,
      startAt: new Date(Date.now() + 30_000).toISOString(),
      endAt: new Date(Date.now() + minutes * 60_000 + 30_000).toISOString(),
      customerId,
      source: 'ADMIN',
    },
    adminToken,
  ).expect(201);
  const reservationId = num(obj(created.body.data).id);
  await post(`/api/v1/reservations/${reservationId}/confirm`, {}, adminToken).expect(200);
  return reservationId;
}

/** Sesión de alquiler lista para facturar: silla `OCCUPIED` y alquiler `ACTIVE`. */
interface RentalSession {
  readonly chairId: number;
  readonly reservationId: number;
  readonly rentalId: number;
  readonly rentalCode: string;
}

/**
 * Alquiler WALK-IN, que es el flujo del POS: reserva `CONFIRMED` -> `POST /rentals`
 * -> alquiler `ACTIVE` y silla `OCCUPIED`. La reserva NO pasa por check-in, así
 * que sigue `CONFIRMED` y sirve para comprobar que la liquidación no la toca.
 */
async function openWalkInRental(plannedMinutes = PLANNED_MINUTES): Promise<RentalSession> {
  const chairId = await createChair();
  const reservationId = await createConfirmedReservation(chairId, plannedMinutes);
  const created = await post(
    '/api/v1/rentals',
    { chairId, plannedMinutes, reservationId },
    cashierToken,
  ).expect(201);
  const rental = obj(created.body.data.rental);
  return {
    chairId,
    reservationId,
    rentalId: num(rental.id),
    rentalCode: String(rental.code),
  };
}

/** Pedido `CHAIR_RENTAL` que factura la sesión: `POST /orders` con `items: []`. */
async function createRentalOrder(session: RentalSession): Promise<{
  readonly id: number;
  readonly totalMinor: number;
  readonly rentalBaseMinor: number;
}> {
  const created = await post(
    '/api/v1/orders',
    {
      type: 'CHAIR_RENTAL',
      chairId: session.chairId,
      reservationId: session.reservationId,
      rentalId: session.rentalId,
      customerId,
      items: [],
    },
    cashierToken,
  ).expect(201);
  const order = obj(created.body.data);
  return {
    id: num(order.id),
    totalMinor: num(order.totalMinor),
    rentalBaseMinor: num(order.subtotalMinor),
  };
}

/** Estado del alquiler leído de `chair_rentals`, sin pasar por la API. */
interface RentalRowView {
  readonly status: string;
  readonly billed_minutes: number;
  readonly total_minor: number;
  readonly extra_minutes_minor: number;
}

function rentalRow(rentalId: number): RentalRowView {
  const row = ctx.db
    .prepare(
      `SELECT status, billed_minutes, total_minor, extra_minutes_minor
         FROM chair_rentals WHERE id = ?`,
    )
    .get(rentalId) as RentalRowView | undefined;
  if (row === undefined) {
    throw new Error(`El alquiler ${rentalId} no existe`);
  }
  return row;
}

function chairStatus(chairId: number): string {
  const row = ctx.db.prepare('SELECT status FROM chairs WHERE id = ?').get(chairId) as
    | { status: string }
    | undefined;
  return row?.status ?? '';
}

function reservationStatus(reservationId: number): string {
  const row = ctx.db.prepare('SELECT status FROM chair_reservations WHERE id = ?').get(reservationId) as
    | { status: string }
    | undefined;
  return row?.status ?? '';
}

function orderStatus(orderId: number): string {
  const row = ctx.db.prepare('SELECT status, paid_minor, balance_minor FROM orders WHERE id = ?').get(orderId) as
    | { status: string; paid_minor: number; balance_minor: number }
    | undefined;
  return row?.status ?? '';
}

function countPayments(orderId: number): number {
  const row = ctx.db.prepare('SELECT COUNT(*) AS total FROM payments WHERE order_id = ?').get(orderId) as {
    total: number;
  };
  return row.total;
}

// ==========================================================================
// La regresión principal
// ==========================================================================

describe('Cobrar un pedido CHAIR_RENTAL cierra el alquiler (BR-PAY-008 -> BR-ORDER-015)', () => {
  it('al cobrar el 100 % el alquiler queda COMPLETED y la silla se libera', async () => {
    const session = await openWalkInRental();
    expect(rentalRow(session.rentalId).status).toBe('ACTIVE');
    expect(chairStatus(session.chairId)).toBe('OCCUPIED');

    const order = await createRentalOrder(session);
    // El subtotal del pedido ES el total del alquiler (BR-RENTAL-006).
    expect(order.rentalBaseMinor).toBe(RENTAL_BASE_MINOR);
    // Y el pedido lo grava al 19 % del negocio (BR-TAX-007).
    expect(order.totalMinor).toBe(Math.round(RENTAL_BASE_MINOR * 1.19));

    const paid = await postWithKey(
      '/api/v1/payments',
      {
        orderId: order.id,
        method: 'CASH',
        amountMinor: order.totalMinor,
        receivedMinor: order.totalMinor,
      },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    expect(paid.body.meta.orderCompleted).toBe(true);

    // --- El pedido está pagado y entregado ---------------------------------
    expect(orderStatus(order.id)).toBe('COMPLETED');

    // --- Y AQUÍ ESTÁ EL ARREGLO --------------------------------------------
    const rental = rentalRow(session.rentalId);
    expect(rental.status).toBe('COMPLETED');
    // BR-RENTAL-001/002: `billed_minutes = max(30, ceil(real))`. Con el bug, este
    // campo se quedaba en 0, que el propio DESIGN.md 6.3 prohíbe.
    expect(rental.billed_minutes).toBeGreaterThanOrEqual(30);
    // Sin sobretiempo el total no cambia: el plan era de 60 min.
    expect(rental.extra_minutes_minor).toBe(0);
    expect(rental.total_minor).toBe(RENTAL_BASE_MINOR);

    // BR-RENTAL-008: `OCCUPIED -> CLEANING`. La silla ya no está secuestrada.
    expect(chairStatus(session.chairId)).toBe('CLEANING');

    // Y la API dice lo mismo que la base de datos.
    const detail = await get(`/api/v1/rentals/${session.rentalId}`, cashierToken).expect(200);
    expect(obj(detail.body.data.rental).status).toBe('COMPLETED');
    const chair = await get(`/api/v1/chairs/${session.chairId}`, cashierToken).expect(200);
    expect(obj(chair.body.data.chair).status).toBe('CLEANING');
  });

  it('la reserva ACTIVE del check-in pasa a COMPLETED (BR-ORDER-015)', async () => {
    // Este caso es el del check-in: la reserva está `ACTIVE` y su alquiler se
    // facturó con la reserva, así que el cierre tiene que hacer también el
    // check-out. Si no, la reserva queda `ACTIVE` con la silla ya liberada.
    const chairId = await createChair();
    const reservationId = await createConfirmedReservation(chairId, PLANNED_MINUTES);
    const checkIn = await post(`/api/v1/reservations/${reservationId}/check-in`, {}, cashierToken).expect(200);
    const rentalId = num(obj(obj(checkIn.body.data).rental).id);
    expect(reservationStatus(reservationId)).toBe('ACTIVE');

    const order = await createRentalOrder({ chairId, reservationId, rentalId, rentalCode: '' });
    await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);

    expect(rentalRow(rentalId).status).toBe('COMPLETED');
    expect(chairStatus(chairId)).toBe('CLEANING');
    expect(reservationStatus(reservationId)).toBe('COMPLETED');
  });

  it('una reserva sólo CONFIRMED no se toca: la máquina de reservas manda (DESIGN.md 6.2)', async () => {
    const session = await openWalkInRental();
    const order = await createRentalOrder(session);
    await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);

    // El alquiler walk-in no hizo check-in: la reserva sigue `CONFIRMED` y sólo se
    // cierra con `POST /reservations/:id/complete`, que es su camino.
    expect(reservationStatus(session.reservationId)).toBe('CONFIRMED');
    expect(rentalRow(session.rentalId).status).toBe('COMPLETED');
  });
});

// ==========================================================================
// Pago parcial
// ==========================================================================

describe('Cobro parcial del alquiler', () => {
  it('con pago parcial el alquiler sigue abierto y al pagar el resto se cierra', async () => {
    const session = await openWalkInRental();
    const order = await createRentalOrder(session);
    const half = Math.floor(order.totalMinor / 2);
    const rest = order.totalMinor - half;

    // --- Primer cobro: la mitad --------------------------------------------
    const first = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: half, receivedMinor: half },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    expect(first.body.meta.orderCompleted).toBe(false);
    expect(first.body.meta.changeDueMinor).toBe(0);

    // El pedido NO está completo, así que la sesión sigue viva: es lo correcto.
    expect(orderStatus(order.id)).toBe('PENDING');
    expect(rentalRow(session.rentalId).status).toBe('ACTIVE');
    expect(chairStatus(session.chairId)).toBe('OCCUPIED');
    expect(rentalRow(session.rentalId).billed_minutes).toBe(0);

    // `POST /orders/:id/status -> COMPLETED` no existe desde `PENDING`
    // (`PENDING -> COMPLETED` está prohibido en DESIGN.md 6.1): la única forma de
    // cerrar la sesión pagando es terminar de cobrar. Antes de este arreglo la
    // sesión quedaba huérfana; ahora el segundo cobro la cierra.
    const manual = await post(`/api/v1/orders/${order.id}/status`, { toStatus: 'COMPLETED' }, cashierToken);
    expect(manual.status).toBe(422);
    expect(obj(manual.body.error).details).toMatchObject({ code: 'INVALID_ORDER_TRANSITION' });
    expect(rentalRow(session.rentalId).status).toBe('ACTIVE');

    // --- Segundo cobro: el resto ------------------------------------------
    const second = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: rest, receivedMinor: rest },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    expect(second.body.meta.orderCompleted).toBe(true);

    expect(orderStatus(order.id)).toBe('COMPLETED');
    expect(rentalRow(session.rentalId).status).toBe('COMPLETED');
    expect(chairStatus(session.chairId)).toBe('CLEANING');
    // Dos pagos, un solo cobro aplicado y un solo cierre.
    expect(countPayments(order.id)).toBe(2);
  });
});

// ==========================================================================
// Idempotencia: cerrar dos veces no rompe y no duplica
// ==========================================================================

describe('Cerrar la sesión dos veces', () => {
  it('POST /rentals/:id/complete y luego el cobro no rompen ni duplican el cierre', async () => {
    const session = await openWalkInRental();
    const order = await createRentalOrder(session);

    // El cajero cierra la sesión a mano, como hasta ahora.
    const manual = await post(`/api/v1/rentals/${session.rentalId}/complete`, {}, cashierToken).expect(200);
    const afterManual = rentalRow(session.rentalId);
    expect(afterManual.status).toBe('COMPLETED');
    expect(chairStatus(session.chairId)).toBe('CLEANING');
    expect(num(obj(manual.body.data.charge).totalMinor)).toBe(afterManual.total_minor);

    // Y ahora llega el cobro del pedido. El alquiler YA estaba cerrado: el cobro
    // tiene que salir bien igual (fallar aquí dejaría al cajero con el cobro a
    // medias) y sin reescribir el cierre.
    const paid = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    expect(paid.body.meta.orderCompleted).toBe(true);
    expect(orderStatus(order.id)).toBe('COMPLETED');

    const afterPayment = rentalRow(session.rentalId);
    expect(afterPayment.status).toBe('COMPLETED');
    // Sin duplicar: mismos minutos y mismo total que escribió el cierre a mano.
    expect(afterPayment.billed_minutes).toBe(afterManual.billed_minutes);
    expect(afterPayment.total_minor).toBe(afterManual.total_minor);
    expect(countPayments(order.id)).toBe(1);

    // Un solo alquiler vivo por silla, y la silla sigue liberada.
    const vivos = ctx.db
      .prepare(
        `SELECT COUNT(*) AS total FROM chair_rentals
          WHERE chair_id = ? AND status IN ('ACTIVE', 'EXTENDED')`,
      )
      .get(session.chairId) as { total: number };
    expect(vivos.total).toBe(0);
  });

  it('cobrar y luego volver a cerrar a mano responde 422 sin tocar nada', async () => {
    const session = await openWalkInRental();
    const order = await createRentalOrder(session);
    await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    const closed = rentalRow(session.rentalId);

    // El contrato de `POST /rentals/:id/complete` no cambia: un alquiler ya
    // cerrado es un 422 legible, no un no-op silencioso.
    const again = await post(`/api/v1/rentals/${session.rentalId}/complete`, {}, cashierToken).expect(422);
    expect(obj(again.body.error).details).toMatchObject({ code: 'RENTAL_NOT_ACTIVE' });

    // Y nada cambia: ni el alquiler, ni la silla, ni los pagos.
    expect(rentalRow(session.rentalId)).toEqual(closed);
    expect(chairStatus(session.chairId)).toBe('CLEANING');
    expect(countPayments(order.id)).toBe(1);
  });

  it('reintentar el cobro con la MISMA Idempotency-Key no vuelve a cerrar la sesión', async () => {
    const session = await openWalkInRental();
    const order = await createRentalOrder(session);
    const key = idempotencyKey();
    const body = {
      orderId: order.id,
      method: 'CASH',
      amountMinor: order.totalMinor,
      receivedMinor: order.totalMinor,
    };

    const first = await postWithKey('/api/v1/payments', body, key, cashierToken).expect(201);
    expect(first.body.meta.idempotent).toBe(false);
    const closed = rentalRow(session.rentalId);
    expect(closed.status).toBe('COMPLETED');

    // El reintento por red devuelve el MISMO pago y no vuelve a liquidar.
    const retry = await postWithKey('/api/v1/payments', body, key, cashierToken).expect(200);
    expect(retry.body.meta.idempotent).toBe(true);
    expect(num(obj(retry.body.data).id)).toBe(num(obj(first.body.data).id));
    expect(countPayments(order.id)).toBe(1);
    expect(rentalRow(session.rentalId)).toEqual(closed);
  });
});

// ==========================================================================
// Transaccionalidad: o se cobra y se cierra, o no queda nada
// ==========================================================================

describe('Atomicidad del cierre (DESIGN.md 8.4)', () => {
  it('si el cierre del alquiler falla, el cobro tampoco se aplica', async () => {
    const session = await openWalkInRental();
    const order = await createRentalOrder(session);
    const before = {
      payments: countPayments(order.id),
      rental: rentalRow(session.rentalId),
    };
    // El pedido tiene que pagar el total del alquiler más el impuesto del
    // negocio (BR-TAX-007). Se toma el que devolvió la API, no una constante.
    expect(order.totalMinor).toBeGreaterThan(order.rentalBaseMinor);

    // Se invalida el alquiler desde la base para forzar el fallo del cierre: la
    // ventana se mueve entera al futuro, de modo que el instante del cobro
    // (`endedAt`) queda ANTES de la apertura y `closeLiveRental` lanza
    // `RENTAL_END_BEFORE_START` (BR-RENTAL-002). Se mueven las dos columnas
    // porque `ck_chair_rentals_window` exige `end_at > start_at`.
    const futureStart = new Date(Date.now() + 3_600_000).toISOString();
    const futureEnd = new Date(Date.now() + 7_200_000).toISOString();
    ctx.db
      .prepare('UPDATE chair_rentals SET start_at = ?, end_at = ? WHERE id = ?')
      .run(futureStart, futureEnd, session.rentalId);

    const paid = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(422);
    expect(obj(paid.body.error).details).toMatchObject({ code: 'RENTAL_END_BEFORE_START' });

    // Ni pago, ni pedido pagado, ni pedido completado, ni alquiler cerrado.
    expect(countPayments(order.id)).toBe(before.payments);
    const orderRow = ctx.db
      .prepare('SELECT status, paid_minor, balance_minor FROM orders WHERE id = ?')
      .get(order.id) as { status: string; paid_minor: number; balance_minor: number };
    expect(orderRow.status).toBe('PENDING');
    expect(orderRow.paid_minor).toBe(0);
    expect(orderRow.balance_minor).toBe(order.totalMinor);
    // El alquiler tampoco se cerró a medias ni se liberó la silla.
    expect(rentalRow(session.rentalId).status).toBe(before.rental.status);
    expect(rentalRow(session.rentalId).billed_minutes).toBe(before.rental.billed_minutes);
    expect(chairStatus(session.chairId)).toBe('OCCUPIED');

    // Y no quedó historial de un cobro que no ocurrió.
    const history = ctx.db
      .prepare(
        `SELECT COUNT(*) AS total FROM order_status_history
          WHERE order_id = ? AND to_status IN ('CONFIRMED', 'COMPLETED')`,
      )
      .get(order.id) as { total: number };
    expect(history.total).toBe(0);
  });
});

// ==========================================================================
// El camino que ya funcionaba
// ==========================================================================

describe('Pedidos sin alquiler: el camino que ya funcionaba sigue intacto', () => {
  it('un TAKEAWAY se cobra y se completa sin tocar nada de la sesión', async () => {
    const n = nextSeq();
    const product = await post(
      '/api/v1/products',
      { sku: `LIQ-${String(n).padStart(4, '0')}`, name: `Producto liquidación ${n}`, basePriceMinor: 10_000 },
      adminToken,
    ).expect(201);
    const productId = num(product.body.data.id);
    const created = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }] },
      cashierToken,
    ).expect(201);
    const order = obj(created.body.data);
    const orderId = num(order.id);
    const totalMinor = num(order.totalMinor);

    const paid = await postWithKey(
      '/api/v1/payments',
      { orderId, method: 'CASH', amountMinor: totalMinor, receivedMinor: totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    expect(paid.body.meta.orderCompleted).toBe(true);
    expect(orderStatus(orderId)).toBe('COMPLETED');
    expect(num(obj(paid.body.data).amountMinor)).toBe(totalMinor);

    // Sin silla, sin reserva y sin alquiler: la liquidación es un no-op y no
    // escribe nada. Es lo que hace seguro inyectar el puerto en TODO cobro.
    const detail = await get(`/api/v1/orders/${orderId}`, cashierToken).expect(200);
    expect(num(obj(detail.body.data).balanceMinor)).toBe(0);
  });

  it('POST /orders/:id/status -> COMPLETED sigue cerrando la sesión (BR-ORDER-015)', async () => {
    const chairId = await createChair();
    const reservationId = await createConfirmedReservation(chairId, PLANNED_MINUTES);
    const checkIn = await post(`/api/v1/reservations/${reservationId}/check-in`, {}, cashierToken).expect(200);
    const rentalId = num(obj(obj(checkIn.body.data).rental).id);
    const order = await createRentalOrder({ chairId, reservationId, rentalId, rentalCode: '' });

    for (const toStatus of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      await post(`/api/v1/orders/${order.id}/status`, { toStatus }, cashierToken).expect(200);
    }

    // Esta puerta nunca estuvo rota, así que es la referencia contra la que se
    // compara el cobro: mismo resultado y, además, `billed_minutes` correcto
    // (antes quedaba en 0).
    const rental = rentalRow(rentalId);
    expect(rental.status).toBe('COMPLETED');
    expect(rental.billed_minutes).toBeGreaterThanOrEqual(30);
    expect(chairStatus(chairId)).toBe('CLEANING');
    expect(reservationStatus(reservationId)).toBe('COMPLETED');
  });
});
