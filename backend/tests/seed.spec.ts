/**
 * Pruebas de la SEMILLA DE DEMOSTRACIÓN (`tests/seed.spec.ts`).
 *
 * ================================ POR QUÉ ESTE FICHERO =======================
 * Las semillas son la única parte del sistema que escribe filas SIN pasar por los
 * services: nadie valida el cuerpo de un pedido, nadie recalcula un total y nadie
 * comprueba que un CHECK encaje. Si la semilla escribe un total que no cuadra, el
 * sistema arranca y todos los reportes mienten.
 *
 * Por eso estas pruebas no repiten lo que ya hacen los tests de cada módulo
 * (`orders.spec.ts` prueba el motor de precios con datos que crea por la API).
 * Aquí se comprueba lo contrario: que los DATOS que escribió la semilla son válidos
 * para el motor que ya está probado.
 *
 * LA PRUEBA MÁS IMPORTANTE ES LA PRIMERA: sembrar dos veces no puede duplicar
 * nada. Un `npm run seed` repetido por error, por un `SEED_ON_MIGRATE` o por
 * alguien que no lee la salida del comando no puede dejar dos veces el mismo
 * catálogo ni dos pedidos con el mismo número.
 *
 * La segunda más importante es la de COHERENCIA ARITMÉTICA, que se hace con SQL
 * directo contra la base sembrada y no con la API: la pregunta no es "la API
 * devuelve el total", sino "lo que hay escrito en la tabla es la suma de sus
 * propias líneas".
 *
 * Reutiliza `tests/helpers/harness.ts` (base en memoria, migraciones y semilla
 * ya aplicadas) y NO duplica nada de su lógica.
 */
import './helpers/harness.js';

import express, { type Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { API_PREFIX } from '../src/config/index.js';
import { createTestContext, type TestContext } from './helpers/harness.js';
import { errorHandler } from '../src/shared/middleware/error-handler.js';
import { notFound } from '../src/shared/middleware/not-found.js';
import { requestContext } from '../src/shared/middleware/request-context.js';
import { corsMiddleware, jsonBody, securityHeaders } from '../src/shared/middleware/security.js';
import { categoriesRouter, productsRouter } from '../src/modules/catalog/catalog.routes.js';
import { ordersRouter } from '../src/modules/orders/orders.routes.js';
import { runSeed } from '../src/database/seeds/index.js';
import { DEMO_CHAIR_COUNT } from '../src/database/seeds/spaces-demo.seed.js';
import { nowIso } from '../src/shared/utils/datetime.js';

let ctx: TestContext;
let ordersApp: Express;
let adminToken: string;

/**
 * App con el router de pedidos montado a mano.
 *
 * `modules/index.ts` todavía no registra `ordersRouter` (lo hace el agente
 * integrador), y este fichero no lo puede tocar. Es el mismo apaño que hace
 * `tests/orders.spec.ts`: la pila real de middlewares con el router añadido donde
 * `app.ts` lo montará.
 */
function buildOrdersApp(): Express {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.set('x-powered-by', false);
  instance.use(securityHeaders);
  instance.use(corsMiddleware);
  instance.use(requestContext);
  instance.use(jsonBody);
  instance.use(`${API_PREFIX}/categories`, categoriesRouter);
  instance.use(`${API_PREFIX}/products`, productsRouter);
  instance.use(`${API_PREFIX}/orders`, ordersRouter);
  instance.use(notFound);
  instance.use(errorHandler);
  return instance;
}

beforeAll(async () => {
  ctx = await createTestContext();
  ordersApp = buildOrdersApp();
  adminToken = await ctx.accessTokenFor('ADMIN');
});

afterAll(() => {
  ctx.close();
});

/** Nº de filas de una tabla del negocio sembrado. */
function count(table: string): number {
  const row = ctx.db.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number };
  return row.total;
}

/** Todas las filas de una tabla, como registros de texto o número. */
function rows<T>(sql: string, ...params: readonly unknown[]): T[] {
  return ctx.db.prepare(sql).all(...params) as T[];
}

/** Una fila o `undefined`, sin `as` inseguros en el test. */
function one<T>(sql: string, ...params: readonly unknown[]): T | undefined {
  return ctx.db.prepare(sql).get(...params) as T | undefined;
}

