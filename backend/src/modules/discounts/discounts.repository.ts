/**
 * Contrato de persistencia de descuentos (tablas `discounts` y
 * `discount_redemptions`).
 *
 * Es una INTERFAZ y no una clase: el service depende de este contrato, nunca de
 * SQLite (DESIGN.md 3.1, regla P3). La implementación vive en
 * `discounts.repository.sqlite.ts`, único fichero del módulo con SQL.
 *
 * REGLAS QUE RESPETA:
 *  - Ningún método abre ni cierra transacción: la abre el service con
 *    `runInTransactionSync` (DESIGN.md 8.2).
 *  - Ningún método decide si un descuento es válido: eso necesita el reloj, el
 *    pedido y las reglas de negocio, y vive en el service. El repositorio sólo
 *    cuenta y lee.
 *  - Todos los métodos aceptan la conexión como último parámetro opcional, para
 *    poder participar de la transacción abierta por otro módulo (el de pedidos
 *    necesita escribir `used_count` y la redemption en su propia transacción,
 *    sin que el descuento se aplique en dos commits distintos).
 */
import type { Db } from '../../shared/database/connection.js';
import type { DiscountAppliesTo, DiscountType } from '../../shared/domain/index.js';
import type {
  DiscountRedemptionRow,
  DiscountRow,
  DiscountSort,
} from './discounts.types.js';

export type { DiscountSort };

/** Filtros de `GET /api/v1/discounts`. */
export interface DiscountListFilter {
  readonly businessId: number;
  readonly limit: number;
  readonly offset: number;
  readonly sort: DiscountSort;
  /** `q`: busca por `code` o `name`. `LIKE` parametrizado y escapado. */
  readonly q?: string;
  readonly isActive?: boolean;
  readonly type?: DiscountType;
  readonly appliesTo?: DiscountAppliesTo;
  /**
   * `true` = sólo los que ya NO son válidos por ventana temporal.
   * `false` = sólo los vigentes. Ausente = todos.
   */
  readonly isExpired?: boolean;
  /** `includeInactive = false` (por defecto) oculta los desactivados. */
  readonly includeInactive?: boolean;
}

/** Datos insertados en `discounts`. */
export interface NewDiscountRecord {
  readonly businessId: number;
  /** Ya normalizado a `UPPER(TRIM(...))` (BR-DISC-007). */
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: DiscountType;
  /** Basis points si `PERCENT`; centavos si `FIXED`. */
  readonly value: number;
  readonly minOrderMinor: number | null;
  readonly maxDiscountMinor: number | null;
  readonly appliesTo: DiscountAppliesTo;
  readonly appliesCategoryId: number | null;
  readonly appliesProductId: number | null;
  readonly usageLimit: number | null;
  readonly usageLimitPerCustomer: number | null;
  readonly startsAt: string | null;
  readonly endsAt: string | null;
  readonly isActive: boolean;
  readonly stackable: boolean;
}

/** Campos actualizables de `discounts`. `used_count` NO está. */
export interface DiscountPatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly type?: DiscountType;
  readonly value?: number;
  readonly minOrderMinor?: number | null;
  readonly maxDiscountMinor?: number | null;
  readonly appliesTo?: DiscountAppliesTo;
  readonly appliesCategoryId?: number | null;
  readonly appliesProductId?: number | null;
  readonly usageLimit?: number | null;
  readonly usageLimitPerCustomer?: number | null;
  readonly startsAt?: string | null;
  readonly endsAt?: string | null;
  readonly isActive?: boolean;
  readonly stackable?: boolean;
  /** Cambio del `code`. Lo bloquea el service si el descuento ya se usó. */
  readonly code?: string;
}

/** Agregados de `GET /api/v1/discounts/:id` (`stats`). */
export interface DiscountStatsRow {
  readonly used_count: number;
  readonly total_discounted_minor: number;
  readonly unique_customers: number;
  readonly last_used_at: string | null;
}

/** Cupón del cliente con su último canje, para `GET /discounts/mine`. */
export interface CustomerDiscountRow extends DiscountRow {
  /** `true` si el cliente ya canjeó este descuento alguna vez. */
  readonly customer_used: 0 | 1;
  /** Instante del último canje del cliente, o `null`. */
  readonly customer_used_at: string | null;
  /** Veces que ESTE cliente lo canjeó. */
  readonly customer_used_count: number;
}

