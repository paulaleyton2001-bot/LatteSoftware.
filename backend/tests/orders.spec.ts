/**
 * Pruebas del módulo de PEDIDOS: precios calculados por el servidor, snapshots
 * inmutables, los 6 pasos de `DESIGN.md` 8.5 en una sola transacción, la máquina
 * de estados, la inmutabilidad y el alcance de cliente.
 *
 * ============================================================================
 * POR QUÉ ESTAS PRUEBAS SON LA MÁS IMPORTANTE DEL MÓDULO
 * ============================================================================
 * El bloque "Transaccionalidad / rollback" comprueba que un fallo a mitad de la
 * creación NO deja cabecera, ni líneas, ni movimientos de inventario. Un POS que
 * descuenta existencias de un café que nunca se cobró es peor que un POS que
 * rechaza el pedido: el primero necesita una corrección manual y el segundo
 * devuelve un error. Por eso ese test mira las CUATRO tablas, no sólo la respuesta.
 *
 * ============================================================================
 * EL PRECIO SIEMPRE SE COMPRUEBA EN CENTAVOS ENTEROS
 * ============================================================================
 * Un redondeo mal hecho se ve aquí como un `expected 45220 to be 45219`, no como
 * un descuadre de mil pesos en la caja de marzo.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { API_PREFIX } from '../src/config/index.js';
import { createApiV1Router } from '../src/modules/index.js';
import { categoriesRouter, productsRouter } from '../src/modules/catalog/catalog.routes.js';
import { inventoryRouter } from '../src/modules/inventory/inventory.routes.js';
import { chairsRouter, zonesRouter } from '../src/modules/spaces/spaces.routes.js';
import { reservationsRouter } from '../src/modules/reservations/reservations.routes.js';
import { rentalsRouter } from '../src/modules/rentals/rentals.routes.js';
import { ordersRouter } from '../src/modules/orders/orders.routes.js';
import { paymentsRouter } from '../src/modules/payments/payments.routes.js';
import { discountsRouter } from '../src/modules/discounts/discounts.routes.js';
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
let otherCustomerId: number;
let locationId: number;

/**
 * Base temporal común. Se usa para las ventanas de las promociones y de los
 * cupones, de modo que un test no dependa del reloj entre llamadas.
 */
const BASE = Date.now();

/** Instante ISO a `minutes` minutos de la base común. */
function inMinutes(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

/**
 * App de pruebas con los routers montados a mano.
 *
 * `src/modules/index.ts` los registra el integrador al final; hasta entonces los
 * tests los montan aquí, igual que hacen `rentals.spec.ts` y `reservations.spec.ts`.
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
  api.use('/categories', categoriesRouter);
  api.use('/products', productsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/zones', zonesRouter);
  api.use('/chairs', chairsRouter);
  api.use('/reservations', reservationsRouter);
  api.use('/rentals', rentalsRouter);
  api.use('/orders', ordersRouter);
  api.use('/payments', paymentsRouter);
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

/** Contador global de secuencias, para SKU y códigos únicos por fichero. */
let sequence = 0;

function nextSeq(): number {
  sequence += 1;
  return sequence;
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeOrdersTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');

  const customer = await ctx
    .post('/api/v1/auth/register', {
      email: ctx.uniqueEmail('pedidos'),
      password: VALID_TEST_PASSWORD,
      fullName: 'Cliente Pedidos',
    })
    .expect(201);
  customerToken = String(customer.body.data.accessToken);
  customerId = Number(customer.body.data.user.id);

  const other = await ctx
    .post('/api/v1/auth/register', {
      email: ctx.uniqueEmail('pedidos-otro'),
      password: VALID_TEST_PASSWORD,
      fullName: 'Cliente Pedidos Otro',
    })
    .expect(201);
  void other;
  otherCustomerId = Number(other.body.data.user.id);

  locationId = seedSpacesDemo().locationId;
});

afterAll(() => {
  ctx.close();
});

// --------------------------------------------------------------------------
// Utilidades de preparación
// --------------------------------------------------------------------------

