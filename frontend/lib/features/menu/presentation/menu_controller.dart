// Estado del menú: categorías, catálogo y filtros de la pantalla.
//
// TODOS LOS PROVIDERS VIVEN AQUÍ Y NO EN `core/di`, POR QUÉ: `core/` no conoce
// features (DESIGN.md §2.3). Un `Provider` que solo usa el `Dio` y las
// entidades de SU PROPIA feature es infraestructura de esa feature, y por eso
// se declara junto a su controlador. La inyección de lo shared (Dio,
// almacenamiento) sí viene de `core/di/providers.dart`.
//
// `menuRepositoryProvider` es el punto de inyección: cambiar de datasource a
// tests es `overrideWithValue`, sin tocar la pantalla.



import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../data/datasources/remote/menu_remote_datasource.dart';
import '../data/repositories/menu_repository_impl.dart';
import '../domain/entities/menu_category.dart';
import '../domain/entities/menu_product.dart';
import '../domain/repositories/menu_repository.dart';

/// Repositorio del catálogo. Punto de inyección de la feature.
final Provider<MenuRepository> menuRepositoryProvider = Provider<MenuRepository>(
  (Ref ref) => MenuRepositoryImpl(
    MenuRemoteDataSource(ref.watch(apiClientProvider)),
    ref.watch(preferencesStorageProvider),
  ),
  name: 'menuRepository',
);

/// Categorías del menú. `autoDispose` + `keepAlive` implícito por defecto: se
/// releen al invalidar, no en cada frame.
final FutureProvider<List<MenuCategory>> menuCategoriesProvider =
    FutureProvider<List<MenuCategory>>(
  (Ref ref) async {
    final Result<List<MenuCategory>> result =
        await ref.watch(menuRepositoryProvider).categories();
    return _unwrap(result);
  },
  name: 'menuCategories',
);

/// Catálogo completo (`GET /products?fields=basic`) con su procedencia.
///
/// Es la fuente de la búsqueda y de la rejilla: filtrar en el dispositivo sobre
/// el catálogo cacheado da respuesta instantánea y funciona sin red. Pedir
/// productos al servidor en cada pulsación de teclado sería peor en los tres
/// criterios (latencia, cuota de la API y datos cuando no hay red).
final FutureProvider<MenuCatalog> menuProductsProvider =
    FutureProvider<MenuCatalog>(
  (Ref ref) async {
    final Result<MenuCatalog> result =
        await ref.watch(menuRepositoryProvider).products();
    return _unwrap(result);
  },
  name: 'menuProducts',
);

/// `true` si el catálogo que se está pintando viene de la caché local.
///
/// La UI lo usa para avisar "mostramos el menú guardado" en vez de fingir que
/// los precios son de ahora. Es la diferencia entre informar y engañar.
final Provider<bool> menuIsStaleProvider = Provider<bool>(
  (Ref ref) => ref.watch(menuProductsProvider).valueOrNull?.isStale ?? false,
  name: 'menuIsStale',
);

/// Traduce `Result<T>` al valor, propagando el fallo para que
/// `AsyncStateBuilder` lo pinte con el widget correcto.
T _unwrap<T>(Result<T> result) => switch (result) {
      Success<T>(:final T value) => value,
      FailureResult<T>(:final Failure failure) => throw failure,
    };

// ---------------------------------------------------------------- Filtros

/// Estado de los filtros del menú (búsqueda + categoría).
@immutable
class MenuFilterState {
  const MenuFilterState({this.query = '', this.categoryId});

  /// Texto del buscador, ya recortado y sin espacios sobrantes.
  final String query;

  /// `null` = todas las categorías.
  final int? categoryId;

  bool get hasQuery => query.trim().isNotEmpty;

  bool get isFiltered => hasQuery || categoryId != null;

  MenuFilterState copyWith({String? query, int? categoryId, bool clearCategory = false}) =>
      MenuFilterState(
        query: query ?? this.query,
        categoryId: clearCategory ? null : (categoryId ?? this.categoryId),
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MenuFilterState &&
          other.query == query &&
          other.categoryId == categoryId;

  @override
  int get hashCode => Object.hash(query, categoryId);

  @override
  String toString() => 'MenuFilterState("$query", cat: $categoryId)';
}

/// Filtros del menú, con BUSCADOR DEBOUNCED de 300 ms.
///
/// POR QUÉ UN `Notifier` Y NO UN `StateProvider` CON `setState`
/// El debounce necesita un `Timer` que se cancele en cada pulsación y en
/// `dispose`. Un `Notifier` con `ref.onDispose` garantiza que el timer se cancela
/// aunque la pantalla desaparezca; con `setState` el timer sobrevive al widget y
/// publica sobre un provider que ya no tiene oyentes.
final NotifierProvider<MenuFilterController, MenuFilterState> menuFilterProvider =
    NotifierProvider<MenuFilterController, MenuFilterState>(MenuFilterController.new);

/// Controlador de los filtros del menú.
class MenuFilterController extends Notifier<MenuFilterState> {
  /// Espera antes de publicar el texto. 300 ms es el punto de equilibrio
  /// habitual: por debajo se nota ellag al escribir, por encima el resultado
  /// tarda en aparecer.
  static const Duration debounce = Duration(milliseconds: 300);

