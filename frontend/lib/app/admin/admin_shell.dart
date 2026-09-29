// Shell del panel de administración. MÓDULO `app/admin`.
//
// REUTILIZA EL SHELL ADAPTATIVO QUE YA EXISTE
// `AdaptiveScaffold` + `AppSidebar` (desktop/wide), `AppNavigationRail` (tablet) y
// `AppNavigationBar` (móvil) ya resuelven el chrome de navegación del proyecto. El
// panel no necesita el suyo: necesita la MISMA navegación con OTRA lista de
// destinos. Escribir un segundo shell habría producido dos versiones de lo mismo
// que se separan en cuanto una cambia.
//
// UN SHELL INDEXADO COMO EL DEL CLIENTE
// `StatefulShellRoute.indexedStack`: volver a "Órdenes" después de mirar un detalle
// conserva la página, el scroll y el filtro. Sin índice, cada `go` reconstruye la
// pantalla y el filtro se pierde.
//
// EL POS NO ES UN DESTINO MÁS
// Vive en `/pos`, fuera del shell, y se entra desde el perfil del cliente y desde
// el propio panel (botón del pie). Es una herramienta de trabajo distinta con su
// propio layout de tres columnas, no una pestaña más.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../domain/entities/user.dart';
import '../../features/auth/presentation/auth_controller.dart';
import '../../shared/constants/app_strings.dart';
import '../../shared/widgets/adaptive_scaffold.dart';
import '../../shared/widgets/ui/app_button.dart';
import '../navigation_shell_location.dart';
import '../routes.dart';
import './admin_navigation.dart';
import './admin_sidebar_footer.dart';

/// Contenedor de las subpantallas del panel.
class AdminShell extends ConsumerWidget {
  const AdminShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  /// Título de la subpantalla activa.
  ///
  /// Vive AQUÍ y no en cada pantalla porque es chrome del shell: si lo pusiera cada
  /// rama, dos siblings podrían discrepar y renombrar una pantalla obligaría a tocar
  /// dos archivos.
  ///
  /// Son DOS pasadas a propósito. `AppRoutes.adminDashboard` es `/admin`, prefijo de
  /// las otras once rutas, así que una sola pasada por prefijo devolvería "Resumen"
  /// para cualquier pantalla del panel. Primero se busca coincidencia EXACTA (la
  /// pestaña activa) y solo después la pantalla que contiene la subruta.
  static String titleOf(String location) {
    for (final String path in AppRoutes.adminOrder) {
      if (location == path) return _titleOfPath(path);
    }
    for (final String path in AppRoutes.adminOrder) {
      if (location.startsWith('$path/')) return _titleOfPath(path);
    }
    return AppStrings.adminAreaTitle;
  }

  /// Título de una de las doce ramas del panel.
  static String _titleOfPath(String path) => switch (path) {
        AppRoutes.adminDashboard => 'Resumen',
        AppRoutes.adminOrders => 'Órdenes',
        AppRoutes.adminChairs => 'Sillas y zonas',
        AppRoutes.adminReservations => 'Reservas y alquileres',
        AppRoutes.adminInventory => 'Inventario',
        AppRoutes.adminProducts => 'Productos',
        AppRoutes.adminPayments => 'Pagos',
        AppRoutes.adminCustomers => 'Clientes',
        AppRoutes.adminReports => 'Reportes',
        AppRoutes.adminDiscounts => 'Descuentos',
        AppRoutes.adminUsers => 'Usuarios',
        _ => AppStrings.navSettings,
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final User? user = ref.watch(currentUserProvider);
    final String location = navigationShell.currentLocation;

    return AdaptiveScaffold(
      destinations: adminDestinations(user),
      // `currentLocation` y no `GoRouterState.of(context).uri.path`: dentro de un
      // shell, la ruta de primer nivel es la que decide qué pestaña está activa.
      currentLocation: location,
      appBarTitle: titleOf(location),
      showAppBar: true,
      body: navigationShell,
      sidebarFooter: AdminSidebarFooter(user: user),
    );
  }
}

/// Botón de salida al mostrador, mostrado en el panel a quien puede usarlo.
///
/// Va en el PIE de la sidebar y no entre los destinos: el POS no es una sección del
/// panel, es otra herramienta. Por eso el enlace va a `/pos` (ruta real) y no a una
/// pestaña más.
class PosShortcutButton extends ConsumerWidget {
  const PosShortcutButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!canUsePos(ref.watch(currentUserProvider))) {
      return const SizedBox.shrink();
    }
    return AppButton(
      label: 'Abrir el mostrador',
      icon: Icons.point_of_sale_rounded,
      variant: AppButtonVariant.espresso,
      size: AppButtonSize.medium,
      isFullWidth: true,
      onPressed: () => context.go(AppRoutes.pos),
      tooltip: 'Salir del panel y abrir el punto de venta',
    );
  }
}
