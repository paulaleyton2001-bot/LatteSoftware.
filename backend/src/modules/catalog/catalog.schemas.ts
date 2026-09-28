/**
 * Esquemas zod del módulo `catalog` (API.md 7.10 categorías, 7.11 productos).
 *
 * TODOS son `.strict()`: un campo desconocido es `400 VALIDATION_ERROR` con
 * `code: 'UNKNOWN_FIELD'`, no se ignora en silencio (API.md 1).
 *
 * ============================ DÓNDE VIVE QUÉ ============================
 *  - Los esquemas NO contienen reglas de negocio: que un `promoPriceMinor` sea
 *    menor que el precio base, que un `maxSelect` exija `isMultiple` o que la
 *    receta no repita un insumo lo resuelve el service, que es donde están los
 *    datos ya conocidos (el precio vigente, la receta actual...).
 *  - Lo que SÍ vive aquí es la FORMA: longitudes, tipos y formatos. Es la
 *    frontera que devuelve 400 sin llegar a tocar la base de datos.
 */
import { z } from 'zod';

import { InventoryUnit } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField, searchQueryField } from '../../shared/validation/index.js';

// --------------------------------------------------------------------------
// Atomos reutilizables
// --------------------------------------------------------------------------

/**
 * Booleanos de query. Acepta `true`/`false` y también las cadenas `"true"` /
 * `"false"`, porque en una URL todo llega como texto y el mismo parámetro
 * aparece en el contrato como booleano.
 */
const booleanQueryField = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Texto corto de catálogo: descripción, icono, notas. */
const shortText = (max: number, label: string) =>
  z.string({ error: `${label} es obligatorio` }).trim().min(1, `${label} no puede estar vacío`).max(max, `${label} no puede superar ${max} caracteres`);

/** Texto largo opcional (descripciones). */
const longText = (max: number, label: string) =>
  z
    .string({ error: `${label} debe ser texto` })
    .trim()
    .max(max, `${label} no puede superar ${max} caracteres`)
    .nullable()
    .optional();

/** URL de imagen: sólo `http(s)`, como `photoUrlField` pero sin `null` aún. */
const imageUrlOptional = z
  .union([
    z
      .url({ error: 'Debe ser una URL válida' })
      .max(500, 'La URL de la imagen es demasiado larga')
      .refine((value) => value.startsWith('http://') || value.startsWith('https://'), {
        message: 'La URL debe empezar por http:// o https://',
      }),
    z.null(),
  ])
  .optional();

/**
 * Importe en centavos, entero y no negativo (BR-MONEY-001).
 *
 * `z.coerce.number` porque el mismo átomo se usa en el cuerpo (número JSON) y en
 * la query (texto): `?maxPrice=500000` llega como cadena y debe validarse igual
 * que un `500000` del cuerpo. Es el mismo motivo por el que `resourceIdField`
 * coercea.
 */
const minorField = (label: string, max = 100_000_000) =>
  z
    .coerce.number({ error: `${label} debe ser un número entero en centavos` })
    .int(`${label} debe ser un entero en centavos`)
    .min(0, `${label} no puede ser negativo`)
    .max(max, `${label} es un importe demasiado alto`);

/** Delta de precio: puede ser NEGATIVO (BR-PRICE-009). */
const priceDeltaField = z
  .number({ error: 'El delta de precio debe ser un número entero en centavos' })
  .int('El delta de precio debe ser un entero en centavos')
  .min(-10_000_000, 'El delta de precio es demasiado bajo')
  .max(10_000_000, 'El delta de precio es demasiado alto');

/** Orden no negativo. */
const sortOrderField = z
  .number({ error: 'El orden debe ser un número entero' })
  .int('El orden debe ser un número entero')
  .min(0, 'El orden no puede ser negativo')
  .max(100_000, 'El orden es demasiado alto');

/** Instante ISO-8601 (con offset o `Z`), normalizado a UTC por el service. */
const isoInstantField = (label: string) =>
  z.string({ error: `${label} es obligatorio` }).datetime({ offset: true, message: `${label} debe ser un instante ISO-8601` });

