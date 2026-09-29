/**
 * Pruebas de la bandeja de notificaciones: alcance por usuario, idempotencia del
 * marcado, contador de no leídas, preferencias y respeto de la franja silenciosa
 * al ENCOLAR.
 *
 * ============================== POR QUÉ ESTE FICHERO MONTA SU PROPIA APP ====
 * `modules/index.ts` lo cablea el agente integrador y este agente no lo toca, así
 * que el router de notificaciones todavía NO está en el árbol de la aplicación.
 * Para que estas pruebas ejerciten la CADENA REAL (los mismos middlewares, los
 * mismos services, el mismo SQL y la misma base en memoria del harness) y no una
 * versión recortada, se monta el router del módulo sobre el `createApiV1Router()`
 * que ya exporta `modules/index.ts`. En cuanto el integrador lo registre en
 * `MODULE_ROUTERS`, estas pruebas siguen funcionando sin cambios.
 *
 * Las altas NO se hacen por HTTP (no hay endpoint público de envío: no hay
 * pasarela de notificaciones niPush): se hacen llamando a
 * `NotificationsService.enqueue`, que es EXACTAMENTE la API que usarán los
 * módulos de pedidos y reservas. Así la prueba del encolado y la prueba de la
 * bandeja comparten la misma puerta de entrada que el sistema usará en producción.
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
import { notificationsRouter } from '../src/modules/notifications/notifications.routes.js';
import { getNotificationsService } from '../src/modules/notifications/notifications.container.js';
import { NotificationType } from '../src/shared/domain/index.js';
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
let customerId: number;
let otherCustomerToken: string;
let otherCustomerId: number;

/** Servicio de encolado: el mismo que usarán pedidos y reservas. */
const notifier = getNotificationsService();

/**
 * App de pruebas con el router de notificaciones montado (ver cabecera).
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
  api.use('/notifications', notificationsRouter);
  app.use(API_PREFIX, api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

/** Peticiones con `Authorization: Bearer`, misma firma que los atajos del harness. */
function get(path: string, token?: string): request.Test {
  return token === undefined ? agent.get(path) : agent.get(path).set('Authorization', `Bearer ${token}`);
}
function post(path: string, body?: object, token?: string): request.Test {
  return (token === undefined ? agent.post(path) : agent.post(path).set('Authorization', `Bearer ${token}`)).send(body ?? {});
}
function put(path: string, body: object, token?: string): request.Test {
  return (token === undefined ? agent.put(path) : agent.put(path).set('Authorization', `Bearer ${token}`)).send(body);
}

/** Registra un cliente nuevo y devuelve su token y su id. */
async function registerCustomer(prefix: string): Promise<{ token: string; id: number }> {
  const email = ctx.uniqueEmail(prefix);
  const response = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: `Cliente ${prefix}` })
    .expect(201);
  return {
    token: String(response.body.data.accessToken),
    id: Number(response.body.data.user.id),
  };
}

/** Encola una notificación IN_APP y devuelve su id. */
function enqueueInApp(userId: number, type: NotificationType, title: string): number {
  return notifier.enqueue({
    userId,
    type,
    title,
    body: `Cuerpo de prueba: ${title}`,
  }).id;
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeNotificationsTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  // La semilla de despliegue no trae cuentas CUSTOMER (ver harness).
  const first = await registerCustomer('notif-cliente');
  customerToken = first.token;
  customerId = first.id;
  const second = await registerCustomer('notif-otro');
  otherCustomerToken = second.token;
  otherCustomerId = second.id;
});

afterAll(() => {
  ctx.close();
});

// ===========================================================================
// Bandeja: alcance por usuario
// ===========================================================================

