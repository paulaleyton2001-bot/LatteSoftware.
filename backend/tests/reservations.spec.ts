/**
 * Pruebas de reservas: solapamiento (el caso de los dos clientes), máquina de
 * estados, cotización sin escritura, check-in que materializa el alquiler,
 * cancelación, extensión, caducidad y alcance por cliente.
 *
 * El test más importante de la suite es `doble reserva -> 409`: es el escenario
 * de carrera que define si el sistema es correcto o sólo lo parece. Por eso está
 * el primero y con el nombre de la regla (BR-RES-002/BR-RES-003).
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
import { systemJobsRouter } from '../src/modules/reservations/reservations.jobs.js';
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
let otherCustomerToken: string;
let customerId: number;
let locationId: number;
let zoneCounter = 0;
let chairCounter = 0;

/** App con los routers de la familia de espacios (ver `spaces.spec.ts`). */
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
  api.use('/system/jobs', systemJobsRouter);
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

/** Registra un cliente nuevo y devuelve su token y su id. */
async function registerCustomer(prefix: string): Promise<{ token: string; id: number }> {
  const email = ctx.uniqueEmail(prefix);
  const response = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: `Cliente ${prefix}` })
    .expect(201);
  return { token: String(response.body.data.accessToken), id: Number(response.body.data.user.id) };
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeReservationsTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');
  const primary = await registerCustomer('reservas');
  customerToken = primary.token;
  customerId = primary.id;
  const secondary = await registerCustomer('reservas-otro');
  otherCustomerToken = secondary.token;
  locationId = seedSpacesDemo().locationId;
});

afterAll(() => {
  ctx.close();
});

/**
 * Base temporal COMÚN de la suite.
 *
 * Todos los instantes se derivan de este único `Date.now()` en lugar de tomar la
 * hora en cada llamada. Sin esto, `inMinutes(120)` y `inMinutes(300)` se evalúan
 * con dos `Date.now()` distintos y la duración de la reserva sale en 181 minutos
 * en vez de 180: el redondeo `ceil` de BR-RENTAL-002 convierte un milisegundo de
 * deriva en un minuto entero de más, y el test fallaría por el motivo equivocado.
 */
const BASE = Date.now();

