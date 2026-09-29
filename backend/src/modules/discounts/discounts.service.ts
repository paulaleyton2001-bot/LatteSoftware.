/**
 * Servicio de descuentos (API.md 7.14, DESIGN.md 7.8).
 *
 * ============================================================================
 * QUÉ ES UN DESCUENTO EN ESTE SISTEMA
 * ============================================================================
 * Un descuento es una REGLA (`discounts`) más un HISTORIAL de canjes
 * (`discount_redemptions`). La regla se puede editar; el historial no, y por eso
 * `used_count` es un contador DESNORMALIZADO que este service incrementa en la
 * MISMA transacción que la aplica (BR-DISC-004): comprobar el límite y consumirlo
 * juntos es lo que impide que dos clientes simultáneos superen `usage_limit`.
 *
 * ============================================================================
 * LAS REGLAS QUE APLICA
 * ============================================================================
 *  - **BR-DISC-001** La previsualización NO se confía. `validate` cotiza con lo
 *    que le llega; `POST /orders` vuelve a validar y a calcular. Aquí no hay
 *    ningún camino que devuelva al pedido el importe de la previsualización.
 *  - **BR-DISC-002** El descuento nunca supera su base aplicable, que es el
 *    subtotal completo si `appliesTo = ALL` y la suma de las líneas afectadas si
 *    es `CATEGORY`/`PRODUCT`. El recorte NO es un error: es el tope natural.
 *  - **BR-DISC-003** Validez temporal: `is_active`, no borrado,
 *    `starts_at <= now < ends_at`.
 *  - **BR-DISC-004** `used_count < usage_limit` cuando el límite no es NULL.
 *  - **BR-DISC-005** `usage_limit_per_customer` contando `discount_redemptions`
 *    de ese cliente. Superarlo NO invalida el descuento para los demás.
 *  - **BR-DISC-006** Un descuento no `stackable` sólo se aplica si el pedido no
 *    tiene otro. `POST /orders` acepta un cupón, así que la regla se comprueba
 *    igualmente y deja constancia por si mañana se abre el endpoint a varios.
 *  - **BR-DISC-007** `code` en mayúsculas, comparado con `UPPER(TRIM(input))`.
 *  - **BR-DISC-008** Un `PERCENT` se limita por `max_discount_minor`; por encima
 *    del 50 % el esquema zod EXIGE ese tope.
 *  - **BR-DISC-009** `min_order_minor` se compara con el subtotal del pedido.
 *  - **BR-DISC-010** Cancelar un pedido `DRAFT`/`PENDING` devuelve el canje y
 *    ajusta `used_count`, porque nunca se cobró. Cancelar uno `CONFIRMED` o
 *    posterior NO lo hace.
 *
 * ============================================================================
 * POR QUÉ `validate` RESPONDE 200 CON `isValid: false`
 * ============================================================================
 * Preguntar "¿me sirve este cupón?" no es un error de la petición: es la
 * pregunta. Un `422` obligaría al frontend a tratar una respuesta legítima como
 * fallo, y un `404` revelaría la existencia de campañas internas. El resultado
 * es siempre 200 y el motivo va en `reason`/`reasonCode` (API.md 7.14).
 */
import {
  AuditAction,
  AuditEntityType,
  DiscountAppliesTo,
  DiscountType,
  Role,
  isEnumValue,
  type UserContext,
} from '../../shared/domain/index.js';
import {
  AuthorizationError,
  BusinessRuleError,
  NotFoundError,
} from '../../shared/errors/index.js';
import type { Db } from '../../shared/database/connection.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { nowIso, parseIso } from '../../shared/utils/datetime.js';
import { applyTaxBp, roundHalfUp } from '../../shared/utils/money.js';
import type {
  DiscountsRepository,
  DiscountListFilter,
  DiscountPatch,
  NewDiscountRecord,
} from './discounts.repository.js';
import type { DiscountSort } from './discounts.types.js';
import type {
  CreateDiscountBody,
  UpdateDiscountBody,
  ValidateDiscountBody,
} from './discounts.schemas.js';
import type {
  DiscountDetailView,
  DiscountPage,
  DiscountRow,
  DiscountValidationInput,
  DiscountValidationLine,
  DiscountValidationView,
  DiscountView,
  MyDiscountPage,
  MyDiscountView,
} from './discounts.types.js';
import { UNAVAILABLE_ORDER_LOOKUP, type DiscountOrderLookup, type DiscountOrderSnapshot } from './discounts.order-lookup.js';

/** Contexto de petición: actor (del token) y datos de red para la auditoría. */
export interface DiscountsRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Resultado de aplicar un cupón a un pedido. */
export interface AppliedDiscount {
  readonly discountId: number;
  readonly code: string;
  readonly name: string;
  readonly type: DiscountType;
  readonly value: number;
  readonly amountMinor: number;
  /** `true` si `max_discount_minor` recortó el importe. */
  readonly cappedByMaxDiscount: boolean;
  /** Base sobre la que se calculó, para explicarlo en el recibo. */
  readonly applicableSubtotalMinor: number;
}

