/**
 * Servicio de espacios: zonas y sillas (API.md 7.6 y 7.7).
 *
 * ============================================================================
 * DÓNDE VIVE CADA DECISIÓN
 * ============================================================================
 * Este fichero decide, y los repositorios sólo ejecutan. Concretamente:
 *  - Qué transiciones de estado de silla son legales: consulta la MÁQUINA DE
 *    ESTADOS compartida (`assertChairTransition` de `shared/domain`), nunca una
 *    comparación suelta de estados (DESIGN.md 6, nota de apertura). Escribir
 *    `if (chair.status === 'X')` aquí sería reimplementar la tabla de
 *    transiciones y es exactamente lo que el contrato prohíbe.
 *  - Qué se puede editar, cuándo un `code` es inmutable (BR-CHAIR-008) y cuándo
 *    una silla no se puede borrar (BR-CHAIR-001).
 *  - Cómo se recalcula `zones.capacity` (BR-CHAIR-005).
 *  - Qué aggregation se devuelve en el mapa y cómo se calcula el porcentaje de
 *    ocupación (BR-CHAIR-006).
 *
 * ============================================================================
 * TRANSACCIONES
 * ============================================================================
 * Toda escritura que toca más de una fila (zona + silla, silla + audit) va dentro
 * de `runInTransactionSync` (DESIGN.md 8.2). Se usa la variante SÍNCRONA y no la
 * asíncrona a propósito: su tsdoc documenta que hacer `await` dentro de la
 * transacción devuelve el control al event loop mientras el lock de escritura
 * sigue retenido, y aquí no hay nada que esperar: `better-sqlite3` es síncrono.
 *
 * ============================================================================
 * AUDITORÍA
 * ============================================================================
 * Toda mutación de silla o zona escribe en `audit_logs` con `entity_type` `chair`
 * y `before_data`/`after_data` acotados a los campos que cambian (BR-SEC-007 y
 * BR-RES-007: un snapshot de la fila entera incluiría `notes` internas y
 *Features, que no son datos de auditoría).
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import type { Db } from '../../shared/database/connection.js';
import {
  AuditAction,
  AuditEntityType,
  ChairStatus,
  Role,
  assertChairTransition,
  isManuallySettable,
} from '../../shared/domain/index.js';
import type { ChairKind, UserContext } from '../../shared/domain/index.js';
import {
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors/index.js';
import { CONFLICT_DETAIL_CODE } from '../../shared/errors/codes.js';
import { addDays, addMinutes, diffMinutes, nowIso, overlaps } from '../../shared/utils/index.js';
import type { AuditService, RequestAuditMeta } from '../../shared/services/index.js';
import { occupancyRateBp, utilizationRateBp } from '../rentals/rental-pricing.js';
import { toRentalSummary, type RentalsRepository } from '../rentals/rentals.repository.js';
import {
  toReservationSummary,
  type ReservationsRepository,
} from '../reservations/reservations.repository.js';
import type {
  BusinessSpaceSettingsRow,
  ChairRow,
  SpacesRepository,
  ZoneRow,
} from './spaces.repository.js';
import {
  emptyChairStatusCounts,
  type AvailabilityRange,
  type AvailabilitySlot,
  type AvailabilityStatus,
  type ChairAvailabilityView,
  type ChairHistoryEntry,
  type ChairHistoryFilter,
  type ChairHistoryPage,
  type ChairListFilter,
  type ChairMapFilter,
  type ChairMapView,
  type ChairPatch,
  type ChairPatchResult,
  type ChairStats,
  type ChairStatusCounts,
  type ChairView,
  type MapTotals,
  type SoftDeleteResult,
  type ZoneBounds,
  type ZoneListFilter,
  type ZoneMapView,
  type ZonePatch,
  type ZoneReorderInput,
  type ZoneView,
} from './spaces.types.js';

/** Contexto de la petición: actor (del token) y datos de red para la auditoría. */
export interface SpacesRequestContext {
  readonly actor: UserContext;
  readonly request: RequestAuditMeta;
}

/** Resultado de un listado de zonas. */
export interface ZonePage {
  readonly items: readonly ZoneView[];
  readonly total: number;
}

/** Resultado de un listado de sillas. */
export interface ChairPage {
  readonly items: readonly ChairView[];
  readonly total: number;
  readonly countsByStatus: ChairStatusCounts;
}

/** Zona con sus sillas y contadores (`GET /zones/:id`). */
export interface ZoneDetail {
  readonly zone: ZoneView;
  readonly chairs: readonly ChairView[];
}

/** Ficha completa de silla (`GET /chairs/:id`). */
export interface ChairDetail {
  readonly chair: ChairView;
  readonly currentReservation: ReturnType<typeof toReservationSummary> | null;
  readonly currentRental: ReturnType<typeof toRentalSummary> | null;
  readonly stats: ChairStats;
}

/** Resultado de bloquear o enviar a mantenimiento. */
export interface ChairActionResult {
  readonly chair: ChairView;
  /** Reservas futuras que la acción afecta, para que la UI avise (API.md 7.7). */
  readonly affectedReservations: readonly { readonly id: number; readonly code: string; readonly startAt: string; readonly endAt: string }[];
  readonly warnings: readonly string[];
}

/** Minutos del mes usados como denominador del aprovechamiento de una silla. */
const UTILIZATION_WINDOW_DAYS = 30;

/** Service de zonas y sillas. */
export class SpacesService {
  public constructor(
    private readonly spaces: SpacesRepository,
    private readonly reservations: ReservationsRepository,
    private readonly rentals: RentalsRepository,
    private readonly audit: AuditService,
  ) {}

  // ==========================================================================
  // Zonas
  // ==========================================================================

  /** `GET /zones` — listado paginado con los contadores de cada zona. */
  public listZones(filter: ZoneListFilter, _context: SpacesRequestContext): ZonePage {
    const rows = this.spaces.listZones(filter);
    // Una consulta para los contadores de TODAS las zonas del filtro, no una por
    // zona: es la diferencia entre 1+N consultas y 2 (DESIGN.md 1.3, criterio 5).
    const counts = this.countsByZone(filter.businessId, filter.locationId);
    return {
      items: rows.map((row) => toZoneView(row, counts.get(row.id) ?? emptyChairStatusCounts())),
      total: this.spaces.countZones(filter),
    };
  }

  /** `GET /zones/:id` — zona con sus sillas. */
  public getZone(zoneId: number, context: SpacesRequestContext): ZoneDetail {
    const row = this.requireZone(zoneId, context.actor.businessId);
    const counts = this.countsByZone(context.actor.businessId, row.location_id);
    const chairs = this.spaces.listChairs(
      {
        businessId: context.actor.businessId,
        zoneId,
        includeInactive: true,
        limit: 500,
        offset: 0,
        sort: { column: 'sort_order', direction: 'ASC' },
      },
    );
    return {
      zone: toZoneView(row, counts.get(zoneId) ?? emptyChairStatusCounts()),
      chairs: chairs.map((rowChair) => toChairView(rowChair)),
    };
  }

