// Sidebar de escritorio: logo, items de navegación y pie.
//
// Solo se usa en `desktop` y `wide` (ver `AdaptiveScaffold`). En tablet el
// mismo destino se ve en `NavigationRail`, así que esta clase no tiene
// variante "composta".
//
// Elementos:
//   - Marca "Latte Coffee" (icono redondeado verde con la inicial + nombre).
//   - Lista de items con ícono + texto; el activo con fondo verde suave y
//     texto verde oscuro, más una barra lateral de 3 dp (tercer canal).
//   - Pie opcional (perfil + cerrar sesión) que el caller inyecta.
//
// Accesibilidad: cada item es un `Semantics(button)` con `selected`, la fila
// tiene alto mínimo de 44 dp y el foco es visible con el anillo verde del
// tema.

import 'package:flutter/material.dart';

import '../../app/theme/app_spacing.dart';
import '../../app/theme/responsive/breakpoints.dart';
import '../constants/app_destination.dart';
import 'brand_mark.dart';
import 'sidebar_item.dart';

/// Barra lateral fija de escritorio.
class AppSidebar extends StatelessWidget {
  const AppSidebar({
    required this.destinations,
    required this.currentLocation,
    required this.onDestinationSelected,
    this.brandName = 'Latte Coffee',
    this.footer,
    super.key,
  });

  final List<AppDestination> destinations;
  final String currentLocation;
  final ValueChanged<AppDestination> onDestinationSelected;
  final String brandName;

  /// Perfil / acciones al pie.
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    final width = context.breakpoint.sidebarWidth;
    return Semantics(
      container: true,
      label: 'Navegación principal',
      child: Container(
        width: width,
        color: Theme.of(context).colorScheme.surface,
        child: SafeArea(
          right: false,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  AppSpacing.lg,
                  AppSpacing.lg,
                  AppSpacing.sm,
                ),
                child: BrandMark(label: brandName),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView.builder(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.md,
                    vertical: AppSpacing.md,
                  ),
                  itemCount: destinations.length,
                  itemBuilder: (BuildContext context, int index) {
                    final item = destinations[index];
                    return SidebarItem(
                      destination: item,
                      selected: item.isSelected(currentLocation),
                      onTap: () => onDestinationSelected(item),
                    );
                  },
                ),
              ),
              if (footer != null) ...<Widget>[
                const Divider(height: 1),
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.md),
                  child: footer,
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
