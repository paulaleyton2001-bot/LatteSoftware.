/**
 * SERVICIO DE NOTIFICACIONES COMPARTIDO (BR-NOTIF-001..005).
 *
 * ============================== POR QUÉ ESTÁ AQUÍ ==============================
 * La lógica de ENCOLAR una notificación no pertenece a un módulo: la escriben
 * pedidos, reservas, pagos, inventario y, en el futuro, cualquier otro caso de
 * uso. Por eso vive en `shared/services/` junto a la auditoría, y el módulo
 * `notifications` sólo publica los ENDPOINTS de la bandeja de entrada
 * (`GET /api/v1/notifications/*`). Un módulo futuro importa ESTE fichero y
 * llama a `enqueue()`; no toca el módulo de notificaciones ni sus rutas.
 *
 * ```ts
 * import { getNotificationsService } from '../notifications/notifications.container.js';
 *
 * const resultado = getNotificationsService().enqueue({
 *   userId: cliente.id,            // SIEMPRE del token o del caso de uso, nunca del cliente HTTP
 *   type: NotificationType.RESERVATION_CONFIRMED,
 *   title: 'Reserva confirmada',
 *   body: `Tu silla ${silla.code} te espera el ${fecha}.`,
 *   reservationId: reserva.id,     // referencia para el `data`
 * });
 * ```
 *
 * ============================== CANALES ======================================
 * La tabla `notifications` tiene la columna `channel` con cinco valores
 * (`IN_APP`, `PUSH`, `EMAIL`, `SMS`, `WHATSAPP`): la ARQUITECTURA está preparada
 * para canales externos, NINGUNO está implementado. Consecuencias visibles:
 *  - `IN_APP` es el único canal que se "entrega": se persiste con
 *    `status = 'SENT'` y `sent_at` al instante, y nunca se silencia.
 *  - Un canal externo se persiste SIEMPRE como `status = 'PENDING'` con
 *    `sent_at = NULL`: la fila ES la cola, y el envío lo hará un worker que
 *    todavía no existe. Por eso `delivered` es `false` y `reason` explica por
 *    qué (`CHANNEL_DISABLED`, `QUIET_HOURS`, `EXTERNAL_CHANNEL_NOT_IMPLEMENTED`).
 *
 * ============================ REGLAS QUE APLICA ==============================
 *  - **BR-NOTIF-001** el encolado es un efecto externo: se llama DESPUÉS del
 *    commit de la transacción de negocio. Nunca lanza por una notificación
 *    fallida, pero avisa en el log si detecta que se la llamó dentro de una
 *    transacción, porque eso rompería la garantía de que un fallo de
 *    notificación no revierte un cobro ni una reserva.
 *  - **BR-NOTIF-002/003** el canal efectivo se filtra por las preferencias del
 *    usuario, respetando `quiet_hours`. `IN_APP` es el canal histórico y se
 *    persiste siempre: es el historial que el cliente consulta en la app.
 *  - **BR-NOTIF-005** un usuario sin fila en `notification_preferences` usa
 *    {@link DEFAULT_NOTIFICATION_PREFERENCES}. `enqueue()` NO crea la fila (es
 *    una escritura de encolado, no de configuración): sólo la usan los
 *    defaults. `GET /api/v1/notifications/preferences` sí la crea.
 *
 * ============================== SIN SQL ======================================
 * Este fichero no escribe SQL. Depende del puerto {@link NotificationStore}, que
 * implementa `modules/notifications/notifications.repository.sqlite.ts`. El
 * puerto lo declara el CONSUMIDOR (regla hexagonal), así que `shared/` no
 * depende de `modules/`.
 */
import { AUTH, MONEY } from '../../config/index.js';
import { inTransaction } from '../database/unit-of-work.js';
import {
  NotificationChannel,
  NotificationStatus,
  NotificationType,
} from '../domain/index.js';
import { ValidationError } from '../errors/index.js';
import { logger } from '../logger/index.js';
import { localTimeKey, nowIso, parseIso } from '../utils/datetime.js';

// --------------------------------------------------------------------------
// Puerto de persistencia
// --------------------------------------------------------------------------

/** Valor admitido en el JSON `data` de una notificación. */
export type NotificationDataValue = string | number | boolean | null;