describe('Bandeja de notificaciones', () => {
  it('sin token es 401 en TODOS los endpoints del módulo', async () => {
    await get('/api/v1/notifications').expect(401);
    await get('/api/v1/notifications/unread-count').expect(401);
    await get('/api/v1/notifications/preferences').expect(401);
    await put('/api/v1/notifications/preferences', { push: false }).expect(401);
    await post('/api/v1/notifications/1/read').expect(401);
    await post('/api/v1/notifications/read-all').expect(401);
  });

  it('un CUSTOMER ve SÓLO sus notificaciones, nunca las de otro', async () => {
    const mia = enqueueInApp(customerId, NotificationType.ORDER_CONFIRMED, 'Pedido confirmado');
    const ajena = enqueueInApp(otherCustomerId, NotificationType.ORDER_CONFIRMED, 'Pedido ajeno');

    const response = await get('/api/v1/notifications?pageSize=100', customerToken).expect(200);
    const ids = (response.body.data as { id: number }[]).map((row) => row.id);
    expect(ids).toContain(mia);
    expect(ids).not.toContain(ajena);

    // Y la fila ajena existe de verdad: el filtro es del servidor, no del cliente.
    const filaAjena = ctx.db
      .prepare('SELECT user_id FROM notifications WHERE id = ?')
      .get(ajena) as { user_id: number };
    expect(filaAjena.user_id).toBe(otherCustomerId);
  });

  it('un CUSTOMER NO puede pedir la bandeja de otro con ?userId=: 404 (BR-SEC-011)', async () => {
    const response = await get(`/api/v1/notifications?userId=${customerId}`, otherCustomerToken).expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
  });

  it('el personal SÍ puede consultar la bandeja de un usuario (BR-SEC-011)', async () => {
    const response = await get(`/api/v1/notifications?userId=${customerId}&pageSize=100`, adminToken).expect(200);
    expect((response.body.data as { id: number }[]).length).toBeGreaterThan(0);
  });

  it('filtra por `type` y por lectura (`read=false` deja sólo las no leídas)', async () => {
    const idPedido = enqueueInApp(customerId, NotificationType.ORDER_READY, 'Pedido listo');
    enqueueInApp(customerId, NotificationType.RESERVATION_CONFIRMED, 'Reserva confirmada');
    await post(`/api/v1/notifications/${idPedido}/read`, {}, customerToken).expect(200);

    const porTipo = await get(`/api/v1/notifications?type=${NotificationType.ORDER_READY}`, customerToken).expect(200);
    const tipos = (porTipo.body.data as { type: string }[]).map((row) => row.type);
    expect(tipos.every((tipo) => tipo === NotificationType.ORDER_READY)).toBe(true);

    const noLeidas = await get('/api/v1/notifications?read=false&pageSize=100', customerToken).expect(200);
    const estados = (noLeidas.body.data as { status: string }[]).map((row) => row.status);
    expect(estados.every((estado) => estado !== 'READ')).toBe(true);
    expect(estados).not.toContain('READ');

    const leidas = await get(`/api/v1/notifications?read=true&pageSize=100`, customerToken).expect(200);
    const estadosLeidos = (leidas.body.data as { status: string }[]).map((row) => row.status);
    expect(estadosLeidos.every((estado) => estado === 'READ')).toBe(true);
  });

  it('filtros contradictorios (`read` y `status`) son 400, no una decisión del servidor', async () => {
    const response = await get('/api/v1/notifications?read=true&status=PENDING', customerToken).expect(400);
    expect(response.body.error.details[0].code).toBe('CONFLICTING_FILTERS');
  });

  it('pagina y devuelve `meta.unreadCount` (API.md 7.17)', async () => {
    const response = await get('/api/v1/notifications?pageSize=2&page=1', customerToken).expect(200);
    expect((response.body.data as unknown[]).length).toBeLessThanOrEqual(2);
    expect(response.body.meta.page).toBe(1);
    expect(response.body.meta.pageSize).toBe(2);
    expect(typeof response.body.meta.total).toBe('number');
    expect(typeof response.body.meta.unreadCount).toBe('number');
  });
});

// ===========================================================================
// Marcar como leída
// ===========================================================================