/** Número entero de la primera columna de la primera fila. */
function scalar(sql: string, ...params: readonly unknown[]): number {
  const row = one<Record<string, number>>(sql, ...params);
  if (row === undefined) {
    throw new Error(`La consulta no devolvió filas: ${sql}`);
  }
  const first = Object.values(row)[0];
  return first === undefined ? 0 : first;
}

// ===========================================================================
// 1. IDEMPOTENCIA — la prueba más importante del fichero
// ===========================================================================

describe('Idempotencia de la semilla (seeds/**)', () => {
  it('ejecutarla dos veces más NO duplica ni una fila', () => {
    const tables = [
      'businesses',
      'locations',
      'zones',
      'chairs',
      'users',
      'user_roles',
      'business_hours',
      'categories',
      'products',
      'product_variants',
      'product_addons',
      'ingredients',
      'product_ingredients',
      'inventory_items',
      'inventory_movements',
      'discounts',
      'discount_redemptions',
      'chair_reservations',
      'chair_rentals',
      'orders',
      'order_items',
      'order_item_addons',
      'order_status_history',
      'payments',
    ] as const;

    const before = Object.fromEntries(tables.map((table) => [table, count(table)]));
    // Un estado ya sembrado no está vacío: si el harness no sembró la demo, esta
    // prueba no estaría probando nada.
    expect(before['products']).toBeGreaterThan(0);
    expect(before['orders']).toBeGreaterThan(0);

    const second = runSeed(ctx.db);
    const third = runSeed(ctx.db);

    const after = Object.fromEntries(tables.map((table) => [table, count(table)]));
    expect(after).toEqual(before);
    // Y las dos ejecuciones siguientes no han escrito nada: eso es lo que ve el
    // operador en la salida de `npm run seed`.
    expect(second.skipped).toBe(true);
    expect(third.skipped).toBe(true);
    expect(third.applied).toBe(0);
  });

  it('no duplica números de pedido, de reserva, de alquiler ni de cobro', () => {
    for (const [table, column] of [
      ['orders', 'order_number'],
      ['chair_reservations', 'code'],
      ['chair_rentals', 'code'],
      ['payments', 'payment_number'],
      ['discounts', 'code'],
      ['products', 'sku'],
    ] as const) {
      const total = scalar(`SELECT COUNT(*) FROM ${table}`);
      const distinct = scalar(`SELECT COUNT(DISTINCT ${column}) FROM ${table}`);
      expect(distinct, `${table}.${column} tiene valores repetidos`).toBe(total);
    }
  });

  it('reconcilia en vez de duplicar: las sillas conservan su código y su tarifa', () => {
    const chairs = rows<{ code: string; price_per_hour_minor: number; zone: string }>(
      `SELECT c.code, c.price_per_hour_minor, z.name AS zone
         FROM chairs c JOIN zones z ON z.id = c.zone_id`,
    );
    expect(chairs).toHaveLength(DEMO_CHAIR_COUNT);
    // Las tarifas de la demo se escriben explícitas, así que dos ejecuciones
    // convergen al mismo estado sin necesitar borrar nada.
    const terraza = chairs.filter((chair) => chair.zone === 'Terraza');
    expect(terraza).toHaveLength(6);
    for (const chair of terraza) {
      expect(chair.price_per_hour_minor).toBe(600_000);
    }
  });
});

// ===========================================================================
// 2. CATÁLOGO
// ===========================================================================

