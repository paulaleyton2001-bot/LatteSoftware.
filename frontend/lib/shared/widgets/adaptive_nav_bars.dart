// Barras de navegación de móvil y tablet. MÓDULO `AdaptiveScaffold`.
//
// [AppNavigationBar] (mobile) y [AppNavigationRail] (tablet) comparten la
// lógica de estado activo y de badge, así que viven juntas: si el cálculo del
// índice activo cambia, cambia una vez.
//
// El texto siempre se muestra (en la barra inferior, `alwaysShow`): esconderlo
// en el estado inactivo hace que el usuario tenga que recordar los íconos.

import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_typography.dart';
import '../constants/app_destination.dart';

/// Barra de navegación inferior (mobile).
class AppNavigationBar extends StatelessWidget {
  const AppNavigationBar({
    required this.destinations,
    required this.currentLocation,
    required this.onSelected,
    super.key,
  });

  final List<AppDestination> destinations;
  final String currentLocation;
  final ValueChanged<AppDestination> onSelected;

  @override
  Widget build(BuildContext context) {
    return NavigationBar(
      selectedIndex: selectedIndex(destinations, currentLocation),
      onDestinationSelected: (int index) => onSelected(destinations[index]),
      destinations: <NavigationDestination>[
        for (final AppDestination item in destinations)
          NavigationDestination(
            icon: destinationIcon(item),
            selectedIcon: destinationIcon(item, selected: true),
            label: item.label,
            tooltip: item.label,
          ),
      ],
    );
  }
}

/// Riel de navegación lateral compacto (tablet).
class AppNavigationRail extends StatelessWidget {
  const AppNavigationRail({
    required this.destinations,
    required this.currentLocation,
    required this.onSelected,
    super.key,
  });

  final List<AppDestination> destinations;
  final String currentLocation;
  final ValueChanged<AppDestination> onSelected;

  @override
  Widget build(BuildContext context) {
    return NavigationRail(
      selectedIndex: selectedIndex(destinations, currentLocation),
      onDestinationSelected: (int index) => onSelected(destinations[index]),
      labelType: NavigationRailLabelType.all,
      groupAlignment: -0.9,
      destinations: <NavigationRailDestination>[
        for (final AppDestination item in destinations)
          NavigationRailDestination(
            icon: destinationIcon(item),
            selectedIcon: destinationIcon(item, selected: true),
            label: Text(
              item.label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.labelSmall,
            ),
          ),
      ],
    );
  }
}

/// Índice del destino activo; `0` si la ruta no está en la lista.
///
/// La comparación usa `AppDestination.isSelected`, que distingue la home
/// (`/inicio`) de sus hijas (`/inicio/pedidos`).
int selectedIndex(List<AppDestination> destinations, String currentLocation) {
  final index = destinations
      .indexWhere((AppDestination item) => item.isSelected(currentLocation));
  return index < 0 ? 0 : index;
}

/// Ícono del destino, con badge de contador si lo hay.
Widget destinationIcon(AppDestination item, {bool selected = false}) {
  final icon = Icon(selected ? item.selectedIcon : item.icon);
  final int? count = item.badgeCount;
  if (count == null || count <= 0) return icon;
  return Badge.count(
    count: count,
    backgroundColor: AppColors.stateErrorStrong,
    textColor: AppColors.onActionPrimary,
    child: icon,
  );
}