/**
 * Contenido de `notifications.data`: sólo identificadores de referencia
 * (`orderId`, `reservationId`, `locationId`...). Nunca datos sensibles: la
 * columna se muestra en la app y viaja en cada respuesta de la bandeja.
 */
export type NotificationData = Readonly<Record<string, NotificationDataValue>>;

/** Fila a insertar en `notifications`, ya con las decisiones tomadas. */
export interface NewNotificationRecord {
  readonly userId: number;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly channel: NotificationChannel;
  readonly status: NotificationStatus;
  /** `notifications.data` ya serializado, o `null`. */
  readonly data: string | null;
  readonly orderId: number | null;
  readonly reservationId: number | null;
  readonly sentAt: string | null;
}

/** Preferencias de notificación de un usuario, en camelCase. */
export interface NotificationPreferencesRecord {
  readonly inApp: boolean;
  readonly push: boolean;
  readonly email: boolean;
  readonly sms: boolean;
  readonly whatsapp: boolean;
  /** `HH:MM` local del negocio, o `null` si no hay horario silencioso. */
  readonly quietHoursFrom: string | null;
  readonly quietHoursTo: string | null;
}

/**
 * Preferencias por defecto (BR-NOTIF-005): `in_app = 1`, `push = 1`, resto `0`,
 * sin horario silencioso. Mismos valores que los `DEFAULT` del esquema.
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesRecord = Object.freeze({
  inApp: true,
  push: true,
  email: false,
  sms: false,
  whatsapp: false,
  quietHoursFrom: null,
  quietHoursTo: null,
});

/**
 * Puerto de persistencia que necesita ESTE servicio.
 *
 * Lo declara el consumidor y lo implementa la infraestructura, de modo que
 * `shared/services` no importa nada de `modules/`. Cualquier implementación
 * que cumpla el contrato sirve (hoy: `SqliteNotificationsRepository`; mañana:
 * una de PostgreSQL, o un doble en un test).
 */
export interface NotificationStore {
  /** Inserta la fila y devuelve su id. */
  insert(record: NewNotificationRecord): number;
  /** Preferencias del usuario, o `null` si todavía no tiene fila. */
  findPreferences(userId: number): NotificationPreferencesRecord | null;
  /** Zona horaria IANA del negocio, o `null` si no se puede leer. */
  findBusinessTimezone(businessId: number): string | null;
}

// --------------------------------------------------------------------------
// Contrato de `enqueue`
// --------------------------------------------------------------------------

/** Por qué una notificación encolada no se ha entregado todavía. */
export type NotificationSuppressionReason =
  | 'CHANNEL_DISABLED'
  | 'QUIET_HOURS'
  | 'EXTERNAL_CHANNEL_NOT_IMPLEMENTED';

/** Entrada de {@link NotificationsService.enqueue}. */
export interface EnqueueNotificationInput {
  /**
   * Destinatario. Lo decide el CASO DE USO (el usuario del token, el
   * `customer_id` del pedido, el dueño de la reserva): nunca se lee del cuerpo
   * de una petición HTTP sin validar.
   */
  readonly userId: number;
  /** Tipo de `NotificationType` (API.md 6.2). */
  readonly type: NotificationType;
  /** Asunto corto, ya renderizado. */
  readonly title: string;
  /** Cuerpo, ya renderizado (API.md 4.6: el texto se guarda listo para pintar). */
  readonly body: string;
  /** Canal solicitado. Por defecto `IN_APP`. */
  readonly channel?: NotificationChannel;
  /**
   * Negocio destinatario. En v1 hay uno por despliegue
   * (`AUTH.DEFAULT_BUSINESS_ID`); se expone para que el multi-tenant futuro no
   * tenga que cambiar esta firma.
   */
  readonly businessId?: number;
  /** Referencias para el `data` de la fila. Nunca datos sensibles. */
  readonly data?: NotificationData | null;
  /** Pedido relacionado, si lo hay (`notifications.order_id`). */
  readonly orderId?: number | null;
  /** Reserva relacionada, si la hay (`notifications.reservation_id`). */
  readonly reservationId?: number | null;
  /**
   * Reloj inyectado (ISO-8601 UTC). Por defecto, el reloj del sistema. Lo usan
   * el scheduler (para encolar con antelación) y los tests, que no deben
   * depender de la hora real.
   */
  readonly at?: string;
  /**
   * `false` ignora `quiet_hours` para esta notificación. Existe para avisos
   * críticos (un pago rechazado); por defecto se respetan siempre.
   */
  readonly respectQuietHours?: boolean;
}

