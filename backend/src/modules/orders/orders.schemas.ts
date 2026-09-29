/**
 * Esquemas zod del módulo `orders` (API.md 7.12).
 *
 * TODOS son `.strict()`. Eso no es un detalle de estilo: es la ÚNICA razón por la
 * que el cliente no puede mandar precios (BR-ORDER-014). `POST /orders` NO tiene
 * `unitPriceMinor`, ni `subtotalMinor`, ni `taxMinor`, ni `totalMinor` en su
 * esquema, así que un body con cualquiera de ellos es `400 VALIDATION_ERROR` con
 * `code: 'UNKNOWN_FIELD'` en vez de que el servidor lo ignore en silencio. La
 * aritmética la hace el servidor y sólo el servidor (BR-PRICE-008).
 *
 * ============================ DÓNDE VIVE QUÉ ============================
 *  - Aquí vive la FORMA: longitudes, tipos, formatos y rangos obvios.
 *  - Las REGLAS que necesitan conocer el catálogo, el inventario o el estado del
 *    pedido viven en el service: disponibilidad del producto (BR-PRICE-006),
 *    pertenencia de la variante (BR-PRICE-011/012), stock (BR-INV-002),
 *    transición de estado (DESIGN.md 6.1) o inmutabilidad (BR-ORDER-017).
 */
import { z } from 'zod';

import { OrderChannel, OrderItemStatus, OrderStatus, OrderType } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField, searchQueryField } from '../../shared/validation/index.js';

// --------------------------------------------------------------------------
// Atomos reutilizables
// --------------------------------------------------------------------------

/** Booleanos de query. Acepta `true`/`false` y las cadenas `"true"`/`"false"`. */
const booleanQueryField = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Texto acotado y no vacío. */
const shortText = (max: number, label: string) =>
  z
    .string({ error: `${label} es obligatorio` })
    .trim()
    .min(1, `${label} no puede estar vacío`)
    .max(max, `${label} no puede superar ${max} caracteres`);

/**
 * Cantidad de producto: `> 0` y con 3 decimales como máximo.
 *
 * Puede ser fraccional porque una cafetería vende café por peso (BR-MONEY-001
 * sólo prohíbe `REAL` para IMPORTES, no para cantidades).
 */
const quantityField = z
  .number({ error: 'La cantidad debe ser un número' })
  .positive('La cantidad debe ser mayor que cero')
  .max(10_000, 'La cantidad es demasiado alta')
  .refine((value) => Math.round(value * 1000) === value * 1000, {
    message: 'La cantidad admite como máximo 3 decimales',
  });

/** Complemento de una línea, con su cantidad. */
const addonSchema = z
  .object({
    productAddonId: resourceIdField,
    quantity: z
      .number()
      .int('La cantidad del complemento debe ser un número entero')
      .min(1, 'La cantidad del complemento debe ser al menos 1')
      .max(20, 'La cantidad del complemento no puede superar 20'),
  })
  .strict();

/**
 * Una línea de pedido.
 *
 * ============================== LO QUE NO ESTÁ ===========================
 * Ni `unitPriceMinor`, ni `unitPrice`, ni `price`: el precio lo resuelve el
 * servidor con la prioridad `promo > variante > base + delta > base`
 * (BR-PRICE-001). Lo único que viaja es QUÉ se pide y CUÁNTO.
 */
const orderItemSchema = z
  .object({
    productId: resourceIdField,
    variantId: resourceIdField.optional(),
    quantity: quantityField,
    addons: z.array(addonSchema).max(30, 'Una línea admite como máximo 30 complementos').optional(),
    notes: shortText(300, 'La nota de la línea').optional(),
    status: z.enum(OrderItemStatus).optional(),
    preparationMinutesOverride: z
      .number()
      .int('Los minutos de preparación deben ser un número entero')
      .min(0, 'Los minutos de preparación no pueden ser negativos')
      .max(240, 'Los minutos de preparación no pueden superar 240')
      .optional(),
  })
  .strict();

