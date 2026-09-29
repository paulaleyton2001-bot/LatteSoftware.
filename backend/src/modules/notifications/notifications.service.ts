/**
 * Servicio de la BANDEJA DE ENTRADA de notificaciones: los casos de uso de
 * `/api/v1/notifications/*` (API.md 7.17).
 *
 * ============================== CAPAS =======================================
 * No conoce Express, ni zod, ni SQLite. Recibe entradas tipadas, decide,
 * orquesta la transacción y devuelve DTOs. El SQL vive en
 * `notifications.repository.sqlite.ts` (DESIGN.md 3.1 y 3.6).
 *
 * ============== POR QUÉ NO ES EL MISMO SERVICIO QUE `enqueue` ==============
 * La ESCRITURA de una notificación la hace `shared/services/
 * notifications.service.ts` (`NotificationsService.enqueue`) y la consumen
 * pedidos, reservas y pagos: es un caso de uso de OTRO módulo, no de éste. Aquí
 * vive sólo lo que el cliente ve: listar, contar no leídas, marcar leída y
 * configurar preferencias. Los dos services comparten el MISMO repositorio
 * (y por tanto el mismo `INSERT` y la misma política de canales), pero no
 * comparten responsabilidades.
 *
 * ========================== REGLAS QUE APLICA ==============================
 *  - **El `userId` sale SIEMPRE del token.** Pedir las notificaciones de otro
 *    usuario exige `actor.isStaff` (BR-SEC-011); un `CUSTOMER` que lo intente
 *    recibe `404`, no `403`: la existencia de la bandeja ajena no es
 *    información que un cliente pueda usar.
 *  - **`markRead` nunca acepta un `userId`**: se marca la notificación DEL
 *    ACTOR o no se marca nada. Una notificación ajena es `404`, igual que en el
 *    resto del sistema (API.md 2).
 *  - **`read-all` es del actor, siempre**, y puede acotarse por tipo o por fecha.
 *  - **`unreadCount` es una agregación**, no un `length` de la lista.
 *  - **`in_app` no se puede apagar** (API.md 7.17): es el canal histórico de la
 *    bandeja, así que `inApp = false` es `422 IN_APP_REQUIRED`.
 *  - **`quiet_hours_from` y `quiet_hours_to` van juntos o ninguno** (CHECK del
 *    esquema). La franja PUEDE cruzar medianoche (`22:00` -> `07:00`): es la
 *    forma normal de callar de noche. Si los dos extremos son iguales, la franja
 *    se considera vacía.
 */
import { runInTransactionSync } from '../../shared/database/unit-of-work.js';
import { NotificationStatus, type UserContext } from '../../shared/domain/index.js';
import { AuthorizationError, BusinessRuleError, NotFoundError } from '../../shared/errors/index.js';
import { logger } from '../../shared/logger/index.js';
import { nowIso } from '../../shared/utils/datetime.js';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '../../shared/services/notifications.service.js';
import type { NotificationListFilter, NotificationsRepository } from './notifications.repository.js';
import type {
  NotificationPage,
  NotificationPreferencesView,
  NotificationRow,
  NotificationSortColumn,
  NotificationView,
  ReadAllResult,
  UnreadCountView,
} from './notifications.types.js';

/** Reloj inyectado: los tests no deben depender de la hora real. */
export interface NotificationClock {
  /** Instante actual en ISO-8601 UTC. */
  now(): string;
}

/** Reloj por defecto: el del sistema. */
export const systemClock: NotificationClock = { now: () => nowIso() };

/** Filtros de `GET /api/v1/notifications` tal y como llegan del controller. */
export interface ListNotificationsInput {
  readonly limit: number;
  readonly offset: number;
  readonly sort: { readonly column: NotificationSortColumn; readonly direction: 'ASC' | 'DESC' };
  readonly type?: string;
  readonly channel?: string;
  readonly status?: string;
  readonly unreadOnly?: boolean;
  readonly from?: string;
  readonly to?: string;
  /**
   * `userId` pedido EXPLÍCITAMENTE. Sólo lo honra el personal; para el resto es
   * un `404`, no un `403`, para no confirmar que esa bandeja existe.
   */
  readonly userId?: number;
}

/** Cuerpo de `POST /api/v1/notifications/read-all`. */
export interface ReadAllInput {
  readonly type?: string;
  readonly before?: string;
}

/** Servicio de la bandeja de entrada. */
export class NotificationsInboxService {
  public constructor(
    private readonly repository: NotificationsRepository,
    private readonly clock: NotificationClock = systemClock,
  ) {}

  // ==========================================================================
  // Lecturas
  // ==========================================================================

  /**
   * `GET /api/v1/notifications` — bandeja paginada del actor.
   *
   * Devuelve también el `unreadCount` en el `meta` (API.md 7.17): el cliente lo
   * pinta en el badge y así no necesita una segunda petición.
   */
  public list(input: ListNotificationsInput, actor: UserContext): NotificationPage {
    const userId = this.resolveTargetUser(input.userId, actor);
    const filter = this.buildFilter(input, userId);
    return {
      items: this.repository.list(filter).map((row) => toView(row)),
      total: this.repository.count(filter),
      unreadCount: this.repository.countUnread(userId).total,
    };
  }

