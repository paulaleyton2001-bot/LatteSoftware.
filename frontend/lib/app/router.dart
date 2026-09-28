// Árbol de rutas (go_router 14) con guard de sesión.
//
// FASES
// Esta fase implementa el árbol REAL de autenticación (`/login`, `/register`,
// `/forgot-password`, `/reset-password`) y deja el resto como placeholders
// MEJORADOS: cada uno declara su feature y los roles que podrán entrar
// (`app/placeholder_routes.dart`). Las features entran reemplazando solo el
// `builder` de su ruta; ni el `redirect` ni los nombres cambian.
//
// GUARD DE SESIÓN
//   - Sin sesión y ruta protegida → `/login?redirect=<destino>`.
//   - Con sesión y ruta de auth    → `/home`.
//   - `/`                          → `/home` o `/login`, según haya sesión.
//   - Sesión sin resolver          → `null`: se deja montar la pantalla, que
//     muestra su propio estado de carga con `AsyncStateBuilder`.
//
// El permiso por rol (BR-RBAC-005, sobre `permissions` de `GET /auth/me`) llega
// con cada feature. Aplicarlo aquí duplicaría la matriz en el cliente, que es
// justo lo que la norma prohíbe.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/presentation/auth_controller.dart';
import '../features/auth/presentation/auth_state.dart';
import '../features/auth/presentation/forgot_password_page.dart';
import '../features/auth/presentation/login_page.dart';
import '../features/auth/presentation/register_page.dart';
import '../features/auth/presentation/reset_password_page.dart';
import 'placeholder_routes.dart';
import 'placeholder_screen.dart';
import 'router_refresh.dart';
import 'routes.dart';

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
      // Raíz: sin sesión propia, la decide el `redirect` (`/home` o `/login`).
      GoRoute(
        path: AppRoutes.root,
        builder: (BuildContext context, GoRouterState state) =>
            const PlaceholderScreen(
          title: 'Inicio',
          feature: 'features/home',
          allowedRoles: 'Todos los autenticados',
        ),
      ),
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
      ...placeholderRoutes(),
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

/// Redirección de sesión. Función PURA de (destino, estado): así la
/// reevaluación de `go_router` converge y no entra en ciclo.
String? _redirect(Ref ref, GoRouterState state) {
  final AuthState auth = ref.read(authControllerProvider);
  final String location = state.matchedLocation;
  final bool isPublic = AppRoutes.publicPaths.contains(location);

  // Arrancando: aún no se decide. La pantalla muestra su propio estado de carga.
  if (auth is AuthStateUnknown) return null;

  if (!auth.isAuthenticated) {
    if (isPublic) return null;
    return _loginWithRedirect(state.uri);
  }

  // Con sesión, las pantallas de auth sobran: el destino es la app.
  if (isPublic) return AppRoutes.home;
  if (location == AppRoutes.root) return AppRoutes.home;
  return null;
}

/// `/login?redirect=<destino>` para volver a donde el usuario quería ir.
///
/// Se usa el `uri` completo (no `path`) para no perder el query de la ruta
/// original. En la raíz no hay nada a lo que volver, así que se manda a
/// `/login` a secas y se evita un `?redirect=/` que no aporta nada.
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