/** Código de cupón: `[A-Z0-9_-]`, 3 a 32 caracteres (BR-DISC-007). */
const COUPON_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/** Instante ISO-8601, usado en el filtro `format` del recibo. */
const isoInstantQuery = z
  .string()
  .datetime({ offset: true, message: 'Debe ser un instante ISO-8601' })
  .optional();

// --------------------------------------------------------------------------
// Listados
// --------------------------------------------------------------------------

/** `GET /api/v1/orders` (API.md 7.12). */
export const listOrdersQuerySchema = buildListQuerySchema({
  status: z.enum(OrderStatus).optional(),
  type: z.enum(OrderType).optional(),
  chairId: resourceIdField.optional(),
  locationId: resourceIdField.optional(),
  // `customerId` se IGNORA para un CUSTOMER: el service lo fuerza a su propio id.
  customerId: resourceIdField.optional(),
  createdBy: resourceIdField.optional(),
  orderNumber: shortText(32, 'El número de pedido').optional(),
  q: searchQueryField,
  hasUnpaidBalance: booleanQueryField.optional(),
  from: isoInstantQuery,
  to: isoInstantQuery,
});

/** Columnas ordenables de `GET /api/v1/orders`. */
export const ORDERS_SORT_COLUMNS = [
  'created_at',
  'placed_at',
  'total_minor',
  'order_number',
  'completed_at',
] as const;

/** Orden por defecto: los más recientes primero, como el resto de listados. */
export const ORDERS_SORT_DEFAULT = 'created_at';

// --------------------------------------------------------------------------
// Params
// --------------------------------------------------------------------------

/** `GET|PATCH|DELETE /api/v1/orders/:id`. */
export const orderIdParamsSchema = z.object({ id: resourceIdField }).strict();

/** `PATCH|DELETE /api/v1/orders/items/:itemId`. */
export const orderItemParamsSchema = z.object({ itemId: resourceIdField }).strict();

/** `GET /api/v1/orders/:id/history`. */
export const orderHistoryQuerySchema = buildListQuerySchema({});

// --------------------------------------------------------------------------
// Creación
// --------------------------------------------------------------------------

/**
 * Pago EN EL MISMO CUERPO que el pedido.
 *
 * No es una desviación de API.md sino la extensión natural del paso 4 de
 * DESIGN.md 8.5: si el cajero cobra al mismo tiempo que registra el pedido, el
 * cobro y la venta deben ser UN commit. Si venían en dos peticiones y la segunda
 * fallara, quedaría un pedido servido y no cobrado, que es el peor estado
 * posible en una caja.
 *
 * El esquema es `.strict()` y aquí NO hay campo `method`: el único método posible
 * en este bloque es `CASH`, porque un cobro con datáfono se registra con
 * `POST /api/v1/payments` (que sí admite `CARD`). Decisión del cliente: todo se
 * cobra en el local, sin pasarela, así que el efectivo y la tarjeta son las dos
 * únicas vías y ninguna de ellas sale a la red.
 *
 * `receivedMinor` puede ser MAYOR que el total: la diferencia es CAMBIO y se
 * devuelve en la respuesta, nunca se guarda como pago (BR-MONEY-007/008). Menor
 * que el total es `422`.
 */
const embeddedCashPaymentSchema = z
  .object({
    receivedMinor: z
      .number()
      .int('El efectivo recibido debe ser un entero en centavos')
      .positive('El efectivo recibido debe ser mayor que cero'),
    /** Referencia que anota el cajero (nº de recibo, etc.). Máx. 100. */
    referenceNumber: shortText(100, 'La referencia').optional(),
    receiptNumber: shortText(50, 'El número de recibo').optional(),
    notes: shortText(300, 'La nota del pago').optional(),
  })
  .strict();

/**
 * `POST /api/v1/orders` (API.md 7.12).
 *
 * `items` es obligatorio (aunque pueda ser `[]` con `place = false`, BR-ORDER-002
 * y BR-ORDER-007). Los campos de total NO existen en el esquema: mandarlos es un
 * `400` con `UNKNOWN_FIELD`, que es la respuesta honesta a "he calculado mal
 * vuestro total".
 */
