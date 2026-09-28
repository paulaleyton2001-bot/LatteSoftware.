/**
 * Pruebas de catálogo: categorías, productos, sub-recursos, precio unitario y
 * menú público (`tests/catalog.spec.ts`).
 *
 * ============================== POR QUÉ ESTE FICHERO MONTA SU PROPIA APP ====
 * `modules/index.ts` lo cablea el agente integrador y este agente no lo toca, así
 * que los routers de catálogo todavía NO están en el árbol de la aplicación. Para
 * que estas pruebas ejerciten la CADENA REAL (los mismos middlewares, los mismos
 * servicios y la misma base en memoria del harness) y no una versión recortada,
 * se reconstruye aquí la pila de Express con la MISMA composición que
 * `app.ts` más los routers del módulo. En cuanto el integrador los registre en
 * `MODULE_ROUTERS`, estas pruebas siguen funcionando sin cambios: basta con
 * quitar el `appFactory` local y usar `ctx.app`.
 *
 * Reutiliza `tests/helpers/harness.ts` (base en memoria, migraciones, semilla de
 * RBAC y las cuentas de sistema) y NO duplica nada de su lógica.
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
import { resolveUnitPrice } from '../src/modules/catalog/catalog.pricing.js';

let ctx: TestContext;
let app: Express;
let adminToken: string;
let cashierToken: string;

/**
 * Misma pila que `src/app.ts`, con los routers del catálogo añadidos donde los
 * montará `modules/index.ts`.
 */
function buildTestApp(): Express {
  const instance = express();
  instance.set('trust proxy', 1);
  instance.set('x-powered-by', false);
  instance.use(securityHeaders);
  instance.use(corsMiddleware);
  instance.use(requestContext);
  instance.use(jsonBody);
  // Cada router se monta en SU prefijo, igual que hace `createApiV1Router()` con
  // `MODULE_ROUTERS`: si se montaran en `/api/v1`, sus rutas internas pasarían a
  // ser `/api/v1/` y `/api/v1/:id`.
  instance.use(`${API_PREFIX}/categories`, categoriesRouter);
  instance.use(`${API_PREFIX}/products`, productsRouter);
  instance.use(`${API_PREFIX}/menu`, menuRouter);
  instance.use(notFound);
  instance.use(errorHandler);
  return instance;
}

beforeAll(async () => {
  ctx = await createTestContext();
  app = buildTestApp();
  adminToken = await ctx.accessTokenFor('ADMIN');
  cashierToken = await ctx.accessTokenFor('CASHIER');
});

afterAll(() => {
  ctx.close();
});

/** Petición autenticada contra la app local del catálogo. */
function authed(method: 'get' | 'post' | 'patch' | 'delete', url: string, token: string) {
  return request(app)[method](url).set('Authorization', `Bearer ${token}`);
}

/** Alta de categoría con valores por defecto válidos. */
async function createCategory(
  name: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; slug: string }> {
  const response = await authed('post', '/api/v1/categories', adminToken)
    .send({ name, ...overrides })
    .expect(201);
  return { id: Number(response.body.data.id), slug: String(response.body.data.slug) };
}

/** Alta de producto con valores por defecto válidos. */
async function createProduct(
  sku: string,
  overrides: Record<string, unknown> = {},
): Promise<{ id: number; sku: string }> {
  const response = await authed('post', '/api/v1/products', adminToken)
    .send({ sku, name: `Producto ${sku}`, basePriceMinor: 500_000, ...overrides })
    .expect(201);
  return { id: Number(response.body.data.id), sku: String(response.body.data.sku) };
}