/** Filtro de `GET /api/v1/discounts/mine`. */
export interface MyDiscountFilter {
  readonly businessId: number;
  /** Cliente autenticado. Sale SIEMPRE del token, nunca del query. */
  readonly customerId: number;
  /** `true` = incluir los que ya se vencieron. Default `false`. */
  readonly includeExpired: boolean;
  /** `true` = incluir los ya canjeados por el cliente. Default `true`. */
  readonly includeUsed: boolean;
  readonly limit: number;
  readonly offset: number;
  readonly sort: DiscountSort;
}

/** Repositorio de descuentos. */
export interface DiscountsRepository {
  // --- Lecturas ------------------------------------------------------------

  /** Descuento por id, acotado al negocio, con la fila borrada incluida. */
  findById(id: number, businessId: number, db?: Db): DiscountRow | null;
  /**
   * Descuento por `code`, acotado al negocio, INCLUDING las filas borradas
   * lógicamente. Existe para poder responder con precisión a un cupón que se usó
   * y luego se dio de baja: el código sigue ocupado.
   */
  findByCodeIncludingDeleted(code: string, businessId: number, db?: Db): DiscountRow | null;
  /** Listado paginado. */
  list(filter: DiscountListFilter, db?: Db): readonly DiscountRow[];
  /** Total de descuentos que satisfacen el filtro, sin paginar. */
  count(filter: Omit<DiscountListFilter, 'limit' | 'offset' | 'sort'>, db?: Db): number;
  /** Agregados de un descuento, para el `stats` del detalle. */
  stats(discountId: number, db?: Db): DiscountStatsRow;
  /** Cupones del cliente, con su estado de canje. */
  listForCustomer(filter: MyDiscountFilter, db?: Db): readonly CustomerDiscountRow[];
  /** Total de cupones del cliente, sin paginar. */
  countForCustomer(filter: Omit<MyDiscountFilter, 'limit' | 'offset'>, db?: Db): number;
  /** `true` si la categoría existe y no está borrada lógicamente. */
  categoryExists(categoryId: number, businessId: number, db?: Db): boolean;
  /** `true` si el producto existe y no está borrado lógicamente. */
  productExists(productId: number, businessId: number, db?: Db): boolean;

  // --- Escrituras ----------------------------------------------------------

  /** Inserta el descuento y devuelve su id. */
  insert(record: NewDiscountRecord, db?: Db): number;
  /** Actualiza sólo los campos presentes. */
  update(id: number, patch: DiscountPatch, db?: Db): void;
  /** Marca `deleted_at`. Idempotente. */
  softDelete(id: number, deletedAt: string, db?: Db): void;
  /**
   * Incrementa `used_count` y devuelve el valor ANTERIOR.
   *
   * Se usa dentro de la transacción del pedido (BR-DISC-004): comprobar el
   * límite y consumirlo en la misma unidad de trabajo es lo que impide que dos
   * clientes simultáneos superen `usage_limit`.
   */
  incrementUsedCount(id: number, db?: Db): number;
  /** Decrementa `used_count` sin bajar de cero (BR-DISC-010, cancelación). */
  decrementUsedCount(id: number, db?: Db): number;
  /**
   * Registra el canje en `discount_redemptions`.
   *
   * `UNIQUE (discount_id, order_id)` garantiza que un descuento no se aplique
   * dos veces al mismo pedido: es la última línea de defensa de BR-DISC-006.
   */
  insertRedemption(
    record: {
      readonly discountId: number;
      readonly orderId: number;
      readonly customerId: number | null;
      readonly amountMinor: number;
    },
    db?: Db,
  ): number;
  /** Canjes de un cliente para un descuento: base de BR-DISC-005. */
  countCustomerRedemptions(discountId: number, customerId: number, db?: Db): number;
  /** Canjes de un pedido: base de BR-DISC-010 (cancelar y devolver el canje). */
  listRedemptionsByOrder(orderId: number, db?: Db): readonly DiscountRedemptionRow[];
  /**
   * Canjes de un pedido CON los datos de la regla, para `appliedDiscounts` del
   * detalle de pedido y del recibo (API.md 7.12).
   *
   * Vive aquí y no en el módulo de pagos porque `discount_redemptions` es una
   * tabla de ESTE módulo: el pago la lee, pero no la escribe.
   */
  listRedemptionsWithDiscounts(
    orderId: number,
    db?: Db,
  ): readonly {
    readonly discountId: number;
    readonly code: string;
    readonly name: string;
    readonly type: string;
    readonly value: number;
    readonly amountMinor: number;
  }[];
  /** Borra el canje de un pedido. Sólo para pedidos nunca cobrados. */
  deleteRedemption(discountId: number, orderId: number, db?: Db): number;
}
