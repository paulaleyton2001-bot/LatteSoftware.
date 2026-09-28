/**
 * Constantes globales del dominio.
 *
 * Valores derivados de `docs/DESIGN.md` y `docs/API.md`. No se permiten
 * números mágicos en el resto del código: todo número con significado de
 * negocio vive aquí y se referencia por nombre.
 */

/**
 * Identidad, autenticación y contraseñas (DESIGN.md 4.1 y sección 11).
 *
 * Aquí viven los números con significado de seguridad para que ningún service
 * los escriba a mano: son la referencia única para el hashing, la rotación de
 * tokens y la validación de entrada.
 */
export const AUTH = {
  /**
   * Identidad de negocio por defecto (DESIGN.md 4.2). En v1 hay un único
   * negocio por despliegue, sembrado con `id = 1`; el `businessId` de un token
   * sale SIEMPRE del token, y este valor sólo se usa cuando aún no hay actor
   * (por ejemplo, el registro de un cliente nuevo o un login fallido).
   */
  DEFAULT_BUSINESS_ID: 1,
  /** Bytes de entropía del refresh token opaco (DESIGN.md 11.2: 48). */
  REFRESH_TOKEN_BYTES: 48,
  /** Bytes de entropía del token de reseteo de contraseña (DESIGN.md 11.2: 32). */
  RESET_TOKEN_BYTES: 32,
  /** Longitudes admitidas del refresh token en `POST /auth/refresh` (API.md 7.1). */
  REFRESH_TOKEN_MIN_LENGTH: 32,
  REFRESH_TOKEN_MAX_LENGTH: 128,
  /** `typ` del access token y del refresh token (DESIGN.md 11.2). */
  TOKEN_TYPE: {
    ACCESS: 'access',
    REFRESH: 'refresh',
  } as const,
  /** `tokenType` que viaja en la respuesta de login/registro/refresh. */
  BEARER: 'Bearer',
} as const;

/**
 * Política de contraseñas (BR-SEC-001 y DESIGN.md 11.1).
 *
 * Mínimo 8 caracteres, máximo 72 (límite de bcrypt: más se trunca) y al menos
 * 3 de las 4 clases de caracteres. Se rechazan además las contraseñas triviales
 * más habituales: la longitud y las clases no sirven de nada si la contraseña es
 * `password123`.
 */
export const PASSWORD = {
  MIN_LENGTH: 8,
  /** bcrypt ignora lo que pase de 72 bytes: se rechaza en el esquema, no se trunca. */
  MAX_LENGTH: 72,
  /** Clases: mayúsculas, minúsculas, dígitos y símbolos. */
  TOTAL_CLASSES: 4,
  /** Clases mínimas exigidas (3 de 4). */
  REQUIRED_CLASSES: 3,
  /**
   * Contraseñas triviales rechazadas. Lista corta y conservadora: el objetivo es
   * bloquear las que AnyDesk/XLSX/Typer leen como contraseña de ejemplo, no
   * montar un diccionario de credenciales filtradas (DESIGN.md 11.1).
   */
  TRIVIAL_DENYLIST: Object.freeze([
    'password',
    'password1',
    'passw0rd',
    'contrasena',
    'contraseña',
    'qwerty',
    'qwerty123',
    '12345678',
    '123456789',
    '1234567890',
    'administrator',
    'administrador',
    'lattecoffe',
    'lattecoffe1',
    'admin1234',
    'iloveyou',
    'welcome1',
    'letmein1',
  ]),
} as const;

/** Límites de longitud de los campos de texto de identidad (DESIGN.md 11.6). */
export const IDENTITY = {
  EMAIL_MAX_LENGTH: 254,
  FULL_NAME_MIN_LENGTH: 2,
  FULL_NAME_MAX_LENGTH: 120,
  PHOTO_URL_MAX_LENGTH: 500,
  /** Motivo de bloqueo/alta: texto libre acotado. */
  REASON_MAX_LENGTH: 500,
  /** Teléfono en E.164: `+573001234567`. */
  PHONE_PATTERN: /^\+[1-9]\d{7,14}$/,
  /** Texto de búsqueda `q`: mínimo 2, máximo 100 (API.md 5.3). */
  QUERY_MIN_LENGTH: 2,
  QUERY_MAX_LENGTH: 100,
} as const;

