/**
 * Pruebas de alquileres: apertura walk-in, precio congelado, mínimo de 30
 * minutos, facturación pro-rata, overage, extensiones, cierre y exclusividad por
 * silla.
 *
 * El dinero se comprueba SIEMPRE en centavos enteros y con el valor EXACTO del
 * contrato: 2 h × $5.000/h = $10.000 → `1000000`. Un redondeo mal hecho se ve
 * aquí como un `expected 999999 to be 1000000`, no como un descuadre de mil
 * pesos en la caja de marzo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { API_PREFIX } from '../src/config/index.js';
import { createApiV1Router } from '../src/modules/index.js';
import { chairsRouter, zonesRouter } from '../src/modules/spaces/spaces.routes.js';
import { reservationsRouter } from '../src/modules/reservations/reservations.routes.js';
import { rentalsRouter } from '../src/modules/rentals/rentals.routes.js';
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
let customerToken: string;
let customerId: number;
let locationId: number;
let zoneCounter = 0;
let chairCounter = 0;

/** Precio por hora de la silla de la semilla: $5.000 = 500000 centavos. */
const PRICE_PER_HOUR = 500_000;

/**
 * Base temporal común (ver la nota equivalente en `reservations.spec.ts`): hace
 * que las duraciones sean exactas y no dependan del reloj entre llamadas.
 */
const BASE = Date.now();