describe('Categorías (API.md 7.10)', () => {
  it('crea, lee, edita y da de baja; el soft delete desaparece del listado', async () => {
    const created = await createCategory('Bebidas calientes', { icon: 'cup' });

    const detalle = await authed('get', `/api/v1/categories/${created.id}`, adminToken).expect(200);
    expect(detalle.body.data.name).toBe('Bebidas calientes');
    expect(detalle.body.data.slug).toBe('bebidas-calientes');
    expect(detalle.body.data.isActive).toBe(true);
    // `products` embebido con el límite interno de 50 de API.md 7.10.
    expect(Array.isArray(detalle.body.data.products)).toBe(true);

    const editada = await authed('patch', `/api/v1/categories/${created.id}`, adminToken)
      .send({ name: 'Bebidas frías' })
      .expect(200);
    expect(editada.body.data.name).toBe('Bebidas frías');
    expect(editada.body.data.slug).toBe('bebidas-calientes');

    const baja = await authed('delete', `/api/v1/categories/${created.id}`, adminToken)
      .send({})
      .expect(200);
    expect(baja.body.data.id).toBe(created.id);
    expect(typeof baja.body.data.deletedAt).toBe('string');
    expect(baja.body.data.orphanedProducts).toBe(0);

    // El soft delete no aparece en el listado...
    const listado = await authed('get', '/api/v1/categories?pageSize=100', adminToken).expect(200);
    expect(listado.body.data.map((item: { id: number }) => item.id)).not.toContain(created.id);
    // ...ni en su propio detalle.
    await authed('get', `/api/v1/categories/${created.id}`, adminToken).expect(404);
  });

  it('rechaza un slug duplicado con 409 CATEGORY_SLUG_TAKEN', async () => {
    await createCategory('Cafés de especialidad', { slug: 'cafes-especialidad' });
    const duplicado = await authed('post', '/api/v1/categories', adminToken)
      .send({ name: 'Cafés de especialidad', slug: 'cafes-especialidad' })
      .expect(409);
    expect(duplicado.body.error.code).toBe('CONFLICT_ERROR');
    expect(duplicado.body.error.details.code).toBe('CATEGORY_SLUG_TAKEN');
    expect(duplicado.body.error.details.field).toBe('slug');
  });

  it('reordena el catálogo en una sola transacción', async () => {
    const primera = await createCategory('Repostería');
    const segunda = await createCategory('Zumos');
    const tercera = await createCategory('Tés');

    const response = await authed('post', '/api/v1/categories/reorder', adminToken)
      .send({
        items: [
          { id: tercera.id, sortOrder: 0 },
          { id: segunda.id, sortOrder: 1 },
          { id: primera.id, sortOrder: 2 },
        ],
      })
      .expect(200);

    const ordenados = response.body.data as { id: number; sortOrder: number }[];
    expect(ordenados.map((item) => item.sortOrder)).toEqual([0, 1, 2]);

    const listado = await authed('get', '/api/v1/categories?pageSize=100', adminToken).expect(200);
    const posiciones = (listado.body.data as { id: number }[]).map((item) => item.id);
    expect(posiciones.indexOf(tercera.id)).toBeLessThan(posiciones.indexOf(segunda.id));
    expect(posiciones.indexOf(segunda.id)).toBeLessThan(posiciones.indexOf(primera.id));
  });

  it('rechaza identificadores repetidos en el reorder con 400 DUPLICATE_ID', async () => {
    const categoria = await createCategory('Moler');
    const response = await authed('post', '/api/v1/categories/reorder', adminToken)
      .send({ items: [{ id: categoria.id, sortOrder: 0 }, { id: categoria.id, sortOrder: 1 }] })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('DUPLICATE_ID');
  });

  it('exige confirmación para dejar productos huérfanos (CATEGORY_HAS_PRODUCTS)', async () => {
    const categoria = await createCategory('Smoothies');
    await createProduct('SMOOTH-001', { categoryId: categoria.id });

    const sinConfirmar = await authed('delete', `/api/v1/categories/${categoria.id}`, adminToken)
      .send({})
      .expect(422);
    expect(sinConfirmar.body.error.details.code).toBe('CATEGORY_HAS_PRODUCTS');
    expect(sinConfirmar.body.error.details.orphanedProducts).toBe(1);

    const confirmada = await authed('delete', `/api/v1/categories/${categoria.id}`, adminToken)
      .send({ confirmOrphan: true, reason: 'Reorganización del carta' })
      .expect(200);
    expect(confirmada.body.data.orphanedProducts).toBe(1);

    // El producto sobrevive, pero sin categoría (`ON DELETE SET NULL`).
    const productos = await authed('get', '/api/v1/products?q=SMOOTH-001', adminToken).expect(200);
    const encontrados = productos.body.data as { id: number; categoryId: number | null }[];
    expect(encontrados).toHaveLength(1);
    expect(encontrados[0]?.categoryId).toBeNull();
  });

  it('rechaza campos desconocidos con 400 UNKNOWN_FIELD', async () => {
    const response = await authed('post', '/api/v1/categories', adminToken)
      .send({ name: 'Prueba', campoInventado: true })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
  });
});

