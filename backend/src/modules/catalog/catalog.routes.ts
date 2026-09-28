/**
 * Rutas del catálogo (API.md 7.10 categorías, 7.11 productos) y del menú público.
 *
 * Este fichero es DELGADO a propósito (DESIGN.md 3.2): declara método, path,
 * middlewares y handler. No lee `req.body` sin validar, no decide permisos de
 * negocio y no importa repositorios.
 *
 * ============================== SEGURIDAD ===================================
 *  - `categories` y `products`: `authenticate` + `requirePermission` con las
 *    claves REALES de `shared/domain/permissions.ts` (`categories:read`,
 *    `categories:create`, `categories:update`, `categories:delete`,
 *    `products:read`, `products:create`, `products:update`, `products:delete`,
 *    `products:availability:update`, `products:duplicate`). El enunciado
 *    mencionaba `categories:manage`, clave que NO existe: el catálogo real es
 *    una clave por acción, y es el que se usa.
 *  - `menu`: PÚBLICO (API.md 2 lo contemplated: la carta es pública) pero con
 *    `menuRateLimit`, un presupuesto PROPIO más estricto que el global. Es la
 *    única defensa de un endpoint sin credencial.
 *  - El orden de la cadena es siempre `authenticate -> requirePermission ->
 *    validate -> handler`: primero identidad, luego autorización, y sólo después
 *    la forma de la petición. Así un `CUSTOMER` recibe 403 y no 400 por un campo
 *    mal formado.
 *
 * ============================== ORDEN DE RUTAS =============================
 * Express enruta en orden de declaración, y `/ingredients` (un segmento) tiene
 * la misma forma que `/:id` (un segmento). Por eso las rutas literales
 * `/ingredients` se declaran ANTES que `/:id`: si se invirtieran, un `GET
 * /products/ingredients` caería en `/:id` y fallaría con "el identificador debe
 * ser un número entero". Es el mismo motivo por el que `customers.routes.ts`
 * declara `/me` antes que `/:id`.
 */
import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

import { PERMISSION } from '../../shared/domain/index.js';
import { ERROR_CODE, RateLimitError } from '../../shared/errors/index.js';
import { sendError } from '../../shared/http/index.js';
import { authenticate, requirePermission, validate } from '../../shared/middleware/index.js';
import { isRateLimitingEnabled } from '../../shared/middleware/rate-limit.js';
import { CategoriesController } from './categories.controller.js';
import { getCatalogServices } from './catalog.container.js';
import { MenuController } from './menu.controller.js';
import { ProductsController } from './products.controller.js';
import {
  CATEGORY_SORT_COLUMNS,
  CATEGORY_SORT_DEFAULT,
  INGREDIENT_SORT_COLUMNS,
  INGREDIENT_SORT_DEFAULT,
  PRODUCT_SORT_COLUMNS,
  PRODUCT_SORT_DEFAULT,
  addonIdParamsSchema,
  addProductIngredientBodySchema,
  categoryIdParamsSchema,
  createAddonBodySchema,
  createCategoryBodySchema,
  createIngredientBodySchema,
  createProductBodySchema,
  createVariantBodySchema,
  deleteCategoryBodySchema,
  deleteIngredientBodySchema,
  deleteProductBodySchema,
  duplicateProductBodySchema,
  ingredientIdParamsSchema,
  listCategoriesQuerySchema,
  listIngredientsQuerySchema,
  listProductsQuerySchema,
  menuProductParamsSchema,
  menuQuerySchema,
  productActiveBodySchema,
  productAvailabilityBodySchema,
  productIdParamsSchema,
  productIngredientParamsSchema,
  reorderCategoriesBodySchema,
  updateAddonBodySchema,
  updateCategoryBodySchema,
  updateIngredientBodySchema,
  updateProductBodySchema,
  updateVariantBodySchema,
  variantIdParamsSchema,
} from './catalog.schemas.js';

/** Grafo del módulo, construido una vez al importar el router. */
const services = getCatalogServices();

const categoriesController = new CategoriesController(services.categories);
const productsController = new ProductsController(services.products);
const menuController = new MenuController(services.menu);

/** Router de categorías. Se monta bajo `/api/v1/categories`. */
export const categoriesRouter: Router = Router();

