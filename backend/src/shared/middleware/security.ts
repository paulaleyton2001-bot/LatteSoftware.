/**
 * Cabeceras de seguridad y cuerpo JSON.
 *
 *  - `helmet` activa por defecto CSP, HSTS, `X-Content-Type-Options`,
 *    `X-Frame-Options`, `Referrer-Policy`, etc. Se desactiva `contentSecurityPolicy`
 *    porque la API no sirve HTML: una CSP restrictiva sólorompería respuestas
 *    de error de proxies que renderean HTML.
 *  - `cors` con lista blanca estricta desde `CORS_ORIGINS`. Con `*` se
 *    permiten credenciales (sólo desarrollo) porque el contrato con cookies de
 *    sesión lo exige; con lista explícita, sólo esos orígenes.
 *  - `express.json({ limit: '1mb' })` con verificación estricta del
 *    `Content-Type`: un body que no sea JSON no se intenta parsear.
 */
import cors from 'cors';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';

import { env, JSON_BODY_LIMIT } from '../../config/index.js';

/** Cabeceras de seguridad. */
export const securityHeaders: RequestHandler = helmet({
  // La API no sirve HTML: la CSP no aporta y puede romper respuestas de error
  // generadas por el proxy inverso.
  contentSecurityPolicy: false,
  // El body y los headers los fija Express, no helmet.
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
});

/** `true` si la configuración permite cualquier origen. */
function allowsAnyOrigin(): boolean {
  return env.corsOrigins.includes('*');
}

/**
 * CORS con lista blanca. `origin` se valida contra `CORS_ORIGINS` y una
 * petición con origen no permitido simplemente no recibe cabeceras CORS (el
 * navegador la bloquea); no se responde 403 para no filtrar la política.
 */
export const corsMiddleware: RequestHandler = cors({
  origin(origin, callback) {
    if (origin === undefined) {
      // Sin `Origin`: peticiones del mismo origen, curl, health checks.
      callback(null, true);
      return;
    }
    if (allowsAnyOrigin() || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key'],
  exposedHeaders: [
    'X-Request-Id',
    'Retry-After',
    'RateLimit-Limit',
    'RateLimit-Remaining',
    'RateLimit-Reset',
  ],
  maxAge: 86_400,
});

/** Parseo del cuerpo JSON con tope de 1 MB. */
export const jsonBody: RequestHandler = express.json({
  limit: JSON_BODY_LIMIT,
  strict: true,
  type: ['application/json', 'application/*+json'],
});