/** Crea un producto y devuelve su id. */
async function createProduct(body: Record<string, unknown> = {}): Promise<number> {
  const n = nextSeq();
  const response = await post(
    '/api/v1/products',
    {
      sku: `PED-${String(n).padStart(4, '0')}`,
      name: `Producto pedido ${n}`,
      basePriceMinor: 10_000,
      ...body,
    },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

/** Ítem de inventario con control de stock para un producto. */
async function createStock(productId: number, currentStock: number): Promise<number> {
  const n = nextSeq();
  const response = await post(
    '/api/v1/inventory/items',
    {
      productId,
      name: `Stock producto ${n}`,
      sku: `STK-${String(n).padStart(4, '0')}`,
      currentStock,
      isTracked: true,
    },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

/** Id de la primera zona de la sede sembrada. */
async function firstZoneId(): Promise<number> {
  const zones = await get(`/api/v1/zones?locationId=${locationId}`, adminToken).expect(200);
  const rows = zones.body.data as Record<string, unknown>[];
  if (rows.length === 0) {
    throw new Error('La semilla de espacios no dejó ninguna zona');
  }
  return num(rows[0]?.id);
}

/** Silla nueva en la zona por defecto de la semilla. */
async function createChair(): Promise<number> {
  const n = nextSeq();
  const zoneId = await firstZoneId();
  const response = await post(
    '/api/v1/chairs',
    { zoneId, code: `PED-${String(n).padStart(4, '0')}` },
    adminToken,
  ).expect(201);
  return Number(response.body.data.id);
}

/**
 * Reserva CONFIRMEDA y con check-in hecho, de modo que exista un alquiler vivo.
 *
 * El check-in (`POST /reservations/:id/check-in`) crea el `chair_rentals` que el
 * pedido `CHAIR_RENTAL` necesita para sumar su total.
 */
async function createActiveRentalWithReservation(plannedMinutes = 60): Promise<{
  chairId: number;
  reservationId: number;
  rentalId: number;
  rentalTotalMinor: number;
}> {
  const n = nextSeq();
  const zoneId = await firstZoneId();
  const chair = await post(
    '/api/v1/chairs',
    // $50.000 la hora = 5.000.000 centavos. Una hora exacta da un subtotal
    // redondo, que hace legible la aritmética del recibo.
    { zoneId, code: `RN-${String(n).padStart(4, '0')}`, pricePerHourMinor: 5_000_000 },
    adminToken,
  ).expect(201);
  const chairId = Number(chair.body.data.id);

  // La reserva arranca AHORA: `POST /reservations` rechaza un `startAt` en el
  // pasado (BR-RES-006, con 5 min de tolerancia), y el check-in necesita una
  // reserva vigente.
  const reservation = await post(
    '/api/v1/reservations',
    {
      chairId,
      startAt: new Date(Date.now() + 30_000).toISOString(),
      endAt: new Date(Date.now() + (plannedMinutes * 60_000) + 30_000).toISOString(),
      customerId,
      source: 'ADMIN',
    },
    adminToken,
  ).expect(201);
  // `POST /reservations` devuelve la reserva directamente en `data`, sin envolver.
  const reservationId = num(obj(reservation.body.data).id);
  await post(`/api/v1/reservations/${reservationId}/confirm`, {}, adminToken).expect(200);
  const checkIn = await post(`/api/v1/reservations/${reservationId}/check-in`, {}, adminToken).expect(200);
  const rentalId = num(obj(checkIn.body.data.rental).id);

  // El total facturado vive en `chair_rentals.total_minor` (BR-RENTAL-006): es lo
  // que el pedido va a sumar a su subtotal.
  const rental = await get(`/api/v1/rentals/${rentalId}`, adminToken).expect(200);
  const rentalTotalMinor = num(obj(rental.body.data.rental).totalMinor);
  return { chairId, reservationId, rentalId, rentalTotalMinor };
}

/** Cuerpo base de un pedido TAKEAWAY válido. */
function takeawayBody(productId: number, quantity = 1): Record<string, unknown> {
  return { type: 'TAKEAWAY', items: [{ productId, quantity }] };
}

/** Lee un valor entero de un body JSON sin dejar `any`. */
function num(value: unknown): number {
  return Number(value);
}

/** Primera línea de un pedido, con su id resuelto y sin `undefined`. */
function firstItem(order: Record<string, unknown>): Record<string, unknown> {
  const items = order.items as Record<string, unknown>[];
  const item = items[0];
  if (item === undefined) {
    throw new Error('El pedido no tiene líneas');
  }
  return item;
}

/** Lee un objeto de un body JSON sin dejar `any`. */
function obj(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new Error('El valor no es un objeto');
  }
  return value as Record<string, unknown>;
}

// ==========================================================================
// Creación y precio
// ==========================================================================

describe('POST /api/v1/orders', () => {
  it('crea un pedido TAKEAWAY completo con 201, order_number y snapshots', async () => {
    const productId = await createProduct({ basePriceMinor: 25_000 });
    const response = await post(
      '/api/v1/orders',
      {
        type: 'TAKEAWAY',
        customerId,
        items: [{ productId, quantity: 2, notes: 'sin azúcar' }],
      },
      cashierToken,
    ).expect(201);

    const order = obj(response.body.data);
    // BR-ORDER-001: `<order_prefix>-<6 dígitos>`.
    expect(String(order.orderNumber)).toMatch(/^ORD-\d{6}$/);
    expect(order.status).toBe('PENDING');
    expect(order.type).toBe('TAKEAWAY');

    // 25.000 x 2 = 50.000; IVA 19 % = 9.500; total 59.500.
    expect(num(order.subtotalMinor)).toBe(50_000);
    expect(num(order.discountMinor)).toBe(0);
    expect(num(order.taxMinor)).toBe(9_500);
    expect(num(order.serviceFeeMinor)).toBe(0);
    expect(num(order.totalMinor)).toBe(59_500);
    expect(num(order.balanceMinor)).toBe(59_500);
    expect(num(order.paidMinor)).toBe(0);

    expect(order.items as unknown[]).toHaveLength(1);
    const item = firstItem(order);
    // BR-PRICE-004: el snapshot del nombre y el precio quedan congelados en la
    // línea, y el `sku` también.
    expect(String(item.nameSnapshot)).toMatch(/^Producto pedido \d+$/);
    expect(String(item.skuSnapshot)).toMatch(/^PED-\d{4}$/);
    expect(num(item.unitPriceMinor)).toBe(25_000);
    expect(num(item.lineTotalMinor)).toBe(50_000);
    expect(item.notes).toBe('sin azúcar');
  });

  it('IGNORA los precios que el cliente manda en el body (BR-ORDER-014)', async () => {
    const productId = await createProduct({ basePriceMinor: 12_000 });

    // 1) Un body CON campos de total se RECHAZA con 400, no se ignora: el esquema
    //    es `.strict()` y no tiene `subtotalMinor` ni `totalMinor`.
    const rejected = await post(
      '/api/v1/orders',
      { ...takeawayBody(productId), subtotalMinor: 1, totalMinor: 99_999_999, taxMinor: 5 },
      cashierToken,
    ).expect(400);
    const paths = (rejected.body.error.details as { path: string }[]).map((detail) => detail.path);
    expect(paths).toContain('subtotalMinor');
    expect(paths).toContain('totalMinor');
    expect(paths).toContain('taxMinor');

    // 2) Un body que intenta mandar el precio dentro de la LÍNEA también se
    //    rechaza, por la misma razón.
    const rejectedLine = await post(
      '/api/v1/orders',
      {
        type: 'TAKEAWAY',
        items: [{ productId, quantity: 1, unitPriceMinor: 1, lineTotalMinor: 1 }],
      },
      cashierToken,
    ).expect(400);
    // `toValidationDetails` reporta las claves desconocidas por su NOMBRE, sin
    // el índice del array (así lo define el middleware compartido).
    const linePaths = (rejectedLine.body.error.details as { path: string; code: string }[]).map(
      (detail) => detail.path,
    );
    expect(linePaths).toContain('unitPriceMinor');
    expect(linePaths).toContain('lineTotalMinor');

    // 3) Y lo que el servidor devuelve es SIEMPRE el precio del catálogo: se
    //    comprueba creando el pedido limpio y verificando el importe real.
    const clean = await post('/api/v1/orders', takeawayBody(productId, 1), cashierToken).expect(201);
    const order = obj(clean.body.data);
    expect(num(order.subtotalMinor)).toBe(12_000);
    expect(num(order.taxMinor)).toBe(2_280);
    expect(num(order.totalMinor)).toBe(14_280);
  });

  it('resuelve el precio con la prioridad promo > variante > base + delta > base (BR-PRICE-001)', async () => {
    // (a) Base: 30.000 sin promo ni variante.
    const baseOnly = await createProduct({ basePriceMinor: 30_000 });

    // (b) Base + delta: la variante NO tiene precio propio, sólo delta.
    const withDelta = await createProduct({
      basePriceMinor: 30_000,
      variants: [{ name: 'Grande', priceDeltaMinor: 5_000 }],
    });
    const deltaVariantId = await firstVariantId(withDelta, 'Grande');

    // (c) Variante con precio ABSOLUTO: sobreescribe el base.
    const withAbsolute = await createProduct({
      basePriceMinor: 30_000,
      variants: [{ name: 'Descafeinado', priceMinor: 28_000 }],
    });
    const absoluteVariantId = await firstVariantId(withAbsolute, 'Descafeinado');

    // (d) Promo activa: gana a TODO, incluida la variante con precio absoluto.
    const withPromo = await createProduct({
      basePriceMinor: 30_000,
      promoPriceMinor: 19_000,
      promoStartsAt: inMinutes(-60),
      promoEndsAt: inMinutes(60),
      variants: [{ name: 'Grande', priceMinor: 28_000 }],
    });
    const promoVariantId = await firstVariantId(withPromo, 'Grande');

    // 30.000 exactos.
    const a = await post('/api/v1/orders', takeawayBody(baseOnly, 1), cashierToken).expect(201);
    expect(num(obj(a.body.data).subtotalMinor)).toBe(30_000);

    // 30.000 + 5.000 = 35.000.
    const b = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [{ productId: withDelta, variantId: deltaVariantId, quantity: 1 }] },
      cashierToken,
    ).expect(201);
    expect(num(obj(b.body.data).subtotalMinor)).toBe(35_000);

    // La variante absoluta IGNORA el base: 28.000, no 30.000.
    const c = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [{ productId: withAbsolute, variantId: absoluteVariantId, quantity: 1 }] },
      cashierToken,
    ).expect(201);
    expect(num(obj(c.body.data).subtotalMinor)).toBe(28_000);

    // La promo gana a la variante: 19.000, no 28.000.
    const d = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [{ productId: withPromo, variantId: promoVariantId, quantity: 1 }] },
      cashierToken,
    ).expect(201);
    expect(num(obj(d.body.data).subtotalMinor)).toBe(19_000);
  });

  it('suma los complementos al precio unitario ANTES de multiplicar (BR-PRICE-003)', async () => {
    const productId = await createProduct({
      basePriceMinor: 10_000,
      addons: [{ name: 'Leche de avena', priceMinor: 1_500 }],
    });
    const response = await post(
      '/api/v1/orders',
      {
        type: 'TAKEAWAY',
        // (10.000 + 1.500) x 2 = 23.000, y no 10.000 x 2 + 1.500 = 21.500.
        items: [{ productId, quantity: 2, addons: [{ productAddonId: await firstAddonId(productId, 'Leche de avena'), quantity: 1 }] }],
      },
      cashierToken,
    ).expect(201);

    const order = obj(response.body.data);
    expect(num(order.subtotalMinor)).toBe(23_000);
    const addons = firstItem(order).addons as Record<string, unknown>[];
    expect(addons).toHaveLength(1);
    // El complemento queda CONGELADO con su nombre y su precio (BR-PRICE-004).
    expect(obj(addons[0] ?? {}).nameSnapshot).toBe('Leche de avena');
    expect(num(obj(addons[0] ?? {}).priceMinor)).toBe(1_500);
  });

  it('acepta cantidades fraccionables y redondea half-up UNA vez (BR-PRICE-002)', async () => {
    // 1.005 x 1.5 = 1.507,5 -> 1.508 con redondeo half-up (BR-MONEY-011).
    const productId = await createProduct({ basePriceMinor: 1_005 });
    const response = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [{ productId, quantity: 1.5 }] },
      cashierToken,
    ).expect(201);
    const order = obj(response.body.data);
    expect(num(order.subtotalMinor)).toBe(1_508);
    // El impuesto se calcula sobre la LÍNEA ya redondeada, no sobre el valor
    // fraccionario: 1.508 x 19 % = 286,52 -> 287.
    expect(num(order.taxMinor)).toBe(287);
    expect(num(order.totalMinor)).toBe(1_795);
  });

  it('aplica el orden línea -> subtotal -> descuento -> impuesto -> total (BR-MONEY-003)', async () => {
    // Caso límite de redondeo, calculado a mano:
    //   línea     3 x 10.001 = 30.003
    //   subtotal  30.003
    //   descuento 10 % = 3.000,3 -> 3.000
    //   base      27.003
    //   impuesto  27.003 x 19 % = 5.130,57 -> 5.131
    //   total     27.003 + 5.131 = 32.134
    const productId = await createProduct({ basePriceMinor: 10_001 });
    const code = `LIM${nextSeq()}`;
    await post(
      '/api/v1/discounts',
      { code, name: 'Diez por ciento', type: 'PERCENT', value: 1_000 },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/orders',
      { ...takeawayBody(productId, 3), couponCode: code },
      cashierToken,
    ).expect(201);

    const order = obj(response.body.data);
    expect(num(order.subtotalMinor)).toBe(30_003);
    expect(num(order.discountMinor)).toBe(3_000);
    expect(num(order.taxMinor)).toBe(5_131);
    expect(num(order.totalMinor)).toBe(32_134);
    expect(order.couponCode).toBe(code);
  });

  it('reparte el descuento entre líneas sin perder ni inventar centavos (BR-MONEY-005)', async () => {
    // Tres líneas iguales de 3.333 y un cupón fijo de 1.000: 1.000 no es
    // divisible por 3, y el centavo sobrante va a la línea de mayor
    // `line_total_minor`, con desempate por `id` ascendente.
    const a = await createProduct({ basePriceMinor: 3_333 });
    const b = await createProduct({ basePriceMinor: 3_333 });
    const c = await createProduct({ basePriceMinor: 3_333 });
    const code = `PRR${nextSeq()}`;
    await post(
      '/api/v1/discounts',
      { code, name: 'Mil pesos fijos', type: 'FIXED', value: 1_000 },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/orders',
      {
        type: 'TAKEAWAY',
        items: [{ productId: a, quantity: 1 }, { productId: b, quantity: 1 }, { productId: c, quantity: 1 }],
        couponCode: code,
      },
      cashierToken,
    ).expect(201);

    const order = obj(response.body.data);
    expect(num(order.subtotalMinor)).toBe(9_999);
    expect(num(order.discountMinor)).toBe(1_000);
    // El impuesto se calcula sobre cada línea MENOS su parte de descuento, y cada
    // parte se redondea por separado: 3333-334=2999 (19 %=570), 3333-333=3000
    // (570), 3333-333=3000 (570) -> 1.710.
    expect(num(order.taxMinor)).toBe(1_710);
    // 9.999 - 1.000 + 1.710 = 10.709.
    expect(num(order.totalMinor)).toBe(10_709);

    const items = (order.items as Record<string, unknown>[]).map(obj);
    const discounts = items.map((item) => num(item.discountMinor));
    expect(discounts.reduce((acc, value) => acc + value, 0)).toBe(1_000);
    // El centavo de ajuste va a la PRIMERA línea (mayor importe, desempate por id).
    expect(discounts).toEqual([334, 333, 333]);
  });

  it('rechaza un cupón caducado o inexistente con un error claro, no en silencio', async () => {
    const productId = await createProduct({ basePriceMinor: 20_000 });

    const missing = await post(
      '/api/v1/orders',
      { ...takeawayBody(productId), couponCode: 'NOEXISTE99' },
      cashierToken,
    ).expect(422);
    expect(obj(missing.body.error).details).toMatchObject({ code: 'DISCOUNT_NOT_FOUND' });

    const code = `CAD${nextSeq()}`;
    await post(
      '/api/v1/discounts',
      { code, name: 'Caducado', type: 'FIXED', value: 500, endsAt: inMinutes(-10), startsAt: inMinutes(-120) },
      adminToken,
    ).expect(201);

    const expired = await post(
      '/api/v1/orders',
      { ...takeawayBody(productId), couponCode: code },
      cashierToken,
    ).expect(422);
    expect(obj(expired.body.error).details).toMatchObject({ code: 'DISCOUNT_EXPIRED' });
  });

  it('rechaza un cupón por debajo del pedido mínimo (BR-DISC-009)', async () => {
    const productId = await createProduct({ basePriceMinor: 5_000 });
    const code = `MIN${nextSeq()}`;
    await post(
      '/api/v1/discounts',
      { code, name: 'Solo pedidos grandes', type: 'FIXED', value: 1_000, minOrderMinor: 50_000 },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/orders',
      { ...takeawayBody(productId), couponCode: code },
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'DISCOUNT_MIN_ORDER_NOT_MET' });
  });

  it('recorta un descuento mayor que el subtotal (BR-DISC-002 / CHECK ck_orders_discount)', async () => {
    const productId = await createProduct({ basePriceMinor: 3_000 });
    const code = `CAP${nextSeq()}`;
    await post(
      '/api/v1/discounts',
      { code, name: 'Cien mil de descuento', type: 'FIXED', value: 100_000 },
      adminToken,
    ).expect(201);

    const response = await post(
      '/api/v1/orders',
      { ...takeawayBody(productId), couponCode: code },
      cashierToken,
    ).expect(201);

    const order = obj(response.body.data);
    // El descuento se recorta a la base: nunca supera el subtotal (3.000).
    expect(num(order.subtotalMinor)).toBe(3_000);
    expect(num(order.discountMinor)).toBe(3_000);
    expect(num(order.taxMinor)).toBe(0);
    expect(num(order.totalMinor)).toBe(0);
  });

  it('deja el pedido en DRAFT con place=false y sin líneas (BR-ORDER-002)', async () => {
    const response = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [], place: false },
      cashierToken,
    ).expect(201);
    const order = obj(response.body.data);
    expect(order.status).toBe('DRAFT');
    expect(num(order.totalMinor)).toBe(0);
    expect(order.placedAt).toBeNull();
  });

  it('un pedido colocado sin líneas es 422 EMPTY_ORDER (BR-ORDER-007)', async () => {
    const response = await post('/api/v1/orders', { type: 'TAKEAWAY', items: [] }, cashierToken).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'EMPTY_ORDER' });
  });

  it('un producto no disponible es 422 PRODUCT_UNAVAILABLE (BR-PRICE-006)', async () => {
    const productId = await createProduct({ basePriceMinor: 5_000, isAvailable: false });
    const response = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'PRODUCT_UNAVAILABLE' });
  });

  it('un complemento ajeno al producto es 422 ADDON_NOT_IN_PRODUCT (BR-PRICE-012)', async () => {
    const productId = await createProduct({ basePriceMinor: 5_000 });
    const otherProductId = await createProduct({
      basePriceMinor: 5_000,
      addons: [{ name: 'Extra', priceMinor: 500 }],
    });
    const foreignAddonId = await firstAddonId(otherProductId, 'Extra');

    const response = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [{ productId, quantity: 1, addons: [{ productAddonId: foreignAddonId, quantity: 1 }] }] },
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'ADDON_NOT_IN_PRODUCT' });
  });
});

