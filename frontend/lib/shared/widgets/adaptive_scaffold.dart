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
// ─────────────────────────────────────────────────────────────────────────────
// DÓNDE VA EL `SafeArea` Y POR QUÉ ESTE ES EL SHELL QUE LO RESUELVE
// ─────────────────────────────────────────────────────────────────────────────
// El aviso "Buenas noches, Usuario se solapa con la barra de estado" no venía de
// la pantalla de inicio: venía de AQUÍ. `Scaffold` con `appBar: null` NO
// consume el `MediaQuery.padding.top`; lo deja entero y entrega el body desde
// y=0. La pantalla de inicio es la única que se monta con `showAppBar: false`
// (para que el saludo ocupe toda la pantalla), así que era la única que
// sufferingía el solapamiento — y era la de inicio, la primera que ve el
// usuario, la que da la impresión de que "la app está rota".
//
// La regla que se aplica, y que no depende de acordarse pantalla por pantalla:
//
//   · con `AppBar`    -> el `AppBar` de Material ya aplica el inset superior;
//                        el body solo necesita `SafeArea(top: false)` para no
//                        descontarlo dos veces.
//   · sin `AppBar`    -> el inset superior lo protege `buildAdaptiveBody`.
//
// Lo que este widget NO hace (a propósito): meter un `SafeArea` global en el
// `body` Y en el `bottomNavigationBar` a la vez. `NavigationBar` ya aplica el
// inset inferior él mismo, así que hacerlo en los dos sitios hunde el contenido
// ~24-48 px en un móvil con barra de gestos: el error opuesto, igual de visible.
//
// Límite conocido: hoy los destinos son rutas hermanas; la fase siguiente los
// agrupa en un `StatefulShellRoute.indexedStack` para conservar el estado de
// cada pestaña, conservando este widget como presentador.

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme/app_tokens.dart';
import '../../app/theme/responsive/breakpoints.dart';
import '../constants/app_destination.dart';
import './adaptive_layout.dart';
import './adaptive_nav_bars.dart';

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
    final AppTokens t = context.tokens;
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
              dividerColor: t.borderSubtle,
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
        dividerColor: t.borderSubtle,
        hasAppBar: showAppBar,
      ),
      floatingActionButton: floatingActionButton,
      // La `NavigationBar` de Material aplica por su cuenta el inset inferior
      // (los `NavigationBar` la envuelven en un `MediaQuery` sin el padding
      // inferior), así que aquí NO hay que añadir un `SafeArea`: hacerlo
      // duplicaría el margen sobre la barra de gestos del Motorola.
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