describe('Productos (API.md 7.11)', () => {
  it('crea un producto con variantes y complementos en la misma transacción', async () => {
    const response = await authed('post', '/api/v1/products', adminToken)
      .send({
        sku: 'LATTE-001',
        name: 'Latte clásico',
        shortDescription: 'Espresso con leche',
        basePriceMinor: 480_000,
        taxRateBp: 1900,
        trackStock: true,
        variants: [
          { name: 'Grande', priceDeltaMinor: 80_000, isDefault: true },
          { name: 'Pequeño', priceDeltaMinor: -50_000 },
        ],
        addons: [
          { name: 'Extra shot', priceMinor: 60_000 },
          { name: 'Sin lactosa', priceMinor: 0, isMultiple: true, maxSelect: 1 },
        ],
      })
      .expect(201);

    const data = response.body.data;
    expect(data.sku).toBe('LATTE-001');
    expect(data.slug).toBe('latte-clasico');
    expect(data.variants).toHaveLength(2);
    expect(data.addons).toHaveLength(2);
    // BR-PRICE-001: precio resuelto, no precio base desnudo.
    const grande = data.variants.find((variant: { name: string }) => variant.name === 'Grande');
    const pequeno = data.variants.find((variant: { name: string }) => variant.name === 'Pequeño');
    expect(grande.effectivePriceMinor).toBe(560_000);
    expect(pequeno.effectivePriceMinor).toBe(430_000);
    // Sin `inventory_item` todavía: `stock` es null, no cero (API.md 6.3).
    expect(data.stock).toBeNull();
    expect(data.priceHistory).toEqual([]);
  });

  it('edita un producto y avisa de que el precio sólo afecta a pedidos nuevos', async () => {
    const producto = await createProduct('EDIT-001', { basePriceMinor: 300_000 });
    const response = await authed('patch', `/api/v1/products/${producto.id}`, adminToken)
      .send({ basePriceMinor: 350_000 })
      .expect(200);
    expect(response.body.data.basePriceMinor).toBe(350_000);
    expect(response.body.meta.warnings).toContain('PRICE_CHANGE_AFFECTS_ONLY_NEW');
  });

  it('no acepta sku en el PATCH y da 400 UNKNOWN_FIELD', async () => {
    const producto = await createProduct('SKU-IMUTABLE');
    const response = await authed('patch', `/api/v1/products/${producto.id}`, adminToken)
      .send({ sku: 'OTRO' })
      .expect(400);
    expect(response.body.error.details[0].code).toBe('UNKNOWN_FIELD');
  });

  it('rechaza un SKU duplicado con 409 PRODUCT_SKU_TAKEN', async () => {
    await createProduct('DUP-SKU-1');
    const response = await authed('post', '/api/v1/products', adminToken)
      .send({ sku: 'DUP-SKU-1', name: 'Otro producto', basePriceMinor: 100_000 })
      .expect(409);
    expect(response.body.error.code).toBe('CONFLICT_ERROR');
    expect(response.body.error.details.code).toBe('PRODUCT_SKU_TAKEN');
  });

  it('rechaza un slug duplicado con 409 PRODUCT_SLUG_TAKEN', async () => {
    await createProduct('SLUG-A', { slug: 'cafe-unico' });
    const response = await authed('post', '/api/v1/products', adminToken)
      .send({ sku: 'SLUG-B', name: 'Otro', slug: 'cafe-unico', basePriceMinor: 100_000 })
      .expect(409);
    expect(response.body.error.details.code).toBe('PRODUCT_SLUG_TAKEN');
  });

  it('rechaza una promoción que no abarata el producto (PROMO_PRICE_NOT_LOWER)', async () => {
    const response = await authed('post', '/api/v1/products', adminToken)
      .send({
        sku: 'PROMO-MAL',
        name: 'Promo mala',
        basePriceMinor: 200_000,
        promoPriceMinor: 250_000,
        promoStartsAt: '2026-01-01T00:00:00.000Z',
        promoEndsAt: '2026-12-31T00:00:00.000Z',
      })
      .expect(400);
    expect(response.body.error.details[0].code).toBe('PROMO_PRICE_NOT_LOWER');
  });

  it('rechaza una ventana promocional incompleta (PROMO_WINDOW_INVALID)', async () => {
    const response = await authed('post', '/api/v1/products', adminToken)
      .send({
        sku: 'PROMO-VENTANA',
        name: 'Ventana incompleta',
        basePriceMinor: 200_000,
        promoPriceMinor: 150_000,
        promoStartsAt: '2026-01-01T00:00:00.000Z',
      })
      .expect(400);
    expect(response.body.error.details[0].code).toBe('PROMO_WINDOW_INVALID');
  });

  it('separa disponibilidad comercial de existencia en el catálogo (BR-PRICE-006)', async () => {
    const producto = await createProduct('DISPON-001');

    const agotado = await authed('patch', `/api/v1/products/${producto.id}/availability`, adminToken)
      .send({ isAvailable: false, reason: 'AGOTADO' })
      .expect(200);
    expect(agotado.body.data.isAvailable).toBe(false);
    // `is_active` NO cambia: sigue en el catálogo y se puede reactivar.
    expect(agotado.body.data.isActive).toBe(true);

    const desactivado = await authed('patch', `/api/v1/products/${producto.id}/active`, adminToken)
      .send({ isActive: false })
      .expect(200);
    expect(desactivado.body.data.isActive).toBe(false);
    expect(desactivado.body.data.isAvailable).toBe(false);

    // Con `includeInactive` el producto vuelve a verse; por defecto, no.
    const oculto = await authed('get', '/api/v1/products?q=DISPON-001', adminToken).expect(200);
    expect(oculto.body.data).toHaveLength(0);
    const visible = await authed(
      'get',
      '/api/v1/products?q=DISPON-001&includeInactive=true',
      adminToken,
    ).expect(200);
    expect(visible.body.data).toHaveLength(1);
  });

  it('baja lógica un producto y no lo muestra en el listado', async () => {
    const producto = await createProduct('BAJA-001');
    const baja = await authed('delete', `/api/v1/products/${producto.id}`, adminToken)
      .send({ reason: 'Fin de temporada' })
      .expect(200);
    expect(baja.body.data.affectedOrderItems).toBe(0);

    const listado = await authed('get', '/api/v1/products?q=BAJA-001&includeInactive=true', adminToken)
      .expect(200);
    expect(listado.body.data).toHaveLength(0);
    await authed('get', `/api/v1/products/${producto.id}`, adminToken).expect(404);
  });

  it('filtra por categoría, precio y disponibilidad con parámetros', async () => {
    const categoria = await createCategory('Filtrables');
    await createProduct('FILT-1', { categoryId: categoria.id, basePriceMinor: 100_000, isFeatured: true });
    await createProduct('FILT-2', { categoryId: categoria.id, basePriceMinor: 900_000 });

    const porCategoria = await authed(
      'get',
      `/api/v1/products?categoryId=${categoria.id}&pageSize=50`,
      adminToken,
    ).expect(200);
    expect(porCategoria.body.meta.total).toBe(2);

    const porPrecio = await authed(
      'get',
      `/api/v1/products?categoryId=${categoria.id}&maxPrice=500000&pageSize=50`,
      adminToken,
    ).expect(200);
    expect((porPrecio.body.data as { sku: string }[]).map((item) => item.sku)).toEqual(['FILT-1']);

    const destacados = await authed('get', '/api/v1/products?featured=true&pageSize=50', adminToken)
      .expect(200);
    expect((destacados.body.data as { sku: string }[]).some((item) => item.sku === 'FILT-1')).toBe(true);

    // `q` busca por nombre, SKU y descripción corta, siempre con LIKE parametrizado.
    const porSku = await authed('get', '/api/v1/products?q=FILT-2&pageSize=50', adminToken)
      .expect(200);
    expect(porSku.body.meta.total).toBe(1);
  });

  it('rechaza ordenar por una columna fuera de la allowlist (INVALID_SORT_FIELD)', async () => {
    const response = await authed('get', '/api/v1/products?sort=basePriceMinor%3B--', adminToken)
      .expect(400);
    expect(response.body.error.details[0].code).toBe('INVALID_SORT_FIELD');
  });

  it('`fields=basic` NO devuelve la clave `variants` ni `addons`', async () => {
    const producto = await createProduct('BASIC-001', {
      variants: [{ name: 'Única', priceDeltaMinor: 0, isDefault: true }],
      addons: [{ name: 'Extra', priceMinor: 10_000 }],
    });

    const completo = await authed('get', `/api/v1/products/${producto.id}`, adminToken).expect(200);
    expect(completo.body.data.variants).toHaveLength(1);
    expect(completo.body.data.addons).toHaveLength(1);

    const basico = await authed('get', '/api/v1/products?fields=basic&pageSize=50', adminToken)
      .expect(200);
    const fila = (basico.body.data as { id: number }[]).find((item) => item.id === producto.id);
    expect(fila).toBeDefined();
    // Comprobación EXPRESA de la clave: no viene vacía, NO VIENE.
    expect(Object.prototype.hasOwnProperty.call(basico.body.data[0], 'variants')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(basico.body.data[0], 'addons')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(basico.body.data[0], 'description')).toBe(false);
    // Y sí trae las 10 columnas de `ProductBasic` (API.md 6.3).
    expect(Object.keys(basico.body.data[0]).sort()).toEqual(
      [
        'basePriceMinor',
        'categoryId',
        'id',
        'imageUrl',
        'isAvailable',
        'isFeatured',
        'name',
        'preparationMinutes',
        'promoPriceMinor',
        'sku',
      ].sort(),
    );
  });
});

