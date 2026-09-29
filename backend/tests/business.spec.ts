/**
 * Pruebas de la configuración del negocio: lectura pública, edición auditada,
 * horario, días festivos y estado "abierto/cerrado".
 *
 * ============================== POR QUÉ ESTE FICHERO MONTA SU PROPIA APP ====
 * `modules/index.ts` lo cablea el agente integrador y este agente no lo toca,
 * así que el router de negocio todavía NO está en el árbol de la aplicación. Para
 * que estas pruebas ejerciten la CADENA REAL (los mismos middlewares, el mismo
 * service, el mismo SQL y la misma base en memoria del harness) y no una versión
 * recortada, se monta el router del módulo sobre el `createApiV1Router()` que ya
 * exporta `modules/index.ts`. En cuanto el integrador lo registre en
 * `MODULE_ROUTERS`, estas pruebas siguen funcionando sin cambios.
 *
 * Reutiliza `tests/helpers/harness.ts` (base en memoria, migraciones, semilla de
 * RBAC y las cuentas de sistema) y NO duplica nada de su lógica.
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
import { businessRouter } from '../src/modules/business/business.routes.js';
import { getBusinessServices } from '../src/modules/business/business.container.js';
import {
  corsMiddleware,
  errorHandler,
  jsonBody,
  notFound,
  requestContext,
  securityHeaders,
  setRateLimitingEnabled,
} from '../src/shared/middleware/index.js';
import { localDateKey } from '../src/shared/utils/datetime.js';
import { MONEY } from '../src/config/constants.js';

let ctx: TestContext;
let agent: TestAgent;
let adminToken: string;
let customerToken: string;

/** Zona horaria del negocio sembrado: `America/Bogota` (UTC-5 fijo, sin DST). */
const BOGOTA = MONEY.DEFAULT_TIMEZONE;

/**
 * App de pruebas con el router de negocio montado.
 *
 * `modules/index.ts` es el punto de extensión oficial y lo edita el agente de
 * integración, así que esta suite monta su router sobre el
 * `createApiV1Router()` que ya exporta. Es EXACTAMENTE lo mismo que hará el
 * integrador (una entrada más en `MODULE_ROUTERS`) pero sin escribir en un
 * fichero que no le pertenece.
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
  api.use('/business', businessRouter);
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

/** Un día de la semana del horario. */
interface HourDay {
  dayOfWeek: number;
  opensAt: string;
  closesAt: string;
  isClosed: boolean;
}

/** Semana completa de 7 días, todos con la misma franja. */
function weekAllDays(opensAt: string, closesAt: string, isClosed = false): HourDay[] {
  return Array.from({ length: 7 }, (_unused, dayOfWeek) => ({
    dayOfWeek,
    opensAt,
    closesAt,
    isClosed,
  }));
}

/** Fecha de hoy en la zona del negocio (`YYYY-MM-DD`). */
function localToday(): string {
  return localDateKey(new Date(), BOGOTA);
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeBusinessTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  // La semilla de despliegue no trae cuenta CUSTOMER (ver harness): se registra.
  const email = ctx.uniqueEmail('negocio-cliente');
  const registered = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: 'Cliente Negocio' })
    .expect(201);
  customerToken = String(registered.body.data.accessToken);
});

afterAll(() => {
  ctx.close();
});

// ===========================================================================
// GET /api/v1/business — lectura pública
// ===========================================================================

