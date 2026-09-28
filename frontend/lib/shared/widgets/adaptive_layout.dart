// Construcción del layout adaptativo. MÓDULO `AdaptiveScaffold`.
//
// Funciones top-level (no clases) porque no tienen estado: reciben todo lo que
// necesitan. Aquí vive la tabla "breakpoint → forma de navegación", de modo que
// `AdaptiveScaffold` queda como una fachada legible y esta pieza se puede
// probar por separado.
//
// Regla de desktop: el contenido se limita a [Breakpoint.contentMaxWidth] para
// que las líneas de texto no superen ~90 caracteres.

import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_spacing.dart';
import '../../app/theme/app_typography.dart';
import '../../app/theme/responsive/breakpoints.dart';
import '../constants/app_destination.dart';
import 'adaptive_nav_bars.dart';
import 'app_sidebar.dart';

/// `AppBar` del shell. En móvil lleva un divisor de 1 dp encima de la barra de
/// navegación inferior (si no, las dos superficies se funden).
PreferredSizeWidget? buildAdaptiveAppBar({
  required String? title,
  required List<Widget>? actions,
  required List<AppDestination> items,
  required String currentLocation,
  required Breakpoint breakpoint,
}) {
  return AppBar(
    title: title == null
        ? null
        : Text(
            title,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.headlineSmall,
          ),
    actions: <Widget>[
      ...?actions,
      if (title == null && items.isNotEmpty)
        Padding(
          padding: const EdgeInsets.only(right: AppSpacing.lg),
          child: Center(
            child: Text(
              currentTitle(items, currentLocation),
              style: AppTextStyles.titleMedium,
            ),
          ),
        ),
    ],
    bottom: breakpoint.usesBottomNavigation
        ? PreferredSize(
            preferredSize: const Size.fromHeight(1),
            child: Container(height: 1, color: AppColors.borderSubtle),
          )
        : null,
  );
}

/// Cuerpo del shell: rail en tablet, sidebar en desktop/wide, nada en móvil.
Widget buildAdaptiveBody({
  required Breakpoint breakpoint,
  required List<AppDestination> items,
  required String currentLocation,
  required Widget body,
  required String brandName,
  required Widget? footer,
  required void Function(AppDestination destination) onNavigate,
  required Color dividerColor,
}) {
  final content = Center(
    child: ConstrainedBox(
      constraints: BoxConstraints(maxWidth: breakpoint.contentMaxWidth),
      child: SafeArea(top: false, child: body),
    ),
  );

  if (breakpoint.usesSidebar) {
    return Row(
      children: <Widget>[
        AppSidebar(
          brandName: brandName,
          destinations: items,
          currentLocation: currentLocation,
          onDestinationSelected: onNavigate,
          footer: footer,
        ),
        _divider(dividerColor),
        Expanded(child: content),
      ],
    );
  }

  if (breakpoint.usesRail) {
    return Row(
      children: <Widget>[
        AppNavigationRail(
          destinations: items,
          currentLocation: currentLocation,
          onSelected: onNavigate,
        ),
        _divider(dividerColor),
        Expanded(child: content),
      ],
    );
  }

  return content;
}

/// Nombre del destino activo (para el título cuando la pantalla no lo define).
String currentTitle(List<AppDestination> items, String currentLocation) {
  for (final AppDestination item in items) {
    if (item.isSelected(currentLocation)) return item.label;
  }
  return items.first.label;
}

Widget _divider(Color color) => VerticalDivider(
      width: 1,
      thickness: 1,
      color: color,
    );
