/**
 * Pruebas de inventario: ítems, movimientos, `balance_after`, stock negativo y
 * alertas (`tests/inventory.spec.ts`).
 *
 * ============================== POR QUÉ ESTE FICHERO MONTA SU PROPIA APP ====
 * `modules/index.ts` lo cablea el agente integrador y este agente no lo toca, así
 * que el router de inventario todavía NO está en el árbol de la aplicación. Para
 * ejercitar la cadena REAL (mismos middlewares, mismo servicio, misma base en
 * memoria del harness) se reconstruye aquí la pila de Express con la MISMA
 * composición que `app.ts` más el router del módulo. Cuando el integrador lo
 * registre en `MODULE_ROUTERS`, estas pruebas siguen válidas sin cambios.
 *
 * También se montan los routers de CATÁLOGO porque un ítem de inventario se
 * ancla a un producto o a un insumo (BR-INV-008): sin ellos no se puede crear ni
 * siquiera el primer ítem. Es la dependencia real del módulo, no un atajo.
 *
 * Reutiliza `tests/helpers/harness.ts` y no duplica su lógica.
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
import { categoriesRouter, menuRouter, productsRouter } from '../src/modules/catalog/catalog.routes.js';
import { inventoryRouter } from '../src/modules/inventory/inventory.routes.js';

let ctx: TestContext;
let app: Express;
let adminToken: string;
let cashierToken: string;

beforeAll(async () => {
  ctx = await createTestContext();
  app = buildTestApp();
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');
});

afterAll(() => {
  ctx.close();
});

/**
 * Misma pila que `src/app.ts`, con los routers de catálogo e inventario
 * montados en SU prefijo, igual que hace `createApiV1Router()` con
 * `MODULE_ROUTERS`.
 */
function buildTestApp(): Express {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.set('x-powered-by', false);
  instance.use(securityHeaders);
  instance.use(corsMiddleware);
  instance.use(requestContext);
  instance.use(jsonBody);
  instance.use(`${API_PREFIX}/categories`, categoriesRouter);
  instance.use(`${API_PREFIX}/products`, productsRouter);
  instance.use(`${API_PREFIX}/menu`, menuRouter);
  instance.use(`${API_PREFIX}/inventory`, inventoryRouter);
  instance.use(notFound);
  instance.use(errorHandler);
  return instance;
}

/** Petición autenticada contra la app local de inventario. */
function authed(method: 'get' | 'post' | 'patch' | 'delete', url: string, token: string) {
  return request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

/** Crea un insumo de catálogo y devuelve su id (origen válido de un ítem). */
async function createIngredient(name: string, overrides: Record<string, unknown> = {}): Promise<number> {
  const response = await request(app)
    .post('/api/v1/products/ingredients')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, unit: 'G', costMinor: 100, ...overrides })
    .expect(201);
  return Number(response.body.data.id);
}

/** Crea un producto de catálogo y devuelve su id. */
async function createProduct(sku: string): Promise<number> {
  const response = await request(app)
    .post('/api/v1/products')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ sku, name: `Producto ${sku}`, basePriceMinor: 200_000 })
    .expect(201);
  return Number(response.body.data.id);
}

/** Activa o desactiva `businesses.allow_negative_stock` directamente. */
function setAllowNegativeStock(enabled: boolean): void {
  ctx.db
    .prepare('UPDATE businesses SET allow_negative_stock = ? WHERE id = 1')
    .run(enabled ? 1 : 0);
}

/** Alta de un ítem de inventario sobre un producto nuevo. */
async function createTrackedItem(
  sku: string,
  overrides: Record<string, unknown> = {},
): Promise<number> {
  const productId = await createProduct(sku);
  const response = await authed('post', '/api/v1/inventory/items', adminToken)
    .send({ productId, name: `Ítem ${sku}`, unit: 'UND', currentStock: 10, ...overrides })
    .expect(201);
  return Number(response.body.data.id);
}

