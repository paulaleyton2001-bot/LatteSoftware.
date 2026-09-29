// Implementación de `AdminCatalogRepository`.
// MÓDULO `features/admin/data/repositories`.
//
// SEPARADA DE `admin_repository_impl.dart` POR TAMAÑO
// Catálogo (productos, categorías, variantes, complementos, receta) y operaciones
// (pedidos, pagos, reportes) son 90 métodos en un solo archivo: cualquier cambio
// tocaba un archivo que todas las pantallas del panel importan, y una errata se
// manifestaba en una pantalla que no tenía nada que ver.
//
// Ver `admin_repository_impl.dart` para el criterio de errores: sin lanzar, con
// `Result<T>` y sin traducir los de negocio (el mensaje del backend ya es el que
// hay que ver).

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/admin_products.dart';
import '../../domain/repositories/admin_repository.dart';
import '../datasources/remote/admin_catalog_datasource.dart';
import '../datasources/remote/admin_variants_datasource.dart';

/// Repositorio del catálogo de gestión.
class AdminCatalogRepositoryImpl implements AdminCatalogRepository {
  const AdminCatalogRepositoryImpl(this._remote, this._variants);

  final AdminCatalogDataSource _remote;
  final AdminCatalogVariantsDataSource _variants;

  @override
  Future<Result<List<AdminProduct>>> products({
    String? query,
    int? categoryId,
    bool? available,
  }) =>
      _guard(() => _remote.products(
            query: query,
            categoryId: categoryId,
            available: available,
          ));

  @override
  Future<Result<AdminProduct?>> product(int productId) =>
      _guard(() => _remote.product(productId));

  @override
  Future<Result<AdminProduct>> createProduct(Map<String, dynamic> body) =>
      _guard(() => _remote.createProduct(body));

  @override
  Future<Result<AdminProduct>> updateProduct(
    int productId,
    Map<String, dynamic> body,
  ) =>
      _guard(() => _remote.updateProduct(productId, body));

  @override
  Future<Result<void>> setAvailability(
    int productId,
    bool isAvailable, {
    String? reason,
  }) =>
      _guard(() => _remote.setAvailability(productId, isAvailable, reason: reason));

  @override
  Future<Result<void>> setActive(int productId, bool isActive, {String? reason}) =>
      _guard(() => _remote.setActive(productId, isActive, reason: reason));

  @override
  Future<Result<AdminProduct>> duplicateProduct(
    int productId, {
    required String sku,
    String? name,
  }) =>
      _guard(() => _remote.duplicateProduct(productId, sku: sku, name: name));

  @override
  Future<Result<void>> deleteProduct(int productId, {String? reason}) =>
      _guard(() => _remote.deleteProduct(productId, reason: reason));

  @override
  Future<Result<List<AdminCategory>>> categories() =>
      _guard(_remote.categories);

  @override
  Future<Result<AdminCategory>> createCategory(Map<String, dynamic> body) =>
      _guard(() => _remote.createCategory(body));

  @override
  Future<Result<void>> updateCategory(
    int categoryId,
    Map<String, dynamic> body,
  ) =>
      _guard(() => _remote.updateCategory(categoryId, body));

  @override
  Future<Result<void>> deleteCategory(int categoryId, {bool confirmOrphan = false}) =>
      _guard(() => _remote.deleteCategory(categoryId, confirmOrphan: confirmOrphan));

  @override
  Future<Result<List<Map<String, dynamic>>>> variants(int productId) =>
      _guard(() => _variants.variants(productId));

  @override
  Future<Result<void>> createVariant(int productId, Map<String, dynamic> body) =>
      _guard(() => _variants.createVariant(productId, body));

  @override
  Future<Result<void>> updateVariant(int variantId, Map<String, dynamic> body) =>
      _guard(() => _variants.updateVariant(variantId, body));

  @override
  Future<Result<void>> deleteVariant(int variantId) =>
      _guard(() => _variants.deleteVariant(variantId));

  @override
  Future<Result<List<Map<String, dynamic>>>> addons(int productId) =>
      _guard(() => _variants.addons(productId));

  @override
  Future<Result<void>> createAddon(int productId, Map<String, dynamic> body) =>
      _guard(() => _variants.createAddon(productId, body));

  @override
  Future<Result<void>> updateAddon(int addonId, Map<String, dynamic> body) =>
      _guard(() => _variants.updateAddon(addonId, body));

  @override
  Future<Result<void>> deleteAddon(int addonId) =>
      _guard(() => _variants.deleteAddon(addonId));

  @override
  Future<Result<List<Map<String, dynamic>>>> ingredients(int productId) =>
      _guard(() => _variants.ingredients(productId));

  @override
  Future<Result<void>> addIngredient(int productId, Map<String, dynamic> body) =>
      _guard(() => _variants.addIngredient(productId, body));

  @override
  Future<Result<void>> removeIngredient(int productId, int ingredientId) =>
      _guard(() => _variants.removeIngredient(productId, ingredientId));
}

/// Envuelve cualquier excepción en un `FailureResult<T>`.
Future<Result<T>> _guard<T>(Future<T> Function() action) async {
  try {
    return Success<T>(await action());
  } on Object catch (error) {
    return FailureResult<T>(ApiException.toFailure(error));
  }
}
