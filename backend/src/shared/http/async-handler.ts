/**
 * Wrapper para handlers asíncronos.
 *
 * Express 5 ya propaga los rechazos de promesa a la cadena de errores, pero el
 * wrapper se mantiene por dos razones:
 *  1. Compatibilidad explícita y verificable: un handler `async` que lanza
 *     **siempre** llega a `errorHandler`, sin depender del runtime.
 *  2. Tipado exacto: la firma declara que el handler devuelve una promesa,
 *     lo que permite `strict` sin `any` en los controllers.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Petición con `body` ya validado por el middleware `validate`. */
export type ValidatedRequest<
  TParams = Record<string, string>,
  TBody = unknown,
  TQuery = Record<string, unknown>,
> = Request<TParams, unknown, TBody, TQuery>;

/** Handler asíncrono tipado. */
export type AsyncRequestHandler<
  TParams = Record<string, string>,
  TBody = unknown,
  TQuery = Record<string, unknown>,
> = (
  req: ValidatedRequest<TParams, TBody, TQuery>,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

/** Handler síncrono equivalente, por si un endpoint no devuelve promesa. */
export type SyncRequestHandler<
  TParams = Record<string, string>,
  TBody = unknown,
  TQuery = Record<string, unknown>,
> = (
  req: ValidatedRequest<TParams, TBody, TQuery>,
  res: Response,
  next: NextFunction,
) => unknown;

/**
 * Envuelve un handler asíncrono y encamina cualquier fallo a `next`.
 *
 * `Promise.resolve().then(...)` garantiza que un error lanzado de forma
 * síncrona dentro del handler también acaba en `next(error)` y no en una
 * excepción sin capturar.
 */
export function asyncHandler<
  TParams = Record<string, string>,
  TBody = unknown,
  TQuery = Record<string, unknown>,
>(
  handler: AsyncRequestHandler<TParams, TBody, TQuery>,
): RequestHandler<TParams, unknown, TBody, TQuery> {
  return (
    req: ValidatedRequest<TParams, TBody, TQuery>,
    res: Response,
    next: NextFunction,
  ): void => {
    // El `void` deja claro que no se espera el resultado: cualquier rechazo
    // viaja por `next(error)` y lo gestiona `errorHandler`.
    void Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
}