describe('Alta de ítems de inventario (API.md 7.15)', () => {
  it('crea el ítem y genera un movimiento ADJUSTMENT de apertura, no un update silencioso', async () => {
    const productId = await createProduct('INV-APERTURA');
    const response = await authed('post', '/api/v1/inventory/items', adminToken)
      .send({
        productId,
        name: 'Vasos de cartón',
        sku: 'VASO-12',
        unit: 'UND',
        currentStock: 250,
        costMinor: 1_200,
        supplier: 'Distribuidora Andina',
        locationStorage: 'Bodega 1',
      })
      .expect(201);

    const data = response.body.data;
    expect(data.currentStock).toBe(250);
    // Sin `minStock` explícito se hereda el umbral del negocio.
    expect(data.minStock).toBe(5);
    expect(data.lowStockThreshold).toBe(5);
    expect(data.isLowStock).toBe(false);
    expect(typeof response.body.meta.initialMovementId).toBe('number');

    // El movimiento de apertura existe y su `balance_after` es el saldo inicial.
    const movimientos = await authed(
      'get',
      `/api/v1/inventory/movements?itemId=${data.id}`,
      adminToken,
    ).expect(200);
    expect(movimientos.body.data).toHaveLength(1);
    expect(movimientos.body.data[0].movementType).toBe('ADJUSTMENT');
    expect(movimientos.body.data[0].reason).toBe('INITIAL');
    expect(movimientos.body.data[0].balanceAfter).toBe(250);
  });

  it('exige exactamente un origen: producto o insumo (INVENTORY_SOURCE_REQUIRED)', async () => {
    const ninguno = await authed('post', '/api/v1/inventory/items', adminToken)
      .send({ name: 'Sin origen', unit: 'UND' })
      .expect(422);
    expect(ninguno.body.error.details.code).toBe('INVENTORY_SOURCE_REQUIRED');

    const productId = await createProduct('INV-DOS-ORIGENES');
    const insumoId = await createIngredient('Cacao en polvo');
    const ambos = await authed('post', '/api/v1/inventory/items', adminToken)
      .send({ productId, ingredientId: insumoId, name: 'Ambos', unit: 'UND' })
      .expect(422);
    expect(ambos.body.error.details.code).toBe('INVENTORY_SOURCE_REQUIRED');
  });

  it('rechaza un origen inexistente con 404', async () => {
    const response = await authed('post', '/api/v1/inventory/items', adminToken)
      .send({ productId: 999_999, name: 'Producto fantasma', unit: 'UND' })
      .expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND_ERROR');
  });

  it('rechaza un segundo ítem para el mismo producto con 409 INVENTORY_ITEM_EXISTS', async () => {
    const productId = await createProduct('INV-UNICO');
    await authed('post', '/api/v1/inventory/items', adminToken)
      .send({ productId, name: 'Primero', unit: 'UND' })
      .expect(201);
    const response = await authed('post', '/api/v1/inventory/items', adminToken)
      .send({ productId, name: 'Segundo', unit: 'UND' })
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('INVENTORY_ITEM_EXISTS');
  });
});