function buildTestApp(): Express {
  const app = express();
  setRateLimitingEnabled(false);
  app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(requestContext);
  app.use(jsonBody);
  const api = createApiV1Router({ disableRateLimit: true });
  api.use('/zones', zonesRouter);
  api.use('/chairs', chairsRouter);
  api.use('/reservations', reservationsRouter);
  api.use('/rentals', rentalsRouter);
  app.use(API_PREFIX, api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

function get(path: string, token?: string): request.Test {
  return token === undefined ? agent.get(path) : agent.get(path).set('Authorization', `Bearer ${token}`);
}
function post(path: string, body: object | string, token?: string): request.Test {
  return (token === undefined ? agent.post(path) : agent.post(path).set('Authorization', `Bearer ${token}`)).send(body);
}
function patch(path: string, body: object | string, token?: string): request.Test {
  return (token === undefined ? agent.patch(path) : agent.patch(path).set('Authorization', `Bearer ${token}`)).send(body);
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeRentalsTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');
  const email = ctx.uniqueEmail('alquileres');
  const registered = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente Alquileres' })
    .expect(201);
  customerToken = String(registered.body.data.accessToken);
  customerId = Number(registered.body.data.user.id);
  locationId = seedSpacesDemo().locationId;
});

afterAll(() => {
  ctx.close();
});

/** Instante ISO a `minutes` minutos de la base común. */
function inMinutes(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

async function createZone(): Promise<number> {
  zoneCounter += 1;
  const response = await post(
    '/api/v1/zones',
    { locationId, name: `Zona de alquileres ${zoneCounter}` },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

/** Silla nueva con el precio por defecto del negocio. */
async function createChair(zoneId: number, extra: Record<string, unknown> = {}): Promise<number> {
  chairCounter += 1;
  const response = await post(
    '/api/v1/chairs',
    { zoneId, code: `AL-${String(chairCounter).padStart(4, '0')}`, ...extra },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

// ===========================================================================
describe('Cálculo del importe del alquiler (BR-RENTAL-001, BR-MONEY-002)', () => {
  it('2 h × $5.000/h = $10.000 exactos en centavos (1.000.000)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 120 }, cashierToken).expect(201);

    const rental = created.body.data.rental;
    expect(rental.code).toMatch(/^RENT-\d{6}$/);
    expect(rental.status).toBe('ACTIVE');
    expect(rental.plannedMinutes).toBe(120);
    expect(rental.pricePerHourMinor).toBe(PRICE_PER_HOUR);
    expect(rental.subtotalMinor).toBe(1_000_000);
    expect(rental.totalMinor).toBe(1_000_000);
    expect(rental.extraMinutesMinor).toBe(0);
    expect(rental.billedMinutes).toBe(0);

    // Y al cerrarlo exactamente a la hora planificada no hay overage.
    const completed = await post(
      `/api/v1/rentals/${rental.id}/complete`,
      { endAt: new Date(Date.parse(rental.startAt) + 120 * 60_000).toISOString() },
      cashierToken,
    ).expect(200);
    expect(completed.body.data.charge.billedMinutes).toBe(120);
    expect(completed.body.data.charge.minimumApplied).toBe(false);
    expect(completed.body.data.charge.overtimeMinutes).toBe(0);
    expect(completed.body.data.charge.extraMinutesMinor).toBe(0);
    expect(completed.body.data.charge.totalMinor).toBe(1_000_000);
    // IVA 19 % del negocio sobre el total.
    expect(completed.body.data.charge.taxMinor).toBe(190_000);
    expect(completed.body.data.charge.grandTotalMinor).toBe(1_190_000);
    expect(completed.body.data.charge.currencyCode).toBe('COP');
  });

  it('pro-rata por minuto: 90 min × $5.000/h = $7.500 (750.000)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 90 }, cashierToken).expect(201);
    expect(created.body.data.rental.subtotalMinor).toBe(750_000);
    const completed = await post(
      `/api/v1/rentals/${created.body.data.rental.id}/complete`,
      { endAt: new Date(Date.parse(created.body.data.rental.startAt) + 90 * 60_000).toISOString() },
      cashierToken,
    ).expect(200);
    expect(completed.body.data.charge.billedMinutes).toBe(90);
    expect(completed.body.data.charge.totalMinor).toBe(750_000);
  });

  it('pro-rata no redondo: 45 min = $3.750 exactos, sin derivas de centavo', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 45 }, cashierToken).expect(201);
    // 45/60 * 500000 = 375000. Entero exacto.
    expect(created.body.data.rental.subtotalMinor).toBe(375_000);
  });

  it('mínimo de 30 minutos: 5 min facturan 30 ($2.500)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 5 }, cashierToken).expect(201);
    expect(created.body.data.rental.subtotalMinor).toBe(250_000);

    const completed = await post(
      `/api/v1/rentals/${created.body.data.rental.id}/complete`,
      { endAt: new Date(Date.parse(created.body.data.rental.startAt) + 5 * 60_000).toISOString() },
      cashierToken,
    ).expect(200);
    expect(completed.body.data.charge.billedMinutes).toBe(30);
    expect(completed.body.data.charge.minimumApplied).toBe(true);
    // El mínimo se aplica a la facturación, no al subtotal planificado: el plan
    // fueron 5 minutos y el cobro son 30 (BR-RENTAL-001).
    expect(completed.body.data.charge.subtotalMinor).toBe(250_000);
    expect(completed.body.data.charge.totalMinor).toBe(250_000);
  });

  it('facturación por segundos con `ceil`: 32 min y 1 s se facturan 33 minutos', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    // Plan de 2 h para que el mínimo de 30 min no esconda el redondeo.
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 120 }, cashierToken).expect(201);
    const endAt = new Date(Date.parse(created.body.data.rental.startAt) + 32 * 60_000 + 1000).toISOString();
    const completed = await post(`/api/v1/rentals/${created.body.data.rental.id}/complete`, { endAt }, cashierToken).expect(200);
    // `ceil` de 32,0166 minutos = 33 (BR-RENTAL-002): nunca se paga de menos.
    expect(completed.body.data.charge.billedMinutes).toBe(33);
    expect(completed.body.data.charge.minimumApplied).toBe(false);
    // El plan era de 2 h y se pagó el plan: no hay overage y lo no consumido se
    // devuelve con el pedido, que todavía no existe (BR-RENTAL-005).
    expect(completed.body.data.charge.overtimeMinutes).toBe(0);
    expect(completed.body.data.charge.extraMinutesMinor).toBe(0);
    expect(completed.body.data.charge.totalMinor).toBe(1_000_000);
  });
});