/** `GET /api/v1/categories` — `categories:read`. */
categoriesRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.CATEGORIES_READ),
  validate({
    query: listCategoriesQuerySchema,
    sortable: {
      allowedColumns: CATEGORY_SORT_COLUMNS,
      defaultColumn: CATEGORY_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  categoriesController.list,
);

/** `POST /api/v1/categories` — `categories:create` (201). */
categoriesRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.CATEGORIES_CREATE),
  validate({ body: createCategoryBodySchema }),
  categoriesController.create,
);

/**
 * `POST /api/v1/categories/reorder` — `categories:update`.
 * Se declara junto a la raíz porque es una ruta LITERAL: si se declarase después
 * que `/:id`, Express la seguiría interpretando como un id.
 */
categoriesRouter.post(
  '/reorder',
  authenticate,
  requirePermission(PERMISSION.CATEGORIES_UPDATE),
  validate({ body: reorderCategoriesBodySchema }),
  categoriesController.reorder,
);

/** `GET /api/v1/categories/:id` — `categories:read`. */
categoriesRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CATEGORIES_READ),
  validate({ params: categoryIdParamsSchema }),
  categoriesController.getById,
);

/** `PATCH /api/v1/categories/:id` — `categories:update`. */
categoriesRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CATEGORIES_UPDATE),
  validate({ params: categoryIdParamsSchema, body: updateCategoryBodySchema }),
  categoriesController.update,
);

/** `DELETE /api/v1/categories/:id` — `categories:delete` (soft delete). */
categoriesRouter.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.CATEGORIES_DELETE),
  validate({ params: categoryIdParamsSchema, body: deleteCategoryBodySchema }),
  categoriesController.remove,
);

/** Router de productos. Se monta bajo `/api/v1/products`. */
export const productsRouter: Router = Router();

/** `GET /api/v1/products` — `products:read`. Con `?fields=basic` va projections. */
productsRouter.get(
  '/',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_READ),
  validate({
    query: listProductsQuerySchema,
    sortable: {
      allowedColumns: PRODUCT_SORT_COLUMNS,
      defaultColumn: PRODUCT_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  productsController.list,
);

/** `POST /api/v1/products` — `products:create` (201). */
productsRouter.post(
  '/',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_CREATE),
  validate({ body: createProductBodySchema }),
  productsController.create,
);

/**
 * Catálogo de insumos. Rutas LITERALES de un segmento: se declaran antes de
 * `/:id` porque Express enruta por orden y `ingredients` no es un id.
 */
productsRouter.get(
  '/ingredients',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_READ),
  validate({
    query: listIngredientsQuerySchema,
    sortable: {
      allowedColumns: INGREDIENT_SORT_COLUMNS,
      defaultColumn: INGREDIENT_SORT_DEFAULT,
      defaultOrder: 'asc',
    },
  }),
  productsController.listIngredients,
);

productsRouter.post(
  '/ingredients',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ body: createIngredientBodySchema }),
  productsController.createIngredient,
);

productsRouter.patch(
  '/ingredients/:ingredientId',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: ingredientIdParamsSchema, body: updateIngredientBodySchema }),
  productsController.updateIngredient,
);

productsRouter.delete(
  '/ingredients/:ingredientId',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_DELETE),
  validate({ params: ingredientIdParamsSchema, body: deleteIngredientBodySchema }),
  productsController.removeIngredient,
);

/** `GET /api/v1/products/:id` — `products:read`. */
productsRouter.get(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_READ),
  validate({ params: productIdParamsSchema }),
  productsController.getById,
);

/** `PATCH /api/v1/products/:id` — `products:update`. */
productsRouter.patch(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: productIdParamsSchema, body: updateProductBodySchema }),
  productsController.update,
);

/** `DELETE /api/v1/products/:id` — `products:delete` (soft delete). */
productsRouter.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_DELETE),
  validate({ params: productIdParamsSchema, body: deleteProductBodySchema }),
  productsController.remove,
);

/**
 * `PATCH /api/v1/products/:id/availability` — `products:availability:update`.
 * Endpoint propio y permiso propio: `is_available` (disponibilidad comercial) y
 * `is_active` (existencia en el catálogo) no son lo mismo (BR-PRICE-006).
 */
productsRouter.patch(
  '/:id/availability',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_AVAILABILITY_UPDATE),
  validate({ params: productIdParamsSchema, body: productAvailabilityBodySchema }),
  productsController.setAvailability,
);

