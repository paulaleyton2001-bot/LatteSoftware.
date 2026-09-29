/**
 * Pruebas del módulo de PAGOS: el cobro en local (efectivo y datáfono), la
 * idempotencia obligatoria, el cambio, el autocompletado del pedido y el
 * reembolso.
 *
 * ============================================================================
 * LA DECISIÓN QUE ESTAS PRUEBAS CONGELAN
 * ============================================================================
 * El negocio cobra TODO en el local, en efectivo o con tarjeta, y el cajero
 * registra el pago a mano. NO hay pasarela. Eso se comprueba aquí de tres
 * maneras que fallarían si alguien añadiera una integración sin darse cuenta:
 *  1. `GET /methods` devuelve EXACTAMENTE dos métodos.
 *  2. Un método distinto de `CASH`/`CARD` es un `400` con un mensaje que explica
 *     por qué no existe, no un 422 que sugiera que se puede activar.
 *  3. Un cobro con tarjeta NO lleva número de tarjeta: lleva la referencia de
 *     aprobación del datáfono, y es obligatoria.
 *
 * ============================================================================
 * POR QUÉ LA IDEMPOTENCIA ES EL TEST MÁS IMPORTANTE DE ESTE FICHERO
 * ============================================================================
 * El enunciado de `DESIGN.md` 8.7 lo dice mejor que nadie: "el pago mueve dinero,
 * el pedido no. Un pago duplicado es una pérdida invisible". Un reintento por red
 * con la misma `Idempotency-Key` tiene que devolver EL MISMO pago, con el mismo
 * `paymentNumber`, sin crear una segunda fila ni mover dos veces el saldo.
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
let managerToken: string;
let customerToken: string;
let customerId: number;

/** Contador de claves de idempotencia, para que cada test use la suya. */
let keySequence = 0;

/** Clave de idempotencia válida (UUID v4) y distinta en cada llamada. */
function idempotencyKey(): string {
  keySequence += 1;
  const tail = String(keySequence).padStart(12, '0');
  return `9f2c1a7b-4e3d-4c5a-8b12-${tail}`;
}

/** Constante de idempotencia para las pruebas que repiten la MISMA clave. */
const REPEATED_KEY = '11111111-2222-4333-8444-555555555555';

let sequence = 0;

function nextSeq(): number {
  sequence += 1;
  return sequence;
}

/** App de pruebas con los routers montados a mano (los registra el integrador). */
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

/** Lee un valor entero de un body JSON sin dejar `any`. */
function num(value: unknown): number {
  return Number(value);
}

/** Lee un objeto de un body JSON sin dejar `any`. */
function obj(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('El valor no es un objeto');
  }
  return value as Record<string, unknown>;
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffePaymentsTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');
  managerToken = await ctx.accessTokenFor('MANAGER');

  const customer = await ctx
    .post('/api/v1/auth/register', {
      email: ctx.uniqueEmail('pagos'),
      password: VALID_TEST_PASSWORD,
      fullName: 'Cliente Pagos',
    })
    .expect(201);
  customerToken = String(customer.body.data.accessToken);
  customerId = Number(customer.body.data.user.id);

  seedSpacesDemo();
});

afterAll(() => {
  ctx.close();
});

/** Producto de 10.000 (con 19 % de impuesto son 11.900). */
async function createProduct(basePriceMinor = 10_000): Promise<number> {
  const n = nextSeq();
  const response = await post(
    '/api/v1/products',
    { sku: `PAG-${String(n).padStart(4, '0')}`, name: `Producto pago ${n}`, basePriceMinor },
    adminToken,
  ).expect(201);
  return num(obj(response.body.data).id);
}

/** Pedido `PENDING` de un producto, listo para cobrar. */
async function createOrder(productId: number, quantity = 1, customer?: number): Promise<{ id: number; totalMinor: number }> {
  const response = await post(
    '/api/v1/orders',
    { type: 'TAKEAWAY', customerId: customer ?? customerId, items: [{ productId, quantity }] },
    cashierToken,
  ).expect(201);
  const order = obj(response.body.data);
  return { id: num(order.id), totalMinor: num(order.totalMinor) };
}

// ==========================================================================
// Métodos de pago
// ==========================================================================