// ===========================================================================
describe('OVERAGE al precio congelado (BR-RENTAL-003, BR-RENTAL-004, decisión D3)', () => {
  it('cobra el exceso al precio CONGELADO aunque la silla haya subido de precio', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    expect(created.body.data.rental.pricePerHourMinor).toBe(PRICE_PER_HOUR);

    // La tarifa de la silla se duplica mientras el cliente está sentado.
    await patch(`/api/v1/chairs/${chairId}`, { pricePerHourMinor: 1_000_000 }, adminToken).expect(200);

    // Se queda 60 minutos de más: el overage es al precio CONGELADO.
    const endAt = new Date(Date.parse(created.body.data.rental.startAt) + 120 * 60_000).toISOString();
    const completed = await post(`/api/v1/rentals/${created.body.data.rental.id}/complete`, { endAt }, cashierToken).expect(200);

    const charge = completed.body.data.charge;
    expect(charge.billedMinutes).toBe(120);
    expect(charge.plannedMinutes).toBe(60);
    expect(charge.overtimeMinutes).toBe(60);
    // 60 min de overage × $5.000/h CONGELADOS = $5.000, no $10.000.
    expect(charge.extraMinutesMinor).toBe(500_000);
    expect(charge.pricePerHourMinor).toBe(PRICE_PER_HOUR);
    expect(charge.subtotalMinor).toBe(500_000);
    expect(charge.totalMinor).toBe(1_000_000);
  });

  it('no hay overage si el cliente se va antes de la hora: 0 cobrado de más', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 120 }, cashierToken).expect(201);
    const endAt = new Date(Date.parse(created.body.data.rental.startAt) + 45 * 60_000).toISOString();
    const completed = await post(`/api/v1/rentals/${created.body.data.rental.id}/complete`, { endAt }, cashierToken).expect(200);
    const charge = completed.body.data.charge;
    expect(charge.billedMinutes).toBe(45);
    expect(charge.overtimeMinutes).toBe(0);
    expect(charge.extraMinutesMinor).toBe(0);
    // Se paga lo planificado (2 h) aunque sólo estuvo 45 min: la proyección se
    // calcula al abrir y el reembolso de lo no consumido (BR-RENTAL-005) vive en
    // el módulo de pedidos, que todavía no existe.
    expect(charge.totalMinor).toBe(1_000_000);
  });

  it('un MANAGER puede perdonar el sobretiempo con motivo (API.md 7.9)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const endAt = new Date(Date.parse(created.body.data.rental.startAt) + 150 * 60_000).toISOString();

    // Un CASHIER no puede perdonar nada.
    const denied = await post(
      `/api/v1/rentals/${created.body.data.rental.id}/complete`,
      { endAt, waiveOvertime: true, waiveReason: 'Regalo de la casa' },
      cashierToken,
    ).expect(403);
    expect(denied.body.error.code).toBe('AUTHORIZATION_ERROR');

    const waived = await post(
      `/api/v1/rentals/${created.body.data.rental.id}/complete`,
      { endAt, waiveOvertime: true, waiveReason: 'Regalo de la casa' },
      adminToken,
    ).expect(200);
    expect(waived.body.data.charge.billedMinutes).toBe(150);
    expect(waived.body.data.charge.extraMinutesMinor).toBe(0);
    expect(waived.body.data.charge.waivedMinor).toBe(750_000);
  });
});

