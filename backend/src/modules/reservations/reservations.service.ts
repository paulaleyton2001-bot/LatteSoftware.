/**
 * Servicio de reservas (API.md 7.8).
 *
 * ============================================================================
 * EL NÚCLEO DEL SISTEMA: `create` DENTRO DE UNA `BEGIN IMMEDIATE`
 * ============================================================================
 * Es la única operación donde un error de concurrencia cuesta dinero y trabajo
 * real: dos cajeros (o un cliente y un cajero) reservando la misma silla a la vez.
 * El servicio ejecuta, dentro de UNA transacción abierta con
 * `runInTransactionSync`, y en este orden:
 *
 *   1. La silla existe, está activa, es reservable y su estado es `AVAILABLE` o
 *      `RESERVED` (BR-RES-005).
 *   2. Se consultan las reservas que solapan con la ventana pedida, con la
 *      condición `NOT (end_at <= :startAt OR start_at >= :endAt)` sobre
 *      `PENDING`, `CONFIRMED` y `ACTIVE` (BR-RES-001/002). Si hay una, 409 con su
 *      código.
 *   3. La duración se comprueba contra `businesses.max_reservation_minutes`
 *      (BR-RENTAL-010).
 *   4. Se calcula `duration_minutes` y `rental_total_minor` con la fórmula pura de
 *      `rental-pricing.ts`, con el precio CONGELADO de la silla.
 *   5. Se genera el `code` con la secuencia de `shared/utils/codes.ts`, leyendo
 *      el `MAX` dentro de la misma transacción.
 *   6. Se inserta la reserva en `PENDING`.
 *   7. Si la reserva empieza ahora, la silla pasa a `RESERVED` validando la
 *      máquina de estados de sillas.
 *   8. Se audita.
 *
 * Si CUALQUIER paso lanza, no queda reserva, ni cambio de estado, ni auditoría:
 * rollback total (DESIGN.md 8.4). El paso 2 es la garantía: vive dentro de la
 * transacción, no en un índice. (Existió un índice único parcial por silla,
 * `ux_chair_res_active`, que la migración `0002_fix_chair_reservation_index.sql`
 * eliminó porque, al ser único sólo por `chair_id`, rechazaba reservas
 * legítimamente NO solapadas en lugar de prevenir el solapamiento.)
 *
 * ============================================================================
 * POR QUÉ `runInTransactionSync` Y NO `runInTransaction`
 * ============================================================================
 * El tsdoc de `shared/database/unit-of-work.ts` lo explica: hacer `await` dentro
 * de la transacción devuelve el control al event loop mientras el lock de
 * escritura sigue retenido, y otra petición puede entrar en la misma conexión.
 * Aquí no hay nada que esperar (`better-sqlite3` es síncrono), así que se usa la
 * variante síncrona y no existe ninguna ventana de interleaving posible.
 *
 * ============================================================================
 * MÁQUINA DE ESTADOS: NO SE REIMPLEMENTA
 * ============================================================================
 * Todas las transiciones pasan por `assertReservationTransition` de
 * `shared/domain/reservation-state-machine.ts`, que es la fuente de verdad
 * (DESIGN.md 6.2). En particular `PENDING -> ACTIVE` está PROHIBIDA: el
 * check-in exige una reserva `CONFIRMED` antes, porque es la confirmación la que
 * revalida el solapamiento dentro de la transacción.
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { RESERVATION } from '../../config/index.js';
import {
  AuditAction,
  AuditEntityType,
  ChairStatus,
  PERMISSION,
  ReservationSource,
  ReservationStatus,
  Role,
  assertReservationTransition,
  isTerminalReservationStatus,
} from '../../shared/domain/index.js';
import type { UserContext } from '../../shared/domain/index.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import { CONFLICT_DETAIL_CODE } from '../../shared/errors/codes.js';
import { addMinutes, ceilDiffMinutes, nowIso, overlaps } from '../../shared/utils/index.js';
import { applyTaxBp } from '../../shared/utils/money.js';
import { generateReservationCode } from '../../shared/utils/codes.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { projectRentalMinor, computeRentalCharge } from '../rentals/rental-pricing.js';
import type { RentalsService } from '../rentals/rentals.service.js';
import { toRentalSummary, type RentalRow } from '../rentals/rentals.repository.js';
import { toChairView, type SpacesService } from '../spaces/spaces.service.js';
import type { ReservationListFilter, ReservationRow, ReservationsRepository } from './reservations.repository.js';
import type {
  ExpireReservationsResult,
  ReservationChargeView,
  ReservationCheckInResult,
  ReservationCompleteResult,
  ReservationDetail,
  ReservationPage,
  ReservationQuote,
  ReservationView,
} from './reservations.types.js';

/** Contexto de la petición: actor (del token) y datos de red para la auditoría. */
export interface ReservationsRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Alta de reserva (`POST /reservations`). */
export interface CreateReservationInput {
  readonly chairId: number;
  readonly startAt: string;
  readonly endAt: string;
  readonly customerId: number | null;
  readonly notes: string | null;
  readonly source: ReservationSource;
  readonly sendNotification: boolean;
}

/** Margen de tolerancia para un `start_at` en el pasado (API.md 7.8). */
const PAST_TOLERANCE_MINUTES = 5;

/** Roles con alcance de sala: ven las reservas de todo el local. */
const FLOOR_ROLES: readonly Role[] = [Role.STAFF, Role.CASHIER, Role.MANAGER, Role.ADMIN, Role.OWNER];

/** Reglas aplicadas, que viajan en `meta.appliedRules` (API.md 3.1). */
export const RESERVATION_APPLIED_RULES: readonly string[] = Object.freeze([
  'BR-RES-001',
  'BR-RES-002',
  'BR-RES-005',
  'BR-RENTAL-001',
  'BR-RES-007',
]);