// ==========================================================================
// Transaccionalidad: la prueba más importante del módulo
// ==========================================================================

describe('Atomicidad de la creación de pedido (DESIGN.md 8.4 y 8.5)', () => {
  it('ROLLBACK TOTAL si el stock no alcanza: no queda orders, ni order_items, ni movimientos', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000, trackStock: true });
    const inventoryItemId = await createStock(productId, 1);

    const before = {
      orders: countRows('orders'),
      items: countRows('order_items'),
      movements: countRows('inventory_movements'),
      stock: currentStock(inventoryItemId),
    };

    // Se piden 5 unidades y sólo hay 1: `NEGATIVE_STOCK_BLOCKED` (BR-INV-002).
    const response = await post(
      '/api/v1/orders',
      takeawayBody(productId, 5),
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'NEGATIVE_STOCK_BLOCKED' });

    // NADA debe haber quedado escrito: ni la cabecera, ni la línea, ni el
    // movimiento de inventario que se había inserted antes de fallar.
    expect(countRows('orders')).toBe(before.orders);
    expect(countRows('order_items')).toBe(before.items);
    expect(countRows('inventory_movements')).toBe(before.movements);
    // El saldo tampoco se movió: el movimiento y su `UPDATE` son atómicos.
    expect(currentStock(inventoryItemId)).toBe(before.stock);
  });

  it('ROLLBACK TOTAL si falla el cupón DESPUÉS de reservar stock', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000, trackStock: true });
    const inventoryItemId = await createStock(productId, 50);

    // Un cupón con límite de usos YA AGOTADO: el paso 3 (inventario) se ejecuta
    // antes que el paso 4 (cupón), así que el fallo tiene que deshacer el stock.
    const code = `EXH${nextSeq()}`;
    const created = await post(
      '/api/v1/discounts',
      { code, name: 'Agotado', type: 'FIXED', value: 500, usageLimit: 1 },
      adminToken,
    ).expect(201);
    const discountId = Number(obj(created.body.data).id);
    // Se consume el único uso con un pedido de otro cliente.
    ctx.db.prepare('UPDATE discounts SET used_count = 1 WHERE id = ?').run(discountId);

    const before = {
      orders: countRows('orders'),
      items: countRows('order_items'),
      movements: countRows('inventory_movements'),
      stock: currentStock(inventoryItemId),
    };

    const response = await post(
      '/api/v1/orders',
      { ...takeawayBody(productId, 2), couponCode: code },
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'DISCOUNT_LIMIT_REACHED' });

    expect(countRows('orders')).toBe(before.orders);
    expect(countRows('order_items')).toBe(before.items);
    // Éste es el punto clave: el movimiento `RESERVATION` se insertó en el paso 3
    // y debe haber desaparecido con el rollback.
    expect(countRows('inventory_movements')).toBe(before.movements);
    expect(currentStock(inventoryItemId)).toBe(before.stock);
  });

  it('escribe el movimiento RESERVATION junto con el descuento de stock (BR-INV-004)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000, trackStock: true });
    const inventoryItemId = await createStock(productId, 10);
    const before = currentStock(inventoryItemId);

    const response = await post('/api/v1/orders', takeawayBody(productId, 3), cashierToken).expect(201);
    const orderId = num(obj(response.body.data).id);

    // El saldo baja 3 y hay un movimiento `RESERVATION` negativo de -3.
    expect(currentStock(inventoryItemId)).toBe(before - 3);
    const movement = ctx.db
      .prepare(
        `SELECT movement_type, quantity, balance_after, reference_type, reference_id
           FROM inventory_movements
          WHERE inventory_item_id = ? AND reference_type = 'ORDER' AND reference_id = ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(inventoryItemId, orderId) as
      | { movement_type: string; quantity: number; balance_after: number; reference_type: string; reference_id: number }
      | undefined;
    expect(movement).toBeDefined();
    expect(movement?.movement_type).toBe('RESERVATION');
    expect(movement?.quantity).toBe(-3);
    expect(movement?.balance_after).toBe(before - 3);
    expect(movement?.reference_type).toBe('ORDER');
    expect(movement?.reference_id).toBe(orderId);
  });

  it('crea el pago del body en el MISMO commit que el pedido', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const response = await post(
      '/api/v1/orders',
      {
        type: 'TAKEAWAY',
        customerId,
        items: [{ productId, quantity: 1 }],
        // 10.000 + 19 % = 11.900. Se entregan 20.000 -> cambio 8.100.
        payment: { receivedMinor: 20_000, referenceNumber: 'REC-001' },
      },
      cashierToken,
    ).expect(201);

    expect(num(response.body.meta.changeDueMinor)).toBe(8_100);
    const paymentNumber = String(response.body.meta.paymentNumber);
    expect(paymentNumber).toMatch(/^PAY-\d{6}$/);

    const order = obj(response.body.data);
    expect(num(order.paidMinor)).toBe(11_900);
    expect(num(order.balanceMinor)).toBe(0);
    // Un solo commit: el pago existe CON el pedido, no después.
    const payment = ctx.db
      .prepare('SELECT order_id, amount_minor, status, method, provider FROM payments WHERE payment_number = ?')
      .get(paymentNumber) as
      | { order_id: number; amount_minor: number; status: string; method: string; provider: string | null }
      | undefined;
    expect(payment?.order_id).toBe(num(order.id));
    // El importe GUARDADO es el imputado, nunca el entregado: si se guardara el
    // efectivo, `paid_minor` sería 20.000 y el saldo -8.100 (BR-MONEY-007).
    expect(payment?.amount_minor).toBe(11_900);
    expect(payment?.status).toBe('APPROVED');
    expect(payment?.method).toBe('CASH');
    expect(payment?.provider).toBe('CASH_REGISTRY');
  });

  it('revierte el pago si el efectivo no alcanza (never fail en el cobro)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const before = {
      orders: countRows('orders'),
      payments: countRows('payments'),
    };

    // El pedido cuesta 11.900 y se entregan 5.000. El esquema no puede saber el
    // total (lo calcula el servidor), así que el rechazo es un `422
    // INVALID_AMOUNT_FOR_METHOD` del service, no un `400` de forma.
    const response = await post(
      '/api/v1/orders',
      {
        type: 'TAKEAWAY',
        items: [{ productId, quantity: 1 }],
        payment: { receivedMinor: 5_000 },
      },
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'INVALID_AMOUNT_FOR_METHOD' });

    // Y lo más importante: no queda ni el pedido ni el cobro a medias.
    expect(countRows('orders')).toBe(before.orders);
    expect(countRows('payments')).toBe(before.payments);
    expect(response.body.success).toBe(false);
  });
});