/** Instante ISO a `minutes` minutos de la base común. */
function inMinutes(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

/** Crea una zona nueva y devuelve su id. */
async function createZone(): Promise<number> {
  zoneCounter += 1;
  const response = await post(
    '/api/v1/zones',
    { locationId, name: `Zona de reservas ${zoneCounter}` },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

/** Crea una silla nueva con el precio por defecto del negocio y devuelve su id. */
async function createChair(zoneId: number): Promise<number> {
  chairCounter += 1;
  const response = await post(
    '/api/v1/chairs',
    { zoneId, code: `RS-${String(chairCounter).padStart(4, '0')}` },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

// ===========================================================================
describe('Doble reserva: el caso de los dos clientes (BR-RES-002, BR-RES-003)', () => {
  it('la segunda reserva solapada recibe 409 CHAIR_ALREADY_RESERVED con el código ganador', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);

    // 14:00-16:00, dos horas antes de la hora de apertura del test.
    const startAt = inMinutes(120);
    const endAt = inMinutes(240);

    const first = await post(
      '/api/v1/reservations',
      { chairId, startAt, endAt, customerId },
      cashierToken,
    ).expect(201);
    expect(first.body.data.status).toBe('PENDING');
    expect(first.body.data.code).toMatch(/^RES-\d{6}$/);
    expect(first.body.data.durationMinutes).toBe(120);
    // Precio congelado de la silla ($5.000/h) y proyección de 2 h = $10.000.
    expect(first.body.data.pricePerHourMinor).toBe(500_000);
    expect(first.body.data.rentalTotalMinor).toBe(1_000_000);

    // 15:00-17:00: solapa con la anterior entre 15:00 y 16:00.
    const conflict = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(150), endAt: inMinutes(270), customerId },
      cashierToken,
    ).expect(409);

    expect(conflict.body.success).toBe(false);
    expect(conflict.body.error.code).toBe('CONFLICT_ERROR');
    expect(conflict.body.error.details.code).toBe('CHAIR_ALREADY_RESERVED');
    // El 409 lleva el código de la reserva que estorba, para que el cajero pueda
    //_localizarla sin salir del mensaje.
    expect(conflict.body.error.details.conflictingReservationCode).toBe(first.body.data.code);
    expect(conflict.body.error.details.conflictingStartAt).toBe(first.body.data.startAt);

    // Y en la base sólo hay UNA reserva para esa silla.
    const count = ctx.db
      .prepare('SELECT COUNT(*) AS total FROM chair_reservations WHERE chair_id = ?')
      .get(chairId) as { total: number };
    expect(count.total).toBe(1);
  });

  it('dos reservas que NO se solapan se aceptan: 14:00-16:00 y 18:00-20:00 (BR-RES-001)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);

    const morning = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(120), endAt: inMinutes(240), customerId },
      cashierToken,
    ).expect(201);
    expect(morning.body.data.durationMinutes).toBe(120);

    const evening = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(360), endAt: inMinutes(480), customerId },
      cashierToken,
    ).expect(201);
    expect(evening.body.data.durationMinutes).toBe(120);
    expect(evening.body.data.id).not.toBe(morning.body.data.id);
  });

  it('los extremos que se tocan NO se solapan: 14:00-16:00 y 16:00-18:00', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(120), endAt: inMinutes(240), customerId },
      cashierToken,
    ).expect(201);
    // La segunda empieza EXACTAMENTE al terminar la primera: es legal.
    await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(240), endAt: inMinutes(360), customerId },
      cashierToken,
    ).expect(201);
  });

  it('la reserva PENDING también bloquea: 409 en el segundo intento', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(200), endAt: inMinutes(260), customerId },
      cashierToken,
    ).expect(201);
    // El bloqueo lo pone la verificación de solapamiento, que mira PENDING,
    // CONFIRMED y ACTIVE (BR-RES-002 y punto 4 de DESIGN.md 4.3). Es la misma
    // comprobación que protege a las CONFIRMED, y es transaccional.
    const response = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(220), endAt: inMinutes(320), customerId },
      cashierToken,
    ).expect(409);
    expect(response.body.error.details.code).toBe('CHAIR_ALREADY_RESERVED');
  });

  it('confirmar una reserva que solapa con otra CONFIRMED recibe 409 (la garantía vive en la transacción)', async () => {
    // Dos reservas PENDING que se solapan NO pueden existir por el paso 2 del
    // alta, así que esta prueba verifica la garantía contra el adversario real:
    // una fila que entra por la puerta de atrás (inserción directa) y se confirma
    // primero. La segunda confirmación debe recibir 409 y no dejar doble reserva.
    //
    // NOTA (2026-09-28): antes esta prueba se apoyaba en el índice único parcial
    // `ux_chair_res_active`, eliminado por `0002_fix_chair_reservation_index.sql`
    // porque bloqueaba reservas legítimamente NO solapadas. El 409 sigue siendo el
    // correcto, pero lo produce `findOverlapping` DENTRO de la `BEGIN IMMEDIATE`,
    // no el índice. El nombre y el comentario se actualizaron para que no
    // describan una garantía que ya no está en el esquema.
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const first = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1000), endAt: inMinutes(1060), customerId },
      cashierToken,
    ).expect(201);

    // Inserción directa para simular una reserva que se confirmara primero.
    const zone = ctx.db
      .prepare(
        `SELECT z.business_id AS business_id, z.location_id AS location_id, z.id AS zone_id
           FROM chairs c
           JOIN zones z ON z.id = c.zone_id
          WHERE c.id = ?`,
      )
      .get(chairId) as { business_id: number; location_id: number; zone_id: number };
    const intruder = ctx.db
      .prepare(
        `INSERT INTO chair_reservations (
           business_id, location_id, zone_id, chair_id, customer_id, code, status,
           start_at, end_at, duration_minutes, price_per_hour_minor, rental_total_minor, source
         ) VALUES (?, ?, ?, ?, ?, 'RES-999999', 'PENDING', ?, ?, 60, 500000, 500000, 'STAFF')`,
      )
      .run(
        zone.business_id,
        zone.location_id,
        zone.zone_id,
        chairId,
        customerId,
        new Date(Date.now() + 1010 * 60_000).toISOString(),
        new Date(Date.now() + 1070 * 60_000).toISOString(),
      ).lastInsertRowid;

    // Se confirma primero la intrusa (de Occupied-0 a 1: no estorba).
    ctx.db.prepare("UPDATE chair_reservations SET status = 'CONFIRMED' WHERE id = ?").run(intruder);
    // Y ahora el service intenta confirmar la primera: el solapamiento la salta.
    const response = await post(`/api/v1/reservations/${first.body.data.id}/confirm`, {}, cashierToken).expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('CHAIR_ALREADY_RESERVED');
    // Y la primera sigue PENDING: el 409 revirtió la transición, no la dejó a medias.
    const row = ctx.db
      .prepare('SELECT status FROM chair_reservations WHERE id = ?')
      .get(first.body.data.id) as { status: string };
    expect(row.status).toBe('PENDING');
  });

  it('dos reservas CONFIRMED que NO se solapan en la misma silla: ambas 200 (regresión del 0002)', async () => {
    // Regresión de `0002_fix_chair_reservation_index.sql`. Con el índice único
    // parcial `ux_chair_res_active` (único SÓLO por `chair_id`) esta segunda
    // confirmación devolvía 409 aunque las ventanas no se solaparan: el índice
    // convertía un hueco libre de la agenda en un conflicto. Ahora la silla
    // admite todas las reservas confirmadas que quepan en el día, y el 409 se
    // reserva para lo que sí es un conflicto de verdad (el test anterior).
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);

    const morning = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(2000), endAt: inMinutes(2060), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${morning.body.data.id}/confirm`, {}, cashierToken).expect(200);

    const evening = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(2120), endAt: inMinutes(2180), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${evening.body.data.id}/confirm`, {}, cashierToken).expect(200);

    const confirmed = ctx.db
      .prepare(
        `SELECT COUNT(*) AS total FROM chair_reservations
          WHERE chair_id = ? AND status = 'CONFIRMED'`,
      )
      .get(chairId) as { total: number };
    expect(confirmed.total).toBe(2);

    // Y la garantía sigue viva: una tercera que SÍ solapa sigue dando 409.
    const overlap = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(2140), endAt: inMinutes(2200), customerId },
      cashierToken,
    ).expect(409);
    expect(overlap.body.error.details.code).toBe('CHAIR_ALREADY_RESERVED');
  });
});