describe('GET /api/v1/payments/methods', () => {
  it('devuelve EXACTAMENTE CASH y CARD: la decisión es cobro en local', async () => {
    const response = await get('/api/v1/payments/methods', cashierToken).expect(200);
    const methods = (response.body.data as Record<string, unknown>[]).map(obj);
    // El orden es el de la pantalla de cobro: efectivo primero, que es lo que se
    // usa el 90 % de las veces.
    expect(methods.map((entry) => entry.method)).toEqual(['CASH', 'CARD']);

    const cash = obj(methods.find((entry) => entry.method === 'CASH') ?? {});
    // En efectivo se puede entregar de más: eso es CAMBIO, no un favor.
    expect(cash.allowsOverpayment).toBe(true);
    expect(cash.requiresReference).toBe(false);
    expect(cash.enabled).toBe(true);

    const card = obj(methods.find((entry) => entry.method === 'CARD') ?? {});
    // Con datáfono no hay cambio: el dinero ya entró en la cuenta.
    expect(card.allowsOverpayment).toBe(false);
    expect(card.requiresReference).toBe(true);
  });

  it('NO expone TRANSFER ni ONLINE: la pasarela no existe', async () => {
    const response = await get('/api/v1/payments/methods', cashierToken).expect(200);
    const methods = (response.body.data as Record<string, unknown>[]).map(obj);
    for (const entry of methods) {
      expect(['CASH', 'CARD']).toContain(entry.method);
    }
  });
});

// ==========================================================================
// Idempotencia: el test más importante del módulo
// ==========================================================================

describe('POST /api/v1/payments — idempotencia (BR-PAY-001)', () => {
  it('sin Idempotency-Key es 400 y NO cobra', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const before = countPayments();

    const response = await post('/api/v1/payments', {
      orderId: order.id,
      method: 'CASH',
      amountMinor: order.totalMinor,
    }, cashierToken).expect(400);

    const details = response.body.error.details as { path: string; code: string }[];
    expect(details.some((detail) => detail.code === 'IDEMPOTENCY_KEY_REQUIRED')).toBe(true);
    // Y el saldo del pedido sigue intacto.
    expect(countPayments()).toBe(before);
    const detail = await get(`/api/v1/orders/${order.id}`, cashierToken).expect(200);
    expect(num(obj(detail.body.data).paidMinor)).toBe(0);
  });

  it('una clave repetida devuelve el MISMO pago, sin cobrar dos veces', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const before = countPayments();

    const first = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      REPEATED_KEY,
      cashierToken,
    ).expect(201);
    const firstPayment = obj(first.body.data);
    expect(firstPayment.paymentNumber).toMatch(/^PAY-\d{6}$/);
    expect(first.body.meta.idempotent).toBe(false);

    // La MISMA clave: 200 (no 201), el MISMO `paymentNumber` y `meta.idempotent`.
    const second = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      REPEATED_KEY,
      cashierToken,
    ).expect(200);
    expect(second.body.meta.idempotent).toBe(true);
    expect(obj(second.body.data).paymentNumber).toBe(firstPayment.paymentNumber);
    expect(num(obj(second.body.data).id)).toBe(num(firstPayment.id));

    // No se creó una segunda fila, y el pedido se pagó UNA vez.
    expect(countPayments()).toBe(before + 1);
    const detail = await get(`/api/v1/orders/${order.id}`, cashierToken).expect(200);
    expect(num(obj(detail.body.data).paidMinor)).toBe(order.totalMinor);
    expect(num(obj(detail.body.data).balanceMinor)).toBe(0);
  });

  it('una clave nueva para el mismo pedido con saldo 0 es 409 PAYMENT_ALREADY_PROCESSED', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);

    const response = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(409);
    expect(obj(response.body.error).details).toMatchObject({ code: 'PAYMENT_ALREADY_PROCESSED' });
  });
});

// ==========================================================================
// Efectivo
// ==========================================================================