/** Service de reservas. */
export class ReservationsService {
  public constructor(
    private readonly reservations: ReservationsRepository,
    private readonly rentalsService: RentalsService,
    private readonly spaces: SpacesService,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Cotización (SOLO LECTURA)
  // ==========================================================================

  /**
   * `GET /reservations/quote` — precio y disponibilidad, SIN ESCRIBIR NADA.
   *
   * Es una consulta, no una operación: si hay conflicto devuelve `200` con
   * `isAvailable = false` y la reserva que estorba, NO un 409 (API.md 7.8). Por
   * eso NO se abre transacción de escritura: se lee y ya está. El service ni
   * siquiera llama a `runInTransactionSync`, precisamente para que sea imposible
   * que un "quote" escriba algo por accidente.
   */
  public quote(
    input: { readonly chairId: number; readonly startAt: string; readonly endAt: string },
    context: ReservationsRequestContext,
  ): ReservationQuote {
    const chair = this.spaces.requireChair(input.chairId, context.actor.businessId);
    if (chair.is_bookable === 0 || chair.is_active === 0) {
      throw new NotFoundError('La silla no existe o no admite reservas', {
        details: { id: input.chairId, type: 'chair' },
      });
    }
    const window = this.assertWindow(input.startAt, input.endAt, context.actor.businessId);
    const settings = this.spaces.requireBusinessSettings(context.actor.businessId);
    const activeRental = this.rentalsService.findActiveRental(
      context.actor.businessId,
      input.chairId,
    );
    const conflict = this.reservations.findOverlapping(
      context.actor.businessId,
      input.chairId,
      window.startAt,
      window.endAt,
      null,
    );
    const chairView = toChairView(chair);
    const durationMinutes = window.durationMinutes;
    const pricePerHourMinor = chair.price_per_hour_minor;
    const subtotalMinor = projectRentalMinor(durationMinutes, pricePerHourMinor);
    // BR-TAX-007: la línea de alquiler usa la tasa del negocio, no la de un
    // producto, y la extensión y el overage se gravan a la misma tasa.
    const taxMinor = settings.tax_inclusive === 1 ? 0 : applyTaxBp(subtotalMinor, settings.tax_rate_bp);
    const serviceFeeMinor = applyTaxBp(subtotalMinor, settings.service_fee_bp);
    const totalMinor = subtotalMinor + taxMinor + serviceFeeMinor;

    const isBookableStatus = chair.status === ChairStatus.AVAILABLE || chair.status === ChairStatus.RESERVED;
    return {
      chair: {
        id: chair.id,
        code: chair.code,
        name: chair.name,
        kind: chair.kind,
        capacity: chair.capacity,
        pricePerHourMinor: chair.price_per_hour_minor,
        // `features` sale del MISMO mapeo que `GET /chairs/:id`: la app del
        // cliente no puede ver en la cotización etiquetas que en la ficha no
        // ve, así que las dos respuestas se derivan de una única fuente.
        features: chairView.features,
      },
      zone: { id: chair.zone_id, name: chair.zone_name },
      startAt: window.startAt,
      endAt: window.endAt,
      durationMinutes,
      billableMinutes: Math.max(durationMinutes, 30),
      minApplied: durationMinutes < 30,
      pricePerHourMinor,
      subtotalMinor,
      discountMinor: 0,
      taxMinor,
      serviceFeeMinor,
      totalMinor,
      taxRateBp: settings.tax_rate_bp,
      isAvailable:
        isBookableStatus && conflict === null && activeRental === null,
      conflict:
        conflict === null
          ? null
          : {
              id: conflict.id,
              code: conflict.code,
              status: conflict.status,
              startAt: conflict.start_at,
              endAt: conflict.end_at,
            },
      appliedRules: RESERVATION_APPLIED_RULES,
    };
  }

  // ==========================================================================
  // Listados
  // ==========================================================================

  /** `GET /reservations` — listado paginado. Un CUSTOMER sólo ve los suyos. */
  public list(filter: ReservationListFilter, context: ReservationsRequestContext): ReservationPage {
    const scoped = this.scopedFilter(filter, context.actor);
    const countsByStatus: Record<string, number> = {};
    for (const entry of this.reservations.countByStatus(scoped)) {
      countsByStatus[entry.status] = (countsByStatus[entry.status] ?? 0) + entry.total;
    }
    return {
      items: this.reservations.list(scoped).map((row) => toReservationView(row)),
      total: this.reservations.count(scoped),
      countsByStatus,
    };
  }

  /** `GET /reservations/:id` — detalle con silla, cliente, alquiler y cronología. */
  public getById(reservationId: number, context: ReservationsRequestContext): ReservationDetail {
    const row = this.requireReservation(reservationId, context.actor.businessId);
    this.assertCanAccess(row, context.actor);
    return this.toDetail(row, context);
  }

  // ==========================================================================
  // Alta
  // ==========================================================================

  /**
   * `POST /reservations` — alta de reserva. Ver la cabecera del fichero: los
   * ocho pasos van dentro de UNA `BEGIN IMMEDIATE`.
   */
  public create(input: CreateReservationInput, context: ReservationsRequestContext): ReservationView {
    return runInTransactionSync((tx) => {
      // 1. La silla tiene que ser reservable y estar en un estado que admita
      //    reservas (BR-RES-005). Un `OCCUPIED` NO admite reserva: el cliente
      //    con una reserva futura entra por check-in o camina a otra silla.
      const chair = this.spaces.requireChair(input.chairId, context.actor.businessId);
      this.assertBookable(chair.is_active === 1, chair.is_bookable === 1, chair.status, input.chairId);

      const window = this.assertWindow(input.startAt, input.endAt, context.actor.businessId);

      // 2. VERIFICACIÓN DE SOLAPAMIENTO, dentro de la misma transacción
      //    (BR-RES-002, DESIGN.md 8.3). Este es el paso que hace que el sistema
      //    sea correcto: fuera de la transacción sería una carrera.
      const conflict = this.reservations.findOverlapping(
        context.actor.businessId,
        input.chairId,
        window.startAt,
        window.endAt,
        null,
        tx,
      );
      if (conflict !== null) {
        throw new ConflictError('La silla ya está reservada en esa franja horaria', {
          details: {
            code: CONFLICT_DETAIL_CODE.CHAIR_ALREADY_RESERVED,
            ruleId: 'BR-RES-002',
            conflictingReservationCode: conflict.code,
            conflictingStartAt: conflict.start_at,
            conflictingEndAt: conflict.end_at,
          },
        });
      }

      // 4. Precio congelado y proyección. Mismo precio que aceptaría el cliente
      //    más tarde aunque la tarifa cambie mañana (BR-PRICE-010).
      const pricePerHourMinor = chair.price_per_hour_minor;
      const rentalTotalMinor = projectRentalMinor(window.durationMinutes, pricePerHourMinor);

      // 5. Código con la secuencia, leída dentro de la transacción.
      const code = generateReservationCode(tx);
      const customerId = this.resolveCustomerId(input, context.actor);

      // 6. Inserción. La reserva nace `PENDING`: confirmarla es lo que revalida
      //    el solapamiento y activa el índice parcial de unicidad.
      const reservationId = this.reservations.insert(
        {
          businessId: context.actor.businessId,
          locationId: chair.location_id,
          zoneId: chair.zone_id,
          chairId: chair.id,
          customerId,
          code,
          startAt: window.startAt,
          endAt: window.endAt,
          durationMinutes: window.durationMinutes,
          pricePerHourMinor,
          rentalTotalMinor,
          source: input.source,
          createdBy: context.actor.id,
          notes: input.notes,
        },
        tx,
      );

      // 7. Si la reserva empieza AHORA, la silla queda reservada: es lo que ve el
      //    cliente en su app y lo que impide que otra persona la reserve. Las
      //    reservas futuras no cambian el estado de la silla (DESIGN.md 6.4).
      if (chair.status === ChairStatus.AVAILABLE && window.startsNow) {
        this.spaces.markReservedForBooking(chair.id, reservationId, context, tx);
      }

      const row = this.requireReservation(reservationId, context.actor.businessId);

      // 8. Auditoría (BR-SEC-007).
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.reservation,
        entityId: reservationId,
        actor: this.auditActor(context),
        request: context.request,
        afterData: {
          id: row.id,
          code: row.code,
          chairId: row.chair_id,
          chairCode: row.chair_code,
          status: row.status,
          startAt: row.start_at,
          endAt: row.end_at,
          durationMinutes: row.duration_minutes,
          pricePerHourMinor: row.price_per_hour_minor,
          rentalTotalMinor: row.rental_total_minor,
          customerId: row.customer_id,
        },
      });

      return toReservationView(row);
    });
  }

  // ==========================================================================
  // Transiciones
  // ==========================================================================

  /**
   * `POST /reservations/:id/confirm` — `PENDING -> CONFIRMED`.
   *
   * Revalida el solapamiento DENTRO de la transacción (BR-RES-002) y pone la
   * silla en `RESERVED`. Es aquí donde la garantía se decide de verdad: si dos
   * reservas `PENDING` de la misma silla se confirman a la vez, la segunda
   * recibe 409 en lugar de una doble reserva confirmada. Ese control es
   * transaccional y por silla; el índice único parcial que también lo cubría
   * (`ux_chair_res_active`) se eliminó en `0002_fix_chair_reservation_index.sql`
   * porque rechazaba confirmar reservas de ventanas que no se solapaban.
   *
   * Idempotente: si ya está `CONFIRMED`, devuelve 200 con el estado actual.
   */
  public confirm(reservationId: number, context: ReservationsRequestContext): ReservationView {
    return runInTransactionSync((tx) => {
      const before = this.requireReservation(reservationId, context.actor.businessId);
      this.assertCanAccess(before, context.actor);
      if (before.status === ReservationStatus.CONFIRMED) {
        return toReservationView(before);
      }
      assertReservationTransition(before.status, ReservationStatus.CONFIRMED);

      const conflict = this.reservations.findOverlapping(
        context.actor.businessId,
        before.chair_id,
        before.start_at,
        before.end_at,
        before.id,
        tx,
      );
      if (conflict !== null) {
        throw new ConflictError('La silla ya tiene otra reserva confirmada en esa franja', {
          details: {
            code: CONFLICT_DETAIL_CODE.CHAIR_ALREADY_RESERVED,
            ruleId: 'BR-RES-002',
            conflictingReservationCode: conflict.code,
            conflictingStartAt: conflict.start_at,
            conflictingEndAt: conflict.end_at,
          },
        });
      }
      this.reservations.updateStatus(before.id, ReservationStatus.CONFIRMED, tx);

      const chair = this.spaces.requireChair(before.chair_id, context.actor.businessId);
      if (chair.status === ChairStatus.AVAILABLE) {
        this.spaces.markReservedForBooking(before.chair_id, before.id, context, tx);
      }

      const after = this.requireReservation(before.id, context.actor.businessId);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.reservation,
        entityId: before.id,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: before.id, status: before.status },
        afterData: { id: after.id, status: after.status },
      });
      return toReservationView(after);
    });
  }

  /**
   * `POST /reservations/:id/cancel` — cancelación con motivo obligatorio.
   *
   * Libera la silla SÓLO si nadie la está ocupando: si el cliente ya hizo
   * check-in, la reserva está `ACTIVE` y la silla `OCCUPIED`, y cancelar la
   * reserva no libera la silla (el alquiler sigue vivo y hay que cerrarlo). Es
   * además la transición que sólo puede hacer un MANAGER (DESIGN.md 6.2).
   */
  public cancel(
    reservationId: number,
    reason: string,
    context: ReservationsRequestContext,
  ): ReservationView {
    return runInTransactionSync((tx) => {
      const before = this.requireReservation(reservationId, context.actor.businessId);
      this.assertCanAccess(before, context.actor);
      assertReservationTransition(before.status, ReservationStatus.CANCELLED);
      if (before.status === ReservationStatus.CANCELLED) {
        return toReservationView(before);
      }

      const cancelledAt = nowIso();
      this.reservations.markCancelled(before.id, ReservationStatus.CANCELLED, cancelledAt, reason, tx);

      // Liberación de la silla: sólo si estaba RESERVED por ESTA reserva. Con una
      // reserva confirmada posterior, la silla se queda `RESERVED` (D10).
      const chair = this.spaces.requireChair(before.chair_id, context.actor.businessId);
      if (chair.status === ChairStatus.RESERVED) {
        const stillBooked = this.reservations
          .listBlockingForChair(context.actor.businessId, before.chair_id, cancelledAt)
          .some((entry) => entry.id !== before.id);
        if (!stillBooked) {
          this.spaces.markAvailableAfterRelease(before.chair_id, before.id, context, tx);
        }
      }

      const after = this.requireReservation(before.id, context.actor.businessId);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.reservation,
        entityId: before.id,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: before.id, status: before.status },
        afterData: { id: after.id, status: after.status, cancelledAt, cancelReason: reason },
      });
      return toReservationView(after);
    });
  }

  /**
   * `POST /reservations/:id/check-in` — `CONFIRMED -> ACTIVE`.
   *
   * Hace las cuatro cosas de DESIGN.md 6.2 en UNA transacción:
   *   1. `checked_in_at = now` (el CHECK de la tabla lo exige junto al estado).
   *   2. Crea el `chair_rentals` con el precio CONGELADO de la reserva: es el
   *      mismo que aceptó el cliente, no el vigente de la silla.
   *   3. La silla pasa a `OCCUPIED` con `status_changed_at = now`.
   *   4. Audita las dos entidades.
   *
   * Si la silla está ocupada por un walk-in que se pasó de hora, se rechaza con
   * 409 `CHAIR_OCCUPIED` (BR-RES-009).
   *
   * `PENDING -> ACTIVE` NO existe: la máquina de estados la prohíbe porque la
   * confirmación es la que revalida el solapamiento. Hay que llamar antes a
   * `POST /reservations/:id/confirm`.
   */
  public checkIn(
    reservationId: number,
    input: { readonly actualStartAt: string | null; readonly notes: string | null },
    context: ReservationsRequestContext,
  ): ReservationCheckInResult {
    return runInTransactionSync((tx) => {
      const before = this.requireReservation(reservationId, context.actor.businessId);
      this.assertCanAccess(before, context.actor);
      assertReservationTransition(before.status, ReservationStatus.ACTIVE);

      const chair = this.spaces.requireChair(before.chair_id, context.actor.businessId);
      if (chair.status === ChairStatus.OCCUPIED) {
        throw new ConflictError('La silla está ocupada por otro alquiler', {
          details: {
            code: CONFLICT_DETAIL_CODE.CHAIR_OCCUPIED,
            chairId: chair.id,
            chairCode: chair.code,
          },
        });
      }
      if (chair.status === ChairStatus.BLOCKED || chair.status === ChairStatus.MAINTENANCE) {
        throw new BusinessRuleError('La silla no está disponible para el check-in', {
          details: { code: 'CHAIR_NOT_BOOKABLE', chairId: chair.id, status: chair.status },
        });
      }

      const startedAt = input.actualStartAt ?? nowIso();
      // El alquiler se materializa con la duración y el precio de la reserva.
      const rental = this.rentalsService.openForReservation(tx, before, chair, context, startedAt);
      this.reservations.markCheckedIn(before.id, ReservationStatus.ACTIVE, startedAt, tx);
      const occupied = this.spaces.occupyChair(chair.id, context, tx);

      const after = this.requireReservation(before.id, context.actor.businessId);
      this.audit.record({
        action: AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.reservation,
        entityId: before.id,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: before.id, status: before.status },
        afterData: {
          id: after.id,
          status: after.status,
          checkedInAt: after.checked_in_at,
          rentalId: rental.id,
          rentalCode: rental.code,
        },
      });

      return {
        reservation: toReservationView(after),
        rental: this.rentalsService.toView(rental),
        chair: occupied,
        warnings: [],
      };
    });
  }

  /**
   * `POST /reservations/:id/extend` — extiende la reserva.
   *
   * No disponible si la reserva ya está `ACTIVE` (BR-RES-012): una vez iniciada la
   * sesión, lo que se extiende es el ALQUILER (`POST /rentals/:id/extend`), que
   * es quien cobra el excedente. Reservas y alquileres tienen ciclos de vida
   * distintos a partir del check-in.
   *
   * Recalcula `duration_minutes` y `rental_total_minor` con el MISMO precio
   * congelado (BR-RES-010: la extensión no altera el precio) y revalida que la
   * ventana nueva no choque con otra reserva ni con un alquiler posterior.
   */
  public extend(
    reservationId: number,
    newEndAt: string,
    context: ReservationsRequestContext,
  ): ReservationView {
    return runInTransactionSync((tx) => {
      const before = this.requireReservation(reservationId, context.actor.businessId);
      this.assertCanAccess(before, context.actor);
      if (before.status === ReservationStatus.ACTIVE) {
        throw new BusinessRuleError('La reserva ya está en uso: extienda el alquiler, no la reserva', {
          details: {
            code: 'RESERVATION_ALREADY_ACTIVE',
            ruleId: 'BR-RES-012',
            reservationId,
            hint: 'Use POST /api/v1/rentals/{id}/extend.',
          },
        });
      }
      assertNotTerminalReservation(before.status);
      if (newEndAt <= before.end_at) {
        throw new ValidationError('La nueva hora de fin debe ser posterior a la actual', {
          details: [
            {
              path: 'newEndAt',
              message: '`newEndAt` debe ser posterior al `endAt` actual',
              code: 'INVALID_DATE_RANGE',
            },
          ],
        });
      }
      const settings = this.spaces.requireBusinessSettings(context.actor.businessId);
      const durationMinutes = ceilDiffMinutes(before.start_at, newEndAt);
      if (durationMinutes > settings.max_reservation_minutes) {
        throw new BusinessRuleError('La reserva supera la duración máxima del negocio', {
          details: {
            code: 'RESERVATION_TOO_LONG',
            ruleId: 'BR-RENTAL-010',
            durationMinutes,
            maxReservationMinutes: settings.max_reservation_minutes,
          },
        });
      }

      // La ventana nueva no puede pisar otra reserva (BR-RES-010) ni el alquiler
      // que ya estivería abierto en esa silla.
      const conflict = this.reservations.findOverlapping(
        context.actor.businessId,
        before.chair_id,
        before.start_at,
        newEndAt,
        before.id,
        tx,
      );
      if (conflict !== null) {
        throw new ConflictError('Hay otra reserva que ocupa esa silla en la ventana nueva', {
          details: {
            code: CONFLICT_DETAIL_CODE.CHAIR_ALREADY_RESERVED,
            conflictingReservationCode: conflict.code,
            conflictingStartAt: conflict.start_at,
            conflictingEndAt: conflict.end_at,
          },
        });
      }
      const activeRental = this.rentalsService.findActiveRental(
        context.actor.businessId,
        before.chair_id,
      );
      if (activeRental !== null && overlaps(before.end_at, newEndAt, activeRental.start_at, activeRental.end_at)) {
        throw new ConflictError('La silla tiene un alquiler abierto que choca con la ventana nueva', {
          details: {
            code: CONFLICT_DETAIL_CODE.CHAIR_ALREADY_RESERVED,
            activeRentalCode: activeRental.code,
            activeRentalEndAt: activeRental.end_at,
          },
        });
      }

      // El precio NO cambia (BR-RES-010): sólo se recalcula el importe proyectado.
      const rentalTotalMinor = projectRentalMinor(durationMinutes, before.price_per_hour_minor);
      this.reservations.updateWindow(before.id, newEndAt, durationMinutes, rentalTotalMinor, tx);

      const after = this.requireReservation(before.id, context.actor.businessId);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.reservation,
        entityId: before.id,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: before.id, endAt: before.end_at, durationMinutes: before.duration_minutes, rentalTotalMinor: before.rental_total_minor },
        afterData: { id: after.id, endAt: after.end_at, durationMinutes: after.duration_minutes, rentalTotalMinor: after.rental_total_minor },
      });
      return toReservationView(after);
    });
  }

  /**
   * `POST /reservations/:id/complete` — `ACTIVE -> COMPLETED` (check-out).
   *
   * Cierra el alquiler asociado calculando `billed_minutes` reales y el overage al
   * precio congelado (BR-RENTAL-003/004) y devuelve el desglose del cobro. Es la
   * operación que "materializa" la reserva en dinero cobrado.
   */
  public complete(
    reservationId: number,
    input: { readonly endAt: string | null; readonly reportIssue: string | null },
    context: ReservationsRequestContext,
  ): ReservationCompleteResult {
    return runInTransactionSync((tx) => {
      const before = this.requireReservation(reservationId, context.actor.businessId);
      this.assertCanAccess(before, context.actor);
      assertReservationTransition(before.status, ReservationStatus.COMPLETED);

      const settings = this.spaces.requireBusinessSettings(context.actor.businessId);
      const endedAt = input.endAt ?? nowIso();
      const liveRental = this.listRentalsOf(before).find(
        (row) => row.status === 'ACTIVE' || row.status === 'EXTENDED',
      );

      // El cierre del alquiler calcula los minutos reales y el overage al precio
      // CONGELADO, y libera la silla. Vive en el service de alquileres y anida su
      // transacción con un SAVEPOINT: si algo falla, no queda alquiler cerrado ni
      // reserva completada (BR-RENTAL-003, BR-RES-008).
      const closed =
        liveRental === undefined
          ? null
          : this.rentalsService.completeForReservation(liveRental, endedAt, context, tx);
      this.reservations.markCheckedOut(before.id, ReservationStatus.COMPLETED, endedAt, tx);

      const after = this.requireReservation(before.id, context.actor.businessId);
      this.audit.record({
        action: AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.reservation,
        entityId: before.id,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: before.id, status: before.status },
        afterData: {
          id: after.id,
          status: after.status,
          checkedOutAt: after.checked_out_at,
          ...(liveRental === undefined ? {} : { rentalId: liveRental.id, rentalCode: liveRental.code }),
          ...(input.reportIssue === null ? {} : { reportIssue: input.reportIssue }),
        },
      });

      return {
        reservation: toReservationView(after),
        // El alquiler del check-out se devuelve resumido: la respuesta de la
        // reserva no necesita repetir el desglose que ya va en `charge`.
        rental: closed === null ? null : toRentalSummary(closed.rentalRow),
        charge:
          closed === null
            ? toReservationChargeView(
            computeRentalCharge({
              startAt: after.start_at,
              plannedEndAt: after.end_at,
              plannedMinutes: after.duration_minutes,
              extensionsMinor: 0,
              pricePerHourMinor: after.price_per_hour_minor,
              endedAt,
              taxRateBp: settings.tax_rate_bp,
              serviceFeeBp: settings.service_fee_bp,
              taxInclusive: settings.tax_inclusive === 1,
              waiveOvertime: false,
            }),
              settings.currency_code,
            )
            : toReservationChargeViewFromRental(closed.charge),
      };
    });
  }

  // ==========================================================================
  // Expiración (BR-RES-004) — job del sistema
  // ==========================================================================

  /**
   * Marca `EXPIRED` las reservas vencidas (BR-RES-004):
   *  - `PENDING` con `now > start_at + 30 min` sin check-in (no show).
   *  - `CONFIRMED` con `now > end_at` sin check-in.
   *
   * ============================================================================
   * POR QUÉ NO HAY UN SCHEDULER EN ESTE FICHERO
   * ============================================================================
   * El documento de diseño lo coloca en `src/worker/`, que no existe todavía y
   * whose wiring (`modules/index.ts`) no me corresponde. Lo que sí se hace aquí es
   * dejar la FUNCIÓN de servicio, parametrizada por el reloj, lista para que la
   * invoque el worker o el endpoint de sistema
   * `POST /api/v1/system/jobs/expire-reservations` (ver `reservations.jobs.ts`).
   * La función es idempotente: ejecutarla dos veces no cambia nada la segunda vez,
   * porque las reservas ya expiradas ya no están en `PENDING`/`CONFIRMED`.
   *
   * @param nowIsoText Instante de referencia. Por defecto `nowIso()`. Se inyecta
   *        para que el test pueda simular el paso del tiempo sin esperar.
   */
  public expireOverdueReservations(
    nowIsoText: string = nowIso(),
    limit = 200,
  ): ExpireReservationsResult {
    return runInTransactionSync((tx) => {
      const businessId = this.defaultBusinessId();
      const pendingDeadline = addMinutes(nowIsoText, -RESERVATION.PENDING_GRACE_MINUTES);
      const overdue = this.reservations.listOverdue(businessId, pendingDeadline, nowIsoText, limit, tx);
      const codes: string[] = [];
      for (const row of overdue) {
        // La transición la fija la máquina de estados: `PENDING -> EXPIRED` y
        // `CONFIRMED -> EXPIRED` sólo las puede ejecutar el SYSTEM, que es
        // exactamente lo que representa este job.
        assertReservationTransition(row.status, ReservationStatus.EXPIRED);
        this.reservations.updateStatus(row.id, ReservationStatus.EXPIRED, tx);
        // La silla vuelve a estar disponible si la reserva vencida era la que la
        // tenía en `RESERVED`.
        const chair = this.spaces.findChairForJob(row.chair_id, businessId);
        if (chair !== null && chair.status === ChairStatus.RESERVED) {
          this.spaces.markAvailableAfterRelease(row.chair_id, row.id, SYSTEM_JOB_CONTEXT, tx);
        }
        codes.push(row.code);
        this.audit.record({
          action: AuditAction.UPDATE,
          entityType: AuditEntityType.reservation,
          entityId: row.id,
          actor: null,
          request: null,
          beforeData: { id: row.id, status: row.status },
          afterData: { id: row.id, status: ReservationStatus.EXPIRED, at: nowIsoText, cause: 'system_job' },
          businessId,
        });
      }
      return { expired: codes.length, codes, at: nowIsoText };
    });
  }

  // ==========================================================================
  // Utilidades internas
  // ==========================================================================

  /** Reserva obligatoria: 404 si no existe o es de otro negocio. */
  requireReservation(reservationId: number, businessId: number): ReservationRow {
    const row = this.reservations.findById(reservationId, businessId);
    if (row === null) {
      throw new NotFoundError('La reserva no existe', { details: { id: reservationId, type: 'reservation' } });
    }
    return row;
  }

  /** Silla reservable (BR-RES-005). */
  private assertBookable(isActive: boolean, isBookable: boolean, status: ChairStatus, chairId: number): void {
    if (isActive !== true || isBookable !== true) {
      throw new BusinessRuleError('La silla no admite reservas', {
        details: { code: 'CHAIR_NOT_BOOKABLE', ruleId: 'BR-RES-005', chairId },
      });
    }
    if (status !== ChairStatus.AVAILABLE && status !== ChairStatus.RESERVED) {
      throw new BusinessRuleError(`La silla no admite reservas en estado ${status}`, {
        details: { code: 'CHAIR_NOT_BOOKABLE', ruleId: 'BR-RES-005', chairId, status },
      });
    }
  }

  /**
   * Valida la ventana `[startAt, endAt)` y devuelve sus minutos.
   *
   * Cuatro reglas en un sitio, porque las cuatro se repiten en `create`,
   * `quote` y `extend`:
   *  - `end > start` (CHECK `ck_chair_reservations_window`).
   *  - Duración `<= max_reservation_minutes` del negocio (BR-RENTAL-010).
   *  - `start_at` no más de 5 minutos en el pasado (API.md 7.8 `PAST_DATE`).
   *  - Duración `<= 1440` (CHECK `ck_chair_reservations_duration`).
   */
  private assertWindow(
    startAt: string,
    endAt: string,
    businessId: number,
  ): { readonly startAt: string; readonly endAt: string; readonly durationMinutes: number; readonly startsNow: boolean } {
    if (endAt <= startAt) {
      throw new ValidationError('La hora de fin debe ser posterior a la de inicio', {
        details: [{ path: 'endAt', message: '`endAt` debe ser posterior a `startAt`', code: 'INVALID_DATE_RANGE' }],
      });
    }
    const now = nowIso();
    if (startAt < addMinutes(now, -PAST_TOLERANCE_MINUTES)) {
      throw new BusinessRuleError('La hora de inicio está en el pasado', {
        details: {
          code: 'INVALID_ADVANCE_TIME',
          ruleId: 'BR-RES-006',
          startAt,
          toleranceMinutes: PAST_TOLERANCE_MINUTES,
        },
      });
    }
    const settings = this.spaces.requireBusinessSettings(businessId);
    const durationMinutes = ceilDiffMinutes(startAt, endAt);
    if (durationMinutes > settings.max_reservation_minutes) {
      throw new BusinessRuleError('La reserva supera la duración máxima del negocio', {
        details: {
          code: 'RESERVATION_TOO_LONG',
          ruleId: 'BR-RENTAL-010',
          durationMinutes,
          maxReservationMinutes: settings.max_reservation_minutes,
        },
      });
    }
    // `startsNow`: la reserva empieza de aquí a menos de la tolerancia. Es lo que
    // hace que la silla pase a `RESERVED` en el alta (paso 7 de `create`).
    const startsNow = startAt <= addMinutes(now, PAST_TOLERANCE_MINUTES);
    return { startAt, endAt, durationMinutes, startsNow };
  }

  /**
   * `customerId` de la reserva. El alcance lo decide el servidor, nunca el
   * cliente (API.md 2, marca `P` de la matriz en DESIGN.md 9.3).
   *
   * - Un `CUSTOMER` (sin rol de sala) queda atado a SU id: el `customerId` del
   *   cuerpo se descarta tanto si es el de otro usuario como si es `null`. Es
   *   lo que impide crear una reserva a nombre de un tercero o una reserva de
   *   mostrador sin dueño, que bloquearía la silla para todos y sobre la que
   *   el atacante ya no podría ni operar.
   * - El personal de sala sí puede registrar en mostrador la reserva de alguien
   *   que no tiene cuenta, o en nombre de un cliente concreto. Para eso está
   *   `reservations:create` con marca `C` y `customer_id` NULLABLE en el
   *   esquema; aquí es el único camino que produce un `null`.
   */
  private resolveCustomerId(input: CreateReservationInput, actor: UserContext): number | null {
    // `every` y no `includes`: un `CUSTOMER` que además tenga un rol de sala es,
    // para estos efectos, personal. Es el mismo criterio que usa
    // `OrdersService.resolveCustomerId`, para que cliente y reserva no se
    // comporten de forma distinta ante el mismo actor.
    const isPlainCustomer = actor.roles.every((role) => role === Role.CUSTOMER);
    if (isPlainCustomer) {
      return actor.id;
    }
    return input.customerId;
  }

  /**
   * Un `CUSTOMER` sólo ve y toca sus propias reservas (API.md 7.8, marca `P`).
   * El filtro del cliente se sobrescribe aquí: el alcance lo decide el service.
   */
  private scopedFilter(filter: ReservationListFilter, actor: UserContext): ReservationListFilter {
    if (actor.permissions.includes(PERMISSION.RESERVATIONS_READ_ANY) || actor.roles.some((role) => FLOOR_ROLES.includes(role))) {
      return filter;
    }
    return { ...filter, customerId: actor.id };
  }

  /**
   * Un cliente no puede leer ni tocar la reserva de otro: 404, no 403.
   *
   * Dos casos, y los dos importan:
   *  - Reserva de OTRO cliente (`customer_id` != actor y != `null`): fuera.
   *  - Reserva de mostrador (`customer_id IS NULL`): también fuera. No es
   *    "de todos" ni es "de nadie": sigue siendo de un tercero que no tiene
   *    cuenta, y devolverla a un `CUSTOMER` filtraría la agenda del local y le
   *    dejaría cancelar (`reservations:cancel`, marca `P`) y confirmar
   *    (`reservations:update`, marca `P`) una reserva que no es suya.
   *
   * El alcance de sala (STAFF y superiores) se concede por rol, que es la
   * matriz de DESIGN.md 9.3 leída al revés: el personal atiende el mostrador.
   */
  private assertCanAccess(row: ReservationRow, actor: UserContext): void {
    if (actor.roles.some((role) => FLOOR_ROLES.includes(role))) {
      return;
    }
    if (row.customer_id !== null && row.customer_id === actor.id) {
      return;
    }
    throw new NotFoundError('La reserva no existe', { details: { id: row.id, type: 'reservation' } });
  }

  /** Detalle con la sesión viva y la cronología de estados. */
  private toDetail(row: ReservationRow, context: ReservationsRequestContext): ReservationDetail {
    const chair = this.spaces.requireChair(row.chair_id, context.actor.businessId);
    const rentalRows = this.listRentalsOf(row);
    const timeline = buildTimeline(row);
    return {
      reservation: toReservationView(row),
      chair: toChairView(chair),
      currentRental: rentalRows.length === 0 ? null : toRentalSummary(rentalRows[rentalRows.length - 1] as RentalRow),
      timeline,
    };
  }

  /** Alquileres asociados a una reserva. */
  private listRentalsOf(row: ReservationRow): readonly RentalRow[] {
    return this.rentalsService.listRentalsOfReservation(row.id);
  }

  /** Negocio por defecto del despliegue: v1 tiene un único negocio sembrado. */
  private defaultBusinessId(): number {
    return DEFAULT_BUSINESS_ID;
  }

  /** Actor normalizado para `audit.record`. */
  private auditActor(context: ReservationsRequestContext): {
    readonly id: number;
    readonly email: string;
    readonly businessId: number;
  } {
    return { id: context.actor.id, email: context.actor.email, businessId: context.actor.businessId };
  }
}

