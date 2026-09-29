/**
 * Esquemas zod del módulo `discounts` (API.md 7.14).
 *
 * TODOS son `.strict()`: un campo desconocido es `400 VALIDATION_ERROR` con
 * `code: 'UNKNOWN_FIELD'`, no se ignora en silencio (API.md 1).
 *
 * ============================ DÓNDE VIVE QUÉ ============================
 *  - Aquí vive la FORMA: longitudes, tipos, formatos y rangos obvios.
 *  - Las REGLAS que necesitan conocer el resto de los datos viven en el
 *    service: que un `PERCENT` de más del 50 % exija `max_discount_minor`
 *    (BR-DISC-008), que la categoría exista (CHECK de la BD), que el código no
 *    esté repetido (`UNIQUE`) o que la ventana de vigencia tenga sentido.
 */
import { z } from 'zod';

import { DiscountAppliesTo, DiscountType } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField, searchQueryField } from '../../shared/validation/index.js';

/**
 * Booleanos de query. Acepta `true`/`false` y las cadenas `"true"`/`"false"`,
 * porque en una URL todo llega como texto.
 */
const booleanQueryField = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Importe en centavos: entero y no negativo (BR-MONEY-001). */
const minorField = (label: string, min = 0, max = 100_000_000) =>
  z
    .number({ error: `${label} debe ser un número entero en centavos` })
    .int(`${label} debe ser un entero en centavos`)
    .min(min, min === 1 ? `${label} debe ser mayor que cero` : `${label} no puede ser negativo`)
    .max(max, `${label} es un importe demasiado alto`);

/** Importe nullable (para `PATCH`, donde `null` limpia el campo). */
const nullableMinorField = (label: string) =>
  z.union([minorField(label), z.null()], { error: `${label} debe ser un entero en centavos o null` });

/** Texto acotado y no vacío. */
const shortText = (max: number, label: string) =>
  z
    .string({ error: `${label} es obligatorio` })
    .trim()
    .min(1, `${label} no puede estar vacío`)
    .max(max, `${label} no puede superar ${max} caracteres`);

/** Texto largo opcional. */
const longText = (max: number, label: string) =>
  z
    .string({ error: `${label} debe ser texto` })
    .trim()
    .max(max, `${label} no puede superar ${max} caracteres`)
    .nullable()
    .optional();

/** Instante ISO-8601, normalizado a UTC por el service. */
const isoInstantField = (label: string) =>
  z
    .string({ error: `${label} es obligatorio` })
    .datetime({ offset: true, message: `${label} debe ser un instante ISO-8601` });

/**
 * Código de descuento: `[A-Z0-9_-]`, 3 a 32 caracteres.
 *
 * El patrón NO admite minúsculas a propósito: BR-DISC-007 exige comparar con
 * `UPPER(TRIM(input))` y el CHECK de la tabla exige que el valor almacenado sea
 * `upper(trim(code))`. Aceptar aquí minúsculas y normalizarlas en el service
 * daría un mensaje de error peor que rechazarlas en el borde, así que el
 * service normaliza la entrada y este patrón documenta el formato CANÓNICO.
 */
const DISCOUNT_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

/** Límite por encima del cual un `PERCENT` exige `maxDiscountMinor` (BR-DISC-008). */
const PERCENT_REQUIRES_CAP_ABOVE = 5_000;

// --------------------------------------------------------------------------
// Orden
// --------------------------------------------------------------------------

/** Columnas ordenables de `GET /api/v1/discounts`, para el allowlist. */
export const DISCOUNTS_SORT_COLUMNS = ['created_at', 'code', 'used_count', 'ends_at'] as const;

/** Orden por defecto: los más recientes primero. */
export const DISCOUNTS_SORT_DEFAULT = 'created_at';

// --------------------------------------------------------------------------
// Listado y detalle
// --------------------------------------------------------------------------

/** `GET /api/v1/discounts` (API.md 7.14). */
export const listDiscountsQuerySchema = buildListQuerySchema({
  isActive: booleanQueryField.optional(),
  isExpired: booleanQueryField.optional(),
  type: z.enum(DiscountType).optional(),
  appliesTo: z.enum(DiscountAppliesTo).optional(),
  includeInactive: booleanQueryField.optional(),
  q: searchQueryField,
});