/** `PATCH /api/v1/products/:id/active` — `products:update`. */
productsRouter.patch(
  '/:id/active',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: productIdParamsSchema, body: productActiveBodySchema }),
  productsController.setActive,
);

/** `POST /api/v1/products/:id/duplicate` — `products:duplicate` (201). */
productsRouter.post(
  '/:id/duplicate',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_DUPLICATE),
  validate({ params: productIdParamsSchema, body: duplicateProductBodySchema }),
  productsController.duplicate,
);

// --- Variantes --------------------------------------------------------------

productsRouter.get(
  '/:id/variants',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_READ),
  validate({ params: productIdParamsSchema }),
  productsController.listVariants,
);

productsRouter.post(
  '/:id/variants',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: productIdParamsSchema, body: createVariantBodySchema }),
  productsController.createVariant,
);

productsRouter.patch(
  '/variants/:variantId',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: variantIdParamsSchema, body: updateVariantBodySchema }),
  productsController.updateVariant,
);

productsRouter.delete(
  '/variants/:variantId',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: variantIdParamsSchema }),
  productsController.removeVariant,
);

// --- Complementos -----------------------------------------------------------

productsRouter.get(
  '/:id/addons',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_READ),
  validate({ params: productIdParamsSchema }),
  productsController.listAddons,
);

productsRouter.post(
  '/:id/addons',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: productIdParamsSchema, body: createAddonBodySchema }),
  productsController.createAddon,
);

productsRouter.patch(
  '/addons/:addonId',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: addonIdParamsSchema, body: updateAddonBodySchema }),
  productsController.updateAddon,
);

productsRouter.delete(
  '/addons/:addonId',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: addonIdParamsSchema }),
  productsController.removeAddon,
);

// --- Receta -----------------------------------------------------------------

productsRouter.get(
  '/:id/ingredients',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_READ),
  validate({ params: productIdParamsSchema }),
  productsController.listRecipe,
);

productsRouter.post(
  '/:id/ingredients',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: productIdParamsSchema, body: addProductIngredientBodySchema }),
  productsController.addIngredient,
);

productsRouter.delete(
  '/:id/ingredients/:ingredientId',
  authenticate,
  requirePermission(PERMISSION.PRODUCTS_UPDATE),
  validate({ params: productIngredientParamsSchema }),
  productsController.removeRecipeIngredient,
);

// ===========================================================================
// Menú público
// ===========================================================================

/**
 * Límite de tasa PROPIO del menú.
 *
 * Es público y devuelve el catálogo completo, así que su presupuesto es más
 * corto que el del global pero más alto que el de autenticación: hay que
 * permitir recargar la carta cada vez que se abre la app, y a la vez impedir
 * que un crawler la vacíe. Hereda el interruptor global de los tests
 * (`isRateLimitingEnabled`) para que una suite que dispare peticiones en bucle
 * no se encuentre con un 429 inesperado.
 */
const menuRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req): string => ipKeyGenerator(req.ip ?? '0.0.0.0'),
  skip: (): boolean => !isRateLimitingEnabled(),
  handler: (req, res, _next, optionsUsed) => {
    const retryAfterSeconds = Math.max(1, Math.ceil((optionsUsed.windowMs ?? 60_000) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    sendError(
      res,
      new RateLimitError('Demasiadas consultas del menú. Inténtelo de nuevo en unos segundos.', {
        details: {
          code: ERROR_CODE.RATE_LIMIT,
          limit: optionsUsed.limit,
          windowMs: optionsUsed.windowMs,
          retryAfterSeconds,
          path: req.path,
        },
      }),
    );
  },
});

/** Router del menú público. Se monta bajo `/api/v1/menu`. */
export const menuRouter: Router = Router();

/**
 * `GET /api/v1/menu` — categorías activas con sus productos disponibles.
 *
 * DESVIACIÓN DOCUMENTADA: `docs/API.md` NO define este endpoint. La carta es
 * pública y `GET /api/v1/products` exige `products:read` y devuelve el catálogo
 * de gestión, así que hacía falta una proyección pública. Ver el informe de
 * entrega: hay que añadir esta sección a API.md.
 */
menuRouter.get('/', menuRateLimit, validate({ query: menuQuerySchema }), menuController.list);

/** `GET /api/v1/menu/:productId` — ficha de un producto del menú. */
menuRouter.get(
  '/:productId',
  menuRateLimit,
  validate({ params: menuProductParamsSchema }),
  menuController.getProduct,
);