  Timer? _debounceTimer;

  @override
  MenuFilterState build() {
    ref.onDispose(_cancelTimer);
    // Se recupera la última categoría consultada: reabrir el menú donde estaba
    // es lo que espera alguien que vuelve a mirar la carta.
    final int? last = ref.read(preferencesStorageProvider).lastMenuFilter;
    return MenuFilterState(categoryId: last);
  }

  /// Texto del buscador. Aplica debounce: [immediate] lo publica al momento
  /// (borrar la búsqueda con la "X" debe ser instantáneo).
  void search(String raw, {bool immediate = false}) {
    final String next = raw.trim();
    _debounceTimer?.cancel();
    if (immediate || debounce == Duration.zero) {
      state = state.copyWith(query: next);
      return;
    }
    _debounceTimer = Timer(debounce, () {
      // Sin guarda de disposal: el timer se cancela en `ref.onDispose` (ver
      // `build`), así que nunca se dispara con el notifier ya destruido.
      state = state.copyWith(query: next);
    });
  }

  /// Selecciona una categoría. `null` = "Todo".
  Future<void> selectCategory(int? categoryId) async {
    state = state.copyWith(categoryId: categoryId, clearCategory: categoryId == null);
    await ref.read(preferencesStorageProvider).setLastMenuFilter(categoryId);
  }

  /// Limpia búsqueda y categoría.
  Future<void> clear() async {
    _debounceTimer?.cancel();
    state = const MenuFilterState();
    await ref.read(preferencesStorageProvider).setLastMenuFilter(null);
  }

  void _cancelTimer() {
    _debounceTimer?.cancel();
    _debounceTimer = null;
  }
}

// ------------------------------------------------------- Catálogo filtrado

/// Lo que la rejilla pinta: ya filtrado por categoría, ya filtrado por búsqueda.
@immutable
class MenuSelection {
  const MenuSelection({
    this.featured = const <MenuProduct>[],
    this.promos = const <MenuProduct>[],
    this.rest = const <MenuProduct>[],
    this.total = 0,
    this.isFiltered = false,
  });

  /// Productos con `isFeatured = true`.
  final List<MenuProduct> featured;

  /// Productos con promoción vigente. Sin duplicar los destacados: si un
  /// producto es destacado Y tiene promo, sale arriba y no se repite.
  final List<MenuProduct> promos;

  /// El resto del catálogo.
  final List<MenuProduct> rest;

  /// Número total de coincidencias de la búsqueda/filtro.
  final int total;

  final bool isFiltered;

  bool get isEmpty => total == 0;
}

/// Proyecta catálogo + filtros a la selección que pinta la pantalla.
///
/// Cuando hay búsqueda activa NO se separan las secciones: el usuario quiere
/// "que aparezca lo que escribí", no "la sección de Destacados, que no coincide
/// con su búsqueda y por tanto sale vacía".
final Provider<MenuSelection> menuSelectionProvider = Provider<MenuSelection>(
  (Ref ref) {
    final MenuCatalog? catalog = ref.watch(menuProductsProvider).valueOrNull;
    final MenuFilterState filter = ref.watch(menuFilterProvider);
    final List<MenuProduct> all = catalog?.items ?? const <MenuProduct>[];

    List<MenuProduct> visible = all;
    if (filter.categoryId != null) {
      visible = <MenuProduct>[
        for (final MenuProduct item in visible)
          if (item.categoryId == filter.categoryId) item,
      ];
    }
    if (filter.hasQuery) {
      final String needle = filter.query;
      visible = <MenuProduct>[
        for (final MenuProduct item in visible)
          if (item.matches(needle)) item,
      ];
    }

    if (filter.isFiltered) {
      return MenuSelection(rest: visible, total: visible.length, isFiltered: true);
    }

    final List<MenuProduct> featured = <MenuProduct>[
      for (final MenuProduct item in visible)
        if (item.isFeatured && item.isAvailable) item,
    ];
    final List<MenuProduct> promos = <MenuProduct>[
      for (final MenuProduct item in visible)
        if (item.hasActivePromo && item.isAvailable && !item.isFeatured) item,
    ];
    final List<MenuProduct> rest = <MenuProduct>[
      for (final MenuProduct item in visible)
        if (!item.isFeatured && !item.hasActivePromo) item,
    ];
    return MenuSelection(
      featured: featured,
      promos: promos,
      rest: rest,
      total: visible.length,
    );
  },
  name: 'menuSelection',
);
