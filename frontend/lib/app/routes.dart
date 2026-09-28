// Constantes de navegación. Separate de `router.dart` para que las FEATURES
// puedan leerlas sin importar el router (y así el router pueda importar las
// features sin ciclo de imports).
//
// `router.dart` reexporta este archivo: el código viejo que importa
// `app/router.dart` sigue viendo `AppRoutes` y `RouteNames`.

/// Rutas de la app, tal como aparecen en la barra de direcciones.
abstract final class AppRoutes {
  const AppRoutes._();

  /// Raíz. No es una pantalla: solo redirige a `/home` o `/login`.
  static const String root = '/';

  /// Destino tras iniciar sesión. Placeholder de la feature "inicio".
  static const String home = '/home';

  // ------------------------------------------------------------------- Auth
  static const String login = '/login';
  static const String register = '/register';
  static const String forgotPassword = '/forgot-password';
  static const String resetPassword = '/reset-password';

  // ------------------------------------------------- Features de otras fases
  // Rutas ya declaradas en la fase 1. Cada una conserva su nombre original
  // para no romper el trabajo en curso; se implementan feature por feature.
  static const String menu = '/menu';
  static const String product = '/menu/:slug';
  static const String cart = '/carrito';
  static const String checkout = '/checkout';
  static const String orders = '/pedidos';
  static const String orderDetail = '/pedidos/:numero';
  static const String chairs = '/silla';
  static const String chairDetail = '/silla/:id';
  static const String reservations = '/reservas';
  static const String profile = '/perfil';
  static const String pos = '/pos';
  static const String admin = '/admin';

  /// Rutas accesibles sin sesión. Todo lo demás exige autenticación.
  static const Set<String> publicPaths = <String>{
    login,
    register,
    forgotPassword,
    resetPassword,
  };

  /// Query param que guarda a dónde quería ir el usuario antes del login, para
  /// devolverlo allí al terminar (`?redirect=/menu`).
  static const String redirectParam = 'redirect';
}

/// Nombres de ruta para `context.goNamed` / `context.pushNamed`.
abstract final class RouteNames {
  const RouteNames._();

  static const String home = 'home';
  static const String login = 'login';
  static const String register = 'register';
  static const String forgotPassword = 'forgotPassword';
  static const String resetPassword = 'resetPassword';
  static const String menu = 'menu';
  static const String product = 'product';
  static const String cart = 'cart';
  static const String checkout = 'checkout';
  static const String orders = 'orders';
  static const String orderDetail = 'orderDetail';
  static const String chairs = 'chairs';
  static const String chairDetail = 'chairDetail';
  static const String reservations = 'reservations';
  static const String profile = 'profile';
  static const String pos = 'pos';
  static const String admin = 'admin';
}
