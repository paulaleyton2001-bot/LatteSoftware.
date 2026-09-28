/**
 * Módulo `system` — el único módulo de la fundación.
 *
 * Expone, todas PÚBLICAS (API.md 2 y 7.19):
 *  - `GET /api/v1/health`    sonda de vida. 503, nunca 500, si la BD falla.
 *  - `GET /api/v1/meta/enums` fuente única de enumerados y transiciones.
 *  - `GET /api/v1/meta/roles` roles, permisos y matriz, leídos de la BD.
 *
 * Los endpoints `/meta/*` existen para que el frontend NO duplique enums,
 * matrices ni formatos: los recibe del servidor, que es la misma fuente que
 * valida los services.
 */
import { Router } from 'express';

import { API_PREFIX, env, MONEY } from '../../config/index.js';
import { checkDatabaseHealth } from '../../shared/database/health.js';
import {
  hasSchema,
  listPermissions,
  listRolePermissions,
  listRoles,
  findActiveBusiness,
} from '../../shared/database/queries.js';
import {
  CHAIR_FORBIDDEN_TRANSITIONS,
  CHAIR_TRANSITIONS,
  ORDER_FORBIDDEN_TRANSITIONS,
  ORDER_TRANSITIONS,
  PAYMENT_FORBIDDEN_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  RENTAL_FORBIDDEN_TRANSITIONS,
  RENTAL_TRANSITIONS,
  RESERVATION_FORBIDDEN_TRANSITIONS,
  RESERVATION_TRANSITIONS,
  ROLE_HIERARCHY,
  AuditAction,
  ChairKind,
  ChairStatus,
  DiscountAppliesTo,
  DiscountType,
  MovementType,
  NotificationChannel,
  NotificationStatus,
  NotificationType,
  OrderChannel,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  RentalStatus,
  ReservationSource,
  ReservationStatus,
  Role,
  UserStatus,
  enumValues,
} from '../../shared/domain/index.js';
import { ServiceUnavailableError } from '../../shared/errors/index.js';
import { asyncHandler, sendError, sendSuccess } from '../../shared/http/index.js';
import { logger } from '../../shared/logger/index.js';
import { localDateKey, localTimeKey, nowIso } from '../../shared/utils/datetime.js';

/** Instante de arranque del proceso, para `uptimeSeconds`. */
const PROCESS_STARTED_AT_MS = Date.now();

/** Router del módulo system. Se monta bajo `/api/v1`. */
export const systemRouter: Router = Router();

/**
 * `GET /api/v1/health`
 *
 * 200 -> `{ status, name, version, uptimeSeconds, database, checks }`.
 * 503 -> envoltorio de error de API.md 3.2 con
 *        `details = { status: 'degraded', reason: 'DATABASE_UNAVAILABLE', ... }`.
 *
 * NOTA DE CONTRATO: API.md 7.19 describe el 503 con `data: { status: 'degraded' }`
 * junto a `error`, pero API.md 3.2 y 8.1.6 establecen que todo endpoint de
 * error devuelve exclusivamente `{ success, error, requestId }`. Se sigue la
 * regla 3.2 (la más específica y marcada como contrato congelado) y el estado
 * degradado viaja en `error.details.status`.
 */
systemRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const health = checkDatabaseHealth();
    const timestamp = nowIso();
    const uptimeSeconds = Math.floor((Date.now() - PROCESS_STARTED_AT_MS) / 1000);

    if (!health.connected) {
      logger.error(
        { reason: health.reason },
        'health: dependencia caída; respondiendo 503 SERVICE_UNAVAILABLE',
      );
      sendError(
        res,
        new ServiceUnavailableError('Servicio no disponible', {
          details: {
            status: 'degraded',
            reason: 'DATABASE_UNAVAILABLE',
            version: env.appVersion,
            uptimeSeconds,
            checks: { database: 'down', scheduler: 'not-configured' },
          },
        }),
      );
      return;
    }

    const degraded = health.migrationsPending > 0;
    sendSuccess(
      res,
      {
        status: degraded ? 'degraded' : 'ok',
        name: env.appName,
        version: env.appVersion,
        uptimeSeconds,
        database: { connected: health.connected, migrationsPending: health.migrationsPending },
        checks: { database: health.check, scheduler: 'not-configured' },
      },
      { timestamp, generatedAt: timestamp },
    );
  }),
);

/**
 * `GET /api/v1/meta/enums`
 *
 * Publica exactamente las mismas tablas de transición que validan los services
 * (API.md 8.1, punto 1), así que divergir entre cliente y servidor es
 * imposible por construcción.
 */
