/**
 * Pruebas de zonas y sillas: CRUD, mapa visual, máquina de estados de silla,
 * disponibilidad, historial y RBAC.
 *
 * Cada prueba cita la regla que verifica. El harness compartido
 * (`helpers/harness.ts`) levanta la aplicación COMPLETA contra una base SQLite en
 * memoria; lo único que hace esta suite además es MONTAR LOS TRES ROUTERS de la
 * familia de espacios, porque `modules/index.ts` los cablea el agente de
 * integración y esta suite no puede depender de ese momento (ver la nota de
 * `buildTestApp`).
 *
 * No hay stubs ni dobles: si un test pasa, la ruta real, el service real y el SQL
 * real funcionan.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { API_PREFIX } from '../src/config/index.js';
import { createApiV1Router } from '../src/modules/index.js';
import { zonesRouter, chairsRouter } from '../src/modules/spaces/spaces.routes.js';
import { reservationsRouter } from '../src/modules/reservations/reservations.routes.js';
import { rentalsRouter } from '../src/modules/rentals/rentals.routes.js';
import { getSpacesService } from '../src/modules/spaces/spaces.provider.js';
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
import type { Role as RoleValue } from '../src/shared/domain/index.js';

let ctx: TestContext;
let agent: TestAgent;
let adminToken: string;
let cashierToken: string;
let customerToken: string;
let customerId: number;
let locationId: number;

/**
 * App de pruebas con los routers de la familia de espacios montados.
 *
 * `modules/index.ts` es el punto de extensión oficial y lo edita el agente de
 * integración, así que esta suite monta sus routers sobre el `createApiV1Router()`
 * que ya exporta. Es EXACTAMENTE lo mismo que hará el integrador (tres entradas
 * más en `MODULE_ROUTERS`) pero sin escribir en un fichero que no le pertenece.
 * Cuando el integrador haya montado los routers, estas pruebas siguen siendo
 * válidas sin cambios: la app completa ya los incluye.
 */
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

/**
 * Peticiones con `Authorization: Bearer`, con la misma firma que los atajos del
 * harness (`ctx.get(path, token)`) pero sobre la app que monta estos routers.
 */
function get(path: string, token?: string): request.Test {
  return token === undefined ? agent.get(path) : agent.get(path).set('Authorization', `Bearer ${token}`);
}
function post(path: string, body: object | string, token?: string): request.Test {
  return (token === undefined ? agent.post(path) : agent.post(path).set('Authorization', `Bearer ${token}`)).send(body);
}
function patch(path: string, body: object | string, token?: string): request.Test {
  return (token === undefined ? agent.patch(path) : agent.patch(path).set('Authorization', `Bearer ${token}`)).send(body);
}
function del(path: string, body: object | string, token?: string): request.Test {
  return (token === undefined ? agent.delete(path) : agent.delete(path).set('Authorization', `Bearer ${token}`)).send(body);
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeSpacesTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');
  // La semilla de despliegue no trae cuenta CUSTOMER (ver harness): se registra.
  const email = ctx.uniqueEmail('espacios-cliente');
  const registered = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente Espacios' })
    .expect(201);
  customerToken = String(registered.body.data.accessToken);
  customerId = Number(registered.body.data.user.id);
  // Sede + zonas + sillas de demostración (idempotente).
  locationId = seedSpacesDemo().locationId;
});

afterAll(() => {
  ctx.close();
});

/**
 * Instante ISO a `minutes` minutos desde `base` (por defecto, ahora).
 *
 * `base` es un parámetro a propósito: derivar los tres extremos de la prueba
 * de tres llamadas a `Date.now()` distintas hace que el rango mida 120 minutos
 * y unos pocos MILISEGUNDOS de más, y la rejilla de 30 minutos genera entonces
 * una quinta celda de 1 ms. El test pasaba en local y fallaba con la suite
 * entera en paralelo, por el tiempo que tardan las llamadas en intercalarse. Con
 * un único `base` el rango mide exactamente lo que dice medir.
 */
function inMinutes(minutes: number, base: number = Date.now()): string {
  return new Date(base + minutes * 60_000).toISOString();
}