describe('Movimientos y saldo (BR-INV-001, BR-INV-010)', () => {
  it('tres movimientos seguidos dejan el saldo y el balance_after coherentes', async () => {
    const itemId = await createTrackedItem('INV-TRES', { currentStock: 0, supplier: 'Café de Origen' });

    const compra = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'PURCHASE', quantity: 20, unitCostMinor: 30_000 })
      .expect(201);
    expect(compra.body.data.item.currentStock).toBe(20);
    expect(compra.body.data.movement.balanceAfter).toBe(20);

    const consumo = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({
        inventoryItemId: itemId,
        movementType: 'WASTE',
        quantity: -3,
        reason: 'Derrame en barra',
      })
      .expect(201);
    expect(consumo.body.data.item.currentStock).toBe(17);
    expect(consumo.body.data.movement.balanceAfter).toBe(17);

    const devolucion = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'RETURN', quantity: -2, reason: 'Devolución a proveedor' })
      .expect(201);
    expect(devolucion.body.data.item.currentStock).toBe(15);
    expect(devolucion.body.data.movement.balanceAfter).toBe(15);

    // El HISTÓRICO es la verdad: los tres saldos encadenan sin saltos.
    const movimientos = await authed(
      'get',
      `/api/v1/inventory/movements?itemId=${itemId}&order=asc&sort=created_at`,
      adminToken,
    ).expect(200);
    expect(movimientos.body.data.map((item: { balanceAfter: number }) => item.balanceAfter)).toEqual([
      20, 17, 15,
    ]);

    // Y el saldo del ítem coincide con el último `balance_after`.
    const detalle = await authed('get', `/api/v1/inventory/items/${itemId}`, adminToken).expect(200);
    expect(detalle.body.data.currentStock).toBe(15);
    expect(detalle.body.data.recentMovements).toHaveLength(3);
    expect(detalle.body.data.stats.totalIn).toBe(20);
    expect(detalle.body.data.stats.totalOut).toBe(5);
    expect(detalle.body.data.stats.averageCostMinor).toBe(30_000);
  });

  it('un WASTE con cantidad POSITIVA es 422: tirar café no repone existencias', async () => {
    const itemId = await createTrackedItem('INV-WASTE', { currentStock: 0 });
    const response = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'WASTE', quantity: 5, reason: 'Error de tipeo' })
      .expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('MOVEMENT_SIGN_INVALID');
    expect(response.body.error.details.expectedSign).toBe('NEGATIVE');

    // El saldo no se movió: el rechazo no dejó nada a medias.
    const detalle = await authed('get', `/api/v1/inventory/items/${itemId}`, adminToken).expect(200);
    expect(detalle.body.data.currentStock).toBe(0);
  });

  it('un PURCHASE con cantidad negativa también es 422', async () => {
    const itemId = await createTrackedItem('INV-PURCHASE-NEG');
    const response = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'PURCHASE', quantity: -5 })
      .expect(422);
    expect(response.body.error.details.code).toBe('MOVEMENT_SIGN_INVALID');
    expect(response.body.error.details.expectedSign).toBe('POSITIVE');
  });

  it('un ADJUSTMENT admite los dos sentidos', async () => {
    const itemId = await createTrackedItem('INV-ADJ-BIEN', { currentStock: 50 });
    const sube = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'ADJUSTMENT', quantity: 5, reason: 'Conteo físico' })
      .expect(201);
    expect(sube.body.data.item.currentStock).toBe(55);

    const baja = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'ADJUSTMENT', quantity: -5, reason: 'Merma' })
      .expect(201);
    expect(baja.body.data.item.currentStock).toBe(50);
  });

  it('exige motivo en WASTE y ADJUSTMENT (REASON_REQUIRED)', async () => {
    const itemId = await createTrackedItem('INV-MOTIVO');
    const response = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'ADJUSTMENT', quantity: 2 })
      .expect(422);
    expect(response.body.error.details.code).toBe('REASON_REQUIRED');
  });

  it('no admite SALE, RESERVATION ni RELEASE a mano (MOVEMENT_TYPE_NOT_MANUAL)', async () => {
    const itemId = await createTrackedItem('INV-MANUAL');
    for (const movementType of ['SALE', 'RESERVATION', 'RELEASE'] as const) {
      const response = await authed('post', '/api/v1/inventory/movements', adminToken)
        .send({ inventoryItemId: itemId, movementType, quantity: -1 })
        .expect(422);
      expect(response.body.error.details.code).toBe('MOVEMENT_TYPE_NOT_MANUAL');
    }
  });

  it('un ítem sin seguimiento no admite movimientos (ITEM_NOT_TRACKED, BR-INV-007)', async () => {
    const productId = await createProduct('INV-NO-TRACK');
    const alta = await authed('post', '/api/v1/inventory/items', adminToken)
      .send({ productId, name: 'Producto no controlado', unit: 'UND', isTracked: false })
      .expect(201);
    expect(alta.body.data.isTracked).toBe(false);

    const response = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: alta.body.data.id, movementType: 'PURCHASE', quantity: 5 })
      .expect(422);
    expect(response.body.error.details.code).toBe('ITEM_NOT_TRACKED');
    expect(response.body.error.details.ruleId).toBe('BR-INV-007');
  });

  it('un movimiento de cantidad cero es 400 (CHECK quantity != 0)', async () => {
    const itemId = await createTrackedItem('INV-CERO');
    const response = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'PURCHASE', quantity: 0 })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Stock negativo (BR-INV-002)', () => {
  it('se rechaza con 422 NEGATIVE_STOCK_BLOCKED si el negocio no lo permite', async () => {
    setAllowNegativeStock(false);
    const itemId = await createTrackedItem('INV-NEGATIVO', { currentStock: 5 });

    const response = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({
        inventoryItemId: itemId,
        movementType: 'WASTE',
        quantity: -8,
        reason: 'Rotura de jarra'
      })
      .expect(422);

    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('NEGATIVE_STOCK_BLOCKED');
    expect(response.body.error.details.ruleId).toBe('BR-INV-002');
    expect(response.body.error.details.currentStock).toBe(5);
    expect(response.body.error.details.requestedQuantity).toBe(-3);
    expect(response.body.error.details.available).toBe(5);

    // Ni el saldo ni el histórico se han tocado.
    const detalle = await authed('get', `/api/v1/inventory/items/${itemId}`, adminToken).expect(200);
    expect(detalle.body.data.currentStock).toBe(5);
    expect(detalle.body.data.recentMovements).toHaveLength(1);
  });

  it('se permite con 201 si `businesses.allow_negative_stock` está activo', async () => {
    setAllowNegativeStock(true);
    const itemId = await createTrackedItem('INV-NEGATIVO-OK', { currentStock: 5 });

    const response = await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({
        inventoryItemId: itemId,
        movementType: 'WASTE',
        quantity: -8,
        reason: 'Rotura de estante',
      })
      .expect(201);

    expect(response.body.data.item.currentStock).toBe(-3);
    expect(response.body.data.movement.balanceAfter).toBe(-3);
    setAllowNegativeStock(false);
  });

  it('el ajuste a un saldo por debajo de cero también respeta la regla', async () => {
    setAllowNegativeStock(false);
    const itemId = await createTrackedItem('INV-ADJ-NEGATIVO', { currentStock: 5 });
    // Por `deltaQuantity`: `newQuantity` es `>= 0` por esquema (API.md 7.15), así
    // que un saldo final negativo sólo es alcanzable con una variación negativa.
    const response = await authed('post', `/api/v1/inventory/items/${itemId}/adjust`, adminToken)
      .send({ deltaQuantity: -8, reason: 'Corrección de inventario' })
      .expect(422);
    expect(response.body.error.details.code).toBe('NEGATIVE_STOCK_BLOCKED');
    expect(response.body.error.details.requestedQuantity).toBe(-3);

    // Y con el permiso del negocio, el mismo ajuste pasa y deja rastro.
    setAllowNegativeStock(true);
    const permitido = await authed('post', `/api/v1/inventory/items/${itemId}/adjust`, adminToken)
      .send({ deltaQuantity: -8, reason: 'Corrección autorizada' })
      .expect(201);
    expect(permitido.body.data.item.currentStock).toBe(-3);
    setAllowNegativeStock(false);
  });
});