describe('Marcar notificaciones como leídas', () => {
  it('marcar leída la notificación de OTRO usuario es 404 y no la toca', async () => {
    const ajena = enqueueInApp(otherCustomerId, NotificationType.PAYMENT_SUCCESS, 'Pago ajeno');

    const response = await post(`/api/v1/notifications/${ajena}/read`, {}, customerToken).expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');

    // La fila sigue sin leerse: el 404 no ha escrito nada.
    const fila = ctx.db
      .prepare('SELECT status, read_at FROM notifications WHERE id = ?')
      .get(ajena) as { status: string; read_at: string | null };
    expect(fila.status).not.toBe('READ');
    expect(fila.read_at).toBeNull();
  });

  it('es idempotente (BR-NOTIF-004): repetir devuelve 200 sin cambiar `readAt`', async () => {
    const id = enqueueInApp(customerId, NotificationType.ORDER_CONFIRMED, 'Idempotencia');

    const primera = await post(`/api/v1/notifications/${id}/read`, {}, customerToken).expect(200);
    expect(primera.body.data.status).toBe('READ');
    expect(typeof primera.body.data.readAt).toBe('string');

    const segunda = await post(`/api/v1/notifications/${id}/read`, {}, customerToken).expect(200);
    expect(segunda.body.data.status).toBe('READ');
    expect(segunda.body.data.readAt).toBe(primera.body.data.readAt);
  });

  it('una notificación inexistente es 404', async () => {
    await post('/api/v1/notifications/999999/read', {}, customerToken).expect(404);
  });

  it('`unread-count` es una agregación: refleja altas y marcados', async () => {
    // Se empieza de cero para que el número sea comprobable de punta a punta.
    await post('/api/v1/notifications/read-all', {}, otherCustomerToken).expect(200);
    const inicial = await get('/api/v1/notifications/unread-count', otherCustomerToken).expect(200);
    expect(inicial.body.data.total).toBe(0);

    const a = enqueueInApp(otherCustomerId, NotificationType.ORDER_CONFIRMED, 'A');
    enqueueInApp(otherCustomerId, NotificationType.RESERVATION_UPCOMING, 'B');
    enqueueInApp(otherCustomerId, NotificationType.RESERVATION_TIME_ENDING, 'C');

    const conTres = await get('/api/v1/notifications/unread-count', otherCustomerToken).expect(200);
    expect(conTres.body.data.total).toBe(3);
    expect(conTres.body.data.byType).toEqual({
      [NotificationType.ORDER_CONFIRMED]: 1,
      [NotificationType.RESERVATION_UPCOMING]: 1,
      [NotificationType.RESERVATION_TIME_ENDING]: 1,
    });
    expect(conTres.body.data.byChannel).toEqual({ IN_APP: 3 });

    await post(`/api/v1/notifications/${a}/read`, {}, otherCustomerToken).expect(200);

    const conDos = await get('/api/v1/notifications/unread-count', otherCustomerToken).expect(200);
    expect(conDos.body.data.total).toBe(2);
    expect(Object.hasOwn(conDos.body.data.byType, NotificationType.ORDER_CONFIRMED)).toBe(false);
  });

  it('`read-all` marca TODAS las del usuario y sólo las suyas', async () => {
    // Se limpian las bandejas de los dos clientes para que el número sea exacto.
    await post('/api/v1/notifications/read-all', {}, customerToken).expect(200);
    await post('/api/v1/notifications/read-all', {}, otherCustomerToken).expect(200);

    const mia1 = enqueueInApp(customerId, NotificationType.ORDER_CONFIRMED, 'Mía 1');
    const mia2 = enqueueInApp(customerId, NotificationType.SYSTEM, 'Mía 2');
    const ajena = enqueueInApp(otherCustomerId, NotificationType.SYSTEM, 'Ajena');

    const response = await post('/api/v1/notifications/read-all', {}, customerToken).expect(200);
    expect(response.body.data.updated).toBe(2);
    expect(response.body.data.unreadCount).toBe(0);

    // Las del cliente quedan leídas...
    const mias = ctx.db
      .prepare(
        `SELECT status FROM notifications WHERE id IN (?, ?) ORDER BY id ASC`,
      )
      .all(mia1, mia2) as { status: string }[];
    expect(mias.map((row) => row.status)).toEqual(['READ', 'READ']);

    // ... y la del otro cliente NO: read-all es del actor, nunca global.
    const otra = ctx.db
      .prepare('SELECT status FROM notifications WHERE id = ?')
      .get(ajena) as { status: string };
    expect(otra.status).not.toBe('READ');

    // Repetir el read-all no cuenta nada nuevo.
    const repetido = await post('/api/v1/notifications/read-all', {}, customerToken).expect(200);
    expect(repetido.body.data.updated).toBe(0);
    expect(repetido.body.data.unreadCount).toBe(0);
  });

  it('`read-all` puede acotarse por tipo', async () => {
    await post('/api/v1/notifications/read-all', {}, customerToken).expect(200);
    enqueueInApp(customerId, NotificationType.ORDER_CONFIRMED, 'Pedido');
    enqueueInApp(customerId, NotificationType.SYSTEM, 'Aviso');

    const response = await post(
      '/api/v1/notifications/read-all',
      { type: NotificationType.ORDER_CONFIRMED },
      customerToken,
    ).expect(200);
    expect(response.body.data.updated).toBe(1);
    expect(response.body.data.unreadCount).toBe(1);
  });

  it('rechaza un tipo de notificación que no existe en el enum', async () => {
    const response = await post(
      '/api/v1/notifications/read-all',
      { type: 'PEDIDO_INVENTADO' },
      customerToken,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// Preferencias
// ===========================================================================

describe('Preferencias de notificación', () => {
  it('GET crea la fila con los valores por defecto si no existe (BR-NOTIF-005)', async () => {
    const id = await registerCustomer('notif-prefs');
    const antes = ctx.db
      .prepare('SELECT COUNT(*) AS total FROM notification_preferences WHERE user_id = ?')
      .get(id.id) as { total: number };
    expect(antes.total).toBe(0);

    const response = await get('/api/v1/notifications/preferences', id.token).expect(200);
    expect(response.body.data).toEqual({
      inApp: true,
      push: true,
      email: false,
      sms: false,
      whatsapp: false,
      quietHoursFrom: null,
      quietHoursTo: null,
    });

    const despues = ctx.db
      .prepare('SELECT COUNT(*) AS total FROM notification_preferences WHERE user_id = ?')
      .get(id.id) as { total: number };
    expect(despues.total).toBe(1);
  });

  it('PUT guarda y GET lee las preferencias del usuario (sólo las suyas)', async () => {
    const id = await registerCustomer('notif-prefs-put');

    const guardadas = await put(
      '/api/v1/notifications/preferences',
      { push: false, email: true, sms: true, whatsapp: true, quietHoursFrom: '22:00', quietHoursTo: '07:00' },
      id.token,
    ).expect(200);
    expect(guardadas.body.data).toEqual({
      inApp: true,
      push: false,
      email: true,
      sms: true,
      whatsapp: true,
      quietHoursFrom: '22:00',
      quietHoursTo: '07:00',
    });

    const leidas = await get('/api/v1/notifications/preferences', id.token).expect(200);
    expect(leidas.body.data).toEqual(guardadas.body.data);

    // Un `PUT` parcial no borra lo anterior: es un PUT sobre un recurso con
    // campos opcionales, no un reemplazo completo.
    const parcial = await put('/api/v1/notifications/preferences', { push: true }, id.token).expect(200);
    expect(parcial.body.data.push).toBe(true);
    expect(parcial.body.data.email).toBe(true);
    expect(parcial.body.data.quietHoursFrom).toBe('22:00');

    // Y las preferencias de otro usuario no se tocan.
    const ajenas = await get('/api/v1/notifications/preferences', adminToken).expect(200);
    expect(ajenas.body.data.push).toBe(true);
    expect(ajenas.body.data.email).toBe(false);
  });

  it('`inApp = false` es 422 IN_APP_REQUIRED (API.md 7.17)', async () => {
    const id = await registerCustomer('notif-inapp');
    const response = await put('/api/v1/notifications/preferences', { inApp: false }, id.token).expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('IN_APP_REQUIRED');
  });

  it('la franja silenciosa va completa o no va: 400 QUIET_HOURS_INCOMPLETE', async () => {
    const id = await registerCustomer('notif-quiet');

    const sinTope = await put('/api/v1/notifications/preferences', { quietHoursFrom: '22:00' }, id.token).expect(400);
    expect(sinTope.body.error.details[0].code).toBe('QUIET_HOURS_INCOMPLETE');

    const sinInicio = await put('/api/v1/notifications/preferences', { quietHoursTo: '07:00' }, id.token).expect(400);
    expect(sinInicio.body.error.details[0].code).toBe('QUIET_HOURS_INCOMPLETE');

    // Quitar la franja completa también vale (los dos a la vez).
    await put(
      '/api/v1/notifications/preferences',
      { quietHoursFrom: null, quietHoursTo: null },
      id.token,
    ).expect(200);
    const leidas = await get('/api/v1/notifications/preferences', id.token).expect(200);
    expect(leidas.body.data.quietHoursFrom).toBeNull();
    expect(leidas.body.data.quietHoursTo).toBeNull();
  });

  it('una hora que no es HH:MM es 400 y no llega a la base de datos', async () => {
    const id = await registerCustomer('notif-hora');
    const response = await put(
      '/api/v1/notifications/preferences',
      { quietHoursFrom: '22h00', quietHoursTo: '07:00' },
      id.token,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// Encolado: canales, franja silenciosa y reutilización por otros módulos
// ===========================================================================

describe('Encolado de notificaciones (API compartida de NotificationsService)', () => {
  it('IN_APP se persiste SIEMPRE, incluso dentro de la franja silenciosa (BR-NOTIF-003)', async () => {
    const id = await registerCustomer('notif-inapp-cola');
    await put(
      '/api/v1/notifications/preferences',
      { quietHoursFrom: '00:00', quietHoursTo: '23:59' },
      id.token,
    ).expect(200);

    // 03:00 UTC = 22:00 en Bogotá: dentro de la franja 00:00-23:59.
    const resultado = notifier.enqueue({
      userId: id.id,
      type: NotificationType.SYSTEM,
      title: 'Aviso dentro de la franja',
      body: 'Debe llegar igualmente: la bandeja dentro de la app es el historial.',
      at: '2026-03-14T03:00:00.000Z',
    });

    expect(resultado.delivered).toBe(true);
    expect(resultado.reason).toBeNull();
    expect(resultado.status).toBe('SENT');
    expect(resultado.sentAt).toBe('2026-03-14T03:00:00.000Z');

    const fila = ctx.db
      .prepare('SELECT status, sent_at FROM notifications WHERE id = ?')
      .get(resultado.id) as { status: string; sent_at: string | null };
    expect(fila.status).toBe('SENT');
    expect(fila.sent_at).toBe('2026-03-14T03:00:00.000Z');
  });

  it('un canal externo dentro de la franja silenciosa queda en cola, NO enviado (BR-NOTIF-002)', async () => {
    const id = await registerCustomer('notif-push');
    await put(
      '/api/v1/notifications/preferences',
      { push: true, quietHoursFrom: '20:00', quietHoursTo: '08:00' },
      id.token,
    ).expect(200);

    // 03:00 UTC = 22:00 en Bogotá: dentro de la franja 20:00-08:00 (cruza medianoche).
    const resultado = notifier.enqueue({
      userId: id.id,
      type: NotificationType.RESERVATION_UPCOMING,
      title: 'Tu reserva empieza en una hora',
      body: 'Te esperamos.',
      channel: 'PUSH',
      at: '2026-03-14T03:00:00.000Z',
    });

    expect(resultado.delivered).toBe(false);
    expect(resultado.reason).toBe('QUIET_HOURS');
    expect(resultado.status).toBe('PENDING');
    expect(resultado.sentAt).toBeNull();

    const fila = ctx.db
      .prepare('SELECT status, sent_at, channel FROM notifications WHERE id = ?')
      .get(resultado.id) as { status: string; sent_at: string | null; channel: string };
    expect(fila.status).toBe('PENDING');
    expect(fila.sent_at).toBeNull();
    expect(fila.channel).toBe('PUSH');

    // Fuera de la franja el mismo aviso sí se encolaría para envío, pero ningún
    // canal externo está implementado: la arquitectura está preparada y el envío
    // no existe (ver el informe de entrega).
    const fuera = notifier.enqueue({
      userId: id.id,
      type: NotificationType.RESERVATION_UPCOMING,
      title: 'Tu reserva empieza en una hora',
      body: 'Te esperamos.',
      channel: 'PUSH',
      at: '2026-03-14T16:00:00.000Z', // 11:00 en Bogotá
    });
    expect(fuera.reason).toBe('EXTERNAL_CHANNEL_NOT_IMPLEMENTED');
    expect(fuera.status).toBe('PENDING');
  });

  it('un canal externo apagado por el usuario ni se encola como enviado (BR-NOTIF-003)', async () => {
    const id = await registerCustomer('notif-email');
    await put('/api/v1/notifications/preferences', { email: false }, id.token).expect(200);

    const resultado = notifier.enqueue({
      userId: id.id,
      type: NotificationType.PAYMENT_FAILED,
      title: 'El pago falló',
      body: 'Revisa tus datos.',
      channel: 'EMAIL',
      at: '2026-03-14T16:00:00.000Z',
    });

    expect(resultado.reason).toBe('CHANNEL_DISABLED');
    expect(resultado.delivered).toBe(false);
  });

  it('encola para un pedido y guarda la referencia y el `data` ya parseado', async () => {
    // `notifications.order_id` tiene FK a `orders`: se crea un pedido mínimo y
    // REAL para que la referencia sea válida (FKs activadas, DESIGN.md 4.0).
    ctx.db
      .prepare(
        `INSERT INTO orders (business_id, order_number, status, channel)
         VALUES (1, 'ORD-NOTIF-1', 'PENDING', 'POS')`,
      )
      .run();
    const orderId = Number(
      (ctx.db.prepare(`SELECT id FROM orders WHERE order_number = 'ORD-NOTIF-1'`).get() as { id: number }).id,
    );

    try {
      const resultado = notifier.enqueue({
        userId: customerId,
        type: NotificationType.ORDER_CONFIRMED,
        title: 'Pedido confirmado',
        body: 'Estamos preparando tu pedido.',
        orderId,
        data: { orderNumber: 'ORD-NOTIF-1', totalMinor: 1_500_000 },
      });

      const response = await get(
        `/api/v1/notifications?type=${NotificationType.ORDER_CONFIRMED}`,
        customerToken,
      ).expect(200);
      const notificacion = (
        response.body.data as { id: number; orderId: number | null; data: unknown }[]
      ).find((row) => row.id === resultado.id);
      expect(notificacion).toBeDefined();
      expect(notificacion?.orderId).toBe(orderId);
      // `data` viaja PARSEADO, no como texto JSON (API.md 7.17).
      expect(notificacion?.data).toEqual({ orderNumber: 'ORD-NOTIF-1', totalMinor: 1_500_000 });
    } finally {
      // `ON DELETE CASCADE`: al borrar el pedido se va también su notificación.
      ctx.db.prepare(`DELETE FROM orders WHERE order_number = 'ORD-NOTIF-1'`).run();
    }
  });

  it('una entrada incoherente es un fallo ruidoso, no una notificación perdida', () => {
    expect(() =>
      notifier.enqueue({
        userId: 0,
        type: NotificationType.SYSTEM,
        title: 'Sin destinatario',
        body: 'No debe existir.',
      }),
    ).toThrow();
  });
});