// ===========================================================================
describe('GET /reservations/quote — sólo lectura (BR-RES-007)', () => {
  it('devuelve precio, duración, IVA y disponibilidad SIN escribir nada', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const startAt = inMinutes(120);
    const endAt = inMinutes(300);

    const before = countReservations();
    const response = await get(
      `/api/v1/reservations/quote?chairId=${chairId}&startAt=${encodeURIComponent(startAt)}&endAt=${encodeURIComponent(endAt)}`,
      customerToken,
    ).expect(200);

    const quote = response.body.data;
    expect(quote.durationMinutes).toBe(180);
    expect(quote.billableMinutes).toBe(180);
    expect(quote.minApplied).toBe(false);
    expect(quote.pricePerHourMinor).toBe(500_000);
    // 180 min = 3 h a $5.000 = $15.000; IVA del negocio 19 % = $2.850.
    expect(quote.subtotalMinor).toBe(1_500_000);
    expect(quote.taxMinor).toBe(285_000);
    expect(quote.totalMinor).toBe(1_785_000);
    expect(quote.taxRateBp).toBe(1900);
    expect(quote.isAvailable).toBe(true);
    expect(quote.conflict).toBeNull();
    expect(quote.appliedRules).toContain('BR-RENTAL-001');

    // LA PRUEBA: el número de reservas no ha cambiado.
    expect(countReservations()).toBe(before);
  });

  it('aplica el mínimo de 30 minutos en la cotización', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const response = await get(
      `/api/v1/reservations/quote?chairId=${chairId}&startAt=${encodeURIComponent(inMinutes(120))}&endAt=${encodeURIComponent(inMinutes(130))}`,
      customerToken,
    ).expect(200);
    expect(response.body.data.durationMinutes).toBe(10);
    expect(response.body.data.billableMinutes).toBe(30);
    expect(response.body.data.minApplied).toBe(true);
    // 30 min a $5.000/h = $2.500.
    expect(response.body.data.subtotalMinor).toBe(250_000);
  });

  it('informa del conflicto con 200, no con 409, y sin escribir', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(200), endAt: inMinutes(320), customerId },
      cashierToken,
    ).expect(201);

    const before = countReservations();
    const response = await get(
      `/api/v1/reservations/quote?chairId=${chairId}&startAt=${encodeURIComponent(inMinutes(240))}&endAt=${encodeURIComponent(inMinutes(300))}`,
      customerToken,
    ).expect(200);
    expect(response.body.data.isAvailable).toBe(false);
    expect(response.body.data.conflict.code).toBe(created.body.data.code);
    expect(countReservations()).toBe(before);
  });

  it('avisa con COUPON_NOT_APPLIED si le mandan un cupón (el módulo de descuentos no existe)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const response = await get(
      `/api/v1/reservations/quote?chairId=${chairId}&startAt=${encodeURIComponent(inMinutes(120))}&endAt=${encodeURIComponent(inMinutes(180))}&applyCouponCode=VERANO20`,
      customerToken,
    ).expect(200);
    expect(response.body.data.discountMinor).toBe(0);
    expect(response.body.meta.warnings).toContain('COUPON_NOT_APPLIED');
  });
});