/** Descuento ya aplicado al pedido, para comprobar BR-DISC-006. */
export interface AlreadyAppliedDiscount {
  readonly discountId: number;
  readonly stackable: boolean;
}

/**
 * Roles que administran descuentos: MANAGER y superiores (DESIGN.md 9.3).
 * `discounts:read`, `create`, `update` y `delete` no están en CUSTOMER ni STAFF.
 * ADMIN y OWNER además tienen todos los permisos implícitos (BR-RBAC-002).
 */
const MANAGER_ROLES: readonly string[] = [Role.MANAGER, Role.ADMIN, Role.OWNER];

/** Identificadores de regla que viajan en `meta.appliedRules` y en la cotización. */
const RULES_QUOTED = [
  'BR-DISC-001',
  'BR-DISC-002',
  'BR-DISC-003',
  'BR-DISC-004',
  'BR-DISC-005',
  'BR-DISC-007',
] as const;

/** Tope de basis points de un `PERCENT`: 10000 = 100 %. */
const MAX_PERCENT_BP = 10_000;

/** Servicio de descuentos. */
export class DiscountsService {
  /**
   * Puerto de lectura de pedidos para cotizar sobre el subtotal REAL.
   *
   * Se inyecta DESPUÉS de construir el service (lo conecta el contenedor), y por
   * defecto es un puerto vacío: sin él, `POST /validate` con `orderId` responde
   * con un error explícito en lugar de cotizar con un subtotal que el cliente
   * horsepower y que el servidor acabaría descartando.
   */
  private orderLookup: DiscountOrderLookup = UNAVAILABLE_ORDER_LOOKUP;

  public constructor(
    private readonly repository: DiscountsRepository,
    private readonly audit: AuditService,
  ) {}

  /** Conecta el puerto de pedidos. Lo llama el contenedor de la integración. */
  public attachOrderLookup(lookup: DiscountOrderLookup): void {
    this.orderLookup = lookup;
  }

  /**
   * Instantánea de un pedido real para la cotización, o `null` si no existe.
   *
   * Sin backend conectado lanza un `422 ORDER_LOOKUP_UNAVAILABLE` en vez de
   * cotizar sobre un subtotal inventado.
   */
  public orderSnapshot(orderId: number, businessId: number): DiscountOrderSnapshot | null {
    if (!this.orderLookup.available) {
      throw new BusinessRuleError(
        'No se puede cotizar sobre un pedido: el módulo de pedidos no está conectado',
        {
          details: {
            code: 'ORDER_LOOKUP_UNAVAILABLE',
            field: 'orderId',
            hint: 'Envíe `subtotalMinor` e `items` en lugar de `orderId`',
          },
        },
      );
    }
    return this.orderLookup.findOrderSnapshot(orderId, businessId);
  }

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /**
   * Descuentos realmente aplicados a un pedido, para `appliedDiscounts` del
   * detalle y del recibo (API.md 7.12).
   *
   * Se lee de `discount_redemptions`, que es la fuente de verdad del canje, y
   * NO de `orders.discount_minor`: aquél explica QUÉ cupón se aplicó y cuánto,
   * mientras que éste sólo dice cuánto se descontó en total.
   */
  public appliedDiscountsOf(
    orderId: number,
    db?: Db,
  ): readonly {
    readonly discountId: number;
    readonly code: string;
    readonly name: string;
    readonly type: string;
    readonly value: number;
    readonly amountMinor: number;
  }[] {
    return this.repository.listRedemptionsWithDiscounts(orderId, db);
  }

  /**
   * `GET /api/v1/discounts` — listado paginado.
   *
   * El `context` no se usa para filtrar: `businessId` YA viene forzado en el
   * filtro por el controller desde el token (BR-SEC-008), así que aquí no hay nada
   * que resolver. Se conserva por simetría con el resto de servicios y para que
   * la auditoría futura pueda uniforme sin cambiar la firma.
   */
  public list(filter: DiscountListFilter, context: DiscountsRequestContext): DiscountPage {
    this.assertManager(context.actor, 'discounts:read');
    const now = nowIso();
    const items = this.repository.list(filter).map((row) => this.toView(row, now));
    return { items, total: this.repository.count(filter) };
  }

  /** `GET /api/v1/discounts/:id` — detalle con categoría, producto y estadísticas. */
  public getById(id: number, context: DiscountsRequestContext): DiscountDetailView {
    this.assertManager(context.actor, 'discounts:read');
    const row = this.requireDiscount(id, context.actor.businessId);
    const stats = this.repository.stats(id);
    return {
      ...this.toView(row, nowIso()),
      business: { id: row.business_id, name: '' },
      category:
        row.applies_category_id === null || row.applies_category_name === null
          ? null
          : { id: row.applies_category_id, name: row.applies_category_name },
      product:
        row.applies_product_id === null || row.applies_product_name === null
          ? null
          : { id: row.applies_product_id, name: row.applies_product_name },
      stats: {
        usedCount: stats.used_count,
        totalDiscountedMinor: stats.total_discounted_minor,
        uniqueCustomers: stats.unique_customers,
        lastUsedAt: stats.last_used_at,
      },
    };
  }