  /** `POST /zones` — alta de zona. */
  public createZone(
    input: {
      readonly locationId: number;
      readonly name: string;
      readonly code?: string;
      readonly colorHex: string;
      readonly capacity?: number;
      readonly sortOrder?: number;
      readonly isActive: boolean;
    },
    context: SpacesRequestContext,
  ): { readonly zone: ZoneView; readonly warnings: readonly string[] } {
    const warnings: string[] = [];
    return runInTransactionSync(() => {
      this.requireActiveLocation(input.locationId, context.actor.businessId);

      const warningsHere: string[] = [];
      if (input.capacity !== undefined) {
        // BR-CHAIR-005: `capacity` es la suma de las capacidades de las sillas.
        // Se acepta el campo para no romper a un cliente que lo envía, pero se
        // avisa de que el valor real se recalculará al dar de alta sillas.
        warningsHere.push('CAPACITY_IS_DERIVED');
      }
      const zoneId = this.spaces.insertZone({
        businessId: context.actor.businessId,
        locationId: input.locationId,
        name: input.name,
        code: input.code ?? null,
        colorHex: input.colorHex,
        // Sin sillas todavía, la capacidad derivada es 0. Se escribe 0 y no el
        // valor del cliente para que el mapa nunca muestre una capacidad que
        // ninguna silla respalda.
        sortOrder: input.sortOrder ?? this.spaces.nextZoneSortOrder(input.locationId),
        isActive: input.isActive,
      });
      warnings.push(...warningsHere);

      const row = this.requireZone(zoneId, context.actor.businessId);
      const zone = toZoneView(row, emptyChairStatusCounts());
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.chair,
        entityId: zoneId,
        actor: this.auditActor(context),
        request: context.request,
        afterData: { entity: 'zone', id: zone.id, name: zone.name, code: zone.code, colorHex: zone.colorHex },
      });
      return { zone, warnings };
    });
  }

  /** `PATCH /zones/:id` — edición. `capacity` es de sólo lectura. */
  public updateZone(
    zoneId: number,
    patch: ZonePatch & { readonly capacity?: number },
    context: SpacesRequestContext,
  ): { readonly zone: ZoneView; readonly warnings: readonly string[] } {
    const warnings: string[] = [];
    if (patch.capacity !== undefined) {
      warnings.push('CAPACITY_IS_DERIVED');
    }
    return runInTransactionSync(() => {
      const before = this.requireZone(zoneId, context.actor.businessId);
      this.spaces.updateZone(zoneId, patch);
      // La capacidad es derivada: se recalcula siempre, aunque no venga en el
      // parche, para que un cambio de sillas no deje un número viejo.
      this.spaces.recomputeZoneCapacity(zoneId);
      const after = this.requireZone(zoneId, context.actor.businessId);
      const counts = this.countsByZone(context.actor.businessId, after.location_id);

      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.chair,
        entityId: zoneId,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { entity: 'zone', id: before.id, name: before.name, code: before.code, isActive: before.is_active },
        afterData: { entity: 'zone', id: after.id, name: after.name, code: after.code, isActive: after.is_active },
      });
      return { zone: toZoneView(after, counts.get(zoneId) ?? emptyChairStatusCounts()), warnings };
    });
  }

  /** `DELETE /zones/:id` — soft delete. Bloqueado si la zona tiene sillas activas. */
  public deleteZone(zoneId: number, context: SpacesRequestContext): SoftDeleteResult {
    return runInTransactionSync(() => {
      const before = this.requireZone(zoneId, context.actor.businessId);
      if (before.chair_count > 0) {
        throw new BusinessRuleError('La zona tiene sillas: muévalas de zona o dales de baja primero', {
          details: {
            code: 'ZONE_NOT_EMPTY',
            ruleId: 'BR-CHAIR-005',
            chairCount: before.chair_count,
          },
        });
      }
      const deletedAt = nowIso();
      this.spaces.softDeleteZone(zoneId, deletedAt);
      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.chair,
        entityId: zoneId,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { entity: 'zone', id: before.id, name: before.name },
        afterData: { entity: 'zone', id: zoneId, deletedAt },
      });
      return { id: zoneId, deletedAt };
    });
  }

  /** `POST /zones/reorder` — reordena parcialmente, en una sola transacción. */
  public reorderZones(input: ZoneReorderInput, context: SpacesRequestContext): readonly ZoneView[] {
    return runInTransactionSync(() => {
      this.requireActiveLocation(input.locationId, context.actor.businessId);
      const known = new Set(this.spaces.listZoneIdsByLocation(input.locationId));
      const seen = new Set<number>();
      for (const item of input.items) {
        if (seen.has(item.id)) {
          throw new ValidationError('La lista de zonas contiene ids repetidos', {
            details: [{ path: 'items', message: `El id ${item.id} aparece más de una vez`, code: 'DUPLICATE_ID' }],
          });
        }
        seen.add(item.id);
        if (!known.has(item.id)) {
          throw new ValidationError('Alguna de las zonas no pertenece a esa sede', {
            details: [
              {
                path: 'items',
                message: `La zona ${item.id} no pertenece a la sede ${input.locationId}`,
                code: 'ZONE_LOCATION_MISMATCH',
              },
            ],
          });
        }
      }
      for (const item of input.items) {
        this.spaces.updateZone(item.id, { sortOrder: item.sortOrder });
      }
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.chair,
        entityId: null,
        actor: this.auditActor(context),
        request: context.request,
        afterData: {
          entity: 'zone',
          action: 'reorder',
          locationId: input.locationId,
          items: input.items.map((item) => ({ id: item.id, sortOrder: item.sortOrder })),
        },
      });
      const counts = this.countsByZone(context.actor.businessId, input.locationId);
      return this.spaces
        .listZones({
          businessId: context.actor.businessId,
          locationId: input.locationId,
          includeInactive: true,
          limit: 200,
          offset: 0,
          sort: { column: 'sort_order', direction: 'ASC' },
        })
        .map((row) => toZoneView(row, counts.get(row.id) ?? emptyChairStatusCounts()));
    });
  }

  // ==========================================================================
  // Sillas
  // ==========================================================================

  /** `GET /chairs` — listado paginado con contadores por estado. */
  public listChairs(filter: ChairListFilter, context: SpacesRequestContext): ChairPage {
    this.assertMaySeeInactive(filter.includeInactive, context.actor);
    const rows = this.spaces.listChairs(filter);
    const counts = emptyChairStatusCounts();
    for (const entry of this.spaces.countChairsByStatus(filter)) {
      counts[entry.status] += entry.total;
    }
    return {
      items: rows.map((row) => toChairView(row)),
      total: this.spaces.countChairs(filter),
      countsByStatus: counts,
    };
  }

  /**
   * `GET /chairs/map` — el mapa visual (BR-CHAIR-006).
   *
   * SON EXACTAMENTE DOS CONSULTAS (zonas y sillas): los contadores por estado, los
   * rectángulos de las zonas y los totales se calculan en memoria. Pedir una
   * consulta por zona convertiría un endpoint de 2 en uno de N+1, y este es el
   * endpoint que más veces se llama en una sesión de sala.
   */
  public getMap(filter: ChairMapFilter, context: SpacesRequestContext): ChairMapView {
    this.assertMaySeeInactive(filter.includeInactive, context.actor);
    const location = this.spaces.findLocation(filter.locationId, context.actor.businessId);
    if (location === null) {
      throw new NotFoundError('La sede no existe', {
        details: { id: filter.locationId, type: 'location' },
      });
    }

    const zoneRows = this.spaces.listZonesForMap(filter);
    const chairRows = this.spaces.listChairsForMap(filter);
    const counts = emptyChairStatusCounts();

    const chairsByZone = new Map<number, ChairRow[]>();
    let capacity = 0;
    let occupiedSeats = 0;
    let notBookable = 0;
    for (const chair of chairRows) {
      const bucket = chairsByZone.get(chair.zone_id);
      if (bucket === undefined) {
        chairsByZone.set(chair.zone_id, [chair]);
      } else {
        bucket.push(chair);
      }
      counts[chair.status] += 1;
      capacity += chair.capacity;
      if (chair.status === ChairStatus.OCCUPIED) {
        occupiedSeats += chair.capacity;
      }
      if (chair.is_bookable === 0) {
        notBookable += 1;
      }
    }

    const zones: ZoneMapView[] = zoneRows.map((zone) => {
      const chairs = (chairsByZone.get(zone.id) ?? []).map((chair) => toChairView(chair));
      const zoneCounts = emptyChairStatusCounts();
      for (const chair of chairsByZone.get(zone.id) ?? []) {
        zoneCounts[chair.status] += 1;
      }
      return {
        ...toZoneView(zone, zoneCounts),
        bounds: boundsOf(chairs),
        chairs,
      };
    });

    const totals: MapTotals = {
      chairs: chairRows.length,
      available: counts.AVAILABLE,
      occupied: counts.OCCUPIED,
      reserved: counts.RESERVED,
      blocked: counts.BLOCKED,
      maintenance: counts.MAINTENANCE,
      cleaning: counts.CLEANING,
      notBookable,
      capacity,
      occupiedSeats,
      // Porcentaje entero en basis points: el cliente lo pinta sin recalcularlo
      // y el servidor lo puede comparar con el de un reporte (P1.4).
      occupancyRateBp: occupancyRateBp(occupiedSeats, capacity),
    };

    return {
      location: { id: location.id, name: location.name },
      zones,
      countsByStatus: counts,
      totals,
    };
  }

  /** `GET /chairs/:id` — ficha con la sesión viva y los indicadores de uso. */
  public getChair(chairId: number, context: SpacesRequestContext): ChairDetail {
    const row = this.requireChair(chairId, context.actor.businessId);
    const now = nowIso();
    const windowFrom = addDays(now, -UTILIZATION_WINDOW_DAYS);
    const rentalStats = this.rentals.chairStats(chairId, windowFrom, now);
    const utilizationRateBpValue = utilizationRateBp(
      rentalStats.minutes,
      UTILIZATION_WINDOW_DAYS * 24 * 60,
    );
    const reservation = this.reservations.findCurrentForChair(
      context.actor.businessId,
      chairId,
      now,
    );
    return {
      chair: toChairView(row),
      currentReservation: reservation === null ? null : toReservationSummary(reservation),
      currentRental: (() => {
        const active = this.rentals.findActiveByChair(context.actor.businessId, chairId);
        return active === null ? null : toRentalSummary(active);
      })(),
      stats: {
        totalReservations: this.reservations.countForChair(chairId),
        totalRentalMinutes: rentalStats.minutes,
        totalRevenueMinor: rentalStats.revenueMinor,
        utilizationRateBp: utilizationRateBpValue,
        windowFrom,
        windowTo: now,
      },
    };
  }

  /** `POST /chairs` — alta de silla. El estado inicial es SIEMPRE `AVAILABLE`. */
  public createChair(
    input: {
      readonly zoneId: number;
      readonly code: string;
      readonly name: string | null;
      readonly numberLabel: string | null;
      readonly kind: ChairKind;
      readonly capacity: number;
      readonly pricePerHourMinor?: number;
      readonly gridX: number;
      readonly gridY: number;
      readonly mapWidth: number;
      readonly mapHeight: number;
      readonly rotationDeg: number;
      readonly features: readonly string[];
      readonly notes: string | null;
      readonly isBookable: boolean;
      readonly isActive: boolean;
    },
    context: SpacesRequestContext,
  ): ChairView {
    return runInTransactionSync(() => {
      const zone = this.requireZone(input.zoneId, context.actor.businessId);
      if (zone.is_active === 0) {
        throw new BusinessRuleError('La zona está inactiva:actívela antes de darle sillas', {
          details: { code: 'ZONE_INACTIVE', zoneId: zone.id },
        });
      }
      // BR-CHAIR-002: sin `pricePerHourMinor` se hereda el del negocio.
      const pricePerHourMinor =
        input.pricePerHourMinor ??
        this.requireBusinessSettings(context.actor.businessId).chair_default_price_minor;

      const chairId = this.spaces.insertChair({
        zoneId: input.zoneId,
        code: input.code,
        name: input.name,
        numberLabel: input.numberLabel,
        kind: input.kind,
        capacity: input.capacity,
        pricePerHourMinor,
        gridX: input.gridX,
        gridY: input.gridY,
        mapWidth: input.mapWidth,
        mapHeight: input.mapHeight,
        rotationDeg: input.rotationDeg,
        features: input.features,
        notes: input.notes,
        isBookable: input.isBookable,
        isActive: input.isActive,
        statusChangedAt: nowIso(),
      });
      // BR-CHAIR-005: la capacidad de la zona es derivada de sus sillas.
      this.spaces.recomputeZoneCapacity(input.zoneId);

      const chair = toChairView(this.requireChair(chairId, context.actor.businessId));
      this.audit.record({
        action: AuditAction.CREATE,
        entityType: AuditEntityType.chair,
        entityId: chairId,
        actor: this.auditActor(context),
        request: context.request,
        afterData: {
          id: chair.id,
          code: chair.code,
          kind: chair.kind,
          zoneId: chair.zoneId,
          pricePerHourMinor: chair.pricePerHourMinor,
          status: chair.status,
        },
      });
      return chair;
    });
  }

  /**
   * `PATCH /chairs/:id` — edición.
   *
   * Dos campos tienen reglas propias y por eso se comprueban aquí en vez de
   * dejar que los requstre el `UNIQUE`:
   *  - `code`: sólo editable si la silla no tiene historial (BR-CHAIR-008),
   *    porque el código aparece en reportes históricos.
   *  - `status`: nunca por aquí (BR-CHAIR-003); se responde 422 `FIELD_NOT_EDITABLE`
   *    en vez de un 400 que no explica por qué.
   */
  public updateChair(
    chairId: number,
    patch: ChairPatch & { readonly status?: ChairStatus; readonly code?: string },
    context: SpacesRequestContext,
  ): ChairPatchResult {
    if (patch.status !== undefined) {
      throw new BusinessRuleError('El estado de la silla se cambia con sus endpoints de acción', {
        details: {
          code: 'FIELD_NOT_EDITABLE',
          field: 'status',
          hint: 'Use POST /chairs/{id}/block, /unblock, /maintenance o /complete-maintenance.',
        },
      });
    }
    return runInTransactionSync((tx) => {
      const before = this.requireChair(chairId, context.actor.businessId);
      const warnings: string[] = [];

      if (patch.zoneId !== undefined && patch.zoneId !== before.zone_id) {
        const target = this.requireZone(patch.zoneId, context.actor.businessId);
        if (target.is_active === 0) {
          throw new BusinessRuleError('La zona destino está inactiva', {
            details: { code: 'ZONE_INACTIVE', zoneId: target.id },
          });
        }
        if (before.status === ChairStatus.OCCUPIED) {
          // Mover el mueble con gente sentada deja la reserva y el alquiler
          // apuntando a una zona que ya no es la suya.
          throw new BusinessRuleError('No se puede mover una silla ocupada: cierre el alquiler primero', {
            details: { code: 'CHAIR_IN_USE', chairId, status: before.status },
          });
        }
      }

      if (patch.pricePerHourMinor !== undefined && patch.pricePerHourMinor !== before.price_per_hour_minor) {
        // BR-PRICE-010: cambiar el precio NO toca reservas ni alquileres vivos.
        warnings.push('PRICE_CHANGE_AFFECTS_ONLY_NEW');
      }

      if (patch.code !== undefined && patch.code !== before.code) {
        // BR-CHAIR-008: el `code` se imprime en la señalética física y aparece en
        // los reportes históricos. Si la silla ya se usó, renombrarla haría que
        // un receipt viejo apuntara a un mueble que ya no existe con ese nombre.
        const sessions = this.reservations.countForChair(chairId);
        if (sessions > 0) {
          throw new BusinessRuleError(
            'La silla ya tiene historial: su código no se puede cambiar',
            {
              details: {
                code: 'CHAIR_CODE_IMMUTABLE',
                ruleId: 'BR-CHAIR-008',
                chairId,
                sessionCount: sessions,
              },
            },
          );
        }
        this.spaces.updateChairCode(chairId, patch.code, tx);
      }

      const { code: _code, status: _status, ...chairPatch } = patch;
      this.spaces.updateChair(chairId, chairPatch, tx);
      // La capacidad derivada se recalcula en las dos zonas implicadas.
      this.spaces.recomputeZoneCapacity(before.zone_id, tx);
      if (patch.zoneId !== undefined && patch.zoneId !== before.zone_id) {
        this.spaces.recomputeZoneCapacity(patch.zoneId, tx);
      }

      const after = this.requireChair(chairId, context.actor.businessId);
      this.audit.record({
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.chair,
        entityId: chairId,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: chairAuditSnapshot(before),
        afterData: chairAuditSnapshot(after),
      });
      return { chair: toChairView(after), warnings };
    });
  }

  /**
   * `DELETE /chairs/:id` — soft delete con motivo obligatorio.
   *
   * Tres bloqueos, y todos con 422 `BUSINESS_RULE_ERROR`:
   *  - Silla `OCCUPIED`: hay gente y un alquiler abierto (BR-CHAIR-005/API.md 7.7).
   *  - Alquiler `ACTIVE`/`EXTENDED` (BR-RENTAL-009): aunque el estado de la silla
   *    dijera otra cosa, el alquiler vivo es la verdad física.
   *  - Reserva futura `PENDING`/`CONFIRMED`: borrarla dejaría al cliente con una
   *    reserva hacia una silla que ya no existe.
   * La baja es lógica (`deleted_at`), nunca un `DELETE`: el histórico de reportes
   * tiene que seguir apuntando a la silla que se usó en su día.
   */
  public deleteChair(chairId: number, reason: string, context: SpacesRequestContext): SoftDeleteResult {
    return runInTransactionSync(() => {
      const before = this.requireChair(chairId, context.actor.businessId);
      if (before.status === ChairStatus.OCCUPIED) {
        throw new BusinessRuleError('La silla está ocupada: cierre el alquiler antes de darla de baja', {
          details: { code: 'CHAIR_IN_USE', chairId, status: before.status },
        });
      }
      const activeRental = this.rentals.findActiveByChair(context.actor.businessId, chairId);
      if (activeRental !== null) {
        throw new BusinessRuleError('La silla tiene un alquiler abierto: ciérralo antes de darla de baja', {
          details: { code: 'CHAIR_HAS_ACTIVE_RENTAL', chairId, rentalCode: activeRental.code },
        });
      }
      const now = nowIso();
      const future = this.reservations.listBlockingForChair(context.actor.businessId, chairId, now);
      if (future.length > 0) {
        throw new BusinessRuleError(
          'La silla tiene reservas futuras: cancélelas o reasígnalas antes de darla de baja',
          {
            details: {
              code: 'CHAIR_HAS_FUTURE_RESERVATIONS',
              chairId,
              reservationCount: future.length,
              reservationCodes: future.map((entry) => entry.code),
            },
          },
        );
      }
      const deletedAt = nowIso();
      this.spaces.softDeleteChair(chairId, deletedAt);
      this.spaces.recomputeZoneCapacity(before.zone_id);
      this.audit.record({
        action: AuditAction.DELETE,
        entityType: AuditEntityType.chair,
        entityId: chairId,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: chairAuditSnapshot(before),
        afterData: { id: chairId, deletedAt, reason },
      });
      return { id: chairId, deletedAt, reason };
    });
  }

  /**
   * `PATCH /chairs/:id/status` — cambio de estado operativo (BR-CHAIR-003).
   *
   * Tres validaciones, en este orden:
   *  1. El estado destino tiene que ser fijable por una persona (`AVAILABLE`,
   *     `BLOCKED`, `MAINTENANCE`, `CLEANING`). `OCCUPIED` y `RESERVED` se alcanzan
   *     sólo por check-in, reserva confirmada y alquiler.
   *  2. La transición tiene que existir en la máquina de estados de sillas, que
   *     también aporta el motivo de la prohibición.
   *  3. No se puede sacar de servicio una silla con sesiones vivas.
   */
  public setStatus(
    chairId: number,
    status: ChairStatus,
    reason: string | undefined,
    context: SpacesRequestContext,
  ): { readonly chair: ChairView; readonly warnings: readonly string[] } {
    if (!isManuallySettable(status)) {
      throw new BusinessRuleError(`Una persona no puede poner una silla en ${status}`, {
        details: {
          code: 'INVALID_CHAIR_STATUS_TRANSITION',
          ruleId: 'BR-CHAIR-003',
          to: status,
          reason: 'OCCUPIED y RESERVED sólo se alcanzan por check-in, reserva confirmada o alquiler',
        },
      });
    }
    return runInTransactionSync(() => {
      const before = this.requireChair(chairId, context.actor.businessId);
      const warnings: string[] = [];
      if (before.status === status) {
        // Idempotencia de lectura de estado (API.md 6.4): repetir la acción ya
        // aplicada devuelve el estado actual con un aviso, no un error. No se
        // consulta la máquina de estados porque `X -> X` no es una transición.
        warnings.push('ALREADY_APPLIED');
        return { chair: toChairView(before), warnings };
      }
      assertChairTransition(before.status, status);
      if (status === ChairStatus.BLOCKED || status === ChairStatus.MAINTENANCE) {
        this.assertNoLiveSessions(chairId, context.actor.businessId, status);
      }
      const at = nowIso();
      this.spaces.updateChairStatus(chairId, status, at);
      this.applyStatusNotes(chairId, reason);
      const after = this.requireChair(chairId, context.actor.businessId);
      this.audit.record({
        action: AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.chair,
        entityId: chairId,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: chairId, status: before.status, statusChangedAt: before.status_changed_at },
        afterData: { id: chairId, status: after.status, statusChangedAt: after.status_changed_at, ...(reason === undefined ? {} : { reason }) },
      });
      return { chair: toChairView(after), warnings };
    });
  }

  // ==========================================================================
  // Disponibilidad e historial
  // ==========================================================================

  /**
   * `GET /chairs/:id/availability` — el calendario que ve el cliente.
   *
   * La comparación de intervalos usa `overlaps()` de `shared/utils/datetime.ts`,
   * la MISMA función que documenta BR-RES-001: los extremos que se tocan no se
   * solapan. Así el cliente ve libre la casilla de las 16:00 si la reserva
   * termina a las 16:00, y el servidor no aceptará una reserva que choque con
   * otra: una sola definición de "solapamiento" en todo el sistema.
   */
  public availability(
    chairId: number,
    range: AvailabilityRange,
    context: SpacesRequestContext,
  ): ChairAvailabilityView {
    const chair = this.requireChair(chairId, context.actor.businessId);
    if (range.to <= range.from) {
      throw new ValidationError('El rango de fechas es inválido', {
        details: [{ path: 'to', message: '`to` debe ser posterior a `from`', code: 'INVALID_DATE_RANGE' }],
      });
    }
    const totalMinutes = Math.max(0, Math.round(diffMinutes(range.from, range.to)));
    if (totalMinutes > 31 * 24 * 60) {
      throw new ValidationError('El rango no puede superar 31 días', {
        details: [{ path: 'to', message: 'El rango máximo es de 31 días', code: 'RANGE_TOO_LARGE' }],
      });
    }

    const windows = [
      ...this.reservations
        .listWindowsForChair({ businessId: context.actor.businessId, chairId, from: range.from, to: range.to })
        .map((window) => ({ ...window, kind: 'reservation' as const })),
      ...this.rentals
        .listWindowsForChair({ businessId: context.actor.businessId, chairId, from: range.from, to: range.to })
        .map((window) => ({ ...window, kind: 'rental' as const })),
    ];

    // Estado por defecto de cada celda: el estado OPERATIVO de la silla. Una
    // silla bloqueada o en limpieza no se puede reservar aunque el rango esté
    // libre, y eso se ve en el calendario sin tener que leer la ficha.
    const baseStatus = operationalStatusOf(chair.status);
    const slots: AvailabilitySlot[] = [];
    const step = range.granularityMinutes;
    let cursor = range.from;
    let bookedMinutes = 0;

    while (cursor < range.to) {
      // La última celda se recorta al final del rango: una rejilla que se pasa
      // de `to` mostraría disponibilidad que no existe, y el recorte garantiza
      // además que `cursor` avanza siempre (el bucle termina).
      const slotEnd = minIso(addMinutes(cursor, step), range.to);
      const reservation = windows.find(
        (window) => window.kind === 'reservation' && overlaps(cursor, slotEnd, window.startAt, window.endAt),
      );
      const rental = windows.find(
        (window) => window.kind === 'rental' && overlaps(cursor, slotEnd, window.startAt, window.endAt),
      );
      const status: AvailabilityStatus = rental !== undefined
        ? 'OCCUPIED'
        : reservation !== undefined
          ? 'RESERVED'
          : baseStatus;
      if (status === 'OCCUPIED' || status === 'RESERVED') {
        bookedMinutes += step;
      }
      slots.push({
        startAt: cursor,
        endAt: slotEnd,
        status,
        reservationId: reservation?.id ?? null,
        reservationCode: reservation?.code ?? null,
        rentalId: rental?.id ?? null,
      });
      cursor = slotEnd;
    }

    return {
      chairId: chair.id,
      code: chair.code,
      from: range.from,
      to: range.to,
      totalMinutes,
      bookedMinutes,
      availableMinutes: Math.max(0, totalMinutes - bookedMinutes),
      utilizationRateBp: utilizationRateBp(bookedMinutes, totalMinutes),
      chairStatus: chair.status,
      slots,
    };
  }

  /**
   * `GET /chairs/:id/history` — sesiones de la silla en un rango.
   *
   * Se combinan reservas y alquileres en memoria y se ordenan una sola vez: son
   * dos consultas (una por tabla) y el rango por defecto son 30 días. Paginar en
   * SQL cada tabla por separado daría dos páginas incompatibles, que es
   * justamente el error que la nota de paginación estable de API.md 5.1 quiere
   * evitar.
   */
  public history(
    chairId: number,
    filter: ChairHistoryFilter,
    pagination: { readonly limit: number; readonly offset: number },
    sort: { readonly column: string; readonly direction: 'ASC' | 'DESC' },
    context: SpacesRequestContext,
  ): ChairHistoryPage {
    this.requireChair(chairId, context.actor.businessId);
    const entries: ChairHistoryEntry[] = [];

    if (filter.type !== 'rental') {
      for (const row of this.reservations.listForChair({ ...filter, chairId })) {
        entries.push({
          id: row.id,
          type: 'reservation',
          code: row.code,
          status: row.status,
          startAt: row.start_at,
          endAt: row.end_at,
          durationMinutes: row.duration_minutes,
          billedMinutes: null,
          totalMinor: row.rental_total_minor,
          customerId: row.customer_id,
          customerName: row.customer_name,
        });
      }
    }
    if (filter.type !== 'reservation') {
      for (const row of this.rentals.listForChair({ ...filter, chairId })) {
        entries.push({
          id: row.id,
          type: 'rental',
          code: row.code,
          status: row.status,
          startAt: row.start_at,
          endAt: row.end_at,
          durationMinutes: row.planned_minutes,
          billedMinutes: row.billed_minutes,
          totalMinor: row.total_minor,
          customerId: row.customer_id,
          customerName: row.customer_name,
        });
      }
    }

    const sorted = sortHistoryEntries(entries, sort);
    const page = sorted.slice(pagination.offset, pagination.offset + pagination.limit);
    return {
      items: page,
      totals: {
        sessions: sorted.length,
        totalMinutes: sorted.reduce((acc, entry) => acc + entry.durationMinutes, 0),
        // Suma de importes ya redondeados (BR-MONEY-004), nunca una suma de
        // precios por minuto recalculados aquí.
        totalRevenueMinor: sorted.reduce((acc, entry) => acc + entry.totalMinor, 0),
      },
    };
  }

  // ==========================================================================
  // Acciones operativas
  // ==========================================================================

  /** `POST /chairs/:id/block` — bloqueo con motivo. */
  public block(chairId: number, reason: string, context: SpacesRequestContext): ChairActionResult {
    return runInTransactionSync(() => this.applyOperationalStatus(
      chairId,
      ChairStatus.BLOCKED,
      reason,
      context,
    ));
  }

  /** `POST /chairs/:id/maintenance` — envío a mantenimiento con motivo. */
  public maintenance(chairId: number, reason: string, context: SpacesRequestContext): ChairActionResult {
    return runInTransactionSync(() => this.applyOperationalStatus(
      chairId,
      ChairStatus.MAINTENANCE,
      reason,
      context,
    ));
  }

  /**
   * `POST /chairs/:id/unblock` — desbloquea.
   *
   * Destino `AVAILABLE`, salvo que haya una reserva `CONFIRMED` que ya empezó: en
   * ese caso la silla vuelve a `RESERVED`, que es lo que la máquina de estados
   * permite y lo que el cliente espera ver.
   */
  public unblock(chairId: number, context: SpacesRequestContext): { readonly chair: ChairView } {
    return runInTransactionSync(() => {
      const before = this.requireChair(chairId, context.actor.businessId);
      if (before.status !== ChairStatus.BLOCKED) {
        throw new BusinessRuleError('La silla no está bloqueada', {
          details: { code: 'CHAIR_NOT_BLOCKED', chairId, status: before.status },
        });
      }
      const now = nowIso();
      const current = this.reservations.findCurrentForChair(
        context.actor.businessId,
        chairId,
        now,
      );
      const target =
        current !== null && current.status === 'CONFIRMED' ? ChairStatus.RESERVED : ChairStatus.AVAILABLE;
      assertChairTransition(before.status, target);
      this.spaces.updateChairStatus(chairId, target, now);
      const after = this.requireChair(chairId, context.actor.businessId);
      this.audit.record({
        action: AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.chair,
        entityId: chairId,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: chairId, status: before.status },
        afterData: { id: chairId, status: after.status, releasedBy: 'unblock' },
      });
      return { chair: toChairView(after) };
    });
  }

  /**
   * `POST /chairs/:id/complete-maintenance` — cierre de la intervención.
   *
   * Con `needsCleaning` (por defecto `true`) la silla pasa a `CLEANING`; sin
   * limpieza, a `AVAILABLE`. Es idempotente en lectura de estado: si ya no está
   * en `MAINTENANCE` devuelve 200 con `meta.warnings: ['ALREADY_APPLIED']` en vez
   * de un error (API.md 6.4 y 7.7).
   */
  public completeMaintenance(
    chairId: number,
    input: { readonly notes?: string; readonly needsCleaning: boolean },
    context: SpacesRequestContext,
  ): { readonly chair: ChairView; readonly warnings: readonly string[] } {
    return runInTransactionSync(() => {
      const before = this.requireChair(chairId, context.actor.businessId);
      // Desde `MAINTENANCE` el destino depende de si hay que limpiar después.
      // Desde `CLEANING` con `needsCleaning: false` se cierra la limpieza, que es
      // la transición `CLEANING -> AVAILABLE` de la máquina de estados
      // ("limpieza completada", DISEÑ.md 6.4). En cualquier otro caso la acción ya
      // está aplicada y se responde 200 con aviso (API.md 6.4 y 7.7).
      const target: ChairStatus =
        before.status === ChairStatus.CLEANING
          ? ChairStatus.AVAILABLE
          : input.needsCleaning
            ? ChairStatus.CLEANING
            : ChairStatus.AVAILABLE;
      if (before.status === target || (before.status === ChairStatus.CLEANING && input.needsCleaning)) {
        return { chair: toChairView(before), warnings: ['ALREADY_APPLIED'] };
      }
      assertChairTransition(before.status, target);
      const at = nowIso();
      this.spaces.updateChairStatus(chairId, target, at);
      this.spaces.updateChair(chairId, input.notes === undefined ? {} : { notes: input.notes });
      const after = this.requireChair(chairId, context.actor.businessId);
      this.audit.record({
        action: AuditAction.CHANGE_STATUS,
        entityType: AuditEntityType.chair,
        entityId: chairId,
        actor: this.auditActor(context),
        request: context.request,
        beforeData: { id: chairId, status: before.status },
        afterData: { id: chairId, status: after.status, ...(input.notes === undefined ? {} : { notes: input.notes }) },
      });
      return { chair: toChairView(after), warnings: [] };
    });
  }

  /**
   * Escribe una nota interna en la silla (`POST /rentals` con `notes`).
   *
   * Método aparte y no el `updateChair` genérico a propósito: el `notes` de un
   * alquiler es información del CLIENTE (quién se sentó, por qué), no del mueble,
   * y mezclarla con el motivo de un bloqueo haría imposible saber cuál es cuál.
   */
  public updateChairNote(chairId: number, notes: string, context: SpacesRequestContext, tx: Db): void {
    this.requireChair(chairId, context.actor.businessId);
    this.spaces.updateChair(chairId, { notes }, tx);
  }

  /**
   * Confirma/reserva la silla para una reserva que empieza ahora.
   *
   * `AVAILABLE -> RESERVED` sólo lo puede ejecutar el sistema (BR-CHAIR-003 y la
   * tabla de transiciones de DESIGN.md 6.4, donde la transición aparece marcada
   * como `SYSTEM`), y por eso vive en el service y no en un endpoint: ninguna
   * persona puede "reservar" una silla a mano.
   */
  public markReservedForBooking(
    chairId: number,
    reservationId: number,
    context: SpacesRequestContext,
    tx: Db,
  ): ChairView {
    const before = this.requireChair(chairId, context.actor.businessId);
    if (before.status === ChairStatus.RESERVED || before.status === ChairStatus.OCCUPIED) {
      return toChairView(before);
    }
    assertChairTransition(before.status, ChairStatus.RESERVED);
    const at = nowIso();
    this.spaces.updateChairStatus(chairId, ChairStatus.RESERVED, at, tx);
    this.audit.record({
      action: AuditAction.CHANGE_STATUS,
      entityType: AuditEntityType.chair,
      entityId: chairId,
      actor: this.auditActor(context),
      request: context.request,
      beforeData: { id: chairId, status: before.status },
      afterData: { id: chairId, status: ChairStatus.RESERVED, statusChangedAt: at, reservationId },
    });
    return toChairView(this.requireChair(chairId, context.actor.businessId));
  }

  /**
   * Libera la silla tras cancelar o expirar una reserva: `RESERVED -> AVAILABLE`.
   *
   * `excludeReservationId` es la reserva que se acaba de cerrar: si queda otra
   * reserva confirmada por delante, la silla debe seguir `RESERVED` (decisión D10).
   */
  public markAvailableAfterRelease(
    chairId: number,
    excludeReservationId: number,
    context: SpacesRequestContext,
    tx: Db,
  ): ChairView {
    const before = this.requireChair(chairId, context.actor.businessId);
    if (before.status !== ChairStatus.RESERVED) {
      return toChairView(before);
    }
    assertChairTransition(before.status, ChairStatus.AVAILABLE);
    const at = nowIso();
    this.spaces.updateChairStatus(chairId, ChairStatus.AVAILABLE, at, tx);
    this.audit.record({
      action: AuditAction.CHANGE_STATUS,
      entityType: AuditEntityType.chair,
      entityId: chairId,
      actor: this.auditActor(context),
      request: context.request,
      beforeData: { id: chairId, status: before.status },
      afterData: { id: chairId, status: ChairStatus.AVAILABLE, statusChangedAt: at, releasedReservationId: excludeReservationId },
    });
    return toChairView(this.requireChair(chairId, context.actor.businessId));
  }

  /**
   * Silla por id para el job del sistema, o `null` si ya no existe.
   *
   * El job de expiración recorre reservas que pueden apuntar a sillas dadas de
   * baja: fallar con un 404 a mitad del trabajo dejaría reservas sin expirar, así
   * que aquí se degrada a `null` y el job sigue con la siguiente.
   */
  public findChairForJob(chairId: number, businessId: number): ChairRow | null {
    return this.spaces.findChairById(chairId, businessId);
  }

  // ==========================================================================
  // Transiciones que disparan otros módulos (reservas y alquileres)
  // ==========================================================================

  /**
   * Pone la silla en `OCCUPIED` validando la máquina de estados y auditando.
   *
   * Vive AQUÍ y no en los servicios de reservas o alquileres por una razón
   * concreta: la tabla de transiciones de sillas es de este módulo, y las tres
   * formas de llegar a `OCCUPIED` (reserva confirmada, check-in y alquiler
   * walk-in) tienen que compartir exactamente la misma validación y el mismo
   * rastro. Si cada módulo escribiera `chairs.status` por su cuenta, bastaría un
   * servicio nuevo para saltarse la tabla de transiciones prohibidas de
   * DESIGN.md 6.4.
   *
   * Es idempotente: si ya está `OCCUPIED` no vuelve a escribir, para que un
   * check-in repetido no mueva `status_changed_at` (que alimenta el reporte de
   * "ocupada desde hace X").
   */
  public occupyChair(chairId: number, context: SpacesRequestContext, tx: Db): ChairView {
    const before = this.requireChair(chairId, context.actor.businessId);
    if (before.status === ChairStatus.OCCUPIED) {
      return toChairView(before);
    }
    assertChairTransition(before.status, ChairStatus.OCCUPIED);
    const at = nowIso();
    this.spaces.updateChairStatus(chairId, ChairStatus.OCCUPIED, at, tx);
    this.audit.record({
      action: AuditAction.CHANGE_STATUS,
      entityType: AuditEntityType.chair,
      entityId: chairId,
      actor: this.auditActor(context),
      request: context.request,
      beforeData: { id: chairId, status: before.status },
      afterData: { id: chairId, status: ChairStatus.OCCUPIED, statusChangedAt: at, cause: 'rental_or_checkin' },
    });
    return toChairView(this.requireChair(chairId, context.actor.businessId));
  }

  /**
   * Cierre de alquiler o de reserva: la silla pasa a `CLEANING` (BR-RENTAL-008).
   *
   * Se devuelve el estado resultante porque hay dos finales legítimos: `CLEANING`
   * en el caso normal, y el estado que ya tuviera si otra operación movió la
   * silla mientras tanto (por ejemplo una reserva confirmada que la dejó en
   * `RESERVED`).
   */
  public releaseChairAfterRental(
    chairId: number,
    context: SpacesRequestContext,
    tx: Db,
  ): { readonly status: ChairStatus; readonly statusChangedAt: string } {
    const before = this.requireChair(chairId, context.actor.businessId);
    if (before.status !== ChairStatus.OCCUPIED) {
      return { status: before.status, statusChangedAt: before.status_changed_at };
    }
    assertChairTransition(before.status, ChairStatus.CLEANING);
    const at = nowIso();
    this.spaces.updateChairStatus(chairId, ChairStatus.CLEANING, at, tx);
    this.audit.record({
      action: AuditAction.CHANGE_STATUS,
      entityType: AuditEntityType.chair,
      entityId: chairId,
      actor: this.auditActor(context),
      request: context.request,
      beforeData: { id: chairId, status: before.status },
      afterData: { id: chairId, status: ChairStatus.CLEANING, statusChangedAt: at, cause: 'rental_closed' },
    });
    return { status: ChairStatus.CLEANING, statusChangedAt: at };
  }

  // ==========================================================================
  // Utilidades internas
  // ==========================================================================

  /**
   * Ruta común de `block` y `maintenance`: valida la transición, rechaza si hay
   * sesiones vivas y deja la razón en `notes`.
   */
  private applyOperationalStatus(
    chairId: number,
    target: ChairStatus,
    reason: string,
    context: SpacesRequestContext,
  ): ChairActionResult {
    const before = this.requireChair(chairId, context.actor.businessId);
    if (before.status === ChairStatus.OCCUPIED) {
      // Bloquear o mandar a mantenimiento una silla con gente es pérdida
      // operativa y hueco de facturación (DESIGN.md 6.4, tabla de prohibidas).
      throw new ConflictError('La silla está ocupada: cierre el alquiler primero', {
        details: { code: CONFLICT_DETAIL_CODE.CHAIR_OCCUPIED, chairId, status: before.status },
      });
    }
    assertChairTransition(before.status, target);
    this.assertNoLiveSessions(chairId, context.actor.businessId, target);
    const at = nowIso();
    this.spaces.updateChairStatus(chairId, target, at);
    this.spaces.updateChair(chairId, { notes: reason });
    const after = this.requireChair(chairId, context.actor.businessId);
    const affected = this.reservations
      .listBlockingForChair(context.actor.businessId, chairId, at)
      .map((entry) => ({ id: entry.id, code: entry.code, startAt: entry.startAt, endAt: entry.endAt }));
    this.audit.record({
      action: AuditAction.CHANGE_STATUS,
      entityType: AuditEntityType.chair,
      entityId: chairId,
      actor: this.auditActor(context),
      request: context.request,
      beforeData: { id: chairId, status: before.status },
      afterData: { id: chairId, status: after.status, reason, affectedReservations: affected.length },
    });
    return { chair: toChairView(after), affectedReservations: affected, warnings: [] };
  }

  /** No se saca de servicio una silla con sesiones vivas. */
  private assertNoLiveSessions(chairId: number, businessId: number, target: ChairStatus): void {
    const rental = this.rentals.findActiveByChair(businessId, chairId);
    if (rental !== null) {
      throw new BusinessRuleError('La silla tiene un alquiler abierto: ciérralo antes de cambiarla de estado', {
        details: { code: 'CHAIR_HAS_ACTIVE_BOOKING', chairId, rentalCode: rental.code, target },
      });
    }
    const now = nowIso();
    const reservations = this.reservations.listBlockingForChair(businessId, chairId, now);
    if (reservations.length > 0) {
      throw new BusinessRuleError('La silla tiene reservas activas: cancélelas o reasígnalas primero', {
        details: {
          code: 'CHAIR_HAS_ACTIVE_BOOKING',
          chairId,
          target,
          reservationCodes: reservations.map((entry) => entry.code),
        },
      });
    }
  }

  /** Guarda el motivo de la acción en `notes` (API.md 7.7: "motivo en notes"). */
  private applyStatusNotes(chairId: number, reason: string | undefined): void {
    if (reason === undefined || reason.length === 0) {
      return;
    }
    this.spaces.updateChair(chairId, { notes: reason });
  }

  /** Contadores por (zona, estado) del negocio, en una consulta. */
  private countsByZone(businessId: number, locationId: number): Map<number, ChairStatusCounts> {
    const result = new Map<number, ChairStatusCounts>();
    for (const row of this.spaces.listZoneStatusCounts(businessId, locationId)) {
      const current = result.get(row.zone_id) ?? emptyChairStatusCounts();
      current[row.status] += row.total;
      result.set(row.zone_id, current);
    }
    return result;
  }

  /** Zona obligatoria: 404 si no existe, está borrada o es de otro negocio. */
  requireZone(zoneId: number, businessId: number): ZoneRow {
    const row = this.spaces.findZoneById(zoneId, businessId);
    if (row === null) {
      throw new NotFoundError('La zona no existe', { details: { id: zoneId, type: 'zone' } });
    }
    return row;
  }

  /** Silla obligatoria: 404 si no existe, está dada de baja o es de otro negocio. */
  requireChair(chairId: number, businessId: number): ChairRow {
    const row = this.spaces.findChairById(chairId, businessId);
    if (row === null) {
      throw new NotFoundError('La silla no existe', { details: { id: chairId, type: 'chair' } });
    }
    return row;
  }

  /** Ajustes del negocio, obligatorios: sin ellos no hay precio ni duración máxima. */
  requireBusinessSettings(businessId: number): BusinessSpaceSettingsRow {
    const settings = this.spaces.findBusinessSettings(businessId);
    if (settings === null) {
      throw new NotFoundError('El negocio no está configurado', {
        details: { id: businessId, type: 'business' },
      });
    }
    return settings;
  }

  /** Sede obligatoria y activa para crear zonas. */
  private requireActiveLocation(locationId: number, businessId: number): void {
    const location = this.spaces.findLocation(locationId, businessId);
    if (location === null) {
      throw new NotFoundError('La sede no existe', { details: { id: locationId, type: 'location' } });
    }
    if (location.is_active === 0) {
      throw new BusinessRuleError('La sede está inactiva:actívela antes de crear zonas', {
        details: { code: 'LOCATION_INACTIVE', locationId },
      });
    }
  }

  /**
   * `includeInactive=true` es una vista de administración (BR-CHAIR-004): un
   * cliente no ve sillas dadas de baja ni zonas inactivas, ni siquiera asking.
   */
  private assertMaySeeInactive(includeInactive: boolean, actor: UserContext): void {
    if (includeInactive !== true) {
      return;
    }
    if (actor.roles.includes(Role.CUSTOMER) && actor.roles.length === 1) {
      throw new AuthorizationError('Sólo el personal puede ver los espacios inactivos', {
        details: { code: 'INSUFFICIENT_ROLE', required: ['STAFF', 'CASHIER', 'MANAGER', 'ADMIN', 'OWNER'] },
      });
    }
  }

  /** Actor normalizado para `audit.record`. */
  private auditActor(context: SpacesRequestContext): {
    readonly id: number;
    readonly email: string;
    readonly businessId: number;
  } {
    return {
      id: context.actor.id,
      email: context.actor.email,
      businessId: context.actor.businessId,
    };
  }
}