describe('Permisos de catálogo', () => {
  it('un CUSTOMER recibe 403 en POST /products con `products:create` (nunca 404)', async () => {
    // El registro se hace contra la app del HARNESS: es la que tiene montado
    // `createApiV1Router()` con el módulo `auth` completo.
    const registro = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({
        email: ctx.uniqueEmail('catalogo-cliente'),
        password: 'Cliente#2026',
        fullName: 'Cliente Catálogo',
      })
      .expect(201);
    const token = String(registro.body.data.accessToken);

    const response = await authed('post', '/api/v1/products', token)
      .send({ sku: 'NO-CREAR', name: 'No crear', basePriceMinor: 1000 })
      .expect(403);
    expect(response.body.error.code).toBe('AUTHORIZATION_ERROR');
    expect(response.body.error.details.code).toBe('INSUFFICIENT_PERMISSIONS');
    expect(response.body.error.details.required).toBe('products:create');
  });

  it('un CASHIER puede leer y cambiar disponibilidad, pero no crear productos', async () => {
    // `products:availability:update` es C para CASHIER; `products:create` no.
    const producto = await createProduct('CAJERO-001');
    await authed('patch', `/api/v1/products/${producto.id}/availability`, cashierToken)
      .send({ isAvailable: false })
      .expect(200);
    const response = await authed('post', '/api/v1/products', cashierToken)
      .send({ sku: 'CAJERO-002', name: 'No permitido', basePriceMinor: 1000 })
      .expect(403);
    expect(response.body.error.details.required).toBe('products:create');
  });

  it('sin token responde 401 MISSING_TOKEN', async () => {
    const response = await request(app).get('/api/v1/products').expect(401);
    expect(response.body.error.details.code).toBe('MISSING_TOKEN');
  });
});