describe('GET /api/v1/business (público)', () => {
  it('responde 200 sin token y filtra los datos fiscales y de contacto', async () => {
    // Primero se configura un NIT real: si el filtro público no funciona, el
    // valor aparecería en el cuerpo y esta prueba lo detectaría.
    const taxId = '900123456-7';
    await patch('/api/v1/business', { taxId, legalName: 'LatteCoffe S.A.S.' }, adminToken).expect(200);

    const response = await get('/api/v1/business').expect(200);

    expect(response.body.success).toBe(true);
    const data = response.body.data as Record<string, unknown>;
    // Lo que el cliente necesita para pintar precios.
    expect(data['name']).toBe('LatteCoffe');
    expect(data['currencyCode']).toBe('COP');
    expect(typeof data['taxRateBp']).toBe('number');
    expect(typeof data['chairDefaultPriceMinor']).toBe('number');
    expect(data['maxReservationMinutes']).toBeGreaterThan(0);

    // Y lo que NO debe salir nunca sin credencial.
    expect(Object.hasOwn(data, 'taxId')).toBe(false);
    expect(Object.hasOwn(data, 'legalName')).toBe(false);
    expect(Object.hasOwn(data, 'email')).toBe(false);
    expect(Object.hasOwn(data, 'phone')).toBe(false);
    expect(Object.hasOwn(data, 'addressLine1')).toBe(false);
    // Ni siquiera como texto plano dentro del cuerpo.
    expect(JSON.stringify(response.body)).not.toContain(taxId);
    expect(JSON.stringify(response.body)).not.toContain('LatteCoffe S.A.S.');
  });

  it('un token INVÁLIDO sigue siendo 401: la puerta pública no abre la autenticada', async () => {
    const response = await get('/api/v1/business', 'token.invalido').expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });

  it('un actor con business:read recibe la configuración COMPLETA (API.md 6.3)', async () => {
    const response = await get('/api/v1/business', adminToken).expect(200);
    const data = response.body.data as Record<string, unknown>;
    expect(Object.hasOwn(data, 'taxId')).toBe(true);
    expect(Object.hasOwn(data, 'legalName')).toBe(true);
    expect(data['currencyCode']).toBe('COP');
    expect(Array.isArray(data['defaultTipsBp'])).toBe(true);
    expect(typeof data['createdAt']).toBe('string');
  });
});

// ===========================================================================
// PATCH /api/v1/business
// ===========================================================================

