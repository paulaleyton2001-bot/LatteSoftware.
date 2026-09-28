/**
 * Tipos compartidos del dominio y de la petición.
 *
 * No contiene lógica de negocio: sólo estructuras que comparten el middleware,
 * los servicios y el endpoint `GET /api/v1/meta/enums`.
 */
import type { Request } from 'express';

import type { Role, SystemActor, UserStatus } from './enums.js';

// --------------------------------------------------------------------------
// Actor y contexto de autenticación
// --------------------------------------------------------------------------

/** Identidad del actor que ejecuta la operación. */
export interface UserContext {
  readonly id: number;
  readonly email: string;
  readonly fullName: string;
  /** `business_id` del actor. Sale del token, nunca del body ni del query. */
  readonly businessId: number;
  readonly status: UserStatus;
  readonly isStaff: boolean;
  /** Roles efectivos, cargados de `user_roles`. Puede tener varios (OR). */
  readonly roles: readonly Role[];
  /** Union de permisos de todos sus roles, según `role_permissions`. */
  readonly permissions: readonly string[];
}

/** Contexto de la petición: correlación, actor y datos ya validados. */
export interface RequestContext {
  /** UUID v4, eco de la cabecera `X-Request-Id` si el cliente la envió. */
  readonly requestId: string;
  readonly startedAt: number;
  /** Presente tras `authenticate`. */
  readonly user: UserContext | null;
  readonly params: Record<string, unknown>;
  readonly query: Record<string, unknown>;
  readonly body: unknown;
}

/** `Request` de Express con el contexto ya inyectado por los middlewares. */
export interface RequestWithContext extends Request {
  context?: RequestContext;
}

// --------------------------------------------------------------------------
// Máquinas de estado
// --------------------------------------------------------------------------

/** Quién puede ejecutar una transición (un rol o el scheduler). */
export type TransitionActor = Role | SystemActor;

/** Transición válida de una entidad. La publica `GET /api/v1/meta/enums`. */
export interface StateTransition<TFrom extends string, TTo extends string> {
  readonly from: TFrom;
  readonly to: TTo;
  /** Roles autorizados. Semántica OR: basta con uno. */
  readonly roles: readonly TransitionActor[];
  /** Etiqueta legible para el botón de la UI. */
  readonly label: string;
  /** Endpoint que ejecuta la transición, para que el cliente sepa qué pintar. */
  readonly endpoint: string;
}

/** Transición prohibida, con su motivo. Se publica en `meta/enums.forbidden`. */
export interface ForbiddenTransition<TFrom extends string, TTo extends string> {
  readonly from: TFrom;
  readonly to: TTo;
  readonly reason: string;
}

/** Definición completa de una máquina de estados. */
export interface StateMachine<TStatus extends string> {
  /** Clave de la entidad: `orders`, `chairReservations`, ... */
  readonly entity: string;
  readonly transitions: readonly StateTransition<TStatus, TStatus>[];
  readonly forbidden: readonly ForbiddenTransition<TStatus, TStatus>[];
  /** Estados sin salida. Un estado terminal no admite más transiciones. */
  readonly terminal: readonly TStatus[];
  /** Estado inicial al crear la entidad. */
  readonly initial: TStatus;
}

/** Construye una máquina de estados inmutable a partir de sus transiciones. */
export function defineStateMachine<TStatus extends string>(
  definition: StateMachine<TStatus>,
): StateMachine<TStatus> {
  return Object.freeze({
    ...definition,
    transitions: Object.freeze(definition.transitions.map((transition) => Object.freeze(transition))),
    forbidden: Object.freeze(definition.forbidden.map((entry) => Object.freeze(entry))),
    terminal: Object.freeze(definition.terminal),
  });
}

/** `true` si el par `(from, to)` aparece en la tabla de transiciones. */
export function isValidTransition<TStatus extends string>(
  machine: StateMachine<TStatus>,
  from: TStatus,
  to: TStatus,
): boolean {
  return machine.transitions.some((transition) => transition.from === from && transition.to === to);
}

/** `true` si `from` no tiene ninguna transición de salida. */
export function isTerminalStatus<TStatus extends string>(
  machine: StateMachine<TStatus>,
  status: TStatus,
): boolean {
  return machine.terminal.includes(status);
}

/** Motivo documentado de una transición prohibida, si la tabla lo recoge. */
export function forbiddenReason<TStatus extends string>(
  machine: StateMachine<TStatus>,
  from: TStatus,
  to: TStatus,
): string | null {
  return machine.forbidden.find((entry) => entry.from === from && entry.to === to)?.reason ?? null;
}