// ==========================================================================
// Máquina de estados
// ==========================================================================

describe('POST /api/v1/orders/:id/status', () => {
  it('recorre el ciclo completo PENDING -> CONFIRMED -> PREPARING -> READY -> COMPLETED', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);

    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      const response = await post(
        `/api/v1/orders/${orderId}/status`,
        { toStatus: status },
        cashierToken,
      ).expect(200);
      expect(obj(response.body.data).status).toBe(status);
    }

    const detail = await get(`/api/v1/orders/${orderId}`, cashierToken).expect(200);
    expect(obj(detail.body.data).completedAt).not.toBeNull();
  });

  it('COMPLETED -> PREPARING es IMPOSIBLE: 422 con el código de la regla (DESIGN.md 6.1)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);

    await post(`/api/v1/orders/${orderId}/status`, { toStatus: 'CONFIRMED' }, cashierToken).expect(200);
    await post(`/api/v1/orders/${orderId}/status`, { toStatus: 'PREPARING' }, cashierToken).expect(200);
    await post(`/api/v1/orders/${orderId}/status`, { toStatus: 'READY' }, cashierToken).expect(200);
    await post(`/api/v1/orders/${orderId}/status`, { toStatus: 'COMPLETED' }, cashierToken).expect(200);

    const response = await post(
      `/api/v1/orders/${orderId}/status`,
      { toStatus: 'PREPARING' },
      cashierToken,
    ).expect(422);

    const details = obj(response.body.error).details as Record<string, unknown>;
    expect(details.code).toBe('INVALID_ORDER_TRANSITION');
    expect(details.from).toBe('COMPLETED');
    expect(details.to).toBe('PREPARING');
    // `allowed` permite a la UI desactivar el botón sin conocer la tabla.
    expect(details.allowed).toEqual(['REFUNDED']);
    expect(String(details.reason)).toContain('no vuelve a la cocina');
  });

  it('COMPLETED -> COMPLETED también es imposible (idempotencia prohibida)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      await post(`/api/v1/orders/${orderId}/status`, { toStatus: status }, cashierToken).expect(200);
    }
    const response = await post(
      `/api/v1/orders/${orderId}/status`,
      { toStatus: 'COMPLETED' },
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'INVALID_ORDER_TRANSITION' });
  });

  it('CANCELLED sin motivo se rechaza en el esquema ANTES de tocar la base (ck_order_history_reason)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);

    const response = await post(
      `/api/v1/orders/${orderId}/status`,
      { toStatus: 'CANCELLED' },
      cashierToken,
    ).expect(400);

    const paths = (response.body.error.details as { path: string }[]).map((detail) => detail.path);
    expect(paths).toContain('reason');
    // Y el pedido sigue abierto: no se écritió nada.
    const detail = await get(`/api/v1/orders/${orderId}`, cashierToken).expect(200);
    expect(obj(detail.body.data).status).toBe('PENDING');
  });

  it('POST /:id/cancel con motivo cancela y libera el stock', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000, trackStock: true });
    const inventoryItemId = await createStock(productId, 10);
    const before = currentStock(inventoryItemId);

    const created = await post('/api/v1/orders', takeawayBody(productId, 2), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);
    expect(currentStock(inventoryItemId)).toBe(before - 2);

    const response = await post(
      `/api/v1/orders/${orderId}/cancel`,
      { reason: 'El cliente cambió de idea' },
      cashierToken,
    ).expect(200);

    expect(obj(response.body.data.order).status).toBe('CANCELLED');
    // El stock reservado vuelve: la secuencia es `RESERVATION -> RELEASE`.
    expect(currentStock(inventoryItemId)).toBe(before);
    const released = response.body.data.stockReleased as Record<string, unknown>[];
    expect(released).toHaveLength(1);
    expect(num(obj(released[0] ?? {}).quantity)).toBe(2);
  });

  it('POST /:id/confirm es el atajo de la transición PENDING -> CONFIRMED', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);

    const confirmed = await post(
      `/api/v1/orders/${orderId}/confirm`,
      { notes: 'mesa 4' },
      cashierToken,
    ).expect(200);
    expect(obj(confirmed.body.data).status).toBe('CONFIRMED');
    expect(obj(confirmed.body.data).notes).toBe('mesa 4');
    expect(obj(confirmed.body.data).confirmedAt).not.toBeNull();
  });

  it('un DRAFT no se puede confirmar: la máquina no tiene DRAFT -> CONFIRMED', async () => {
    // `DESIGN.md` 6.1: de `DRAFT` sólo se sale a `PENDING` (colocar) o a
    // `CANCELLED`. Confirmar un borrador sin colocarlo es imposible por
    // construcción, no por un `if` del service.
    const draft = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [{ productId: 1, quantity: 1 }], place: false },
      cashierToken,
    ).expect(201);
    const draftId = num(obj(draft.body.data).id);

    const response = await post(`/api/v1/orders/${draftId}/confirm`, {}, cashierToken).expect(422);
    const details = obj(response.body.error).details as Record<string, unknown>;
    expect(details.code).toBe('INVALID_ORDER_TRANSITION');
    expect(details.from).toBe('DRAFT');
    expect(details.to).toBe('CONFIRMED');
    expect(details.allowed).toEqual(['PENDING', 'CANCELLED']);
  });

  it('un DRAFT colocado sin líneas no se confirma: 422 EMPTY_ORDER (BR-ORDER-007)', async () => {
    const created = await post('/api/v1/orders', takeawayBody(await createProduct({ basePriceMinor: 10_000 })), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);

    // Se vacía el pedido por la vía que el contrato permite: quitar la última
    // línea está protegido (`LAST_ITEM_REMOVAL`), así que la comprobación de
    // `EMPTY_ORDER` se alcanza desde un `DRAFT` colocado a mano en la base, que es
    // exactamente el estado que dejaría un fallo de integración.
    ctx.db.prepare("UPDATE order_items SET status = 'CANCELLED' WHERE order_id = ?").run(orderId);
    const response = await post(`/api/v1/orders/${orderId}/confirm`, {}, cashierToken).expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'EMPTY_ORDER' });
  });
});

