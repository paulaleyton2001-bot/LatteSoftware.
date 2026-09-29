/**
 * Pruebas del módulo de DESCUENTOS: alta y edición de cupones, las nueve reglas de
 * `DESIGN.md` 7.8, la previsualización de `POST /validate` (que SIEMPRE responde
 * 200) y el consumo del cupón dentro de la transacción del pedido.
 *
 * ============================================================================
 * POR QUÉ `POST /validate` NUNCA ES UN ERROR
 * ============================================================================
 * Preguntar "¿me sirve este cupón?" no es un error de la petición: es la
 * pregunta. Si devolviera 422, el frontend tendría que tratar una respuesta
 * legítima como fallo, y si devolviera 404, revelaría la existencia de campañas
 * internas. Por eso el resultado es siempre `200` con `isValid` y `reason`, y estas
 * pruebas lo verificancupón por cupón, incluyendo el inexistente.
 *
 * ============================================================================
 * EL CÁLCULO SE COMPRUEBA EN CENTAVOS, CON EL RECUENTO A MANO
 * ============================================================================
 * `PERCENT` son BASIS POINTS (`2000` = 20 %), no porcentaje. Un test que pase con
 * `value: 20` estaría probando otra cosa, y por eso cada caso dice en el
 * comentario cuántos puntos son.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { API_PREFIX } from '../src/config/index.js';
import { createApiV1Router } from '../src/modules/index.js';
import { categoriesRouter, productsRouter } from '../src/modules/catalog/catalog.routes.js';
import { ordersRouter } from '../src/modules/orders/orders.routes.js';
import { discountsRouter } from '../src/modules/discounts/discounts.routes.js';
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
let managerToken: string;
let customerToken: string;
let customerId: number;
let categoryId: number;

let sequence = 0;

function nextSeq(): number {
  sequence += 1;
  return sequence;
}

/** Código de cupón único y válido (`[A-Z0-9_-]`, 3..32). */
function code(prefix = 'CUP'): string {
  return `${prefix}${String(nextSeq()).padStart(4, '0')}`;
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
  api.use('/orders', ordersRouter);
  api.use('/discounts', discountsRouter);
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
function patch(path: string, body: object, token?: string): request.Test {
  return (token === undefined ? agent.patch(path) : agent.patch(path).set('Authorization', `Bearer ${token}`)).send(body);
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
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeDiscountsTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  managerToken = await ctx.accessTokenFor('MANAGER');

  const customer = await ctx
    .post('/api/v1/auth/register', {
      email: ctx.uniqueEmail('cupones'),
      password: VALID_TEST_PASSWORD,
      fullName: 'Cliente Cupones',
    })
    .expect(201);
  customerToken = String(customer.body.data.accessToken);
  customerId = Number(customer.body.data.user.id);

  // Categoría propia para los descuentos por ámbito.
  const category = await post('/api/v1/categories', { name: 'Categoría de descuentos' }, adminToken).expect(201);
  categoryId = num(obj(category.body.data).id);
});

afterAll(() => {
  ctx.close();
});

/** Producto de un precio dado, opcionalmente en la categoría de descuentos. */
async function createProduct(basePriceMinor: number, inTestCategory = false): Promise<number> {
  const n = nextSeq();
  const response = await post(
    '/api/v1/products',
    {
      sku: `DSC-${String(n).padStart(4, '0')}`,
      name: `Producto descuento ${n}`,
      basePriceMinor,
      ...(inTestCategory ? { categoryId } : {}),
    },
    adminToken,
  ).expect(201);
  return num(obj(response.body.data).id);
}

/** Alta de cupón que devuelve el id. */
async function createDiscount(body: Record<string, unknown>): Promise<number> {
  const response = await post(
    '/api/v1/discounts',
    { code: code(), name: 'Cupón de prueba', ...body },
    adminToken,
  ).expect(201);
  return num(obj(response.body.data).id);
}

/** Crea un pedido TAKEAWAY con un producto de `priceMinor` en cantidad 1. */
async function createOrder(priceMinor: number, extra: Record<string, unknown> = {}): Promise<{ id: number; orderNumber: string }> {
  const productId = await createProduct(priceMinor);
  const response = await post(
    '/api/v1/orders',
    { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], ...extra },
    managerToken,
  ).expect(201);
  const order = obj(response.body.data);
  return { id: num(order.id), orderNumber: String(order.orderNumber) };
}

