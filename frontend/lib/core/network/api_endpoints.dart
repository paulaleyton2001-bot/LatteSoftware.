// Rutas de la API REST v1. ÚNICO lugar donde viven los paths.
//
// El host NO está aquí: sale de `AppConfig.apiBaseUrl` (--dart-define). Estas
// constantes son relativas al `baseUrl` del `Dio`, tal como están escritas en
// `docs/API.md` §7 (la versión `v1` ya viaja en el baseUrl).
//
// Regla: ninguna feature escribe `'/auth/login'` a mano; usa `ApiEndpoints`.

/// Paths de `docs/API.md` §7, agrupados por recurso.
abstract final class ApiEndpoints {
  const ApiEndpoints._();

  // ----------------------------------------------------------------- System
  /// ÚNICO endpoint fuera de `/api/v1` (API.md §7).
  static const String health = '/health';
  static const String metaRoles = '/meta/roles';
  static const String metaEnums = '/meta/enums';

  // ------------------------------------------------------------------- Auth
  static const String authRegister = '/auth/register';
  static const String authLogin = '/auth/login';
  static const String authRefresh = '/auth/refresh';
  static const String authLogout = '/auth/logout';
  static const String authLogoutAll = '/auth/logout-all';
  static const String authForgotPassword = '/auth/forgot-password';
  static const String authResetPassword = '/auth/reset-password';
  static const String authChangePassword = '/auth/change-password';
  static const String authMe = '/auth/me';
  static const String authSessions = '/auth/sessions';

  /// `DELETE /auth/sessions/:id` — revoca una sesión concreta.
  static String authSessionById(int id) => '$authSessions/$id';

  // -------------------------------------------------------------- Catálogo
  /// Catálogo público: se consulta sin sesión para mostrar el menú como invitado.
  /// OJO: la API resuelve el producto por `id` (`GET /products/:id`), NO por
  /// `slug`. La ruta de cliente `/menu/:slug` tendrá que resolver el slug con
  /// `GET /products?q=` o con un endpoint de lookup cuando exista.
  static const String products = '/products';
  static const String categories = '/categories';

  // ------------------------------------------------------------------ Pagos
  /// `POST /payments` es el ÚNICO `POST` idempotente de la API: exige cabecera
  /// `Idempotency-Key` (API.md §1). La cola offline (`core/storage`) lo usa como
  /// identificador de operación.
  static const String payments = '/payments';

  // --------------------------------------------------------------- Whites
  /// Rutas públicas de `API.md` §2 más el catálogo. No llevan `Authorization` y
  /// nunca disparan un refresco: un `401` en estas rutas es un fallo real
  /// (credenciales incorrectas), no una sesión vencida.
  static const Set<String> publicPaths = <String>{
    authRegister,
    authLogin,
    authRefresh,
    authForgotPassword,
    authResetPassword,
    health,
    metaRoles,
    metaEnums,
    products,
    categories,
  };

  /// `true` si [path] no exige credenciales.
  ///
  /// Compara por coincidencia exacta o por prefijo de subrecurso: un recurso
  /// público sigue siendo público en sus hijos (`GET /products/12` no necesita
  /// token, `/products/12/variants` tampoco). El prefijo exige la barra, así
  /// que `/productos` no se cuela como público.
  static bool isPublicPath(String path) {
    final String clean = path.split('?').first;
    for (final String public in publicPaths) {
      if (clean == public || clean.startsWith('$public/')) return true;
    }
    return false;
  }
}
