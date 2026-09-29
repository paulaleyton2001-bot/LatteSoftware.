// Rutas del mostrador y del panel. MÓDULO `app/admin`.
//
// VAN EN SU PROPIO ARCHIVO POR LA MISMA RAZÓN QUE LAS DEL CLIENTE
// `app/router.dart` debe poder LEERSE de un vistazo: su trabajo es composing
// (guard de sesión, redirección, shell). Un solo archivo con 25 pantallas deja de
// ser legible y el guard — que es lo importante — se pierde en medio de `GoRoute`s.
//
// EL GUARD DE ROL NO ESTÁ AQUÍ
// Está en el `redirect` raíz de `router.dart` y es una FUNCIÓN PURA de
// (destino, estado). Si estuviera por ruta, un `StatefulShellRoute` se saltaría el
// `redirect` de sus subrutas, y `/admin/usuarios` quedaría accesible sin permiso.
//
// PERMISOS, NO ROLES
// Cada subpantalla comprueba el permiso que necesita contra
// `user.permissions` (la unión completa de `GET /auth/me`, BR-RBAC-005). La app NO
// mantiene una matriz rol × permiso: duplicarla es lo que la norma prohíbe y se
// quedaría vieja en cuanto el backend añadiera un rol.

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../features/admin/presentation/admin_chairs_page.dart';
import '../../features/admin/presentation/admin_customer_detail_page.dart';
import '../../features/admin/presentation/admin_customers_page.dart';
import '../../features/admin/presentation/admin_dashboard_page.dart';
import '../../features/admin/presentation/admin_discounts_page.dart';
import '../../features/admin/presentation/admin_inventory_page.dart';
import '../../features/admin/presentation/admin_order_detail_page.dart';
import '../../features/admin/presentation/admin_orders_page.dart';
import '../../features/admin/presentation/admin_payments_page.dart';
import '../../features/admin/presentation/admin_products_page.dart';
import '../../features/admin/presentation/admin_reports_page.dart';
import '../../features/admin/presentation/admin_reservations_page.dart';
import '../../features/admin/presentation/admin_settings_page.dart';
import '../../features/admin/presentation/admin_users_page.dart';
import '../../features/pos/presentation/pos_orders_board_page.dart';
import '../../features/pos/presentation/pos_page.dart';
import '../routes.dart';
import './admin_shell.dart';

/// Rutas del mostrador y del panel.
List<RouteBase> staffRoutes() => <RouteBase>[
      // ------------------------------------------------------------------ POS
      // `/pos` y `/pos/pedidos` están FUERA del shell del admin: el POS tiene su
      // propio layout de columnas (`PosLayout`) y el tablero Kanban necesita scroll
      // horizontal, que el shell de tabla no daría.
      GoRoute(
        path: AppRoutes.pos,
        name: RouteNames.pos,
        builder: (BuildContext context, GoRouterState state) => const PosPage(),
      ),
      GoRoute(
        path: AppRoutes.posOrdersBoard,
        name: RouteNames.posOrdersBoard,
        builder: (BuildContext context, GoRouterState state) =>
            const PosOrdersBoardPage(),
      ),

      // ---------------------------------------- Detalles fuera del shell (push)
      // El detalle de un pedido y el de un cliente son de SEGUNDO NIVEL: se abren
      // con `push` para que el botón «atrás» vuelva a la lista con su scroll y su
      // filtro intactos. `Navigator.push` con `MaterialPageRoute` lo hace desde
      // `openAdminOrderDetail` / `openAdminCustomerDetail`, y estas rutas existen
      // para que la URL directa también funcione.
      GoRoute(
        path: AppRoutes.adminOrderDetail,
        name: RouteNames.adminOrderDetail,
        builder: (BuildContext context, GoRouterState state) =>
            AdminOrderDetailPage(orderId: intParam(state, 'orderId')),
      ),
      GoRoute(
        path: AppRoutes.adminCustomerDetail,
        name: RouteNames.adminCustomerDetail,
        builder: (BuildContext context, GoRouterState state) =>
            AdminCustomerDetailPage(customerId: intParam(state, 'customerId')),
      ),

      // ------------------------------------------------- Shell del panel (12)
      // `StatefulShellRoute.indexedStack`: volver a «Órdenes» tras mirar un
      // detalle conserva la página, el scroll y el filtro. Sin índice, cada `go`
      // reconstruye la pantalla y el filtro se pierde.
      StatefulShellRoute.indexedStack(
        builder: (BuildContext context, GoRouterState state,
            StatefulNavigationShell navigationShell) =>
            AdminShell(navigationShell: navigationShell),
        branches: <StatefulShellBranch>[
          for (final _AdminBranch branch in _adminBranches)
            StatefulShellBranch(routes: <RouteBase>[branch.route]),
        ],
      ),
    ];

/// Una rama del shell del panel: su ruta y su nombre.
class _AdminBranch {
  const _AdminBranch(this.path, this.name, this.page);

  final String path;
  final String name;
  final Widget page;

  GoRoute get route => GoRoute(
        path: path,
        name: name,
        builder: (BuildContext context, GoRouterState state) => page,
      );
}

/// Las doce ramas, EN EL ORDEN DE LA NAVEGACIÓN.
///
/// El orden importa: `StatefulShellRoute.indexedStack` toma la PRIMERA rama como
/// destino inicial, y entrar al panel tiene que llevar al resumen. Además, en
/// móvil la barra inferior muestra las ramas que caben; como el panel se usa en
/// escritorio, el orden determina el orden de la sidebar.
final List<_AdminBranch> _adminBranches = <_AdminBranch>[
  const _AdminBranch(
    AppRoutes.adminDashboard,
    RouteNames.adminDashboard,
    AdminDashboardPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminOrders,
    RouteNames.adminOrders,
    AdminOrdersPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminChairs,
    RouteNames.adminChairs,
    AdminChairsPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminReservations,
    RouteNames.adminReservations,
    AdminReservationsPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminInventory,
    RouteNames.adminInventory,
    AdminInventoryPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminProducts,
    RouteNames.adminProducts,
    AdminProductsPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminPayments,
    RouteNames.adminPayments,
    AdminPaymentsPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminCustomers,
    RouteNames.adminCustomers,
    AdminCustomersPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminReports,
    RouteNames.adminReports,
    AdminReportsPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminDiscounts,
    RouteNames.adminDiscounts,
    AdminDiscountsPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminUsers,
    RouteNames.adminUsers,
    AdminUsersPage(),
  ),
  const _AdminBranch(
    AppRoutes.adminSettings,
    RouteNames.adminSettings,
    AdminSettingsPage(),
  ),
];

/// Lee un parámetro de ruta numérico.
///
/// `API.md` §1: los ids son `integer`, nunca string. Un id no convertible se
/// devuelve `0`: llama a `GET /orders/abc` y el backend responde `404` con un
/// mensaje que sí explica el problema, en vez de una pantalla que inventa datos.
int intParam(GoRouterState state, String name) =>
    int.tryParse(state.pathParameters[name] ?? '') ?? 0;