describe('POST /api/v1/payments — efectivo (BR-MONEY-007/008)', () => {
  it('calcula el cambio y NO lo guarda como pago', async () => {
    const productId = await createProduct();
    // 10.000 + 19 % = 11.900.
    const order = await createOrder(productId);
    expect(order.totalMinor).toBe(11_900);

    // El cliente entrega 20.000 por un pedido de 11.900: cambio 8.100.
    const response = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: 20_000, receivedMinor: 20_000 },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    expect(response.body).toBeDefined();

    expect(num(response.body.meta.changeDueMinor)).toBe(8_100);
    const payment = obj(response.body.data);
    // Lo GUARDADO es el importe imputado (11.900), nunca el entregado: si se
    // guardara el recibido, `paid_minor` sería 20.000 y el saldo -8.100.
    expect(num(payment.amountMinor)).toBe(11_900);
    expect(payment.method).toBe('CASH');
    expect(payment.provider).toBe('CASH_REGISTRY');
    expect(payment.status).toBe('APPROVED');

    const detail = await get(`/api/v1/orders/${order.id}`, cashierToken).expect(200);
    expect(num(obj(detail.body.data).paidMinor)).toBe(11_900);
    expect(num(obj(detail.body.data).balanceMinor)).toBe(0);
  });

  it('el cambio de un reintento con la misma clave vuelve a mostrarse al cajero', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const key = idempotencyKey();

    await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: 20_000, receivedMinor: 20_000 },
      key,
      cashierToken,
    ).expect(201);

    // Si la primera respuesta se perdió, el cajero necesita saber que ya entregó
    // el cambio. Volver a entregarlo sería dar dinero dos veces.
    const retry = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: 20_000, receivedMinor: 20_000 },
      key,
      cashierToken,
    ).expect(200);
    expect(num(retry.body.meta.changeDueMinor)).toBe(8_100);
  });

  it('efectivo insuficiente NO deja cobro: la forma se rechaza antes de tocar la caja', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const before = countPayments();

    // El cajero dice cobrar 20.000 pero sólo entregó 5.000. El esquema lo detecta
    // sin necesidad de conocer el pedido: `receivedMinor < amountMinor` es una
    // incoherencia de la propia petición, así que es un `400` con el campo
    // señalado. El service tiene la misma comprobación como defensa (422
    // `INVALID_AMOUNT_FOR_METHOD`) para el caso de que la forma llegue por otra
    // vía.
    const response = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: 20_000, receivedMinor: 5_000 },
      idempotencyKey(),
      cashierToken,
    ).expect(400);
    const paths = (response.body.error.details as { path: string }[]).map((detail) => detail.path);
    expect(paths).toContain('receivedMinor');

    // Nada a medias: ni pago, ni saldo movido.
    expect(countPayments()).toBe(before);
    const detail = await get(`/api/v1/orders/${order.id}`, cashierToken).expect(200);
    expect(num(obj(detail.body.data).paidMinor)).toBe(0);
    expect(num(obj(detail.body.data).balanceMinor)).toBe(order.totalMinor);
  });

  it('admite un pago en efectivo PARCIAL y deja el resto pendiente', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId, 2); // 23.800

    const response = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: 10_000, receivedMinor: 10_000 },
      idempotencyKey(),
      cashierToken,
    ).expect(201);

    // El pago no completa el pedido: `orderCompleted` es `false`.
    expect(response.body.meta.orderCompleted).toBe(false);
    expect(num(response.body.meta.changeDueMinor)).toBe(0);
    const detail = await get(`/api/v1/orders/${order.id}`, cashierToken).expect(200);
    expect(num(obj(detail.body.data).paidMinor)).toBe(10_000);
    expect(num(obj(detail.body.data).balanceMinor)).toBe(13_800);
  });
});

// ==========================================================================
// Tarjeta (datáfono)
// ==========================================================================