  /** `GET /api/v1/discounts/mine` — cupones del cliente autenticado. */
  public listMine(
    filter: {
      readonly limit: number;
      readonly offset: number;
      readonly includeExpired: boolean;
      readonly includeUsed: boolean;
      readonly sort: DiscountSort;
    },
    context: DiscountsRequestContext,
  ): MyDiscountPage {
    const now = nowIso();
    const scoped = {
      businessId: context.actor.businessId,
      // El cliente SIEMPRE es el actor: este endpoint ni siquiera acepta
      // `customerId` en la query, que es la garantía más fuerte de BR-SEC-008.
      customerId: context.actor.id,
      includeExpired: filter.includeExpired,
      includeUsed: filter.includeUsed,
      sort: filter.sort,
      limit: filter.limit,
      offset: filter.offset,
    };
    const items = this.repository.listForCustomer(scoped).map((row) => this.toMyView(row, now));
    return {
      items,
      total: this.repository.countForCustomer({
        businessId: scoped.businessId,
        customerId: scoped.customerId,
        includeExpired: scoped.includeExpired,
        includeUsed: scoped.includeUsed,
        sort: scoped.sort,
      }),
    };
  }

  // ==========================================================================
  // Validación y aplicación
  // ==========================================================================

  /**
   * `POST /api/v1/discounts/validate` — previsualización sin efectos.
   *
   * NUNCA escribe nada: ni `used_count`, ni redemption. Sólo cotiza.
   */
  public validate(
    input: {
      readonly code: string;
      readonly subtotalMinor: number;
      readonly customerId: number | null;
      readonly lines: readonly DiscountValidationLine[];
    },
    context: DiscountsRequestContext,
  ): DiscountValidationView {
    const normalized = normalizeCode(input.code);
    const found = this.repository.findByCodeIncludingDeleted(normalized, context.actor.businessId);
    if (found === null) {
      return invalid('DISCOUNT_NOT_FOUND', 'No existe ningún descuento con ese código');
    }
    return this.quote(found, input.subtotalMinor, input.customerId, input.lines, nowIso());
  }

  /**
   * Aplica un cupón a un pedido, DENTRO de la transacción ya abierta.
   *
   * Es el único camino del sistema que incrementa `used_count` e inserta la
   * redemption, y lo hace el módulo de pedidos para que BR-DISC-004 se cumpla de
   * verdad: si el cupón se consumiera en su propia transacción, un fallo
   * posterior del pedido dejaría el contador quemado sin venta.
   *
   * @param db Conexión de la transacción del pedido. OBLIGATORIA: sin ella el
   *           descuento se consumiría fuera del commit del pedido.
   */
  public applyToOrder(
    params: {
      readonly code: string;
      readonly orderId: number;
      readonly customerId: number | null;
      readonly subtotalMinor: number;
      readonly lines: readonly DiscountValidationLine[];
      /** Descuentos ya aplicados al pedido, para BR-DISC-006. */
      readonly alreadyApplied: readonly AlreadyAppliedDiscount[];
    },
    context: DiscountsRequestContext,
    db: Db,
    now = nowIso(),
  ): AppliedDiscount {
    const normalized = normalizeCode(params.code);
    const found = this.repository.findByCodeIncludingDeleted(normalized, context.actor.businessId, db);
    if (found === null) {
      throw new BusinessRuleError('No existe ningún descuento con ese código', {
        details: { code: 'DISCOUNT_NOT_FOUND', ruleId: 'BR-DISC-001', field: 'couponCode' },
      });
    }

    const quoted = this.quote(
      found,
      params.subtotalMinor,
      params.customerId,
      params.lines,
      now,
      db,
    );
    if (!quoted.isValid) {
      throw new BusinessRuleError('El cupón no se puede aplicar a este pedido', {
        details: {
          code: quoted.reasonCode ?? 'DISCOUNT_INVALID',
          ruleId: 'BR-DISC-002',
          reason: quoted.reason,
          discountCode: normalized,
        },
      });
    }

    // BR-DISC-006: un descuento no apilable exige que el pedido no tenga otro.
    for (const entry of params.alreadyApplied) {
      if (entry.discountId === found.id) {
        throw new BusinessRuleError('Este cupón ya está aplicado a este pedido', {
          details: { code: 'DISCOUNT_ALREADY_APPLIED', ruleId: 'BR-DISC-006' },
        });
      }
    }
    if (found.stackable !== 1 && params.alreadyApplied.some((entry) => !entry.stackable)) {
      throw new BusinessRuleError('Este cupón no se puede combinar con el descuento ya aplicado', {
        details: {
          code: 'DISCOUNT_NOT_STACKABLE',
          ruleId: 'BR-DISC-006',
          discountCode: normalized,
        },
      });
    }

    // Consumo del cupón dentro de la transacción del pedido (BR-DISC-004).
    const previous = this.repository.incrementUsedCount(found.id, db);
    this.assertUsageLimit(found, previous);
    this.repository.insertRedemption(
      {
        discountId: found.id,
        orderId: params.orderId,
        customerId: params.customerId,
        amountMinor: quoted.discountMinor,
      },
      db,
    );

    return {
      discountId: found.id,
      code: found.code,
      name: found.name,
      type: toDiscountType(found.type),
      value: found.value,
      amountMinor: quoted.discountMinor,
      cappedByMaxDiscount: quoted.cappedByMaxDiscount,
      applicableSubtotalMinor: quoted.applicableSubtotalMinor,
    };
  }

