/**
 * 404 para rutas no registradas.
 *
 * Se monta justo ANTES de `errorHandler` y siempre después de los routers de
 * la API. Emite el mismo envoltorio de error que el resto del sistema
 * (API.md 3.2) y nunca HTML.
 */
import type { RequestHandler } from 'express';

import { NotFoundError } from '../errors/index.js';

export const notFound: RequestHandler = (req, _res, next) => {
  next(
    new NotFoundError('El endpoint solicitado no existe', {
      // `type` permite al cliente distinguir "ruta inexistente" de "recurso
      // inexistente" sin parsear el mensaje.
      details: { method: req.method, path: req.path, type: 'route' },
    }),
  );
};