// ===========================================================================
describe('Apertura walk-in y ocupabilidad (BR-RENTAL-007, BR-RENTAL-009)', () => {
  it('el walk-in ocupa la silla y devuelve el total', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/rentals',
      { chairId, plannedMinutes: 60, customerId, notes: 'Mesa de dos' },
      cashierToken,
    ).expect(201);

    expect(created.body.data.rental.customerId).toBe(customerId);
    expect(created.body.data.rental.reservationId).toBeNull();
    expect(created.body.data.rental.subtotalMinor).toBe(500_000);
    expect(created.body.data.rental.totalMinor).toBe(500_000);
    expect(created.body.data.chairStatus).toBe('OCCUPIED');

    const chair = await get(`/api/v1/chairs/${chairId}`, cashierToken).expect(200);
    expect(chair.body.data.chair.status).toBe('OCCUPIED');
    expect(chair.body.data.currentRental.code).toBe(created.body.data.rental.code);
  });

  it('duración por defecto de 60 minutos si no se envía (BR-RENTAL-007)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId }, cashierToken).expect(201);
    expect(created.body.data.rental.plannedMinutes).toBe(60);
  });

  it('segundo alquiler de la misma silla: 409 CHAIR_OCCUPIED con el código activo', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const first = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const response = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('CHAIR_OCCUPIED');
    expect(response.body.error.details.activeRentalCode).toBe(first.body.data.rental.code);
  });

  it('no abre alquiler en una silla bloqueada: 422 CHAIR_BLOCKED', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    await post(`/api/v1/chairs/${chairId}/block`, { reason: 'Reparación' }, adminToken).expect(200);
    const response = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(422);
    expect(response.body.error.details.code).toBe('CHAIR_BLOCKED');
  });

  it('no abre alquiler en una silla en limpieza: 422 CHAIR_NOT_BOOKABLE', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    // Pasamos la silla por alquiler → cierre → CLEANING.
    const rental = await post('/api/v1/rentals', { chairId, plannedMinutes: 30 }, cashierToken).expect(201);
    await post(`/api/v1/rentals/${rental.body.data.rental.id}/complete`, {}, cashierToken).expect(200);
    const response = await post('/api/v1/rentals', { chairId, plannedMinutes: 30 }, cashierToken).expect(422);
    expect(response.body.error.details.code).toBe('CHAIR_NOT_BOOKABLE');
  });

  it('con `reservationId` PENDING: 422 RESERVATION_NOT_ACTIVE (BR-RENTAL-012)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const reservation = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(60), endAt: inMinutes(120), customerId },
      cashierToken,
    ).expect(201);
    const response = await post(
      '/api/v1/rentals',
      { chairId, reservationId: reservation.body.data.id, plannedMinutes: 60 },
      cashierToken,
    ).expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('RESERVATION_NOT_ACTIVE');
    expect(response.body.error.details.ruleId).toBe('BR-RENTAL-012');
  });

  it('con `reservationId` CONFIRMED: check-in implícito y alquiler vinculado', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const reservation = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(61), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${reservation.body.data.id}/confirm`, {}, cashierToken).expect(200);

    const created = await post(
      '/api/v1/rentals',
      { chairId, reservationId: reservation.body.data.id, plannedMinutes: 60 },
      cashierToken,
    ).expect(201);
    expect(created.body.data.rental.reservationId).toBe(reservation.body.data.id);
    // El precio congelado es el de la RESERVA, no el vigente de la silla.
    expect(created.body.data.rental.pricePerHourMinor).toBe(PRICE_PER_HOUR);
    expect(created.body.data.chairStatus).toBe('OCCUPIED');
  });
});

// ===========================================================================
describe('Extensión de alquiler (BR-RENTAL-011)', () => {
  it('registra el movimiento en chair_rental_extensions al precio congelado', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const rentalId = created.body.data.rental.id;

    // Sube la tarifa de la silla: la extensión debe seguir cobrando lo congelado.
    await patch(`/api/v1/chairs/${chairId}`, { pricePerHourMinor: 1_000_000 }, adminToken).expect(200);

    const extended = await post(
      `/api/v1/rentals/${rentalId}/extend`,
      { additionalMinutes: 30, reason: 'Se queda un rato más' },
      cashierToken,
    ).expect(200);

    expect(extended.body.data.rental.status).toBe('EXTENDED');
    expect(extended.body.data.extension.requestedMinutes).toBe(30);
    // 30 min × $5.000/h CONGELADOS = $2.500.
    expect(extended.body.data.extension.additionalMinor).toBe(250_000);
    expect(extended.body.data.extension.pricePerHourMinor).toBe(PRICE_PER_HOUR);
    expect(extended.body.data.rental.extensionsMinor).toBe(250_000);
    // total = subtotal + extensiones + extra (0 mientras sigue abierto).
    expect(extended.body.data.rental.totalMinor).toBe(750_000);

    // La fila queda en la tabla INMUTABLE de extensiones.
    const rows = ctx.db
      .prepare('SELECT requested_minutes, additional_minor, previous_end_at, new_end_at FROM chair_rental_extensions WHERE rental_id = ?')
      .all(rentalId) as { requested_minutes: number; additional_minor: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.requested_minutes).toBe(30);
    expect(rows[0]?.additional_minor).toBe(250_000);
  });

  it('el overage se calcula sobre el plan YA extendido, no sobre el original', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const rentalId = created.body.data.rental.id;
    await post(`/api/v1/rentals/${rentalId}/extend`, { additionalMinutes: 60 }, cashierToken).expect(200);

    // Se queda 30 min más allá de la extensión: el overage sale de esos 30.
    const detail = await get(`/api/v1/rentals/${rentalId}`, cashierToken).expect(200);
    const endAt = new Date(Date.parse(detail.body.data.rental.endAt) + 30 * 60_000).toISOString();
    const completed = await post(`/api/v1/rentals/${rentalId}/complete`, { endAt }, cashierToken).expect(200);

    const charge = completed.body.data.charge;
    expect(charge.plannedMinutes).toBe(60);
    expect(charge.billedMinutes).toBe(150);
    expect(charge.overtimeMinutes).toBe(30);
    expect(charge.extensionsMinor).toBe(500_000);
    expect(charge.extraMinutesMinor).toBe(250_000);
    // 500.000 (60 min) + 500.000 (extensión) + 250.000 (overage) = 1.250.000.
    expect(charge.totalMinor).toBe(1_250_000);
  });

  it('extender un alquiler ya cerrado: 422 RENTAL_NOT_ACTIVE', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const rentalId = created.body.data.rental.id;
    await post(`/api/v1/rentals/${rentalId}/complete`, {}, cashierToken).expect(200);
    const response = await post(`/api/v1/rentals/${rentalId}/extend`, { additionalMinutes: 30 }, cashierToken).expect(422);
    expect(response.body.error.details.code).toBe('RENTAL_NOT_ACTIVE');
  });

  it('exige una extensión de al menos 5 minutos: 400', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    await post(`/api/v1/rentals/${created.body.data.rental.id}/extend`, { additionalMinutes: 1 }, cashierToken).expect(400);
  });
});

// ===========================================================================
describe('Cierre (BR-RENTAL-008)', () => {
  it('cierra, cobra y deja la silla en CLEANING (no en AVAILABLE)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const completed = await post(`/api/v1/rentals/${created.body.data.rental.id}/complete`, {}, cashierToken).expect(200);

    expect(completed.body.data.rental.status).toBe('COMPLETED');
    expect(completed.body.data.chairStatus).toBe('CLEANING');

    const chair = await get(`/api/v1/chairs/${chairId}`, cashierToken).expect(200);
    expect(chair.body.data.chair.status).toBe('CLEANING');
    // Y desde CLEANING la silla vuelve a estar disponible con su endpoint
    // (`needsCleaning: false`: ya se limpió, no hace falta otra ronda).
    await post(`/api/v1/chairs/${chairId}/complete-maintenance`, { needsCleaning: false }, cashierToken).expect(200);
    const after = await get(`/api/v1/chairs/${chairId}`, cashierToken).expect(200);
    expect(after.body.data.chair.status).toBe('AVAILABLE');
  });

  it('rechaza un cierre anterior a la apertura: 422 RENTAL_END_BEFORE_START', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const response = await post(
      `/api/v1/rentals/${created.body.data.rental.id}/complete`,
      { endAt: inMinutes(-60) },
      cashierToken,
    ).expect(422);
    expect(response.body.error.details.code).toBe('RENTAL_END_BEFORE_START');
  });

  it('cerrar dos veces: 422 RENTAL_NOT_ACTIVE', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    await post(`/api/v1/rentals/${created.body.data.rental.id}/complete`, {}, cashierToken).expect(200);
    const response = await post(`/api/v1/rentals/${created.body.data.rental.id}/complete`, {}, cashierToken).expect(422);
    expect(response.body.error.details.code).toBe('RENTAL_NOT_ACTIVE');
  });
});

// ===========================================================================
describe('Lecturas de alquileres y RBAC (API.md 7.9)', () => {
  it('`GET /rentals/active` sólo devuelve alquileres vivos, con minutos derivados', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    await post(`/api/v1/rentals/${created.body.data.rental.id}/extend`, { additionalMinutes: 30 }, cashierToken).expect(200);

    const active = await get(`/api/v1/rentals/active?locationId=${locationId}&pageSize=100`, cashierToken).expect(200);
    const rental = active.body.data.find((item: { id: number }) => item.id === created.body.data.rental.id);
    expect(rental).toBeDefined();
    expect(rental.status).toBe('EXTENDED');
    // 90 minutos de plan; el elapsed se deriva del reloj en la respuesta.
    expect(rental.remainingMinutes + rental.elapsedMinutes).toBe(90);
    expect(rental.elapsedMinutes).toBeGreaterThanOrEqual(0);

    // Al cerrarlo, ya no aparece en /active.
    await post(`/api/v1/rentals/${created.body.data.rental.id}/complete`, {}, cashierToken).expect(200);
    const after = await get(`/api/v1/rentals/active?pageSize=100`, cashierToken).expect(200);
    expect(after.body.data.find((item: { id: number }) => item.id === created.body.data.rental.id)).toBeUndefined();
  });

  it('`GET /rentals/chair/:id/active` devuelve 200 con `data: null` si no hay alquiler', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const response = await get(`/api/v1/rentals/chair/${chairId}/active`, cashierToken).expect(200);
    expect(response.body.data).toBeNull();
  });

  it('`GET /rentals/chair/:id/active` de una silla inexistente: 404', async () => {
    await get('/api/v1/rentals/chair/999999/active', cashierToken).expect(404);
  });

  it('el listado trae contadores por estado y la silla queda con `zoneName`', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const list = await get('/api/v1/rentals?pageSize=100', cashierToken).expect(200);
    const rental = list.body.data.find((item: { id: number }) => item.id === created.body.data.rental.id);
    expect(rental.zoneName).toBeTruthy();
    expect(rental.chairCode).toBeTruthy();
    expect(list.body.meta.countsByStatus.ACTIVE).toBeGreaterThanOrEqual(1);
  });

  it('un CUSTOMER sólo ve sus propios alquileres y no puede abrir ninguno', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const mine = await post(
      '/api/v1/rentals',
      { chairId, plannedMinutes: 60, customerId },
      cashierToken,
    ).expect(201);

    // Alquiler de otro cliente, en otra silla.
    const chairId2 = await createChair(zoneId);
    const other = await post('/api/v1/rentals', { chairId: chairId2, plannedMinutes: 60 }, cashierToken).expect(201);

    const list = await get('/api/v1/rentals?pageSize=100', customerToken).expect(200);
    const ids = list.body.data.map((item: { id: number }) => item.id);
    expect(ids).toContain(mine.body.data.rental.id);
    expect(ids).not.toContain(other.body.data.rental.id);

    // Y 404 (no 403) al pedir el de otro.
    await get(`/api/v1/rentals/${other.body.data.rental.id}`, customerToken).expect(404);
    // Abrir, extender y cerrar son de sala: 403.
    await post('/api/v1/rentals', { chairId: chairId2, plannedMinutes: 30 }, customerToken).expect(403);
    await post(`/api/v1/rentals/${mine.body.data.rental.id}/extend`, { additionalMinutes: 30 }, customerToken).expect(403);
    await post(`/api/v1/rentals/${mine.body.data.rental.id}/complete`, {}, customerToken).expect(403);
  });

  it('un CUSTOMER crea su propia reserva pero NO puede abrir un alquiler', async () => {
    await post('/api/v1/rentals', { chairId: 1, plannedMinutes: 30 }, customerToken).expect(403);
  });

  it('el cliente no puede enviar `startAt` ni importes al abrir (400, `.strict()`)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const response = await post(
      '/api/v1/rentals',
      { chairId, plannedMinutes: 30, startAt: inMinutes(60), totalMinor: 1 },
      cashierToken,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
describe('Auditoría de alquileres (BR-SEC-007)', () => {
  it('alta, extensión y cierre dejan fila en audit_logs con `rental`', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const rentalId = created.body.data.rental.id;
    await post(`/api/v1/rentals/${rentalId}/extend`, { additionalMinutes: 30 }, cashierToken).expect(200);
    await post(`/api/v1/rentals/${rentalId}/complete`, {}, cashierToken).expect(200);

    const rows = ctx.db
      .prepare("SELECT action FROM audit_logs WHERE entity_type = 'rental' AND entity_id = ? ORDER BY id ASC")
      .all(rentalId) as { action: string }[];
    const actions = rows.map((row) => row.action);
    expect(actions).toContain('CREATE');
    expect(actions).toContain('UPDATE');
  });

  it('el overage queda registrado con los minutos de más en el audit log', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    const endAt = new Date(Date.parse(created.body.data.rental.startAt) + 100 * 60_000).toISOString();
    await post(`/api/v1/rentals/${created.body.data.rental.id}/complete`, { endAt }, cashierToken).expect(200);

    const row = ctx.db
      .prepare(
        `SELECT after_data FROM audit_logs
          WHERE entity_type = 'rental' AND entity_id = ? AND action = 'UPDATE'
          ORDER BY id DESC LIMIT 1`,
      )
      .get(created.body.data.rental.id) as { after_data: string };
    const snapshot = JSON.parse(row.after_data) as { extraMinutes: number; extraMinutesMinor: number };
    expect(snapshot.extraMinutes).toBe(40);
    expect(snapshot.extraMinutesMinor).toBe(333_333);
  });
});
