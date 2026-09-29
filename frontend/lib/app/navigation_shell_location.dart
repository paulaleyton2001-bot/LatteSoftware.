// Utilidad de navegación del shell indexado.
//
// QUÉ RESUELVE
// `StatefulNavigationShell` (go_router 14.8) expone `currentIndex` —qué rama del
// shell está activa— pero NO la ruta de esa rama. Los dos shells de la app
// (`app/customer` y `app/admin`) necesitan la ruta de PRIMER NIVEL para decidir
// qué pestaña está marcada y qué título va en la `AppBar`.
//
// POR QUÉ NO BASTA `GoRouterState.of(context).uri.path`
// Esa es la ruta COMPLETA, con la subpantalla dentro. En el panel, `/admin` es
// prefijo de `/admin/ordenes/5`, así que comparar por prefijo marcaría "Resumen"
// como la pestaña activa y pondría "Resumen" en el título de una lista de
// pedidos. La ruta de primer nivel evita ese falso positivo: `/admin/ordenes`
// no empieza por `/admin/`.
//
// En el cliente, además, `/perfil/editar` debe seguir marcando "Perfil": con la
// ruta de primer nivel (`/perfil`) la pestaña no se mueve al navegar dentro del
// perfil, que es justo lo que quiere quien edita su nombre y vuelve atrás.

import 'package:go_router/go_router.dart';

/// Ruta de primer nivel de la rama activa del shell.
extension StatefulNavigationShellLocation on StatefulNavigationShell {
  /// Ruta de la rama activa, sin la subpantalla.
  ///
  /// Es la ruta del primer `GoRoute` de la rama. Si esa ruta fuese RELATIVA
  /// (el shell anidado dentro de otro `GoRoute`), se devuelve la ruta completa
  /// actual: es un peor resultado, pero nunca una ruta inventada, y el
  /// `isSelected` de `AppDestination` sigue funcionando por prefijo.
  String get currentLocation {
    final List<StatefulShellBranch> branches = route.branches;
    if (currentIndex < 0 || currentIndex >= branches.length) {
      return shellRouteContext.routerState.uri.path;
    }
    final GoRoute? first = branches[currentIndex].defaultRoute;
    final String path = first?.path ?? '';
    if (path.startsWith('/')) return path;
    return shellRouteContext.routerState.uri.path;
  }
}