describe('resolveUnitPrice — BR-PRICE-001 (función pura)', () => {
  const AHORA = '2026-06-15T12:00:00.000Z';
  const base = { basePriceMinor: 500_000 } as const;

  it('(1) sin promo y sin variante devuelve el precio base', () => {
    const precio = resolveUnitPrice(
      { ...base, promoPriceMinor: null, promoStartsAt: null, promoEndsAt: null },
      null,
      AHORA,
    );
    expect(precio).toEqual({ unitPriceMinor: 500_000, source: 'BASE' });
  });

  it('(2) con variante de delta devuelve base + delta, incluso negativo (BR-PRICE-009)', () => {
    const precio = resolveUnitPrice(
      { ...base, promoPriceMinor: null, promoStartsAt: null, promoEndsAt: null },
      { priceDeltaMinor: -120_000, priceMinor: null },
      AHORA,
    );
    expect(precio).toEqual({ unitPriceMinor: 380_000, source: 'BASE_PLUS_DELTA' });
  });

  it('(3) con precio absoluto de variante, éste SOBREESCRIBE el precio base', () => {
    const precio = resolveUnitPrice(
      { ...base, promoPriceMinor: null, promoStartsAt: null, promoEndsAt: null },
      // El delta se IGNORA cuando hay precio absoluto: manda `price_minor`.
      { priceDeltaMinor: 999_999, priceMinor: 420_000 },
      AHORA,
    );
    expect(precio).toEqual({ unitPriceMinor: 420_000, source: 'VARIANT_ABSOLUTE' });
  });

  it('(4) la promo activa gana sobre la variante de precio absoluto', () => {
    const precio = resolveUnitPrice(
      {
        ...base,
        promoPriceMinor: 350_000,
        promoStartsAt: '2026-01-01T00:00:00.000Z',
        promoEndsAt: '2026-12-31T00:00:00.000Z',
      },
      { priceDeltaMinor: 0, priceMinor: 420_000 },
      AHORA,
    );
    expect(precio).toEqual({ unitPriceMinor: 350_000, source: 'PROMO' });
  });

  it('una promo CADUCADA no se aplica: gana la variante', () => {
    const precio = resolveUnitPrice(
      {
        ...base,
        promoPriceMinor: 350_000,
        promoStartsAt: '2026-01-01T00:00:00.000Z',
        promoEndsAt: '2026-02-01T00:00:00.000Z',
      },
      { priceDeltaMinor: 0, priceMinor: 420_000 },
      AHORA,
    );
    expect(precio).toEqual({ unitPriceMinor: 420_000, source: 'VARIANT_ABSOLUTE' });
  });

  it('una promo que aún no empieza no se aplica, y sin ventana tampoco', () => {
    const futura = resolveUnitPrice(
      {
        ...base,
        promoPriceMinor: 350_000,
        promoStartsAt: '2026-12-01T00:00:00.000Z',
        promoEndsAt: '2027-01-01T00:00:00.000Z',
      },
      null,
      AHORA,
    );
    expect(futura).toEqual({ unitPriceMinor: 500_000, source: 'BASE' });

    const sinVentana = resolveUnitPrice(
      { ...base, promoPriceMinor: 350_000, promoStartsAt: null, promoEndsAt: null },
      null,
      AHORA,
    );
    expect(sinVentana).toEqual({ unitPriceMinor: 500_000, source: 'BASE' });
  });
});