describe('POST /api/v1/payments — tarjeta en el datáfono', () => {
  it('registra la referencia de aprobación del cajero, no un número de tarjeta', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);

    const response = await postWithKey(
      '/api/v1/payments',
      {
        orderId: order.id,
        method: 'CARD',
        amountMinor: order.totalMinor,
        // Referencia opaca que anota el cajero. NO es un PAN (BR-SEC-006).
        providerReference: 'AUT-778812',
        referenceNumber: 'VOUCHER-5521',
      },
      idempotencyKey(),
      cashierToken,
    ).expect(201);

    const payment = obj(response.body.data);
    expect(payment.method).toBe('CARD');
    expect(payment.providerReference).toBe('AUT-778812');
    // Con datáfono no hay cambio.
    expect(num(response.body.meta.changeDueMinor)).toBe(0);
    expect(response.body.meta.orderCompleted).toBe(true);
  });

  it('exige la referencia de aprobación: sin ella no hay conciliación', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);

    const response = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CARD', amountMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(400);
    const paths = (response.body.error.details as { path: string }[]).map((detail) => detail.path);
    expect(paths).toContain('providerReference');
  });

  it('con datáfono NO se admite efectivo recibido, ni cambio', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const response = await postWithKey(
      '/api/v1/payments',
      {
        orderId: order.id,
        method: 'CARD',
        amountMinor: order.totalMinor,
        providerReference: 'AUT-000111',
        receivedMinor: 50_000,
      },
      idempotencyKey(),
      cashierToken,
    ).expect(400);
    const paths = (response.body.error.details as { path: string }[]).map((detail) => detail.path);
    expect(paths).toContain('receivedMinor');
  });

  it('con datáfono, cobrar de más es 422 PAYMENT_EXCEEDS_TOTAL (BR-MONEY-008)', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const response = await postWithKey(
      '/api/v1/payments',
      {
        orderId: order.id,
        method: 'CARD',
        // 12.000 por un pedido de 11.900: no hay cambio con datáfono.
        amountMinor: 12_000,
        providerReference: 'AUT-000222',
      },
      idempotencyKey(),
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'PAYMENT_EXCEEDS_TOTAL' });
  });
});

// ==========================================================================
// Métodos no soportados
// ==========================================================================

describe('Métodos de pago no soportados', () => {
  it('TRANSFER, ONLINE y un método inexistente son 400 con el motivo', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);

    for (const method of ['TRANSFER', 'ONLINE', 'CRYPTO', 'cheque'] as const) {
      const response = await postWithKey(
        '/api/v1/payments',
        { orderId: order.id, method, amountMinor: order.totalMinor },
        idempotencyKey(),
        cashierToken,
      ).expect(400);
      const details = (response.body.error.details as { path: string; message: string }[]).find(
        (detail) => detail.path === 'method',
      );
      expect(details, ` faltaba el detalle de método para ${method}`).toBeDefined();
      expect(String(details?.message)).toMatch(/CASH o CARD/);
    }
  });

  it('un proveedor de pasarela (STRIPE, MERCADOPAGO, WOMPI, PAYU) se rechaza', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    for (const provider of ['STRIPE', 'MERCADOPAGO', 'WOMPI', 'PAYU'] as const) {
      const response = await postWithKey(
        '/api/v1/payments',
        { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, provider },
        idempotencyKey(),
        cashierToken,
      ).expect(400);
      const paths = (response.body.error.details as { path: string }[]).map((detail) => detail.path);
      expect(paths).toContain('provider');
    }
  });
});

// ==========================================================================
// Autocompletado y liberación
// ==========================================================================

describe('El cobro completo completa el pedido (BR-PAY-008)', () => {
  it('deja el pedido COMPLETED y registra la cadena de transiciones', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);

    const response = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    expect(response.body.meta.orderCompleted).toBe(true);

    const detail = await get(`/api/v1/orders/${order.id}`, cashierToken).expect(200);
    const data = obj(detail.body.data);
    expect(data.status).toBe('COMPLETED');
    expect(data.completedAt).not.toBeNull();

    // El historial refleja la cadena REAL: `PENDING -> CONFIRMED -> COMPLETED`, no
    // un salto, porque el pago confirma antes de entregar (BR-PAY-008).
    const history = await get(`/api/v1/orders/${order.id}/history?order=asc`, cashierToken).expect(200);
    const statuses = (history.body.data as Record<string, unknown>[]).map((entry) => obj(entry).toStatus);
    expect(statuses).toEqual(['PENDING', 'CONFIRMED', 'COMPLETED']);
  });

  it('un pedido ya CONFIRMED pasa a COMPLETED con un solo paso más', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    await post(`/api/v1/orders/${order.id}/confirm`, {}, cashierToken).expect(200);

    await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);

    const detail = await get(`/api/v1/orders/${order.id}`, cashierToken).expect(200);
    expect(obj(detail.body.data).status).toBe('COMPLETED');
  });

  it('no se puede cobrar un pedido en DRAFT (BR-PAY-008)', async () => {
    const productId = await createProduct();
    const draft = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [{ productId, quantity: 1 }], place: false },
      cashierToken,
    ).expect(201);
    const draftId = num(obj(draft.body.data).id);

    const response = await postWithKey(
      '/api/v1/payments',
      { orderId: draftId, method: 'CASH', amountMinor: 11_900, receivedMinor: 11_900 },
      idempotencyKey(),
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'ORDER_NOT_CONFIRMED' });
  });

  it('no se puede cobrar un pedido CANCELLED (BR-PAY-004)', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    await post(`/api/v1/orders/${order.id}/cancel`, { reason: 'Cliente se retiró' }, cashierToken).expect(200);

    const response = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: 11_900, receivedMinor: 11_900 },
      idempotencyKey(),
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'ORDER_NOT_PAYABLE' });
  });
});

