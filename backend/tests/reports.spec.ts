/**
 * Pruebas del módulo de REPORTES.
 *
 * ============================================================================
 * LA PRUEBA QUE IMPORTA ES LA DE LA MEDIANOCHE
 * ============================================================================
 * `reports.tz.ts` existe porque un reporte de "hoy" calculado en UTC sale
 * desplazado cinco horas. La prueba `preset=today` de este fichero siembra un
 * pedido a las **21:30 hora de Bogotá**, que en UTC es el día SIGUIENTE, y otro
 * a las 21:30 de Bogotá de AYER, que en UTC es el día de HOY. Si el agrupamiento
 * se hiciera en UTC, el primero se contaría mañana y el segundo hoy, y las dos
 * aserciones fallarían.
 *
 * El resto de pruebas comprueban que cada endpoint devuelve los valores
 * EXACTOS, en centavos enteros, con el desglose correcto.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent.js';

import { createTestContext, VALID_TEST_PASSWORD, type TestContext } from './helpers/harness.js';
import { API_PREFIX, AUTH } from '../src/config/index.js';
import { createApiV1Router } from '../src/modules/index.js';
import { categoriesRouter, productsRouter } from '../src/modules/catalog/catalog.routes.js';
import { reportsRouter } from '../src/modules/reports/reports.routes.js';
import { seedSpacesDemo } from '../src/database/seeds/spaces-demo.seed.js';
import {
  localDateKey,
  parseLocalDateKey,
  startOfLocalDayUtc,
  zonedToUtc,
} from '../src/modules/reports/reports.tz.js';
import {
  corsMiddleware,
  errorHandler,
  jsonBody,
  notFound,
  requestContext,
  securityHeaders,
  setRateLimitingEnabled,
} from '../src/shared/middleware/index.js';

/**
 * Este fichero NO debe heredar datos de demostración ajenos.
 *
 * `runSeed()` siembra, en cualquier entorno que no sea producción, un catálogo y
 * unas operaciones de ejemplo con `created_at = now`. Si esos pedidos entraran
 * en la base en memoria, los totales de "hoy" de este fichero dejarían de ser
 * los que el test calculó a mano y las aserciones exactas no significarían nada.
 *
 * `demoSeedEnabled()` lee `process.env` en cada llamada (no al importar), así
 * que fijarla aquí, antes del `beforeAll`, es suficiente y no toca `config/env.ts`
 * ni ningún fichero compartido.
 */
process.env['SEED_DEMO_DATA'] = 'false';

// ---------------------------------------------------------------------------
// Datos de la prueba
// ---------------------------------------------------------------------------

/** Zona horaria del negocio sembrado: `America/Bogota`, UTC-5 sin horario de verano. */
const TZ = 'America/Bogota';

/** Tasa de impuesto del negocio sembrado: 1900 bp = 19 % (BR-TAX-001). */
const TAX_BP = 1900;

/** Precios de catálogo, en centavos. */
const PRICE_LATTE = 1_200_000;
const PRICE_FORMULA = 2_000_000;
const PRICE_CROISSANT = 800_000;

/** Coste de inventario, en centavos, para el cálculo de margen. */
const COST_LATTE = 500_000;
const COST_CROISSANT = 300_000;

/** Precio por hora de las sillas de alquiler, en centavos. */
const CHAIR_PRICE_PER_HOUR = 300_000;

/** Nombre del producto con intento de inyección de fórmula en el CSV. */
const FORMULA_NAME = "=cmd|'/c calc'!A1";

/** Fechas locales deterministas alrededor de "hoy" en Bogotá. */
const NOW = new Date();
const TODAY_KEY = localDateKey(NOW, TZ);

/** Instante UTC exacto de las 00:00:00 de HOY en Bogotá. */
const TODAY_START = startOfLocalDayUtc(parseLocalDateKey(TODAY_KEY), TZ);

/** Instante UTC de una hora de pared local, `dayOffset` días respecto de hoy. */
function wall(dayOffset: number, hour: number, minute = 0): string {
  const key = shiftKey(TODAY_KEY, dayOffset);
  return zonedToUtc({ ...parseLocalDateKey(key), hour, minute, second: 0 }, TZ).toISOString();
}

/** Instante UTC de la medianoche local del día `dayOffset` respecto de hoy. */
function midnight(dayOffset: number): string {
  return startOfLocalDayUtc(parseLocalDateKey(shiftKey(TODAY_KEY, dayOffset)), TZ).toISOString();
}

/** Instante UTC de la medianoche local del día 1 del mes en curso. */
function midnightOfMonthStart(): string {
  const key = `${TODAY_KEY.slice(0, 7)}-01`;
  return startOfLocalDayUtc(parseLocalDateKey(key), TZ).toISOString();
}

/** Suma (o resta) días a una clave `YYYY-MM-DD`. */
function shiftKey(key: string, days: number): string {
  const [year, month, day] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + days));
  return shifted.toISOString().slice(0, 10);
}

/** Impuesto del negocio sobre una base, en centavos enteros (BR-TAX-001). */
function taxOf(baseMinor: number): number {
  return Math.floor((baseMinor * TAX_BP) / 10_000 + 0.5);
}

/** Total de un pedido: subtotal + impuesto (el negocio no tiene cargo por servicio). */
function totalOf(subtotalMinor: number): number {
  return subtotalMinor + taxOf(subtotalMinor);
}

// ---------------------------------------------------------------------------
// App de pruebas
// ---------------------------------------------------------------------------

let ctx: TestContext;
let agent: TestAgent;
let adminToken: string;
let cashierToken: string;
let customerToken: string;
let managerToken: string;