/**
 * Crea una zona con nombre ÚNICO (sufijo contador) y devuelve su id.
 *
 * El sufijo existe porque `zones` tiene `UNIQUE (business_id, location_id, name)`
 * y la base es compartida por toda la suite: sin él, dos tests que pidan una zona
 * "Zona de prueba" chocarían y el fallo aparecería en el test equivocado.
 */
let zoneSequence = 0;
async function createZone(name: string, code?: string): Promise<number> {
  zoneSequence += 1;
  return createZoneWithName(`${name}-${zoneSequence}`, code);
}

/** Crea una zona con el nombre EXACTO, para probar las unicidades. */
async function createZoneWithName(name: string, code?: string): Promise<number> {
  const response = await post(
    '/api/v1/zones',
    { locationId, name, colorHex: '#123456', ...(code === undefined ? {} : { code }) },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

/** Crea una silla y devuelve el id. */
async function createChair(
  zoneId: number,
  code: string,
  extra: Record<string, unknown> = {},
): Promise<number> {
  const response = await post('/api/v1/chairs', { zoneId, code, ...extra }, adminToken)
    .expect(201);
  return Number(response.body.data.id);
}

describe('CRUD de zonas (API.md 7.6)', () => {
  it('crea una zona con 201, sort_order calculado y capacity derivada a 0', async () => {
    const response = await post('/api/v1/zones', { locationId, name: 'Zona de prueba', colorHex: '#AABBCC' }, adminToken)
      .expect(201);

    const zone = response.body.data;
    expect(zone.name).toBe('Zona de prueba');
    expect(zone.colorHex).toBe('#AABBCC');
    // Sin sillas todavía, la capacidad derivada es 0 (BR-CHAIR-005), no la que
    // sugeriría un cliente que la envíe.
    expect(zone.capacity).toBe(0);
    expect(zone.chairCount).toBe(0);
    expect(zone.availableCount).toBe(0);
    expect(zone.isActive).toBe(true);
    expect(zone.sortOrder).toBeGreaterThan(0);
    // La respuesta trae los seis contadores, no sólo los que hay (BR-CHAIR-006).
    expect(Object.keys(zone.countsByStatus).sort()).toEqual([
      'AVAILABLE',
      'BLOCKED',
      'CLEANING',
      'MAINTENANCE',
      'OCCUPIED',
      'RESERVED',
    ]);
  });

  it('avisa con CAPACITY_IS_DERIVED si el cliente envía capacity', async () => {
    const response = await post('/api/v1/zones', { locationId, name: 'Zona con capacity', capacity: 40 }, adminToken)
      .expect(201);
    expect(response.body.meta.warnings).toContain('CAPACITY_IS_DERIVED');
    expect(response.body.data.capacity).toBe(0);
  });

  it('rechaza con 409 ZONE_NAME_TAKEN el nombre duplicado en la misma sede', async () => {
    const zoneId = await createZoneWithName('Zona duplicable');
    const response = await post('/api/v1/zones', { locationId, name: 'Zona duplicable' }, adminToken)
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('ZONE_NAME_TAKEN');

    await del(`/api/v1/zones/${zoneId}`, {}, adminToken).expect(200);
  });

  it('rechaza con 404 una sede inexistente', async () => {
    const response = await post('/api/v1/zones', { locationId: 999_999, name: 'Sin sede' }, adminToken)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
  });

  it('lista paginado y trae chairCount/availableCount por zona', async () => {
    const zoneId = await createZone('Zona con sillas');
    await createChair(zoneId, 'ZZ-01');
    await createChair(zoneId, 'ZZ-02');

    const response = await get(`/api/v1/zones?locationId=${locationId}`, adminToken).expect(200);
    expect(response.body.success).toBe(true);
    expect(response.body.meta.total).toBeGreaterThanOrEqual(3);
    const zone = response.body.data.find((item: { id: number }) => item.id === zoneId);
    expect(zone.chairCount).toBe(2);
    expect(zone.availableCount).toBe(2);
    expect(zone.countsByStatus.AVAILABLE).toBe(2);

    await del(`/api/v1/chairs/${await chairIdOf('ZZ-01')}`, { reason: 'fin de test' }, adminToken);
    await del(`/api/v1/chairs/${await chairIdOf('ZZ-02')}`, { reason: 'fin de test' }, adminToken);
    await del(`/api/v1/zones/${zoneId}`, {}, adminToken).expect(200);
  });

  it('reordena zonas parcialmente dentro de una transacción', async () => {
    const zoneId = await createZone('Zona reordenable');
    const response = await post('/api/v1/zones/reorder', { locationId, items: [{ id: zoneId, sortOrder: 99 }] }, adminToken)
      .expect(200);
    const zone = response.body.data.find((item: { id: number }) => item.id === zoneId);
    expect(zone.sortOrder).toBe(99);
    await del(`/api/v1/zones/${zoneId}`, {}, adminToken).expect(200);
  });

  it('rechaza el reorder con 400 si una zona es de otra sede (ZONE_LOCATION_MISMATCH)', async () => {
    const zoneId = await createZone('Zona de otra sede');
    const response = await post('/api/v1/zones/reorder', { locationId: 999_999, items: [{ id: zoneId, sortOrder: 1 }] }, adminToken)
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
    await del(`/api/v1/zones/${zoneId}`, {}, adminToken).expect(200);
  });

  it('no borra una zona con sillas: 422 ZONE_NOT_EMPTY con el conteo', async () => {
    const zoneId = await createZone('Zona ocupada');
    await createChair(zoneId, 'ZO-01');
    const response = await del(`/api/v1/zones/${zoneId}`, {}, adminToken).expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('ZONE_NOT_EMPTY');
    expect(response.body.error.details.chairCount).toBe(1);
  });
});

describe('CRUD de sillas (API.md 7.7)', () => {
  it('crea con status AVAILABLE y hereda el precio por defecto del negocio (BR-CHAIR-002)', async () => {
    const zoneId = await createZone('Zona de sillas nueva');
    const response = await post('/api/v1/chairs', { zoneId, code: 'SN-01', kind: 'TABLE', capacity: 4 }, adminToken)
      .expect(201);

    const chair = response.body.data;
    expect(chair.status).toBe('AVAILABLE');
    // `businesses.chair_default_price_minor` = 500000 = $5.000/h.
    expect(chair.pricePerHourMinor).toBe(500_000);
    expect(chair.kind).toBe('TABLE');
    expect(chair.capacity).toBe(4);
    expect(chair.isBookable).toBe(true);
    expect(chair.features).toEqual([]);

    // Y la capacidad de la zona se recalculó a 4 (BR-CHAIR-005).
    const zone = await get(`/api/v1/zones/${zoneId}`, adminToken).expect(200);
    expect(zone.body.data.zone.capacity).toBe(4);
    expect(zone.body.data.chairs).toHaveLength(1);
  });

  it('rechaza un código duplicado con 409 CHAIR_CODE_TAKEN', async () => {
    const zoneId = await createZone('Zona de duplicados');
    await createChair(zoneId, 'SD-01');
    const response = await post('/api/v1/chairs', { zoneId, code: 'SD-01' }, adminToken)
      .expect(409);
    expect(response.body.error.details.code).toBe('CHAIR_CODE_TAKEN');
  });

  it('rechaza con 400 un status en el POST: una silla nace AVAILABLE', async () => {
    const zoneId = await createZone('Zona de estados');
    const response = await post('/api/v1/chairs', { zoneId, code: 'SE-01', status: 'OCCUPIED' }, adminToken)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('avisa PRICE_CHANGE_AFFECTS_ONLY_NEW al cambiar el precio (BR-PRICE-010)', async () => {
    const zoneId = await createZone('Zona de precios');
    const chairId = await createChair(zoneId, 'SP-01');
    const response = await patch(`/api/v1/chairs/${chairId}`, { pricePerHourMinor: 800_000 }, adminToken)
      .expect(200);
    expect(response.body.meta.warnings).toContain('PRICE_CHANGE_AFFECTS_ONLY_NEW');
    expect(response.body.data.pricePerHourMinor).toBe(800_000);
  });

  it('rechaza editar `status` por PATCH con 422 FIELD_NOT_EDITABLE (BR-CHAIR-003)', async () => {
    const zoneId = await createZone('Zona de patch');
    const chairId = await createChair(zoneId, 'SPC-01');
    const response = await patch(`/api/v1/chairs/${chairId}`, { status: 'BLOCKED' }, adminToken)
      .expect(422);
    expect(response.body.error.details.code).toBe('FIELD_NOT_EDITABLE');
  });
});

describe('Máquina de estados de silla (DESIGN.md 6.4, BR-CHAIR-003)', () => {
  it('AVAILABLE -> OCCUPIED es válida: la abre un alquiler walk-in', async () => {
    const zoneId = await createZone('Zona del check-in válido');
    const chairId = await createChair(zoneId, 'SV-01');

    const rental = await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, adminToken)
      .expect(201);
    expect(rental.body.data.chairStatus).toBe('OCCUPIED');

    const chair = await get(`/api/v1/chairs/${chairId}`, adminToken).expect(200);
    expect(chair.body.data.chair.status).toBe('OCCUPIED');
    // `status_changed_at` se actualizó: es la base del reporte "ocupada desde hace".
    expect(chair.body.data.chair.statusChangedAt).toBeTruthy();
  });

  it('PATCH /chairs/:id/status NO puede fijar OCCUPIED: 422 INVALID_CHAIR_STATUS_TRANSITION', async () => {
    const zoneId = await createZone('Zona de transición inválida');
    const chairId = await createChair(zoneId, 'SV-02');
    const response = await patch(`/api/v1/chairs/${chairId}/status`, { status: 'OCCUPIED' }, adminToken)
      .expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('INVALID_CHAIR_STATUS_TRANSITION');
    expect(response.body.error.details.ruleId).toBe('BR-CHAIR-003');
  });

  it('MAINTENANCE -> OCCUPIED está PROHIBIDA incluso por el camino del sistema', async () => {
    const zoneId = await createZone('Zona de mantenimiento');
    const chairId = await createChair(zoneId, 'SV-03');
    // Se lleva a MAINTENANCE por su endpoint (transición válida).
    await post(`/api/v1/chairs/${chairId}/maintenance`, { reason: 'Roto' }, adminToken)
      .expect(200);

    // Y desde ahí, ocupar la silla falla con 422 y la misma máquina de estados.
    const response = await post('/api/v1/rentals', { chairId, plannedMinutes: 30 }, adminToken)
      .expect(422);
    expect(response.body.error.details.code).toBe('CHAIR_NOT_BOOKABLE');

    // Y la transición directa MAINTENANCE -> OCCUPIED también se rechaza, que es
    // la prohibición explícita de DESIGN.md 6.4.
    const service = getSpacesService();
    const actor = ctx.contextFor('ADMIN' as RoleValue, 1, 'admin@lattecoffe.co');
    expect(() =>
      service.occupyChair(chairId, { actor, request: { ipAddress: null, userAgent: null, requestId: null } }, ctx.db),
    ).toThrowError(/MAINTENANCE/);
  });

  it('AVAILABLE -> BLOCKED -> AVAILABLE con motivo en notes', async () => {
    const zoneId = await createZone('Zona de bloqueo');
    const chairId = await createChair(zoneId, 'SV-04');

    const blocked = await post(`/api/v1/chairs/${chairId}/block`, { reason: 'Reparación del tapizado' }, adminToken)
      .expect(200);
    expect(blocked.body.data.status).toBe('BLOCKED');
    expect(blocked.body.data.notes).toBe('Reparación del tapizado');

    const unblocked = await post(`/api/v1/chairs/${chairId}/unblock`, {}, adminToken)
      .expect(200);
    expect(unblocked.body.data.status).toBe('AVAILABLE');

    // Desbloquear una silla que no está bloqueada es 422 CHAIR_NOT_BLOCKED
    // (API.md 7.7 lo lista explícitamente): no es un no-op silencioso, porque
    // un doble clic del cajero sobre "desbloquear" debe verse.
    const twice = await post(`/api/v1/chairs/${chairId}/unblock`, {}, adminToken).expect(422);
    expect(twice.body.error.details.code).toBe('CHAIR_NOT_BLOCKED');
  });

  it('exige motivo para BLOCKED y MAINTENANCE', async () => {
    const zoneId = await createZone('Zona de motivos');
    const chairId = await createChair(zoneId, 'SV-05');
    const response = await patch(`/api/v1/chairs/${chairId}/status`, { status: 'BLOCKED' }, adminToken)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('mantenimiento -> CLEANING con needsCleaning=true, y AVAILABLE con false', async () => {
    const zoneId = await createZone('Zona de ciclo de mantenimiento');
    const chairId = await createChair(zoneId, 'SV-06');

    await post(`/api/v1/chairs/${chairId}/maintenance`, { reason: 'Ajuste' }, adminToken)
      .expect(200);
    const cleaning = await post(`/api/v1/chairs/${chairId}/complete-maintenance`, { notes: 'Ajustado' }, adminToken)
      .expect(200);
    expect(cleaning.body.data.status).toBe('CLEANING');

    // Repetir el cierre es idempotente: 200 con ALREADY_APPLIED.
    const repeat = await post(`/api/v1/chairs/${chairId}/complete-maintenance`, {}, adminToken)
      .expect(200);
    expect(repeat.body.meta.warnings).toContain('ALREADY_APPLIED');

    const chairId2 = await createChair(zoneId, 'SV-07');
    await post(`/api/v1/chairs/${chairId2}/maintenance`, { reason: 'Ajuste' }, adminToken)
      .expect(200);
    const available = await post(`/api/v1/chairs/${chairId2}/complete-maintenance`, { needsCleaning: false }, adminToken)
      .expect(200);
    expect(available.body.data.status).toBe('AVAILABLE');
  });

  it('no bloquea una silla ocupada: 409 CHAIR_OCCUPIED (BR-CHAIR-005)', async () => {
    const zoneId = await createZone('Zona ocupada');
    const chairId = await createChair(zoneId, 'SV-08');
    await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, adminToken).expect(201);

    const response = await post(`/api/v1/chairs/${chairId}/block`, { reason: 'Bloqueo con gente' }, adminToken)
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('CHAIR_OCCUPIED');
  });
});

describe('GET /chairs/map — el mapa visual (BR-CHAIR-006)', () => {
  it('devuelve zonas, sillas, contadores por estado, totales y % de ocupación', async () => {
    const response = await get(`/api/v1/chairs/map?locationId=${locationId}`, cashierToken)
      .expect(200);

    const map = response.body.data;
    expect(map.location).toMatchObject({ id: locationId });
    expect(Array.isArray(map.zones)).toBe(true);
    expect(map.zones.length).toBeGreaterThanOrEqual(2);

    // Cada zona trae su rectángulo y sus sillas con coordenadas de celda.
    const terraza = map.zones.find((zone: { name: string }) => zone.name === 'Terraza');
    expect(terraza).toBeDefined();
    expect(terraza.bounds).toMatchObject({ minX: 0, minY: 0 });
    expect(terraza.chairs.length).toBe(6);
    expect(terraza.chairs[0]).toMatchObject({ code: 'TZ-01', gridX: 0, gridY: 0, status: 'AVAILABLE' });

    // Invariante del mapa: la suma de los seis contadores es el total de sillas,
    // y `totals` replica esos mismos números. Es lo que permite pintar la rejilla
    // sin recalcular nada en el cliente (BR-CHAIR-006).
    const sumStatuses = Object.values(map.countsByStatus as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(sumStatuses).toBe(map.totals.chairs);
    expect(map.totals.available).toBe(map.countsByStatus.AVAILABLE);
    expect(map.totals.occupied).toBe(map.countsByStatus.OCCUPIED);
    expect(map.totals.reserved).toBe(map.countsByStatus.RESERVED);
    expect(map.totals.blocked).toBe(map.countsByStatus.BLOCKED);
    expect(map.totals.maintenance).toBe(map.countsByStatus.MAINTENANCE);
    expect(map.totals.cleaning).toBe(map.countsByStatus.CLEANING);
    // Los 10 muebles de la semilla están AVAILABLE; el resto son los que crearon
    // los tests anteriores de esta misma suite.
    expect(map.totals.chairs).toBeGreaterThanOrEqual(10);
    expect(map.totals.available).toBeGreaterThanOrEqual(10);
    // Capacidad = suma de `chairs.capacity`: 6 sillas + 4+4+6+2 de las mesas.
    expect(map.totals.capacity).toBeGreaterThanOrEqual(22);
    expect(map.totals.occupancyRateBp).toBeGreaterThanOrEqual(0);
    expect(map.totals.occupancyRateBp).toBeLessThanOrEqual(10_000);
    expect(response.body.meta.generatedAt).toBeTruthy();
  });

  it('el % de ocupación sube cuando hay una silla ocupada', async () => {
    const zoneId = await createZone('Zona de ocupación');
    await createChair(zoneId, 'SO-01', { capacity: 2 });
    await createChair(zoneId, 'SO-02', { capacity: 2 });
    const chairId = await chairIdOf('SO-01');

    await post('/api/v1/rentals', { chairId, plannedMinutes: 30 }, adminToken).expect(201);

    const response = await get(`/api/v1/chairs/map?locationId=${locationId}&zoneId=${zoneId}`, cashierToken)
      .expect(200);
    const map = response.body.data;
    // 1 de 2 sillas ocupadas y 2 de 4 puestos: 50 % = 5000 bp.
    expect(map.countsByStatus.OCCUPIED).toBe(1);
    expect(map.totals.occupiedSeats).toBe(2);
    expect(map.totals.capacity).toBe(4);
    expect(map.totals.occupancyRateBp).toBe(5000);
  });

  it('filtra por una sola zona y exige la sede', async () => {
    const zoneId = await createZone('Zona filtrada');
    await createChair(zoneId, 'SF-01');
    const response = await get(`/api/v1/chairs/map?locationId=${locationId}&zoneId=${zoneId}`, cashierToken)
      .expect(200);
    expect(response.body.data.zones).toHaveLength(1);
    expect(response.body.data.zones[0].chairs).toHaveLength(1);

    await get('/api/v1/chairs/map', cashierToken).expect(400);
    await get('/api/v1/chairs/map?locationId=999999', cashierToken).expect(404);
  });
});

describe('GET /chairs/:id/availability (API.md 7.7)', () => {
  it('marca RESERVED las celdas de la ventana reservada y deja libres las de al lado', async () => {
    const zoneId = await createZone('Zona de disponibilidad');
    const chairId = await createChair(zoneId, 'SA-01');
    // Un único instante base para los tres extremos: ver la nota de `inMinutes`.
    const base = Date.now();
    const from = inMinutes(120, base);
    const to = inMinutes(240, base);

    const reservation = await post(
        '/api/v1/reservations',
        { chairId, startAt: from, endAt: inMinutes(180, base), customerId: customerId },
        cashierToken,
      )
      .expect(201);

    const response = await get(
        `/api/v1/chairs/${chairId}/availability?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularityMinutes=30`,
        cashierToken,
      )
      .expect(200);

    const view = response.body.data;
    expect(view.chairId).toBe(chairId);
    expect(view.totalMinutes).toBe(120);
    expect(view.slots).toHaveLength(4);
    // 14:00-15:00 RESERVED, 15:00-16:00 FREE: los extremos que se tocan no
    // se solapan (BR-RES-001).
    expect(view.slots.map((slot: { status: string }) => slot.status)).toEqual([
      'RESERVED',
      'RESERVED',
      'FREE',
      'FREE',
    ]);
    expect(view.slots[0].reservationCode).toBe(reservation.body.data.code);
    expect(view.bookedMinutes).toBe(60);
    expect(view.availableMinutes).toBe(60);
    expect(view.utilizationRateBp).toBe(5000);
  });

  it('con `from` y `to` omitidos usa la ventana por defecto y no rompe', async () => {
    const zoneId = await createZone('Zona por defecto');
    const chairId = await createChair(zoneId, 'SA-02');
    const response = await get(`/api/v1/chairs/${chairId}/availability`, cashierToken)
      .expect(200);
    expect(response.body.data.totalMinutes).toBe(24 * 60);
  });

  it('devuelve 400 INVALID_DATE_RANGE si `to` es anterior a `from`', async () => {
    const zoneId = await createZone('Zona de rango');
    const chairId = await createChair(zoneId, 'SA-03');
    const response = await get(
        `/api/v1/chairs/${chairId}/availability?from=${encodeURIComponent(inMinutes(120))}&to=${encodeURIComponent(inMinutes(60))}`,
        cashierToken,
      )
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /chairs/:id/history (API.md 7.7)', () => {
  it('combina reservas y alquileres con sus totales', async () => {
    const zoneId = await createZone('Zona de historial');
    const chairId = await createChair(zoneId, 'SH-01');
    // Un único instante base para los dos extremos: ver la nota de `inMinutes`.
    const base = Date.now();
    const from = inMinutes(60, base);
    const to = inMinutes(180, base);

    await post('/api/v1/reservations', { chairId, startAt: from, endAt: to, customerId: customerId }, cashierToken)
      .expect(201);

    // Rango explícito: la reserva es futura y el historial por defecto son los
    // últimos 30 días (API.md 7.7).
    const response = await get(
      `/api/v1/chairs/${chairId}/history?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      cashierToken,
    ).expect(200);
    expect(response.body.data).toHaveLength(1);
    const entry = response.body.data[0];
    expect(entry.type).toBe('reservation');
    expect(entry.durationMinutes).toBe(120);
    expect(entry.customerId).toBe(customerId);
    expect(response.body.meta.totals.sessions).toBe(1);
    expect(response.body.meta.totals.totalRevenueMinor).toBe(1_000_000);
  });

  it('exige `chairs:history:read`: un CUSTOMER recibe 403 (CASHIER+ en la matriz)', async () => {
    const zoneId = await createZone('Zona de historial privado');
    const chairId = await createChair(zoneId, 'SH-02');
    const response = await get(`/api/v1/chairs/${chairId}/history`, customerToken)
      .expect(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(response.body.error.details.required).toBe('chairs:history:read');
  });
});

describe('Baja de silla con sesiones vivas (BR-CHAIR-001)', () => {
  it('no borra una silla con reservas futuras: 422 CHAIR_HAS_FUTURE_RESERVATIONS', async () => {
    const zoneId = await createZone('Zona de baja bloqueada');
    const chairId = await createChair(zoneId, 'SDB-01');
    await post(
        '/api/v1/reservations',
        { chairId, startAt: inMinutes(300), endAt: inMinutes(360), customerId: customerId },
        cashierToken,
      )
      .expect(201);

    const response = await del(`/api/v1/chairs/${chairId}`, { reason: 'Fuera de servicio' }, adminToken)
      .expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('CHAIR_HAS_FUTURE_RESERVATIONS');
    expect(response.body.error.details.reservationCount).toBe(1);
  });

  it('no borra una silla ocupada: 422 CHAIR_IN_USE (con su alquiler abierto)', async () => {
    const zoneId = await createZone('Zona con alquiler');
    const chairId = await createChair(zoneId, 'SDB-02');
    await post('/api/v1/rentals', { chairId, plannedMinutes: 60 }, adminToken).expect(201);

    // El estado `OCCUPIED` es la primera comprobación; el alquiler vivo es la
    // segunda capa de defensa (una silla `RESERVED` con alquiler abierto es un
    // estado inconsistente que también se rechaza, con CHAIR_HAS_ACTIVE_RENTAL).
    const response = await del(`/api/v1/chairs/${chairId}`, { reason: 'Fuera de servicio' }, adminToken)
      .expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('CHAIR_IN_USE');
  });

  it('exige el motivo del borrado y hace soft delete', async () => {
    const zoneId = await createZone('Zona de baja limpia');
    const chairId = await createChair(zoneId, 'SDB-03');
    await del(`/api/v1/chairs/${chairId}`, {}, adminToken).expect(400);

    const response = await del(`/api/v1/chairs/${chairId}`, { reason: 'Retirada' }, adminToken)
      .expect(200);
    expect(response.body.data).toMatchObject({ id: chairId, reason: 'Retirada' });
    expect(response.body.data.deletedAt).toBeTruthy();
    await get(`/api/v1/chairs/${chairId}`, adminToken).expect(404);
  });

  it('el `code` deja de ser editable en cuanto la silla tiene historial (BR-CHAIR-008)', async () => {
    const zoneId = await createZone('Zona de código inmutable');
    const chairId = await createChair(zoneId, 'SCI-01');
    // Sin historial: se puede renombrar.
    await patch(`/api/v1/chairs/${chairId}`, { code: 'SCI-01-A' }, adminToken).expect(200);
    await post(
        '/api/v1/reservations',
        { chairId, startAt: inMinutes(400), endAt: inMinutes(460), customerId: customerId },
        cashierToken,
      )
      .expect(201);

    const response = await patch(`/api/v1/chairs/${chairId}`, { code: 'SCI-01-B' }, adminToken)
      .expect(422);
    expect(response.body.error.details.code).toBe('CHAIR_CODE_IMMUTABLE');
    expect(response.body.error.details.ruleId).toBe('BR-CHAIR-008');
  });
});

describe('RBAC de espacios (BR-SEC-005, DESIGN.md 9.3)', () => {
  it('un CUSTOMER no puede crear zona ni silla: 403 con el permiso requerido', async () => {
    const zoneResponse = await post('/api/v1/zones', { locationId, name: 'Zona de cliente' }, customerToken)
      .expect(403);
    expect(zoneResponse.body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(zoneResponse.body.error.details.required).toBe('zones:create');

    const chairResponse = await post('/api/v1/chairs', { zoneId: 1, code: 'CLI-01' }, customerToken)
      .expect(403);
    expect(chairResponse.body.error.details.required).toBe('chairs:create');
  });

  it('un CUSTOMER no puede cambiar el estado de una silla (chairs:status:update es parcial)', async () => {
    const zoneId = await createZone('Zona de estado de cliente');
    const chairId = await createChair(zoneId, 'SCS-01');
    const response = await patch(`/api/v1/chairs/${chairId}/status`, { status: 'AVAILABLE' }, customerToken)
      .expect(403);
    expect(response.body.error.details.required).toBe('chairs:status:update');
  });

  it('un CUSTOMER SÍ puede leer el mapa y el listado de sillas (chairs:map es C para todos)', async () => {
    await get(`/api/v1/chairs/map?locationId=${locationId}`, customerToken).expect(200);
    await get(`/api/v1/chairs?locationId=${locationId}`, customerToken).expect(200);
    await get(`/api/v1/zones?locationId=${locationId}`, customerToken).expect(200);
  });

  it('sin token responde 401, no 403', async () => {
    const response = await get(`/api/v1/chairs/map?locationId=${locationId}`).expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('rechaza campos desconocidos con 400 (`.strict()`)', async () => {
    const response = await post('/api/v1/zones', { locationId, name: 'Zona estricta', colorHex: '#123456', ispala: true }, adminToken)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
  });
});

describe('Auditoría de sillas y zonas (BR-SEC-007)', () => {
  it('deja fila en audit_logs por cada mutación de silla', async () => {
    const zoneId = await createZone('Zona auditada');
    const chairId = await createChair(zoneId, 'SAU-01');

    const rows = ctx.db
      .prepare(
        `SELECT action, entity_type, entity_id
           FROM audit_logs
          WHERE entity_type = 'chair'
            AND entity_id = ?
          ORDER BY id ASC`,
      )
      .all(chairId) as { action: string; entity_type: string; entity_id: number }[];

    const actions = rows.map((row) => row.action);
    expect(actions).toContain('CREATE');
    // La zona también se audita, con `entity_type = 'chair'` porque `audit_logs`
    // no tiene un tipo `zone` en su CHECK (DESIGN.md 4.6) y el `entityId` la
    // distingue del resto de sillas.
    const zoneRows = ctx.db
      .prepare("SELECT action FROM audit_logs WHERE entity_type = 'chair' AND entity_id = ?")
      .all(zoneId) as { action: string }[];
    expect(zoneRows.map((row) => row.action)).toContain('CREATE');
  });
});

/** Id de una silla por su `code`, leída del mapa. */
async function chairIdOf(code: string): Promise<number> {
  const response = await get(`/api/v1/chairs?q=${code}`, adminToken).expect(200);
  const chair = response.body.data.find((item: { code: string }) => item.code === code);
  if (chair === undefined) {
    throw new Error(`No se encontró la silla ${code}`);
  }
  return Number(chair.id);
}
