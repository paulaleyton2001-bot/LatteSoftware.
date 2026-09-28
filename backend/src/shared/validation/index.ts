/**
 * Esquemas de validación compartidos entre módulos.
 *
 * La normalización de `email`, los límites de longitud de los textos y el
 * formato E.164 del teléfono se definieron UNA vez en `docs/API.md` y
 * `docs/DESIGN.md` 11.6: duplicarlos en cada endpoint es la forma más rápida de
 * que el backend y el frontend se desincronicen.
 */
export {
  emailField,
  fullNameField,
  loginPasswordField,
  passwordField,
  phoneField,
  photoUrlField,
  reasonField,
  resourceIdField,
  searchQueryField,
} from './fields.js';