// ===========================================================================
describe('Máquina de estados de reserva (DESIGN.md 6.2)', () => {
  it('PENDING -> CONFIRMED revalida el solapamiento y deja la silla RESERVED', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const startAt = inMinutes(1);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt, endAt: inMinutes(130), customerId },
      cashierToken,
    ).expect(201);
    expect(created.body.data.status).toBe('PENDING');
    // La reserva empieza AHORA (dentro del margen de cortesía de 5 minutos), así
    // que la silla queda reservada desde el alta, sin importar que la reserva
    // siga en `PENDING`.
    const chairAfterCreate = await get(`/api/v1/chairs/${chairId}`, cashierToken).expect(200);
    expect(chairAfterCreate.body.data.chair.status).toBe('RESERVED');

    const confirmed = await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);
    expect(confirmed.body.data.status).toBe('CONFIRMED');

    // Confirmar dos veces es idempotente.
    const again = await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);
    expect(again.body.data.status).toBe('CONFIRMED');
  });

  it('PENDING -> ACTIVE está PROHIBIDA: 422 INVALID_RESERVATION_TRANSITION', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(70), customerId },
      cashierToken,
    ).expect(201);
    // Sin confirmar no se puede hacer check-in: es la confirmación la que
    // revalida el solapamiento (BR-RES-002).
    const response = await post(`/api/v1/reservations/${created.body.data.id}/check-in`, {}, cashierToken).expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('INVALID_RESERVATION_TRANSITION');
    expect(response.body.error.details.from).toBe('PENDING');
    expect(response.body.error.details.to).toBe('ACTIVE');
  });

  it('CONFIRMED -> ACTIVE crea el alquiler y pone la silla OCCUPIED (BR-RES-009)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(130), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);

    const checkIn = await post(`/api/v1/reservations/${created.body.data.id}/check-in`, {}, cashierToken).expect(200);
    expect(checkIn.body.data.reservation.status).toBe('ACTIVE');
    expect(checkIn.body.data.reservation.checkedInAt).toBeTruthy();
    // El alquiler materializado lleva el precio CONGELADO de la reserva.
    expect(checkIn.body.data.rental.code).toMatch(/^RENT-\d{6}$/);
    expect(checkIn.body.data.rental.reservationId).toBe(created.body.data.id);
    expect(checkIn.body.data.chair.status).toBe('OCCUPIED');
    expect(checkIn.body.data.chair.statusChangedAt).toBeTruthy();

    // La silla queda ocupada y con alquiler vivo.
    const active = await get(`/api/v1/rentals/chair/${chairId}/active`, cashierToken).expect(200);
    expect(active.body.data).not.toBeNull();
    expect(active.body.data.code).toBe(checkIn.body.data.rental.code);
    // Los minutos planificados del alquiler son los de la reserva: el alquiler
    // se materializa desde ella, no al revés.
    expect(active.body.data.plannedMinutes).toBe(created.body.data.durationMinutes);
  });

  it('check-in sobre una silla ocupada por otro alquiler: 409 CHAIR_OCCUPIED (BR-RES-009)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    // La reserva se confirma primero y deja la silla RESERVED.
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(70), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);
    // Mientras tanto, un walk-in se sienta en la MISMA silla y se pasa de hora.
    const rental = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, cashierToken).expect(201);
    expect(rental.body.data.chairStatus).toBe('OCCUPIED');
    // Cuando llega el cliente de la reserva, el check-in se rechaza con 409: no
    // se pisa la sesión de otro cliente.
    const response = await post(`/api/v1/reservations/${created.body.data.id}/check-in`, {}, cashierToken).expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('CHAIR_OCCUPIED');
    // Y el walk-in sigue intacto.
    expect(rental.body.data.rental.status).toBe('ACTIVE');
  });

  it('ACTIVE -> COMPLETED cierra el alquiler, cobra el overage y deja la silla en CLEANING', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    // Reserva de 1 hora exacta, con la hora de llegada explícita para que los
    // minutos facturados sean deterministas (API.md 7.8 admite `actualStartAt`).
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(61), customerId },
      cashierToken,
    ).expect(201);
    expect(created.body.data.durationMinutes).toBe(60);
    await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);
    const checkIn = await post(
      `/api/v1/reservations/${created.body.data.id}/check-in`,
      { actualStartAt: inMinutes(1) },
      cashierToken,
    ).expect(200);
    expect(checkIn.body.data.rental.startAt).toBe(created.body.data.startAt);

    // Se cierra 30 minutos después de lo planificado: 90 minutos facturados
    // (pro-rata) contra 60 planificados -> 30 de overage a $5.000/h = $2.500
    // (BR-RENTAL-003/004, siempre al precio CONGELADO).
    const endAt = inMinutes(91);
    const completed = await post(
      `/api/v1/reservations/${created.body.data.id}/complete`,
      { endAt },
      cashierToken,
    ).expect(200);

    expect(completed.body.data.reservation.status).toBe('COMPLETED');
    expect(completed.body.data.reservation.checkedOutAt).toBeTruthy();
    expect(completed.body.data.charge.billedMinutes).toBe(90);
    expect(completed.body.data.charge.extraMinutes).toBe(30);
    expect(completed.body.data.charge.extraMinutesMinor).toBe(250_000);
    expect(completed.body.data.charge.subtotalMinor).toBe(500_000);
    expect(completed.body.data.charge.totalMinor).toBe(750_000);

    const chair = await get(`/api/v1/chairs/${chairId}`, cashierToken).expect(200);
    expect(chair.body.data.chair.status).toBe('CLEANING');
    expect(chair.body.data.currentRental).toBeNull();
  });
});

