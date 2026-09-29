// Estado de la pantalla de Productos del panel.
//
// CATÁLOGO Y GESTIÓN, EN PROVIDERS DISTINTOS
// El POS lee `GET /products?fields=basic`; el panel lee el catálogo COMPLETO, con
// stock, variantes y complementos. Son dos proyecciones distintas del mismo
// recurso y mezclarlas obligaría al POS a traer 40 KB que no usa.
//
// LAS TRES ACCIONES DE UN PRODUCTO SON DISTINTAS
//   - `PATCH /:id/availability` → agotado / disponible (comercial).
//   - `PATCH /:id/active`       → en catálogo / dado de baja (existencia).
//   - `DELETE /:id`             → baja lógica.
// Se offering por separado porque negocio y existencia NO son lo mismo
// (BR-PRICE-006): un producto puede estar dado de baja y aun así reactivarse.
//
// `sku` ES INMUTABLE
// En v1 no se puede cambiar (`API.md` §7.11). El formulario de edición lo muestra
// como solo lectura con la explicación, en vez de dejarlo editable y devolver un
// `400` al guardar.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/admin_products.dart';
import './admin_providers.dart';

/// Búsqueda del catálogo.
final StateProvider<String> adminProductSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Categoría seleccionada. `null` = todas.
final StateProvider<int?> adminProductCategoryProvider =
    StateProvider<int?>((Ref ref) => null);

/// Filtro de disponibilidad. `null` = todos.
final StateProvider<bool?> adminProductAvailableProvider =
    StateProvider<bool?>((Ref ref) => null);

/// Mostrar también los dados de baja. `false` por defecto (BR-PRICE-006).
final StateProvider<bool> adminProductShowInactiveProvider =
    StateProvider<bool>((Ref ref) => false);