// --------------------------------------------------------------------------
// Helpers de proyección y validación
// --------------------------------------------------------------------------

/** Identidad de negocio por defecto (DESIGN.md 4.2, `AUTH.DEFAULT_BUSINESS_ID`). */
const DEFAULT_BUSINESS_ID = 1;

/**
 * Contexto de auditoría del job de expiración.
 *
 * No hay actor humano: el `SYSTEM` de la máquina de estados es quien actúa, así
 * que `user_id` queda NULL en `audit_logs` y el evento se identifica por la causa
 * (`cause: 'system_job'`). Es la misma convención que usa `order_status_history`
 * con `changed_by = NULL` para el scheduler.
 */
const SYSTEM_JOB_CONTEXT: ReservationsRequestContext = {
  actor: {
    id: 0,
    email: 'system@lattecoffe.internal',
    fullName: 'Sistema',
    businessId: DEFAULT_BUSINESS_ID,
    status: 'ACTIVE',
    isStaff: true,
    roles: [Role.ADMIN],
    permissions: [],
  },
  request: { ipAddress: null, userAgent: null, requestId: null },
};

/** Fila de reserva -> `Reservation` de la API (API.md 6.3). */
export function toReservationView(row: ReservationRow): ReservationView {
  return {
    id: row.id,
    code: row.code,
    businessId: row.business_id,
    locationId: row.location_id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    chairId: row.chair_id,
    chairCode: row.chair_code,
    customerId: row.customer_id,
    customerName: row.customer_name,
    orderId: row.order_id,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    durationMinutes: row.duration_minutes,
    pricePerHourMinor: row.price_per_hour_minor,
    rentalTotalMinor: row.rental_total_minor,
    checkedInAt: row.checked_in_at,
    checkedOutAt: row.checked_out_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Un estado terminal no admite más salidas (DESIGN.md 6.2). */
function assertNotTerminalReservation(status: ReservationStatus): void {
  if (isTerminalReservationStatus(status)) {
    throw new BusinessRuleError(`La reserva está en ${status} y no admite más cambios`, {
      details: { code: 'INVALID_RESERVATION_TRANSITION', from: status, to: 'ANY' },
    });
  }
}

/**
 * Desglose del alquiler -> `charge` de la respuesta de la reserva.
 *
 * Se adapta el mismo desglose que devuelve el cierre de alquiler para que el
 * cliente que sólo conoce reservas vea un único vocabulario de cobro.
 */
function toReservationChargeView(
  charge: ReturnType<typeof computeRentalCharge>,
  currencyCode: string,
): ReservationChargeView {
  return {
    billedMinutes: charge.billedMinutes,
    minimumApplied: charge.minimumApplied,
    extraMinutes: charge.extraMinutes,
    pricePerHourMinor: charge.pricePerHourMinor,
    subtotalMinor: charge.subtotalMinor,
    extensionsMinor: charge.extensionsMinor,
    extraMinutesMinor: charge.extraMinutesMinor,
    totalMinor: charge.totalMinor,
    taxMinor: charge.taxMinor,
    serviceFeeMinor: charge.serviceFeeMinor,
    grandTotalMinor: charge.grandTotalMinor,
    currencyCode,
  };
}

/** Desglose del alquiler cerrado -> `charge` de la respuesta de la reserva. */
function toReservationChargeViewFromRental(charge: {
  readonly billedMinutes: number;
  readonly minimumApplied: boolean;
  readonly overtimeMinutes: number;
  readonly pricePerHourMinor: number;
  readonly subtotalMinor: number;
  readonly extensionsMinor: number;
  readonly extraMinutesMinor: number;
  readonly totalMinor: number;
  readonly taxMinor: number;
  readonly serviceFeeMinor: number;
  readonly grandTotalMinor: number;
  readonly currencyCode: string;
  readonly waivedMinor: number;
}): ReservationChargeView {
  return {
    billedMinutes: charge.billedMinutes,
    minimumApplied: charge.minimumApplied,
    extraMinutes: charge.overtimeMinutes,
    pricePerHourMinor: charge.pricePerHourMinor,
    subtotalMinor: charge.subtotalMinor,
    extensionsMinor: charge.extensionsMinor,
    extraMinutesMinor: charge.extraMinutesMinor,
    totalMinor: charge.totalMinor,
    taxMinor: charge.taxMinor,
    serviceFeeMinor: charge.serviceFeeMinor,
    grandTotalMinor: charge.grandTotalMinor,
    currencyCode: charge.currencyCode,
  };
}

/**
 * Cronología de la reserva: los hitos que el cliente ve en su app.
 * Se deriva de las columnas que ya existen, sin tabla de histórico nueva.
 */
function buildTimeline(row: ReservationRow): readonly { at: string; event: string }[] {
  const events: { at: string; event: string }[] = [{ at: row.created_at, event: 'created' }];
  if (row.checked_in_at !== null) {
    events.push({ at: row.checked_in_at, event: 'checked_in' });
  }
  if (row.checked_out_at !== null) {
    events.push({ at: row.checked_out_at, event: 'checked_out' });
  }
  if (row.cancelled_at !== null) {
    events.push({ at: row.cancelled_at, event: 'cancelled' });
  }
  return events;
}