describe('Ajustes manuales (BR-INV-005)', () => {
  it('`POST /items/:id/adjust` mueve el saldo con un movimiento trazable', async () => {
    const itemId = await createTrackedItem('INV-AJUSTE', { currentStock: 20 });

    const response = await authed('post', `/api/v1/inventory/items/${itemId}/adjust`, adminToken)
      .send({ deltaQuantity: -5, reason: 'Inventario físico de fin de mes' })
      .expect(201);

    expect(response.body.data.item.currentStock).toBe(15);
    expect(response.body.data.movement.movementType).toBe('ADJUSTMENT');
    expect(response.body.data.movement.balanceAfter).toBe(15);
    expect(response.body.data.movement.reason).toBe('Inventario físico de fin de mes');
    expect(response.body.data.isLowStock).toBe(false);
  });

  it('acepta el saldo absoluto y calcula la variación', async () => {
    const itemId = await createTrackedItem('INV-AJUSTE-ABS', { currentStock: 20 });
    const response = await authed('post', `/api/v1/inventory/items/${itemId}/adjust`, adminToken)
      .send({ newQuantity: 3, reason: 'Recuento tras la entrega' })
      .expect(201);
    expect(response.body.data.item.currentStock).toBe(3);
    expect(response.body.data.movement.quantity).toBe(-17);
    expect(response.body.data.movement.balanceAfter).toBe(3);
    expect(response.body.data.isLowStock).toBe(true);
  });

  it('exige exactamente uno de newQuantity y deltaQuantity (INVALID_ADJUSTMENT)', async () => {
    const itemId = await createTrackedItem('INV-AJUSTE-XOR');
    const ambos = await authed('post', `/api/v1/inventory/items/${itemId}/adjust`, adminToken)
      .send({ newQuantity: 10, deltaQuantity: 2, reason: 'Ambos' })
      .expect(400);
    expect(ambos.body.error.details[0].code).toBe('INVALID_ADJUSTMENT');

    const ninguno = await authed('post', `/api/v1/inventory/items/${itemId}/adjust`, adminToken)
      .send({ reason: 'Ninguno' })
      .expect(400);
    expect(ninguno.body.error.details[0].code).toBe('INVALID_ADJUSTMENT');
  });

  it('PATCH con currentStock es 422 FIELD_NOT_EDITABLE: el saldo no se edita a mano', async () => {
    const itemId = await createTrackedItem('INV-EDITABLE');
    const response = await authed('patch', `/api/v1/inventory/items/${itemId}`, adminToken)
      .send({ currentStock: 999, name: 'Nuevo nombre' })
      .expect(422);
    expect(response.body.error.code).toBe('BUSINESS_RULE_ERROR');
    expect(response.body.error.details.code).toBe('FIELD_NOT_EDITABLE');
    expect(response.body.error.details.field).toBe('currentStock');
  });

  it('edita la ficha del ítem sin tocar el saldo', async () => {
    const itemId = await createTrackedItem('INV-FICHA', { currentStock: 7, supplier: 'Original' });
    const response = await authed('patch', `/api/v1/inventory/items/${itemId}`, adminToken)
      .send({ name: 'Nombre nuevo', minStock: 12, supplier: 'Proveedor nuevo' })
      .expect(200);
    expect(response.body.data.name).toBe('Nombre nuevo');
    expect(response.body.data.minStock).toBe(12);
    expect(response.body.data.currentStock).toBe(7);
    expect(response.body.data.lowStockThreshold).toBe(12);
    expect(response.body.data.isLowStock).toBe(true);
  });

  it('la baja exige force si hubo movimientos recientes (ITEM_HAS_MOVEMENTS)', async () => {
    const itemId = await createTrackedItem('INV-BAJA');
    const sinForce = await authed('delete', `/api/v1/inventory/items/${itemId}`, adminToken)
      .send({ reason: 'Ya no se usa' })
      .expect(422);
    expect(sinForce.body.error.details.code).toBe('ITEM_HAS_MOVEMENTS');

    const conForce = await authed('delete', `/api/v1/inventory/items/${itemId}`, adminToken)
      .send({ reason: 'Fin de vida del producto', force: true })
      .expect(200);
    expect(conForce.body.data.reason).toBe('Fin de vida del producto');
    await authed('get', `/api/v1/inventory/items/${itemId}`, adminToken).expect(404);
  });
});

