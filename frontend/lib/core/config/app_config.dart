// Configuración de la aplicación leída en tiempo de compilación.
//
// Uso:
//   flutter run --dart-define=API_BASE_URL=http://10.0.2.2:3000/api/v1
//   flutter build web --dart-define=API_BASE_URL=https://api.lattecoffee.co/api/v1
//
// Los valores por defecto apuntan a `localhost`, que NO es alcanzable desde un
// emulador Android; ahí se usa `10.0.2.2` (alias de host loopback).

/// Constantes de ejecución. Inmutable y `const` para poder usarse en cualquier
/// contexto (incluidos `const` widgets).
abstract final class AppConfig {
  const AppConfig._();

  /// Base URL de la API REST v1. Inyectada con `--dart-define`.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  /// `true` si se compiló sin `API_BASE_URL` (arranca contra el default local).
  static const bool isUsingDefaultApiUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  ).isEmpty;

  /// Versión del contrato de API que implementa este cliente.
  /// Debe coincidir con la del backend (`GET /meta/enums` la publica).
  static const String apiVersion = 'v1';

  /// Locale de formato. Contrato con el backend: es-CO, 24 h, COP sin decimales.
  static const String locale = 'es_CO';

  /// Zona horaria de presentación. El backend almacena UTC.
  static const String timezone = 'America/Bogota';

  // ---------------------------------------------------------------- Tiempos
  /// Timeout de conexión (handshake) en segundos.
  static const int connectTimeoutSeconds = 10;

  /// Timeout de respuesta de la API en segundos.
  static const int receiveTimeoutSeconds = 20;

  /// Timeout de envío (subida de imágenes) en segundos.
  static const int sendTimeoutSeconds = 20;

  /// Duración del refresco de token antes de expirar (para refresco proactivo).
  ///
  /// `API.md` §2 exige renovar cuando al access token le queden menos de 60 s.
  /// Se renueva ANTES (margen de holgura) para que una petición que sale justo
  /// en la frontera no viaje ya con un token vencido.
  static const Duration tokenRefreshLeeway = Duration(minutes: 2);

  /// Backoff base para reintentos exponenciales.
  static const Duration retryBaseDelay = Duration(milliseconds: 400);

  /// Máximo de reintentos automáticos ante errores transitorios (5xx, red).
  ///
  /// Solo se aplican a peticiones idempotentes (`GET`), nunca a `POST`: un
  /// reintento ciego de `POST /payments` puede cobrar dos veces.
  static const int maxRetries = 2;

  // ------------------------------------------------------------- Paginación
  /// `page` inicial: la API de `docs/API.md` es 1-indexada.
  static const int defaultPage = 1;

  /// `pageSize` por defecto.
  static const int defaultPageSize = 20;

  /// `pageSize` máximo aceptado por la API.
  static const int maxPageSize = 100;

  // ---------------------------------------------------------------- UX
  /// Objetivo táctil mínimo (WCAG 2.5.5).
  static const double minTapTarget = 44;

  /// Duración de las transiciones de página/animación.
  static const Duration animationDuration = Duration(milliseconds: 220);

  /// Curva estándar de movimiento en la app.
  static const Duration animationFast = Duration(milliseconds: 120);
}