/** `GET /api/v1/discounts/mine`. */
export const listMyDiscountsQuerySchema = buildListQuerySchema({
  includeExpired: booleanQueryField.optional(),
  includeUsed: booleanQueryField.optional(),
});

/** `GET /api/v1/discounts/:id`. */
export const discountIdParamsSchema = z.object({ id: resourceIdField }).strict();

/** Tipos inferidos que consumen los controllers. */
export type ListDiscountsQuery = z.infer<typeof listDiscountsQuerySchema>;
export type ListMyDiscountsQuery = z.infer<typeof listMyDiscountsQuerySchema>;

/** Forma del body de `POST /api/v1/discounts`. */
const discountFields = {
  code: z
    .string({ error: 'El código del descuento es obligatorio' })
    .trim()
    .min(3, 'El código debe tener al menos 3 caracteres')
    .max(32, 'El código no puede superar 32 caracteres')
    .regex(DISCOUNT_CODE_PATTERN, 'El código sólo admite letras mayúsculas, dígitos, guion y guion bajo'),
  name: shortText(100, 'El nombre'),
  description: longText(500, 'La descripción'),
  /**
   * `value`: basis points si `PERCENT` (2000 = 20 %), centavos si `FIXED`.
   * El tope de 10000 bp es exactamente el CHECK `ck_discounts_percent_bp`, y el
   * `superRefine` de abajo lo repite para poder dar un mensaje en español.
   */
  value: z
    .number({ error: 'El valor del descuento debe ser un número entero' })
    .int('El valor del descuento debe ser un entero')
    .min(0, 'El valor del descuento no puede ser negativo')
    .max(10_000_000, 'El valor del descuento es demasiado alto'),
  type: z.enum(DiscountType, { error: 'El tipo de descuento debe ser PERCENT o FIXED' }),
  minOrderMinor: nullableMinorField('El pedido mínimo').optional(),
  maxDiscountMinor: nullableMinorField('El descuento máximo').optional(),
  /**
   * Sin `.default()` a propósito: en zod 4, `.optional()` sobre un campo que tiene
   * `.default()` sigue INYECTANDO el valor por defecto, y un `PATCH {}` acabaría
   * cambiando `appliesTo` a `ALL` sin que nadie lo pidiera. El default se aplica
   * sólo en el esquema de alta.
   */
  appliesTo: z.enum(DiscountAppliesTo).optional(),
  appliesCategoryId: resourceIdField.nullable().optional(),
  appliesProductId: resourceIdField.nullable().optional(),
  usageLimit: z
    .number()
    .int('El límite de usos debe ser un entero')
    .positive('El límite de usos debe ser mayor que cero')
    .nullable()
    .optional(),
  usageLimitPerCustomer: z
    .number()
    .int('El límite de usos por cliente debe ser un entero')
    .positive('El límite de usos por cliente debe ser mayor que cero')
    .nullable()
    .optional(),
  startsAt: isoInstantField('El inicio de vigencia').nullable().optional(),
  endsAt: isoInstantField('El fin de vigencia').nullable().optional(),
  isActive: z.boolean().optional(),
  stackable: z.boolean().optional(),
} as const;

/** Los defaults del ALTA, que el `PATCH` no debe heredar. */
const DISCOUNT_CREATE_DEFAULTS = {
  appliesTo: DiscountAppliesTo.ALL,
  isActive: true,
  stackable: false,
} as const;

/**
 * `POST /api/v1/discounts`.
 *
 * Tres reglas se comprueban AQUÍ porque son PURAMENTE de forma y no necesitan
 * nada de la base de datos (API.md 7.14 las lista como `400`):
 *  - `PERCENT` no puede superar 10000 bp (100 %) -> `422 PERCENT_VALUE_OUT_OF_RANGE`.
 *  - Un `PERCENT` por encima del 50 % exige `maxDiscountMinor` (BR-DISC-008).
 *  - La ventana `startsAt`/`endsAt` no puede estar invertida.
 */
