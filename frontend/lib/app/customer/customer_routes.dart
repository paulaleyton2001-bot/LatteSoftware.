// Rutas de las pantallas del cliente. Módulo `app/customer`.
//
// Van en su propio archivo porque `router.dart` debe poder LEERSE de un vistazo: su
// trabajo es composing (guard de sesión, shell, redirección) y el árbol de rutas del
// cliente son 14 pantallas. Mezclarlos daba un archivo de 320 líneas donde lo
// importante —el guard— se perdía entre `GoRoute`s.
//
// LAS SUBRUTAS DEL PERFIL VAN DENTRO DE LA RAMA
// `/perfil/editar` y compañía son `routes:` de `/perfil`, no rutas hermanas. Así la
// pestaña «Perfil» sigue marcada en la barra y `currentLocation` del shell (que es
// la ruta de PRIMER nivel) no cambia al navegar dentro del perfil.


import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/cart/presentation/cart_page.dart';
import '../../features/chair/presentation/chair_tab_page.dart';
import '../../features/checkout/presentation/checkout_done_page.dart';
import '../../features/checkout/presentation/checkout_page.dart';
import '../../features/home/presentation/home_page.dart';
import '../../features/menu/presentation/menu_page.dart';
import '../../features/orders/presentation/order_detail_page.dart';
import '../../features/orders/presentation/orders_page.dart';
import '../../features/product_detail/presentation/product_detail_page.dart';
import '../../features/profile/presentation/change_password_page.dart';
import '../../features/profile/presentation/edit_profile_page.dart';
import '../../features/profile/presentation/notification_prefs_page.dart';
import '../../features/profile/presentation/payments_history_page.dart';
import '../../features/profile/presentation/profile_page.dart';
import '../../features/profile/presentation/reservations_page.dart';
import '../../features/profile/presentation/sessions_page.dart';
import '../routes.dart';
import './customer_shell.dart';

/// Rutas del cliente: el shell de las 5 pestañas y las pantallas de segundo nivel.
List<RouteBase> customerRoutes() => <RouteBase>[
      // ------------------------------------------- Confirmación del checkout
      // Ruta propia (y no un `extra` del checkout) para que sobreviva a un refresco
      // del navegador: recargar no puede dejar a nadie con una pantalla en blanco.
      GoRoute(
        path: AppRoutes.checkoutDone,
        name: RouteNames.checkoutDone,
        builder: (BuildContext context, GoRouterState state) =>
            const CheckoutDonePage(),
      ),

      // ------------------------------------------- Shell de las 5 pestañas
      StatefulShellRoute.indexedStack(
        builder: (BuildContext context, GoRouterState state,
            StatefulNavigationShell navigationShell) =>
            CustomerShell(navigationShell: navigationShell),
        branches: <StatefulShellBranch>[
          StatefulShellBranch(routes: <RouteBase>[
            GoRoute(
              path: AppRoutes.home,
              name: RouteNames.home,
              builder: (BuildContext context, GoRouterState state) =>
                  const HomePage(),
            ),
          ]),
          StatefulShellBranch(routes: <RouteBase>[
            GoRoute(
              path: AppRoutes.menu,
              name: RouteNames.menu,
              builder: (BuildContext context, GoRouterState state) =>
                  const MenuPage(),
            ),
          ]),
          StatefulShellBranch(routes: <RouteBase>[
            GoRoute(
              path: AppRoutes.orders,
              name: RouteNames.orders,
              builder: (BuildContext context, GoRouterState state) =>
                  const OrdersPage(),
            ),
          ]),
          StatefulShellBranch(routes: <RouteBase>[
            GoRoute(
              path: AppRoutes.chairs,
              name: RouteNames.chairs,
              builder: (BuildContext context, GoRouterState state) =>
                  const ChairTabPage(),
            ),
          ]),
          StatefulShellBranch(routes: <RouteBase>[
            GoRoute(
              path: AppRoutes.profile,
              name: RouteNames.profile,
              builder: (BuildContext context, GoRouterState state) =>
                  const ProfilePage(),
              routes: <RouteBase>[
                // Subrutas DEL PERFIL: al vivir dentro de la rama, la pestaña
                // «Perfil» sigue marcada en la barra y el `currentLocation` del
                // shell (`/perfil`) no cambia al navegar a `/perfil/editar`.
                GoRoute(
                  path: 'editar',
                  name: RouteNames.profileEdit,
                  builder: (BuildContext context, GoRouterState state) =>
                      const EditProfilePage(),
                ),
                GoRoute(
                  path: 'contrasena',
                  name: RouteNames.profilePassword,
                  builder: (BuildContext context, GoRouterState state) =>
                      const ChangePasswordPage(),
                ),
                GoRoute(
                  path: 'sesiones',
                  name: RouteNames.profileSessions,
                  builder: (BuildContext context, GoRouterState state) =>
                      const SessionsPage(),
                ),
                GoRoute(
                  path: 'notificaciones',
                  name: RouteNames.profileNotifications,
                  builder: (BuildContext context, GoRouterState state) =>
                      const NotificationPrefsPage(),
                ),
                GoRoute(
                  path: 'pagos',
                  name: RouteNames.profilePayments,
                  builder: (BuildContext context, GoRouterState state) =>
                      const PaymentsHistoryPage(),
                ),
              ],
            ),
          ]),
        ],
      ),

      // -------------------------------- Pantallas de segundo nivel (full screen)
      GoRoute(
        path: AppRoutes.product,
        name: RouteNames.product,
        builder: (BuildContext context, GoRouterState state) =>
            ProductDetailPage(productId: intParam(state, 'productId')),
      ),
      GoRoute(
        path: AppRoutes.cart,
        name: RouteNames.cart,
        builder: (BuildContext context, GoRouterState state) => const CartPage(),
      ),
      GoRoute(
        path: AppRoutes.checkout,
        name: RouteNames.checkout,
        builder: (BuildContext context, GoRouterState state) => const CheckoutPage(),
      ),
      GoRoute(
        path: AppRoutes.orderDetail,
        name: RouteNames.orderDetail,
        builder: (BuildContext context, GoRouterState state) =>
            OrderDetailPage(orderId: intParam(state, 'orderId')),
      ),
      GoRoute(
        path: AppRoutes.reservations,
        name: RouteNames.reservations,
        builder: (BuildContext context, GoRouterState state) =>
            const MyReservationsPage(),
      ),
    ];

/// Lee un parámetro de ruta numérico.
///
/// `API.md` §1: los ids son `integer`, nunca string. Un id no convertible no se puede
/// ignorar en silencio (llamaría a `GET /orders/abc` y devolvería un `404`
/// confuso), así que se devuelve `0`, que no existe en la base de datos: es un fallo
/// honesto del servidor en vez de una pantalla que inventa datos.
int intParam(GoRouterState state, String name) =>
    int.tryParse(state.pathParameters[name] ?? '') ?? 0;
