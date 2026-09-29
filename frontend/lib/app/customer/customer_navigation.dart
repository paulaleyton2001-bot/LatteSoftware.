// Destinos de navegación del CLIENTE. Módulo `app/customer`.
//
// Las cinco pestañas del shell se declaran AQUÍ y no en cada pantalla: el
// `StatefulShellRoute` las necesita para el `NavigationBar` de móvil, el
// `NavigationRail` de tablet y la `AppSidebar` de escritorio, y si cada pantalla
// construyera su propia lista, cambiar el nombre de una pestaña obligaría a
// tocar cinco ficheros.
//
// `AppDestinationTab` identifica la pestaña para que cada página pase la suya y
// el shell sepa cuál marcar (el `AppDestination` genérico no sabe de pestañas).
//
// BADGE DEL CARRITO
// Se alimenta de `cartBadgeCountProvider` (que proyecta `totalQuantity`), y no
// de un `ChangeNotifier` propio: así la barra inferior se reconstruye solo cuando
// el NÚMERO cambia, no en cada edición de una nota. `CartChangedNotifier`
// (features/cart) existe para el caso de que el badge tenga que vivir fuera de
// un provider; aquí no hace falta y no se añade ruido.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/customer/cart_providers.dart';
import '../../shared/constants/app_destination.dart';
import '../../shared/constants/app_strings.dart';
import '../routes.dart';

/// Pestañas del shell del cliente.
enum AppDestinationTab {
  home,
  menu,
  orders,
  chairs,
  profile,
}

/// Lista de destinos de la pestaña [tab], con el badge del carrito aplicado.
///
/// Solo se pasa el número de artículos en la pestaña de Inicio: es donde el
/// cliente mira al entrar, y un badge en las cinco barras inferior es ruido.
List<AppDestination> customerDestinations(WidgetRef ref, AppDestinationTab tab) {
  final int cartCount = ref.watch(cartBadgeCountProvider);
  final bool showCartBadge = tab == AppDestinationTab.home && cartCount > 0;

  return <AppDestination>[
    AppDestination(
      label: 'Inicio',
      icon: Icons.home_outlined,
      selectedIcon: Icons.home_rounded,
      location: AppRoutes.home,
      badgeCount: showCartBadge ? cartCount : null,
    ),
    const AppDestination(
      label: 'Menú',
      icon: Icons.local_cafe_outlined,
      selectedIcon: Icons.local_cafe_rounded,
      location: AppRoutes.menu,
    ),
    const AppDestination(
      label: 'Pedidos',
      icon: Icons.receipt_long_outlined,
      selectedIcon: Icons.receipt_long_rounded,
      location: AppRoutes.orders,
    ),
    const AppDestination(
      label: 'Silla',
      icon: Icons.event_seat_outlined,
      selectedIcon: Icons.event_seat_rounded,
      location: AppRoutes.chairs,
    ),
    const AppDestination(
      label: 'Perfil',
      icon: Icons.person_outline_rounded,
      selectedIcon: Icons.person_rounded,
      location: AppRoutes.profile,
    ),
  ];
}

/// Texto de marca para la `AppSidebar`.
const String customerBrandName = AppStrings.appName;
