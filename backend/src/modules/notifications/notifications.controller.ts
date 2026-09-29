/**
 * Controller del módulo `notifications` (API.md 7.17).
 *
 * REGLAS QUE RESPETA ESTE FICHERO
 *  - No decide nada de negocio: no filtra por usuario, no valida franjas
 *    silenciosas ni cuenta nada. Traduce `req` -> tipos del service y la respuesta
 *    -> el envoltorio de API.md 3.
 *  - No contiene `try/catch`: los errores suben a `errorHandler`.
 *  - No escribe SQL ni toca la base de datos.
 *  - `userId` sale SIEMPRE del token (`requireAuth`). El `?userId=` de la query
 *    es un filtro OPCIONAL para el personal, y es el service quien decide si
 *    ese actor puede usarlo (BR-SEC-011). Nunca se lee un destinatario del
 *    cuerpo de una petición.
 */
import type { Response } from 'express';

import { ValidationError } from '../../shared/errors/index.js';
import { sendPaginated, sendSuccess } from '../../shared/http/index.js';
import { requireAuth, type RequestWithAuth } from '../../shared/middleware/index.js';
import type {
  ListNotificationsQuery,
  ReadAllNotificationsBody,
  UpdateNotificationPreferencesBody,
} from './notifications.schemas.js';
import { NOTIFICATION_SORT_DEFAULT } from './notifications.schemas.js';
import type { NotificationSortColumn } from './notifications.types.js';
import type { NotificationsInboxService } from './notifications.service.js';

/** `req` con actor y cuerpo/query/params validados. */
type NotificationRequest = RequestWithAuth & {
  readonly validated?: {
    readonly body?: unknown;
    readonly query?: unknown;
    readonly params?: unknown;
    readonly pagination?: { readonly page: number; readonly pageSize: number };
    readonly sort?: { readonly column: string; readonly direction: 'ASC' | 'DESC' };
  };
};

/** Columnas ordenables, replicadas para acotar la salida de `parseSort`. */
const SORT_COLUMNS: readonly NotificationSortColumn[] = ['created_at', 'read_at'];

/** Controller de la bandeja de notificaciones. */
export class NotificationsController {
  public constructor(private readonly notifications: NotificationsInboxService) {}

  /**
   * `GET /api/v1/notifications` — bandeja paginada del actor.
   *
   * `meta.unreadCount` viaja junto al listado (API.md 7.17) para que el cliente
   * pinte el badge sin una segunda petición.
   */
  public list = async (req: NotificationRequest, res: Response): Promise<void> => {
    const query = (req.validated?.query ?? {}) as ListNotificationsQuery;
    const pagination = req.validated?.pagination ?? { page: 1, pageSize: 20 };
    const requested = req.validated?.sort?.column ?? NOTIFICATION_SORT_DEFAULT;
    const column = (SORT_COLUMNS as readonly string[]).includes(requested)
      ? (requested as NotificationSortColumn)
      : (NOTIFICATION_SORT_DEFAULT as NotificationSortColumn);

    const status = resolveStatusFilter(query);
    const page = this.notifications.list(
      {
        limit: pagination.pageSize,
        offset: (pagination.page - 1) * pagination.pageSize,
        sort: { column, direction: req.validated?.sort?.direction ?? 'DESC' },
        ...(status.status === undefined ? {} : { status: status.status }),
        ...(status.unreadOnly === undefined ? {} : { unreadOnly: status.unreadOnly }),
        ...(query.type === undefined ? {} : { type: query.type }),
        ...(query.channel === undefined ? {} : { channel: query.channel }),
        ...(query.from === undefined ? {} : { from: query.from }),
        ...(query.to === undefined ? {} : { to: query.to }),
        ...(query.userId === undefined ? {} : { userId: query.userId }),
      },
      requireAuth(req),
    );

    sendPaginated(
      res,
      page.items,
      { page: pagination.page, pageSize: pagination.pageSize, total: page.total },
      { unreadCount: page.unreadCount },
    );
  };

  /** `GET /api/v1/notifications/unread-count` — agregación, sin listar. */
  public unreadCount = async (req: NotificationRequest, res: Response): Promise<void> => {
    sendSuccess(res, this.notifications.unreadCount(requireAuth(req)));
  };

  /** `GET /api/v1/notifications/preferences` — crea la fila si falta (BR-NOTIF-005). */
  public getPreferences = async (req: NotificationRequest, res: Response): Promise<void> => {
    sendSuccess(res, this.notifications.getPreferences(requireAuth(req)));
  };

