// Shell del cliente: el contenedor de las cinco pestañas.
//
// POR QUÉ `StatefulShellRoute.indexedStack` Y NO RUTAS HERMANAS
// Con rutas hermanas, `context.go('/menu')` RECONSTRUYE la pantalla de menú: se
// pierde el scroll, el texto del buscador y el filtro por categoría. Con un
// shell indexado, cada rama tiene su propio `Navigator` y su propio árbol, así
// que volver a una pestaña la deja exactamente como estaba. Es lo que espera
// alguien que abre "Pedidos", mira uno y vuelve a "Menú" a seguir mirando la
// carta.
//
// `AdaptiveScaffold` (ya existente) sigue siendo el PRESENTADOR de la
// navegación: el shell solo decide QUÉ ramas existen y le pasa
// `navigationShell` como cuerpo. Así el bottom bar de móvil, el rail de tablet y
// la sidebar de escritorio se siguen comportando como antes, y ninguna pantalla
// de cliente tiene que repetir esa lógica.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../shared/constants/app_destination.dart';
import '../../shared/widgets/adaptive_scaffold.dart';
import '../../shared/widgets/ui/theme_mode_selector.dart';
import '../navigation_shell_location.dart';
import '../routes.dart';
import './customer_navigation.dart';

/// Contenedor de las pestañas del cliente.
class CustomerShell extends ConsumerWidget {
  const CustomerShell({required this.navigationShell, super.key});

  final StatefulNavigationShell navigationShell;

  /// Qué pestaña se está viendo. Lo deduce de la ruta actual, que es lo que
  /// `StatefulNavigationShell` ya sabe.
  AppDestinationTab get _tab {
    final String location = navigationShell.currentLocation;
    if (location.startsWith(AppRoutes.menu)) return AppDestinationTab.menu;
    if (location.startsWith(AppRoutes.orders)) return AppDestinationTab.orders;
    if (location.startsWith(AppRoutes.chairs)) return AppDestinationTab.chairs;
    if (location.startsWith(AppRoutes.profile)) return AppDestinationTab.profile;
    return AppDestinationTab.home;
  }

  /// Título de la pestaña activa.
  ///
  /// Vive AQUÍ y no en cada pantalla porque el chrome es del shell: si el título
  /// lo pusiera cada rama, dos siblings podrían discrepar y habría que tocar cinco
  /// ficheros para renombrar una pantalla.
  String get _title => switch (_tab) {
        AppDestinationTab.home => 'Inicio',
        AppDestinationTab.menu => 'Menú',
        AppDestinationTab.orders => 'Mis pedidos',
        AppDestinationTab.chairs => 'Tu silla',
        AppDestinationTab.profile => 'Mi perfil',
      };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppDestinationTab tab = _tab;
    final List<AppDestination> destinations = customerDestinations(ref, tab);

    return AdaptiveScaffold(
      destinations: destinations,
      // `currentLocation` y no `GoRouterState.of(context).uri.path`: dentro de
      // un shell, el estado de la rama puede ser el de una subpantalla y
      // `currentLocation` es siempre la ruta de primer nivel, que es la que
      // decide qué pestaña está activa.
      currentLocation: navigationShell.currentLocation,
      brandName: customerBrandName,
      appBarTitle: _title,
      // ACCESO RÁPIDO AL TEMA. El selector de tres estados vive en Perfil →
      // Apariencia, pero obligar a bajar hasta la última sección del perfil para
      // cambiar de tema convierte una preferencia frecuente en una expedición. El
      // botón abre una hoja con ESE MISMO selector (mismo widget, mismo
      // provider), así que no hay dos ajustes que puedan discrepar.
      appBarActions: const <Widget>[ThemeModeQuickButton()],
      // La home ya trae su propio saludo gigante; una `AppBar` con el nombre de la
      // app encima sería redundante y robaría alto en móvil.
      showAppBar: tab != AppDestinationTab.home,
      body: navigationShell,
    );
  }
}