/** Tasa en basis points: 0 a 10000 (100 % = 10000 bp, BR-TAX-001). */
const taxRateField = z
  .number({ error: 'La tasa de impuesto debe ser un número entero en basis points' })
  .int('La tasa de impuesto debe ser un entero en basis points')
  .min(0, 'La tasa de impuesto no puede ser negativa')
  .max(10_000, 'La tasa de impuesto no puede superar el 100 % (10000 basis points)')
  .nullable()
  .optional();

/** Minutos de preparación: 0 a 240 (API.md 7.11). */
const preparationMinutesField = z
  .number({ error: 'Los minutos de preparación deben ser un número entero' })
  .int('Los minutos de preparación deben ser un número entero')
  .min(0, 'Los minutos de preparación no pueden ser negativos')
  .max(240, 'Los minutos de preparación no pueden superar 240')
  .default(5);

/**
 * Slug de catálogo: minúsculas, dígitos y guiones, sin espacios ni signos.
 *
 * Es el formato que produce {@link slugify} y el que admiten los endpoints que
 * aceptan el cliente como autor de la URL pública.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slugField = (label: string) =>
  z
    .string({ error: `${label} es obligatorio` })
    .trim()
    .min(1, `${label} no puede estar vacío`)
    .max(120, `${label} no puede superar 120 caracteres`)
    .regex(SLUG_PATTERN, 'El slug sólo admite minúsculas, dígitos y guiones (ejemplo: "cafe-especial")');

/**
 * Convierte un nombre en un slug válido.
 *
 * Se usa cuando el cliente no envía `slug`. La normalización es determinista y
 * totalmente local: quitar los diacríticos, bajar a minúsculas, sustituir
 * cualquier cosa que no sea alfanumérico por un guion y colapsar los guiones
 * repetidos. Un texto que se quede sin caracteres válidos (por ejemplo "!!!")
 * produce un slug vacío y el service lo rechaza con `INVALID_SLUG` en vez de
 * inventar uno.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

// --------------------------------------------------------------------------
// 7.10 Categorías
// --------------------------------------------------------------------------

/** `GET /api/v1/categories` (API.md 7.10). */
export const listCategoriesQuerySchema = buildListQuerySchema({
  isActive: booleanQueryField.optional(),
  includeInactive: booleanQueryField.optional(),
  includeProductCount: booleanQueryField.optional(),
  q: searchQueryField,
});

/**
 * `POST /api/v1/categories`.
 *
 * `slug`, `sortOrder` e `isActive` son opcionales: los recibe el service, que
 * deriva el slug del nombre y coloca la categoría al final (`sortOrder = max+1`).
 */