// --------------------------------------------------------------------------
// Mapeo de filas a vistas
// --------------------------------------------------------------------------

/** Fila de zona -> `ZoneView` de la API. */
function toZoneView(row: ZoneRow, counts: ChairStatusCounts): ZoneView {
  return {
    id: row.id,
    locationId: row.location_id,
    locationName: row.location_name,
    name: row.name,
    code: row.code,
    colorHex: row.color_hex,
    capacity: row.capacity,
    chairCount: row.chair_count,
    availableCount: row.available_count,
    sortOrder: row.sort_order,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    countsByStatus: counts,
  };
}

/**
 * Fila de silla -> `ChairView` de la API.
 *
 * Se exporta porque el módulo de reservas devuelve la silla en la respuesta del
 * check-in: compartir el mapeo garantiza que la silla que ve el cliente tras
 *	Check-in es exactamente la misma que ve en `GET /chairs/:id`.
 */
export function toChairView(row: ChairRow): ChairView {
  return {
    id: row.id,
    zoneId: row.zone_id,
    zoneName: row.zone_name,
    locationId: row.location_id,
    code: row.code,
    name: row.name,
    numberLabel: row.number_label,
    kind: row.kind,
    capacity: row.capacity,
    pricePerHourMinor: row.price_per_hour_minor,
    status: row.status,
    statusChangedAt: row.status_changed_at,
    gridX: row.grid_x,
    gridY: row.grid_y,
    mapWidth: row.map_width,
    mapHeight: row.map_height,
    rotationDeg: row.rotation_deg,
    features: parseFeatures(row.features),
    notes: row.notes,
    isBookable: row.is_bookable === 1,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * `features` es un JSON array de texto en la columna. Un JSON corrupto no puede
 * tumbar la lectura del mapa: se degrada a lista vacía y el `CHECK json_valid`
 * de la columna impide que llegue a ese punto por la vía normal.
 */
function parseFeatures(raw: string | null): readonly string[] {
  if (raw === null || raw.length === 0) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

/** Rectángulo que ocupa una zona: `grid + map_width/height` de cada silla. */
function boundsOf(chairs: readonly ChairView[]): ZoneBounds | null {
  if (chairs.length === 0) {
    return null;
  }
  let minX = chairs[0]?.gridX ?? 0;
  let minY = chairs[0]?.gridY ?? 0;
  let maxX = (chairs[0]?.gridX ?? 0) + (chairs[0]?.mapWidth ?? 1);
  let maxY = (chairs[0]?.gridY ?? 0) + (chairs[0]?.mapHeight ?? 1);
  for (const chair of chairs.slice(1)) {
    minX = Math.min(minX, chair.gridX);
    minY = Math.min(minY, chair.gridY);
    maxX = Math.max(maxX, chair.gridX + chair.mapWidth);
    maxY = Math.max(maxY, chair.gridY + chair.mapHeight);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Estado de una celda cuando no hay nada reservado encima.
 *
 * `AVAILABLE` y `RESERVED` se traducen a `FREE`: la celda no está ocupada por
 * nada, y quien mira el calendario lo que quiere saber es si puede reservarla.
 */
const OPERATIONAL_AVAILABILITY_STATUS: Readonly<Partial<Record<ChairStatus, AvailabilityStatus>>> =
  Object.freeze({
    [ChairStatus.BLOCKED]: 'BLOCKED',
    [ChairStatus.MAINTENANCE]: 'MAINTENANCE',
    [ChairStatus.CLEANING]: 'CLEANING',
  });

function operationalStatusOf(status: ChairStatus): AvailabilityStatus {
  return OPERATIONAL_AVAILABILITY_STATUS[status] ?? 'FREE';
}

/** Ordena las entradas del historial con la allowlist de API.md 7.7. */
function sortHistoryEntries(
  entries: readonly ChairHistoryEntry[],
  sort: { readonly column: string; readonly direction: 'ASC' | 'DESC' },
): readonly ChairHistoryEntry[] {
  const direction = sort.direction === 'DESC' ? -1 : 1;
  const key = (entry: ChairHistoryEntry): number => {
    switch (sort.column) {
      case 'endAt':
        return Date.parse(entry.endAt);
      case 'durationMinutes':
        return entry.durationMinutes;
      case 'revenueMinor':
        return entry.totalMinor;
      default:
        return Date.parse(entry.startAt);
    }
  };
  // El desempate por `startAt` + `id` mantiene la paginación estable (API.md 5.1).
  return [...entries].sort((a, b) => {
    const diff = (key(a) - key(b)) * direction;
    return diff !== 0 ? diff : (a.id - b.id) * direction;
  });
}

/**
 * `min` de dos instantes ISO, comparados como cadenas.
 *
 * El orden lexicográfico coincide con el cronológico porque TODAS las fechas del
 * sistema están en UTC con el mismo formato `YYYY-MM-DDTHH:MM:SS.sssZ`
 * (DESIGN.md 10.4). Es la misma comparación que hace el índice de la base de
 * datos, así que el recorte del calendario coincide con el filtro SQL.
 */
function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Snapshot acotado de una silla para `audit_logs` (sin `notes` internas). */
function chairAuditSnapshot(row: ChairRow): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    zoneId: row.zone_id,
    kind: row.kind,
    capacity: row.capacity,
    pricePerHourMinor: row.price_per_hour_minor,
    status: row.status,
    isBookable: row.is_bookable === 1,
    isActive: row.is_active === 1,
  };
}