// ==========================================================================
// Inmutabilidad
// ==========================================================================

describe('Inmutabilidad del pedido cerrado (BR-ORDER-017)', () => {
  /**
   * `409 CONFLICT_ERROR / ORDER_IMMUTABLE`, que es lo que fijan API.md 7.12 y
   * BR-ORDER-017. Un pedido abierto pero no editable (`CONFIRMED`, `PREPARING`,
   * `READY`) da en cambio `422 ORDER_NOT_EDITABLE`, que es un caso distinto: no es
   * que el pedido esté cerrado, es que ya no se toca.
   */
  it('un pedido COMPLETED no admite cambios de items: 409 ORDER_IMMUTABLE', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const otherProductId = await createProduct({ basePriceMinor: 7_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);
    const itemId = num(firstItem(obj(created.body.data)).id);

    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      await post(`/api/v1/orders/${orderId}/status`, { toStatus: status }, cashierToken).expect(200);
    }

    // Añadir una línea nueva.
    const addResponse = await post(
      `/api/v1/orders/${orderId}/items`,
      { items: [{ productId: otherProductId, quantity: 1 }] },
      cashierToken,
    ).expect(409);
    expect(obj(addResponse.body.error).details).toMatchObject({ code: 'ORDER_IMMUTABLE' });

    // Editar una línea existente.
    const patchResponse = await patch(
      `/api/v1/orders/items/${itemId}`,
      { quantity: 3 },
      cashierToken,
    ).expect(409);
    expect(obj(patchResponse.body.error).details).toMatchObject({ code: 'ORDER_IMMUTABLE' });

    // Quitar una línea.
    const deleteResponse = await agent
      .delete(`/api/v1/orders/items/${itemId}`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({})
      .expect(409);
    expect(obj(deleteResponse.body.error).details).toMatchObject({ code: 'ORDER_IMMUTABLE' });

    // Y las cifras no han cambiado.
    const detail = await get(`/api/v1/orders/${orderId}`, cashierToken).expect(200);
    expect(num(obj(detail.body.data).totalMinor)).toBe(11_900);
    expect(obj(detail.body.data).items as unknown[]).toHaveLength(1);
  });

  it('un pedido cerrado SÍ admite `notes` y nada más (única excepción)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);
    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      await post(`/api/v1/orders/${orderId}/status`, { toStatus: status }, cashierToken).expect(200);
    }

    // `notes` sola: permitido.
    const ok = await patch(
      `/api/v1/orders/${orderId}`,
      { notes: 'Se devolvieron 200 pesos' },
      cashierToken,
    ).expect(200);
    expect(obj(ok.body.data).notes).toBe('Se devolvieron 200 pesos');
    // No altera ninguna cifra.
    expect(num(obj(ok.body.data).totalMinor)).toBe(11_900);

    // `notes` con otro campo: rechazado.
    const notOk = await patch(
      `/api/v1/orders/${orderId}`,
      { notes: 'otra nota', customerNotes: 'intento de truco' },
      cashierToken,
    ).expect(409);
    expect(obj(notOk.body.error).details).toMatchObject({ code: 'ORDER_IMMUTABLE' });
  });
});