export const createOrderBodySchema = z
  .object({
    type: z.enum(OrderType).default(OrderType.TAKEAWAY),
    channel: z.enum(OrderChannel).default(OrderChannel.POS),
    /**
     * Cliente del pedido. Un `CUSTOMER` queda SIEMPRE atado a su propio id
     * (BR-SEC-008): el service ignora este campo si el actor no es de la casa.
     */
    customerId: resourceIdField.nullable().optional(),
    chairId: resourceIdField.nullable().optional(),
    reservationId: resourceIdField.nullable().optional(),
    rentalId: resourceIdField.nullable().optional(),
    locationId: resourceIdField.nullable().optional(),
    tableLabel: shortText(50, 'La etiqueta de mesa').optional(),
    /**
     * Líneas del pedido. Con default `[]` porque un pedido `CHAIR_RENTAL` no lleva
     * líneas de producto (BR-ORDER-012) y obligar al cliente a mandar un array
     * vacío para decir "ninguna" sería una fricción sin información detrás.
     *
     * "Al menos una línea" NO se exige aquí: depende del `type` y del `place`, así
     * que lo decide el service, que es donde se sabe (`422 EMPTY_ORDER`).
     */
    items: z.array(orderItemSchema).max(100, 'Un pedido admite como máximo 100 líneas').default([]),
    couponCode: z
      .string()
      .trim()
      .min(3, 'El código de cupón debe tener al menos 3 caracteres')
      .max(32, 'El código de cupón no puede superar 32 caracteres')
      .regex(COUPON_CODE_PATTERN, 'El código de cupón sólo admite letras, dígitos, guion y guion bajo')
      .optional(),
    notes: shortText(500, 'La nota interna').optional(),
    customerNotes: shortText(500, 'La nota del cliente').optional(),
    /** `false` deja el pedido en `DRAFT` (BR-ORDER-002). */
    place: z.boolean().default(true),
    /**
     * Cobro en efectivo en el mismo commit. Opcional: un pedido sin este campo
     * se queda con el saldo pendiente y se cobra después con
     * `POST /api/v1/payments`.
     */
    payment: embeddedCashPaymentSchema.optional(),
  })
  .strict();

/** Tipo inferido del body de alta. */
export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;

/**
 * `POST /api/v1/orders/:id/items` — admite varias líneas en una sola llamada.
 *
 * El cuerpo es `{ items: [...] }` y no un array desnudo: un array en el cuerpo es
 * ambiguo con un PATCH y muchos clientes lo serializan mal.
 */
export const addOrderItemsBodySchema = z
  .object({
    items: z.array(orderItemSchema).min(1, 'Indique al menos una línea').max(100),
  })
  .strict();

/** Tipo inferido de una línea de pedido. */
export type OrderItemInput = z.infer<typeof orderItemSchema>;

/** Tipo inferido del body de alta de líneas. */
export type AddOrderItemsBody = z.infer<typeof addOrderItemsBodySchema>;

/** Tipo inferido de la query de listado. */
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

// --------------------------------------------------------------------------
// Edición
// --------------------------------------------------------------------------

/**
 * `PATCH /api/v1/orders/:id` (API.md 7.12).
 *
 * En un pedido `COMPLETED`, `CANCELLED` o `REFUNDED` sólo se admite un body con
 * `notes` y NADA más (BR-ORDER-017). Esa condición depende del ESTADO, así que
 * no puede expresarse en zod: la comprueba el service, que es donde se lee el
 * pedido. Aquí sólo se garantiza la forma.
 */
export const updateOrderBodySchema = z
  .object({
    notes: shortText(500, 'La nota interna').optional(),
    customerNotes: shortText(500, 'La nota del cliente').optional(),
    tableLabel: shortText(50, 'La etiqueta de mesa').nullable().optional(),
    locationId: resourceIdField.nullable().optional(),
    /** `null` quita el cupón (sólo en `DRAFT`/`PENDING`, BR-ORDER-020). */
    couponCode: z
      .string()
      .trim()
      .min(3, 'El código de cupón debe tener al menos 3 caracteres')
      .max(32, 'El código de cupón no puede superar 32 caracteres')
      .regex(COUPON_CODE_PATTERN, 'El código de cupón sólo admite letras, dígitos, guion y guion bajo')
      .nullable()
      .optional(),
    /** Reemplaza el conjunto completo de líneas. `[]` deja el pedido vacío. */
    items: z.array(orderItemSchema).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Indique al menos un campo para actualizar',
  });

