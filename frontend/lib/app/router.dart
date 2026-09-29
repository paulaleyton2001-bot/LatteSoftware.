// Árbol de rutas (go_router 14) con guard de sesión y shell indexado.
//
// ESTRUCTURA
// ---------
//   /            → redirige a /home o /login según haya sesión
//   /login, /register, /forgot-password, /reset-password   (auth, reales)
//   /checkout/confirmado                                     (confirmación)
//   StatefulShellRoute.indexedStack                         (5 pestañas)
//     ├── /home        HomePage
//     ├── /menu        MenuPage
//     ├── /pedidos     OrdersPage
//     ├── /silla       ChairTabPage
//     └── /perfil      ProfilePage  (+ subrutas de cuenta)
//   Pantallas de segundo nivel, FUERA del shell (a pantalla completa)
//     /producto/:productId · /carrito · /checkout · /pedido/:orderId
//     /silla/:chairId · /reservas
//   Personal (`app/admin/admin_routes.dart`)
//     /pos · /pos/pedidos
//     /admin/{resumen,ordenes,sillas,reservas,inventario,productos,pagos,
//             clientes,reportes,descuentos,usuarios,configuracion}
//     /admin/ordenes/:orderId · /admin/clientes/:customerId
//
// POR QUÉ `StatefulShellRoute.indexedStack` Y NO RUTAS HERMANAS
// Con rutas hermanas, `context.go('/menu')` RECONSTRUYE la pantalla: se pierde el
// scroll, el texto del buscador y el filtro por categoría. Con un shell indexado
// cada rama tiene su propio `Navigator`, así que volver a una pestaña la deja
// exactamente como estaba. Es lo que espera alguien que abre «Pedidos», mira uno y
// vuelve a «Menú» a seguir mirando la carta.
//
// POR QUÉ LAS PANTALLAS DE SEGUNDO NIVEL QUEDAN FUERA DEL SHELL
// Un producto, el carrito y el checkout son tareas concentradas. En móvil
// significa una página completa sin barra de pestañas (que competiría por el
// pulgar), y la navegación va con `push` para que el botón «atrás» funcione como
// la gente espera (docs/DESIGN-TOKENS §5).
//
// GUARD DE SESIÓN
//   - Sin sesión y ruta protegida → `/login?redirect=<destino>`.
//   - Con sesión y ruta de auth    → `/home`.
//   - Sesión sin resolver          → `null`: se deja montar la pantalla, que
//     muestra su propio estado de carga con `AsyncStateBuilder`.
//
// GUARD DE ROL (POS Y ADMIN)
//   - `/pos` exige `canUsePos`: `isStaff` o el permiso `orders:create`.
//   - `/admin*` exige `canUseAdmin`: `isStaff` Y `users:read`.
//   - Un CUSTOMER que entre es REDIRIGIDO a `/home` con un mensaje claro, no a una
//     pantalla de "403": su objetivo es la app, no el panel.
//
// PERMISOS, NO MATRICES DE ROL
// `GET /auth/me` devuelve `permissions[]` (BR-RBAC-005) y cada destino comprueba la
// clave que necesita. Duplicar la matriz rol × permiso en el router es justo lo que
// la norma prohíbe. El guard compara contra `canUsePos` / `canUseAdmin`
// (`app/admin/admin_navigation.dart`), que son predicados de DOS señales del
// backend, no una copia de los roles.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../domain/entities/user.dart';
import '../features/auth/presentation/auth_controller.dart';
import '../features/auth/presentation/auth_state.dart';
import '../features/auth/presentation/forgot_password_page.dart';
import '../features/auth/presentation/login_page.dart';
import '../features/auth/presentation/register_page.dart';
import '../features/auth/presentation/reset_password_page.dart';
import '../shared/constants/app_strings.dart';
import './admin/admin_navigation.dart';
import './admin/admin_routes.dart';
import './customer/customer_routes.dart';
import './router_refresh.dart';
import './routes.dart';

export 'routes.dart';

/// Notificador que empuja los cambios de sesión a `go_router`.
final Provider<RouterRefreshNotifier> routerRefreshProvider =
    Provider<RouterRefreshNotifier>(
  (Ref ref) {
    final RouterRefreshNotifier notifier = RouterRefreshNotifier();
    ref.onDispose(notifier.dispose);
    // `listen` y NO `watch`: observar el estado aquí RECREARÍA el router en
    // cada login/logout y perdería el historial de navegación.
    ref.listen<AuthState>(
      authControllerProvider,
      (AuthState? previous, AuthState next) => notifier.refresh(),
    );
    return notifier;
  },
  name: 'routerRefresh',
);