describe('Variantes y complementos', () => {
  it('mantiene una sola variante por defecto dentro de la transacción', async () => {
    const producto = await createProduct('DEF-001');
    const primera = await authed('post', `/api/v1/products/${producto.id}/variants`, adminToken)
      .send({ name: 'Small', isDefault: true })
      .expect(201);
    const segunda = await authed('post', `/api/v1/products/${producto.id}/variants`, adminToken)
      .send({ name: 'Large', isDefault: true })
      .expect(201);

    const listado = await authed('get', `/api/v1/products/${producto.id}/variants`, adminToken)
      .expect(200);
    const porDefecto = (listado.body.data as { id: number; isDefault: boolean }[]).filter(
      (item) => item.isDefault,
    );
    expect(porDefecto).toHaveLength(1);
    expect(porDefecto[0]?.id).toBe(Number(segunda.body.data.id));
    expect(primera.body.data.isDefault).toBe(true);
  });

  it('rechaza un nombre de variante duplicado con 409 VARIANT_NAME_TAKEN', async () => {
    const producto = await createProduct('VN-001');
    await authed('post', `/api/v1/products/${producto.id}/variants`, adminToken)
      .send({ name: 'Mediano' })
      .expect(201);
    const response = await authed('post', `/api/v1/products/${producto.id}/variants`, adminToken)
      .send({ name: 'Mediano' })
      .expect(409);
    expect(response.body.error.details.code).toBe('VARIANT_NAME_TAKEN');
  });

  it('rechaza una variante con precio efectivo negativo (INVALID_VARIANT_PRICE, BR-PRICE-009)', async () => {
    const producto = await createProduct('VP-001', { basePriceMinor: 10_000 });
    const response = await authed('post', `/api/v1/products/${producto.id}/variants`, adminToken)
      .send({ name: 'Mini', priceDeltaMinor: -50_000 })
      .expect(422);
    expect(response.body.error.details.code).toBe('INVALID_VARIANT_PRICE');
    expect(response.body.error.details.ruleId).toBe('BR-PRICE-009');
  });

  it('exige isMultiple para fijar maxSelect (MAX_SELECT_REQUIRES_MULTIPLE)', async () => {
    const producto = await createProduct('AD-001');
    const response = await authed('post', `/api/v1/products/${producto.id}/addons`, adminToken)
      .send({ name: 'Leche de avena', priceMinor: 30_000, isMultiple: false, maxSelect: 2 })
      .expect(422);
    expect(response.body.error.details.code).toBe('MAX_SELECT_REQUIRES_MULTIPLE');

    const valido = await authed('post', `/api/v1/products/${producto.id}/addons`, adminToken)
      .send({ name: 'Leche de avena', priceMinor: 30_000, isMultiple: true, maxSelect: 2 })
      .expect(201);
    expect(valido.body.data.maxSelect).toBe(2);
    expect(valido.body.data.isMultiple).toBe(true);
  });
});

