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
import '../../app/theme/app_spacing.dart';
import '../../app/theme/app_typography.dart';
import '../../app/theme/responsive/breakpoints.dart';
import '../constants/app_destination.dart';
import './adaptive_nav_bars.dart';
import './app_sidebar.dart';

/// `AppBar` del shell. En móvil lleva un divisor de 1 dp encima de la barra de
/// navegación inferior (si no, las dos superficies se funden).
PreferredSizeWidget? buildAdaptiveAppBar({
  required String? title,
  required List<Widget>? actions,
  required List<AppDestination> items,
  required String currentLocation,
  required Breakpoint breakpoint,
  required Color dividerColor,
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
            child: Container(height: 1, color: dividerColor),
          )
        : null,
  );
}

/// Cuerpo del shell: rail en tablet, sidebar en desktop/wide, nada en móvil.
///
/// [hasAppBar] decide si el cuerpo necesita protector superior.
///
/// El `Scaffold` de Material YA descuenta el `MediaQuery.padding.top` del body
/// cuando hay `AppBar` (la `AppBar` lo consume), pero NO lo hace cuando
/// `appBar: null`: en ese caso el body empieza en y=0 y el primer texto se
/// dibuja debajo de la barra de estado. Por eso aquí el `SafeArea` se activa
/// solo cuando no hay `AppBar`; si se dejara siempre, en las pantallas con
/// `AppBar` se restaría el inset dos veces y el contenido quedaría hundido
/// 24-48 px (el síntoma opuesto).
Widget buildAdaptiveBody({
  required Breakpoint breakpoint,
  required List<AppDestination> items,
  required String currentLocation,
  required Widget body,
  required String brandName,
  required Widget? footer,
  required void Function(AppDestination destination) onNavigate,
  required Color dividerColor,
  required bool hasAppBar,
}) {
  final Widget content = Center(
    child: ConstrainedBox(
      constraints: BoxConstraints(maxWidth: breakpoint.contentMaxWidth),
      child: hasAppBar
          ? SafeArea(top: false, bottom: false, child: body)
          // Sin `AppBar`, el `Scaffold` no ha gastado el inset superior: hay que
          // protegerlo aquí o el saludo se solapa con el reloj y la batería.
          : SafeArea(
              top: true,
              // El inset inferior lo cubre `bottomNavigationBar`, que el
              // `Scaffold` coloca encima de la barra de gestos. Con
              // `bottom: false` no se descuenta dos veces.
              bottom: false,
              child: body,
            ),
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