// ==========================================================================
// Reembolsos
// ==========================================================================

describe('POST /api/v1/payments/:id/refund', () => {
  it('reembolsa parcialmente y deja el pago PARTIALLY_REFUNDED', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const payment = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    const paymentId = num(obj(payment.body.data).id);

    const response = await post(
      `/api/v1/payments/${paymentId}/refund`,
      { amountMinor: 4_000, reason: 'Producto devuelto' },
      managerToken,
    ).expect(201);

    const data = obj(response.body.data);
    expect(obj(data.payment).status).toBe('PARTIALLY_REFUNDED');
    expect(num(obj(data.payment).refundedMinor)).toBe(4_000);
    // El pedido vuelve a deber lo reembolsado.
    expect(num(obj(data).remainingBalanceMinor)).toBe(4_000);

    const detail = await get(`/api/v1/payments/${paymentId}`, managerToken).expect(200);
    expect((obj(detail.body.data).refunds as unknown[])).toHaveLength(1);
  });

  it('reembolsa el total y deja el pago REFUNDED', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const payment = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    const paymentId = num(obj(payment.body.data).id);

    const response = await post(
      `/api/v1/payments/${paymentId}/refund`,
      { amountMinor: order.totalMinor, reason: 'Devolución total' },
      managerToken,
    ).expect(201);
    const data = obj(response.body.data);
    expect(obj(data.payment).status).toBe('REFUNDED');
    expect(num(obj(data.payment).refundedMinor)).toBe(order.totalMinor);

    // El pedido vuelve a deber su importe (nadie lo pagó) y pasa a `REFUNDED`,
    // que es el único destino válido tras una devolución total de un pedido
    // entregado (`COMPLETED -> REFUNDED`, DESIGN.md 6.1).
    expect(num(obj(data).remainingBalanceMinor)).toBe(order.totalMinor);
    const refundedOrder = await get(`/api/v1/orders/${order.id}`, managerToken).expect(200);
    const orderData = obj(refundedOrder.body.data);
    expect(orderData.status).toBe('REFUNDED');
    expect(num(orderData.paidMinor)).toBe(0);
    // `completed_at` se conserva: el pedido SÍ se entregó antes de devolverse.
    expect(orderData.completedAt).not.toBeNull();

    // Y el historial deja constancia del reembolso con su motivo (BR-ORDER-013).
    const history = await get(`/api/v1/orders/${order.id}/history?order=asc`, managerToken).expect(200);
    const entries = (history.body.data as Record<string, unknown>[]).map(obj);
    const refundEntry = entries.find((entry) => entry.toStatus === 'REFUNDED');
    expect(refundEntry).toBeDefined();
    expect(String(refundEntry?.reason)).toContain('Devolución total');
  });

  it('NO se puede reembolsar más de lo cobrado (BR-PAY-006)', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const payment = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    const paymentId = num(obj(payment.body.data).id);

    const response = await post(
      `/api/v1/payments/${paymentId}/refund`,
      { amountMinor: order.totalMinor + 1, reason: 'Imposible' },
      managerToken,
    ).expect(422);
    const details = obj(response.body.error).details as Record<string, unknown>;
    expect(details.code).toBe('REFUND_EXCEEDS_PAID');
    expect(details.refundableMinor).toBe(order.totalMinor);
  });

  it('tras un reembolso parcial tampoco se puede pasar del total', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const payment = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    const paymentId = num(obj(payment.body.data).id);

    await post(`/api/v1/payments/${paymentId}/refund`, { amountMinor: 6_000, reason: 'Primera devolución' }, managerToken).expect(201);
    // Quedan 5.900 por devolver; pedir 6.000 más es imposible.
    const response = await post(
      `/api/v1/payments/${paymentId}/refund`,
      { amountMinor: 6_000, reason: 'Segunda devolución' },
      managerToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'REFUND_EXCEEDS_PAID' });
  });

  it('un reembolso exige motivo (BR-PAY-010)', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const payment = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    const paymentId = num(obj(payment.body.data).id);

    const response = await post(`/api/v1/payments/${paymentId}/refund`, { amountMinor: 1_000 }, managerToken).expect(400);
    const paths = (response.body.error.details as { path: string }[]).map((detail) => detail.path);
    expect(paths).toContain('reason');
  });

  it('un CASHIER no puede reembolsar: `payments:refund` es MANAGER+', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId);
    const payment = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    const paymentId = num(obj(payment.body.data).id);

    const forbidden = await post(
      `/api/v1/payments/${paymentId}/refund`,
      { amountMinor: 1_000, reason: 'intento' },
      cashierToken,
    ).expect(403);
    expect(obj(forbidden.body.error).details).toMatchObject({ required: 'payments:refund' });
  });

  it('un CUSTOMER no puede reembolsar ni registrar pagos ajenos', async () => {
    const productId = await createProduct();
    const order = await createOrder(productId, 1, customerId);
    const payment = await postWithKey(
      '/api/v1/payments',
      { orderId: order.id, method: 'CASH', amountMinor: order.totalMinor, receivedMinor: order.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);
    const paymentId = num(obj(payment.body.data).id);

    await post(`/api/v1/payments/${paymentId}/refund`, { amountMinor: 100, reason: 'no' }, customerToken).expect(403);
    // Y el pago de OTRO cliente es 404, no 403: no se revela que exista.
    const other = await ctx
      .post('/api/v1/auth/register', {
        email: ctx.uniqueEmail('pagos-otro'),
        password: VALID_TEST_PASSWORD,
        fullName: 'Otro Cliente',
      })
      .expect(201);
    const otherToken = String(other.body.data.accessToken);
    await get(`/api/v1/payments/${paymentId}`, otherToken).expect(404);
  });
});

