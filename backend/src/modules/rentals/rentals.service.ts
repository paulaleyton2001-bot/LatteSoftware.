/**
 * Servicio de alquileres (API.md 7.9).
 *
 * ============================================================================
 * LAS CUATRO REGLAS QUE DEFINEN ESTE SERVICIO
 * ============================================================================
 *  1. **Un alquiler vivo por silla** (BR-RENTAL-009). Se comprueba ANTES de
 *     escribir para poder devolver un 409 con el `code` del alquiler que estorba,
 *     y lo garantiza `ux_chair_rental_active` si alguien se cuela entre la
 *     comprobación y el INSERT.
 *  2. **Precio congelado** (BR-RENTAL-003, decisión D3). Al abrir se copia
 *     `chairs.price_per_hour_minor` a `chair_rentals.price_per_hour_minor` y ya no
 *     se vuelve a leer el precio de la silla: ni el overage ni las extensiones
 *     usan el precio vigente. Subir la tarifa no modifica facturas abiertas.
 *  3. **Pro-rata por minuto con mínimo de 30** (BR-RENTAL-001/002). El cálculo
 *     está en `rental-pricing.ts`, que es puro y por tanto testeable sin base de
 *     datos; aquí sólo se le pasan los datos de la fila.
 *  4. **Cierre transaccional** (DESIGN.md 8.4). Cerrar un alquiler escribe la
 *     silla, el alquiler y el audit. Si algo falla, no queda ninguno de los tres.
 *     El mismo servicio lo invoca el de reservas en el check-out, y en ese caso
 *     la transacción es la de la reserva: `runInTransactionSync` anida con
 *     `SAVEPOINT` y sólo la llamada más externa confirma.
 *
 * ============================================================================
 * LO QUE ESTE SERVICIO NO HACE
 * ============================================================================
 *  - No crea `orders` de cobro. `data.order` de la respuesta es `null` y el
 *    cobro del alquiler queda íntegro en `chair_rentals` (BR-RENTAL-006): el
 *    total está escrito, sólo no está facturado. Quien quiera facturarlo crea
 *    el pedido aparte con `POST /orders` y `reservationId`.
 *  - No devuelve la devolución proporcional de extensiones no consumidas
 *    (BR-RENTAL-005): su importe se anota en el pedido y se devuelve con un
 *    reembolso (`POST /payments/:id/refund`), que es donde vive el dinero.
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import {
  ACTIVE_RENTAL_STATUSES,
  AuditAction,
  AuditEntityType,
  ChairStatus,
  PERMISSION,
  Role,
  RentalStatus,
  assertRentalTransition,
} from '../../shared/domain/index.js';
import type { UserContext } from '../../shared/domain/index.js';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import { CONFLICT_DETAIL_CODE } from '../../shared/errors/codes.js';
import { addMinutes, ceilDiffMinutes, nowIso } from '../../shared/utils/index.js';
import { generateRentalCode } from '../../shared/utils/codes.js';
import type { Db } from '../../shared/database/connection.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import type { ReservationRow, ReservationsRepository } from '../reservations/reservations.repository.js';
import type { SpacesService } from '../spaces/spaces.service.js';
import type { ChairRow } from '../spaces/spaces.repository.js';
import {
  computeExtensionMinor,
  computeRentalCharge,
  projectRentalMinor,
} from './rental-pricing.js';
import type { RentalListFilter, RentalRow, RentalsRepository } from './rentals.repository.js';
import {
  emptyRentalStatusCounts,
  type RentalChargeView,
  type RentalCompleteResult,
  type RentalDetail,
  type RentalExtendResult,
  type RentalExtensionView,
  type RentalOpenResult,
  type RentalPage,
  type RentalView,
} from './rentals.types.js';

/** Contexto de la petición: actor (del token) y datos de red para la auditoría. */
export interface RentalsRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Apertura de un alquiler walk-in (`POST /rentals`). */
export interface OpenRentalInput {
  readonly chairId: number;
  /** 1..1440. Por defecto 60 (BR-RENTAL-007). */
  readonly plannedMinutes: number;
  readonly customerId: number | null;
  /** Si viene, se hace el check-in implícito de la reserva (API.md 7.9). */
  readonly reservationId: number | null;
  readonly notes: string | null;
}

/** Cierre de un alquiler (`POST /rentals/:id/complete`). */
export interface CompleteRentalInput {
  /** Por defecto `now` (el check-out). */
  readonly endAt: string | null;
  /** Requiere MANAGER y `waiveReason` (API.md 7.9). */
  readonly waiveOvertime: boolean;
  readonly waiveReason: string | null;
}