// ==========================================================================
// Alquiler de silla
// ==========================================================================

describe('Pedidos CHAIR_RENTAL', () => {
  it('suma el total del alquiler al total del pedido', async () => {
    const rental = await createActiveRentalWithReservation(60);
    // 60 minutos a $50.000/h = 5.000.000 centavos.
    expect(rental.rentalTotalMinor).toBe(5_000_000);

    const response = await post(
      '/api/v1/orders',
      {
        type: 'CHAIR_RENTAL',
        chairId: rental.chairId,
        reservationId: rental.reservationId,
        rentalId: rental.rentalId,
        customerId,
      },
      cashierToken,
    ).expect(201);

    const order = obj(response.body.data);
    // El subtotal ES el total del alquiler: el alquiler entra en el pedido tal
    // cual (BR-RENTAL-006) y es el pedido quien le aplica el impuesto.
    expect(num(order.subtotalMinor)).toBe(5_000_000);
    expect(num(order.discountMinor)).toBe(0);
    // BR-TAX-007: el alquiler se grava a la tasa del negocio, 19 %.
    expect(num(order.taxMinor)).toBe(950_000);
    expect(num(order.totalMinor)).toBe(5_950_000);
    expect(order.type).toBe('CHAIR_RENTAL');
    expect(num(order.chairId)).toBe(rental.chairId);
    expect(num(order.reservationId)).toBe(rental.reservationId);
  });

  it('un CHAIR_RENTAL sin silla es 422 legible, no un error de SQLite', async () => {
    const rental = await createActiveRentalWithReservation(60);
    const response = await post(
      '/api/v1/orders',
      { type: 'CHAIR_RENTAL', reservationId: rental.reservationId, customerId },
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({
      code: 'RENTAL_REQUIRES_CHAIR_AND_RESERVATION',
      ruleId: 'BR-ORDER-008',
      field: 'chairId',
    });
  });

  it('un CHAIR_RENTAL sin reserva es 422 con el campo concreto', async () => {
    const rental = await createActiveRentalWithReservation(60);
    const response = await post(
      '/api/v1/orders',
      { type: 'CHAIR_RENTAL', chairId: rental.chairId, customerId },
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({
      code: 'RENTAL_REQUIRES_CHAIR_AND_RESERVATION',
      field: 'reservationId',
    });
  });

  it('un CHAIR_RENTAL con líneas de producto es 422 MIXED (BR-ORDER-012)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const rental = await createActiveRentalWithReservation(60);
    const response = await post(
      '/api/v1/orders',
      {
        type: 'CHAIR_RENTAL',
        chairId: rental.chairId,
        reservationId: rental.reservationId,
        rentalId: rental.rentalId,
        items: [{ productId, quantity: 1 }],
        customerId,
      },
      cashierToken,
    ).expect(422);
    expect(obj(response.body.error).details).toMatchObject({
      code: 'MIXED_ORDER_TYPE_NOT_ALLOWED',
      ruleId: 'BR-ORDER-012',
    });
  });

  it('al completar el pedido la silla pasa a CLEANING (BR-ORDER-015 / BR-RENTAL-008)', async () => {
    const rental = await createActiveRentalWithReservation(60);
    const created = await post(
      '/api/v1/orders',
      {
        type: 'CHAIR_RENTAL',
        chairId: rental.chairId,
        reservationId: rental.reservationId,
        rentalId: rental.rentalId,
        customerId,
      },
      cashierToken,
    ).expect(201);
    const orderId = num(obj(created.body.data).id);

    // Tras el check-in la silla está `OCCUPIED`.
    const occupied = await get(`/api/v1/chairs/${rental.chairId}`, cashierToken).expect(200);
    expect(obj(occupied.body.data.chair).status).toBe('OCCUPIED');

    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      await post(`/api/v1/orders/${orderId}/status`, { toStatus: status }, cashierToken).expect(200);
    }

    // Al completar, la silla se libera a `CLEANING`.
    const released = await get(`/api/v1/chairs/${rental.chairId}`, cashierToken).expect(200);
    expect(obj(released.body.data.chair).status).toBe('CLEANING');
  });
});