/** Resultado de {@link NotificationsService.enqueue}. */
export interface EnqueueNotificationResult {
  /** Id de la fila creada. */
  readonly id: number;
  readonly userId: number;
  readonly channel: NotificationChannel;
  /** Estado con el que quedó persistida. */
  readonly status: NotificationStatus;
  /** `sent_at`, o `null` si la notificación no se ha enviado. */
  readonly sentAt: string | null;
  /** `true` sólo si el canal es `IN_APP` (el único implementado). */
  readonly delivered: boolean;
  /** `null` si se entregó; si no, por qué sigue en la cola. */
  readonly reason: NotificationSuppressionReason | null;
}

/** Longitudes máximas de título y cuerpo (acotan la fila y la push future). */
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 500;

// --------------------------------------------------------------------------
// Servicio
// --------------------------------------------------------------------------

/**
 * Servicio de notificaciones reutilizable por cualquier módulo.
 *
 * Una instancia por proceso. La construye `modules/notifications/
 * notifications.container.ts` y la consumen tanto el módulo como los módulos
 * futuros; cuando el integrador la añada a `config/container.ts`, ambas vías
 * seguirán siendo la MISMA instancia.
 */
export class NotificationsService {
  public constructor(private readonly store: NotificationStore) {}

  /**
   * Encola una notificación para un usuario.
   *
   * Nunca lanza por un problema de preferencias: una notificación que no se
   * puede entregar se persiste igualmente y se devuelve el motivo, para que la
   * fila quede en la cola y un worker pueda reintentarla. SÍ lanza
   * `ValidationError` si la entrada es incoherente (id no positivo, `at` no
   * ISO-8601, `data` no serializable), porque eso es un fallo de programación.
   *
   * @see BR-NOTIF-001 La llamada debe hacerse FUERA de la transacción de
   *      negocio, después del commit.
   */
  public enqueue(input: EnqueueNotificationInput): EnqueueNotificationResult {
    assertPositiveInteger('userId', input.userId);
    const at = input.at === undefined ? nowIso() : parseIso(input.at, 'at').toISOString();
    const channel = input.channel ?? NotificationChannel.IN_APP;
    const businessId = input.businessId ?? AUTH.DEFAULT_BUSINESS_ID;

    if (inTransaction()) {
      // BR-NOTIF-001: la notificación es un efecto externo posterior al commit.
      // No se lanza: tumbar un cobro por un aviso sería peor que auditarlo.
      logger.warn(
        { userId: input.userId, type: input.type, channel },
        'notificaciones: enqueue() se ha llamado dentro de una transacción; ' +
          'BR-NOTIF-001 exige encolar después del commit de la operación de negocio',
      );
    }

    const preferences = this.store.findPreferences(input.userId) ?? DEFAULT_NOTIFICATION_PREFERENCES;
    const delivery = this.resolveDelivery({
      channel,
      preferences,
      at,
      businessId,
      respectQuietHours: input.respectQuietHours !== false,
    });

    const id = this.store.insert({
      userId: input.userId,
      type: input.type,
      title: requireText('title', input.title, MAX_TITLE_LENGTH),
      body: requireText('body', input.body, MAX_BODY_LENGTH),
      channel,
      status: delivery.status,
      data: serializeData(input.data),
      orderId: input.orderId ?? null,
      reservationId: input.reservationId ?? null,
      sentAt: delivery.sentAt,
    });

    return {
      id,
      userId: input.userId,
      channel,
      status: delivery.status,
      sentAt: delivery.sentAt,
      delivered: delivery.delivered,
      reason: delivery.reason,
    };
  }