describe('PATCH /api/v1/business', () => {
  it('un CUSTOMER no puede editar la configuración: 403 (BR-SEC-012)', async () => {
    const response = await patch('/api/v1/business', { name: 'Cliente Maligno' }, customerToken).expect(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(response.body.error.details.required).toBe('business:update');

    const current = await get('/api/v1/business', adminToken).expect(200);
    expect(current.body.data.name).toBe('LatteCoffe');
  });

  it('sin token es 401, no 400', async () => {
    await patch('/api/v1/business', { name: 'Sin credencial' }).expect(401);
  });

  it('audita el cambio con before_data y after_data completos (BR-SEC-007)', async () => {
    const before = await get('/api/v1/business', adminToken).expect(200);
    const beforeCity = before.body.data.city;

    const response = await patch('/api/v1/business', { city: 'Bogotá D.C.' }, adminToken).expect(200);
    expect(response.body.data.city).toBe('Bogotá D.C.');

    const log = ctx.db
      .prepare(
        `SELECT action, entity_type, entity_id, before_data, after_data, user_id
           FROM audit_logs
          WHERE entity_type = 'business'
            AND action = 'UPDATE'
          ORDER BY id DESC
          LIMIT 1`,
      )
      .get() as {
      action: string;
      entity_type: string;
      entity_id: number;
      before_data: string;
      after_data: string;
      user_id: number;
    };

    expect(log).toBeDefined();
    expect(log.action).toBe('UPDATE');
    expect(log.entity_type).toBe('business');
    expect(log.user_id).toBeGreaterThan(0);

    const beforeData = JSON.parse(log.before_data) as Record<string, unknown>;
    const afterData = JSON.parse(log.after_data) as Record<string, unknown>;
    // `before` refleja el estado ANTERIOR y `after` el nuevo, campo a campo.
    expect(beforeData['city']).toBe(beforeCity ?? null);
    expect(afterData['city']).toBe('Bogotá D.C.');
    expect(afterData['resource']).toBe('business');
    // Y el snapshot es la configuración COMPLETA, no sólo lo que cambió.
    expect(Object.hasOwn(afterData, 'taxRateBp')).toBe(true);
    expect(Object.hasOwn(afterData, 'currencyCode')).toBe(true);
  });

  it('cambiar la zona horaria devuelve el aviso TIMEZONE_CHANGED (API.md 7.4)', async () => {
    const response = await patch('/api/v1/business', { timezone: 'America/Lima' }, adminToken).expect(200);
    expect(response.body.data.timezone).toBe('America/Lima');
    expect(response.body.meta.warnings).toContain('TIMEZONE_CHANGED');
    // Se restaura para no arrastrar el cambio al resto de la suite.
    await patch('/api/v1/business', { timezone: BOGOTA }, adminToken).expect(200);
  });

  it('una zona horaria inexistente es 422 INVALID_TIMEZONE, no un 500', async () => {
    const response = await patch('/api/v1/business', { timezone: 'Marte/Olympus_Mons' }, adminToken).expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('INVALID_TIMEZONE');
  });

  it('`id` NO es un campo editable: 400 UNKNOWN_FIELD (API.md 1)', async () => {
    const response = await patch('/api/v1/business', { id: 7, name: 'Otro' }, adminToken).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].path).toBe('id');
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
  });

  it('exige al menos un campo en el cuerpo', async () => {
    const response = await patch('/api/v1/business', {}, adminToken).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('bloquea el cambio de moneda si ya hay pedidos (BR-BUS-002)', async () => {
    // Un pedido mínimo y real: `orders` guarda importes sin moneda, así que
    // reinterpretar el histórico en otra moneda sería falsificarlo.
    ctx.db
      .prepare(
        `INSERT INTO orders (business_id, order_number, status, channel)
         VALUES (1, 'ORD-MONEDA-1', 'PENDING', 'POS')`,
      )
      .run();

    try {
      const response = await patch('/api/v1/business', { currencyCode: 'USD' }, adminToken).expect(409);
      expect(response.body.error.code).toBe('CONFLICT_ERROR');
      expect(response.body.error.details.code).toBe('CURRENCY_CHANGE_BLOCKED');
      expect(response.body.error.details.orders).toBeGreaterThan(0);

      const current = await get('/api/v1/business', adminToken).expect(200);
      expect(current.body.data.currencyCode).toBe('COP');
    } finally {
      ctx.db.prepare(`DELETE FROM orders WHERE order_number = 'ORD-MONEDA-1'`).run();
    }
  });
});

// ===========================================================================
// Horario
// ===========================================================================

describe('Horario del negocio', () => {
  it('PUT /hours con apertura posterior al cierre y is_closed=false es 422', async () => {
    // Semana completa y válida salvo un día, para que el 422 sea el de la franja
    // incoherente y no el de "faltan días".
    const days = weekAllDays('08:00', '20:00');
    const diaIncoherente = days[1];
    if (diaIncoherente === undefined) {
      throw new Error('La semana de prueba debe tener siete días');
    }
    days[1] = { ...diaIncoherente, opensAt: '20:00', closesAt: '08:00' };
    const response = await patchHours(days);
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('INVALID_HOURS_RANGE');
  });

  it('PUT /hours con una semana incompleta es 400 INCOMPLETE_WEEK', async () => {
    const response = await patchHours(
      [
        { dayOfWeek: 0, opensAt: '08:00', closesAt: '20:00', isClosed: false },
        { dayOfWeek: 1, opensAt: '08:00', closesAt: '20:00', isClosed: false },
      ],
    );
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('INCOMPLETE_WEEK');
  });

  it('PUT /hours con un día repetido es 400 DUPLICATE_DAY_OF_WEEK', async () => {
    const days = weekAllDays('08:00', '20:00');
    const repetido = days[3];
    if (repetido !== undefined) {
      days[3] = { ...repetido, dayOfWeek: 2 };
    }
    const response = await patchHours(days);
    expect(response.status).toBe(400);
    expect(response.body.error.details[0].code).toBe('DUPLICATE_DAY_OF_WEEK');
  });

  it('PUT /hours sin permiso es 403 (un CUSTOMER no abre el mostrador)', async () => {
    await put('/api/v1/business/hours', { hours: weekAllDays('08:00', '20:00') }, customerToken).expect(403);
  });

  it('PUT /hours reemplaza los 7 días, los ordena y es idempotente', async () => {
    const first = await put(
      '/api/v1/business/hours',
      { hours: weekAllDays('09:00', '18:00') },
      adminToken,
    ).expect(200);
    expect(first.body.data).toHaveLength(7);
    expect(first.body.data.map((day: { dayOfWeek: number }) => day.dayOfWeek)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(first.body.data[0].opensAt).toBe('09:00');

    // Segunda llamada con el mismo contenido: sigue habiendo 7 filas (upsert).
    await put('/api/v1/business/hours', { hours: weekAllDays('09:00', '18:00') }, adminToken).expect(200);
    const rows = ctx.db
      .prepare('SELECT COUNT(*) AS total FROM business_hours WHERE business_id = 1')
      .get() as { total: number };
    expect(rows.total).toBe(7);

    // Un día marcado como cerrado puede llevar cualquier par de horas: no hay
    // franja que validar cuando no se abre.
    const withClosed = weekAllDays('08:00', '20:00');
    withClosed[0] = { dayOfWeek: 0, opensAt: '20:00', closesAt: '08:00', isClosed: true };
    const third = await put('/api/v1/business/hours', { hours: withClosed }, adminToken).expect(200);
    expect(third.body.data[0].isClosed).toBe(true);
    expect(third.body.data[0].opensAt).toBe('20:00');

    const read = await get('/api/v1/business/hours', adminToken).expect(200);
    expect(read.body.data).toHaveLength(7);
  });

  it('GET /hours exige `business:read` (no es lectura pública)', async () => {
    await get('/api/v1/business/hours').expect(401);
  });
});

// ===========================================================================
// Festivos
// ===========================================================================

describe('Días festivos', () => {
  it('crea un festivo y un duplicado en la misma fecha es 409 HOLIDAY_ALREADY_EXISTS', async () => {
    const created = await post(
      '/api/v1/business/holidays',
      { holidayDate: '2026-12-25', name: 'Navidad' },
      adminToken,
    ).expect(201);
    expect(created.body.data.holidayDate).toBe('2026-12-25');
    expect(created.body.data.isClosed).toBe(true);

    const duplicate = await post(
      '/api/v1/business/holidays',
      { holidayDate: '2026-12-25', name: 'Navidad (otro nombre)' },
      adminToken,
    ).expect(409);
    expect(duplicate.body.error.code).toBe('CONFLICT_ERROR');
    expect(duplicate.body.error.details.code).toBe('HOLIDAY_ALREADY_EXISTS');
  });

  it('rechaza una fecha que no existe en el calendario', async () => {
    const response = await post(
      '/api/v1/business/holidays',
      { holidayDate: '2026-02-30', name: 'Día imposible' },
      adminToken,
    ).expect(400);
    expect(response.body.error.details[0].path).toBe('holidayDate');
  });

  it('borra un festivo y deja de estar en el listado', async () => {
    const created = await post(
      '/api/v1/business/holidays',
      { holidayDate: '2026-07-20', name: 'Día de la Independencia' },
      adminToken,
    ).expect(201);
    const id = Number(created.body.data.id);

    const deleted = await del(`/api/v1/business/holidays/${id}`, adminToken).expect(200);
    expect(deleted.body.data.id).toBe(id);
    expect(typeof deleted.body.data.deletedAt).toBe('string');

    const list = await get('/api/v1/business/holidays?pageSize=100', adminToken).expect(200);
    const dates = (list.body.data as { holidayDate: string }[]).map((row) => row.holidayDate);
    expect(dates).not.toContain('2026-07-20');
  });

  it('borrar un festivo inexistente es 404 y crearlo sin permiso es 403', async () => {
    await del('/api/v1/business/holidays/999999', adminToken).expect(404);
    await post('/api/v1/business/holidays', { holidayDate: '2027-01-01', name: 'Año nuevo' }, customerToken).expect(403);
  });
});

// ===========================================================================
// GET /api/v1/business/status — ¿abierto ahora?
// ===========================================================================

describe('Estado del local (GET /api/v1/business/status)', () => {
  it('es público y responde 200 sin token', async () => {
    const response = await get('/api/v1/business/status').expect(200);
    expect(typeof response.body.data.isOpen).toBe('boolean');
    expect(response.body.data.timezone).toBe(BOGOTA);
    expect(typeof response.body.data.localDate).toBe('string');
    expect(typeof response.body.data.localTime).toBe('string');
    expect(typeof response.body.data.dayOfWeek).toBe('number');
  });

  it('con reloj INYECTADO dice abierto dentro del horario y cerrado fuera', () => {
    const service = getBusinessServices().business;
    // Semana idéntica los 7 días: el resultado no depende del día de la semana.
    const week = weekAllDays('08:00', '20:00');
    service.replaceHours(week, adminContext());

    // 15:00 UTC = 10:00 en Bogotá: dentro de 08:00-20:00 -> ABIERTO.
    const mediodia = service.getStatus(new Date('2026-03-14T15:00:00.000Z'));
    expect(mediodia.localTime).toBe('10:00');
    expect(mediodia.dayOfWeek).toBe(6);
    expect(mediodia.isOpen).toBe(true);
    expect(reasonOf(mediodia.reason)).toBe('OPEN');
    expect(mediodia.opensAt).toBe('08:00');
    expect(mediodia.closesAt).toBe('20:00');
    // El próximo cambio es el cierre de hoy, en UTC.
    expect(mediodia.nextChangeAt).toBe('2026-03-15T01:00:00.000Z');

    // 02:00 UTC del día siguiente = 21:00 en Bogotá del día anterior: CERRADO.
    const noche = service.getStatus(new Date('2026-03-15T02:00:00.000Z'));
    expect(noche.localTime).toBe('21:00');
    expect(noche.dayOfWeek).toBe(6);
    expect(noche.isOpen).toBe(false);
    expect(reasonOf(noche.reason)).toBe('CLOSED_SCHEDULE');
    // Abre a las 08:00 de la mañana siguiente: 13:00 UTC.
    expect(noche.nextChangeAt).toBe('2026-03-15T13:00:00.000Z');
  });

  it('un día marcado como cerrado responde CLOSED_SCHEDULE', () => {
    const service = getBusinessServices().business;
    const days = weekAllDays('08:00', '20:00');
    service.replaceHours(days, adminContext());

    // Domingo cerrado: 2026-03-15 es domingo.
    const domingo = days.map((day) =>
      day.dayOfWeek === 0 ? { ...day, isClosed: true } : day,
    );
    service.replaceHours(domingo, adminContext());

    const estado = service.getStatus(new Date('2026-03-15T16:00:00.000Z')); // 11:00 en Bogotá
    expect(estado.dayOfWeek).toBe(0);
    expect(estado.isOpen).toBe(false);
    expect(reasonOf(estado.reason)).toBe('CLOSED_SCHEDULE');
    expect(estado.opensAt).toBeNull();
    expect(estado.closesAt).toBeNull();
  });

  it('un festivo de HOY cierra el local aunque el horario diga abierto', async () => {
    const service = getBusinessServices().business;
    service.replaceHours(weekAllDays('08:00', '20:00'), adminContext());

    const today = localToday();
    const created = await post(
      '/api/v1/business/holidays',
      { holidayDate: today, name: 'Festivo de prueba' },
      adminToken,
    ).expect(201);

    try {
      const response = await get('/api/v1/business/status').expect(200);
      expect(response.body.data.isOpen).toBe(false);
      expect(reasonOf(response.body.data.reason)).toBe('CLOSED_HOLIDAY');
      expect(response.body.data.holiday.name).toBe('Festivo de prueba');
    } finally {
      await del(`/api/v1/business/holidays/${Number(created.body.data.id)}`, adminToken).expect(200);
    }
  });

  it('un horario 24 horas (apertura = cierre) deja el local abierto siempre', async () => {
    // Por HTTP, para comprobar también el endpoint y no sólo el service.
    await put('/api/v1/business/hours', { hours: weekAllDays('00:00', '00:00') }, adminToken).expect(200);
    const response = await get('/api/v1/business/status').expect(200);
    expect(response.body.data.isOpen).toBe(true);
    expect(response.body.data.opensAt).toBe('00:00');
  });
});

// --------------------------------------------------------------------------
// Utilidades de las pruebas
// --------------------------------------------------------------------------

/** `PUT /api/v1/business/hours` que devuelve la respuesta sin comprobar el status. */
async function patchHours(days: unknown[]): Promise<request.Response> {
  return put('/api/v1/business/hours', { hours: days }, adminToken);
}

/** `PUT`/`POST`/`PATCH` con token y cuerpo, devolviendo la respuesta cruda. */
function put(path: string, body: object, token?: string): request.Test {
  return (token === undefined ? agent.put(path) : agent.put(path).set('Authorization', `Bearer ${token}`)).send(body);
}

/**
 * Contexto de service para el reloj inyectado.
 *
 * Los `PUT /hours` que preceden a las pruebas de estado se hacen por el service
 * (y no por HTTP) precisamente para NO depender de la hora real: el service
 * acepta un instante explícito y estas pruebas fijan las suyas.
 */
function adminContext() {
  return {
    actor: {
      id: 1,
      email: 'admin@lattecoffe.co',
      fullName: 'Administrador',
      businessId: 1,
      status: 'ACTIVE' as const,
      isStaff: true,
      roles: ['ADMIN' as const],
      permissions: [] as string[],
    },
    request: { ipAddress: null, userAgent: null, requestId: null },
  };
}

/** Lee el motivo del estado como texto, para comparar en las aserciones. */
function reasonOf(reason: unknown): string {
  return String(reason);
}