  /**
   * Revierte el consumo de un cupón (BR-DISC-010).
   *
   * Sólo para pedidos cancelados ANTES de confirmarse: si nunca se cobró, la
   * campaña no consumió el uso. En cuanto hubo cobro el canje se conserva.
   */
  public releaseForOrder(orderId: number, context: DiscountsRequestContext, db: Db): void {
    for (const redemption of this.repository.listRedemptionsByOrder(orderId, db)) {
      this.repository.deleteRedemption(redemption.discount_id, orderId, db);
      this.repository.decrementUsedCount(redemption.discount_id, db);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.discount,
        entityId: redemption.discount_id,
        actor: context.actor,
        request: context.request,
        beforeData: {
          resource: 'discount_redemption',
          orderId,
          amountMinor: redemption.amount_minor,
        },
        afterData: { resource: 'discount_redemption', orderId, released: true },
      });
    }
  }

  /**
   * Desvincula un cupón de un pedido vivo sin devolver el uso.
   *
   * Se usa al QUITAR un cupón de un pedido `DRAFT`/`PENDING`: el pedido sigue
   * vivo, así que la redemption desaparece, pero la campaña no recupera el uso
   * porque el cupón ya se contabilizó en la Brittany del día. Por eso es una
   * operación distinta de {@link releaseForOrder}, que sí devuelve el uso.
   */
  public detachFromOrder(
    orderId: number,
    discountId: number,
    context: DiscountsRequestContext,
    db: Db,
  ): void {
    this.repository.deleteRedemption(discountId, orderId, db);
    this.audit.record({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.discount,
      entityId: discountId,
      actor: context.actor,
      request: context.request,
      beforeData: { resource: 'discount_redemption', orderId },
      afterData: { resource: 'discount_redemption', orderId, detached: true },
    });
  }

  // ==========================================================================
  // Escrituras
  // ==========================================================================

  /** `POST /api/v1/discounts` — alta. */
  public create(body: CreateDiscountBody, context: DiscountsRequestContext): DiscountView {
    this.assertManager(context.actor, 'discounts:create');
    this.assertShape(
      {
        type: body.type,
        value: body.value,
        maxDiscountMinor: body.maxDiscountMinor ?? null,
        appliesTo: body.appliesTo,
        appliesCategoryId: body.appliesCategoryId ?? null,
        appliesProductId: body.appliesProductId ?? null,
        startsAt: body.startsAt ?? null,
        endsAt: body.endsAt ?? null,
      },
      context.actor.businessId,
    );
    const record: NewDiscountRecord = {
      businessId: context.actor.businessId,
      code: normalizeCode(body.code),
      name: body.name,
      description: body.description ?? null,
      type: body.type,
      value: body.value,
      minOrderMinor: body.minOrderMinor ?? null,
      maxDiscountMinor: body.maxDiscountMinor ?? null,
      appliesTo: body.appliesTo,
      appliesCategoryId: body.appliesCategoryId ?? null,
      appliesProductId: body.appliesProductId ?? null,
      usageLimit: body.usageLimit ?? null,
      usageLimitPerCustomer: body.usageLimitPerCustomer ?? null,
      startsAt: normalizeInstant(body.startsAt ?? null),
      endsAt: normalizeInstant(body.endsAt ?? null),
      isActive: body.isActive,
      stackable: body.stackable,
    };
    const id = this.repository.insert(record);
    const created = this.requireDiscount(id, context.actor.businessId);
    this.audit.record({
      action: AuditAction.CREATE,
      entityType: AuditEntityType.discount,
      entityId: id,
      actor: context.actor,
      request: context.request,
      afterData: {
        id,
        code: created.code,
        name: created.name,
        type: created.type,
        value: created.value,
        appliesTo: created.applies_to,
        isActive: created.is_active === 1,
      },
    });
    return this.toView(created, nowIso());
  }

  /** `PATCH /api/v1/discounts/:id` — edición parcial. */
  public update(id: number, body: UpdateDiscountBody, context: DiscountsRequestContext): DiscountView {
    this.assertManager(context.actor, 'discounts:update');
    const before = this.requireDiscount(id, context.actor.businessId);

    // El `code` se puede cambiar sólo si el descuento NUNCA se usó: el código
    // aparece en recibos ya emitidos y en la caja, y renombrarlo rompe la
    // trazabilidad de esas ventas (API.md 7.14 `DISCOUNT_CODE_IN_USE`).
    if (body.code !== undefined && before.used_count > 0) {
      throw new BusinessRuleError('No se puede cambiar el código de un descuento ya usado', {
        details: { code: 'DISCOUNT_CODE_IN_USE', field: 'code', usedCount: before.used_count },
      });
    }

    this.assertShape(
      {
        type: body.type ?? toDiscountType(before.type),
        value: body.value ?? before.value,
        maxDiscountMinor:
          body.maxDiscountMinor === undefined ? before.max_discount_minor : body.maxDiscountMinor,
        appliesTo: body.appliesTo ?? toDiscountAppliesTo(before.applies_to),
        appliesCategoryId:
          body.appliesCategoryId === undefined
            ? before.applies_category_id
            : body.appliesCategoryId,
        appliesProductId:
          body.appliesProductId === undefined ? before.applies_product_id : body.appliesProductId,
        startsAt: body.startsAt === undefined ? before.starts_at : body.startsAt,
        endsAt: body.endsAt === undefined ? before.ends_at : body.endsAt,
      },
      context.actor.businessId,
    );

    const patch: DiscountPatch = {
      ...(body.code === undefined ? {} : { code: normalizeCode(body.code) }),
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.type === undefined ? {} : { type: body.type }),
      ...(body.value === undefined ? {} : { value: body.value }),
      ...(body.minOrderMinor === undefined ? {} : { minOrderMinor: body.minOrderMinor }),
      ...(body.maxDiscountMinor === undefined ? {} : { maxDiscountMinor: body.maxDiscountMinor }),
      ...(body.appliesTo === undefined ? {} : { appliesTo: body.appliesTo }),
      ...(body.appliesCategoryId === undefined ? {} : { appliesCategoryId: body.appliesCategoryId }),
      ...(body.appliesProductId === undefined ? {} : { appliesProductId: body.appliesProductId }),
      ...(body.usageLimit === undefined ? {} : { usageLimit: body.usageLimit }),
      ...(body.usageLimitPerCustomer === undefined
        ? {}
        : { usageLimitPerCustomer: body.usageLimitPerCustomer }),
      ...(body.startsAt === undefined ? {} : { startsAt: normalizeInstant(body.startsAt) }),
      ...(body.endsAt === undefined ? {} : { endsAt: normalizeInstant(body.endsAt) }),
      ...(body.isActive === undefined ? {} : { isActive: body.isActive }),
      ...(body.stackable === undefined ? {} : { stackable: body.stackable }),
    };
    this.repository.update(id, patch);
    const updated = this.requireDiscount(id, context.actor.businessId);
    this.audit.record({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.discount,
      entityId: id,
      actor: context.actor,
      request: context.request,
      beforeData: {
        code: before.code,
        name: before.name,
        value: before.value,
        isActive: before.is_active === 1,
      },
      afterData: {
        code: updated.code,
        name: updated.name,
        value: updated.value,
        isActive: updated.is_active === 1,
      },
    });
    return this.toView(updated, nowIso());
  }

  /** `DELETE /api/v1/discounts/:id` — baja lógica. */
  public remove(
    id: number,
    context: DiscountsRequestContext,
  ): { readonly id: number; readonly deletedAt: string } {
    this.assertManager(context.actor, 'discounts:delete');
    const before = this.requireDiscount(id, context.actor.businessId);
    const at = nowIso();
    this.repository.softDelete(id, at);
    this.audit.record({
      action: AuditAction.DELETE,
      entityType: AuditEntityType.discount,
      entityId: id,
      actor: context.actor,
      request: context.request,
      beforeData: { code: before.code, name: before.name, usedCount: before.used_count },
      afterData: { code: before.code, deletedAt: at },
    });
    return { id, deletedAt: at };
  }

  // ==========================================================================
  // Cotización
  // ============================================================================

  /**
   * Cotiza un cupón sobre una base. La aritmética es PURA: recibe la fila, la
   * base y las líneas, y devuelve el resultado o el PRIMER motivo de rechazo, en
   * el orden de las reglas de `DESIGN.md` 7.8.
   *
   * El importe se calcula así (BR-DISC-002 y BR-DISC-008):
   *   1. Base aplicable = subtotal completo, o la suma de las líneas del ámbito.
   *   2. `PERCENT` -> `roundHalfUp(base * value / 10000)`; `FIXED` -> `value`.
   *   3. Si supera `max_discount_minor`, se recorta a ese tope.
   *   4. Si aun supera la base aplicable, se recorta a la base: el descuento
   *      NUNCA puede ser mayor que lo que se compra (CHECK
   *      `ck_orders_discount` de `orders`).
   */
  public quote(
    row: DiscountRow,
    subtotalMinor: number,
    customerId: number | null,
    lines: readonly DiscountValidationLine[],
    now: string,
    db?: Db,
  ): DiscountValidationView {
    const type = toDiscountType(row.type);
    const appliesTo = toDiscountAppliesTo(row.applies_to);
    const ruleIds: string[] = [...RULES_QUOTED];
    const applicableSubtotalMinor = applicableBase(subtotalMinor, appliesTo, row, lines);
    const remainingUses =
      row.usage_limit === null ? null : Math.max(0, row.usage_limit - row.used_count);
    const minOrderMet = row.min_order_minor === null || subtotalMinor >= row.min_order_minor;

    const base: DiscountValidationView = {
      isValid: false,
      code: row.code,
      name: row.name,
      type: row.type,
      value: row.value,
      applicableSubtotalMinor,
      discountMinor: 0,
      cappedByMaxDiscount: false,
      remainingUses,
      minOrderMet,
      reason: null,
      reasonCode: null,
      ruleIds,
    };

    // --- BR-DISC-003: activo, no borrado y dentro de la ventana -----------
    if (row.deleted_at !== null) {
      return withReason(base, 'DISCOUNT_DELETED', 'Este descuento ya no está disponible', 'BR-DISC-003');
    }
    if (row.is_active !== 1) {
      return withReason(base, 'DISCOUNT_INACTIVE', 'Este descuento está desactivado', 'BR-DISC-003');
    }
    if (row.starts_at !== null && row.starts_at > now) {
      return withReason(
        base,
        'DISCOUNT_NOT_STARTED',
        'Este descuento todavía no está vigente',
        'BR-DISC-003',
      );
    }
    if (row.ends_at !== null && row.ends_at <= now) {
      return withReason(base, 'DISCOUNT_EXPIRED', 'Este descuento ya está vencido', 'BR-DISC-003');
    }

    // --- BR-DISC-004: límite global de usos --------------------------------
    if (row.usage_limit !== null && row.used_count >= row.usage_limit) {
      return withReason(
        base,
        'DISCOUNT_LIMIT_REACHED',
        'Este descuento ya alcanzó su límite de usos',
        'BR-DISC-004',
      );
    }

    // --- BR-DISC-005: límite por cliente -----------------------------------
    if (row.usage_limit_per_customer !== null && customerId !== null) {
      const used =
        db === undefined
          ? this.repository.countCustomerRedemptions(row.id, customerId)
          : this.repository.countCustomerRedemptions(row.id, customerId, db);
      if (used >= row.usage_limit_per_customer) {
        return withReason(
          base,
          'DISCOUNT_EXCEEDED_PER_CUSTOMER',
          'Ya has usado este descuento el máximo de veces permitido',
          'BR-DISC-005',
        );
      }
    }

    // --- BR-DISC-009: pedido mínimo ----------------------------------------
    if (!minOrderMet) {
      ruleIds.push('BR-DISC-009');
      return {
        ...base,
        isValid: false,
        reason:
          row.min_order_minor === null
            ? 'El pedido no alcanza el mínimo del descuento'
            : `El pedido no alcanza el mínimo de ${row.min_order_minor} centavos para este descuento`,
        reasonCode: 'DISCOUNT_MIN_ORDER_NOT_MET',
        ruleIds,
      };
    }

    // --- BR-DISC-002: base aplicable según el ámbito -----------------------
    if (applicableSubtotalMinor === 0) {
      ruleIds.push('BR-DISC-002');
      return {
        ...base,
        isValid: false,
        reason: 'Este descuento no aplica a ninguno de los productos del pedido',
        reasonCode: 'DISCOUNT_NO_APPLICABLE_ITEMS',
        ruleIds,
      };
    }

    // Importe bruto según el tipo. `PERCENT` son basis points (BR-DISC-007).
    const gross = type === DiscountType.PERCENT ? applyTaxBp(applicableSubtotalMinor, row.value) : row.value;

    // BR-DISC-008: tope absoluto, imprescindible con `PERCENT`.
    const capped = row.max_discount_minor === null ? gross : Math.min(gross, row.max_discount_minor);
    const cappedByMaxDiscount = capped < gross;
    if (cappedByMaxDiscount) {
      ruleIds.push('BR-DISC-008');
    }

    // BR-DISC-002: el descuento nunca supera su base.
    const amountMinor = Math.max(0, Math.min(capped, applicableSubtotalMinor));
    ruleIds.push('BR-DISC-002');

    return {
      isValid: true,
      code: row.code,
      name: row.name,
      type: row.type,
      value: row.value,
      applicableSubtotalMinor,
      discountMinor: amountMinor,
      cappedByMaxDiscount,
      remainingUses,
      minOrderMet: true,
      reason: null,
      reasonCode: null,
      ruleIds,
    };
  }

  // ==========================================================================
  // Auxiliares privados
  // ==========================================================================

  /** Descuento obligatorio: 404 si no existe o está dado de baja. */
  private requireDiscount(id: number, businessId: number): DiscountRow {
    const row = this.repository.findById(id, businessId);
    if (row === null) {
      throw new NotFoundError('El descuento no existe', { details: { id, type: 'discount' } });
    }
    return row;
  }

  /**
   * Descuentos de gestión: MANAGER y superiores.
   *
   * `discounts:read` existe para CUSTOMER en la matriz (DESIGN.md 9.3) pero
   * significa "ver promociones", que es exactamente lo que devuelve
   * `GET /discounts/mine`. El catálogo de campañas con sus contadores internos
   * queda para la casa: por eso aquí se exige el rol, no sólo la clave de
   * permiso, y el 403 lleva `details.required` con la clave que falta.
   */
  private assertManager(actor: UserContext, permission: string): void {
    if (actor.roles.some((role) => MANAGER_ROLES.includes(role))) {
      return;
    }
    throw new AuthorizationError('No tiene permisos para administrar los descuentos', {
      details: { code: 'INSUFFICIENT_PERMISSIONS', required: permission, roles: [...actor.roles] },
    });
  }

  /**
   * Valida el ÁMBITO y la coherencia de los importes antes de escribir.
   *
   * Los CHECK de la base de datos (`ck_discounts_category`, `ck_discounts_product`)
   * son la última línea de defensa; comprobarlos aquí permite devolver un 422
   * con el nombre del campo en lugar de un 500 con el texto del driver.
   */
  private assertShape(
    shape: {
      readonly type: DiscountType;
      readonly value: number;
      readonly maxDiscountMinor: number | null;
      readonly appliesTo: DiscountAppliesTo;
      readonly appliesCategoryId: number | null;
      readonly appliesProductId: number | null;
      readonly startsAt: string | null;
      readonly endsAt: string | null;
    },
    businessId: number,
  ): void {
    if (shape.type === DiscountType.PERCENT) {
      if (shape.value < 0 || shape.value > MAX_PERCENT_BP) {
        throw new BusinessRuleError(
          'Un descuento porcentual debe estar entre 0 y 10000 basis points (100 %)',
          {
            details: {
              code: 'PERCENT_VALUE_OUT_OF_RANGE',
              ruleId: 'BR-DISC-007',
              field: 'value',
            },
          },
        );
      }
    } else if (shape.value < 0) {
      throw new BusinessRuleError('El importe de un descuento fijo no puede ser negativo', {
        details: { code: 'DISCOUNT_NEGATIVE_VALUE', field: 'value' },
      });
    }
    if (shape.appliesTo === DiscountAppliesTo.CATEGORY) {
      if (shape.appliesCategoryId === null) {
        throw new BusinessRuleError('Un descuento por categoría debe indicar la categoría', {
          details: { code: 'APPLIES_TO_REQUIRES_TARGET', field: 'appliesCategoryId' },
        });
      }
      if (!this.repository.categoryExists(shape.appliesCategoryId, businessId)) {
        throw new NotFoundError('La categoría no existe', {
          details: { id: shape.appliesCategoryId, type: 'category', field: 'appliesCategoryId' },
        });
      }
    }
    if (shape.appliesTo === DiscountAppliesTo.PRODUCT) {
      if (shape.appliesProductId === null) {
        throw new BusinessRuleError('Un descuento por producto debe indicar el producto', {
          details: { code: 'APPLIES_TO_REQUIRES_TARGET', field: 'appliesProductId' },
        });
      }
      if (!this.repository.productExists(shape.appliesProductId, businessId)) {
        throw new NotFoundError('El producto no existe', {
          details: { id: shape.appliesProductId, type: 'product', field: 'appliesProductId' },
        });
      }
    }
    const startsAt = shape.startsAt === null ? null : normalizeInstant(shape.startsAt);
    const endsAt = shape.endsAt === null ? null : normalizeInstant(shape.endsAt);
    if (startsAt !== null && endsAt !== null && Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new BusinessRuleError('La fecha de fin debe ser posterior a la de inicio', {
        details: { code: 'PROMO_WINDOW_INVALID', field: 'endsAt' },
      });
    }
  }

  /** `BR-DISC-004`: si el descuento tiene tope, se comprueba ANTES de gastar. */
  private assertUsageLimit(row: DiscountRow, previousUsedCount: number): void {
    if (row.usage_limit !== null && previousUsedCount + 1 > row.usage_limit) {
      throw new BusinessRuleError('Este descuento alcanzó su límite de usos', {
        details: {
          code: 'DISCOUNT_LIMIT_REACHED',
          ruleId: 'BR-DISC-004',
          usageLimit: row.usage_limit,
        },
      });
    }
  }

  /** Fila -> vista de API. `isCurrentlyValid` se calcula con el reloj. */
  private toView(row: DiscountRow, now: string): DiscountView {
    const valid =
      row.deleted_at === null &&
      row.is_active === 1 &&
      (row.starts_at === null || row.starts_at <= now) &&
      (row.ends_at === null || row.ends_at > now) &&
      (row.usage_limit === null || row.used_count < row.usage_limit);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      type: row.type,
      value: row.value,
      minOrderMinor: row.min_order_minor,
      maxDiscountMinor: row.max_discount_minor,
      appliesTo: row.applies_to,
      appliesCategoryId: row.applies_category_id,
      appliesProductId: row.applies_product_id,
      usageLimit: row.usage_limit,
      usageLimitPerCustomer: row.usage_limit_per_customer,
      usedCount: row.used_count,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      isActive: row.is_active === 1,
      stackable: row.stackable === 1,
      isCurrentlyValid: valid,
      usageRemaining:
        row.usage_limit === null ? null : Math.max(0, row.usage_limit - row.used_count),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Cupón del cliente: `isValid` no consulta la BD, sólo su ventana y su tope. */
  private toMyView(
    row: DiscountRow & {
      readonly customer_used: 0 | 1;
      readonly customer_used_at: string | null;
      readonly customer_used_count: number;
    },
    now: string,
  ): MyDiscountView {
    const withinWindow =
      (row.starts_at === null || row.starts_at <= now) && (row.ends_at === null || row.ends_at > now);
    const hasUses = row.usage_limit === null || row.used_count < row.usage_limit;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      description: row.description,
      type: row.type,
      value: row.value,
      maxDiscountMinor: row.max_discount_minor,
      appliesTo: row.applies_to,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      isActive: row.is_active === 1,
      isValid: withinWindow && hasUses,
      usedAt: row.customer_used_at,
      usedCount: row.customer_used_count,
    };
  }
}