// ==========================================================================
// DINE_IN
// ==========================================================================

describe('Pedidos DINE_IN', () => {
  it('puede no tener silla (barra sin asignar) — BR-ORDER-009', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const response = await post(
      '/api/v1/orders',
      { type: 'DINE_IN', tableLabel: 'Barra 3', items: [{ productId, quantity: 1 }] },
      cashierToken,
    ).expect(201);
    const order = obj(response.body.data);
    expect(order.type).toBe('DINE_IN');
    expect(order.chairId).toBeNull();
    expect(order.tableLabel).toBe('Barra 3');
  });

  it('puede llevar silla y la valida', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const chairId = await createChair();
    const response = await post(
      '/api/v1/orders',
      { type: 'DINE_IN', chairId, items: [{ productId, quantity: 1 }] },
      cashierToken,
    ).expect(201);
    expect(num(obj(response.body.data).chairId)).toBe(chairId);
  });
});

// ==========================================================================
// Edición de líneas
// ==========================================================================

describe('Edición de líneas del pedido', () => {
  it('añade líneas, edita cantidad y recalcula los totales', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const otherProductId = await createProduct({ basePriceMinor: 5_000 });

    const created = await post('/api/v1/orders', takeawayBody(productId, 1), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);

    // +5.000 de subtotal y 950 de impuesto.
    const added = await post(
      `/api/v1/orders/${orderId}/items`,
      { items: [{ productId: otherProductId, quantity: 1 }] },
      cashierToken,
    ).expect(201);
    const afterAdd = obj(obj(added.body.data).order);
    expect(num(afterAdd.subtotalMinor)).toBe(15_000);
    expect(num(afterAdd.taxMinor)).toBe(2_850);
    expect(num(afterAdd.totalMinor)).toBe(17_850);

    // Cantidad 3 en la primera línea: 30.000 + 5.000 = 35.000.
    const itemId = num(firstItem(afterAdd).id);
    const updated = await patch(
      `/api/v1/orders/items/${itemId}`,
      { quantity: 3 },
      cashierToken,
    ).expect(200);
    const afterEdit = obj(obj(updated.body.data).order);
    expect(num(afterEdit.subtotalMinor)).toBe(35_000);
    expect(num(afterEdit.taxMinor)).toBe(6_650);
    expect(num(afterEdit.totalMinor)).toBe(41_650);
  });

  it('quitar la última línea es 422 LAST_ITEM_REMOVAL', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const itemId = num(firstItem(obj(created.body.data)).id);

    const response = await agent
      .delete(`/api/v1/orders/items/${itemId}`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({})
      .expect(422);
    expect(obj(response.body.error).details).toMatchObject({ code: 'LAST_ITEM_REMOVAL' });
  });

  it('quitar una línea libera su stock reservado (BR-INV-004)', async () => {
    const tracked = await createProduct({ basePriceMinor: 10_000, trackStock: true });
    const plain = await createProduct({ basePriceMinor: 4_000 });
    const inventoryItemId = await createStock(tracked, 10);
    const before = currentStock(inventoryItemId);

    const created = await post(
      '/api/v1/orders',
      { type: 'TAKEAWAY', items: [{ productId: tracked, quantity: 2 }, { productId: plain, quantity: 1 }] },
      cashierToken,
    ).expect(201);
    expect(currentStock(inventoryItemId)).toBe(before - 2);

    // Se quita la línea CON stock: la otra sigue, así que no es
    // `LAST_ITEM_REMOVAL`.
    const itemId = num(firstItem(obj(created.body.data)).id);
    const response = await agent
      .delete(`/api/v1/orders/items/${itemId}`)
      .set('Authorization', `Bearer ${cashierToken}`)
      .send({})
      .expect(200);
    // El stock reservado vuelve con un `RELEASE`, nunca con un `SALE`.
    expect(currentStock(inventoryItemId)).toBe(before);
    const removed = obj(obj(response.body.data).removedItem);
    expect(num(removed.quantity)).toBe(2);
    expect(num(obj(obj(response.body.data).recalculated).subtotalMinor)).toBe(4_000);
  });
});

// ==========================================================================
// Recibo e historial
// ==========================================================================

