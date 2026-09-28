/**
 * Campos de entrada reutilizables (API.md 1, 11.6).
 *
 * Son los MISMOS esquemas para `auth`, `users` y `customers`: si el email se
 * normaliza en un sitio y no en otro, el `UNIQUE(email)` deja de ser la
 * garantía final contra duplicados por mayúsculas (BR-SEC-010).
 *
 * Todos rechazan campos desconocidos porque los objetos que los contienen son
 * `.strict()`; aquí sólo se define cada ATOMIZO.
 */
import { z } from 'zod';

import { IDENTITY, PASSWORD } from '../../config/index.js';

/**
 * Email: se normaliza a minúsculas y sin espacios ANTES de validarse.
 * La normalización es la primera defensa de BR-SEC-010; el `CHECK
 * ck_users_email_lowercase` y el `UNIQUE(email)` de la tabla son las restantes.
 */
export const emailField = z
  .string({ error: 'El correo es obligatorio' })
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: 'Debe ser un correo electrónico válido' }).max(IDENTITY.EMAIL_MAX_LENGTH));

/** Contraseña en crudo. La política la evalúa `password.service`. */
export const passwordField = z
  .string({ error: 'La contraseña es obligatoria' })
  .min(1, 'La contraseña es obligatoria')
  // 72 bytes es el límite de bcrypt: lo que pase se trunca en silencio, así que
  // se rechaza en el borde en lugar de aceptar una contraseña incompleta.
  .max(PASSWORD.MAX_LENGTH, `La contraseña no puede superar ${PASSWORD.MAX_LENGTH} caracteres`);

/** Contraseña de un endpoint que sólo comprueba longitud (login). */
export const loginPasswordField = z.string({ error: 'La contraseña es obligatoria' }).min(1);

/** Nombre completo: 2..120 caracteres (API.md 7.1, DESIGN.md 11.6). */
export const fullNameField = z
  .string({ error: 'El nombre es obligatorio' })
  .trim()
  .min(IDENTITY.FULL_NAME_MIN_LENGTH, 'El nombre debe tener al menos 2 caracteres')
  .max(IDENTITY.FULL_NAME_MAX_LENGTH, `El nombre no puede superar ${IDENTITY.FULL_NAME_MAX_LENGTH} caracteres`);

/** Teléfono E.164. `null` explícito borra el teléfono del perfil. */
export const phoneField = z
  .union([z.string().regex(IDENTITY.PHONE_PATTERN, 'El teléfono debe tener formato E.164, por ejemplo +573001234567'), z.null()])
  .optional();

/** URL de foto: sólo `http(s)`, longitud acotada (DESIGN.md 11.6). */
export const photoUrlField = z
  .union([
    z
      .url({ error: 'Debe ser una URL válida' })
      .max(IDENTITY.PHOTO_URL_MAX_LENGTH, 'La URL es demasiado larga')
      .refine(
        (value) => value.startsWith('http://') || value.startsWith('https://'),
        'La URL debe empezar por http:// o https://',
      ),
    z.null(),
  ])
  .optional();

/** Motivo de un cambio de estado (bloqueo, inactividad). */
export const reasonField = z
  .string()
  .trim()
  .min(1, 'El motivo es obligatorio')
  .max(IDENTITY.REASON_MAX_LENGTH, `El motivo no puede superar ${IDENTITY.REASON_MAX_LENGTH} caracteres`)
  .optional();

/** Texto de búsqueda `q` de los listados (API.md 5.3: 2..100 caracteres). */
export const searchQueryField = z
  .string()
  .trim()
  .min(IDENTITY.QUERY_MIN_LENGTH, 'La búsqueda debe tener al menos 2 caracteres')
  .max(IDENTITY.QUERY_MAX_LENGTH, `La búsqueda no puede superar ${IDENTITY.QUERY_MAX_LENGTH} caracteres`)
  .optional();

/** Id de ruta de recurso. Siempre entero positivo (API.md 1: nunca string). */
export const resourceIdField = z.coerce
  .number({ error: 'El identificador debe ser un número entero' })
  .int('El identificador debe ser un número entero')
  .positive('El identificador debe ser mayor que cero');

/** Escala los detalles de validación al formato del contrato (API.md 3.2). */
export const validationDetailOf = (issue: { path: PropertyKey[]; message: string }): string =>
  issue.path.length > 0 ? issue.path.join('.') : 'body';