  /**
   * `PUT /api/v1/notifications/preferences` — preferencias del actor.
   * `422 IN_APP_REQUIRED` si `inApp = false`; `400 QUIET_HOURS_INCOMPLETE` si la
   * franja silenciosa viene a medias.
   */
  public updatePreferences = async (req: NotificationRequest, res: Response): Promise<void> => {
    const body = req.validated?.body as UpdateNotificationPreferencesBody;
    assertQuietHoursComplete(body);
    sendSuccess(
      res,
      this.notifications.updatePreferences(
        {
          ...(body.inApp === undefined ? {} : { inApp: body.inApp }),
          ...(body.push === undefined ? {} : { push: body.push }),
          ...(body.email === undefined ? {} : { email: body.email }),
          ...(body.sms === undefined ? {} : { sms: body.sms }),
          ...(body.whatsapp === undefined ? {} : { whatsapp: body.whatsapp }),
          ...(body.quietHoursFrom === undefined ? {} : { quietHoursFrom: body.quietHoursFrom }),
          ...(body.quietHoursTo === undefined ? {} : { quietHoursTo: body.quietHoursTo }),
        },
        requireAuth(req),
      ),
    );
  };

  /**
   * `POST /api/v1/notifications/:id/read` — marcar leída.
   * Idempotente (BR-NOTIF-004). `404` si la notificación es de otro usuario.
   */
  public markRead = async (req: NotificationRequest, res: Response): Promise<void> => {
    const params = req.validated?.params as { id: number };
    sendSuccess(res, this.notifications.markRead(params.id, requireAuth(req)));
  };

  /**
   * `POST /api/v1/notifications/read-all` — marcar leídas las del actor.
   * `updated` = cuántas han cambiado, `unreadCount` = las que quedan.
   */
  public readAll = async (req: NotificationRequest, res: Response): Promise<void> => {
    const body = (req.validated?.body ?? {}) as ReadAllNotificationsBody;
    sendSuccess(
      res,
      this.notifications.markAllRead(
        {
          ...(body.type === undefined ? {} : { type: body.type }),
          ...(body.before === undefined ? {} : { before: body.before }),
        },
        requireAuth(req),
      ),
    );
  };
}

/**
 * Traduce `status`, `unreadOnly` y `read` al filtro único del repositorio.
 *
 * Los tres filtros del contrato y el atajo `read` se combinan aquí, y si se
 * contradicen se responde `400` en vez de elegir por el cliente: un listado
 * ambiguo es un error de la petición, no una decisión del servidor.
 */
function resolveStatusFilter(query: ListNotificationsQuery): {
  readonly status?: string;
  readonly unreadOnly?: boolean;
} {
  const readStatus = query.read === undefined ? undefined : query.read ? 'READ' : undefined;
  const explicitStatus = query.status;

  if (readStatus !== undefined && explicitStatus !== undefined && readStatus !== explicitStatus) {
    throw new ValidationError('Los filtros de lectura se contradicen', {
      details: [
        {
          path: 'read',
          message: `No se puede pedir read=true y status=${explicitStatus} a la vez`,
          code: 'CONFLICTING_FILTERS',
        },
      ],
    });
  }

  const status = explicitStatus ?? readStatus;
  // `unreadOnly` y `read` dicen lo mismo en sentidos opuestos: si llegan los dos,
  // gana `read`, que es el más explícito, y sólo se contradice con `status`.
  if (query.read !== undefined && query.unreadOnly !== undefined) {
    throw new ValidationError('Los filtros de lectura se contradicen', {
      details: [
        {
          path: 'unreadOnly',
          message: 'No se pueden enviar `read` y `unreadOnly` a la vez',
          code: 'CONFLICTING_FILTERS',
        },
      ],
    });
  }

  return {
    ...(status === undefined ? {} : { status }),
    ...(query.read === true ? {} : { unreadOnly: query.unreadOnly ?? query.read === false }),
  };
}

/**
 * `quiet_hours_from` y `quiet_hours_to` van juntos o ninguno: es el `CHECK`
 * `ck_notification_prefs_quiet` del esquema, y fallar con un 500 de integridad
 * sería peor que un `400` con el nombre de la regla.
 */
function assertQuietHoursComplete(body: UpdateNotificationPreferencesBody): void {
  const hasFrom = body.quietHoursFrom !== undefined;
  const hasTo = body.quietHoursTo !== undefined;
  if (hasFrom === hasTo) {
    return;
  }
  throw new ValidationError('La franja silenciosa necesita las dos horas', {
    details: [
      {
        path: hasFrom ? 'quietHoursTo' : 'quietHoursFrom',
        message: 'Envíe las dos horas de la franja silenciosa o ninguna',
        code: 'QUIET_HOURS_INCOMPLETE',
      },
    ],
  });
}
