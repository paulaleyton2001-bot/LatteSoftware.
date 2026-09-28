/**
 * Ensamblado de la aplicación Express.
 *
 * `createApp()` devuelve la app **sin** `listen`: así los tests pueden usar
 * `supertest` contra la app directamente y `server.ts` queda como el único
 * sitio que abre un puerto.
 *
 * ORDEN DEL STACK (importante, no reordenar sin pensarlo):
 *   1. `trust proxy`            -> `req.ip` real detrás del balanceador.
 *   2. helmet                   -> cabeceras de seguridad.
 *   3. cors                     -> lista blanca.
 *   4. requestContext           -> `requestId` (debe ir ANTES de pino-http).
 *   5. pino-http                -> log por petición, con `requestId` en cada línea.
 *   6. jsonBody                 -> cuerpo JSON, 1 MB.
 *   7. logRequestCompletion     -> línea de acceso al terminar.
 *   8. globalRateLimit          -> 429 global.
 *   9. `/api/v1`                -> módulos (auth aplica su límite estricto).
 *  10. notFound                 -> 404 de rutas no registradas.
 *  11. errorHandler             -> SIEMPRE el último.
 */
import express, { type Express } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as pinoHttpModule from 'pino-http';
import type { HttpLogger, Options as PinoHttpOptions } from 'pino-http';

import { API_PREFIX, env } from './config/index.js';
import { createApiV1Router } from './modules/index.js';
import { getRequestId } from './shared/http/response.js';
import { logger } from './shared/logger/index.js';
import {
  corsMiddleware,
  errorHandler,
  globalRateLimit,
  jsonBody,
  logRequestCompletion,
  notFound,
  requestContext,
  resolveRequestIdFromResponse,
  securityHeaders,
  setRateLimitingEnabled,
} from './shared/middleware/index.js';

/**
 * Fábrica de `pino-http`.
 *
 * `pino-http@11` es CommonJS y su `index.d.ts` declara `export default`, por lo
 * que con `moduleResolution: nodenext` TypeScript tipa el import por defecto
 * como el espacio de nombres del módulo y no como una función. El valor en
 * tiempo de ejecución SÍ es la función, de modo que se declara la firma aquí y
 * se enlaza con una única conversión explícita. Sin `any`.
 */
type PinoHttpFactory = <IM = IncomingMessage, SR = ServerResponse>(
  options?: PinoHttpOptions<IM, SR>,
) => HttpLogger<IM, SR>;

const pinoHttp = pinoHttpModule.default as unknown as PinoHttpFactory;

/** Opciones de `createApp`. */
export interface CreateAppOptions {
  /**
   * Saltarse TODOS los límites de tasa: el global, el estricto de `/auth/*` y el
   * reforzado de recuperación de contraseña. Sólo para tests, que disparan
   * peticiones en bucle y no quieren un 429 inesperado. El test que verifica el
   * rate limit lo deja activo a propósito.
   */
  readonly disableRateLimit?: boolean;
  /** Silenciar el log por petición. Sólo para tests. */
  readonly disableRequestLog?: boolean;
}

/**
 * Construye la aplicación Express lista para `listen` o para `supertest`.
 * No abre la base de datos: la conexión es perezosa, en el primer uso.
 */
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  // 0. Interruptor de los limitadores. Se fija ANTES de montarlos para que
  //    `disableRateLimit` también apague los que viven en las rutas de cada
  //    módulo, y no sólo el global de esta función.
  setRateLimitingEnabled(options.disableRateLimit !== true);

  // 1. Confiar en el proxy de un solo salto: sin esto, `req.ip` es la IP del
  //    balanceador y el rate limit por IP sería inútil.
  app.set('trust proxy', 1);
  // Sin esto, las rutas se normalizan con mayúsculas y el 404 falla.
  app.set('x-powered-by', false);
  app.set('case sensitive routing', true);
  app.set('strict routing', false);

  // 2-3. Seguridad.
  app.use(securityHeaders);
  app.use(corsMiddleware);

  // 4. Contexto de correlación antes del logger.
  app.use(requestContext);

  // 5. Log por petición. `genReqId` y `customProps` reutilizan el requestId
  //    del contexto, así cada línea queda correlacionada con la respuesta.
  if (options.disableRequestLog !== true) {
    app.use(
      pinoHttp({
        logger,
        genReqId: (req) => resolveRequestIdFromResponse(req),
        customProps: (req) => ({ requestId: resolveRequestIdFromResponse(req) }),
        autoLogging: { ignore: (req) => req.url === `${API_PREFIX}/health` },
        serializers: {
          req: (req) => ({ method: req.method, url: req.url }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  // 6. Cuerpo JSON con tope de 1 MB.
  app.use(jsonBody);

  // 7. Línea de acceso al terminar la respuesta.
  app.use(logRequestCompletion);

  // 8. Límite de tasa global.
  if (options.disableRateLimit !== true) {
    app.use(globalRateLimit);
  }

  // 9. Módulos de la API. `modules/index.ts` es el punto de extensión.
  app.use(API_PREFIX, createApiV1Router({ disableRateLimit: options.disableRateLimit }));

  // Raíz: indica dónde vive la API, sin revelar nada del sistema de ficheros.
  // Va ANTES del 404 para que sea alcanzable.
  app.get('/', (_req, res) => {
    res.status(200).json({
      success: true,
      data: {
        name: env.appName,
        version: env.appVersion,
        api: API_PREFIX,
        docs: 'docs/API.md',
      },
      meta: { requestId: getRequestId(res) },
    });
  });

  // 10-11. 404 y manejador de errores: SIEMPRE los dos últimos.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