/**
 * App de pruebas con los routers montados a mano.
 *
 * `src/modules/index.ts` los registra el integrador al final; hasta entonces los
 * tests los montan aquí, igual que hacen `orders.spec.ts` y `rentals.spec.ts`.
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
  api.use('/reports', reportsRouter);
  app.use(API_PREFIX, api);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

function get(path: string, token?: string): request.Test {
  return token === undefined ? agent.get(path) : agent.get(path).set('Authorization', `Bearer ${token}`);
}
function post(path: string, body: unknown, token?: string): request.Test {
  return (token === undefined ? agent.post(path) : agent.post(path).set('Authorization', `Bearer ${token}`)).send(
    body as object,
  );
}

// ---------------------------------------------------------------------------
// Siembra
// ---------------------------------------------------------------------------

let latteId = 0;
let formulaId = 0;
let croissantId = 0;
let categoryId = 0;
let customerOne = 0;
let customerTwo = 0;
let customerThree = 0;
let rentalChairOne = 0;
let rentalChairTwo = 0;
let orderSequence = 0;
let rentalSequence = 0;
let reservationSequence = 0;

/** Inserta un pedido con sus líneas y (opcionalmente) su pago. */
function insertOrder(options: {
  readonly customerId: number | null;
  readonly createdAt: string;
  readonly status?: string;
  readonly type?: string;
  readonly channel?: string;
  readonly locationId?: number | null;
  readonly chairId?: number | null;
  readonly lines: readonly { readonly productId: number; readonly name: string; readonly unitPriceMinor: number; readonly quantity: number }[];
  readonly payment?: { readonly method: string; readonly amountMinor: number; readonly approvedAt: string };
  readonly completedAt?: string | null;
  readonly preparingAt?: string | null;
  readonly readyAt?: string | null;
  readonly placedAt?: string | null;
}): number {
  orderSequence += 1;
  const orderNumber = `RPT-${String(orderSequence).padStart(6, '0')}`;
  const subtotal = options.lines.reduce(
    (acc, line) => acc + Math.floor(line.unitPriceMinor * line.quantity + 0.5),
    0,
  );
  const tax = taxOf(subtotal);
  const total = subtotal + tax;

  const result = ctx.db
    .prepare(
      `INSERT INTO orders (business_id, location_id, order_number, type, status, customer_id,
                           chair_id, channel, subtotal_minor, discount_minor, tax_minor,
                           service_fee_minor, total_minor, paid_minor, balance_minor,
                           placed_at, preparing_at, ready_at, completed_at, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      options.locationId ?? null,
      orderNumber,
      options.type ?? 'TAKEAWAY',
      options.status ?? 'COMPLETED',
      options.customerId,
      options.chairId ?? null,
      options.channel ?? 'POS',
      subtotal,
      tax,
      total,
      options.payment?.amountMinor ?? 0,
      (options.payment?.amountMinor ?? 0) - total,
      options.placedAt ?? options.createdAt,
      options.preparingAt ?? null,
      options.readyAt ?? null,
      // CHECK `ck_orders_completed_at`: un pedido `COMPLETED` SIEMPRE tiene
      // `completed_at`. Por eso el valor por defecto se deriva de `createdAt` y
      // no de `now`: así el test no depende del reloj.
      options.completedAt === undefined
        ? (options.status ?? 'COMPLETED') === 'COMPLETED'
          ? options.createdAt
          : null
        : options.completedAt,
      options.createdAt,
      options.createdAt,
    );
  const orderId = Number(result.lastInsertRowid);

  for (const line of options.lines) {
    const lineSubtotal = Math.floor(line.unitPriceMinor * line.quantity + 0.5);
    const lineTax = taxOf(lineSubtotal);
    ctx.db
      .prepare(
        `INSERT INTO order_items (order_id, product_id, name_snapshot, sku_snapshot, unit_price_minor,
                                  quantity, discount_minor, tax_minor, line_total_minor, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'PENDING', ?, ?)`,
      )
      .run(orderId, line.productId, line.name, null, line.unitPriceMinor, line.quantity, lineTax, lineSubtotal + lineTax, options.createdAt, options.createdAt);
  }

  if (options.payment !== undefined) {
    const payment = options.payment;
    ctx.db
      .prepare(
        `INSERT INTO payments (business_id, order_id, payment_number, method, status, amount_minor,
                               refunded_minor, currency_code, customer_id, approved_at, created_at, updated_at)
         VALUES (1, ?, ?, ?, 'APPROVED', ?, 0, 'COP', ?, ?, ?, ?)`,
      )
      .run(
        orderId,
        `PAY-RPT-${String(orderSequence).padStart(6, '0')}`,
        payment.method,
        payment.amountMinor,
        options.customerId,
        payment.approvedAt,
        options.createdAt,
        options.createdAt,
      );
  }
  return orderId;
}

/** Inserta un alquiler cerrado con sus importes ya calculados. */
function insertRental(options: {
  readonly chairId: number;
  readonly startAt: string;
  readonly endAt: string;
  readonly plannedMinutes: number;
  readonly billedMinutes: number;
  readonly subtotalMinor: number;
  readonly extraMinor: number;
  readonly customerId?: number | null;
  readonly status?: string;
}): number {
  rentalSequence += 1;
  const total = options.subtotalMinor + options.extraMinor;
  const result = ctx.db
    .prepare(
      `INSERT INTO chair_rentals (business_id, chair_id, customer_id, code, status, start_at, end_at,
                                  planned_minutes, billed_minutes, price_per_hour_minor, subtotal_minor,
                                  extensions_minor, extra_minutes_minor, total_minor, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .run(
      options.chairId,
      options.customerId ?? null,
      `RENT-RPT-${String(rentalSequence).padStart(6, '0')}`,
      options.status ?? 'COMPLETED',
      options.startAt,
      options.endAt,
      options.plannedMinutes,
      options.billedMinutes,
      CHAIR_PRICE_PER_HOUR,
      options.subtotalMinor,
      options.extraMinor,
      total,
      options.startAt,
      options.startAt,
    );
  return Number(result.lastInsertRowid);
}

/**
 * Inserta una reserva de silla para un cliente.
 *
 * Las reservas NO son alquileres: son la intención de reservar. Se siembran
 * aparte porque el reporte de clientes distingue "compró" de "reservó silla",
 * y `chair-occupancy` cuenta la reserva como tiempo reservado aunque nunca se
 * haya convertido en sesión.
 */
function insertReservation(options: {
  readonly chairId: number;
  readonly zoneId: number;
  readonly locationId: number;
  readonly customerId: number;
  readonly startAt: string;
  readonly endAt: string;
  readonly durationMinutes: number;
  readonly status?: string;
}): number {
  reservationSequence += 1;
  const result = ctx.db
    .prepare(
      `INSERT INTO chair_reservations (business_id, location_id, zone_id, chair_id, customer_id, code,
                                        status, start_at, end_at, duration_minutes, price_per_hour_minor,
                                        rental_total_minor, source, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CUSTOMER', ?, ?)`,
    )
    .run(
      options.locationId,
      options.zoneId,
      options.chairId,
      options.customerId,
      `RES-RPT-${String(reservationSequence).padStart(6, '0')}`,
      options.status ?? 'CONFIRMED',
      options.startAt,
      options.endAt,
      options.durationMinutes,
      CHAIR_PRICE_PER_HOUR,
      (CHAIR_PRICE_PER_HOUR * options.durationMinutes) / 60,
      options.startAt,
      options.startAt,
    );
  return Number(result.lastInsertRowid);
}

/** Registra un cliente y devuelve su id. */
async function registerCustomer(prefix: string): Promise<{ id: number; token: string }> {
  const email = ctx.uniqueEmail(prefix);
  const response = await ctx
    .post('/api/v1/auth/register', { email, password: VALID_TEST_PASSWORD, fullName: `Cliente ${prefix}` })
    .expect(201);
  return { id: Number(response.body.data.user.id), token: String(response.body.data.accessToken) };
}

beforeAll(async () => {
  ctx = await createTestContext();
  agent = request.agent(buildTestApp()).set('User-Agent', 'LatteCoffeReportsTests/1.0');
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');
  managerToken = await ctx.accessTokenFor('MANAGER');

  // Catálogo -----------------------------------------------------------
  const category = await post('/api/v1/categories', { name: 'Bebidas RPT' }, adminToken).expect(201);
  categoryId = Number(category.body.data.id);

  const createProduct = async (name: string, sku: string, priceMinor: number): Promise<number> => {
    const response = await post(
      '/api/v1/products',
      { name, sku, categoryId, basePriceMinor: priceMinor, isAvailable: true, isActive: true },
      adminToken,
    ).expect(201);
    return Number(response.body.data.id);
  };
  latteId = await createProduct('Latte RPT', 'RPT-LATTE', PRICE_LATTE);
  formulaId = await createProduct(FORMULA_NAME, 'RPT-FORMULA', PRICE_FORMULA);
  croissantId = await createProduct('Croissant RPT', 'RPT-CROISSANT', PRICE_CROISSANT);

  // Inventario ---------------------------------------------------------
  ctx.db
    .prepare(
      `INSERT INTO inventory_items (business_id, product_id, name, sku, unit, current_stock, min_stock,
                                    max_stock, cost_minor, supplier, location_storage, is_tracked, created_at, updated_at)
       VALUES (1, ?, 'Latte RPT', 'RPT-LATTE', 'UND', 10, 5, 100, ?, 'LatteCo', 'Bodega', 1, ?, ?)`,
    )
    .run(latteId, COST_LATTE, NOW.toISOString(), NOW.toISOString());
  ctx.db
    .prepare(
      `INSERT INTO inventory_items (business_id, product_id, name, sku, unit, current_stock, min_stock,
                                    max_stock, cost_minor, supplier, location_storage, is_tracked, created_at, updated_at)
       VALUES (1, ?, 'Croissant RPT', 'RPT-CROISSANT', 'UND', 3, 5, 100, ?, 'Panadería', 'Bodega', 1, ?, ?)`,
    )
    .run(croissantId, COST_CROISSANT, NOW.toISOString(), NOW.toISOString());

  // Clientes -----------------------------------------------------------
  customerOne = (await registerCustomer('rpt-uno')).id;
  customerTwo = (await registerCustomer('rpt-dos')).id;
  customerThree = (await registerCustomer('rpt-tres')).id;
  const customerLogin = await registerCustomer('rpt-login');
  customerToken = customerLogin.token;

  // Espacios -----------------------------------------------------------
  seedSpacesDemo();
  // `chairs` no tiene `location_id`: la sede vive en la zona, y por eso el filtro
  // por sede de los reportes de ocupación se hace por `zones.location_id`.
  const chairs = ctx.db
    .prepare(
      `SELECT c.id AS id, c.zone_id AS zone_id, z.location_id AS location_id
         FROM chairs c
         JOIN zones z     ON z.id = c.zone_id
         JOIN locations l ON l.id = z.location_id
        WHERE l.business_id = ?
        ORDER BY c.id ASC`,
    )
    .all(AUTH.DEFAULT_BUSINESS_ID) as { id: number; zone_id: number; location_id: number }[];
  rentalChairOne = chairs[0]?.id ?? 0;
  rentalChairTwo = chairs[1]?.id ?? 0;
  const firstChair = chairs[0];
  if (firstChair !== undefined) {
    // Reserva CONFIRMADA de HOY para el cliente con dos compras: es lo que hace
    // que `GET /customers` lo marque con `hasChairReservation`.
    insertReservation({
      chairId: firstChair.id,
      zoneId: firstChair.zone_id,
      locationId: firstChair.location_id,
      customerId: customerOne,
      startAt: wall(0, 22, 0),
      endAt: wall(0, 23, 0),
      durationMinutes: 60,
    });
  }

  // ---------------------------------------------------------------------
  // VENTAS DE HOY, en las tres franjas que luego se comprueban por hora.
  // ---------------------------------------------------------------------
  // 02:00 hora de Bogotá -> 07:00 UTC del MISMO día.
  insertOrder({
    customerId: customerOne,
    createdAt: wall(0, 2, 0),
    payment: { method: 'CASH', amountMinor: totalOf(2 * PRICE_LATTE + PRICE_CROISSANT), approvedAt: wall(0, 2, 1) },
    lines: [
      { productId: latteId, name: 'Latte RPT', unitPriceMinor: PRICE_LATTE, quantity: 2 },
      { productId: croissantId, name: 'Croissant RPT', unitPriceMinor: PRICE_CROISSANT, quantity: 1 },
    ],
  });

  // *** LA VENTA DE LA MEDIANOCHE ***
  // 21:30 hora de Bogotá -> 02:30 UTC del día SIGUIENTE. Un reporte agrupado
  // en UTC la pondría mañana; el reporte correcto la pone HOY.
  insertOrder({
    customerId: customerTwo,
    createdAt: wall(0, 21, 30),
    payment: { method: 'CARD', amountMinor: totalOf(PRICE_LATTE + PRICE_FORMULA), approvedAt: wall(0, 21, 31) },
    lines: [
      { productId: latteId, name: 'Latte RPT', unitPriceMinor: PRICE_LATTE, quantity: 1 },
      { productId: formulaId, name: FORMULA_NAME, unitPriceMinor: PRICE_FORMULA, quantity: 1 },
    ],
  });

  insertOrder({
    customerId: customerOne,
    createdAt: wall(0, 9, 0),
    payment: { method: 'CASH', amountMinor: totalOf(3 * PRICE_CROISSANT), approvedAt: wall(0, 9, 1) },
    lines: [{ productId: croissantId, name: 'Croissant RPT', unitPriceMinor: PRICE_CROISSANT, quantity: 3 }],
  });

  // ---------------------------------------------------------------------
  // VENTAS DE AYER: 21:30 de Bogotá de ayer -> 02:30 UTC de HOY. Un reporte
  // agrupado en UTC la contaría HOY; el correcto la cuenta AYER.
  // ---------------------------------------------------------------------
  insertOrder({
    customerId: customerThree,
    createdAt: wall(-1, 21, 30),
    payment: { method: 'CASH', amountMinor: totalOf(PRICE_LATTE), approvedAt: wall(-1, 21, 31) },
    lines: [{ productId: latteId, name: 'Latte RPT', unitPriceMinor: PRICE_LATTE, quantity: 1 }],
  });
  insertOrder({
    customerId: customerThree,
    createdAt: wall(-1, 12, 0),
    payment: { method: 'CARD', amountMinor: totalOf(2 * PRICE_LATTE + 2 * PRICE_CROISSANT), approvedAt: wall(-1, 12, 1) },
    lines: [
      { productId: latteId, name: 'Latte RPT', unitPriceMinor: PRICE_LATTE, quantity: 2 },
      { productId: croissantId, name: 'Croissant RPT', unitPriceMinor: PRICE_CROISSANT, quantity: 2 },
    ],
  });

  // ---------------------------------------------------------------------
  // ALQUILERES DE HOY
  // ---------------------------------------------------------------------
  // 90 min exactos, sin overage.
  insertRental({
    chairId: rentalChairOne,
    startAt: wall(0, 18, 0),
    endAt: wall(0, 19, 30),
    plannedMinutes: 90,
    billedMinutes: 90,
    subtotalMinor: (CHAIR_PRICE_PER_HOUR * 90) / 60,
    extraMinor: 0,
    customerId: customerOne,
  });
  // 60 min de plan, 90 facturados: 30 min de overage (BR-RENTAL-004).
  insertRental({
    chairId: rentalChairOne,
    startAt: wall(0, 20, 0),
    endAt: wall(0, 21, 0),
    plannedMinutes: 60,
    billedMinutes: 90,
    subtotalMinor: CHAIR_PRICE_PER_HOUR,
    extraMinor: (CHAIR_PRICE_PER_HOUR * 30) / 60,
    customerId: customerTwo,
  });
  // 5 min reales: se factura el mínimo de 30 (BR-RENTAL-001).
  insertRental({
    chairId: rentalChairTwo,
    startAt: wall(0, 10, 0),
    endAt: wall(0, 10, 5),
    plannedMinutes: 5,
    billedMinutes: 30,
    subtotalMinor: (CHAIR_PRICE_PER_HOUR * 30) / 60,
    extraMinor: 0,
    customerId: customerThree,
  });
});

afterAll(() => {
  ctx.close();
});

/** Fila de `/inventory` tal y como la devuelve la API. */
interface InventoryItemBody {
  readonly name: string;
  readonly valueMinor: number;
  readonly isLowStock: boolean;
  readonly noMovementInRange: boolean;
  readonly rotationBp: number;
}

/** Indexa `byItem` por nombre, para leer un ítem concreto sincasts. */
function inventoryByName(response: { readonly body: unknown }): Map<string, InventoryItemBody> {
  const body = response.body as { data: { byItem: InventoryItemBody[] } };
  return new Map(body.data.byItem.map((row) => [row.name, row]));
}

/** Totales esperados de HOY, calculados a mano para que el test sea legible. */
const TODAY_ORDERS = 3;
const TODAY_GROSS = totalOf(2 * PRICE_LATTE + PRICE_CROISSANT) + totalOf(PRICE_LATTE + PRICE_FORMULA) + totalOf(3 * PRICE_CROISSANT);
const TODAY_ITEMS = 8;

/** Totales esperados de AYER. */
const YESTERDAY_ORDERS = 2;
const YESTERDAY_GROSS = totalOf(PRICE_LATTE) + totalOf(2 * PRICE_LATTE + 2 * PRICE_CROISSANT);

// ===========================================================================
// Zona horaria
// ===========================================================================

describe('Zona horaria del negocio: el corte de día es local, no UTC', () => {
  it('el día local de Bogotá empieza a las 05:00:00Z (UTC-5)', () => {
    // Este es el hecho sobre el que se apoya todo lo demás: si el negocio
    // estuviera en UTC, `today` empezaría a medianoche UTC.
    expect(TODAY_START.toISOString()).toMatch(/T05:00:00\.000Z$/);
  });

  it('un pedido de las 21:30 de Bogotá cae en HOY aunque en UTC sea mañana', async () => {
    // La aserción clave: la venta de las 21:30 de HOY en Bogotá está en el día
    // UTC SIGUIENTE, y la de las 12:00 de HOY sigue en el día UTC de hoy.
    expect(localDateKey(new Date(wall(0, 21, 30)), 'UTC')).not.toBe(
      localDateKey(new Date(wall(0, 12, 0)), 'UTC'),
    );
    expect(localDateKey(new Date(wall(0, 21, 30)), TZ)).toBe(TODAY_KEY);

    const response = await get('/api/v1/reports/sales?preset=today', adminToken).expect(200);
    const meta = response.body.meta;
    expect(meta.range.localFrom).toBe(TODAY_KEY);
    expect(meta.range.localTo).toBe(TODAY_KEY);
    expect(meta.range.timezone).toBe(TZ);
    // El rango consultado en UTC es exactamente el día local, en formato semiabierto.
    expect(meta.range.from).toBe(TODAY_START.toISOString());
    expect(meta.range.boundary).toBe('FROM_INCLUSIVE_TO_EXCLUSIVE');
    expect(meta.totals.orders).toBe(TODAY_ORDERS);
  });

  it('un pedido de las 21:30 de AYER en Bogotá NO entra en hoy, aunque en UTC sea hoy', async () => {
    const response = await get('/api/v1/reports/sales?preset=today', adminToken).expect(200);
    const todayGross = response.body.meta.totals.netMinor as number;
    const yesterday = await get('/api/v1/reports/sales?preset=yesterday', adminToken).expect(200);

    // Las ventas de ayer están en su preset y NO se suman a las de hoy.
    expect(yesterday.body.meta.totals.orders).toBe(YESTERDAY_ORDERS);
    expect(yesterday.body.meta.totals.netMinor).toBe(YESTERDAY_GROSS);
    expect(todayGross).toBe(TODAY_GROSS);
    expect(todayGross).not.toBe(YESTERDAY_GROSS);
  });

  it('`yesterday` es el día local anterior en UTC, no las 24 h anteriores', async () => {
    const response = await get('/api/v1/reports/sales?preset=yesterday', adminToken).expect(200);
    const range = response.body.meta.range;
    const yesterdayStart = new Date(new Date(midnight(-1)));
    expect(range.from).toBe(yesterdayStart.toISOString());
    expect(range.to).toBe(TODAY_START.toISOString());
  });

  it('`last7` cubre 7 días locales inclusivos y termina en hoy', async () => {
    const response = await get('/api/v1/reports/sales?preset=last7', adminToken).expect(200);
    const range = response.body.meta.range;
    const expectedFrom = new Date(midnight(-6));
    expect(range.from).toBe(expectedFrom.toISOString());
    expect(range.localFrom).toBe(shiftKey(TODAY_KEY, -6));
    expect(range.localTo).toBe(TODAY_KEY);
    expect(range.minutes).toBe(7 * 24 * 60);
  });

  it('`thisMonth` empieza el día 1 del mes local', async () => {
    const response = await get('/api/v1/reports/sales?preset=thisMonth', adminToken).expect(200);
    const range = response.body.meta.range;
    expect(range.from).toBe(midnightOfMonthStart());
    expect(range.localFrom).toBe(`${TODAY_KEY.slice(0, 7)}-01`);
  });

  it('`lastMonth` es el mes local anterior completo, sin solaparse con `thisMonth`', async () => {
    const last = await get('/api/v1/reports/sales?preset=lastMonth', adminToken).expect(200);
    const thisM = await get('/api/v1/reports/sales?preset=thisMonth', adminToken).expect(200);
    // `lastMonth` termina exactamente donde empieza `thisMonth`.
    expect(last.body.meta.range.to).toBe(thisM.body.meta.range.from);
    expect(last.body.meta.range.localFrom.slice(8)).toBe('01');
  });
});

// ===========================================================================
// Validación del rango
// ===========================================================================

describe('Validación del rango temporal', () => {
  // 400 y no 422: es una combinación mal formada de parámetros, no una regla de
  // negocio. Los MISMOS `details.code` salen como 400 desde `spaces`, `inventory`
  // y `reservations`, así que un cliente puede ramificar por el código sin
  // tener que saber de qué módulo viene la petición.
  it('`from > to` devuelve 400 INVALID_DATE_RANGE', async () => {
    const response = await get(
      '/api/v1/reports/sales?preset=custom&from=2027-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
      adminToken,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('INVALID_DATE_RANGE');
  });

  it('un rango de más de 366 días devuelve 400 RANGE_TOO_LARGE', async () => {
    const response = await get(
      '/api/v1/reports/sales?preset=custom&from=2024-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
      adminToken,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('RANGE_TOO_LARGE');
  });

  it('un rango de exactamente 366 días se acepta', async () => {
    await get(
      '/api/v1/reports/sales?preset=custom&from=2025-01-01T00:00:00.000Z&to=2026-01-02T00:00:00.000Z',
      adminToken,
    ).expect(200);
  });

  it('un preset inválido devuelve 400 VALIDATION_ERROR', async () => {
    const response = await get('/api/v1/reports/sales?preset=lastYear', adminToken).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('un parámetro desconocido devuelve 400 (`.strict()`)', async () => {
    const response = await get('/api/v1/reports/sales?inventado=1', adminToken).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
  });

  it('una zona horaria IANA inválida devuelve 400', async () => {
    const response = await get('/api/v1/reports/sales?preset=today&timezone=Marte/Olympus', adminToken).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// Sales
// ===========================================================================

describe('GET /api/v1/reports/sales', () => {
  it('devuelve los totales del día en centavos enteros', async () => {
    const response = await get('/api/v1/reports/sales?preset=today', adminToken).expect(200);
    const totals = response.body.meta.totals;
    expect(totals.orders).toBe(TODAY_ORDERS);
    expect(totals.netMinor).toBe(TODAY_GROSS);
    expect(totals.items).toBe(TODAY_ITEMS);
    expect(totals.averageTicketMinor).toBe(Math.floor(TODAY_GROSS / TODAY_ORDERS + 0.5));
    // Un importe es SIEMPRE entero: si alguna vez sale decimal, hay un `float`.
    expect(Number.isInteger(totals.averageTicketMinor)).toBe(true);
  });

  it('agrupa por día y desglosa el importe por método de pago y por tipo', async () => {
    const response = await get('/api/v1/reports/sales?preset=today', adminToken).expect(200);
    expect(response.body.data).toHaveLength(1);
    const row = response.body.data[0];
    expect(row.period).toBe(TODAY_KEY);
    expect(row.orders).toBe(TODAY_ORDERS);
    expect(row.byMethod.CASH).toBe(totalOf(2 * PRICE_LATTE + PRICE_CROISSANT) + totalOf(3 * PRICE_CROISSANT));
    expect(row.byMethod.CARD).toBe(totalOf(PRICE_LATTE + PRICE_FORMULA));
    expect(row.byType.TAKEAWAY).toBe(TODAY_GROSS);
    expect(row.byType.CHAIR_RENTAL).toBe(0);
  });

  it('compara con el periodo anterior y la variación sale correcta en basis points', async () => {
    const response = await get('/api/v1/reports/sales?preset=today', adminToken).expect(200);
    const comparison = response.body.meta.totals.comparison;
    expect(comparison.orders).toBe(YESTERDAY_ORDERS);
    expect(comparison.grossSalesMinor).toBe(YESTERDAY_GROSS);
    expect(comparison.ordersChangeBp).toBe(
      Math.floor(((TODAY_ORDERS - YESTERDAY_ORDERS) * 10_000) / YESTERDAY_ORDERS + 0.5),
    );
    expect(comparison.grossSalesChangeBp).toBe(
      Math.floor(((TODAY_GROSS - YESTERDAY_GROSS) * 10_000) / YESTERDAY_GROSS + 0.5),
    );
    // Un porcentaje, no un float.
    expect(Number.isInteger(comparison.grossSalesChangeBp)).toBe(true);
  });

  it('`groupBy=month` agrupa por mes local, no por mes UTC', async () => {
    const response = await get('/api/v1/reports/sales?preset=last30&groupBy=month', adminToken).expect(200);
    for (const row of response.body.data) {
      expect(row.period).toMatch(/^\d{4}-\d{2}$/);
    }
  });
});

// ===========================================================================
// Series
// ===========================================================================

describe('GET /api/v1/reports/sales-by-hour', () => {
  it('devuelve 24 puntos, siempre, incluso con cero ventas', async () => {
    const response = await get('/api/v1/reports/sales-by-hour?preset=last7', adminToken).expect(200);
    expect(response.body.data).toHaveLength(24);
    expect(response.body.data.map((point: { hour: number }) => point.hour)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
  });

  it('coloca cada venta en su HORA de Bogotá, no en la de UTC', async () => {
    const response = await get('/api/v1/reports/sales-by-hour?preset=today', adminToken).expect(200);
    const byHour = new Map(
      response.body.data.map((point: { hour: number; orders: number }) => [point.hour, point.orders]),
    );
    // Ventas sembradas a las 02:00, 09:00 y 21:30 hora de Bogotá.
    expect(byHour.get(2)).toBe(1);
    expect(byHour.get(9)).toBe(1);
    expect(byHour.get(21)).toBe(1);
    // La venta de las 21:30 está a las 02:30 UTC: si se agrupara en UTC caería
    // en la hora 2 y la hora 21 saldría a cero.
    expect(byHour.get(0)).toBe(0);
  });

  it('declara las horas de pico en `meta.peakHours`', async () => {
    const response = await get('/api/v1/reports/sales-by-hour?preset=today', adminToken).expect(200);
    expect(Array.isArray(response.body.meta.peakHours)).toBe(true);
  });
});

describe('GET /api/v1/reports/sales-by-day', () => {
  it('no deja huecos: un día sin ventas aparece con ceros', async () => {
    const response = await get('/api/v1/reports/sales-by-day?preset=last7', adminToken).expect(200);
    expect(response.body.data).toHaveLength(7);
    for (const point of response.body.data) {
      expect(point.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof point.orders).toBe('number');
    }
    // El último punto es HOY en hora local.
    expect(response.body.data[response.body.data.length - 1].date).toBe(TODAY_KEY);
  });

  it('incluye el desglose por día de la semana con 0 = domingo', async () => {
    const response = await get('/api/v1/reports/sales-by-day?preset=last7', adminToken).expect(200);
    expect(response.body.meta.byWeekday).toHaveLength(7);
    expect(response.body.meta.byWeekday.map((entry: { weekday: number }) => entry.weekday)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);
  });
});

// ===========================================================================
// Dashboard
// ===========================================================================

describe('GET /api/v1/reports/dashboard', () => {
  it('devuelve todos los KPIs con los valores exactos del día', async () => {
    const response = await get('/api/v1/reports/dashboard?preset=today', adminToken).expect(200);
    const kpis = response.body.data.kpis;

    expect(kpis.totalOrders).toBe(TODAY_ORDERS);
    expect(kpis.totalItems).toBe(TODAY_ITEMS);
    expect(kpis.grossSalesMinor).toBe(TODAY_GROSS);
    expect(kpis.netSalesMinor).toBe(TODAY_GROSS);
    expect(kpis.averageTicketMinor).toBe(Math.floor(TODAY_GROSS / TODAY_ORDERS + 0.5));
    expect(kpis.totalTaxMinor).toBe(
      taxOf(2 * PRICE_LATTE + PRICE_CROISSANT) + taxOf(PRICE_LATTE + PRICE_FORMULA) + taxOf(3 * PRICE_CROISSANT),
    );
    expect(kpis.totalServiceFeeMinor).toBe(0);
    expect(kpis.totalDiscountMinor).toBe(0);
    expect(kpis.refundedMinor).toBe(0);
    expect(kpis.ordersCancelled).toBe(0);
    expect(kpis.totalTipsMinor).toBe(0);
    // 2 clientes con compras hoy (el tercero compró ayer).
    expect(kpis.customers).toBe(2);
    expect(Number.isInteger(kpis.chairOccupancyRateBp)).toBe(true);
  });

  it('incluye el estado de las sillas del negocio', async () => {
    const response = await get('/api/v1/reports/dashboard?preset=today', adminToken).expect(200);
    const spaces = response.body.data.currentSpaces;
    expect(spaces.total).toBeGreaterThan(0);
    // Los seis estados de `chairs.status` están siempre presentes, aunque valgan 0.
    for (const key of ['available', 'occupied', 'reserved', 'blocked', 'maintenance', 'cleaning']) {
      expect(typeof spaces[key]).toBe('number');
    }
    expect(spaces.totalCapacity).toBeGreaterThanOrEqual(spaces.total);
  });

  it('devuelve la serie diaria de 7 días que termina en hoy', async () => {
    const response = await get('/api/v1/reports/dashboard?preset=today', adminToken).expect(200);
    const series = response.body.data.series;
    expect(series).toHaveLength(7);
    expect(series[series.length - 1].date).toBe(TODAY_KEY);
    // El último punto es el día de hoy, con las ventas de hoy.
    expect(series[series.length - 1].orders).toBe(TODAY_ORDERS);
  });

  it('`includeSeries=false` omite la serie pero conserva los KPIs', async () => {
    const response = await get(
      '/api/v1/reports/dashboard?preset=today&includeSeries=false',
      adminToken,
    ).expect(200);
    expect(response.body.data.series).toEqual([]);
    expect(response.body.data.kpis.totalOrders).toBe(TODAY_ORDERS);
  });

  it('trae el desglose por canal, por tipo y los productos más vendidos', async () => {
    const response = await get('/api/v1/reports/dashboard?preset=today', adminToken).expect(200);
    expect(response.body.data.salesByChannel.length).toBeGreaterThan(0);
    expect(response.body.data.salesByChannel[0].shareBp).toBe(10_000);
    expect(response.body.data.salesByType[0].key).toBe('TAKEAWAY');
    expect(response.body.data.topProducts.length).toBeGreaterThan(0);
  });

  it('compara contra el día anterior, que es el periodo previo de un día', async () => {
    const response = await get('/api/v1/reports/dashboard?preset=today', adminToken).expect(200);
    const comparison = response.body.data.comparison;
    expect(comparison.orders).toBe(YESTERDAY_ORDERS);
    expect(comparison.grossSalesMinor).toBe(YESTERDAY_GROSS);
    expect(comparison.grossSalesChangeBp).toBe(
      Math.floor(((TODAY_GROSS - YESTERDAY_GROSS) * 10_000) / YESTERDAY_GROSS + 0.5),
    );
  });

  it('cuenta las alertas de stock bajo del inventario', async () => {
    const response = await get('/api/v1/reports/dashboard?preset=today', adminToken).expect(200);
    // El croissant tiene 3 unidades con mínimo 5: está en alerta.
    expect(response.body.data.kpis.inventoryAlertsCount).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Productos
// ===========================================================================

describe('GET /api/v1/reports/top-products', () => {
  it('ordena por unidades descendente y el primer producto es el esperado', async () => {
    const response = await get('/api/v1/reports/top-products?preset=today', adminToken).expect(200);
    const first = response.body.data[0];
    // Croissant: 1 (pedido de las 02:00) + 3 (pedido de las 09:00) = 4.
    expect(first.name).toBe('Croissant RPT');
    expect(first.quantity).toBe(4);
    expect(first.rank).toBe(1);
    expect(response.body.data[1].name).toBe('Latte RPT');
    expect(response.body.data[1].quantity).toBe(3);
  });

  it('`orderBy=revenue` reordena por ingresos', async () => {
    const response = await get(
      '/api/v1/reports/top-products?preset=today&orderBy=revenue',
      adminToken,
    ).expect(200);
    // Por ingresos gana el latte (3 unidades a 1 200 000) por delante del
    // producto de fórmula (1 unidad a 2 000 000): el total CON impuesto pesa
    // más que el precio de catálogo.
    expect(response.body.data[0].name).toBe('Latte RPT');
    expect(response.body.data[0].quantity).toBe(3);
  });

  it('devuelve el margen cuando el producto tiene coste cargado', async () => {
    const response = await get('/api/v1/reports/top-products?preset=today', adminToken).expect(200);
    const croissant = response.body.data.find(
      (row: { name: string }) => row.name === 'Croissant RPT',
    );
    // Margen = ingreso REAL de las 4 líneas (precio + impuesto) − coste de las
    // 4 unidades. El ingreso incluye impuesto porque es el `line_total_minor`.
    const croissantLineTotal = PRICE_CROISSANT + taxOf(PRICE_CROISSANT);
    expect(croissant.marginMinor).toBe(4 * croissantLineTotal - 4 * COST_CROISSANT);
    const formula = response.body.data.find((row: { name: string }) => row.name === FORMULA_NAME);
    // Sin inventario asociado, el margen es `null`: falta el dato, no es un cero.
    expect(formula.marginMinor).toBeNull();
  });

  it('es paginable', async () => {
    const all = await get('/api/v1/reports/top-products?preset=today&pageSize=1', adminToken).expect(200);
    expect(all.body.data).toHaveLength(1);
    const second = await get(
      '/api/v1/reports/top-products?preset=today&pageSize=1&page=2',
      adminToken,
    ).expect(200);
    expect(second.body.data[0].name).not.toBe(all.body.data[0].name);
  });

  it('`limit` fuera de rango devuelve 400', async () => {
    const response = await get('/api/v1/reports/top-products?limit=500', adminToken).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/reports/product-revenue', () => {
  it('agrupa por producto con su cuota en basis points', async () => {
    const response = await get(
      '/api/v1/reports/product-revenue?preset=today&groupBy=product',
      adminToken,
    ).expect(200);
    expect(response.body.data.length).toBeGreaterThan(0);
    const totalBp = response.body.data.reduce(
      (acc: number, row: { shareBp: number }) => acc + row.shareBp,
      0,
    );
    // Las cuotas suman 10 000 bp (100 %); el redondeo entero puede dejar ±1.
    expect(Math.abs(totalBp - 10_000)).toBeLessThanOrEqual(2);
  });

  it('`groupBy=category` agrega por categoría', async () => {
    const response = await get(
      '/api/v1/reports/product-revenue?preset=today&groupBy=category',
      adminToken,
    ).expect(200);
    expect(response.body.data[0].key).toMatch(/^category:/);
  });
});

// ===========================================================================
// Sillas y alquileres
// ===========================================================================

describe('GET /api/v1/reports/chair-occupancy', () => {
  it('sólo cuenta las sillas con ocupación real dentro del rango', async () => {
    const response = await get('/api/v1/reports/chair-occupancy?preset=today', adminToken).expect(200);
    const byChair = response.body.data.byChair;
    // Hay 10 sillas en la semilla y sólo 2 con sesiones: las otras 8 no salen.
    expect(response.body.data.summary.totalChairs).toBeGreaterThan(byChair.length);
    for (const row of byChair) {
      expect(row.sessions).toBeGreaterThan(0);
      expect(row.occupiedMinutes).toBeGreaterThan(0);
    }
  });

  it('suma los minutos ocupados de las sesiones del día', async () => {
    const response = await get('/api/v1/reports/chair-occupancy?preset=today', adminToken).expect(200);
    // 90 min + 90 min en la silla 1, y 5 min reales en la silla 2.
    expect(response.body.data.summary.occupiedMinutes).toBe(185);
    expect(response.body.data.summary.totalSessions).toBe(3);
    expect(response.body.data.summary.overageMinutes).toBe(30);
    expect(response.body.data.summary.overageRevenueMinor).toBe((CHAIR_PRICE_PER_HOUR * 30) / 60);
  });

  it('la ocupación va en basis points enteros', async () => {
    const response = await get('/api/v1/reports/chair-occupancy?preset=today', adminToken).expect(200);
    const summary = response.body.data.summary;
    expect(Number.isInteger(summary.utilizationBp)).toBe(true);
    expect(summary.availableMinutes).toBe(
      summary.totalChairs * response.body.meta.range.minutes,
    );
  });

  it('los alquileres de ayer no cuentan como ocupación de hoy', async () => {
    // Los tres alquileres de la siembra son de HOY; el reporte de AYER no debe
    // ver ninguna sesión porque todos empiezan después de su medianoche local.
    const yesterday = await get('/api/v1/reports/chair-occupancy?preset=yesterday', adminToken).expect(200);
    expect(yesterday.body.data.summary.totalSessions).toBe(0);
    expect(yesterday.body.data.summary.occupiedMinutes).toBe(0);
  });
});

describe('GET /api/v1/reports/rental-revenue', () => {
  it('suma minutos facturados y minutos extra con exactitud', async () => {
    const response = await get('/api/v1/reports/rental-revenue?preset=today', adminToken).expect(200);
    const summary = response.body.data.summary;
    expect(summary.sessions).toBe(3);
    // Facturados: 90 + 90 + 30 (el mínimo de BR-RENTAL-001).
    expect(summary.billedMinutes).toBe(210);
    // Extra: sólo la segunda sesión se pasó 30 min del plan.
    expect(summary.overtimeMinutes).toBe(30);
    // Minutos reales de sesión: 90 + 90 + 5.
    expect(summary.totalMinutes).toBe(185);
  });

  it('aplica el mínimo de 30 minutos a la sesión de 5 minutos', async () => {
    const response = await get('/api/v1/reports/rental-revenue?preset=today', adminToken).expect(200);
    expect(response.body.data.summary.minimumAppliedCount).toBe(1);
  });

  it('suma los ingresos en enteros de centavos', async () => {
    const response = await get('/api/v1/reports/rental-revenue?preset=today', adminToken).expect(200);
    const summary = response.body.data.summary;
    expect(summary.subtotalMinor).toBe(
      (CHAIR_PRICE_PER_HOUR * 90) / 60 + CHAIR_PRICE_PER_HOUR + (CHAIR_PRICE_PER_HOUR * 30) / 60,
    );
    expect(summary.overtimeMinor).toBe((CHAIR_PRICE_PER_HOUR * 30) / 60);
    expect(Number.isInteger(summary.totalMinor)).toBe(true);
    // BR-RENTAL-006: subtotal + extensiones + overage.
    expect(summary.totalMinor).toBe(summary.subtotalMinor + summary.extensionsMinor + summary.overtimeMinor);
  });

  it('declara las reglas de alquiler que el reporte refleja', async () => {
    const response = await get('/api/v1/reports/rental-revenue?preset=today', adminToken).expect(200);
    expect(response.body.meta.appliedRules ?? response.body.data.summary.appliedRules).toBeDefined();
    expect(response.body.data.summary.appliedRules).toContain('BR-RENTAL-001');
  });

  it('desglosa por silla y por zona', async () => {
    const response = await get('/api/v1/reports/rental-revenue?preset=today', adminToken).expect(200);
    expect(response.body.data.byChair.length).toBe(2);
    expect(response.body.data.byZone.length).toBe(1);
  });
});

// ===========================================================================
// Clientes
// ===========================================================================

describe('GET /api/v1/reports/customers', () => {
  it('ordena por gasto total y da el ticket medio en centavos', async () => {
    const response = await get('/api/v1/reports/customers?preset=today', adminToken).expect(200);
    expect(response.body.data[0].customerId).toBe(customerOne);
    const expected = totalOf(2 * PRICE_LATTE + PRICE_CROISSANT) + totalOf(3 * PRICE_CROISSANT);
    expect(response.body.data[0].totalSpentMinor).toBe(expected);
    expect(response.body.data[0].averageTicketMinor).toBe(Math.floor(expected / 2 + 0.5));
    expect(response.body.data[0].orders).toBe(2);
  });

  it('segmenta a los clientes por número de compras', async () => {
    const response = await get('/api/v1/reports/customers?preset=today', adminToken).expect(200);
    const byId = new Map(
      response.body.data.map((row: { customerId: number; segment: string }) => [row.customerId, row.segment]),
    );
    expect(byId.get(customerOne)).toBe('returning');
    expect(byId.get(customerTwo)).toBe('new');
  });

  it('marca quién tiene reserva de silla', async () => {
    const response = await get('/api/v1/reports/customers?preset=today', adminToken).expect(200);
    const byId = new Map(
      response.body.data.map((row: { customerId: number; hasChairReservation: boolean }) => [
        row.customerId,
        row.hasChairReservation,
      ]),
    );
    expect(byId.get(customerOne)).toBe(true);
  });

  it('devuelve los totales de clientes con la tasa de recurrencia en basis points', async () => {
    const response = await get('/api/v1/reports/customers?preset=today', adminToken).expect(200);
    const totals = response.body.meta.totals;
    expect(totals.customers).toBe(2);
    expect(Number.isInteger(totals.repeatRateBp)).toBe(true);
  });
});

// ===========================================================================
// Inventario
// ===========================================================================

describe('GET /api/v1/reports/inventory', () => {
  it('valoriza el inventario a coste con enteros de centavos', async () => {
    const response = await get('/api/v1/reports/inventory?preset=last30', adminToken).expect(200);
    const byName = inventoryByName(response);
    // 10 unidades × 500 000 = 5 000 000.
    expect(byName.get('Latte RPT')?.valueMinor).toBe(10 * COST_LATTE);
    // 3 unidades × 300 000 = 900 000.
    expect(byName.get('Croissant RPT')?.valueMinor).toBe(3 * COST_CROISSANT);
    expect(response.body.data.summary.totalValueMinor).toBe(10 * COST_LATTE + 3 * COST_CROISSANT);
  });

  it('detecta el stock bajo y el coste medio', async () => {
    const response = await get('/api/v1/reports/inventory?preset=last30', adminToken).expect(200);
    const byName = inventoryByName(response);
    expect(byName.get('Croissant RPT')?.isLowStock).toBe(true);
    expect(byName.get('Latte RPT')?.isLowStock).toBe(false);
    expect(response.body.data.summary.lowStockCount).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(response.body.data.summary.averageCostMinor)).toBe(true);
  });

  it('informa de los ítems sin movimiento en el rango y de su rotación', async () => {
    const response = await get('/api/v1/reports/inventory?preset=last30', adminToken).expect(200);
    for (const row of response.body.data.byItem) {
      expect(typeof row.noMovementInRange).toBe('boolean');
      expect(Number.isInteger(row.rotationBp)).toBe(true);
    }
    expect(response.body.data.summary.rangeDays).toBe(30);
  });

  it('agrega por proveedor y por ubicación', async () => {
    const response = await get('/api/v1/reports/inventory?preset=last30', adminToken).expect(200);
    expect(response.body.data.bySupplier.length).toBeGreaterThan(0);
    expect(response.body.data.byStorage.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// Resumen de pedidos
// ===========================================================================

describe('GET /api/v1/reports/orders-summary', () => {
  it('cuenta por día y por estado, con los importes del día', async () => {
    const response = await get('/api/v1/reports/orders-summary?preset=today', adminToken).expect(200);
    expect(response.body.data).toHaveLength(1);
    const row = response.body.data[0];
    expect(row.group).toBe(TODAY_KEY);
    expect(row.orders).toBe(TODAY_ORDERS);
    expect(row.completed).toBe(TODAY_ORDERS);
    expect(row.cancelled).toBe(0);
    expect(row.totalMinor).toBe(TODAY_GROSS);
  });

  it('`groupBy=status` reparte por estado', async () => {
    const response = await get(
      '/api/v1/reports/orders-summary?preset=last7&groupBy=status',
      adminToken,
    ).expect(200);
    expect(response.body.data[0].group).toBe('COMPLETED');
  });

  it('`groupBy=hour` usa la hora local del negocio', async () => {
    const response = await get(
      '/api/v1/reports/orders-summary?preset=today&groupBy=hour',
      adminToken,
    ).expect(200);
    const groups = response.body.data.map((row: { group: string }) => Number(row.group));
    expect(groups).toContain(21);
  });

  it('devuelve los totales con la tasa de cancelación en basis points', async () => {
    const response = await get('/api/v1/reports/orders-summary?preset=today', adminToken).expect(200);
    const totals = response.body.meta.totals;
    expect(totals.orders).toBe(TODAY_ORDERS);
    expect(totals.completed).toBe(TODAY_ORDERS);
    expect(totals.cancelRateBp).toBe(0);
  });
});

// ===========================================================================
// Exportación CSV
// ===========================================================================

describe('POST /api/v1/reports/export', () => {
  it('devuelve CSV con cabecera, BOM y `Content-Disposition`', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { report: 'sales', preset: 'today' },
      adminToken,
    ).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.headers['content-disposition']).toMatch(/filename="[^"]+\.csv"/);
    // BOM UTF-8: sin él Excel en Windows rompe los acentos.
    expect(response.text.charCodeAt(0)).toBe(0xfeff);
    // Cabecera + 3 ventas + fila de totales.
    const lines = response.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines.length).toBe(5);
    expect(lines[0]).toContain('Numero pedido');
    expect(lines[0]).toContain('Total (cents)');
    // Separador `;` (convención es_CO), no coma.
    expect(lines[0]).toContain(';');
  });

  it('ESCAPA la inyección de fórmulas: un nombre con `=` no es ejecutable', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { report: 'top-products', preset: 'today' },
      adminToken,
    ).expect(200);
    // El nombre del producto aparece en el CSV y lleva un apóstrofo delante,
    // que es el carácter de escape estándar de Excel: se muestra y NO se evalúa.
    expect(response.text).toContain(`'${FORMULA_NAME}`);
    // Ninguna celda puede empezar por `=`, `+`, `-` o `@` sin escapar: el
    // separador es `;`, así que se comprueba justo después de cada separador.
    for (const line of response.text.replace(/^﻿/, '').split('\r\n')) {
      for (const cell of line.split(';')) {
        expect(cell).not.toMatch(/^[=+@-]/);
      }
    }
  });

  it('la fila de totales suma los importes en enteros', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { report: 'sales', preset: 'today' },
      adminToken,
    ).expect(200);
    const lines = response.text.replace(/^﻿/, '').trim().split('\r\n');
    const header = lines[0]?.split(';') ?? [];
    const totalIndex = header.indexOf('Total (cents)');
    const totalsRow = (lines[lines.length - 1] ?? '').split(';');
    expect(Number(totalsRow[totalIndex])).toBe(TODAY_GROSS);
  });

  it('`includeTotalsRow=false` omite la fila de totales', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { report: 'sales', preset: 'today', includeTotalsRow: false },
      adminToken,
    ).expect(200);
    const lines = response.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(4);
  });

  it('acepta un subconjunto de columnas', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { report: 'sales', preset: 'today', columns: ['order_number', 'total_minor'] },
      adminToken,
    ).expect(200);
    const lines = response.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Numero pedido;Total (cents)');
  });

  it('una columna inexistente devuelve 400 INVALID_COLUMNS', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { report: 'sales', preset: 'today', columns: ['columna_que_no_existe'] },
      adminToken,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('INVALID_COLUMNS');
  });

  it('un reporte inexistente devuelve 400 INVALID_REPORT', async () => {
    const response = await post(
      '/api/v1/reports/export',
      { report: 'inventario_fantasma' },
      adminToken,
    ).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('escribe en `audit_logs` con action = EXPORT y entity_type = export', async () => {
    const before = ctx.db
      .prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'EXPORT'")
      .get() as { total: number };
    await post('/api/v1/reports/export', { report: 'sales', preset: 'today' }, adminToken).expect(200);
    const after = ctx.db
      .prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action = 'EXPORT'")
      .get() as { total: number };
    expect(after.total).toBe(before.total + 1);

    const row = ctx.db
      .prepare(
        "SELECT user_id, entity_type, entity_id, after_data FROM audit_logs WHERE action = 'EXPORT' ORDER BY id DESC LIMIT 1",
      )
      .get() as { user_id: number; entity_type: string; after_data: string } | undefined;
    expect(row).toBeDefined();
    expect(row?.entity_type).toBe('export');
    // Guarda QUÉ se exportó, no el contenido del fichero.
    const payload = JSON.parse(row?.after_data ?? '{}') as { report?: string; rows?: number };
    expect(payload.report).toBe('sales');
    expect(typeof payload.rows).toBe('number');
  });
});

// ===========================================================================
// RBAC
// ===========================================================================

describe('RBAC: los reportes son datos de negocio', () => {
  const endpoints = [
    '/api/v1/reports/dashboard',
    '/api/v1/reports/sales',
    '/api/v1/reports/sales-by-hour',
    '/api/v1/reports/sales-by-day',
    '/api/v1/reports/top-products',
    '/api/v1/reports/product-revenue',
    '/api/v1/reports/chair-occupancy',
    '/api/v1/reports/rental-revenue',
    '/api/v1/reports/customers',
    '/api/v1/reports/inventory',
    '/api/v1/reports/orders-summary',
  ];

  it('un CUSTOMER recibe 403 en todos los reportes', async () => {
    for (const path of endpoints) {
      const response = await get(path, customerToken).expect(403);
      expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
      expect(response.body.error.details.required).toBe('reports:read');
    }
  });

  it('un CUSTOMER recibe 403 también en la exportación', async () => {
    const response = await post('/api/v1/reports/export', { report: 'sales' }, customerToken).expect(403);
    expect(response.body.error.details.required).toBe('reports:export');
  });

  it('un CASHIER recibe 403 en los reportes financieros', async () => {
    for (const path of ['/api/v1/reports/sales', '/api/v1/reports/inventory', '/api/v1/reports/customers']) {
      const response = await get(path, cashierToken).expect(403);
      expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
      // La matriz de RBAC le concede `reports:read`, así que el 403 lo produce
      // el gate de ROL, no el de permiso: por eso el código es otro.
      expect(response.body.error.details.code).toBe('INSUFFICIENT_ROLE');
      expect(response.body.error.details.required).toEqual(['MANAGER', 'ADMIN', 'OWNER']);
    }
  });

  it('un MANAGER y un ADMIN leen, pero sólo ADMIN y OWNER exportan', async () => {
    await get('/api/v1/reports/sales', managerToken).expect(200);
    await get('/api/v1/reports/sales', adminToken).expect(200);
    // `reports:export` es ADMIN/OWNER en la matriz de RBAC.
    await post('/api/v1/reports/export', { report: 'sales' }, managerToken).expect(403);
    await post('/api/v1/reports/export', { report: 'sales' }, adminToken).expect(200);
  });

  it('sin token responde 401, no 403', async () => {
    const response = await get('/api/v1/reports/sales').expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_ERROR');
  });
});

// ===========================================================================
// Coherencia entre endpoints
// ===========================================================================

describe('Coherencia entre reportes', () => {
  it('el total de `sales` y el KPI de `dashboard` coinciden para hoy', async () => {
    const sales = await get('/api/v1/reports/sales?preset=today', adminToken).expect(200);
    const dashboard = await get('/api/v1/reports/dashboard?preset=today', adminToken).expect(200);
    expect(dashboard.body.data.kpis.grossSalesMinor).toBe(sales.body.meta.totals.netMinor);
    expect(dashboard.body.data.kpis.totalOrders).toBe(sales.body.meta.totals.orders);
  });

  it('la suma de la serie diaria de `last7` cuadra con los totales de `last7`', async () => {
    const byDay = await get('/api/v1/reports/sales-by-day?preset=last7', adminToken).expect(200);
    const sales = await get('/api/v1/reports/sales?preset=last7', adminToken).expect(200);
    const sumOrders = byDay.body.data.reduce(
      (acc: number, point: { orders: number }) => acc + point.orders,
      0,
    );
    const sumTotal = byDay.body.data.reduce(
      (acc: number, point: { totalMinor: number }) => acc + point.totalMinor,
      0,
    );
    expect(sumOrders).toBe(sales.body.meta.totals.orders);
    expect(sumTotal).toBe(sales.body.meta.totals.netMinor);
  });

  it('los minutos de alquiler por hora cuadran con el resumen de alquileres', async () => {
    const byHour = await get(
      '/api/v1/reports/sales-by-hour?preset=today',
      adminToken,
    ).expect(200);
    const rentals = await get('/api/v1/reports/rental-revenue?preset=today', adminToken).expect(200);
    const minutes = byHour.body.data.reduce(
      (acc: number, point: { rentalMinutes: number }) => acc + point.rentalMinutes,
      0,
    );
    // Por hora se cuenta el mínimo de 30 de cada sesión; el resumen también.
    expect(minutes).toBe(rentals.body.data.summary.billedMinutes);
  });

  it('el ranking de productos por ingresos cuadra con el total de ingresos por producto', async () => {
    const top = await get(
      '/api/v1/reports/top-products?preset=today&pageSize=100',
      adminToken,
    ).expect(200);
    const revenue = await get(
      '/api/v1/reports/product-revenue?preset=today&pageSize=100',
      adminToken,
    ).expect(200);
    const topTotal = top.body.data.reduce(
      (acc: number, row: { totalMinor: number }) => acc + row.totalMinor,
      0,
    );
    const revenueTotal = revenue.body.data.reduce(
      (acc: number, row: { totalMinor: number }) => acc + row.totalMinor,
      0,
    );
    expect(topTotal).toBe(revenueTotal);
  });
});
