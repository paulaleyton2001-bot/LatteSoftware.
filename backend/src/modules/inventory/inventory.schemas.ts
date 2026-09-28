/**
 * Esquemas zod del módulo `inventory` (API.md 7.15).
 *
 * Todos `.strict()` (API.md 1). Las reglas que necesitan conocer el estado
 * actual —el signo del movimiento según su tipo, el stock negativo según
 * `businesses.allow_negative_stock`— NO están aquí: las resuelve el service.
 */
import { z } from 'zod';

import { InventoryReferenceType, InventoryUnit, MovementType } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField, searchQueryField } from '../../shared/validation/index.js';
import { StockAlertSeverity } from './inventory.types.js';

/** Booleanos de query: `true`/`false` o su forma textual. */
const booleanQueryField = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Cantidad de stock: fraccional permitida, pero nunca 0 (CHECK de la tabla). */
const quantityField = (label: string) =>
  z
    .number({ error: `${label} debe ser un número` })
    .finite(`${label} debe ser un número finito`)
    .refine((value) => value !== 0, { message: `${label} no puede ser cero` });

/** Stock inicial o saldo objetivo: no negativo (API.md 7.15). */
const stockField = (label: string) =>
  z
    .number({ error: `${label} debe ser un número` })
    .finite(`${label} debe ser un número finito`)
    .min(0, `${label} no puede ser negativo`);

/** Importe en centavos, entero y no negativo. */
const minorField = (label: string) =>
  z
    .number({ error: `${label} debe ser un número entero en centavos` })
    .int(`${label} debe ser un entero en centavos`)
    .min(0, `${label} no puede ser negativo`);

/** `reason` de los ajustes y las bajas: 2..300 caracteres (API.md 7.15). */
const reasonField = z
  .string()
  .trim()
  .min(2, 'El motivo debe tener al menos 2 caracteres')
  .max(300, 'El motivo no puede superar 300 caracteres');

/** `GET /api/v1/inventory/items`. */
export const listInventoryItemsQuerySchema = buildListQuerySchema({
  q: searchQueryField,
  productId: resourceIdField.optional(),
  ingredientId: resourceIdField.optional(),
  supplier: z.string().trim().max(150, 'El proveedor es demasiado largo').optional(),
  locationStorage: z.string().trim().max(100, 'La ubicación es demasiado larga').optional(),
  isTracked: booleanQueryField.optional(),
  isLowStock: booleanQueryField.optional(),
  includeInactive: booleanQueryField.optional(),
});

/** Columnas ordenables de `GET /inventory/items`. */
export const INVENTORY_ITEM_SORT_COLUMNS = ['name', 'current_stock', 'updated_at', 'cost_minor'] as const;
export const INVENTORY_ITEM_SORT_DEFAULT = 'name';

/**
 * `POST /api/v1/inventory/items`.
 *
 * Exactamente uno de `productId` o `ingredientId` (BR-INV-008, también un CHECK
 * en la tabla). La regla la aplica el service con 422
 * `INVENTORY_SOURCE_REQUIRED`, no un `refine` de zod, porque el código de error
 * del contrato es de regla de negocio, no de validación de forma.
 */
export const createInventoryItemBodySchema = z
  .object({
    productId: resourceIdField.nullable().optional(),
    ingredientId: resourceIdField.nullable().optional(),
    name: z
      .string({ error: 'El nombre es obligatorio' })
      .trim()
      .min(1, 'El nombre no puede estar vacío')
      .max(150, 'El nombre no puede superar 150 caracteres'),
    sku: z
      .string()
      .trim()
      .min(1, 'El SKU no puede estar vacío')
      .max(50, 'El SKU no puede superar 50 caracteres')
      .nullable()
      .optional(),
    unit: z.enum(InventoryUnit).default(InventoryUnit.UND),
    currentStock: stockField('El stock inicial').default(0),
    minStock: stockField('El stock mínimo').optional(),
    maxStock: stockField('El stock máximo').default(0),
    costMinor: minorField('El costo').default(0),
    supplier: z
      .string()
      .trim()
      .min(1, 'El proveedor no puede estar vacío')
      .max(150, 'El proveedor no puede superar 150 caracteres')
      .nullable()
      .optional(),
    locationStorage: z
      .string()
      .trim()
      .min(1, 'La ubicación no puede estar vacía')
      .max(100, 'La ubicación no puede superar 100 caracteres')
      .nullable()
      .optional(),
    isTracked: z.boolean().default(true),
  })
  .strict();

/**
 * `PATCH /api/v1/inventory/items/:id`.
 *
 * `currentStock` DECLARADO a propósito, aunque no se pueda usar: API.md 7.15 lo
 * declara y exige `422 FIELD_NOT_EDITABLE`, no el 400 `UNKNOWN_FIELD` que daría
 * un `.strict()` si no estuviera en el esquema. El service lo rechaza con el
 * 422 y su código, porque el saldo sólo se cambia con un movimiento
 * (BR-INV-005).
 *
 * `productId` e `ingredientId` son inmutables por el mismo motivo.
 */