/** Roles que pueden perdonar el sobretiempo. */
const WAIVERS: readonly Role[] = [Role.MANAGER, Role.ADMIN, Role.OWNER];

/** Roles con alcance de sala: ven los alquileres de todo el local. */
const FLOOR_ROLES: readonly Role[] = [Role.STAFF, Role.CASHIER, Role.MANAGER, Role.ADMIN, Role.OWNER];

/** Tope duro de duración de un alquiler: el CHECK `planned_minutes > 0` y 1440. */
const MAX_RENTAL_MINUTES = 1_440;

/** Service de alquileres. */
export class RentalsService {
  public constructor(
    private readonly rentals: RentalsRepository,
    /** Sólo para leer sillas, zonas y ajustes del negocio y validar su estado. */
    private readonly spaces: SpacesService,
    private readonly reservations: ReservationsRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /** `GET /rentals` — listado paginado. Un CUSTOMER sólo ve los suyos. */
  public list(filter: RentalListFilter, context: RentalsRequestContext): RentalPage {
    const scoped = this.scopedFilter(filter, context.actor);
    const counts = emptyRentalStatusCounts();
    for (const entry of this.rentals.countByStatus(scoped)) {
      counts[entry.status] += entry.total;
    }
    return {
      items: this.rentals.list(scoped).map((row) => this.toView(row)),
      total: this.rentals.count(scoped),
      countsByStatus: counts,
    };
  }

  /** `GET /rentals/active` — sólo alquileres `ACTIVE`/`EXTENDED`. */
  public listActive(filter: RentalListFilter, context: RentalsRequestContext): readonly RentalView[] {
    // El alcance (`customerId` del actor) se resuelve ANTES de la paginación: por
    // eso `listActive` del repositorio recibe el filtro completo.
    const scoped = this.scopedFilter(filter, context.actor);
    return this.rentals.listActive(scoped).map((row) => this.toView(row));
  }

  /** `GET /rentals/chair/:chairId/active` — alquiler vivo de una silla, o `null`. */
  public getActiveByChair(chairId: number, context: RentalsRequestContext): RentalView | null {
    // 404 si la silla no existe: el cliente de la app necesita distinguir "no hay
    // alquiler" de "no hay silla".
    this.spaces.requireChair(chairId, context.actor.businessId);
    const row = this.rentals.findActiveByChair(context.actor.businessId, chairId);
    return row === null ? null : this.toView(row);
  }

  /** `GET /rentals/:id` — detalle con extensiones, cobro y reserva asociada. */
  public getById(rentalId: number, context: RentalsRequestContext): RentalDetail {
    const row = this.requireRental(rentalId, context.actor.businessId);
    this.assertCanAccess(row, context.actor);
    const reservation = row.reservation_id === null ? null : this.reservations.findById(row.reservation_id, context.actor.businessId);
    return {
      rental: this.toView(row),
      extensions: this.rentals.listExtensions(rentalId).map(toExtensionView),
      charge: this.chargeOf(row, this.defaultSettings(context.actor.businessId)),
      reservation: reservation === null ? null : toRentalReservationSummary(reservation),
    };
  }

  // ==========================================================================
  // Apertura
  // ==========================================================================

  /**
   * `POST /rentals` — alquiler WALK-IN: el cliente llega y se sienta.
   *
   * Todo dentro de UNA transacción `BEGIN IMMEDIATE`:
   *   1. La silla existe, está activa y es reservable.
   *   2. No hay alquiler vivo para esa silla -> si lo hay, 409 con su código.
   *   3. Si viene `reservationId`, la reserva debe estar `CONFIRMED` (check-in
   *      implícito) o `ACTIVE`; si está `PENDING`, 422 `RESERVATION_NOT_ACTIVE`
   *      (BR-RENTAL-012).
   *   4. Se congela el precio y se calcula el subtotal con la fórmula de alquiler.
   *   5. Se inserta el alquiler, se pone la silla en `OCCUPIED` y se audita.
   * Si un paso falla, no queda alquiler ni cambio de estado (rollback total).
   */
  public openWalkIn(input: OpenRentalInput, context: RentalsRequestContext): RentalOpenResult {
    return runInTransactionSync((tx) => {
      const chair = this.spaces.requireChair(input.chairId, context.actor.businessId);
      this.assertRentable(chair);

      const active = this.rentals.findActiveByChair(context.actor.businessId, chair.id);
      if (active !== null) {
        throw new ConflictError('La silla ya tiene un alquiler abierto', {
          details: {
            code: CONFLICT_DETAIL_CODE.CHAIR_OCCUPIED,
            chairId: chair.id,
            activeRentalCode: active.code,
            activeRentalId: active.id,
          },
        });
      }

      let reservation: ReservationRow | null = null;
      if (input.reservationId !== null) {
        reservation = this.requireReservationForRental(input.reservationId, context.actor.businessId);
      }

      const plannedMinutes = this.assertPlannedMinutes(input.plannedMinutes);
      const startAt = nowIso();
      const endAt = addMinutes(startAt, plannedMinutes);
      // BR-RENTAL-003: el precio se congela AQUÍ y no vuelve a leerse.
      const pricePerHourMinor = chair.price_per_hour_minor;
      const subtotalMinor = projectRentalMinor(plannedMinutes, pricePerHourMinor);

      const rentalId = this.rentals.insert(
        {
          businessId: context.actor.businessId,
          chairId: chair.id,
          reservationId: reservation?.id ?? null,
          customerId: input.customerId ?? reservation?.customer_id ?? null,
          // El código se genera dentro de la transacción: el `MAX` y el `INSERT`
          // ven el mismo estado y la secuencia no puede duplicarse.
          code: generateRentalCode(tx),
          startAt,
          endAt,
          plannedMinutes,
          pricePerHourMinor,
          subtotalMinor,
          createdBy: context.actor.id,
        },
        tx,
      );

      // La transición a OCCUPIED la valida y audita SpacesService: es la única
      // puerta a ese estado (BR-CHAIR-003).
      const occupied = this.spaces.occupyChair(chair.id, context, tx);
      if (input.notes !== null) {
        this.spaces.updateChairNote(chair.id, input.notes, context, tx);
      }

      const row = this.requireRental(rentalId, context.actor.businessId);
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.rental,
        entityId: rentalId,
        actor: this.auditActor(context),
        request: context.request,
        afterData: {
          id: row.id,
          code: row.code,
          chairId: row.chair_id,
          reservationId: row.reservation_id,
          startAt: row.start_at,
          endAt: row.end_at,
          plannedMinutes: row.planned_minutes,
          pricePerHourMinor: row.price_per_hour_minor,
          subtotalMinor: row.subtotal_minor,
          totalMinor: row.total_minor,
        },
      });

      return {
        rental: this.toView(row),
        chairStatus: occupied.status,
        chairStatusChangedAt: occupied.statusChangedAt,
      };
    });
  }

  /**
   * Apertura de un alquiler **materializado desde una reserva** (check-in).
   *
   * Lo invoca `ReservationsService` dentro de la transacción del check-in, así
   * que aquí la unidad de trabajo anida con `SAVEPOINT` y confirma la más externa.
   *
   * El precio congelado es el de la RESERVA (`chair_reservations.price_per_hour_minor`
   *), no el vigente de la silla: el cliente aceptó ese precio al reservar y por eso
   * está guardado en la fila (BR-PRICE-010 y BR-RENTAL-003).
   */
  public openForReservation(
    tx: Db,
    reservation: ReservationRow,
    chair: ChairRow,
    context: RentalsRequestContext,
    startedAt: string,
  ): RentalRow {
    const pricePerHourMinor = reservation.price_per_hour_minor;
    const plannedMinutes = reservation.duration_minutes;
    const subtotalMinor = projectRentalMinor(plannedMinutes, pricePerHourMinor);
    const rentalId = this.rentals.insert({
      businessId: reservation.business_id,
      chairId: chair.id,
      reservationId: reservation.id,
      customerId: reservation.customer_id,
      code: generateRentalCode(tx),
      startAt: startedAt,
      endAt: reservation.end_at,
      plannedMinutes,
      pricePerHourMinor,
      subtotalMinor,
      createdBy: context.actor.id,
    }, tx);
    const row = this.requireRental(rentalId, context.actor.businessId);
    // El alquiler también es una mutación de negocio y lleva su propia entrada en
    // `audit_logs` (BR-SEC-007). El check-in escribe dos filas: la de la reserva
    // y esta.
    this.audit.record({
      action: AuditAction.CREATE,
      entityType: AuditEntityType.rental,
      entityId: rentalId,
      actor: this.auditActor(context),
      request: context.request,
      afterData: {
        id: row.id,
        code: row.code,
        chairId: row.chair_id,
        reservationId: row.reservation_id,
        startAt: row.start_at,
        endAt: row.end_at,
        plannedMinutes: row.planned_minutes,
        pricePerHourMinor: row.price_per_hour_minor,
        subtotalMinor: row.subtotal_minor,
        totalMinor: row.total_minor,
        cause: 'reservation_checkin',
      },
    });
    return row;
  }

  // ==========================================================================
  // Extensión y cierre
  // ==========================================================================

  /**
   * `POST /rentals/:id/extend` — extiende el alquiler.
   *
   * Se registra en `chair_rental_extensions` (tabla INMUTABLE) y se recalcula el
   * total sumando importes ya redondeados (BR-MONEY-004). El importe de la
   * extensión usa el precio CONGELADO del alquiler, no el vigente (BR-RENTAL-011).
   *
   * Antes de escribir se revalida que la ventana nueva no choque con una reserva
   * `CONFIRMED` de la misma silla (DESIGN.md 6.3, efecto secundario de
   * `ACTIVE -> EXTENDED`).
   */
  public extend(
    rentalId: number,
    input: { readonly additionalMinutes: number; readonly reason: string | null },
    context: RentalsRequestContext,
  ): RentalExtendResult {
    return runInTransactionSync((tx) => {
      const before = this.requireRental(rentalId, context.actor.businessId);
      if (!ACTIVE_RENTAL_STATUSES.includes(before.status)) {
        throw new BusinessRuleError('El alquiler ya no está abierto: no se puede extender', {
          details: { code: 'RENTAL_NOT_ACTIVE', rentalId, status: before.status },
        });
      }
      if (input.additionalMinutes < 5 || input.additionalMinutes > MAX_RENTAL_MINUTES) {
        throw new ValidationError('La extensión debe estar entre 5 y 1440 minutos', {
          details: [
            {
              path: 'additionalMinutes',
              message: 'La extensión debe estar entre 5 y 1440 minutos',
              code: 'OUT_OF_RANGE',
            },
          ],
        });
      }
      const previousEndAt = before.end_at;
      const newEndAt = addMinutes(previousEndAt, input.additionalMinutes);
      const totalPlannedMinutes = ceilDiffMinutes(before.start_at, newEndAt);
      if (totalPlannedMinutes > MAX_RENTAL_MINUTES) {
        throw new BusinessRuleError('El alquiler no puede superar las 24 horas', {
          details: {
            code: 'EXTENSION_TOO_LONG',
            ruleId: 'BR-RENTAL-002',
            rentalId,
            totalPlannedMinutes,
            maxMinutes: MAX_RENTAL_MINUTES,
          },
        });
      }

      // No se puede extender la silla por encima de una reserva confirmada.
      const conflict = this.reservations.findOverlapping(
        context.actor.businessId,
        before.chair_id,
        previousEndAt,
        newEndAt,
        null,
      );
      if (conflict !== null) {
        throw new ConflictError('Hay una reserva que ocupa esa silla en la ventana nueva', {
          details: {
            code: CONFLICT_DETAIL_CODE.CHAIR_ALREADY_RESERVED,
            conflictingReservationCode: conflict.code,
            conflictingStartAt: conflict.start_at,
            conflictingEndAt: conflict.end_at,
          },
        });
      }

      const additionalMinor = computeExtensionMinor(input.additionalMinutes, before.price_per_hour_minor);
      const extensionsMinor = before.extensions_minor + additionalMinor;
      // `subtotal + extensions + extra`: el overage sólo se calcula al cerrar.
      const totalMinor = before.subtotal_minor + extensionsMinor + before.extra_minutes_minor;
      assertRentalTransition(before.status, RentalStatus.EXTENDED);

      const extensionId = this.rentals.insertExtension(
        {
          rentalId: before.id,
          chairId: before.chair_id,
          requestedMinutes: input.additionalMinutes,
          previousEndAt,
          newEndAt,
          additionalMinor,
          pricePerHourMinor: before.price_per_hour_minor,
          reason: input.reason,
          createdBy: context.actor.id,
        },
        tx,
      );
      this.rentals.extend(
        before.id,
        { status: 'EXTENDED', endAt: newEndAt, extensionsMinor, totalMinor },
        tx,
      );

      const after = this.requireRental(before.id, context.actor.businessId);
      const extension = this.rentals.listExtensions(before.id).find((row) => row.id === extensionId);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.rental,
        entityId: before.id,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: before.id, status: before.status, endAt: previousEndAt, extensionsMinor: before.extensions_minor },
        afterData: {
          id: after.id,
          status: after.status,
          endAt: after.end_at,
          extensionsMinor: after.extensions_minor,
          additionalMinor,
          totalMinor: after.total_minor,
        },
      });
      return {
        rental: this.toView(after),
        extension:
          extension === undefined
            ? {
                id: extensionId,
                requestedMinutes: input.additionalMinutes,
                previousEndAt,
                newEndAt,
                additionalMinor,
                pricePerHourMinor: before.price_per_hour_minor,
                reason: input.reason,
                createdBy: context.actor.id,
                createdAt: nowIso(),
              }
            : toExtensionView(extension),
        // El estado de la SILLA, no el del alquiler: extender no mueve la silla
        // de `OCCUPIED`, así que aquí se lee de `chairs` y no del alquiler. Con
        // `after.status` la respuesta declaraba `chairStatus: 'EXTENDED'`, que es
        // un `RentalStatus` y no existe en el CHECK `ck_chairs_status`: el cliente
        // recibía un estado de silla imposible.
        chairStatus: this.spaces.requireChair(after.chair_id, context.actor.businessId).status,
      };
    });
  }

  /**
   * `POST /rentals/:id/complete` — cierre y cobro.
   *
   * Calcula `billed_minutes = max(30, ceil((cierre - apertura) / 60000))` y el
   * overage contra el precio congelado (BR-RENTAL-001..004), escribe el total y
   * libera la silla a `CLEANING` (BR-RENTAL-008: no se vuelve a `AVAILABLE` sin
   * limpiar; de `CLEANING` a `AVAILABLE` ya responde
   * `POST /chairs/{id}/complete-maintenance`).
   *
   * Todo transaccional: alquiler + silla + auditoría, o nada.
   */
  public complete(
    rentalId: number,
    input: CompleteRentalInput,
    context: RentalsRequestContext,
  ): RentalCompleteResult {
    return runInTransactionSync((tx) => {
      const before = this.requireRental(rentalId, context.actor.businessId);
      if (!ACTIVE_RENTAL_STATUSES.includes(before.status)) {
        throw new BusinessRuleError('El alquiler ya está cerrado', {
          details: { code: 'RENTAL_NOT_ACTIVE', rentalId, status: before.status },
        });
      }
      this.assertCanWaive(input, context.actor);

      const endedAt = input.endAt ?? nowIso();
      if (endedAt <= before.start_at) {
        throw new BusinessRuleError('El cierre no puede ser anterior a la apertura', {
          details: { code: 'RENTAL_END_BEFORE_START', rentalId, startAt: before.start_at, endAt: endedAt },
        });
      }
      const settings = this.defaultSettings(context.actor.businessId);
      const charge = computeRentalCharge({
        startAt: before.start_at,
        plannedEndAt: before.end_at,
        plannedMinutes: before.planned_minutes,
        extensionsMinor: before.extensions_minor,
        pricePerHourMinor: before.price_per_hour_minor,
        endedAt,
        taxRateBp: settings.tax_rate_bp,
        serviceFeeBp: settings.service_fee_bp,
        taxInclusive: settings.tax_inclusive === 1,
        waiveOvertime: input.waiveOvertime,
      });
/** Estado destino del cierre, nombrado (no un string suelto). */
      assertRentalTransition(before.status, RentalStatus.COMPLETED);

      this.rentals.close(
        before.id,
        {
          status: RentalStatus.COMPLETED,
          billedMinutes: charge.billedMinutes,
          extraMinutesMinor: charge.extraMinutesMinor,
          totalMinor: charge.totalMinor,
        },
        tx,
      );

      // BR-RENTAL-008: la silla pasa a CLEANING. `OCCUPIED -> CLEANING` es la
      // transición de la máquina de estados para el cierre de un alquiler, y la
      // valida y audita SpacesService.
      const released = this.spaces.releaseChairAfterRental(before.chair_id, context, tx);

      const after = this.requireRental(before.id, context.actor.businessId);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.rental,
        entityId: before.id,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: before.id, status: before.status, endAt: before.end_at, totalMinor: before.total_minor },
        afterData: {
          id: after.id,
          status: after.status,
          billedMinutes: after.billed_minutes,
          extraMinutes: charge.extraMinutes,
          extraMinutesMinor: after.extra_minutes_minor,
          totalMinor: after.total_minor,
          grandTotalMinor: charge.grandTotalMinor,
          ...(input.waiveOvertime ? { waivedOvertime: true, waiveReason: input.waiveReason } : {}),
        },
      });

      return {
        rental: this.toView(after),
        charge: toChargeView(charge, settings.currency_code),
        chairStatus: released.status,
        chairStatusChangedAt: released.statusChangedAt,
      };
    });
  }

  // ==========================================================================
  // Utilidades internas
  // ==========================================================================

  /**
   * Alquiler vivo de una silla, o `null`.
   *
   * Lo usan la cotización (`GET /reservations/quote`, que restaura `isAvailable`)
   * y la extensión de reserva, que no puede pisar la ventana de un alquiler ya
   * abierto. Devuelve la FILLA y no un booleano porque quien pregunta necesita
   * el `code` para poder explicar el 409.
   */
  public findActiveRental(businessId: number, chairId: number): RentalRow | null {
    return this.rentals.findActiveByChair(businessId, chairId);
  }

  /** Alquileres de una reserva, para el detalle de la reserva. */
  public listRentalsOfReservation(reservationId: number): readonly RentalRow[] {
    return this.rentals.listByReservation(reservationId);
  }

  /** Fila de alquiler por id, para releerlo tras un cierre. */
  public findRentalRow(rentalId: number, businessId: number): RentalRow | null {
    return this.rentals.findById(rentalId, businessId);
  }

  /**
   * Cierre del alquiler de un check-out de reserva.
   *
   * Es `complete` con la fila ya cargada: el servicio de reservas la necesita
   * para saber si había alquiler vivo. Comparte TODA la lógica de cierre
   * (minutos reales, overage al precio congelado, `CLEANING` y auditoría) con
   * `POST /rentals/:id/complete`, porque el overage se calcula una sola vez en el
   * sistema y duplicarlo sería duplicar el riesgo de cobrar dos veces.
   */
  public completeForReservation(
    rental: RentalRow,
    endedAt: string,
    context: RentalsRequestContext,
    tx: Db,
  ): { readonly charge: RentalChargeView; readonly rental: RentalView; readonly rentalRow: RentalRow } {
    if (!ACTIVE_RENTAL_STATUSES.includes(rental.status)) {
      throw new BusinessRuleError('El alquiler ya está cerrado', {
        details: { code: 'RENTAL_NOT_ACTIVE', rentalId: rental.id, status: rental.status },
      });
    }
    if (endedAt <= rental.start_at) {
      throw new BusinessRuleError('El cierre no puede ser anterior a la apertura', {
        details: { code: 'RENTAL_END_BEFORE_START', rentalId: rental.id, startAt: rental.start_at, endAt: endedAt },
      });
    }
    const settings = this.defaultSettings(context.actor.businessId);
    const charge = computeRentalCharge({
      startAt: rental.start_at,
      plannedEndAt: rental.end_at,
      plannedMinutes: rental.planned_minutes,
      extensionsMinor: rental.extensions_minor,
      pricePerHourMinor: rental.price_per_hour_minor,
      endedAt,
      taxRateBp: settings.tax_rate_bp,
      serviceFeeBp: settings.service_fee_bp,
      taxInclusive: settings.tax_inclusive === 1,
      waiveOvertime: false,
    });
    assertRentalTransition(rental.status, RentalStatus.COMPLETED);
    this.rentals.close(
      rental.id,
      {
        status: RentalStatus.COMPLETED,
        billedMinutes: charge.billedMinutes,
        extraMinutesMinor: charge.extraMinutesMinor,
        totalMinor: charge.totalMinor,
      },
      tx,
    );
    this.spaces.releaseChairAfterRental(rental.chair_id, context, tx);
    const after = this.requireRental(rental.id, context.actor.businessId);
    this.audit.record({
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.rental,
      entityId: rental.id,
      actor: this.auditActor(context),
      request: context.request,
      beforeData: { id: rental.id, status: rental.status, totalMinor: rental.total_minor },
      afterData: {
        id: after.id,
        status: after.status,
        billedMinutes: after.billed_minutes,
        extraMinutes: charge.extraMinutes,
        extraMinutesMinor: after.extra_minutes_minor,
        totalMinor: after.total_minor,
        cause: 'reservation_checkout',
      },
    });
    return {
      charge: toChargeView(charge, settings.currency_code),
      rental: this.toView(after),
      rentalRow: after,
    };
  }

  /** Alquiler obligatorio: 404 si no existe o es de otro negocio. */
  requireRental(rentalId: number, businessId: number): RentalRow {
    const row = this.rentals.findById(rentalId, businessId);
    if (row === null) {
      throw new NotFoundError('El alquiler no existe', { details: { id: rentalId, type: 'rental' } });
    }
    return row;
  }

  /** La silla tiene que existir, estar activa y ser utilizable (API.md 7.9). */
  private assertRentable(chair: ChairRow): void {
    if (chair.is_active === 0) {
      throw new BusinessRuleError('La silla no está activa', {
        details: { code: 'CHAIR_NOT_BOOKABLE', chairId: chair.id, ruleId: 'BR-RES-005' },
      });
    }
    if (chair.is_bookable === 0) {
      throw new BusinessRuleError('La silla no admite alquiler: no es reservable', {
        details: { code: 'CHAIR_NOT_BOOKABLE', chairId: chair.id, ruleId: 'BR-RES-005' },
      });
    }
    if (chair.status === ChairStatus.BLOCKED) {
      throw new BusinessRuleError('La silla está bloqueada', {
        details: { code: 'CHAIR_BLOCKED', chairId: chair.id },
      });
    }
    if (chair.status === ChairStatus.MAINTENANCE) {
      throw new BusinessRuleError('La silla está en mantenimiento', {
        details: { code: 'CHAIR_NOT_BOOKABLE', chairId: chair.id, status: chair.status },
      });
    }
    if (chair.status === ChairStatus.CLEANING) {
      throw new BusinessRuleError('La silla está en limpieza: aún no admite clientes', {
        details: { code: 'CHAIR_NOT_BOOKABLE', chairId: chair.id, status: chair.status },
      });
    }
  }

  /** La reserva tiene que estar `CONFIRMED` o `ACTIVE` (BR-RENTAL-012). */
  private requireReservationForRental(reservationId: number, businessId: number): ReservationRow {
    const row = this.reservations.findById(reservationId, businessId);
    if (row === null) {
      throw new NotFoundError('La reserva no existe', { details: { id: reservationId, type: 'reservation' } });
    }
    if (row.status !== 'CONFIRMED' && row.status !== 'ACTIVE') {
      throw new BusinessRuleError('La reserva no está confirmada: no se puede abrir el alquiler', {
        details: {
          code: 'RESERVATION_NOT_ACTIVE',
          ruleId: 'BR-RENTAL-012',
          reservationId,
          status: row.status,
          hint: 'Confirme la reserva antes de abrir el alquiler.',
        },
      });
    }
    return row;
  }

  /** `planned_minutes` válido: 1..1440 (BR-RENTAL-007, CHECK del DDL). */
  private assertPlannedMinutes(minutes: number): number {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_RENTAL_MINUTES) {
      throw new ValidationError('La duración del alquiler debe estar entre 1 y 1440 minutos', {
        details: [
          {
            path: 'plannedMinutes',
            message: 'La duración debe ser un entero entre 1 y 1440 minutos',
            code: 'OUT_OF_RANGE',
          },
        ],
      });
    }
    return minutes;
  }

  /** Perdonar el sobretiempo exige MANAGER y un motivo (API.md 7.9). */
  private assertCanWaive(input: CompleteRentalInput, actor: UserContext): void {
    if (input.waiveOvertime !== true) {
      return;
    }
    if (!actor.roles.some((role) => WAIVERS.includes(role))) {
      throw new AuthorizationError('Sólo un gerente puede perdonar el sobretiempo', {
        details: { code: 'INSUFFICIENT_ROLE', required: [...WAIVERS] },
      });
    }
    if (input.waiveReason === null || input.waiveReason.trim().length === 0) {
      throw new ValidationError('Debe indicar el motivo por el que perdona el sobretiempo', {
        details: [{ path: 'waiveReason', message: 'El motivo es obligatorio', code: 'REQUIRED' }],
      });
    }
  }

  /**
   * Un `CUSTOMER` sólo ve sus propios alquileres: el permiso `rentals:read:any`
   * es el que abre el alcance al resto del local (API.md 7.9, marca `P` frente a
   * `C` en la matriz de RBAC). El filtro `customerId` que llegue del cliente se
   * SOBRESCRIBE aquí: el alcance lo decide el service, no el middleware.
   */
  private scopedFilter(filter: RentalListFilter, actor: UserContext): RentalListFilter {
    if (
      actor.permissions.includes(PERMISSION.RENTALS_READ_ANY) ||
      actor.roles.some((role) => FLOOR_ROLES.includes(role))
    ) {
      return filter;
    }
    return { ...filter, customerId: actor.id };
  }

  /**
   * Un cliente no puede leer el alquiler de otro (404, no 403: API.md 2).
   *
   * Un alquiler SIN cliente (`customer_id IS NULL`, walk-in de mostrador) también
   * queda fuera del alcance de un `CUSTOMER`: pertenece al negocio, no a una
   * cuenta, y no hay ninguna razón para que un cliente pueda ver las sesiones de
   * otra mesa.
   */
  private assertCanAccess(row: RentalRow, actor: UserContext): void {
    if (actor.roles.some((role) => FLOOR_ROLES.includes(role))) {
      return;
    }
    if (row.customer_id !== null && row.customer_id === actor.id) {
      return;
    }
    throw new NotFoundError('El alquiler no existe', { details: { id: row.id, type: 'rental' } });
  }

  /** Ajustes del negocio (moneda e impuestos) para el desglose del cobro. */
  private defaultSettings(businessId: number): {
    readonly currency_code: string;
    readonly tax_rate_bp: number;
    readonly service_fee_bp: number;
    readonly tax_inclusive: 0 | 1;
  } {
    // `requireBusinessSettings` lanza 404 si el negocio no existe: es preferible a
    // inventar una tasa de impuesto por defecto, que haría cuadrar el cobro de un
    // negocio con el de otro (P1: una sola fuente de verdad).
    return this.spaces.requireBusinessSettings(businessId);
  }

  /** Actor normalizado para `audit.record`. */
  private auditActor(context: RentalsRequestContext): {
    readonly id: number;
    readonly email: string;
    readonly businessId: number;
  } {
    return { id: context.actor.id, email: context.actor.email, businessId: context.actor.businessId };
  }

  /**
   * Fila de alquiler -> `RentalView`, con los minutos derivados del reloj.
   *
   * Es PÚBLICA porque el módulo de reservations devuelve el alquiler que acaba de
   * materializar en su respuesta de check-in, y duplicar el mapeo en dos sitios es
   * la forma más corta de que las dos respuestas diverjan.
   */
  public toView(row: RentalRow): RentalView {
    const now = nowIso();
    const elapsedMinutes = Math.max(0, ceilDiffMinutes(row.start_at, now));
    const plannedTotal = ceilDiffMinutes(row.start_at, row.end_at);
    return {
      id: row.id,
      code: row.code,
      chairId: row.chair_id,
      chairCode: row.chair_code,
      zoneId: row.zone_id,
      zoneName: row.zone_name,
      locationId: row.location_id,
      reservationId: row.reservation_id,
      customerId: row.customer_id,
      customerName: row.customer_name,
      status: row.status,
      startAt: row.start_at,
      endAt: row.end_at,
      plannedMinutes: row.planned_minutes,
      billedMinutes: row.billed_minutes,
      pricePerHourMinor: row.price_per_hour_minor,
      subtotalMinor: row.subtotal_minor,
      extensionsMinor: row.extensions_minor,
      extraMinutesMinor: row.extra_minutes_minor,
      totalMinor: row.total_minor,
      elapsedMinutes,
      remainingMinutes: plannedTotal - elapsedMinutes,
      overtimeMinutes: Math.max(0, elapsedMinutes - plannedTotal),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Desglose del cobro de un alquiler que aún no se ha cerrado. */
  private chargeOf(
    row: RentalRow,
    settings: { readonly currency_code: string; readonly tax_rate_bp: number; readonly service_fee_bp: number; readonly tax_inclusive: 0 | 1 },
  ): RentalChargeView {
    const charge = computeRentalCharge({
      startAt: row.start_at,
      plannedEndAt: row.end_at,
      plannedMinutes: row.planned_minutes,
      extensionsMinor: row.extensions_minor,
      pricePerHourMinor: row.price_per_hour_minor,
      endedAt: row.status === 'COMPLETED' ? row.end_at : nowIso(),
      taxRateBp: settings.tax_rate_bp,
      serviceFeeBp: settings.service_fee_bp,
      taxInclusive: settings.tax_inclusive === 1,
      waiveOvertime: false,
    });
    return toChargeView(charge, settings.currency_code);
  }
}

// --------------------------------------------------------------------------
// Helpers de proyección
// --------------------------------------------------------------------------

/** Fila de extensión -> vista de la API. */
function toExtensionView(row: {
  readonly id: number;
  readonly requested_minutes: number;
  readonly previous_end_at: string;
  readonly new_end_at: string;
  readonly additional_minor: number;
  readonly price_per_hour_minor: number;
  readonly reason: string | null;
  readonly created_by: number | null;
  readonly created_at: string;
}): RentalExtensionView {
  return {
    id: row.id,
    requestedMinutes: row.requested_minutes,
    previousEndAt: row.previous_end_at,
    newEndAt: row.new_end_at,
    additionalMinor: row.additional_minor,
    pricePerHourMinor: row.price_per_hour_minor,
    reason: row.reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/** Desglose puro -> `charge` de la respuesta, con la moneda del negocio. */
function toChargeView(
  charge: ReturnType<typeof computeRentalCharge>,
  currencyCode: string,
): RentalChargeView {
  return {
    plannedMinutes: charge.plannedMinutes,
    billedMinutes: charge.billedMinutes,
    minimumApplied: charge.minimumApplied,
    overtimeMinutes: charge.extraMinutes,
    pricePerHourMinor: charge.pricePerHourMinor,
    subtotalMinor: charge.subtotalMinor,
    extensionsMinor: charge.extensionsMinor,
    extraMinutesMinor: charge.extraMinutesMinor,
    waivedMinor: charge.waivedMinor,
    taxMinor: charge.taxMinor,
    serviceFeeMinor: charge.serviceFeeMinor,
    totalMinor: charge.totalMinor,
    currencyCode,
    grandTotalMinor: charge.grandTotalMinor,
  };
}

/** Reserva resumida para incrustar en el detalle de un alquiler. */
function toRentalReservationSummary(row: ReservationRow): {
  readonly id: number;
  readonly code: string;
  readonly status: string;
  readonly startAt: string;
  readonly endAt: string;
} {
  return {
    id: row.id,
    code: row.code,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
  };
}