  /**
   * Decide el estado con el que se persiste la notificación.
   *
   * Es la ÚNICA fuente de verdad de la política de canales, y por eso vive en el
   * servicio compartido y no en el módulo de endpoints.
   */
  private resolveDelivery(input: {
    readonly channel: NotificationChannel;
    readonly preferences: NotificationPreferencesRecord;
    readonly at: string;
    readonly businessId: number;
    readonly respectQuietHours: boolean;
  }): {
    readonly status: NotificationStatus;
    readonly sentAt: string | null;
    readonly delivered: boolean;
    readonly reason: NotificationSuppressionReason | null;
  } {
    // IN_APP: canal histórico, siempre disponible y nunca silenciado.
    if (input.channel === NotificationChannel.IN_APP) {
      return { status: NotificationStatus.SENT, sentAt: input.at, delivered: true, reason: null };
    }

    // Canal externo apagado por el usuario (BR-NOTIF-003).
    if (!isChannelEnabled(input.channel, input.preferences)) {
      return {
        status: NotificationStatus.PENDING,
        sentAt: null,
        delivered: false,
        reason: 'CHANNEL_DISABLED',
      };
    }

    // Franja silenciosa (BR-NOTIF-002): no se envía, pero la fila queda en la
    // cola (`PENDING`, `sent_at = NULL`) para que el worker la recupere fuera
    // de la franja.
    if (input.respectQuietHours && this.isInQuietHours(input.at, input.businessId, input.preferences)) {
      return {
        status: NotificationStatus.PENDING,
        sentAt: null,
        delivered: false,
        reason: 'QUIET_HOURS',
      };
    }

    // Arquitectura preparada, envío no implementado: la fila ES la cola.
    return {
      status: NotificationStatus.PENDING,
      sentAt: null,
      delivered: false,
      reason: 'EXTERNAL_CHANNEL_NOT_IMPLEMENTED',
    };
  }

  /**
   * `true` si el instante cae en la franja silenciosa del usuario.
   *
   * La franja se evalúa en hora local del NEGOCIO (`businesses.timezone`), que
   * es la hora que ve el cliente. Puede **cruzar medianoche**: `22:00 → 07:00`
   * es válido y significa "de 22:00 a 24:00 y de 00:00 a 07:00". Si los dos
   * extremos son iguales la franja se considera VACÍA (no silenciosa), porque
   * un usuario que los iguala está describiendo "cualquier momento" y no "nunca".
   */
  private isInQuietHours(
    at: string,
    businessId: number,
    preferences: NotificationPreferencesRecord,
  ): boolean {
    const from = preferences.quietHoursFrom;
    const to = preferences.quietHoursTo;
    if (from === null || to === null || from === to) {
      return false;
    }
    const timezone = this.store.findBusinessTimezone(businessId) ?? MONEY.DEFAULT_TIMEZONE;
    const localTime = localTimeKey(at, timezone);
    return from < to
      ? localTime >= from && localTime < to
      : localTime >= from || localTime < to;
  }
}

/** `true` si el usuario tiene activado ese canal externo. */
function isChannelEnabled(
  channel: NotificationChannel,
  preferences: NotificationPreferencesRecord,
): boolean {
  switch (channel) {
    case NotificationChannel.IN_APP:
      return true;
    case NotificationChannel.PUSH:
      return preferences.push;
    case NotificationChannel.EMAIL:
      return preferences.email;
    case NotificationChannel.SMS:
      return preferences.sms;
    case NotificationChannel.WHATSAPP:
      return preferences.whatsapp;
    default:
      return false;
  }
}

/** Serializa `notifications.data`; `null` y vacío se guardan como `NULL`. */
function serializeData(data: NotificationData | null | undefined): string | null {
  if (data === null || data === undefined) {
    return null;
  }
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return null;
  }
  try {
    return JSON.stringify(Object.fromEntries(entries));
  } catch (error) {
    throw new ValidationError('El campo `data` de la notificación no es serializable', {
      details: [{ path: 'data', message: 'Debe ser un objeto plano de valores simples', code: 'INVALID_FORMAT' }],
      cause: error,
    });
  }
}

/** Texto obligatorio, acotado y sin espacios extremos. */
function requireText(field: string, value: string, max: number): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`El campo \`${field}\` de la notificación es obligatorio`, {
      details: [{ path: field, message: 'Debe ser texto', code: 'INVALID_TYPE' }],
    });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) {
    throw new ValidationError(`El campo \`${field}\` de la notificación no es válido`, {
      details: [
        {
          path: field,
          message: `Debe tener entre 1 y ${max} caracteres`,
          code: trimmed.length === 0 ? 'TOO_SMALL' : 'TOO_BIG',
        },
      ],
    });
  }
  return trimmed;
}

/** Id de usuario: entero positivo, siempre. */
function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ValidationError(`El campo \`${field}\` de la notificación no es válido`, {
      details: [{ path: field, message: 'Debe ser un entero mayor que cero', code: 'INVALID_VALUE' }],
    });
  }
}