/// Router de la app. Se crea una vez y solo reacciona a la sesión.
final Provider<GoRouter> routerProvider = Provider<GoRouter>(
  (Ref ref) => GoRouter(
    initialLocation: AppRoutes.root,
    refreshListenable: ref.watch(routerRefreshProvider),
    routes: <RouteBase>[
      // --------------------------------------------------------- Auth (público)
      _authRoute(AppRoutes.login, RouteNames.login, const LoginPage()),
      _authRoute(
        AppRoutes.register,
        RouteNames.register,
        const RegisterPage(),
      ),
      _authRoute(
        AppRoutes.forgotPassword,
        RouteNames.forgotPassword,
        const ForgotPasswordPage(),
      ),
      _authRoute(
        AppRoutes.resetPassword,
        RouteNames.resetPassword,
        const ResetPasswordPage(),
      ),

      // -------------------------------------------- Rutas del cliente (shell)
      ...customerRoutes(),

      // ------------------------- Personal: mostrador y panel de administración
      ...staffRoutes(),
    ],
    redirect: (BuildContext context, GoRouterState state) =>
        _redirect(ref, state),
    errorBuilder: (BuildContext context, GoRouterState state) => Scaffold(
      appBar: AppBar(title: const Text('Ruta no encontrada')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            'La dirección ${state.uri} no existe en la app.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
      ),
    ),
  ),
  name: 'router',
);

/// Redirección de sesión Y de rol. Función PURA de (destino, estado): así la
/// reevaluación de `go_router` converge y no entra en ciclo.
///
/// El orden importa y es deliberado:
///   1. Arrancando (`AuthStateUnknown`) → `null`. Se deja montar la pantalla, que
///      muestra su propio estado de carga. Decidir antes sería expulsar a un
///      empleado whose token aún no se ha validado.
///   2. Sin sesión → login con `?redirect=` para volver a donde quería ir.
///   3. Con sesión en una ruta de auth → `/home`.
///   4. Con sesión en `/pos` o `/admin` sin permiso → `/home` con aviso.
String? _redirect(Ref ref, GoRouterState state) {
  final AuthState auth = ref.read(authControllerProvider);
  final String location = state.matchedLocation;
  final bool isPublic = AppRoutes.publicPaths.contains(location);

  // 1. Arrancando: aún no se decide. La pantalla muestra su propio estado.
  if (auth is AuthStateUnknown) return null;

  if (!auth.isAuthenticated) {
    if (isPublic) return null;
    return _loginWithRedirect(state.uri);
  }

  // 2. Con sesión, las pantallas de auth sobran: el destino es la app.
  if (isPublic) return AppRoutes.home;
  if (location == AppRoutes.root) return AppRoutes.home;

  // 3. Guard de rol. Solo con sesión resuelta, y solo sobre rutas de personal.
  final User? user = auth.user;
  if (AppRoutes.isPosLocation(location) && !canUsePos(user)) {
    return _denied(AppStrings.navDashboard);
  }
  if (AppRoutes.isAdminLocation(location) && !canUseAdmin(user)) {
    return _denied(AppStrings.adminAreaTitle);
  }
  return null;
}

/// Redirige a `/home` avisando de que la zona es de personal.
///
/// Se usa un QUERY PARAM y no un diálogo: un `showDialog` desde un `redirect` de
/// `go_router` es una transición dentro de una transición y se pierde en cuanto
/// cambia la ruta. El mensaje se lee una vez, en la home, y desaparece solo.
String _denied(String area) => Uri(
      path: AppRoutes.home,
      queryParameters: <String, String>{'aviso': area},
    ).toString();

/// `/login?redirect=<destino>` para volver a donde el usuario quería ir.
///
/// Se usa el `uri` completo (no `path`) para no perder el query de la ruta
/// original. En la raíz no hay nada a lo que volver, así que se manda a `/login` a
/// secas y se evita un `?redirect=/` que no aporta nada.
String _loginWithRedirect(Uri uri) {
  if (uri.path == AppRoutes.root) return AppRoutes.login;
  return Uri(
    path: AppRoutes.login,
    queryParameters: <String, String>{AppRoutes.redirectParam: uri.toString()},
  ).toString();
}

/// Ruta de autenticación. No lleva guard propio: el guard de sesión vive en el
/// `redirect` de nivel raíz, y aquí solo se declara el `builder`.
GoRoute _authRoute(String path, String name, Widget page) => GoRoute(
      path: path,
      name: name,
      builder: (BuildContext context, GoRouterState state) => page,
    );