describe('Alertas de stock bajo (BR-INV-006)', () => {
  it('detecta los ítems por debajo del umbral y calcula severidad y déficit', async () => {
    // `minStock` explícito para que el umbral no dependa del ajuste del negocio.
    const agotado = await createTrackedItem('INV-ALERTA-OUT', { currentStock: 0, minStock: 10 });
    const bajo = await createTrackedItem('INV-ALERTA-LOW', { currentStock: 4, minStock: 10 });
    const sano = await createTrackedItem('INV-ALERTA-OK', { currentStock: 50, minStock: 10 });
    const noSeguido = await createTrackedItem('INV-ALERTA-NO', { currentStock: 0, isTracked: false });

    const response = await authed('get', '/api/v1/inventory/alerts?pageSize=100', adminToken).expect(200);
    const alerts = response.body.data as {
      itemId: number;
      severity: string;
      deficitQuantity: number;
      lowStockThreshold: number;
      isTracked: boolean;
    }[];

    const porItem = new Map(alerts.map((alerta) => [alerta.itemId, alerta]));
    expect(porItem.get(agotado)?.severity).toBe('OUT');
    expect(porItem.get(bajo)?.severity).toBe('LOW');
    expect(porItem.get(bajo)?.deficitQuantity).toBe(6);
    expect(porItem.get(bajo)?.lowStockThreshold).toBe(10);
    // Sanos y no seguidos NUNCA entran en la alerta.
    expect(porItem.has(sano)).toBe(false);
    expect(porItem.has(noSeguido)).toBe(false);

    // El desglose por severidad viene en `meta` y cuenta TODAS las alertas.
    expect(response.body.meta.countsBySeverity.OUT).toBeGreaterThanOrEqual(1);
    expect(response.body.meta.countsBySeverity.LOW).toBeGreaterThanOrEqual(1);
  });

  it('filtra por severidad y respeta includeNegative=false', async () => {
    setAllowNegativeStock(true);
    const itemId = await createTrackedItem('INV-ALERTA-NEG', { currentStock: 0, minStock: 5 });
    await authed('post', '/api/v1/inventory/movements', adminToken)
      .send({ inventoryItemId: itemId, movementType: 'WASTE', quantity: -2, reason: 'Merma' })
      .expect(201);
    setAllowNegativeStock(false);

    const conNegativos = await authed('get', '/api/v1/inventory/alerts?pageSize=100', adminToken)
      .expect(200);
    const negativas = (conNegativos.body.data as { itemId: number; severity: string }[]).filter(
      (alerta) => alerta.severity === 'NEGATIVE',
    );
    expect(negativas.some((alerta) => alerta.itemId === itemId)).toBe(true);

    const sinNegativos = await authed(
      'get',
      '/api/v1/inventory/alerts?includeNegative=false&pageSize=100',
      adminToken,
    ).expect(200);
    expect(
      (sinNegativos.body.data as { severity: string }[]).some((alerta) => alerta.severity === 'NEGATIVE'),
    ).toBe(false);

    const soloNegativas = await authed(
      'get',
      '/api/v1/inventory/alerts?severity=NEGATIVE&pageSize=100',
      adminToken,
    ).expect(200);
    expect(soloNegativas.body.meta.total).toBeGreaterThan(0);
    for (const alerta of soloNegativas.body.data as { severity: string }[]) {
      expect(alerta.severity).toBe('NEGATIVE');
    }
  });

  it('el listado de ítems calcula isLowStock y agrega los totales de meta', async () => {
    const response = await authed('get', '/api/v1/inventory/items?isLowStock=true&pageSize=100', adminToken)
      .expect(200);
    for (const item of response.body.data as { isLowStock: boolean; isTracked: boolean }[]) {
      expect(item.isLowStock).toBe(true);
      expect(item.isTracked).toBe(true);
    }
    expect(typeof response.body.meta.totals.valueMinor).toBe('number');
    expect(response.body.meta.totals.itemsTracked).toBeGreaterThan(0);
  });
});

