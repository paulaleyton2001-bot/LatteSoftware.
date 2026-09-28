// Scaffold adaptativo: navigation shell de la app.
//
// Este widget es la razón por la que desktop NO es "la app móvil estirada":
// cambia la ARQUITECTURA de navegación según el ancho, no solo el margen.
//
//   - mobile (< 600):  `NavigationBar` inferior con 5 destinos.
//   - tablet (600+):   `NavigationRail` lateral compacta.
//   - desktop (1024+): sidebar fija con logo + items + bloque de perfil.
//   - wide (1440+):    igual que desktop, con más aire y ancho máximo de
//                      contenido (nada de líneas de 2000 px).
//
// ```dart
// AdaptiveScaffold(
//   destinations: ref.watch(menuDestinationsProvider),
//   currentLocation: GoRouterState.of(context).uri.path,
//   appBarTitle: 'Menú',
//   body: ProductGrid(...),
// );
// ```
//
// Límite conocido: hoy los destinos son rutas hermanas; la fase siguiente los
// agrupa en un `StatefulShellRoute.indexedStack` para conservar el estado de
// cada pestaña, conservando este widget como presentador.

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/responsive/breakpoints.dart';
import '../constants/app_destination.dart';
import 'adaptive_layout.dart';
import 'adaptive_nav_bars.dart';

/// Shell de navegación adaptativo.
class AdaptiveScaffold extends StatelessWidget {
  const AdaptiveScaffold({
    required this.destinations,
    required this.currentLocation,
    required this.body,
    this.appBarTitle,
    this.appBarActions,
    this.floatingActionButton,
    this.showAppBar = true,
    this.brandName = 'Latte Coffee',
    this.sidebarFooter,
    super.key,
  });

  /// Destinos visibles (el caller ya filtró por rol/permiso).
  final List<AppDestination> destinations;

  /// Ruta actual (`GoRouterState.of(context).uri.path`).
  final String currentLocation;

  /// Contenido de la pantalla.
  final Widget body;

  final String? appBarTitle;
  final List<Widget>? appBarActions;
  final Widget? floatingActionButton;

  /// `false` para pantallas full-bleed (mapa de sillas, POS).
  final bool showAppBar;

  final String brandName;

  /// Widget del pie de la sidebar (perfil, logout) en desktop.
  final Widget? sidebarFooter;

  /// Destinos que realmente se pintan.
  List<AppDestination> get _visible => destinations
      .where((AppDestination item) => item.isVisible)
      .toList(growable: false);

  @override
  Widget build(BuildContext context) {
    final breakpoint = context.breakpoint;
    final items = _visible;
    void onNavigate(AppDestination item) => _go(context, item);

    return Scaffold(
      appBar: showAppBar
          ? buildAdaptiveAppBar(
              title: appBarTitle,
              actions: appBarActions,
              items: items,
              currentLocation: currentLocation,
              breakpoint: breakpoint,
            )
          : null,
      body: buildAdaptiveBody(
        breakpoint: breakpoint,
        items: items,
        currentLocation: currentLocation,
        body: body,
        brandName: brandName,
        footer: sidebarFooter,
        onNavigate: onNavigate,
        dividerColor: Theme.of(context).colorScheme.outlineVariant,
      ),
      floatingActionButton: floatingActionButton,
      bottomNavigationBar: breakpoint.usesBottomNavigation
          ? AppNavigationBar(
              destinations: items,
              currentLocation: currentLocation,
              onSelected: onNavigate,
            )
          : null,
    );
  }

  /// Navegación declarativa. `go` reemplaza la pila: el menú lateral es una
  /// navegación de nivel superior, no un historial.
  void _go(BuildContext context, AppDestination item) {
    if (item.isSelected(currentLocation)) return;
    context.go(item.location);
  }
}