describe('Duplicado de producto', () => {
  it('clona producto, variantes y complementos, y deriva un SKU libre', async () => {
    const original = await createProduct('DUP-ORIGINAL', {
      basePriceMinor: 420_000,
      variants: [
        { name: 'Grande', priceDeltaMinor: 60_000, isDefault: true },
        { name: 'Pequeño', priceDeltaMinor: -40_000 },
      ],
      addons: [{ name: 'Extra shot', priceMinor: 70_000 }],
    });

    const duplicado = await authed('post', `/api/v1/products/${original.id}/duplicate`, adminToken)
      .send({})
      .expect(201);

    const data = duplicado.body.data;
    expect(data.id).not.toBe(original.id);
    // El SKU derivado es distinto del original: `-COPY` + contador.
    expect(data.sku).toBe('DUP-ORIGINAL-COPY');
    expect(data.name).toBe('Producto DUP-ORIGINAL (copia)');
    expect(data.isActive).toBe(false);
    expect(data.variants).toHaveLength(2);
    expect(data.addons).toHaveLength(1);
    // Los identificadores hijos son NUEVOS: los valores se copian, las claves no.
    const idsOriginales = new Set(
      (
        await authed('get', `/api/v1/products/${original.id}/variants`, adminToken).expect(200)
      ).body.data.map((item: { id: number }) => item.id),
    );
    for (const variante of data.variants as { id: number }[]) {
      expect(idsOriginales.has(variante.id)).toBe(false);
    }
    // El stock NO se duplica: sigue siendo null porque el original no tiene ítem.
    expect(data.stock).toBeNull();
  });

  it('el contador del SKU evita colisiones al duplicar dos veces', async () => {
    const original = await createProduct('DUP-DOS');
    const primera = await authed('post', `/api/v1/products/${original.id}/duplicate`, adminToken)
      .send({})
      .expect(201);
    const segunda = await authed('post', `/api/v1/products/${original.id}/duplicate`, adminToken)
      .send({})
      .expect(201);

    expect(primera.body.data.sku).toBe('DUP-DOS-COPY');
    expect(segunda.body.data.sku).toBe('DUP-DOS-COPY2');
    expect(segunda.body.data.sku).not.toBe(primera.body.data.sku);
  });

  it('respeta el SKU explícito y devuelve 409 si está ocupado', async () => {
    const original = await createProduct('DUP-SKU-EXPL');
    await createProduct('YA-OCUPADO');
    const response = await authed('post', `/api/v1/products/${original.id}/duplicate`, adminToken)
      .send({ sku: 'YA-OCUPADO' })
      .expect(409);
    expect(response.body.error.details.code).toBe('PRODUCT_SKU_TAKEN');
  });
});

describe('Receta de ingredientes', () => {
  it('añade insumos a la receta y calcula el costo de una unidad', async () => {
    const insumo = await authed('post', '/api/v1/products/ingredients', adminToken)
      .send({ name: 'Grano de café', unit: 'G', costMinor: 25, supplier: 'Café de Origen' })
      .expect(201);
    const producto = await createProduct('REC-001');

    await authed('post', `/api/v1/products/${producto.id}/ingredients`, adminToken)
      .send({ ingredientId: insumo.body.data.id, quantity: 18 })
      .expect(201);

    const receta = await authed('get', `/api/v1/products/${producto.id}/ingredients`, adminToken)
      .expect(200);
    expect(receta.body.data).toHaveLength(1);
    // `lineCostMinor` = 25 * 18 = 450 centavos.
    expect(receta.body.data[0].lineCostMinor).toBe(450);
    expect(receta.body.meta.totalCostMinor).toBe(450);
    // `updateStock = true` creó el ítem de inventario del insumo, con stock 0.
    expect(receta.body.data[0].stock.currentStock).toBe(0);
    expect(receta.body.data[0].stock.isLowStock).toBe(true);
  });

  it('rechaza repetir un insumo en la receta con 409 INGREDIENT_ALREADY_IN_RECIPE', async () => {
    const insumo = await authed('post', '/api/v1/products/ingredients', adminToken)
      .send({ name: 'Leche entera', unit: 'ML', costMinor: 5 })
      .expect(201);
    const producto = await createProduct('REC-002');
    const body = { ingredientId: insumo.body.data.id, quantity: 200 };

    await authed('post', `/api/v1/products/${producto.id}/ingredients`, adminToken)
      .send(body)
      .expect(201);
    const response = await authed('post', `/api/v1/products/${producto.id}/ingredients`, adminToken)
      .send(body)
      .expect(409);
    expect(response.body.error.details.code).toBe('INGREDIENT_ALREADY_IN_RECIPE');
  });

  it('quita un insumo de la receta sin tocar su inventario', async () => {
    const insumo = await authed('post', '/api/v1/products/ingredients', adminToken)
      .send({ name: 'Canela', unit: 'G', costMinor: 3 })
      .expect(201);
    const producto = await createProduct('REC-003');
    await authed('post', `/api/v1/products/${producto.id}/ingredients`, adminToken)
      .send({ ingredientId: insumo.body.data.id, quantity: 1 })
      .expect(201);

    const response = await authed(
      'delete',
      `/api/v1/products/${producto.id}/ingredients/${insumo.body.data.id}`,
      adminToken,
    ).expect(200);
    expect(response.body.data.removedAt).toBeTypeOf('string');

    const receta = await authed('get', `/api/v1/products/${producto.id}/ingredients`, adminToken)
      .expect(200);
    expect(receta.body.data).toHaveLength(0);
  });
});