export const createDiscountBodySchema = z
  .object({
    ...discountFields,
    appliesTo: discountFields.appliesTo.default(DISCOUNT_CREATE_DEFAULTS.appliesTo),
    isActive: z.boolean().default(DISCOUNT_CREATE_DEFAULTS.isActive),
    stackable: z.boolean().default(DISCOUNT_CREATE_DEFAULTS.stackable),
  })
  .strict()
  .superRefine((value, ctx) => {
    // El tope de 100 % NO se comprueba aquí a propósito: depende de `type`, y
    // API.md 7.14 lo clasifica como `422 PERCENT_VALUE_OUT_OF_RANGE`, no como un
    // `400` de forma. Lo resuelve `DiscountsService.assertShape`, que además
    // puede citar la regla de `DESIGN.md`.
    if (
      value.type === DiscountType.PERCENT &&
      value.value > PERCENT_REQUIRES_CAP_ABOVE &&
      (value.maxDiscountMinor === undefined || value.maxDiscountMinor === null)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDiscountMinor'],
        message:
          'Un descuento porcentual de más del 50 % necesita `maxDiscountMinor` para proteger el margen',
      });
    }
    if (value.startsAt !== undefined && value.startsAt !== null && value.endsAt !== undefined && value.endsAt !== null) {
      if (Date.parse(value.endsAt) <= Date.parse(value.startsAt)) {
        ctx.addIssue({
          code: 'custom',
          path: ['endsAt'],
          message: 'La fecha de fin debe ser posterior a la de inicio',
        });
      }
    }
  });

/**
 * `PATCH /api/v1/discounts/:id`.
 *
 * Todos los campos son opcionales, pero se exige al menos uno: un PATCH vacío
 * no es una operación y responder 200 sin escribir nada esconde un error del
 * cliente.
 */
export const updateDiscountBodySchema = z
  .object({
    code: discountFields.code.optional(),
    name: discountFields.name.optional(),
    description: discountFields.description,
    type: discountFields.type.optional(),
    value: discountFields.value.optional(),
    minOrderMinor: discountFields.minOrderMinor,
    maxDiscountMinor: discountFields.maxDiscountMinor,
    appliesTo: discountFields.appliesTo.optional(),
    appliesCategoryId: discountFields.appliesCategoryId,
    appliesProductId: discountFields.appliesProductId,
    usageLimit: discountFields.usageLimit,
    usageLimitPerCustomer: discountFields.usageLimitPerCustomer,
    startsAt: discountFields.startsAt,
    endsAt: discountFields.endsAt,
    isActive: discountFields.isActive,
    stackable: discountFields.stackable,
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    { message: 'Indique al menos un campo para actualizar' },
  );

/** Tipos inferidos del cuerpo de alta y de edición. */
export type CreateDiscountBody = z.infer<typeof createDiscountBodySchema>;
export type UpdateDiscountBody = z.infer<typeof updateDiscountBodySchema>;

/**
 * `POST /api/v1/discounts/validate` — previsualización (API.md 7.14).
 *
 * Exige un contexto para cotizar: o el subtotal que el cliente ya conoce, o el
 * id del pedido del que el servidor lee el subtotal REAL (BR-DISC-001). Sin
 * ninguno de los dos, `400 MISSING_VALIDATION_CONTEXT`: cotizar un cupón sin
 * base no significa nada.
 */
export const validateDiscountBodySchema = z
  .object({
    code: z
      .string({ error: 'El código del descuento es obligatorio' })
      .trim()
      .min(3, 'El código debe tener al menos 3 caracteres')
      .max(32, 'El código no puede superar 32 caracteres'),
    subtotalMinor: minorField('El subtotal').optional(),
    orderId: resourceIdField.optional(),
    /**
     * Líneas del pedido, necesarias para `appliesTo != ALL`. El `unitPriceMinor`
     * lo acepta el cliente como COTIZACIÓN, nunca comototal: el servidor
     * recalcula siempre (BR-DISC-001).
     */
    items: z
      .array(
        z
          .object({
            productId: resourceIdField,
            categoryId: resourceIdField.optional(),
            quantity: z
              .number()
              .positive('La cantidad debe ser mayor que cero')
              .max(10_000, 'La cantidad es demasiado alta'),
            unitPriceMinor: minorField('El precio unitario'),
          })
          .strict(),
      )
      .max(200, 'No se admiten más de 200 líneas')
      .optional(),
    /** Para validar `usage_limit_per_customer`. */
    customerId: resourceIdField.nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.subtotalMinor !== undefined || value.orderId !== undefined,
    {
      message: 'Indique `subtotalMinor` o `orderId` para poder cotizar el descuento',
      path: ['subtotalMinor'],
    },
  );

/** Tipo inferido del body de validación. */
export type ValidateDiscountBody = z.infer<typeof validateDiscountBodySchema>;