// ==========================================================================
// Listado y alcance
// ==========================================================================

describe('GET /api/v1/payments', () => {
  it('un CUSTOMER sólo ve sus pagos y el filtro de alcance gana a la query', async () => {
    const productId = await createProduct();
    const mine = await createOrder(productId, 1, customerId);
    await postWithKey(
      '/api/v1/payments',
      { orderId: mine.id, method: 'CASH', amountMinor: mine.totalMinor, receivedMinor: mine.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);

    // Un pedido de mostrador, sin cliente.
    const counter = await createOrder(productId, 1, undefined);
    await ctx.db.prepare('UPDATE orders SET customer_id = NULL WHERE id = ?').run(counter.id);
    await postWithKey(
      '/api/v1/payments',
      { orderId: counter.id, method: 'CASH', amountMinor: counter.totalMinor, receivedMinor: counter.totalMinor },
      idempotencyKey(),
      cashierToken,
    ).expect(201);

    const list = await get('/api/v1/payments', customerToken).expect(200);
    const rows = (list.body.data as Record<string, unknown>[]).map(obj);
    expect(rows.length).toBeGreaterThan(0);
    // El listado no expone `customerId` plano (API.md 6.3 no lo declara): lo
    // anida en `customer`. Lo que importa es que TODOS los pagos son suyos.
    for (const row of rows) {
      expect(num(obj(row.customer).id)).toBe(customerId);
    }
  });

  it('el CASHIER ve los cobros del local con sus totales', async () => {
    const list = await get('/api/v1/payments', cashierToken).expect(200);
    expect(list.body.meta.totals).toBeDefined();
    const totals = obj(list.body.meta.totals);
    const byMethod = obj(totals.byMethod);
    expect(typeof byMethod['CASH']).toBe('number');
    expect(num(byMethod['CASH'])).toBeGreaterThan(0);
    // El desglose sólo tiene los métodos reales: los otros dos valen 0.
    expect(num(byMethod['TRANSFER'])).toBe(0);
    expect(num(byMethod['ONLINE'])).toBe(0);
  });

  it('sin autenticación es 401', async () => {
    await get('/api/v1/payments').expect(401);
    await get('/api/v1/payments/methods').expect(401);
  });
});

// ==========================================================================
// Utilidades del fichero
// ==========================================================================

/** Número de filas de `payments`, para las aserciones de atomicidad. */
function countPayments(): number {
  const row = ctx.db.prepare('SELECT COUNT(*) AS total FROM payments').get() as { total: number };
  return row.total;
}
