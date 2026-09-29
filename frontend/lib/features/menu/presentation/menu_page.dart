// Pantalla del menú: saludo, buscador, categorías y rejilla de productos.
//
// ESTRUCTURA
// ----------
// Un `CustomScrollView` con `SliverToBoxAdapter` para las cabeceras y
// `SliverGrid` para la rejilla. Se podría haber metido todo en una `Column` con
// `Expanded`, pero eso obliga a reconstruir las cabeceras en cada scroll y
// confunde a los lectores de pantalla; con slivers cada bloque es un nodo con su
// nombre.
//
// ESTADOS (TODOS por `AsyncStateBuilder`)
//   carga    → `AppSpinner` con mensaje
//   sin red  → `OfflineState` con reintento
//   error    → `ErrorState` con reintento
//   vacío    → `EmptyState` con salida al catálogo completo o a la home
//   éxito    → la pantalla
//
// AVISO DE CACHÉ: si el catálogo vino de la caché local (el backend no
// respondió) se muestra una franja que lo dice. Un menú con precios viejos sin
// aviso es peor que un menú vacío con aviso.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/routes.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/menu_category.dart';
import '../domain/repositories/menu_repository.dart';
import './menu_controller.dart';
import './widgets/menu_body.dart';

/// Pantalla de menú del cliente.
class MenuPage extends ConsumerWidget {
  const MenuPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<MenuCatalog> catalog = ref.watch(menuProductsProvider);
    final AsyncValue<List<MenuCategory>> categoriesAsync =
        ref.watch(menuCategoriesProvider);
    final MenuSelection selection = ref.watch(menuSelectionProvider);
    final bool isStale = ref.watch(menuIsStaleProvider);

    final Map<int, String> categoryNames = <int, String>{
      for (final MenuCategory category
          in categoriesAsync.valueOrNull ?? const <MenuCategory>[])
        category.id: category.name,
    };

    // El chrome (AppBar y navegación) es de `CustomerShell`; esta pantalla solo
    // devuelve su contenido.
    return AsyncStateBuilder<MenuCatalog>(
      value: catalog,
      loadingMessage: 'Cargando el menú…',
      onRetry: () async => ref.invalidate(menuProductsProvider),
      isEmpty: (MenuCatalog data) => data.items.isEmpty,
      emptyIcon: Icons.local_cafe_outlined,
      emptyTitle: 'El menú está vacío',
      emptyMessage:
          'Ahora mismo no hay productos publicados. Vuelve en un rato: el menú '
          'se actualiza solo.',
      emptyActionLabel: 'Ir al inicio',
      onEmptyAction: () => context.go(AppRoutes.home),
      builder: (BuildContext context, MenuCatalog data) => MenuBody(
        selection: selection,
        categories: categoriesAsync.valueOrNull ?? const <MenuCategory>[],
        categoryNames: categoryNames,
        isStale: isStale,
      ),
    );
  }
}
