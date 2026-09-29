// Destino de navegación del shell adaptativo.

import 'package:flutter/material.dart';
//
// Modelo de datos del menú: la lista de destinos la declara la app (o el
// provider de sesión, filtrada por rol), y `AdaptiveScaffold` decide CÓMO se
// pinta según el breakpoint. Así el menú de admin y el de cliente comparten
// la misma infraestructura.


/// Un destino de navegación (tab de móvil, item de rail o de sidebar).
@immutable
class AppDestination {
  const AppDestination({
    required this.label,
    required this.icon,
    required this.selectedIcon,
    required this.location,
    this.badgeCount,
    this.isVisible = true,
  });

  /// Texto visible bajo el ícono (móvil) o junto al ícono (desktop).
  final String label;

  /// Ícono en estado inactivo.
  final IconData icon;

  /// Ícono en estado activo. Si se omite, se usa [icon] con tinte.
  final IconData selectedIcon;

  /// Ubicación de go_router. Debe ser una ruta declarada en `app/router.dart`.
  /// `'/inicio'` (no `'/inicio?tab=1'`): el estado va en query params.
  final String location;

  /// Contador del badge (pedidos nuevos, alertas). `null` = sin badge.
  final int? badgeCount;

  /// `false` = el destino se oculta (permiso insuficiente, fase de despliegue).
  final bool isVisible;

  /// `true` si el destino actual corresponde a esta ruta.
  bool isSelected(String currentLocation) {
    // La home coincide solo si la ruta es exactamente la del destino: así
    // `/inicio/pedidos` sigue marcando "Pedidos", no "Inicio".
    if (location == currentLocation) return true;
    return location != '/' && currentLocation.startsWith('$location/');
  }
}