  /** `GET /api/v1/notifications/unread-count` — agregación, sin cargar la lista. */
  public unreadCount(actor: UserContext): UnreadCountView {
    return this.repository.countUnread(actor.id);
  }

  /**
   * `GET /api/v1/notifications/preferences` — preferencias del actor.
   *
   * Crea la fila con los valores por defecto si no existe (BR-NOTIF-005): así el
   * cliente siempre recibe un objeto completo y no tiene que conocer los
   * defaults del servidor.
   */
  public getPreferences(actor: UserContext): NotificationPreferencesView {
    return runInTransactionSync(() => {
      const row = this.requireOrCreatePreferences(actor.id);
      return toPreferencesView(row);
    });
  }

  // ==========================================================================
  // Escrituras
  // ==========================================================================

  /**
   * `PUT /api/v1/notifications/preferences` — preferencias del actor.
   *
   * Es un `PUT` sobre un recurso del USUARIO: los campos ausuntos se quedan como
   * están (a diferencia del `PUT /business/hours`, que reemplaza la semana
   * entera). Se exige al menos un campo.
   */
  public updatePreferences(
    input: {
      readonly inApp?: boolean;
      readonly push?: boolean;
      readonly email?: boolean;
      readonly sms?: boolean;
      readonly whatsapp?: boolean;
      readonly quietHoursFrom?: string | null;
      readonly quietHoursTo?: string | null;
    },
    actor: UserContext,
  ): NotificationPreferencesView {
    // API.md 7.17: `inApp = false` es 422, no un booleano cualquiera. La bandeja
    // dentro de la app es el canal histórico; sin ella, `GET /notifications` no
    // tendría de dónde leer.
    if (input.inApp === false) {
      throw new BusinessRuleError('No se pueden desactivar las notificaciones dentro de la aplicación', {
        details: {
          code: 'IN_APP_REQUIRED',
          field: 'inApp',
          hint: 'Las notificaciones dentro de la app son el historial de la bandeja y no se pueden silenciar',
        },
      });
    }

    return runInTransactionSync(() => {
      this.requireOrCreatePreferences(actor.id);
      this.repository.updatePreferences(actor.id, {
        ...(input.inApp === undefined ? {} : { inApp: input.inApp }),
        ...(input.push === undefined ? {} : { push: input.push }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.sms === undefined ? {} : { sms: input.sms }),
        ...(input.whatsapp === undefined ? {} : { whatsapp: input.whatsapp }),
        ...(input.quietHoursFrom === undefined ? {} : { quietHoursFrom: input.quietHoursFrom }),
        ...(input.quietHoursTo === undefined ? {} : { quietHoursTo: input.quietHoursTo }),
      });
      const row = this.repository.findPreferencesRow(actor.id);
      if (row === null) {
        // Innecesario en teoría: `requireOrCreatePreferences` acaba de crear o
        // leer la fila. Si se llega aquí, el disco falló, y un 404 honesto es
        // mejor que un `null` silencioso en la respuesta.
        throw new NotFoundError('Las preferencias de notificación no existen');
      }
      return toPreferencesView(row);
    });
  }

  /**
   * `POST /api/v1/notifications/:id/read` — marcar leída.
   *
   * Idempotente (BR-NOTIF-004): si ya estaba leída, devuelve `200` con el estado
   * actual y sin escribir nada. Una notificación AJENA es `404`: el `WHERE` del
   * repositorio lleva `user_id = actor.id`, así que ni se toca ni se confirma su
   * existencia.
   */
  public markRead(id: number, actor: UserContext): NotificationView {
    return runInTransactionSync(() => {
      const before = this.repository.findByIdForUser(id, actor.id);
      if (before === null) {
        throw new NotFoundError('La notificación no existe', {
          details: { id, type: 'notification' },
        });
      }
      if (before.status !== NotificationStatus.READ) {
        this.repository.markRead(id, actor.id, this.clock.now());
      }
      const after = this.repository.findByIdForUser(id, actor.id);
      if (after === null) {
        // La fila se comprobó hace dos líneas; si desaparece aquí es que otro
        // proceso la borró entre medias, y 404 es la respuesta correcta.
        throw new NotFoundError('La notificación no existe', {
          details: { id, type: 'notification' },
        });
      }
      return toView(after);
    });
  }

  /**
   * `POST /api/v1/notifications/read-all` — marcar leídas todas las del actor.
   *
   * Acotado SIEMPRE al usuario del token: nunca existe un "marcar todo" global,
   * porque eso dejaría la bandeja de un cliente en manos de otro.
   */
  public markAllRead(input: ReadAllInput, actor: UserContext): ReadAllResult {
    return runInTransactionSync(() => {
      const updated = this.repository.markAllRead(
        {
          userId: actor.id,
          ...(input.type === undefined ? {} : { type: input.type }),
          ...(input.before === undefined ? {} : { before: input.before }),
        },
        this.clock.now(),
      );
      return { updated, unreadCount: this.repository.countUnread(actor.id).total };
    });
  }