/** Tipo inferido del body de edición. */
export type UpdateOrderBody = z.infer<typeof updateOrderBodySchema>;

/** `PATCH /api/v1/orders/items/:itemId`. */
export const updateOrderItemBodySchema = z
  .object({
    quantity: quantityField.optional(),
    notes: shortText(300, 'La nota de la línea').nullable().optional(),
    status: z.enum(OrderItemStatus).optional(),
    /** Reemplaza el conjunto de complementos y recalcula el precio unitario. */
    addons: z.array(addonSchema).max(30).optional(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Indique al menos un campo para actualizar',
  });

/** Tipo inferido del body de edición de línea. */
export type UpdateOrderItemBody = z.infer<typeof updateOrderItemBodySchema>;

/** `DELETE /api/v1/orders/items/:itemId`. */
export const removeOrderItemBodySchema = z
  .object({ reason: shortText(300, 'El motivo').optional() })
  .strict();

// --------------------------------------------------------------------------
// Acciones
// --------------------------------------------------------------------------

/**
 * `POST /api/v1/orders/:id/status` (API.md 7.12).
 *
 * `reason` es obligatorio cuando el destino es `CANCELLED` o `REFUNDED`: el
 * CHECK `ck_order_history_reason` de la base de datos lo exige, y validarlo aquí
 * convierte un 500 del driver en un 400 con el nombre del campo.
 */
export const changeOrderStatusBodySchema = z
  .object({
    toStatus: z.enum(OrderStatus, { error: 'El estado de destino no es válido' }),
    reason: shortText(300, 'El motivo').optional(),
    /** PIN de cajero (4-6 dígitos) para `DELIVERING` o `COMPLETED`. */
    pin: z
      .string()
      .regex(/^\d{4,6}$/, 'El PIN debe tener entre 4 y 6 dígitos')
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const needsReason = value.toStatus === OrderStatus.CANCELLED || value.toStatus === OrderStatus.REFUNDED;
    if (needsReason && value.reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'El motivo es obligatorio para cancelar o reembolsar un pedido',
      });
    }
  });

/** Tipo inferido del body de transición. */
export type ChangeOrderStatusBody = z.infer<typeof changeOrderStatusBodySchema>;

/** `POST /api/v1/orders/:id/confirm` (API.md 7.12). */
export const confirmOrderBodySchema = z
  .object({
    /** Reserva el saldo pendiente: no cobra, deja el pedido `CONFIRMED`. */
    reservePayment: z.boolean().default(false),
    notes: shortText(500, 'La nota interna').optional(),
  })
  .strict();

/** Tipo inferido del body de confirmación. */
export type ConfirmOrderBody = z.infer<typeof confirmOrderBodySchema>;

/**
 * `POST /api/v1/orders/:id/cancel` (API.md 7.12).
 *
 * `reason` es obligatorio (2-300 caracteres) y sin él el CHECK de la base de
 * datos rechazaría la escritura del historial.
 */
export const cancelOrderBodySchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(2, 'El motivo debe tener al menos 2 caracteres')
      .max(300, 'El motivo no puede superar 300 caracteres'),
    /** `true` (por defecto): si hubo pago, reembolsa en vez de cancelar. */
    refundIfPaid: z.boolean().default(true),
    notifyCustomer: z.boolean().default(true),
  })
  .strict();

/** Tipo inferido del body de cancelación. */
export type CancelOrderBody = z.infer<typeof cancelOrderBodySchema>;

/** `POST /api/v1/orders/:id/assign-chair` (API.md 7.12). */
export const assignChairBodySchema = z.object({ chairId: resourceIdField }).strict();

/** `GET /api/v1/orders/:id/receipt` (API.md 7.12). */
export const orderReceiptQuerySchema = z
  .object({ format: z.enum(['json']).default('json') })
  .strict();
