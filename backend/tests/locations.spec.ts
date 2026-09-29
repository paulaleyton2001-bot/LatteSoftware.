/**
 * Pruebas de las sedes: listado público, alta, edición, nombre único, baja lógica
 * y el bloqueo de borrar una sede con zonas.
 *
 * ============================== POR QUÉ ESTE FICHERO MONTA SU PROPIA APP ====
 * `modules/index.ts` lo cablea el agente integrador y este agente no lo toca, así
 * que el router de sedes todavía NO está en el árbol de la aplicación. Para que
 * estas pruebas ejerciten la CADENA REAL (los mismos middlewares, el mismo
 * service, el mismo SQL y la misma base en memoria del harness) y no una versión
 * recortada, se monta el router del módulo sobre el `createApiV1Router()` que ya
 * exporta `modules/index.ts`. En cuanto el integrador lo registre en
 * `MODULE_ROUTERS`, estas pruebas siguen funcionando sin cambios.
 *
 * Reutiliza `tests/helpers/harness.ts` y la semilla de espacios
 * (`seedSpacesDemo`, que crea la sede con sus zonas y sillas), y NO duplica nada
 * de su lógica.
 *
 * Cada prueba cita la regla que verifica.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { API_PREFIX } from '../src/config/index.js';
import { createApiV1Router } from '../src/modules/index.js';
import { locationsRouter } from '../src/modules/locations/locations.routes.js';
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
let customerToken: string;

/** Sede de demostración (con 2 zonas y 10 sillas). */
let demoLocationId: number;
/** Silla de la sede de demostración, para crear una reserva viva. */
let demoChairId: number;

/** Contador de nombres únicos: `UNIQUE(business_id, name)` es real. */
let nameSequence = 0;

/** Nombre de sede libre y único dentro de la suite. */
function uniqueName(prefix = 'Sede'): string {
  nameSequence += 1;
  return `${prefix}-${nameSequence}`;
}

/**
 * App de pruebas con el router de sedes montado (ver la nota de cabecera).
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
  api.use('/locations', locationsRouter);
  app.use(API_PREFIX, api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Peticiones con `Authorization: Bearer`, misma firma que los atajos del harness. */
function get(path: string, token?: string): request.Test {
  return token === undefined ? agent.get(path) : agent.get(path).set('Authorization', `Bearer ${token}`);
}
function post(path: string, body: object, token?: string): request.Test {
  return (token === undefined ? agent.post(path) : agent.post(path).set('Authorization', `Bearer ${token}`)).send(body);
}
function patch(path: string, body: object, token?: string): request.Test {
  return (token === undefined ? agent.patch(path) : agent.patch(path).set('Authorization', `Bearer ${token}`)).send(body);
}
function del(path: string, token?: string): request.Test {
  return token === undefined ? agent.delete(path) : agent.delete(path).set('Authorization', `Bearer ${token}`);
}

/** Crea una sede y devuelve su id. */
async function createLocation(overrides: Record<string, unknown> = {}): Promise<number> {
  const response = await post(
    '/api/v1/locations',
    { name: uniqueName(), address: 'Cra. 7 # 32-16', phone: '+573001112233', ...overrides },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeLocationsTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  // La semilla de despliegue no trae cuenta CUSTOMER (ver harness): se registra.
  const email = ctx.uniqueEmail('sedes-cliente');
  const registered = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente Sedes' })
    .expect(201);
  customerToken = String(registered.body.data.accessToken);

  // Sede + zonas + sillas de demostración (idempotente).
  const demo = seedSpacesDemo();
  demoLocationId = demo.locationId;
  const chair = ctx.db
    .prepare('SELECT id FROM chairs WHERE deleted_at IS NULL ORDER BY id ASC LIMIT 1')
    .get() as { id: number } | undefined;
  demoChairId = chair?.id ?? 0;
});

afterAll(() => {
  ctx.close();
});

// ===========================================================================
// GET /api/v1/locations
// ===========================================================================

