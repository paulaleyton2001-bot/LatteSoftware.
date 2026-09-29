/**
 * Esquemas zod del módulo `notifications` (API.md 7.17).
 *
 * TODOS son `.strict()`: un campo desconocido es `400 VALIDATION_ERROR` con
 * `code: 'UNKNOWN_FIELD'`, no se ignora en silencio (API.md 1).
 *
 * ============================ DÓNDE VIVE QUÉ ==============================
 *  - Los esquemas NO contienen reglas de negocio: que un `CUSTOMER` no pueda ver
 *    la bandeja de otro, que `inApp = false` sea `422` o que la franja
 *    silenciosa tenga que ir completa lo resuelve el service, que es donde están
 *    los datos ya conocidos.
 *  - Lo que SÍ vive aquí es la FORMA: longitudes, tipos y formatos. Los
 *    enums salen de `shared/domain/enums.ts`, que es la MISMA fuente que
 *    publica `GET /api/v1/meta/enums`: el frontend nunca los duplica.
 */
import { z } from 'zod';

import { NotificationChannel, NotificationStatus, NotificationType } from '../../shared/domain/index.js';
import { buildListQuerySchema } from '../../shared/http/index.js';
import { resourceIdField } from '../../shared/validation/index.js';
import { isHhMm } from '../business/business.hours.js';

/** Booleanos de query: `true`/`false` y también `"true"`/`"false"`. */
const booleanQueryField = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Instante ISO-8601 con offset o `Z`, normalizado a UTC por el service. */
const isoInstantField = (label: string) =>
  z
    .string({ error: `${label} es obligatorio` })
    .trim()
    .datetime({ offset: true, message: `${label} debe ser un instante ISO-8601` });

/** Hora local `HH:MM` (mismo patrón que el `CHECK` de horario y de quiet hours). */
const hhMmField = (label: string) =>
  z
    .string({ error: `${label} es obligatoria` })
    .trim()
    .refine(isHhMm, `${label} debe tener formato HH:MM en 24 horas, por ejemplo 22:00`);

// --------------------------------------------------------------------------
// 7.17 Notificaciones
// --------------------------------------------------------------------------

/**
 * `GET /api/v1/notifications` (API.md 7.17).
 *
 * Filtros del contrato: `status`, `type`, `channel`, `unreadOnly`, `from`, `to`,
 * `page`, `pageSize`, `sort` (`createdAt` | `readAt`) y `order`.
 *
 * `read` es un ATREGADO de conveniencia, no del contrato: `?read=false` es
 * "sólo las no leídas" y `?read=true` es "sólo las leídas". Es el mismo filtro que
 * `unreadOnly`, al revés, para no obligar al cliente a traducir un interruptor de
 * la UI. Si se envían `read` y `status` CONTRADICTORIOS (`read=true` con
 * `status=PENDING`), el service devuelve `400` en vez de elegir por su cuenta.
 *
 * `userId` NO aparece en el contrato: se acepta para el personal (BR-SEC-011) y
 * el service lo rechaza con `404` para el resto. El `userId` por defecto SIEMPRE
 * sale del token.
 */
export const listNotificationsQuerySchema = buildListQuerySchema({
  status: z.enum(NotificationStatus).optional(),
  type: z.enum(NotificationType).optional(),
  channel: z.enum(NotificationChannel).optional(),
  unreadOnly: booleanQueryField.optional(),
  read: booleanQueryField.optional(),
  from: isoInstantField('La fecha inicial').optional(),
  to: isoInstantField('La fecha final').optional(),
  userId: resourceIdField.optional(),
});

/** `POST /api/v1/notifications/:id/read`. */
export const notificationIdParamsSchema = z
  .object({
    id: resourceIdField,
  })
  .strict();

/** `POST /api/v1/notifications/read-all`. Cuerpo opcional. */
export const readAllNotificationsBodySchema = z
  .object({
    type: z.enum(NotificationType).optional(),
    before: isoInstantField('La fecha límite').optional(),
  })
  .strict()
  .default({});

/**
 * `PUT /api/v1/notifications/preferences`.
 *
 * - `quietHoursFrom` y `quietHoursTo` van juntos o ninguno (`CHECK` del
 *   esquema). La incoherencia es `400 QUIET_HOURS_INCOMPLETE`, y lo decide el
 *   service porque depende de la PARTE ausente, no del valor.
 * - La franja PUEDE cruzar medianoche (`22:00` -> `07:00`): es la forma normal de
 *   callar de noche, así que `quietHoursTo < quietHoursFrom` es válido.
 * - `inApp = false` lo rechaza el service con `422 IN_APP_REQUIRED` (API.md
 *   7.17): es el canal histórico de la bandeja, no una preferencia más.
 */
export const updateNotificationPreferencesBodySchema = z
  .object({
    inApp: z.boolean().optional(),
    push: z.boolean().optional(),
    email: z.boolean().optional(),
    sms: z.boolean().optional(),
    whatsapp: z.boolean().optional(),
    quietHoursFrom: hhMmField('La hora de inicio de la franja silenciosa')
      .nullable()
      .optional(),
    quietHoursTo: hhMmField('La hora de fin de la franja silenciosa').nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Debe enviar al menos un campo para actualizar');

/** Columnas ordenables de `GET /api/v1/notifications` (API.md 7.17). */
export const NOTIFICATION_SORT_COLUMNS = ['created_at', 'read_at'] as const;
export const NOTIFICATION_SORT_DEFAULT = 'created_at';

// --------------------------------------------------------------------------
// Tipos inferidos, para los controllers
// --------------------------------------------------------------------------

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type ReadAllNotificationsBody = z.infer<typeof readAllNotificationsBodySchema>;
export type UpdateNotificationPreferencesBody = z.infer<
  typeof updateNotificationPreferencesBodySchema
>;