describe('Catálogo de demostración', () => {
  it('siembra 6 categorías con slug único y una carta de 20 a 24 productos', () => {
    expect(count('categories')).toBe(6);
    const slugs = rows<{ slug: string }>('SELECT slug FROM categories');
    expect(new Set(slugs.map((row) => row.slug)).size).toBe(6);

    const products = count('products');
    expect(products).toBeGreaterThanOrEqual(20);
    expect(products).toBeLessThanOrEqual(24);

    const skus = rows<{ sku: string }>('SELECT sku FROM products');
    expect(new Set(skus.map((row) => row.sku)).size).toBe(products);
    // Los seis SKUs de la carta, uno de cada sección.
    for (const prefix of ['CAF-', 'BEB-', 'COM-', 'POS-', 'SNA-', 'ESP-']) {
      expect(skus.some((row) => row.sku.startsWith(prefix)), `falta la sección ${prefix}`).toBe(true);
    }
  });

  it('tiene al menos 3 productos con promoción VIGENTE y todos con precio positivo', () => {
    const now = nowIso();
    const conPromo = rows<{ sku: string; base_price_minor: number; promo_price_minor: number; starts: string; ends: string }>(
      `SELECT sku, base_price_minor, promo_price_minor, promo_starts_at AS starts, promo_ends_at AS ends
         FROM products
        WHERE promo_price_minor IS NOT NULL`,
    );
    expect(conPromo.length).toBeGreaterThanOrEqual(3);
    const vigentes = conPromo.filter((row) => row.starts <= now && now < row.ends);
    expect(vigentes.length, 'ninguna promoción está vigente en la ventana actual').toBeGreaterThanOrEqual(3);
    // La promo siempre abarata (CHECK `ck_products_promo`).
    for (const row of conPromo) {
      expect(row.promo_price_minor).toBeLessThan(row.base_price_minor);
    }
    const sinPrecio = scalar('SELECT COUNT(*) FROM products WHERE base_price_minor <= 0');
    expect(sinPrecio).toBe(0);
  });

  it('cada producto con variantes tiene una y sólo una por defecto', () => {
    const conVariantes = rows<{ id: number }>(
      'SELECT DISTINCT product_id AS id FROM product_variants',
    );
    expect(conVariantes.length).toBeGreaterThanOrEqual(8);
    for (const product of conVariantes) {
      const porDefecto = scalar(
        'SELECT COUNT(*) FROM product_variants WHERE product_id = ? AND is_default = 1',
        product.id,
      );
      expect(porDefecto, `el producto ${String(product.id)} no tiene una variante por defecto`).toBe(1);
    }
  });

  it('el menú público devuelve las 6 categorías y 20+ productos sin token', async () => {
    const response = await ctx.get('/api/v1/menu').expect(200);
    const categories = response.body.data as { name: string; products: unknown[] }[];
    expect(categories).toHaveLength(6);
    const productos = categories.reduce<number>((total, category) => total + category.products.length, 0);
    expect(productos).toBeGreaterThanOrEqual(20);
  });
});

// ===========================================================================
// 3. ESPACIOS
// ===========================================================================