export const createCategoryBodySchema = z
  .object({
    name: shortText(100, 'El nombre'),
    slug: slugField('El slug').optional(),
    description: longText(1000, 'La descripción'),
    imageUrl: imageUrlOptional,
    icon: z
      .string()
      .trim()
      .min(1, 'El icono no puede estar vacío')
      .max(50, 'El icono no puede superar 50 caracteres')
      .nullable()
      .optional(),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

/** `PATCH /api/v1/categories/:id`. Exige al menos un campo. */
export const updateCategoryBodySchema = z
  .object({
    name: shortText(100, 'El nombre').optional(),
    slug: slugField('El slug').optional(),
    description: longText(1000, 'La descripción'),
    imageUrl: imageUrlOptional,
    icon: z
      .string()
      .trim()
      .min(1, 'El icono no puede estar vacío')
      .max(50, 'El icono no puede superar 50 caracteres')
      .nullable()
      .optional(),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/**
 * `DELETE /api/v1/categories/:id`.
 *
 * `confirmOrphan` NO aparece en la tabla de body de API.md 7.10, pero SÍ en su
 * tabla de errores: `422 CATEGORY_HAS_PRODUCTS` "si `orphanedProducts > 0` y se
 * omite `confirmOrphan = true`". Sin este campo ese error sería imposible de
 * resolver, así que se admite (ver el informe de desviaciones).
 */
export const deleteCategoryBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(300, 'El motivo no puede superar 300 caracteres')
      .optional(),
    confirmOrphan: z.boolean().default(false),
  })
  .strict();

/** `POST /api/v1/categories/reorder`. Transaccional. */
export const reorderCategoriesBodySchema = z
  .object({
    items: z
      .array(
        z
          .object({
            id: resourceIdField,
            sortOrder: sortOrderField,
          })
          .strict(),
      )
      .min(1, 'Debe enviar al menos una categoría')
      .max(500, 'No se pueden reordenar más de 500 categorías a la vez'),
  })
  .strict();

/** Columnas ordenables de `GET /api/v1/categories` (API.md 7.10). */
export const CATEGORY_SORT_COLUMNS = ['sort_order', 'name', 'created_at'] as const;
export const CATEGORY_SORT_DEFAULT = 'sort_order';

/** `GET|PATCH|DELETE /api/v1/categories/:id`. */
export const categoryIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

// --------------------------------------------------------------------------
// 7.11 Productos: cuerpo
// --------------------------------------------------------------------------

/** Variante creada junto al producto (`POST /products`). */
const inlineVariantSchema = z
  .object({
    name: shortText(60, 'El nombre de la variante'),
    code: z
      .string()
      .trim()
      .max(30, 'El código no puede superar 30 caracteres')
      .nullable()
      .optional(),
    priceDeltaMinor: priceDeltaField.default(0),
    priceMinor: minorField('El precio de la variante').nullable().optional(),
    isDefault: z.boolean().default(false),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

/** Complemento creado junto al producto (`POST /products`). */
const inlineAddonSchema = z
  .object({
    name: shortText(80, 'El nombre del complemento'),
    code: z
      .string()
      .trim()
      .max(30, 'El código no puede superar 30 caracteres')
      .nullable()
      .optional(),
    priceMinor: minorField('El precio del complemento').default(0),
    isMultiple: z.boolean().default(false),
    maxSelect: z
      .number()
      .int('El máximo de selección debe ser un entero')
      .min(1, 'El máximo de selección debe ser al menos 1')
      .max(20, 'El máximo de selección no puede superar 20')
      .nullable()
      .optional(),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

/**
 * `POST /api/v1/products`.
 *
 * `variants` y `addons` opcionales: se crean en la MISMA transacción que el
 * producto (API.md 7.11), de modo que no exista un producto sin su precio por
 * la mitad del alta.
 */
export const createProductBodySchema = z
  .object({
    categoryId: resourceIdField.nullable().optional(),
    sku: shortText(50, 'El SKU'),
    name: shortText(150, 'El nombre'),
    slug: slugField('El slug').optional(),
    shortDescription: longText(200, 'La descripción corta'),
    description: longText(4000, 'La descripción'),
    imageUrl: imageUrlOptional,
    basePriceMinor: minorField('El precio base'),
    promoPriceMinor: minorField('El precio promocional').nullable().optional(),
    promoStartsAt: isoInstantField('El inicio de la promoción').nullable().optional(),
    promoEndsAt: isoInstantField('El fin de la promoción').nullable().optional(),
    taxRateBp: taxRateField,
    trackStock: z.boolean().default(false),
    isFeatured: z.boolean().default(false),
    isAvailable: z.boolean().default(true),
    preparationMinutes: preparationMinutesField,
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().default(true),
    variants: z.array(inlineVariantSchema).max(20, 'Un producto no puede tener más de 20 variantes').optional(),
    addons: z.array(inlineAddonSchema).max(40, 'Un producto no puede tener más de 40 complementos').optional(),
  })
  .strict();

/**
 * `PATCH /api/v1/products/:id`.
 *
 * NO admite `sku` (inmutable en v1, API.md 7.11) ni `isAvailable` (tiene su
 * propio endpoint, `PATCH /:id/availability`) ni `variants`/`addons` (son
 * sub-recursos). Tampoco `categoryId` con `null` explícito se acepta como
 * "quitar categoría": sí se acepta, con `null`, y equivale a dejarla huérfana.
 */
export const updateProductBodySchema = z
  .object({
    categoryId: resourceIdField.nullable().optional(),
    name: shortText(150, 'El nombre').optional(),
    slug: slugField('El slug').optional(),
    shortDescription: longText(200, 'La descripción corta'),
    description: longText(4000, 'La descripción'),
    imageUrl: imageUrlOptional,
    basePriceMinor: minorField('El precio base').optional(),
    promoPriceMinor: minorField('El precio promocional').nullable().optional(),
    promoStartsAt: isoInstantField('El inicio de la promoción').nullable().optional(),
    promoEndsAt: isoInstantField('El fin de la promoción').nullable().optional(),
    taxRateBp: taxRateField,
    trackStock: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    preparationMinutes: preparationMinutesField.optional(),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/**
 * `DELETE /api/v1/products/:id`.
 *
 * El cuerpo es OPCIONAL: `DELETE` no lleva cuerpo y el motivo es facultativo.
 * `.default({})` en vez de `.optional()` para que el tipo inferido sea el objeto
 * y no `object | undefined`: el controller lee `body.reason` sin estrechar.
 */
export const deleteProductBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(300, 'El motivo no puede superar 300 caracteres')
      .optional(),
  })
  .strict()
  .default({});

/** `PATCH /api/v1/products/:id/availability` (BR-PRICE-006). */
export const productAvailabilityBodySchema = z
  .object({
    isAvailable: z.boolean({ error: 'Debe indicar si el producto está disponible' }),
    reason: z
      .string()
      .trim()
      .max(300, 'El motivo no puede superar 300 caracteres')
      .optional(),
  })
  .strict();

/** `PATCH /api/v1/products/:id/active`. */
export const productActiveBodySchema = z
  .object({
    isActive: z.boolean({ error: 'Debe indicar si el producto queda activo' }),
    reason: z
      .string()
      .trim()
      .max(300, 'El motivo no puede superar 300 caracteres')
      .optional(),
  })
  .strict();

/**
 * `POST /api/v1/products/:id/duplicate`.
 *
 * `sku` es OPCIONAL a pesar de que API.md 7.11 lo marca como requerido: si se
 * omite, el service deriva uno único a partir del original con el sufijo
 * `-COPY` y un contador (`-COPY2`, `-COPY3`...) hasta encontrar uno libre. Quien
 * sí lo envía recibe un 409 si está ocupado, igual que en `POST /products`.
 */
export const duplicateProductBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'El nombre no puede estar vacío')
      .max(150, 'El nombre no puede superar 150 caracteres')
      .optional(),
    sku: z
      .string()
      .trim()
      .min(1, 'El SKU no puede estar vacío')
      .max(50, 'El SKU no puede superar 50 caracteres')
      .optional(),
    categoryId: resourceIdField.nullable().optional(),
    copyVariants: z.boolean().default(true),
    copyAddons: z.boolean().default(true),
    copyIngredients: z.boolean().default(true),
    isActive: z.boolean().default(false),
  })
  .strict();

// --------------------------------------------------------------------------
// 7.11 Productos: variantes
// --------------------------------------------------------------------------

/** `POST /api/v1/products/:id/variants`. */
export const createVariantBodySchema = z
  .object({
    name: shortText(60, 'El nombre de la variante'),
    code: z
      .string()
      .trim()
      .max(30, 'El código no puede superar 30 caracteres')
      .nullable()
      .optional(),
    priceDeltaMinor: priceDeltaField.default(0),
    priceMinor: minorField('El precio de la variante').nullable().optional(),
    isDefault: z.boolean().default(false),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

/** `PATCH /api/v1/products/variants/:variantId`. */
export const updateVariantBodySchema = z
  .object({
    name: shortText(60, 'El nombre de la variante').optional(),
    code: z
      .string()
      .trim()
      .max(30, 'El código no puede superar 30 caracteres')
      .nullable()
      .optional(),
    priceDeltaMinor: priceDeltaField.optional(),
    priceMinor: minorField('El precio de la variante').nullable().optional(),
    isDefault: z.boolean().optional(),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

// --------------------------------------------------------------------------
// 7.11 Productos: complementos
// --------------------------------------------------------------------------

/** `POST /api/v1/products/:id/addons`. */
export const createAddonBodySchema = z
  .object({
    name: shortText(80, 'El nombre del complemento'),
    code: z
      .string()
      .trim()
      .max(30, 'El código no puede superar 30 caracteres')
      .nullable()
      .optional(),
    priceMinor: minorField('El precio del complemento').default(0),
    isMultiple: z.boolean().default(false),
    maxSelect: z
      .number()
      .int('El máximo de selección debe ser un entero')
      .min(1, 'El máximo de selección debe ser al menos 1')
      .max(20, 'El máximo de selección no puede superar 20')
      .nullable()
      .optional(),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

/** `PATCH /api/v1/products/addons/:addonId`. */
export const updateAddonBodySchema = z
  .object({
    name: shortText(80, 'El nombre del complemento').optional(),
    code: z
      .string()
      .trim()
      .max(30, 'El código no puede superar 30 caracteres')
      .nullable()
      .optional(),
    priceMinor: minorField('El precio del complemento').optional(),
    isMultiple: z.boolean().optional(),
    maxSelect: z
      .number()
      .int('El máximo de selección debe ser un entero')
      .min(1, 'El máximo de selección debe ser al menos 1')
      .max(20, 'El máximo de selección no puede superar 20')
      .nullable()
      .optional(),
    sortOrder: sortOrderField.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

// --------------------------------------------------------------------------
// 7.11 Productos: receta
// --------------------------------------------------------------------------

/** `POST /api/v1/products/:id/ingredients`. */
export const addProductIngredientBodySchema = z
  .object({
    ingredientId: resourceIdField,
    quantity: z
      .number({ error: 'La cantidad debe ser un número' })
      .positive('La cantidad debe ser mayor que cero')
      .refine((value) => Number.isInteger(value * 1000), {
        message: 'La cantidad admite como máximo 3 decimales',
      }),
    updateStock: z
      .boolean()
      .default(true)
      .describe('Si el insumo no tiene ítem de inventario, se crea con stock 0 y seguimiento activo'),
  })
  .strict();

/** Catálogo de insumos (`GET /api/v1/products/ingredients`). */
export const listIngredientsQuerySchema = buildListQuerySchema({
  q: searchQueryField,
  supplier: z.string().trim().max(150, 'El proveedor es demasiado largo').optional(),
  isActive: booleanQueryField.optional(),
  includeInactive: booleanQueryField.optional(),
  unit: z.enum(InventoryUnit).optional(),
});

/** `POST /api/v1/products/ingredients`. */
export const createIngredientBodySchema = z
  .object({
    name: shortText(150, 'El nombre del insumo'),
    unit: z.enum(InventoryUnit).default(InventoryUnit.UND),
    costMinor: minorField('El costo del insumo').default(0),
    supplier: z
      .string()
      .trim()
      .min(1, 'El proveedor no puede estar vacío')
      .max(150, 'El proveedor no puede superar 150 caracteres')
      .nullable()
      .optional(),
    isActive: z.boolean().default(true),
  })
  .strict();

/** `PATCH /api/v1/products/ingredients/:ingredientId`. */
export const updateIngredientBodySchema = z
  .object({
    name: shortText(150, 'El nombre del insumo').optional(),
    unit: z.enum(InventoryUnit).optional(),
    costMinor: minorField('El costo del insumo').optional(),
    supplier: z
      .string()
      .trim()
      .min(1, 'El proveedor no puede estar vacío')
      .max(150, 'El proveedor no puede superar 150 caracteres')
      .nullable()
      .optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** `DELETE /api/v1/products/ingredients/:ingredientId`. Cuerpo opcional. */
export const deleteIngredientBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .max(300, 'El motivo no puede superar 300 caracteres')
      .optional(),
  })
  .strict()
  .default({});

// --------------------------------------------------------------------------
// 7.11 Productos: query y params
// --------------------------------------------------------------------------

/**
 * `GET /api/v1/products` (API.md 7.11).
 *
 * `fields=basic` devuelve `ProductBasic[]` (10 columnas) sin variantes ni
 * complementos: es la pantalla del POS con el catálogo grande, y cargar el
 * árbol entero para pintar una rejilla es lo que hace que esa pantalla tarde.
 */
export const listProductsQuerySchema = buildListQuerySchema({
  categoryId: resourceIdField.optional(),
  q: searchQueryField,
  featured: booleanQueryField.optional(),
  available: booleanQueryField.optional(),
  trackStock: booleanQueryField.optional(),
  isActive: booleanQueryField.optional(),
  includeInactive: booleanQueryField.optional(),
  minPrice: minorField('El precio mínimo').optional(),
  maxPrice: minorField('El precio máximo').optional(),
  inStockOnly: booleanQueryField.optional(),
  fields: z.enum(['basic', 'full']).default('full'),
});

/** Columnas ordenables de `GET /api/v1/products` (API.md 7.11). */
export const PRODUCT_SORT_COLUMNS = [
  'sort_order',
  'name',
  'base_price_minor',
  'created_at',
  'preparation_minutes',
] as const;
export const PRODUCT_SORT_DEFAULT = 'sort_order';

/** Columnas ordenables del catálogo de insumos. */
export const INGREDIENT_SORT_COLUMNS = ['name', 'created_at', 'cost_minor'] as const;
export const INGREDIENT_SORT_DEFAULT = 'name';

/**
 * `GET /api/v1/menu`. Filtros del menú público.
 *
 * El menú NO se pagina: es un documento pequeño y completo que el cliente móvil
 * cachea entero, y paginarlo obligaría a N peticiones para pintar una carta. Se
 * acota con `categoryId`, `q` y `featured`.
 */
export const menuQuerySchema = z
  .object({
    categoryId: resourceIdField.optional(),
    q: searchQueryField,
    featured: booleanQueryField.optional(),
  })
  .strict();

/** `GET /api/v1/menu/:productId`. */
export const menuProductParamsSchema = z
  .object({
    productId: resourceIdField,
  })
  .strict();

/** `GET|PATCH|DELETE /api/v1/products/:id` y sus acciones. */
export const productIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** `PATCH|DELETE /api/v1/products/variants/:variantId`. */
export const variantIdParamsSchema = z
  .object({
    variantId: resourceIdField,
  })
  .strict();

/** `PATCH|DELETE /api/v1/products/addons/:addonId`. */
export const addonIdParamsSchema = z
  .object({
    addonId: resourceIdField,
  })
  .strict();

/** `DELETE /api/v1/products/:id/ingredients/:ingredientId`. */
export const productIngredientParamsSchema = z
  .object({
    id: resourceIdField,
    ingredientId: resourceIdField,
  })
  .strict();

/** `GET|PATCH|DELETE /api/v1/products/ingredients/:ingredientId`. */
export const ingredientIdParamsSchema = z
  .object({
    ingredientId: resourceIdField,
  })
  .strict();

// --------------------------------------------------------------------------
// Tipos inferidos, para los controllers
// --------------------------------------------------------------------------

export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
export type CreateCategoryBody = z.infer<typeof createCategoryBodySchema>;
export type UpdateCategoryBody = z.infer<typeof updateCategoryBodySchema>;
export type DeleteCategoryBody = z.infer<typeof deleteCategoryBodySchema>;
export type ReorderCategoriesBody = z.infer<typeof reorderCategoriesBodySchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
export type CreateProductBody = z.infer<typeof createProductBodySchema>;
export type UpdateProductBody = z.infer<typeof updateProductBodySchema>;
export type DeleteProductBody = z.infer<typeof deleteProductBodySchema>;
export type ProductAvailabilityBody = z.infer<typeof productAvailabilityBodySchema>;
export type ProductActiveBody = z.infer<typeof productActiveBodySchema>;
export type DuplicateProductBody = z.infer<typeof duplicateProductBodySchema>;
export type CreateVariantBody = z.infer<typeof createVariantBodySchema>;
export type UpdateVariantBody = z.infer<typeof updateVariantBodySchema>;
export type CreateAddonBody = z.infer<typeof createAddonBodySchema>;
export type UpdateAddonBody = z.infer<typeof updateAddonBodySchema>;
export type AddProductIngredientBody = z.infer<typeof addProductIngredientBodySchema>;
export type ListIngredientsQuery = z.infer<typeof listIngredientsQuerySchema>;
export type CreateIngredientBody = z.infer<typeof createIngredientBodySchema>;
export type UpdateIngredientBody = z.infer<typeof updateIngredientBodySchema>;
export type DeleteIngredientBody = z.infer<typeof deleteIngredientBodySchema>;
export type MenuQuery = z.infer<typeof menuQuerySchema>;