export const updateInventoryItemBodySchema = z
  .object({
    currentStock: stockField('El stock').optional(),
    productId: resourceIdField.optional(),
    ingredientId: resourceIdField.optional(),
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
      .nullable()
      .optional(),
    unit: z.enum(InventoryUnit).optional(),
    minStock: stockField('El stock mínimo').optional(),
    maxStock: stockField('El stock máximo').optional(),
    costMinor: minorField('El costo').optional(),
    supplier: z
      .string()
      .trim()
      .min(1, 'El proveedor no puede estar vacío')
      .max(150, 'El proveedor no puede superar 150 caracteres')
      .nullable()
      .optional(),
    locationStorage: z
      .string()
      .trim()
      .min(1, 'La ubicación no puede estar vacía')
      .max(100, 'La ubicación no puede superar 100 caracteres')
      .nullable()
      .optional(),
    isTracked: z.boolean().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** `DELETE /api/v1/inventory/items/:id`. Motivo obligatorio. */
export const deleteInventoryItemBodySchema = z
  .object({
    reason: reasonField,
    /** `true` permite dar de baja un ítem con movimientos recientes. */
    force: z.boolean().default(false),
  })
  .strict();

/**
 * `POST /api/v1/inventory/items/:id/adjust`.
 *
 * Exactamente uno de `newQuantity` (saldo absoluto) o `deltaQuantity` (variación
 * con signo). `reason` es obligatorio en todo ajuste (BR-INV-005).
 */
export const adjustInventoryItemBodySchema = z
  .object({
    newQuantity: stockField('La cantidad final').optional(),
    deltaQuantity: quantityField('La variación').optional(),
    reason: reasonField,
    unitCostMinor: minorField('El costo unitario').optional(),
    referenceType: z.enum(InventoryReferenceType).default(InventoryReferenceType.MANUAL),
    referenceId: resourceIdField.optional(),
  })
  .strict();

/** `GET /api/v1/inventory/movements`. */
export const listInventoryMovementsQuerySchema = buildListQuerySchema({
  itemId: resourceIdField.optional(),
  type: z.enum(MovementType).optional(),
  referenceType: z.enum(InventoryReferenceType).optional(),
  referenceId: resourceIdField.optional(),
  performedBy: resourceIdField.optional(),
  from: z.string().datetime({ offset: true, message: '`from` debe ser un instante ISO-8601' }).optional(),
  to: z.string().datetime({ offset: true, message: '`to` debe ser un instante ISO-8601' }).optional(),
});

/** Columnas ordenables de `GET /inventory/movements`. */
export const MOVEMENT_SORT_COLUMNS = ['created_at', 'quantity'] as const;
export const MOVEMENT_SORT_DEFAULT = 'created_at';

/**
 * `POST /api/v1/inventory/movements`.
 *
 * `quantity` con signo: positivo suma, negativo resta (BR-INV-001). El signo
 * ADMISIBLE según el tipo lo valida el service, no el esquema, porque depende de
 * la política de cada tipo (`WASTE` siempre negativo, `PURCHASE` siempre
 * positivo...) y del estado del ítem.
 */
export const createInventoryMovementBodySchema = z
  .object({
    inventoryItemId: resourceIdField,
    movementType: z.enum(MovementType, {
      error: 'El tipo de movimiento es obligatorio y debe ser uno de los admitidos',
    }),
    quantity: quantityField('La cantidad'),
    unitCostMinor: minorField('El costo unitario').optional(),
    referenceType: z.enum(InventoryReferenceType).optional(),
    referenceId: resourceIdField.optional(),
    reason: z
      .string()
      .trim()
      .max(300, 'El motivo no puede superar 300 caracteres')
      .optional(),
  })
  .strict();

/** `GET /api/v1/inventory/alerts`. */
export const listInventoryAlertsQuerySchema = buildListQuerySchema({
  supplier: z.string().trim().max(150, 'El proveedor es demasiado largo').optional(),
  locationStorage: z.string().trim().max(100, 'La ubicación es demasiado larga').optional(),
  includeNegative: booleanQueryField.optional(),
  severity: z.enum(StockAlertSeverity).optional(),
});

/** Columnas ordenables de `GET /inventory/alerts`. */
export const ALERT_SORT_COLUMNS = ['current_stock', 'name'] as const;
export const ALERT_SORT_DEFAULT = 'current_stock';

/** `GET /api/v1/inventory/suppliers`. */
export const listInventorySuppliersQuerySchema = buildListQuerySchema({
  q: searchQueryField,
  supplier: z.string().trim().max(150, 'El proveedor es demasiado largo').optional(),
});

/** Columnas ordenables de `GET /inventory/suppliers`. */
export const SUPPLIER_SORT_COLUMNS = ['name'] as const;
export const SUPPLIER_SORT_DEFAULT = 'name';

/** `GET|PATCH|DELETE|adjust /api/v1/inventory/items/:id`. */
export const inventoryItemIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

// --------------------------------------------------------------------------
// Tipos inferidos, para los controllers
// --------------------------------------------------------------------------

export type ListInventoryItemsQuery = z.infer<typeof listInventoryItemsQuerySchema>;
export type CreateInventoryItemBody = z.infer<typeof createInventoryItemBodySchema>;
export type UpdateInventoryItemBody = z.infer<typeof updateInventoryItemBodySchema>;
export type DeleteInventoryItemBody = z.infer<typeof deleteInventoryItemBodySchema>;
export type AdjustInventoryItemBody = z.infer<typeof adjustInventoryItemBodySchema>;
export type ListInventoryMovementsQuery = z.infer<typeof listInventoryMovementsQuerySchema>;
export type CreateInventoryMovementBody = z.infer<typeof createInventoryMovementBodySchema>;
export type ListInventoryAlertsQuery = z.infer<typeof listInventoryAlertsQuerySchema>;
export type ListInventorySuppliersQuery = z.infer<typeof listInventorySuppliersQuerySchema>;