// ==========================================================================
// Alta y edición
// ==========================================================================

describe('POST /api/v1/discounts', () => {
  it('crea un cupón PERCENT y lo devuelve con `isCurrentlyValid` calculado', async () => {
    const response = await post(
      '/api/v1/discounts',
      {
        code: code('PCT'),
        name: 'Veinte por ciento',
        description: 'Promoción de temporada',
        type: 'PERCENT',
        // 2000 basis points = 20 %.
        value: 2_000,
        maxDiscountMinor: 20_000,
      },
      adminToken,
    ).expect(201);

    const discount = obj(response.body.data);
    expect(discount.code).toMatch(/^PCT\d{4}$/);
    expect(discount.type).toBe('PERCENT');
    expect(num(discount.value)).toBe(2_000);
    expect(num(discount.maxDiscountMinor)).toBe(20_000);
    expect(discount.isCurrentlyValid).toBe(true);
    // El código se normaliza a MAYÚSCULAS (BR-DISC-007).
    expect(discount.code).toBe(String(discount.code).toUpperCase());
    // `usageRemaining` es `null` cuando el cupón es ilimitado.
    expect(discount.usageRemaining).toBeNull();
  });

  it('un PERCENT de más del 50 % SIN tope es 400 MAX_DISCOUNT_REQUIRED (BR-DISC-008)', async () => {
    const response = await post(
      '/api/v1/discounts',
      { code: code('BIG'), name: 'Sesenta por ciento', type: 'PERCENT', value: 6_000 },
      adminToken,
    ).expect(400);
    const details = response.body.error.details as { path: string; message: string }[];
    const issue = details.find((detail) => detail.path === 'maxDiscountMinor');
    expect(issue).toBeDefined();
    expect(String(issue?.message)).toContain('maxDiscountMinor');
  });

  it('un PERCENT de más del 100 % es 422 PERCENT_VALUE_OUT_OF_RANGE', async () => {
    // 10.001 bp = 100,01 %.
    const response = await post(
      '/api/v1/discounts',
      { code: code('MAX'), name: 'Imposible', type: 'PERCENT', value: 10_001, maxDiscountMinor: 1_000 },
      adminToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'PERCENT_VALUE_OUT_OF_RANGE' });
  });

  it('un FIXED negativo se rechaza en el esquema (el importe no puede ser negativo)', async () => {
    const response = await post(
      '/api/v1/discounts',
      { code: code('NEG'), name: 'Negativo', type: 'FIXED', value: -100 },
      adminToken,
    ).expect(400);
    const paths = (response.body.error.details as { path: string }[]).map((detail) => detail.path);
    expect(paths).toContain('value');
  });

  it('un código repetido es 409 DISCOUNT_CODE_TAKEN', async () => {
    const shared = code('DUP');
    await post('/api/v1/discounts', { code: shared, name: 'Primero', type: 'FIXED', value: 500 }, adminToken).expect(201);
    const response = await post(
      '/api/v1/discounts',
      { code: shared, name: 'Segundo', type: 'FIXED', value: 500 },
      adminToken,
    ).expect(409);
    expect(obj(response.body.error).details).toMatchObject({ code: 'DISCOUNT_CODE_TAKEN' });
  });

  it('`appliesTo: CATEGORY` sin categoría es 422 APPLIES_TO_REQUIRES_TARGET', async () => {
    const response = await post(
      '/api/v1/discounts',
      { code: code('CAT'), name: 'Sin categoría', type: 'FIXED', value: 500, appliesTo: 'CATEGORY' },
      adminToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'APPLIES_TO_REQUIRES_TARGET' });
  });

  it('`appliesTo: PRODUCT` con un producto inexistente es 404', async () => {
    await post(
      '/api/v1/discounts',
      { code: code('PRD'), name: 'Producto fantasma', type: 'FIXED', value: 500, appliesTo: 'PRODUCT', appliesProductId: 999_999 },
      adminToken,
    ).expect(404);
  });

  it('una ventana invertida es 400 PROMO_WINDOW_INVALID', async () => {
    const response = await post(
      '/api/v1/discounts',
      {
        code: code('WIN'),
        name: 'Ventana mala',
        type: 'FIXED',
        value: 500,
        startsAt: '2030-01-02T00:00:00.000Z',
        endsAt: '2030-01-01T00:00:00.000Z',
      },
      adminToken,
    ).expect(400);
    const paths = (response.body.error.details as { path: string }[]).map((detail) => detail.path);
    expect(paths).toContain('endsAt');
  });

  it('un CASHIER no puede crear cupones: `discounts:create` es MANAGER+', async () => {
    const cashierToken = await ctx.accessTokenFor('CASHIER');
    const response = await post(
      '/api/v1/discounts',
      { code: code('NO'), name: 'No permitido', type: 'FIXED', value: 500 },
      cashierToken,
    ).expect(403);
    expect(obj(response.body.error).details).toMatchObject({ required: 'discounts:create' });
  });
});