describe('Listado de sedes', () => {
  it('es PÚBLICO: responde 200 sin token y trae la sede de demostración', async () => {
    const response = await get('/api/v1/locations').expect(200);
    expect(response.body.success).toBe(true);
    expect(Array.isArray(response.body.data)).toBe(true);
    const ids = (response.body.data as { id: number }[]).map((row) => row.id);
    expect(ids).toContain(demoLocationId);
    expect(response.body.meta.page).toBe(1);
    expect(typeof response.body.meta.total).toBe('number');
    expect(typeof response.body.meta.requestId).toBe('string');
  });

  it('sólo muestra las sedes ACTIVAS por defecto; `isActive=false` trae las inactivas', async () => {
    const id = await createLocation({ isActive: false });
    const nombre = (await get(`/api/v1/locations/${id}`, adminToken).expect(200)).body.data.name;

    const porDefecto = await get('/api/v1/locations?pageSize=100').expect(200);
    const nombres = (porDefecto.body.data as { name: string }[]).map((row) => row.name);
    expect(nombres).not.toContain(nombre);

    const inactivas = await get('/api/v1/locations?isActive=false&pageSize=100').expect(200);
    const nombresInactivos = (inactivas.body.data as { name: string }[]).map((row) => row.name);
    expect(nombresInactivos).toContain(nombre);
  });

  it('filtra por texto con `q` y pagina con `meta`', async () => {
    const nombre = uniqueName('Sede Buscable');
    await post('/api/v1/locations', { name: nombre }, adminToken).expect(201);

    const response = await get(`/api/v1/locations?q=${encodeURIComponent(nombre)}`).expect(200);
    const filas = response.body.data as { name: string }[];
    expect(filas).toHaveLength(1);
    expect(filas[0]?.name).toBe(nombre);
  });

  it('rechaza ordenar por una columna que no está en la allowlist (API.md 5.1)', async () => {
    const response = await get('/api/v1/locations?sort=address').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('INVALID_SORT_FIELD');
  });

  it('GET /:id trae la sede con sus zonas y el conteo de sillas', async () => {
    const response = await get(`/api/v1/locations/${demoLocationId}`).expect(200);
    const data = response.body.data as Record<string, unknown>;
    expect(data['id']).toBe(demoLocationId);
    expect(data['zonesCount']).toBeGreaterThan(0);
    expect(data['activeChairsCount']).toBeGreaterThan(0);

    const zonas = data['zones'] as { name: string; chairCount: number }[];
    expect(zonas.length).toBeGreaterThan(0);
    expect(zonas.every((zona) => zona.chairCount > 0)).toBe(true);

    const stats = data['stats'] as { totalChairs: number; availableChairs: number; occupiedChairs: number };
    expect(stats.totalChairs).toBeGreaterThan(0);
    expect(stats.availableChairs).toBeGreaterThanOrEqual(0);
    expect(stats.occupiedChairs).toBeGreaterThanOrEqual(0);
  });

  it('una sede inexistente es 404 y un id no numérico es 400', async () => {
    await get('/api/v1/locations/999999').expect(404);
    const response = await get('/api/v1/locations/no-es-un-id').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// POST / PATCH
// ===========================================================================

describe('Alta y edición de sedes', () => {
  it('un CUSTOMER no crea ni edita sedes: 403', async () => {
    const created = await post('/api/v1/locations', { name: uniqueName() }, customerToken).expect(403);
    expect(created.body.error.details.required).toBe('locations:create');

    const id = await createLocation();
    await patch(`/api/v1/locations/${id}`, { name: uniqueName() }, customerToken).expect(403);
    await del(`/api/v1/locations/${id}`, customerToken).expect(403);
  });

  it('sin token las escrituras son 401', async () => {
    await post('/api/v1/locations', { name: uniqueName() }).expect(401);
  });

  it('crea la sede y devuelve los conteos a cero', async () => {
    const response = await post(
      '/api/v1/locations',
      { name: uniqueName('Sede Norte'), address: 'Cll 100 # 10-10', phone: '+576000000000' },
      adminToken,
    ).expect(201);
    const data = response.body.data as Record<string, unknown>;
    expect(typeof data['id']).toBe('number');
    expect(data['isActive']).toBe(true);
    expect(data['zonesCount']).toBe(0);
    expect(data['activeChairsCount']).toBe(0);
    expect(typeof data['createdAt']).toBe('string');
  });

  it('el nombre es único por negocio: 409 LOCATION_NAME_TAKEN', async () => {
    const nombre = uniqueName('Sede Repetida');
    await post('/api/v1/locations', { name: nombre }, adminToken).expect(201);

    const response = await post('/api/v1/locations', { name: nombre }, adminToken).expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('LOCATION_NAME_TAKEN');
  });

  it('no se puede renombrar una sede al nombre de otra: 409', async () => {
    const nombre = uniqueName('Sede Destino');
    await post('/api/v1/locations', { name: nombre }, adminToken).expect(201);
    const id = await createLocation();

    const response = await patch(`/api/v1/locations/${id}`, { name: nombre }, adminToken).expect(409);
    expect(response.body.error.details.code).toBe('LOCATION_NAME_TAKEN');
  });

  it('editar sin permiso es 403 y con un id inexistente es 404', async () => {
    const id = await createLocation();
    await patch(`/api/v1/locations/${id}`, { address: 'Nueva dirección' }, customerToken).expect(403);
    await patch('/api/v1/locations/999999', { address: 'X' }, adminToken).expect(404);
  });

  it('desactivar con reservas vivas devuelve EXISTING_BOOKINGS_KEPT sin cancelar nada', async () => {
    const reserva = await post(
      '/api/v1/reservations',
      {
        chairId: demoChairId,
        startAt: new Date(Date.now() + 3_600_000).toISOString(),
        endAt: new Date(Date.now() + 7_200_000).toISOString(),
        sendNotification: false,
      },
      adminToken,
    ).expect(201);
    const reservaId = Number(reserva.body.data.id);

    try {
      const response = await patch(
        `/api/v1/locations/${demoLocationId}`,
        { isActive: false },
        adminToken,
      ).expect(200);
      expect(response.body.data.isActive).toBe(false);
      expect(response.body.meta.warnings).toContain('EXISTING_BOOKINGS_KEPT');

      // Desactivar NO cancela lo que ya está reservado (API.md 7.5): la reserva
      // sigue viva, en el mismo estado en que estaba.
      const sigueViva = await get(`/api/v1/reservations/${reservaId}`, adminToken).expect(200);
      expect(sigueViva.body.data.reservation.status).toBe('PENDING');
    } finally {
      // Se reactiva la sede de demostración para no arrastrar el efecto.
      await patch(`/api/v1/locations/${demoLocationId}`, { isActive: true }, adminToken).expect(200);
      await del(`/api/v1/reservations/${reservaId}`, adminToken);
    }
  });

  it('un cambio de sede queda auditado con before y after (BR-SEC-007)', async () => {
    const id = await createLocation();
    await patch(`/api/v1/locations/${id}`, { phone: '+573004445566' }, adminToken).expect(200);

    const log = ctx.db
      .prepare(
        `SELECT before_data, after_data
           FROM audit_logs
          WHERE entity_type = 'business'
            AND action = 'UPDATE'
          ORDER BY id DESC
          LIMIT 1`,
      )
      .get() as { before_data: string; after_data: string };

    const before = JSON.parse(log.before_data) as { resource: string; location: Record<string, unknown> };
    const after = JSON.parse(log.after_data) as { resource: string; location: Record<string, unknown> };
    expect(before.resource).toBe('location');
    expect(after.location['phone']).toBe('+573004445566');
    expect(before.location['phone']).not.toBe('+573004445566');
  });
});

// ===========================================================================
// DELETE /api/v1/locations/:id (BR-LOC-001)
// ===========================================================================

describe('Baja lógica de sedes', () => {
  it('eliminar una ubicación con ZONAS ACTIVAS es 409 y no la da de baja', async () => {
    const response = await del(`/api/v1/locations/${demoLocationId}`, adminToken).expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('LOCATION_HAS_ACTIVE_ZONES');
    expect(response.body.error.details.activeZones).toBeGreaterThan(0);

    // Y la sede sigue ahí: el 409 no ha dejado la fila a medias.
    const still = await get(`/api/v1/locations/${demoLocationId}`).expect(200);
    expect(still.body.data.id).toBe(demoLocationId);
  });

  it('eliminar una ubicación con zonas INACTIVAS es 409 LOCATION_HAS_ZONES', async () => {
    const id = await createLocation();
    // Se crea una zona inactiva directamente: el módulo de zonas exige una sede
    // activa para crearlas, y aquí lo que se prueba es la BAJA de la sede.
    ctx.db
      .prepare(
        `INSERT INTO zones (business_id, location_id, name, is_active)
         VALUES (1, ?, ?, 0)`,
      )
      .run(id, uniqueName('Zona'));

    const response = await del(`/api/v1/locations/${id}`, adminToken).expect(409);
    expect(response.body.error.details.code).toBe('LOCATION_HAS_ZONES');
    expect(response.body.error.details.totalZones).toBe(1);
  });

  it('elimina una sede sin zonas, la marca como dada de baja y desaparece', async () => {
    const id = await createLocation({ name: uniqueName('Sede Efímera') });
    const response = await del(`/api/v1/locations/${id}`, adminToken).expect(200);
    expect(response.body.data.id).toBe(id);
    expect(typeof response.body.data.deletedAt).toBe('string');
    expect(response.body.data.zonesCount).toBe(0);

    // Soft delete: la fila sigue en la tabla con `deleted_at`.
    const row = ctx.db
      .prepare('SELECT deleted_at, is_active FROM locations WHERE id = ?')
      .get(id) as { deleted_at: string | null; is_active: number };
    expect(row.deleted_at).not.toBeNull();
    expect(row.is_active).toBe(0);

    await get(`/api/v1/locations/${id}`).expect(404);
    const listado = await get('/api/v1/locations?pageSize=100').expect(200);
    expect((listado.body.data as { id: number }[]).map((row) => row.id)).not.toContain(id);

    // Eliminar dos veces es 404, no un 500: ya no existe para el negocio.
    await del(`/api/v1/locations/${id}`, adminToken).expect(404);
  });

  it('el nombre de una sede dada de baja NO se puede reutilizar (UNIQUE sigue vigente)', async () => {
    const nombre = uniqueName('Sede Excluida');
    const id = await createLocation({ name: nombre });
    await del(`/api/v1/locations/${id}`, adminToken).expect(200);

    const response = await post('/api/v1/locations', { name: nombre }, adminToken).expect(409);
    expect(response.body.error.details.code).toBe('LOCATION_NAME_TAKEN');
  });
});