// --------------------------------------------------------------------------
// Funciones puras auxiliares
// --------------------------------------------------------------------------

/** `UPPER(TRIM(code))` (BR-DISC-007). */
export function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Normaliza un instante a UTC ISO-8601, o `null`. */
function normalizeInstant(value: string | null): string | null {
  return value === null ? null : parseIso(value, 'instant').toISOString();
}

/**
 * Traduce el TEXT de la base al enum del dominio.
 *
 * El CHECK del esquema garantiza que el valor es válido; la comprobación
 * explícita no desconfía del esquema, es la traducción tipada: un `as` a ciegas
 * dejaría pasar un valor inválido si mañana cambiara el CHECK sin migración.
 */
export function toDiscountType(value: string): DiscountType {
  if (!isEnumValue(DiscountType, value)) {
    throw new BusinessRuleError('El tipo de descuento almacenado no es válido', {
      details: { code: 'DISCOUNT_CONSTRAINT_VIOLATION', field: 'type', value },
    });
  }
  return value;
}

/** Igual que {@link toDiscountType} para `applies_to`. */
export function toDiscountAppliesTo(value: string): DiscountAppliesTo {
  if (!isEnumValue(DiscountAppliesTo, value)) {
    throw new BusinessRuleError('El ámbito de aplicación del descuento no es válido', {
      details: { code: 'DISCOUNT_CONSTRAINT_VIOLATION', field: 'appliesTo', value },
    });
  }
  return value;
}