describe('PATCH /api/v1/discounts/:id y DELETE', () => {
  it('edita un cupón nunca usado, incluso su código', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 500 });
    const response = await patch(
      `/api/v1/discounts/${discountId}`,
      { name: 'Nombre nuevo', value: 750, code: code('RNC') },
      adminToken,
    ).expect(200);
    const discount = obj(response.body.data);
    expect(discount.name).toBe('Nombre nuevo');
    expect(num(discount.value)).toBe(750);
  });

  it('NO deja cambiar el código de un cupón ya usado (DISCOUNT_CODE_IN_USE)', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 5_000 });
    const created = await createOrder(20_000, { couponCode: discountCodeOf(discountId) });
    expect(created.id).toBeGreaterThan(0);

    const response = await patch(
      `/api/v1/discounts/${discountId}`,
      { code: code('NOP') },
      adminToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'DISCOUNT_CODE_IN_USE' });
  });

  it('un PATCH vacío se rechaza: no es una operación', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 500 });
    const rejection = await patch(`/api/v1/discounts/${discountId}`, {}, adminToken).expect(400);
    const details = rejection.body.error.details as { message: string }[];
    expect(String(details[0]?.message)).toContain('al menos un campo');
  });

  it('el borrado es lógico: 204 y el cupón desaparece del listado', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 500 });
    await agent
      .delete(`/api/v1/discounts/${discountId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    // 404 al pedirlo, y ausente del listado.
    await get(`/api/v1/discounts/${discountId}`, adminToken).expect(404);
    const list = await get('/api/v1/discounts?pageSize=100', adminToken).expect(200);
    const ids = (list.body.data as Record<string, unknown>[]).map((row) => num(row.id));
    expect(ids).not.toContain(discountId);
  });
});

// ==========================================================================
// Previsualización
// ==========================================================================

describe('POST /api/v1/discounts/validate', () => {
  it('cota un PERCENT con el importe y las reglas aplicadas', async () => {
    const discountCode = code('VAL');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Diez por ciento', type: 'PERCENT', value: 1_000 },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/discounts/validate',
      { code: discountCode, subtotalMinor: 50_000 },
      customerToken,
    ).expect(200);

    // Siempre 200: es una PREGUNTA, no un error.
    const result = obj(response.body.data);
    expect(result.isValid).toBe(true);
    expect(num(result.applicableSubtotalMinor)).toBe(50_000);
    // 1.000 bp = 10 % de 50.000 = 5.000.
    expect(num(result.discountMinor)).toBe(5_000);
    expect(result.reason).toBeNull();
    expect(result.cappedByMaxDiscount).toBe(false);
    const rules = response.body.meta.appliedRules as string[];
    expect(rules).toContain('BR-DISC-001');
  });

  it('recorta a `maxDiscountMinor` y lo dice con `cappedByMaxDiscount`', async () => {
    const discountCode = code('CAP');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Tope de 3.000', type: 'PERCENT', value: 5_000, maxDiscountMinor: 3_000 },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/discounts/validate',
      { code: discountCode, subtotalMinor: 100_000 },
      customerToken,
    ).expect(200);
    const result = obj(response.body.data);
    // 50 % de 100.000 son 50.000, pero el tope son 3.000.
    expect(num(result.discountMinor)).toBe(3_000);
    expect(result.cappedByMaxDiscount).toBe(true);
  });

  it('un cupón INEXISTENTE es 200 con isValid=false (no 404)', async () => {
    const response = await post(
      '/api/v1/discounts/validate',
      { code: 'NOEXISTE99', subtotalMinor: 10_000 },
      customerToken,
    ).expect(200);
    const result = obj(response.body.data);
    expect(result.isValid).toBe(false);
    expect(result.code).toBeNull();
    expect(result.reasonCode).toBe('DISCOUNT_NOT_FOUND');
    expect(String(result.reason)).toContain('No existe');
  });

  it('un cupón CADUCADO es 200 con isValid=false y motivo claro', async () => {
    const discountCode = code('OLD');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Caducado', type: 'FIXED', value: 500, endsAt: '2020-01-01T00:00:00.000Z', startsAt: '2019-01-01T00:00:00.000Z' },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/discounts/validate',
      { code: discountCode, subtotalMinor: 10_000 },
      customerToken,
    ).expect(200);
    expect(obj(response.body.data).isValid).toBe(false);
    expect(obj(response.body.data).reasonCode).toBe('DISCOUNT_EXPIRED');
  });

  it('un cupón por debajo del pedido mínimo avisa del faltante', async () => {
    const discountCode = code('MIN');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Pedido grande', type: 'FIXED', value: 1_000, minOrderMinor: 50_000 },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/discounts/validate',
      { code: discountCode, subtotalMinor: 20_000 },
      customerToken,
    ).expect(200);
    const result = obj(response.body.data);
    expect(result.isValid).toBe(false);
    expect(result.minOrderMet).toBe(false);
    expect(result.reasonCode).toBe('DISCOUNT_MIN_ORDER_NOT_MET');
  });

  it('un cupón AGOTADO avisa del límite de usos', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 1_000, usageLimit: 3 });
    ctx.db.prepare('UPDATE discounts SET used_count = 3 WHERE id = ?').run(discountId);

    const response = await post(
      '/api/v1/discounts/validate',
      { code: discountCodeOf(discountId), subtotalMinor: 20_000 },
      customerToken,
    ).expect(200);
    const result = obj(response.body.data);
    expect(result.isValid).toBe(false);
    expect(result.reasonCode).toBe('DISCOUNT_LIMIT_REACHED');
    expect(num(result.remainingUses)).toBe(0);
  });

  it('un cupón ya usado por el cliente NO le es válido a ÉL, pero sí a los demás', async () => {
    const discountId = await createDiscount({
      type: 'FIXED',
      value: 1_000,
      usageLimitPerCustomer: 1,
    });
    const discountCode = discountCodeOf(discountId);

    // El cliente lo usa una vez.
    const order = await createOrder(20_000, { couponCode: discountCode });

    // Para el mismo cliente ya no es válido (BR-DISC-005)...
    const mine = await post(
      '/api/v1/discounts/validate',
      { code: discountCode, subtotalMinor: 20_000, customerId },
      customerToken,
    ).expect(200);
    expect(obj(mine.body.data).isValid).toBe(false);
    expect(obj(mine.body.data).reasonCode).toBe('DISCOUNT_EXCEEDED_PER_CUSTOMER');

    // ...pero para otro cliente sí lo es: el límite es POR cliente.
    const other = await post(
      '/api/v1/discounts/validate',
      { code: discountCode, subtotalMinor: 20_000 },
      managerToken,
    ).expect(200);
    expect(obj(other.body.data).isValid).toBe(true);
    expect(order.id).toBeGreaterThan(0);
  });

  it('con `orderId` usa el subtotal REAL del pedido, no el del cliente (BR-DISC-001)', async () => {
    const discountCode = code('ORD');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Quince por ciento', type: 'PERCENT', value: 1_500 },
      adminToken,
    ).expect(201);

    const productId = await createProduct(20_000);
    const created = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }] },
      managerToken,
    ).expect(201);
    const orderId = num(obj(created.body.data).id);

    // El `subtotalMinor` del body MIENTE a propósito: el servidor lo ignora y usa
    // el real del pedido (40.000), no el 999.999 que dice el cliente.
    const response = await post(
      '/api/v1/discounts/validate',
      { code: discountCode, orderId, subtotalMinor: 999_999 },
      customerToken,
    ).expect(200);
    const result = obj(response.body.data);
    expect(num(result.applicableSubtotalMinor)).toBe(20_000);
    expect(num(result.discountMinor)).toBe(3_000);
  });

  it('sin subtotal ni orderId es 400 MISSING_VALIDATION_CONTEXT', async () => {
    const response = await post(
      '/api/v1/discounts/validate',
      { code: code('CTX') },
      customerToken,
    ).expect(400);
    const details = response.body.error.details as { path: string; message: string }[];
    expect(String(details[0]?.message)).toContain('subtotalMinor');
  });

  it('un descuento de CATEGORÍA sólo cotiza sobre las líneas de esa categoría', async () => {
    const inCategory = await createProduct(20_000, true);
    const outOfCategory = await createProduct(30_000);
    const discountCode = code('CAT');
    await post(
      '/api/v1/discounts',
      {
        code: discountCode,
        name: 'Solo la categoría',
        type: 'FIXED',
        value: 5_000,
        appliesTo: 'CATEGORY',
        appliesCategoryId: categoryId,
      },
      adminToken,
    ).expect(201);

    // Un pedido con 20.000 de la categoría y 30.000 de otra: la base aplicable son
    // los 20.000 de la categoría, no los 50.000 del pedido.
    const response = await post(
      '/api/v1/discounts/validate',
      {
        code: discountCode,
        subtotalMinor: 50_000,
        items: [
          { productId: inCategory, categoryId, quantity: 1, unitPriceMinor: 20_000 },
          { productId: outOfCategory, quantity: 1, unitPriceMinor: 30_000 },
        ],
      },
      customerToken,
    ).expect(200);
    const result = obj(response.body.data);
    expect(result.isValid).toBe(true);
    expect(num(result.applicableSubtotalMinor)).toBe(20_000);
    // El fijo de 5.000 cabe en la base de 20.000.
    expect(num(result.discountMinor)).toBe(5_000);
  });

  it('un descuento de CATEGORÍA sin líneas de esa categoría no aplica', async () => {
    const outOfCategory = await createProduct(30_000);
    const discountCode = code('NOCAT');
    await post(
      '/api/v1/discounts',
      {
        code: discountCode,
        name: 'Categoría ausente',
        type: 'FIXED',
        value: 5_000,
        appliesTo: 'CATEGORY',
        appliesCategoryId: categoryId,
      },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/discounts/validate',
      {
        code: discountCode,
        subtotalMinor: 30_000,
        items: [{ productId: outOfCategory, quantity: 1, unitPriceMinor: 30_000 }],
      },
      customerToken,
    ).expect(200);
    const result = obj(response.body.data);
    expect(result.isValid).toBe(false);
    expect(result.reasonCode).toBe('DISCOUNT_NO_APPLICABLE_ITEMS');
  });
});

// ==========================================================================
// Consumo dentro del pedido
// ==========================================================================

describe('El cupón se consume dentro de la transacción del pedido', () => {
  it('aplica un PERCENT y el descuento se ve en el total', async () => {
    const discountCode = code('APL');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Veinte por ciento', type: 'PERCENT', value: 2_000 },
      adminToken,
    ).expect(201);

    const productId = await createProduct(50_000);
    const response = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(201);

    const order = obj(response.body.data);
    expect(num(order.subtotalMinor)).toBe(50_000);
    // 2.000 bp = 20 % de 50.000 = 10.000.
    expect(num(order.discountMinor)).toBe(10_000);
    // El impuesto se calcula sobre la base POST-descuento: 40.000 x 19 % = 7.600.
    expect(num(order.taxMinor)).toBe(7_600);
    expect(num(order.totalMinor)).toBe(47_600);
    expect(order.couponCode).toBe(discountCode);
    // `appliedDiscounts` explica de dónde sale (API.md 7.12).
    const applied = order.appliedDiscounts as Record<string, unknown>[];
    expect(applied).toHaveLength(1);
    expect(obj(applied[0]).code).toBe(discountCode);
    expect(num(obj(applied[0]).amountMinor)).toBe(10_000);
  });

  it('aplica un FIXED y el descuento se ve en el total', async () => {
    const discountCode = code('FIX');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Cinco mil fijos', type: 'FIXED', value: 5_000 },
      adminToken,
    ).expect(201);

    const productId = await createProduct(50_000);
    const response = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(201);

    const order = obj(response.body.data);
    expect(num(order.discountMinor)).toBe(5_000);
    // 45.000 x 19 % = 8.550; total 53.550.
    expect(num(order.taxMinor)).toBe(8_550);
    expect(num(order.totalMinor)).toBe(53_550);
  });

  it('incrementa `used_count` y escribe la redemption, en el mismo commit', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 1_000 });
    const discountCode = discountCodeOf(discountId);
    expect(usedCount(discountId)).toBe(0);

    const productId = await createProduct(20_000);
    await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(201);

    expect(usedCount(discountId)).toBe(1);
    const redemption = ctx.db
      .prepare('SELECT discount_id, order_id, customer_id, amount_minor FROM discount_redemptions WHERE discount_id = ?')
      .all(discountId) as { discount_id: number; order_id: number; customer_id: number | null; amount_minor: number }[];
    expect(redemption).toHaveLength(1);
    expect(num(redemption[0]?.amount_minor)).toBe(1_000);
    expect(num(redemption[0]?.customer_id)).toBe(customerId);
  });

  it('un cupón que supera el subtotal se RECORTA, no se rechaza (BR-DISC-002)', async () => {
    const discountCode = code('CAP');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Cien mil', type: 'FIXED', value: 100_000 },
      adminToken,
    ).expect(201);

    const productId = await createProduct(3_000);
    const response = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(201);

    const order = obj(response.body.data);
    // El CHECK `ck_orders_discount` (`discount_minor <= subtotal_minor`) se
    // respeta: el descuento se recorta a la base.
    expect(num(order.subtotalMinor)).toBe(3_000);
    expect(num(order.discountMinor)).toBe(3_000);
    expect(num(order.taxMinor)).toBe(0);
    expect(num(order.totalMinor)).toBe(0);
  });

  it('un cupón AGOTADO en un pedido es 422 DISCOUNT_LIMIT_REACHED y no cobra cupón', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 1_000, usageLimit: 1 });
    const discountCode = discountCodeOf(discountId);
    ctx.db.prepare('UPDATE discounts SET used_count = 1 WHERE id = ?').run(discountId);

    const productId = await createProduct(20_000);
    const ordersBefore = countRows('orders');
    const redemptionsBefore = countRows('discount_redemptions');

    const response = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'DISCOUNT_LIMIT_REACHED' });

    // Y el fallo del cupón revierte el pedido entero: la transacción es única.
    expect(countRows('orders')).toBe(ordersBefore);
    expect(countRows('discount_redemptions')).toBe(redemptionsBefore);
  });

  it('cancelar un pedido PENDING devuelve el uso del cupón (BR-DISC-010)', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 1_000 });
    const discountCode = discountCodeOf(discountId);
    const productId = await createProduct(20_000);

    const created = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(201);
    const orderId = num(obj(created.body.data).id);
    expect(usedCount(discountId)).toBe(1);

    await post(`/api/v1/orders/${orderId}/cancel`, { reason: 'Cliente cambió de opinión' }, managerToken).expect(200);

    // Nunca se cobró, así que la campaña recupera el uso.
    expect(usedCount(discountId)).toBe(0);
    expect(redemptionsOf(discountId)).toHaveLength(0);
  });

  it('quitar el cupón de un pedido vivo no devuelve el uso (BR-DISC-010, excepción)', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 1_000 });
    const discountCode = discountCodeOf(discountId);
    const productId = await createProduct(20_000);

    const created = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(201);
    const orderId = num(obj(created.body.data).id);
    expect(usedCount(discountId)).toBe(1);

    const response = await patch(`/api/v1/orders/${orderId}`, { couponCode: null }, managerToken).expect(200);
    expect(obj(response.body.data).couponCode).toBeNull();
    expect(num(obj(response.body.data).discountMinor)).toBe(0);
    // El pedido sigue vivo, así que la redemption desaparece, pero la campaña NO
    // recupera el uso: el cupón ya se contabilizó.
    expect(redemptionsOf(discountId)).toHaveLength(0);
    expect(usedCount(discountId)).toBe(1);
  });

  it('quitar el cupón de un pedido CONFIRMED se rechaza (BR-ORDER-020)', async () => {
    const discountCode = code('FRZ');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Congelado', type: 'FIXED', value: 1_000 },
      adminToken,
    ).expect(201);
    const productId = await createProduct(20_000);
    const created = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(201);
    const orderId = num(obj(created.body.data).id);
    await post(`/api/v1/orders/${orderId}/confirm`, {}, managerToken).expect(200);

    const response = await patch(`/api/v1/orders/${orderId}`, { couponCode: null }, managerToken).expect(422);
    // El pedido confirmado ya no es editable: no es un problema del cupón.
    expect(obj(response.body.error).details).toMatchObject({ code: 'ORDER_NOT_EDITABLE' });
  });

  it('UN `IN (SELECT ...)` sobre `discount_redemptions` no permite aplicar dos veces el mismo cupón', async () => {
    // `UNIQUE (discount_id, order_id)` es la garantía final de BR-DISC-006.
    const discountId = await createDiscount({ type: 'FIXED', value: 1_000, stackable: true });
    const productId = await createProduct(20_000);
    const created = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCodeOf(discountId) },
      managerToken,
    ).expect(201);
    const orderId = num(obj(created.body.data).id);

    // Insertar la misma redemption a mano debe ser rechazado por el índice.
    expect(() => {
      ctx.db
        .prepare(
          'INSERT INTO discount_redemptions (discount_id, order_id, customer_id, amount_minor) VALUES (?, ?, ?, ?)',
        )
        .run(discountId, orderId, customerId, 1_000);
    }).toThrow();
  });
});

// ==========================================================================
// Cupones del cliente
// ==========================================================================

describe('GET /api/v1/discounts/mine', () => {
  it('devuelve los cupones vigentes del cliente, con su estado de canje', async () => {
    const discountCode = code('MINE');
    await post(
      '/api/v1/discounts',
      { code: discountCode, name: 'Cupón del cliente', type: 'FIXED', value: 1_000 },
      adminToken,
    ).expect(201);

    const response = await get('/api/v1/discounts/mine?pageSize=100', customerToken).expect(200);
    const items = (response.body.data as Record<string, unknown>[]).map(obj);
    const found = items.find((entry) => entry.code === discountCode);
    expect(found).toBeDefined();
    expect(obj(found ?? {}).isValid).toBe(true);
    // Todavía no lo ha usado.
    expect(obj(found ?? {}).usedAt).toBeNull();
    expect(num(obj(found ?? {}).usedCount)).toBe(0);
  });

  it('un CUSTOMER no puede ver la configuración de campañas: 403', async () => {
    await get('/api/v1/discounts', customerToken).expect(403);
    await get('/api/v1/discounts', adminToken).expect(200);
  });

  it('un cupón canjeado aparece con `usedAt` y sigue siendo visible', async () => {
    const discountId = await createDiscount({ type: 'FIXED', value: 1_000 });
    const discountCode = discountCodeOf(discountId);
    const productId = await createProduct(20_000);
    await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', customerId, items: [{ productId, quantity: 1 }], couponCode: discountCode },
      managerToken,
    ).expect(201);

    const response = await get('/api/v1/discounts/mine?pageSize=100', customerToken).expect(200);
    const items = (response.body.data as Record<string, unknown>[]).map(obj);
    const found = items.find((entry) => entry.code === discountCode);
    expect(found).toBeDefined();
    expect(obj(found ?? {}).usedAt).not.toBeNull();
    expect(num(obj(found ?? {}).usedCount)).toBe(1);
  });
});

// ==========================================================================
// Utilidades del fichero
// ==========================================================================

/** Código de un descuento por su id. */
function discountCodeOf(discountId: number): string {
  const row = ctx.db.prepare('SELECT code FROM discounts WHERE id = ?').get(discountId) as
    | { code: string }
    | undefined;
  if (row === undefined) {
    throw new Error(`El descuento ${discountId} no existe`);
  }
  return row.code;
}

/** `used_count` actual de un descuento. */
function usedCount(discountId: number): number {
  const row = ctx.db.prepare('SELECT used_count FROM discounts WHERE id = ?').get(discountId) as
    | { used_count: number }
    | undefined;
  return row?.used_count ?? Number.NaN;
}

/** Canjes registrados de un descuento. */
function redemptionsOf(discountId: number): readonly { readonly order_id: number }[] {
  return ctx.db
    .prepare('SELECT order_id FROM discount_redemptions WHERE discount_id = ? ORDER BY id')
    .all(discountId) as { readonly order_id: number }[];
}

/** Cuenta filas de una tabla. */
function countRows(table: string): number {
  const row = ctx.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
  return row.total;
}