  // ==========================================================================
  // Auxiliares
  // ==========================================================================

  /**
   * Usuario cuya bandeja se consulta: el del token, salvo que se pida otro
   * explícitamente Y el actor sea personal.
   *
   * Un `CUSTOMER` que pida la bandeja de otro recibe `404` y no `403` (API.md 2):
   * Confirmarle que existe sería filtrar información sobre un recurso ajeno.
   */
  private resolveTargetUser(requested: number | undefined, actor: UserContext): number {
    if (requested === undefined || requested === actor.id) {
      return actor.id;
    }
    if (!actor.isStaff) {
      throw new NotFoundError('La bandeja de notificaciones no existe', {
        details: { type: 'notifications' },
      });
    }
    if (!Number.isInteger(requested) || requested <= 0) {
      throw new AuthorizationError('El usuario indicado no es válido');
    }
    return requested;
  }

  /** Traduce la entrada del controller al filtro del repositorio. */
  private buildFilter(input: ListNotificationsInput, userId: number): NotificationListFilter {
    return {
      userId,
      limit: input.limit,
      offset: input.offset,
      sort: input.sort,
      ...(input.type === undefined ? {} : { type: input.type as NotificationListFilter['type'] }),
      ...(input.channel === undefined ? {} : { channel: input.channel as NotificationListFilter['channel'] }),
      ...(input.status === undefined ? {} : { status: input.status as NotificationListFilter['status'] }),
      ...(input.unreadOnly === undefined ? {} : { unreadOnly: input.unreadOnly }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
    };
  }

  /**
   * Preferencias del usuario, creándolas con los valores por defecto si no
   * existen (BR-NOTIF-005).
   *
   * `INSERT` dentro de la transacción: si dos peticiones del mismo usuario
   * llegan a la vez, el `UNIQUE(user_id)` hace que una gane y la otra recupere la
   * fila ya creada en vez de fallar con un 409.
   */
  private requireOrCreatePreferences(userId: number) {
    const existing = this.repository.findPreferencesRow(userId);
    if (existing !== null) {
      return existing;
    }
    try {
      this.repository.insertPreferences({
        userId,
        inApp: DEFAULT_NOTIFICATION_PREFERENCES.inApp,
        push: DEFAULT_NOTIFICATION_PREFERENCES.push,
        email: DEFAULT_NOTIFICATION_PREFERENCES.email,
        sms: DEFAULT_NOTIFICATION_PREFERENCES.sms,
        whatsapp: DEFAULT_NOTIFICATION_PREFERENCES.whatsapp,
        quietHoursFrom: DEFAULT_NOTIFICATION_PREFERENCES.quietHoursFrom,
        quietHoursTo: DEFAULT_NOTIFICATION_PREFERENCES.quietHoursTo,
      });
    } catch (error) {
      // Carrera del UNIQUE: otra petición llegó antes y creó la fila. Se sigue con
      // la que hay; no es un fallo de la petición, así que no se propaga.
      logger.debug({ userId, error }, 'notificaciones: preferencias ya creadas por otra petición');
    }
    const row = this.repository.findPreferencesRow(userId);
    if (row === null) {
      throw new NotFoundError('Las preferencias de notificación no existen');
    }
    return row;
  }
}

// --------------------------------------------------------------------------
// Proyecciones de fila a DTO
// --------------------------------------------------------------------------

/** Fila de `notifications` -> vista del contrato. `data` parseado. */
function toView(row: NotificationRow): NotificationView {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    channel: row.channel,
    status: row.status,
    data: parseData(row.data),
    orderId: row.order_id,
    reservationId: row.reservation_id,
    readAt: row.read_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/**
 * `notifications.data` es TEXT con `json_valid(data)`, y la API lo publica como
 * objeto. Un `JSON.parse` fallido no debe tumbar la bandeja: se devuelve `null`
 * y el resto de la notificación sigue siendo válida.
 */
function parseData(raw: string | null) {
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as NotificationView['data'];
  } catch {
    return null;
  }
}

/** Preferencias -> vista del contrato (sin `id` ni `userId`: son implícitos). */
function toPreferencesView(row: {
  readonly inApp: boolean;
  readonly push: boolean;
  readonly email: boolean;
  readonly sms: boolean;
  readonly whatsapp: boolean;
  readonly quietHoursFrom: string | null;
  readonly quietHoursTo: string | null;
}): NotificationPreferencesView {
  return {
    inApp: row.inApp,
    push: row.push,
    email: row.email,
    sms: row.sms,
    whatsapp: row.whatsapp,
    quietHoursFrom: row.quietHoursFrom,
    quietHoursTo: row.quietHoursTo,
  };
}