/** Base imponible del descuento según su ámbito (BR-DISC-002). */
export function applicableBase(
  subtotalMinor: number,
  appliesTo: DiscountAppliesTo,
  row: { readonly applies_category_id: number | null; readonly applies_product_id: number | null },
  lines: readonly DiscountValidationLine[],
): number {
  if (appliesTo === DiscountAppliesTo.ALL) {
    return Math.max(0, subtotalMinor);
  }
  const target =
    appliesTo === DiscountAppliesTo.CATEGORY ? row.applies_category_id : row.applies_product_id;
  if (target === null) {
    return 0;
  }
  const total = lines
    .filter((line) =>
      appliesTo === DiscountAppliesTo.CATEGORY
        ? line.categoryId === target
        : line.productId === target,
    )
    .reduce<number>((accumulator, line) => accumulator + line.lineTotalMinor, 0);
  return roundHalfUp(Math.max(0, total));
}

/** Rellena un resultado inválido con su motivo y el identificador de la regla. */
function withReason(
  base: DiscountValidationView,
  reasonCode: string,
  reason: string,
  ruleId: string,
): DiscountValidationView {
  return {
    ...base,
    isValid: false,
    reason,
    reasonCode,
    ruleIds: base.ruleIds.includes(ruleId) ? base.ruleIds : [...base.ruleIds, ruleId],
  };
}

/** Resultado inválido para un cupón que ni existe. */
function invalid(reasonCode: string, reason: string): DiscountValidationView {
  return {
    isValid: false,
    code: null,
    name: null,
    type: null,
    value: null,
    applicableSubtotalMinor: 0,
    discountMinor: 0,
    cappedByMaxDiscount: false,
    remainingUses: null,
    minOrderMet: false,
    reason,
    reasonCode,
    ruleIds: ['BR-DISC-001', 'BR-DISC-007'],
  };
}

/** Traduce el body de `POST /validate` al input del service. */
export function toValidationInput(
  body: ValidateDiscountBody,
  resolvedSubtotalMinor: number,
  customerId: number | null,
): DiscountValidationInput {
  const lines: DiscountValidationLine[] = (body.items ?? []).map((item) => ({
    productId: item.productId,
    categoryId: item.categoryId ?? null,
    quantity: item.quantity,
    lineTotalMinor: roundHalfUp(item.unitPriceMinor * item.quantity),
  }));
  return {
    code: body.code,
    subtotalMinor: resolvedSubtotalMinor,
    customerId,
    lines,
  };
}