systemRouter.get(
  '/meta/enums',
  asyncHandler(async (_req, res) => {
    const business = safeReadBusiness();
    const now = new Date();
    const timezone = business?.timezone ?? env.defaults.timezone;
    const currencyCode = business?.currency_code ?? env.defaults.currency;
    const currencySymbol = business?.currency_symbol ?? MONEY.DEFAULT_CURRENCY_SYMBOL;
    const locale = business?.locale ?? MONEY.DEFAULT_LOCALE;

    sendSuccess(
      res,
      {
        enums: {
          Role: enumValues(Role),
          UserStatus: enumValues(UserStatus),
          ChairKind: enumValues(ChairKind),
          ChairStatus: enumValues(ChairStatus),
          ReservationStatus: enumValues(ReservationStatus),
          ReservationSource: enumValues(ReservationSource),
          RentalStatus: enumValues(RentalStatus),
          OrderType: enumValues(OrderType),
          OrderStatus: enumValues(OrderStatus),
          OrderItemStatus: enumValues(OrderItemStatus),
          OrderChannel: enumValues(OrderChannel),
          PaymentMethod: enumValues(PaymentMethod),
          PaymentProvider: enumValues(PaymentProvider),
          PaymentStatus: enumValues(PaymentStatus),
          DiscountType: enumValues(DiscountType),
          DiscountAppliesTo: enumValues(DiscountAppliesTo),
          InventoryMovementType: enumValues(MovementType),
          NotificationType: enumValues(NotificationType),
          NotificationChannel: enumValues(NotificationChannel),
          NotificationStatus: enumValues(NotificationStatus),
          AuditAction: enumValues(AuditAction),
        },
        transitions: {
          orders: ORDER_TRANSITIONS,
          chairReservations: RESERVATION_TRANSITIONS,
          chairRentals: RENTAL_TRANSITIONS,
          chairs: CHAIR_TRANSITIONS,
          payments: PAYMENT_TRANSITIONS,
        },
        forbidden: {
          orders: ORDER_FORBIDDEN_TRANSITIONS,
          chairReservations: RESERVATION_FORBIDDEN_TRANSITIONS,
          chairRentals: RENTAL_FORBIDDEN_TRANSITIONS,
          chairs: CHAIR_FORBIDDEN_TRANSITIONS,
          payments: PAYMENT_FORBIDDEN_TRANSITIONS,
        },
        roles: { hierarchy: ROLE_HIERARCHY },
        formats: {
          currencyCode,
          currencySymbol,
          locale,
          timezone,
          dateExample: localDateKey(now, timezone),
          dateTimeExample: now.toISOString(),
          timeExample: localTimeKey(now, timezone),
          priceExample: `${currencySymbol}${priceExampleFor(currencyCode)}`,
        },
      },
      { generatedAt: nowIso(), version: env.appVersion },
    );
  }),
);

/** Marca de la matriz de RBAC: C = completo, P = parcial (sólo lo propio), - = denegado. */
export type MatrixMark = 'C' | 'P' | '-';

/** Instantánea de roles, permisos y matriz. */
interface RoleMatrix {
  readonly roles: readonly {
    readonly id: number;
    readonly name: string;
    readonly description: string | null;
    readonly isSystem: boolean;
    readonly permissionCount: number;
  }[];
  readonly permissions: readonly {
    readonly key: string;
    readonly module: string;
    readonly description: string | null;
  }[];
  readonly matrix: Readonly<Record<string, Readonly<Record<string, MatrixMark>>>>;
  readonly hierarchy: readonly string[];
}

/**
 * `GET /api/v1/meta/roles`
 *
 * Roles, permisos y matriz leídos de `role_permissions`. Con las tablas de RBAC
 * todavía vacías (la semilla es de la fase 7) responde 503 en lugar de
 * inventar una matriz.
 */
systemRouter.get(
  '/meta/roles',
  asyncHandler(async (_req, res) => {
    const snapshot = readRoleMatrix();
    if (snapshot === null) {
      sendError(
        res,
        new ServiceUnavailableError('Servicio no disponible', {
          details: {
            reason: 'RBAC_NOT_SEEDED',
            hint: 'Ejecute `npm run migrate` y `npm run seed` para habilitar la matriz de roles.',
          },
        }),
      );
      return;
    }
    sendSuccess(res, snapshot, { generatedAt: nowIso(), version: env.appVersion });
  }),
);

/** Ajustes del negocio, o `null` si la tabla no existe o está vacía. */
function safeReadBusiness(): {
  readonly currency_code: string;
  readonly currency_symbol: string;
  readonly locale: string;
  readonly timezone: string;
} | null {
  try {
    if (!hasSchema()) {
      return null;
    }
    return findActiveBusiness();
  } catch (error) {
    logger.warn({ error }, 'meta: no se pudieron leer los ajustes del negocio');
    return null;
  }
}

/** `$5.000` para monedas sin decimales, `$5.000,00` para el resto. */
function priceExampleFor(currencyCode: string): string {
  const withoutDecimals = ['COP', 'CLP', 'JPY', 'KRW', 'VND'].includes(currencyCode);
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: withoutDecimals ? 0 : 2,
    maximumFractionDigits: withoutDecimals ? 0 : 2,
  }).format(5000);
}

/**
 * Lee la matriz de RBAC de la base de datos. Devuelve `null` si el esquema no
 * existe o si todavía no hay roles sembrados.
 */
function readRoleMatrix(): RoleMatrix | null {
  try {
    if (!hasSchema()) {
      return null;
    }
    const roles = listRoles();
    if (roles.length === 0) {
      return null;
    }
    const permissions = listPermissions();
    const grants = listRolePermissions();

    const grantedByRole = new Map<string, Set<string>>();
    for (const grant of grants) {
      const set = grantedByRole.get(grant.role_name) ?? new Set<string>();
      set.add(grant.permission_key);
      grantedByRole.set(grant.role_name, set);
    }

    const matrix: Record<string, Record<string, MatrixMark>> = {};
    for (const role of roles) {
      const granted = grantedByRole.get(role.name) ?? new Set<string>();
      const row: Record<string, MatrixMark> = {};
      for (const permission of permissions) {
        row[permission.key] = granted.has(permission.key) ? 'C' : '-';
      }
      matrix[role.name] = Object.freeze(row);
    }

    return {
      roles: roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.is_system === 1,
        permissionCount: (grantedByRole.get(role.name) ?? new Set<string>()).size,
      })),
      permissions: permissions.map((permission) => ({
        key: permission.key,
        module: permission.module,
        description: permission.description,
      })),
      matrix: Object.freeze(matrix),
      hierarchy: ROLE_HIERARCHY,
    };
  } catch (error) {
    logger.warn({ error }, 'meta/roles: la matriz no está disponible');
    return null;
  }
}

/** Prefijo bajo el que se monta este router. */
export const SYSTEM_ROUTE_PREFIX = API_PREFIX;