describe('Menú público', () => {
  it('responde 200 SIN token y sólo con productos disponibles', async () => {
    const categoria = await createCategory('Menú de prueba', { isActive: true });
    await createProduct('MENU-VISIBLE', { categoryId: categoria.id, basePriceMinor: 250_000 });
    await createProduct('MENU-OCULTO', {
      categoryId: categoria.id,
      basePriceMinor: 250_000,
      isAvailable: false,
    });
    const desactivado = await createProduct('MENU-DESACTIVADO', { categoryId: categoria.id });
    await authed('patch', `/api/v1/products/${desactivado.id}/active`, adminToken)
      .send({ isActive: false })
      .expect(200);

    const response = await request(app).get('/api/v1/menu').expect(200);
    expect(response.body.success).toBe(true);
    const categorias = response.body.data as { products: { sku: string }[] }[];
    const skus = categorias.flatMap((item) => item.products.map((producto) => producto.sku));
    expect(skus).toContain('MENU-VISIBLE');
    // Ni el agotado (is_available = 0) ni el desactivado (is_active = 0).
    expect(skus).not.toContain('MENU-OCULTO');
    expect(skus).not.toContain('MENU-DESACTIVADO');
    // El menú NO expone datos de gestión: ni SKU vacío ni receta ni stock.
    expect(JSON.stringify(response.body)).not.toContain('costMinor');
  });

  it('un producto desactivado desaparece de GET /menu/:productId con 404', async () => {
    const categoria = await createCategory('Menú de ficha');
    const visible = await createProduct('FICHA-VISIBLE', { categoryId: categoria.id });
    const oculto = await createProduct('FICHA-OCULTO', { categoryId: categoria.id });
    await authed('patch', `/api/v1/products/${oculto.id}/active`, adminToken)
      .send({ isActive: false })
      .expect(200);

    const ficha = await request(app).get(`/api/v1/menu/${visible.id}`).expect(200);
    expect(ficha.body.data.sku).toBe('FICHA-VISIBLE');
    expect(ficha.body.data.category.slug).toBe('menu-de-ficha');

    await request(app).get(`/api/v1/menu/${oculto.id}`).expect(404);
  });

  it('publica el precio ya resuelto, con la promoción vigente', async () => {
    const categoria = await createCategory('Promociones');
    const inicio = new Date(Date.now() - 60_000).toISOString();
    const fin = new Date(Date.now() + 60 * 60_000).toISOString();
    await createProduct('MENU-PROMO', {
      categoryId: categoria.id,
      basePriceMinor: 500_000,
      promoPriceMinor: 400_000,
      promoStartsAt: inicio,
      promoEndsAt: fin,
    });

    const response = await request(app).get('/api/v1/menu?featured=false').expect(200);
    const categorias = response.body.data as {
      products: { sku: string; unitPriceMinor: number }[];
    }[];
    const promo = categorias
      .flatMap((item) => item.products)
      .find((producto) => producto.sku === 'MENU-PROMO');
    expect(promo?.unitPriceMinor).toBe(400_000);
  });
});

describe('Auditoría de catálogo (BR-SEC-007)', () => {
  it('deja fila en audit_logs con before y after al dar de alta un producto', async () => {
    const producto = await createProduct('AUDIT-001', { basePriceMinor: 111_000 });
    const editada = await authed('patch', `/api/v1/products/${producto.id}`, adminToken)
      .send({ name: 'Producto auditado' })
      .expect(200);
    expect(editada.body.data.name).toBe('Producto auditado');

    const filas = ctx.db
      .prepare(
        `SELECT action, before_data, after_data
           FROM audit_logs
          WHERE entity_type = 'product' AND entity_id = ?
          ORDER BY id ASC`,
      )
      .all(producto.id) as { action: string; before_data: string | null; after_data: string | null }[];

    expect(filas.length).toBeGreaterThanOrEqual(2);
    const actualizacion = filas.find((fila) => fila.action === 'UPDATE');
    expect(actualizacion).toBeDefined();
    expect(JSON.parse(actualizacion?.before_data ?? '{}').name).toBe('Producto AUDIT-001');
    expect(JSON.parse(actualizacion?.after_data ?? '{}').name).toBe('Producto auditado');
  });
});
