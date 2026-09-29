/**
 * REGRESIÓN DE AUTORIZACIÓN (IDOR) — reservas.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EXISTE ESTE FICHERO
 * ---------------------------------------------------------------------------
 * Estas pruebas fijan dos agujeros que la suite existente NO cubría, porque
 * todos los tests anteriores de alcance por cliente usaban un `customerId`
 * que era el del propio actor, o lo omitían. Ninguno usaba el de OTRO cliente.
 *
 * 1. `POST /reservations` con `customerId` de OTRO usuario.
 *    `ReservationsService.resolveCustomerId` devolvía `input.customerId` tal
 *    cual en cuanto no era `null`, sin comprobar el rol del actor. Un CUSTOMER
 *    podía crear una reserva a nombre de un tercero (y también una reserva
 *    "de mostrador" con `customerId: null`, que se queda sin dueño y le roba
 *    la silla al resto del día).
 *    Impacto: atribución fraudulenta y denegación de servicio sobre el
 *    inventario de sillas, porque la reserva creada bloquea la silla y el
 *    atacante ya no puede ni verla para cancelarla.
 *
 * 2. Reservas de mostrador (`customer_id IS NULL`).
 *    `assertCanAccess` devolvía `ok` en cuanto `row.customer_id === null`, así
 *    que CUALQUIER cliente autenticado podía leer, confirmar y cancelar
 *    reservas de mostrador que no eran suyas.
 *    Impacto: lectura de datos de otros (IDOR) y manipulación de reservas
 *    ajenas con `reservations:cancel`, que el CUSTOMER tiene con marca `P`.
 *
 * La regla que ambas correcciones hacen cumplir es la de API.md 2 / DESIGN.md
 * 9.3: "el id de usuario sale SIEMPRE del token". El `customerId` del cuerpo
 * sólo lo honra el personal de mostrador; para un `CUSTOMER` se fuerza al suyo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { seedSpacesDemo } from '../src/database/seeds/spaces-demo.seed.js';

let ctx: TestContext;
let adminToken: string;
let customerToken: string;
let customerId: number;
let otherCustomerId: number;
let locationId: number;
let zoneCounter = 0;
let chairCounter = 0;

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
  adminToken = await ctx.accessTokenFor('ADMIN');
  const primary = await registerCustomer('idor-a');
  customerToken = primary.token;
  customerId = primary.id;
  const secondary = await registerCustomer('idor-b');
  otherCustomerId = secondary.id;
  locationId = seedSpacesDemo().locationId;
});

afterAll(() => {
  ctx.close();
});

/** Instantes derivados de una única base, para que el redondeo sea estable. */
const BASE = Date.now();
function inMinutes(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

async function createZone(): Promise<number> {
  zoneCounter += 1;
  const response = await ctx
    .post('/api/v1/zones', { locationId, name: `Zona IDOR ${zoneCounter}` }, adminToken)
    .expect(201);
  return Number(response.body.data.id);
}

async function createChair(zoneId: number): Promise<number> {
  chairCounter += 1;
  const response = await ctx
    .post(
      '/api/v1/chairs',
      { zoneId, code: `IDOR-${chairCounter}`, name: `Silla IDOR ${chairCounter}`, pricePerHourMinor: 100_000 },
      adminToken,
    )
    .expect(201);
  return Number(response.body.data.id);
}

// ===========================================================================
describe('Regresión 1: un CUSTOMER no crea reservas a nombre de otro', () => {
  it('fuerza el customerId del token aunque el cuerpo traiga el de otro', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);

    const response = await ctx
      .post(
        '/api/v1/reservations',
        {
          chairId,
          startAt: inMinutes(700),
          endAt: inMinutes(760),
          // Id del SEGUNDO cliente, no el del actor.
          customerId: otherCustomerId,
        },
        customerToken,
      )
      .expect(201);

    // El alcance lo decide el servidor: la reserva es del actor.
    expect(response.body.data.customerId).toBe(customerId);
    expect(response.body.data.customerId).not.toBe(otherCustomerId);
  });

  it('no deja crear una reserva de mostrador (customerId: null) como CUSTOMER', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);

    // Sin `customerId` el servidor ya usaba el del actor. Lo que se comprueba aquí
    // es el `null` EXPLÍCITO, que es la vía para crear una reserva sin dueño.
    const response = await ctx
      .post(
        '/api/v1/reservations',
        { chairId, startAt: inMinutes(800), endAt: inMinutes(860), customerId: null },
        customerToken,
      )
      .expect(201);

    expect(response.body.data.customerId).toBe(customerId);
  });

  it('el personal de mostrador SÍ puede crear una reserva sin cliente', async () => {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);

    // El `null` legítimo: un CAJERO registra la reserva de alguien que no tiene
    // cuenta. Este camino debe seguir funcionando, así que la corrección del
    // punto 1 tiene que haberlo respetado.
    const cashierToken = await ctx.accessTokenFor('CASHIER');
    const response = await ctx
      .post(
        '/api/v1/reservations',
        { chairId, startAt: inMinutes(900), endAt: inMinutes(960), customerId: null },
        cashierToken,
      )
      .expect(201);

    expect(response.body.data.customerId).toBeNull();
  });
});

// ===========================================================================
describe('Regresión 2: una reserva de mostrador no es de cualquier cliente', () => {
  /** Crea en mostrador una reserva sin `customer_id` y devuelve su id. */
  async function createWalkInReservation(slotStart: number): Promise<number> {
    const zoneId = await createZone();
    const chairId = await createChair(zoneId);
    const cashierToken = await ctx.accessTokenFor('CASHIER');
    const response = await ctx
      .post(
        '/api/v1/reservations',
        { chairId, startAt: inMinutes(slotStart), endAt: inMinutes(slotStart + 60), customerId: null },
        cashierToken,
      )
      .expect(201);
    expect(response.body.data.customerId).toBeNull();
    return Number(response.body.data.id);
  }

  it('un CUSTOMER no puede LEER una reserva de mostrador ajena: 404', async () => {
    const id = await createWalkInReservation(1000);
    // 404 y no 403: no se revela la existencia del recurso de otro (API.md 2).
    await ctx.get(`/api/v1/reservations/${id}`, customerToken).expect(404);
  });

  it('un CUSTOMER no puede CANCELAR una reserva de mostrador ajena: 404', async () => {
    const id = await createWalkInReservation(1100);
    await ctx
      .post(`/api/v1/reservations/${id}/cancel`, { reason: 'No es mía' }, customerToken)
      .expect(404);
    // Y la reserva sigue viva: el 404 tiene que venir ANTES de mutar nada.
    const cashierToken = await ctx.accessTokenFor('CASHIER');
    const after = await ctx.get(`/api/v1/reservations/${id}`, cashierToken).expect(200);
    expect(after.body.data.status).not.toBe('CANCELLED');
  });

  it('un CUSTOMER no puede CONFIRMAR una reserva de mostrador ajena: 404', async () => {
    const id = await createWalkInReservation(1200);
    await ctx.post(`/api/v1/reservations/${id}/confirm`, {}, customerToken).expect(404);
  });

  it('una reserva de mostrador NO aparece en el listado de un cliente', async () => {
    const id = await createWalkInReservation(1300);
    const list = await ctx.get('/api/v1/reservations?pageSize=100', customerToken).expect(200);
    const ids = (list.body.data as { id: number }[]).map((item) => item.id);
    expect(ids).not.toContain(id);
  });
});