describe('GET /api/v1/orders/:id/receipt y /history', () => {
  it('el recibo se construye SOLO con snapshots: cambiar el precio no lo altera (BR-ORDER-018)', async () => {
    const productId = await createProduct({ basePriceMinor: 20_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId, 2), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);
    const orderNumber = String(obj(created.body.data).orderNumber);

    const before = await get(`/api/v1/orders/${orderId}/receipt`, cashierToken).expect(200);
    const receiptBefore = obj(before.body.data);
    expect(receiptBefore.orderNumber).toBe(orderNumber);
    expect(obj(receiptBefore.business).name).toBe('LatteCoffe');
    expect((receiptBefore.items as unknown[])).toHaveLength(1);
    expect(num(firstItem(receiptBefore).unitPriceMinor)).toBe(20_000);
    expect(num(obj(receiptBefore.totals).totalMinor)).toBe(47_600);

    // Se sube el precio del producto a 999.999.
    await patch(
      `/api/v1/products/${productId}`,
      { basePriceMinor: 999_999 },
      adminToken,
    ).expect(200);

    const after = await get(`/api/v1/orders/${orderId}/receipt`, cashierToken).expect(200);
    const receiptAfter = obj(after.body.data);
    // Ni el nombre, ni el precio, ni el total han cambiado.
    expect(num(firstItem(receiptAfter).unitPriceMinor)).toBe(20_000);
    expect(num(obj(receiptAfter.totals).totalMinor)).toBe(47_600);
    expect(num(obj(receiptAfter.totals).subtotalMinor)).toBe(40_000);
  });

  it('el historial empieza con `fromStatus = null` y conserva cada transición', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);
    const orderId = num(obj(created.body.data).id);

    for (const status of ['CONFIRMED', 'PREPARING']) {
      await post(`/api/v1/orders/${orderId}/status`, { toStatus: status }, cashierToken).expect(200);
    }

    // Por defecto el historial viene del más reciente al más antiguo, que es lo
    // que quiere la pantalla del cajero; se pide `asc` para recorrer la cadena.
    const history = await get(`/api/v1/orders/${orderId}/history?order=asc`, cashierToken).expect(200);
    const entries = (history.body.data as Record<string, unknown>[]).map(obj);
    // BR-ORDER-013: la creación también deja rastro, con `fromStatus = null`.
    expect(entries.length).toBe(3);
    expect(entries[0]?.fromStatus).toBeNull();
    expect(entries[0]?.toStatus).toBe('PENDING');
    expect(entries[1]?.toStatus).toBe('CONFIRMED');
    expect(entries[1]?.fromStatus).toBe('PENDING');
    expect(entries[2]?.toStatus).toBe('PREPARING');
    // El actor queda registrado: es lo que permite auditar quién movió el pedido.
    expect(entries[1]?.changedByName).toBe('Cajero');
  });
});

// ==========================================================================
// RBAC y alcance
// ==========================================================================

describe('Alcance de cliente (BR-SEC-008, DESIGN.md 9.3)', () => {
  it('un CUSTOMER puede crear pedidos y ver sólo los suyos', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post('/api/v1/orders', takeawayBody(productId), customerToken).expect(201);
    const orderId = num(obj(created.body.data).id);
    // El `customerId` del BODY se ignora para un cliente: sale del token.
    expect(num(obj(created.body.data).customerId)).toBe(customerId);

    const list = await get('/api/v1/orders', customerToken).expect(200);
    const rows = (list.body.data as Record<string, unknown>[]).map(obj);
    for (const row of rows) {
      expect(num(row.customerId)).toBe(customerId);
    }
    expect(rows.some((row) => num(row.id) === orderId)).toBe(true);
  });

  it('un CUSTOMER NO ve un pedido de otro cliente: 404, no 403 (API.md 2)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const created = await post(
      '/api/v1/orders',
      { ...takeawayBody(productId), customerId: otherCustomerId },
      cashierToken,
    ).expect(201);
    const orderId = num(obj(created.body.data).id);

    // El cliente ajeno recibe 404: no se revela la existencia del pedido.
    const forbidden = await get(`/api/v1/orders/${orderId}`, customerToken).expect(404);
    expect(obj(forbidden.body.error).code).toBe('NOT_FOUND_ERROR');

    // Tampoco el recibo ni el historial.
    await get(`/api/v1/orders/${orderId}/receipt`, customerToken).expect(404);
    await get(`/api/v1/orders/${orderId}/history`, customerToken).expect(404);
  });

  it('`?customerId=<otro>` no engaña al filtro de alcance', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    await post(
      '/api/v1/orders',
      { ...takeawayBody(productId), customerId: otherCustomerId },
      cashierToken,
    ).expect(201);

    const list = await get(`/api/v1/orders?customerId=${otherCustomerId}`, customerToken).expect(200);
    const rows = (list.body.data as Record<string, unknown>[]).map(obj);
    for (const row of rows) {
      expect(num(row.customerId)).toBe(customerId);
    }
  });

  it('crear un pedido sin autenticación es 401 (BR-SEC-005)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    const response = await post('/api/v1/orders', takeawayBody(productId)).expect(401);
    expect(obj(response.body.error).code).toBe('AUTHENTICATION_ERROR');
    expect(obj(response.body.error).details).toMatchObject({ code: 'MISSING_TOKEN' });
  });

  it('un CASHIER puede crear pedidos (orders:create) pero no reembolsar (payments:refund)', async () => {
    const productId = await createProduct({ basePriceMinor: 10_000 });
    await post('/api/v1/orders', takeawayBody(productId), cashierToken).expect(201);

    const forbidden = await agent
      .post('/api/v1/payments/1/refund')
      .set('Authorization', `Bearer ${cashierToken}`)
      .set('Idempotency-Key', '11111111-1111-4111-8111-111111111111')
      .send({ amountMinor: 1, reason: 'intento no autorizado' })
      .expect(403);
    expect(obj(forbidden.body.error).details).toMatchObject({ required: 'payments:refund' });
  });
});

// ==========================================================================
// Utilidades locales del fichero
// ==========================================================================

/** Cuenta filas de una tabla, para las aserciones de rollback. */
function countRows(table: string): number {
  const row = ctx.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
  return row.total;
}

/** Saldo actual de un ítem de inventario. */
function currentStock(inventoryItemId: number): number {
  const row = ctx.db
    .prepare('SELECT current_stock FROM inventory_items WHERE id = ?')
    .get(inventoryItemId) as { current_stock: number } | undefined;
  return row?.current_stock ?? Number.NaN;
}

/** Id de la primera variante de un producto por su nombre. */
async function firstVariantId(productId: number, variantName: string): Promise<number> {
  const response = await get(`/api/v1/products/${productId}`, adminToken).expect(200);
  const variants = obj(response.body.data).variants as Record<string, unknown>[];
  const found = variants.find((variant) => variant.name === variantName);
  if (found === undefined) {
    throw new Error(`No se encontró la variante ${variantName} del producto ${productId}`);
  }
  return num(found.id);
}

/** Id del primer complemento de un producto por su nombre. */
async function firstAddonId(productId: number, addonName: string): Promise<number> {
  const response = await get(`/api/v1/products/${productId}`, adminToken).expect(200);
  const addons = obj(response.body.data).addons as Record<string, unknown>[];
  const found = addons.find((addon) => addon.name === addonName);
  if (found === undefined) {
    throw new Error(`No se encontró el complemento ${addonName} del producto ${productId}`);
  }
  return num(found.id);
}

/** Tasa de impuesto efectiva, expuesta para las aserciones de los tests. */