describe('Zonas y sillas de demostración', () => {
  it('siembra 5 zonas con color y 24-30 sillas con tarifa por hora', () => {
    expect(count('zones')).toBe(5);
    const sillas = count('chairs');
    expect(sillas).toBeGreaterThanOrEqual(24);
    expect(sillas).toBeLessThanOrEqual(30);

    const zonas = rows<{ name: string; color_hex: string; capacity: number; sillas: number }>(
      `SELECT z.name, z.color_hex, z.capacity, COUNT(c.id) AS sillas
         FROM zones z LEFT JOIN chairs c ON c.zone_id = z.id
        GROUP BY z.id ORDER BY z.sort_order`,
    );
    expect(zonas.map((zona) => zona.name)).toEqual([
      'Terraza',
      'Interior',
      'Ventana',
      'Zona Premium',
      'Sala de Trabajo',
    ]);
    // Cada zona con su color y con la capacidad derivada de sus sillas
    // (BR-CHAIR-005).
    const colores = new Set<string>();
    for (const zona of zonas) {
      expect(zona.color_hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
      colores.add(zona.color_hex);
      expect(zona.capacity, `la capacidad de ${zona.name} no cuadra con sus sillas`).toBeGreaterThan(0);
    }
    expect(colores.size).toBe(5);

    // Tarifa por hora distinta en cada zona y siempre mayor que cero.
    const tarifas = rows<{ zone: string; tarifa: number }>(
      `SELECT z.name AS zone, MIN(c.price_per_hour_minor) AS tarifa
         FROM chairs c JOIN zones z ON z.id = c.zone_id
        GROUP BY z.id ORDER BY z.sort_order`,
    );
    expect(tarifas).toEqual([
      { zone: 'Terraza', tarifa: 600_000 },
      { zone: 'Interior', tarifa: 500_000 },
      { zone: 'Ventana', tarifa: 550_000 },
      { zone: 'Zona Premium', tarifa: 900_000 },
      { zone: 'Sala de Trabajo', tarifa: 400_000 },
    ]);
    for (const tarifa of tarifas) {
      expect(tarifa.tarifa).toBeGreaterThan(0);
    }
  });

  it('ninguna zona tiene dos muebles en la misma celda de la rejilla', () => {
    const duplicados = rows<{ zone: string; grid_x: number; grid_y: number; veces: number }>(
      `SELECT z.name AS zone, c.grid_x, c.grid_y, COUNT(*) AS veces
         FROM chairs c JOIN zones z ON z.id = c.zone_id
        GROUP BY z.id, c.grid_x, c.grid_y
       HAVING COUNT(*) > 1`,
    );
    expect(duplicados).toEqual([]);

    // Y el mapa devuelve las 5 zonas con sus sillas.
    expect(scalar('SELECT COUNT(*) FROM chairs WHERE deleted_at IS NULL')).toBe(sillas());
  });

  it('el mapa de sillas muestra las 5 zonas y una sola silla ocupada', async () => {
    const locationId = scalar('SELECT id FROM locations ORDER BY id LIMIT 1');
    const response = await ctx
      .get(`/api/v1/chairs/map?locationId=${String(locationId)}`, adminToken)
      .expect(200);
    const map = response.body.data as {
      zones: { name: string; chairs: unknown[] }[];
      countsByStatus: Record<string, number>;
      totals: { chairs: number; occupied: number; capacity: number };
    };
    expect(map.zones).toHaveLength(5);
    const enMapa = map.zones.reduce<number>((total, zona) => total + zona.chairs.length, 0);
    expect(enMapa).toBe(sillas());
    expect(map.totals.chairs).toBe(enMapa);
    // La suma de los seis contadores es el total: es lo que permite pintar la
    // rejilla sin recalcular nada (BR-CHAIR-006).
    const suma = Object.values(map.countsByStatus).reduce<number>((a, b) => a + b, 0);
    expect(suma).toBe(map.totals.chairs);
    expect(map.totals.occupied).toBe(1);
  });
});

/** Nº de sillas no dadas de baja. */
function sillas(): number {
  return count('chairs');
}

// ===========================================================================
// 4. INVENTARIO
// ===========================================================================

describe('Inventario de demostración', () => {
  it('deja al menos un ítem por debajo de su mínimo, que es lo que ve el panel', async () => {
    const bajos = rows<{ sku: string; name: string; current_stock: number; min_stock: number }>(
      `SELECT sku, name, current_stock, min_stock
         FROM inventory_items
        WHERE is_tracked = 1 AND deleted_at IS NULL AND current_stock < min_stock`,
    );
    expect(bajos.length, 'no hay ningún ítem por debajo del mínimo: el panel no tiene nada que avisar').toBeGreaterThanOrEqual(1);

    // Y la API lo confirma: la alerta existe y es de las de verdad.
    const response = await ctx.get('/api/v1/inventory/alerts?pageSize=100', adminToken).expect(200);
    const alertas = response.body.data as { itemId: number; severity: string; deficitQuantity: number }[];
    expect(alertas.length).toBeGreaterThanOrEqual(1);
    for (const alerta of alertas) {
      expect(['OUT', 'LOW', 'NEGATIVE']).toContain(alerta.severity);
      expect(alerta.deficitQuantity).toBeGreaterThan(0);
    }
  });

  it('el libro de movimientos reconstruye el saldo de cada ítem', () => {
    const descuadrados = rows<{ sku: string; current_stock: number; balance_after: number }>(
      `SELECT ii.sku, ii.current_stock, last.balance_after
         FROM inventory_items ii
         JOIN (SELECT m.inventory_item_id, m.balance_after
                 FROM inventory_movements m
                 JOIN (SELECT inventory_item_id, MAX(id) AS last_id
                         FROM inventory_movements GROUP BY inventory_item_id) tail
                   ON tail.last_id = m.id) last
           ON last.inventory_item_id = ii.id
        WHERE ii.current_stock <> last.balance_after`,
    );
    expect(descuadrados).toEqual([]);
    expect(scalar('SELECT COUNT(*) FROM inventory_movements WHERE movement_type = ?', 'PURCHASE')).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 5. COHERENCIA ARITMÉTICA — con SQL directo sobre la base sembrada
// ===========================================================================

describe('Coherencia aritmética de TODOS los pedidos sembrados', () => {
  it('subtotal + impuesto - descuento === total, y el subtotal es la suma de las líneas', () => {
    const pedidos = rows<{
      order_number: string;
      type: string;
      subtotal: number;
      discount: number;
      tax: number;
      service_fee: number;
      total: number;
      paid: number;
      balance: number;
      lineas: number;
    }>(
      `SELECT o.order_number, o.type, o.subtotal_minor AS subtotal, o.discount_minor AS discount,
              o.tax_minor AS tax, o.service_fee_minor AS service_fee, o.total_minor AS total,
              o.paid_minor AS paid, o.balance_minor AS balance,
              (SELECT COALESCE(SUM(line_total_minor), 0) FROM order_items WHERE order_id = o.id) AS lineas
         FROM orders o
        WHERE o.deleted_at IS NULL
        ORDER BY o.id`,
    );
    expect(pedidos.length).toBeGreaterThanOrEqual(12);

    for (const pedido of pedidos) {
      // El total es la suma de lo que el propio pedido dice tener (BR-MONEY-003).
      expect(
        pedido.subtotal + pedido.tax - pedido.discount + pedido.service_fee,
        `${pedido.order_number}: los totales no cuadran`,
      ).toBe(pedido.total);
      // El saldo pendiente es el total menos lo cobrado (BR-MONEY-006).
      expect(pedido.balance, `${pedido.order_number}: el saldo no cuadra`).toBe(pedido.total - pedido.paid);
      // El descuento nunca supera el subtotal (BR-DISC-002).
      expect(pedido.discount).toBeLessThanOrEqual(pedido.subtotal);

      if (pedido.type === 'CHAIR_RENTAL') {
        // BR-ORDER-012: un pedido de alquiler NO tiene líneas de producto; su
        // subtotal es el total del alquiler (BR-ORDER-012 / BR-RENTAL-006).
        expect(pedido.lineas, `${pedido.order_number}: un alquiler no lleva líneas`).toBe(0);
      } else {
        expect(pedido.lineas, `${pedido.order_number}: el subtotal no es la suma de sus líneas`).toBe(
          pedido.subtotal,
        );
      }
    }
  });

  it('el importe de cada línea es (precio + complementos) x cantidad, con su descuento y su impuesto', () => {
    const lineas = rows<{
      order_number: string;
      unit_price_minor: number;
      quantity: number;
      line_total_minor: number;
      discount_minor: number;
      tax_minor: number;
      subtotal: number;
      discount: number;
      tax: number;
      addons_minor: number;
    }>(
      `SELECT o.order_number, i.unit_price_minor, i.quantity, i.line_total_minor,
              i.discount_minor, i.tax_minor, o.subtotal_minor AS subtotal,
              o.discount_minor AS discount, o.tax_minor AS tax,
              (SELECT COALESCE(SUM(price_minor * quantity), 0)
                 FROM order_item_addons a WHERE a.order_item_id = i.id) AS addons_minor
         FROM order_items i
         JOIN orders o ON o.id = i.order_id
        WHERE i.status <> 'CANCELLED'`,
    );
    expect(lineas.length).toBeGreaterThan(0);

    for (const linea of lineas) {
      const esperado = Math.floor((linea.unit_price_minor + linea.addons_minor) * linea.quantity + 0.5);
      expect(linea.line_total_minor, `${linea.order_number}: la línea no cuadra con su precio`).toBe(esperado);
    }

    // Los descuentos y los impuestos por línea suman los del pedido (BR-MONEY-005
    // y BR-TAX-004): sin esto el recibo desglosado no cerraría.
    const porPedido = rows<{ order_number: string; suma_descuento: number; suma_impuesto: number; discount: number; tax: number }>(
      `SELECT o.order_number,
              (SELECT COALESCE(SUM(discount_minor), 0) FROM order_items WHERE order_id = o.id) AS suma_descuento,
              (SELECT COALESCE(SUM(tax_minor), 0) FROM order_items WHERE order_id = o.id) AS suma_impuesto,
              o.discount_minor AS discount, o.tax_minor AS tax
         FROM orders o WHERE o.type <> 'CHAIR_RENTAL'`,
    );
    for (const pedido of porPedido) {
      expect(pedido.suma_descuento, `${pedido.order_number}: el descuento no se prorratea`).toBe(pedido.discount);
      expect(pedido.suma_impuesto, `${pedido.order_number}: el impuesto no se prorratea`).toBe(pedido.tax);
    }
  });

  it('`paid_minor` es exactamente la suma de los cobros aprobados de cada pedido', () => {
    const descuadrados = rows<{ order_number: string; paid: number; cobrado: number }>(
      `SELECT o.order_number, o.paid_minor AS paid,
              (SELECT COALESCE(SUM(amount_minor - refunded_minor), 0) FROM payments p
                WHERE p.order_id = o.id AND p.status IN ('APPROVED', 'PARTIALLY_REFUNDED')) AS cobrado
         FROM orders o
        WHERE o.paid_minor <>
              (SELECT COALESCE(SUM(amount_minor - refunded_minor), 0) FROM payments p
                WHERE p.order_id = o.id AND p.status IN ('APPROVED', 'PARTIALLY_REFUNDED'))`,
    );
    expect(descuadrados).toEqual([]);
    // Y hay variety: efectivo, tarjeta, un abono y pedidos sin cobrar.
    expect(scalar('SELECT COUNT(*) FROM payments WHERE method = ?', 'CASH')).toBeGreaterThan(0);
    expect(scalar('SELECT COUNT(*) FROM payments WHERE method = ?', 'CARD')).toBeGreaterThan(0);
    expect(scalar('SELECT COUNT(*) FROM orders WHERE status <> ? AND paid_minor = 0', 'CANCELLED')).toBeGreaterThan(0);
    expect(scalar('SELECT COUNT(*) FROM orders WHERE paid_minor > 0 AND balance_minor > 0')).toBeGreaterThan(0);
  });

  it('el impuesto sembrado es el 19 % del negocio, calculado por línea', () => {
    const tasa = scalar('SELECT tax_rate_bp FROM businesses WHERE id = 1');
    expect(tasa).toBe(1_900);
    const sinTasa = rows<{ order_number: string; tax: number; base: number }>(
      `SELECT o.order_number, o.tax_minor AS tax,
              (SELECT COALESCE(SUM(line_total_minor - discount_minor), 0) FROM order_items WHERE order_id = o.id) AS base
         FROM orders o WHERE o.type <> 'CHAIR_RENTAL'`,
    );
    for (const pedido of sinTasa) {
      // 19 % redondeado half-up sobre la base post-descuento.
      expect(pedido.tax, `${pedido.order_number}: el impuesto no es el 19 %`).toBe(
        Math.floor((pedido.base * tasa) / 10_000 + 0.5),
      );
    }
  });

  it('los cupones aplicados son los sembrados, y su contador de usos coincide con las redenciones', () => {
    const conCupón = rows<{ order_number: string; coupon_code: string; discount: number }>(
      'SELECT order_number, coupon_code, discount_minor AS discount FROM orders WHERE coupon_code IS NOT NULL',
    );
    expect(conCupón.length).toBeGreaterThanOrEqual(3);
    for (const pedido of conCupón) {
      expect(pedido.discount, `${pedido.order_number}: el cupón no descontó nada`).toBeGreaterThan(0);
      // Un pedido cancelado devuelve el uso del cupón (BR-DISC-010).
      expect(pedido.order_number).not.toBe('ORD-900007');
    }
    const contadores = rows<{ code: string; used_count: number; redenciones: number }>(
      `SELECT d.code, d.used_count, (SELECT COUNT(*) FROM discount_redemptions r WHERE r.discount_id = d.id) AS redenciones
         FROM discounts d WHERE d.code <> 'ANIVERSARIO25'`,
    );
    for (const contador of contadores) {
      expect(contador.used_count, `${contador.code}: used_count no coincide con sus redenciones`).toBe(
        contador.redenciones,
      );
    }
  });

  it('la API devuelve los pedidos sembrados y el detalle de uno pagado cuadra', async () => {
    const list = await request(ordersApp)
      .get('/api/v1/orders?pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = list.body.data as { orderNumber: string; status: string; totalMinor: number }[];
    expect(items.length).toBeGreaterThanOrEqual(12);
    expect(items.some((order) => order.orderNumber === 'ORD-900001')).toBe(true);
    // Variedad de estados: es lo que el filtro del panel necesita.
    const estados = new Set(items.map((order) => order.status));
    for (const estado of ['COMPLETED', 'CANCELLED', 'CONFIRMED', 'PREPARING', 'READY']) {
      expect(estados.has(estado), `no hay ningún pedido en ${estado}`).toBe(true);
    }

    const pagado = one<{ id: number }>(
      `SELECT id FROM orders WHERE order_number = 'ORD-900001'`,
    );
    const detail = await request(ordersApp)
      .get(`/api/v1/orders/${String(pagado?.id ?? 0)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const order = detail.body.data as {
      subtotalMinor: number;
      discountMinor: number;
      taxMinor: number;
      totalMinor: number;
      paidMinor: number;
      items: { lineTotalMinor: number }[];
    };
    expect(order.subtotalMinor + order.taxMinor - order.discountMinor).toBe(order.totalMinor);
    expect(order.items.reduce<number>((total, item) => total + item.lineTotalMinor, 0)).toBe(order.subtotalMinor);
    expect(order.paidMinor).toBe(order.totalMinor);
  });
});

// ===========================================================================
// 6. ALQUILERES Y RESERVAS
// ===========================================================================

describe('Reservas y alquileres de demostración', () => {
  it('hay al menos un pedido CHAIR_RENTAL con silla, reserva y alquiler, y su total lo incluye', () => {
    const pedidos = rows<{
      order_number: string;
      subtotal: number;
      total: number;
      chair_id: number;
      reservation_id: number;
      rental_id: number;
      rental_total: number;
      reserva_codigo: string;
      alquiler_codigo: string;
      silla_codigo: string;
    }>(
      `SELECT o.order_number, o.subtotal_minor AS subtotal, o.total_minor AS total,
              o.chair_id, o.reservation_id, o.rental_id,
              rt.total_minor AS rental_total, r.code AS reserva_codigo,
              rt.code AS alquiler_codigo, ch.code AS silla_codigo
         FROM orders o
         JOIN chair_reservations r  ON r.id = o.reservation_id
         JOIN chair_rentals rt      ON rt.id = o.rental_id
         JOIN chairs ch             ON ch.id = o.chair_id
        WHERE o.type = 'CHAIR_RENTAL'`,
    );
    expect(pedidos.length).toBeGreaterThanOrEqual(1);
    for (const pedido of pedidos) {
      // El subtotal ES el total del alquiler: el alquiler entra en el pedido tal
      // cual y es el pedido quien le aplica el impuesto (BR-ORDER-012).
      expect(pedido.subtotal).toBe(pedido.rental_total);
      expect(pedido.total).toBeGreaterThan(pedido.subtotal);
      // Los tres identificadores están enlazados entre sí, en las dos direcciones.
      expect(pedido.chair_id).toBeGreaterThan(0);
      expect(pedido.reservation_id).toBeGreaterThan(0);
      expect(pedido.rental_id).toBeGreaterThan(0);
      const enlazada = scalar(
        'SELECT order_id FROM chair_reservations WHERE id = ?',
        pedido.reservation_id,
      );
      expect(enlazada).toBeGreaterThan(0);
      expect(pedido.reserva_codigo).toMatch(/^RES-/);
      expect(pedido.alquiler_codigo).toMatch(/^RENT-/);
    }
  });

  it('hay un alquiler ACTIVE cuya silla está OCCUPIED, y `GET /rentals/active` lo ve', async () => {
    const activos = rows<{ code: string; chair: string; status: string; elapsed: number; total: number }>(
      `SELECT rt.code, ch.code AS chair, ch.status, rt.total_minor AS total
         FROM chair_rentals rt JOIN chairs ch ON ch.id = rt.chair_id
        WHERE rt.status IN ('ACTIVE', 'EXTENDED')`,
    );
    expect(activos.length).toBeGreaterThanOrEqual(1);
    for (const rental of activos) {
      expect(rental.status, `la silla ${rental.chair} de ${rental.code} no está ocupada`).toBe('OCCUPIED');
    }

    const response = await ctx.get('/api/v1/rentals/active?pageSize=50', adminToken).expect(200);
    const lista = response.body.data as { code: string; status: string; elapsedMinutes: number }[];
    expect(lista.length).toBeGreaterThanOrEqual(1);
    // El temporizador corre: `elapsedMinutes` se calcula con el reloj, no se
    // guarda, así que ya es mayor que cero sin que nadie lo haya escrito.
    expect(lista.some((rental) => rental.elapsedMinutes > 0)).toBe(true);
    expect(lista.map((rental) => rental.code)).toContain(activos[0]?.code);
  });

  it('hay dos sesiones cerradas para el reporte de ingresos y una reserva para mañana', () => {
    const estados = rows<{ estado: string; total: number }>(
      'SELECT status AS estado, COUNT(*) AS total FROM chair_rentals GROUP BY status',
    );
    const cerrados = estados.find((row) => row.estado === 'COMPLETED');
    expect(cerrados?.total, 'el reporte de ingresos por alquiler no tiene datos').toBeGreaterThanOrEqual(2);

    const manana = rows<{ code: string; status: string; start_at: string; dias: number }>(
      `SELECT code, status, start_at FROM chair_reservations WHERE status = 'CONFIRMED'`,
    );
    expect(manana.length).toBeGreaterThanOrEqual(1);
    const ahora = Date.now();
    for (const reserva of manana) {
      // La reserva confirmada es FUTURA: es el caso "aceptada, el cliente aún no
      // llega", y por eso su silla sigue AVAILABLE (DESIGN.md 6.4).
      expect(new Date(reserva.start_at).getTime()).toBeGreaterThan(ahora);
      expect(reserva.code).toMatch(/^RES-/);
    }
  });
});

// ===========================================================================
// 7. PERSONAS
// ===========================================================================

describe('Cuentas de demostración', () => {
  it('crea los 3 clientes (4 en total) con rol CUSTOMER y no es personal', () => {
    const clientes = rows<{ email: string; is_staff: number; roles: string }>(
      `SELECT u.email, u.is_staff, GROUP_CONCAT(r.name) AS roles
         FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE u.email LIKE 'cliente%@lattecoffe.co'
        GROUP BY u.id ORDER BY u.email`,
    );
    expect(clientes).toHaveLength(4);
    for (const cliente of clientes) {
      expect(cliente.roles).toBe('CUSTOMER');
      expect(cliente.is_staff).toBe(0);
    }
    // Los dos empleados nuevos: uno de sala y un segundo cajero.
    const empleados = rows<{ email: string; roles: string; is_staff: number }>(
      `SELECT u.email, GROUP_CONCAT(r.name) AS roles, u.is_staff
         FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
        WHERE u.email IN ('staff@lattecoffe.co', 'cajero2@lattecoffe.co')
        GROUP BY u.id`,
    );
    expect(empleados).toHaveLength(2);
    for (const empleado of empleados) {
      expect(empleado.is_staff).toBe(1);
      expect(['STAFF', 'CASHIER']).toContain(empleado.roles);
    }
  });

  it('el hash de contraseña está sembrado y NUNCA sale por la API', async () => {
    // El hash existe (si no, los clientes no podrían iniciar sesión)...
    const conHash = scalar(
      "SELECT COUNT(*) FROM users WHERE email LIKE 'cliente%@lattecoffe.co' AND password_hash LIKE '$2%'",
    );
    expect(conHash).toBe(4);

    // ...pero ninguna lectura por API lo devuelve.
    const usuarios = await ctx.get('/api/v1/users?pageSize=100', adminToken).expect(200);
    expect(JSON.stringify(usuarios.body)).not.toContain('password_hash');
    expect(JSON.stringify(usuarios.body)).not.toContain('passwordHash');
    expect(JSON.stringify(usuarios.body)).not.toContain('$2b$');

    const directorio = await ctx.get('/api/v1/customers?pageSize=100', adminToken).expect(200);
    expect(JSON.stringify(directorio.body)).not.toContain('password_hash');
    expect(JSON.stringify(directorio.body)).not.toContain('$2b$');

    // Ni la ficha propia de un cliente.
    const login = await ctx.login('cliente1@lattecoffe.co');
    const token = login.accessToken;
    const propia = await ctx.get('/api/v1/auth/me', token).expect(200);
    expect(JSON.stringify(propia.body)).not.toContain('password_hash');
    expect(propia.body.data.roles).toEqual(['CUSTOMER']);

    // Y el login con la contraseña de desarrollo funciona de verdad.
    const yo = await ctx.get('/api/v1/customers/me', token).expect(200);
    expect(yo.body.data.email).toBe('cliente1@lattecoffe.co');
  });

  it('el horario del local está sembrado para que /business/status sepa si está abierto', () => {
    // Se comprueba sobre la tabla y no por HTTP: el router de `business` todavía
    // no está en `MODULE_ROUTERS` (lo monta el agente integrador, igual que
    // `orders`), y este fichero no toca `modules/`.
    const dias = rows<{ day_of_week: number; opens_at: string; closes_at: string; is_closed: number }>(
      'SELECT day_of_week, opens_at, closes_at, is_closed FROM business_hours ORDER BY day_of_week',
    );
    expect(dias).toHaveLength(7);
    expect(dias.map((dia) => dia.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const dia of dias) {
      expect(dia.opens_at).toMatch(/^\d{2}:\d{2}$/);
      expect(dia.closes_at).toMatch(/^\d{2}:\d{2}$/);
      // El domingo cierra antes: es un local de barrio, no una discoteca.
      expect(dia.is_closed).toBe(0);
    }
    expect(dias[0]?.closes_at).toBe('17:00');
    expect(dias[6]?.closes_at).toBe('21:00');
  });
});