describe('Proveedores', () => {
  it('agrupa los ítems por proveedor con conteo, stock y valor', async () => {
    await createTrackedItem('INV-PROV-1', { currentStock: 10, costMinor: 1_000, supplier: 'Lácteos del Norte' });
    await createTrackedItem('INV-PROV-2', { currentStock: 5, costMinor: 2_000, supplier: 'Lácteos del Norte' });
    await createTrackedItem('INV-PROV-3', { currentStock: 2, costMinor: 3_000, supplier: 'Café de Origen' });

    const response = await authed('get', '/api/v1/inventory/suppliers?pageSize=50', adminToken)
      .expect(200);
    const proveedores = response.body.data as {
      name: string;
      itemCount: number;
      totalStock: number;
      totalValueMinor: number;
      lowStockCount: number;
    }[];

    const lacteos = proveedores.find((item) => item.name === 'Lácteos del Norte');
    expect(lacteos?.itemCount).toBe(2);
    expect(lacteos?.totalStock).toBe(15);
    // 10 * 1000 + 5 * 2000 = 20 000 centavos.
    expect(lacteos?.totalValueMinor).toBe(20_000);
    expect(proveedores.some((item) => item.name === 'Café de Origen')).toBe(true);
  });
});

describe('Permisos de inventario', () => {
  it('un CASHIER lee el inventario pero no puede mover stock', async () => {
    // `inventory:read` y `inventory:movements:read` son C para CASHIER.
    const items = await authed('get', '/api/v1/inventory/items', cashierToken).expect(200);
    expect(items.body.success).toBe(true);
    await authed('get', '/api/v1/inventory/alerts', cashierToken).expect(200);
    await authed('get', '/api/v1/inventory/movements', cashierToken).expect(200);

    // `inventory:write` e `inventory:adjust` NO lo son.
    const escritura = await authed('post', '/api/v1/inventory/items', cashierToken)
      .send({ productId: 1, name: 'No permitido', unit: 'UND' })
      .expect(403);
    expect(escritura.body.error.details.required).toBe('inventory:write');

    const ajuste = await authed('post', '/api/v1/inventory/movements', cashierToken)
      .send({ inventoryItemId: 1, movementType: 'PURCHASE', quantity: 5 })
      .expect(403);
    expect(ajuste.body.error.details.required).toBe('inventory:adjust');
  });

  it('sin token responde 401 MISSING_TOKEN', async () => {
    const response = await request(app).get('/api/v1/inventory/items').expect(401);
    expect(response.body.error.details.code).toBe('MISSING_TOKEN');
  });
});

describe('Histórico de movimientos', () => {
  it('rechaza un rango superior a 366 días (RANGE_TOO_LARGE)', async () => {
    const response = await authed(
      'get',
      '/api/v1/inventory/movements?from=2020-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z',
      adminToken,
    ).expect(400);
    expect(response.body.error.details[0].code).toBe('RANGE_TOO_LARGE');
  });

  it('devuelve los totales de entrada y salida en meta', async () => {
    const response = await authed('get', '/api/v1/inventory/movements?pageSize=100', adminToken)
      .expect(200);
    const totals = response.body.meta.totals as {
      quantityIn: number;
      quantityOut: number;
      netQuantity: number;
    };
    expect(totals.quantityIn).toBeGreaterThan(0);
    expect(totals.quantityOut).toBeGreaterThan(0);
    expect(totals.netQuantity).toBe(totals.quantityIn - totals.quantityOut);
  });
});