/// Catálogo con los filtros de categoría y disponibilidad.
final FutureProvider<List<AdminProduct>> adminProductsProvider =
    FutureProvider<List<AdminProduct>>(
  (Ref ref) async {
    final Result<List<AdminProduct>> result =
        await ref.watch(adminCatalogRepositoryProvider).products(
              categoryId: ref.watch(adminProductCategoryProvider),
              available: ref.watch(adminProductAvailableProvider),
            );
    return switch (result) {
      Success<List<AdminProduct>>(:final List<AdminProduct> value) => value,
      FailureResult<List<AdminProduct>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminProducts',
);

/// Productos tras la búsqueda en memoria.
///
/// La búsqueda va en cliente a propósito: escribir en el campo no puede disparar
/// una petición por tecla, y el catálogo cabe en 100 filas.
final Provider<List<AdminProduct>> adminVisibleProductsProvider =
    Provider<List<AdminProduct>>((Ref ref) {
  final List<AdminProduct> all =
      ref.watch(adminProductsProvider).valueOrNull ?? const <AdminProduct>[];
  final String needle = ref.watch(adminProductSearchProvider).trim().toLowerCase();
  final bool showInactive = ref.watch(adminProductShowInactiveProvider);

  return <AdminProduct>[
    for (final AdminProduct product in all)
      if (showInactive || product.isActive)
        if (needle.isEmpty ||
            '${product.name} ${product.sku} ${product.shortDescription ?? ''}'
                .toLowerCase()
                .contains(needle))
          product,
  ];
}, name: 'adminVisibleProducts');

/// Categorías del catálogo.
final FutureProvider<List<AdminCategory>> adminCategoriesProvider =
    FutureProvider<List<AdminCategory>>(
  (Ref ref) async {
    final Result<List<AdminCategory>> result =
        await ref.watch(adminCatalogRepositoryProvider).categories();
    return switch (result) {
      Success<List<AdminCategory>>(:final List<AdminCategory> value) => value,
      FailureResult<List<AdminCategory>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminCategories',
);

/// Alta de un producto (`POST /products`).
///
/// Provider PROPIO y no un `adminProductProvider` family: ese está indexado por
/// id para actuar sobre un producto que ya existe, y el alta no tiene id hasta que
/// el backend responde. Meter un 0 como id "de momento" haría que un doble toque
/// en «Crear» mandara dos altas, porque el id 0 ya no distingue dos formularios.
final AsyncNotifierProvider<AdminProductCreateController, void>
    adminProductCreateProvider =
    AsyncNotifierProvider<AdminProductCreateController, void>(
  AdminProductCreateController.new,
);

/// Controla el alta de un producto.
class AdminProductCreateController extends AsyncNotifier<void> {
  @override
  FutureOr<void> build() {}

  /// Crea el producto. Devuelve `true` si el backend aceptó.
  ///
  /// `body` llega ya con los precios en centavos: la conversión desde pesos la
  /// hace el formulario, que es quien muestra la unidad que el usuario escribió.
  Future<bool> create(Map<String, dynamic> body) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<AdminProduct> result =
        await ref.read(adminCatalogRepositoryProvider).createProduct(body);
    // Sin guarda de disposal: `adminProductCreateProvider` no es `autoDispose`,
    // así que el notifier sobrevive a la llamada.
    switch (result) {
      case Success<AdminProduct>():
        _invalidateCatalog();
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<AdminProduct>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  /// El alta también mueve el contador de productos de cada categoría, así que
  /// invalida las dos listas y no solo el catálogo.
  void _invalidateCatalog() {
    ref.invalidate(adminProductsProvider);
    ref.invalidate(adminCategoriesProvider);
  }

  void acknowledge() => state = const AsyncData<void>(null);
}

/// Acciones sobre un producto. `AsyncNotifierProvider.family`: el estado de
/// "guardando" es POR PRODUCTO, para que tocar uno no apague los botones de los
/// otros cuarenta.
final AsyncNotifierProviderFamily<AdminProductController, void, int>
    adminProductProvider =
    AsyncNotifierProvider.family<AdminProductController, void, int>(
  AdminProductController.new,
);

/// Controla las acciones de un producto.
class AdminProductController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// Marca disponible / agotado. NO cambia `isActive`.
  Future<bool> setAvailability(bool isAvailable, {String? reason}) =>
      _run(() => ref.read(adminCatalogRepositoryProvider).setAvailability(
            arg,
            isAvailable,
            reason: reason,
          ));

  /// Activa / desactiva en el catálogo.
  Future<bool> setActive(bool isActive, {String? reason}) =>
      _run(() => ref.read(adminCatalogRepositoryProvider).setActive(
            arg,
            isActive,
            reason: reason,
          ));

  /// Baja lógica. Los `order_items` conservan su snapshot y quedan sin producto.
  Future<bool> delete({String? reason}) =>
      _run(() => ref.read(adminCatalogRepositoryProvider).deleteProduct(
            arg,
            reason: reason,
          ));

  /// `POST /products/:id/duplicate`. El `sku` es obligatorio y único.
  Future<bool> duplicate({required String sku, String? name}) => _run(
        () => ref.read(adminCatalogRepositoryProvider).duplicateProduct(
              arg,
              sku: sku,
              name: name,
            ),
      );

  /// `PATCH /products/:id` con los campos del formulario. Sin `sku` ni
  /// `isAvailable`: los dos tienen su propia ruta.
  ///
  /// Se llama `updateProduct` y no `update` a propósito: `AsyncNotifier` YA
  /// declara un `update` (el que envuelve una mutación y gestiona el error), así
  /// que un `update` propio aquí no compila como override.
  Future<bool> updateProduct(Map<String, dynamic> body) => _run(
        () => ref
            .read(adminCatalogRepositoryProvider)
            .updateProduct(arg, body),
      );

  Future<bool> _run(Future<Result<void>> Function() action) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await action();
    // Sin guarda de disposal: los providers de acciones no son `autoDispose`, así
    // que el notifier sobrevive a cualquier `await`.
    switch (result) {
      case Success<void>():
        _invalidate();
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  /// El catálogo, el POS y el menú dependen de esto: los tres releen.
  void _invalidate() {
    ref.invalidate(adminProductsProvider);
    ref.invalidate(adminCategoriesProvider);
  }

  void acknowledge() => state = const AsyncData<void>(null);
}