/**
 * Auditoría (DESIGN.md 4.6 y BR-SEC-007).
 *
 * `before_data` y `after_data` se sanean ANTES de escribirse: cualquier clave
 * que parezca una credencial se sustituye por `[REDACTED]`. Así el audit log
 * nunca puede filtrar una contraseña ni un token, ni siquiera por error de un
 * service futuro que pase el objeto entero.
 */
export const AUDIT = {
  /** Profundidad máxima al sanear: evita ciclos y volcados gigantes. */
  MAX_SANITIZE_DEPTH: 6,
  /** Valor con el que se sustituye un campo sensible. */
  REDACTED: '[REDACTED]',
  /** Claves que NUNCA se escriben en `audit_logs`. */
  SENSITIVE_KEY_PATTERN:
    /(password|contrasen|token|secret|hash|authorization|cookie|cvv|cvc|card_?number|pan\b|pin\b|credential)/i,
} as const;

/** Paginación (API.md 5.1). */
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MIN_PAGE_SIZE: 1,
  MAX_PAGE_SIZE: 100,
  /** Tope de `page`. Más allá: 400 VALIDATION_ERROR. */
  MAX_PAGE: 10_000,
} as const;

/** Alquiler de espacios (DESIGN.md 7.4). */
export const RENTAL = {
  /** BR-RENTAL-001/002: mínimo facturable, aunque el cliente estuvo 4 minutos. */
  MIN_BILLED_MINUTES: 30,
  /** BR-RENTAL-007: duración inicial de un alquiler walk-in. */
  DEFAULT_WALK_IN_MINUTES: 60,
  /** Milisegundos en un minuto (facturación pro-rata). */
  MS_PER_MINUTE: 60_000,
  /** Denominador de basis points: 1 bp = 0.01 %. */
  BP_DENOMINATOR: 10_000,
} as const;

/** Reservas (DESIGN.md 4.3 y 7.5). */
export const RESERVATION = {
  /** Tope duro de duración; el tope real lo fija `businesses.max_reservation_minutes`. */
  MAX_DURATION_MINUTES: 1_440,
  /** BR-RES-004: margen de cortesía para el check-in de una reserva PENDING. */
  PENDING_GRACE_MINUTES: 30,
  /** BR-RES-011: avisos del scheduler. */
  UPCOMING_NOTIFICATION_MINUTES: 60,
  TIME_ENDING_NOTIFICATION_MINUTES: 10,
} as const;

/** Moneda y formato (API.md 6.1). */
export const MONEY = {
  /** Redondeo half-up sobre 10^-2 (BR-MONEY-002/011). */
  SCALE: 100,
  /** `priceExample` de `GET /meta/enums`. */
  DEFAULT_CURRENCY: 'COP',
  DEFAULT_CURRENCY_SYMBOL: '$',
  DEFAULT_LOCALE: 'es_CO',
  DEFAULT_TIMEZONE: 'America/Bogota',
} as const;

/** Límite de cuerpo JSON (peticiones de pago/catálogo con items). */
export const JSON_BODY_LIMIT = '1mb';

/** Longitud de `device_info` e `user_agent` guardados en base de datos. */
export const MAX_DEVICE_INFO_LENGTH = 255;

/** Cabecera de correlación (API.md 1). */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Rutas públicas por contrato (API.md 2). */
export const PUBLIC_PATHS = ['/api/v1/health', '/api/v1/meta/roles', '/api/v1/meta/enums'] as const;

/** Prefijo de los endpoints de autenticación bajo `/api/v1`. */
export const AUTH_PATH_PREFIX = '/api/v1/auth';

/**
 * Rutas con límite de tasa reforzado: recuperación de contraseña.
 *
 * Son las que permiten enumerar o molestar a una cuenta concreta, así que tienen
 * un límite propio, MUCHO más estricto que el de `/auth/*` y con ventana de una
 * hora en lugar de un minuto (DESIGN.md 11.3).
 */
export const PASSWORD_RESET_PATHS = Object.freeze([
  `${AUTH_PATH_PREFIX}/forgot-password`,
  `${AUTH_PATH_PREFIX}/reset-password`,
]);

/** Prefijo de versionado de la API. */
export const API_PREFIX = '/api/v1';