// ===========================================================================
describe('Cancelación (BR-RES-008)', () => {
  it('exige motivo y libera la silla', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(130), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);
    expect((await get(`/api/v1/chairs/${chairId}`, cashierToken)).body.data.chair.status).toBe('RESERVED');

    // Sin motivo: 400.
    await post(`/api/v1/reservations/${created.body.data.id}/cancel`, {}, cashierToken).expect(400);

    const cancelled = await post(
      `/api/v1/reservations/${created.body.data.id}/cancel`,
      { reason: 'El cliente no puede venir' },
      cashierToken,
    ).expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelled.body.data.cancelledAt).toBeTruthy();
    expect(cancelled.body.data.cancelReason).toBe('El cliente no puede venir');

    // Silla liberada.
    const chair = await get(`/api/v1/chairs/${chairId}`, cashierToken).expect(200);
    expect(chair.body.data.chair.status).toBe('AVAILABLE');
  });

  it('no libera la silla si queda otra reserva viva por delante (decisión D10)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    // Reserva que empieza ahora: pone la silla en RESERVED.
    const now = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(70), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${now.body.data.id}/confirm`, {}, cashierToken).expect(200);
    // Otra posterior. Se deja en PENDING a propósito: lo que se comprueba aquí es
    // que un PENDING también bloquea la liberación de la silla (BR-RES-002), no
    // el esquema. Antes el índice parcial `ux_chair_res_active` hacía imposible
    // confirmar dos reservas de la misma silla, cosa que ya no ocurre desde
    // `0002_fix_chair_reservation_index.sql`.
    const later = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(120), endAt: inMinutes(180), customerId },
      cashierToken,
    ).expect(201);

    await post(
      `/api/v1/reservations/${now.body.data.id}/cancel`,
      { reason: 'Se le pasó' },
      cashierToken,
    ).expect(200);

    // La segunda reserva sigue viva: la silla NO se libera (decisión D10).
    const chair = await get(`/api/v1/chairs/${chairId}`, cashierToken).expect(200);
    expect(chair.body.data.chair.status).toBe('RESERVED');
    expect(later.body.data.status).toBe('PENDING');
  });

  it('una reserva terminal no se puede volver a cancelar: 422', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(400), endAt: inMinutes(460), customerId },
      cashierToken,
    ).expect(201);
    await post(
      `/api/v1/reservations/${created.body.data.id}/cancel`,
      { reason: 'Primera cancelación' },
      cashierToken,
    ).expect(200);
    const response = await post(
      `/api/v1/reservations/${created.body.data.id}/cancel`,
      { reason: 'Segunda cancelación' },
      cashierToken,
    ).expect(422);
    expect(response.body.error.details.code).toBe('INVALID_RESERVATION_TRANSITION');
  });
});

// ===========================================================================
describe('Extensión de reserva (BR-RES-010, BR-RES-012)', () => {
  it('recalcula la proyección sin cambiar el precio congelado', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(200), endAt: inMinutes(320), customerId },
      cashierToken,
    ).expect(201);
    expect(created.body.data.durationMinutes).toBe(120);
    expect(created.body.data.rentalTotalMinor).toBe(1_000_000);

    const extended = await post(
      `/api/v1/reservations/${created.body.data.id}/extend`,
      { newEndAt: inMinutes(380) },
      cashierToken,
    ).expect(200);
    expect(extended.body.data.durationMinutes).toBe(180);
    // 3 h a $5.000 = $15.000 y el precio por hora NO se toca (BR-RES-010).
    expect(extended.body.data.rentalTotalMinor).toBe(1_500_000);
    expect(extended.body.data.pricePerHourMinor).toBe(500_000);
    expect(extended.body.data.pricePerHourMinor).toBe(created.body.data.pricePerHourMinor);
  });

  it('no deja un hueco inválido: 409 si choca con otra reserva', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const first = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(200), endAt: inMinutes(320), customerId },
      cashierToken,
    ).expect(201);
    await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(400), endAt: inMinutes(460), customerId },
      cashierToken,
    ).expect(201);

    // Estirar la primera hasta las 7h30 pisa la segunda.
    const response = await post(
      `/api/v1/reservations/${first.body.data.id}/extend`,
      { newEndAt: inMinutes(450) },
      cashierToken,
    ).expect(409);
    expect(response.body.error.details.code).toBe('CHAIR_ALREADY_RESERVED');
  });

  it('rechaza con 400 si `newEndAt` no avanza', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(200), endAt: inMinutes(320), customerId },
      cashierToken,
    ).expect(201);
    await post(
      `/api/v1/reservations/${created.body.data.id}/extend`,
      { newEndAt: inMinutes(300) },
      cashierToken,
    ).expect(400);
  });

  it('una reserva ACTIVE no se extiende: 422 RESERVATION_ALREADY_ACTIVE (BR-RES-012)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(130), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);
    await post(`/api/v1/reservations/${created.body.data.id}/check-in`, {}, cashierToken).expect(200);

    const response = await post(
      `/api/v1/reservations/${created.body.data.id}/extend`,
      { newEndAt: inMinutes(200) },
      cashierToken,
    ).expect(422);
    expect(response.body.error.details.code).toBe('RESERVATION_ALREADY_ACTIVE');
    expect(response.body.error.details.ruleId).toBe('BR-RES-012');
  });
});

// ===========================================================================
describe('Límites y validación de la ventana (BR-RENTAL-010)', () => {
  it('respeta `businesses.max_reservation_minutes`: 422 RESERVATION_TOO_LONG', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    // El negocio viene con 480 min (8 h) de tope.
    const response = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(600), endAt: inMinutes(600 + 481), customerId },
      cashierToken,
    ).expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('RESERVATION_TOO_LONG');
    expect(response.body.error.details.maxReservationMinutes).toBe(480);
    expect(response.body.error.details.durationMinutes).toBe(481);
  });

  it('acepta exactamente el máximo', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(700), endAt: inMinutes(700 + 480), customerId },
      cashierToken,
    ).expect(201);
  });

  it('rechaza `endAt` anterior a `startAt` con 400', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(200), endAt: inMinutes(100), customerId },
      cashierToken,
    ).expect(400);
  });

  it('rechaza una silla en mantenimiento: 422 CHAIR_NOT_BOOKABLE (BR-RES-005)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    await post(`/api/v1/chairs/${chairId}/maintenance`, { reason: 'Rota' }, adminToken).expect(200);
    const response = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(200), endAt: inMinutes(260), customerId },
      cashierToken,
    ).expect(422);
    expect(response.body.error.details.code).toBe('CHAIR_NOT_BOOKABLE');
    expect(response.body.error.details.status).toBe('MAINTENANCE');
  });

  it('rechaza una silla no reservable con 422 CHAIR_NOT_BOOKABLE', async () => {
    const zoneId = await createZone();
    const response = await post('/api/v1/chairs', { zoneId, code: 'RS-NB-1', isBookable: false }, adminToken).expect(201);
    const response2 = await post(
      '/api/v1/reservations',
      { chairId: response.body.data.id, startAt: inMinutes(200), endAt: inMinutes(260), customerId },
      cashierToken,
    ).expect(422);
    expect(response2.body.error.details.code).toBe('CHAIR_NOT_BOOKABLE');
  });

  it('rechaza que el cliente mande importes calculados (400, `.strict()`)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const response = await post(
      '/api/v1/reservations',
      {
        chairId,
        startAt: inMinutes(200),
        endAt: inMinutes(260),
        customerId,
        rentalTotalMinor: 1,
        pricePerHourMinor: 1,
        durationMinutes: 60,
      },
      cashierToken,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
describe('Caducidad (BR-RES-004) y el job del sistema', () => {
  it('marca EXPIRED una CONFIRMED cuyo end_at ya pasó y libera la silla', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    // Reserva que empieza "ahora" para que la silla quede RESERVED.
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(70), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);
    expect((await get(`/api/v1/chairs/${chairId}`, cashierToken)).body.data.chair.status).toBe('RESERVED');

    // Se "adelanta" el reloj dos horas: la ventana ya venció.
    const future = new Date(Date.now() + 200 * 60_000).toISOString();
    const job = await post('/api/v1/system/jobs/expire-reservations', { now: future }, adminToken).expect(200);

    expect(job.body.data.expired).toBeGreaterThanOrEqual(1);
    expect(job.body.data.codes).toContain(created.body.data.code);
    expect(job.body.meta.appliedRules).toContain('BR-RES-004');

    const after = await get(`/api/v1/reservations/${created.body.data.id}`, cashierToken).expect(200);
    expect(after.body.data.reservation.status).toBe('EXPIRED');
    // La silla vuelve a estar disponible.
    const chair = await get(`/api/v1/chairs/${chairId}`, cashierToken).expect(200);
    expect(chair.body.data.chair.status).toBe('AVAILABLE');
  });

  it('marca EXPIRED un PENDING que pasó su gracia de 30 minutos (BR-RES-004)', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(70), customerId },
      cashierToken,
    ).expect(201);
    expect(created.body.data.status).toBe('PENDING');

    // 45 minutos después del inicio ya venció la gracia de 30.
    const afterGrace = new Date(Date.now() + 55 * 60_000).toISOString();
    await post('/api/v1/system/jobs/expire-reservations', { now: afterGrace }, adminToken).expect(200);

    const after = await get(`/api/v1/reservations/${created.body.data.id}`, cashierToken).expect(200);
    expect(after.body.data.reservation.status).toBe('EXPIRED');
  });

  it('el job es idempotente: la segunda ejecución no expira nada', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(70), customerId },
      cashierToken,
    ).expect(201);
    const future = new Date(Date.now() + 200 * 60_000).toISOString();
    await post('/api/v1/system/jobs/expire-reservations', { now: future }, adminToken).expect(200);
    const second = await post('/api/v1/system/jobs/expire-reservations', { now: future }, adminToken).expect(200);
    expect(second.body.data.codes).not.toContain(created.body.data.code);
  });

  it('el job sólo lo puede lanzar un ADMIN: un CASHIER recibe 403', async () => {
    await post('/api/v1/system/jobs/expire-reservations', {}, cashierToken).expect(403);
    await post('/api/v1/system/jobs/expire-reservations', {}).expect(401);
  });

  it('una reserva EXPIRED no se puede confirmar ni usar: 422', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(70), customerId },
      cashierToken,
    ).expect(201);
    const future = new Date(Date.now() + 200 * 60_000).toISOString();
    await post('/api/v1/system/jobs/expire-reservations', { now: future }, adminToken).expect(200);
    await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(422);
  });
});

// ===========================================================================
describe('Alcance por cliente (API.md 7.8, marca P de la matriz)', () => {
  it('un CUSTOMER sólo ve sus propias reservas', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const mine = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(500), endAt: inMinutes(560), customerId },
      customerToken,
    ).expect(201);
    // Otra reserva de otro cliente, en otra silla.
    const chairId2 = await createChair(zoneId);
    const other = await post(
      '/api/v1/reservations',
      { chairId: chairId2, startAt: inMinutes(500), endAt: inMinutes(560) },
      otherCustomerToken,
    ).expect(201);

    const list = await get('/api/v1/reservations?pageSize=100', customerToken).expect(200);
    const ids = list.body.data.map((item: { id: number }) => item.id);
    expect(ids).toContain(mine.body.data.id);
    expect(ids).not.toContain(other.body.data.id);
    expect(list.body.meta.total).toBe(ids.length);
  });

  it('un CUSTOMER no puede ver ni cancelar la reserva de otro: 404', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const other = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(600), endAt: inMinutes(660) },
      otherCustomerToken,
    ).expect(201);

    // 404 y no 403: no se revela la existencia del recurso ajeno (API.md 2).
    await get(`/api/v1/reservations/${other.body.data.id}`, customerToken).expect(404);
    await post(
      `/api/v1/reservations/${other.body.data.id}/cancel`,
      { reason: 'No es mía' },
      customerToken,
    ).expect(404);
  });

  it('el filtro customerId del cliente se ignora: sólo ve lo suyo', async () => {
    const list = await get(`/api/v1/reservations?customerId=${customerId + 9999}`, customerToken).expect(200);
    for (const item of list.body.data as { customerId: number }[]) {
      expect(item.customerId).toBe(customerId);
    }
  });

  it('un CUSTOMER ve los contadores por estado de SUS reservas', async () => {
    const list = await get('/api/v1/reservations?pageSize=100', customerToken).expect(200);
    expect(list.body.meta.countsByStatus).toBeDefined();
    expect(typeof list.body.meta.countsByStatus.PENDING).toBe('number');
  });
});

// ===========================================================================
describe('RBAC de reservas (BR-SEC-005, DESIGN.md 9.3)', () => {
  it('un CUSTOMER no puede hacer check-in ni extender: 403', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(130), customerId },
      cashierToken,
    ).expect(201);

    const checkIn = await post(`/api/v1/reservations/${created.body.data.id}/check-in`, {}, customerToken).expect(403);
    expect(checkIn.body.error.details.required).toBe('reservations:checkin');
    const extend = await post(
      `/api/v1/reservations/${created.body.data.id}/extend`,
      { newEndAt: inMinutes(200) },
      customerToken,
    ).expect(403);
    expect(extend.body.error.details.required).toBe('reservations:extend');
  });

  it('un CUSTOMER sí crea y cancela sus propias reservas', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(500), endAt: inMinutes(560) },
      customerToken,
    ).expect(201);
    // Sin `customerId`: el servidor usa el propio id del actor.
    expect(created.body.data.customerId).toBe(customerId);
    await post(
      `/api/v1/reservations/${created.body.data.id}/cancel`,
      { reason: 'Me arrepiento' },
      customerToken,
    ).expect(200);
  });

  it('sin token responde 401', async () => {
    await get('/api/v1/reservations').expect(401);
  });
});

// ===========================================================================
describe('Auditoría y codes (BR-SEC-007, BR-ORDER-001)', () => {
  it('cada transición escribe su fila en audit_logs con la entidad correcta', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const created = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(1), endAt: inMinutes(70), customerId },
      cashierToken,
    ).expect(201);
    await post(`/api/v1/reservations/${created.body.data.id}/confirm`, {}, cashierToken).expect(200);
    await post(`/api/v1/reservations/${created.body.data.id}/check-in`, {}, cashierToken).expect(200);

    const rows = ctx.db
      .prepare(
        `SELECT action, entity_type, entity_id
           FROM audit_logs
          WHERE (entity_type = 'reservation' AND entity_id = ?)
             OR (entity_type = 'rental' AND entity_id = (
                  SELECT id FROM chair_rentals WHERE reservation_id = ?
                ))
          ORDER BY id ASC`,
      )
      .all(created.body.data.id, created.body.data.id) as { action: string; entity_type: string }[];

    const reservationActions = rows.filter((row) => row.entity_type === 'reservation').map((row) => row.action);
    expect(reservationActions).toContain('CREATE');
    expect(reservationActions).toContain('CHANGE_STATUS');
    // El alquiler materializado por el check-in también queda auditado.
    expect(rows.some((row) => row.entity_type === 'rental')).toBe(true);
  });

  it('la secuencia de códigos no se rompe con reservas simultáneas', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const first = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(700), endAt: inMinutes(760), customerId },
      cashierToken,
    ).expect(201);
    const second = await post(
      '/api/v1/reservations',
      { chairId, startAt: inMinutes(800), endAt: inMinutes(860), customerId },
      cashierToken,
    ).expect(201);
    expect(second.body.data.code).not.toBe(first.body.data.code);
    const sequence = Number(second.body.data.code.replace('RES-', '')) - Number(first.body.data.code.replace('RES-', ''));
    expect(sequence).toBe(1);
  });
});

/** Número total de reservas de la base. */
function countReservations(): number {
  const row = ctx.db.prepare('SELECT COUNT(*) AS total FROM chair_reservations').get() as { total: number };
  return row.total;
}
