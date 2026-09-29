// Llamadas HTTP del panel: catálogo y pedidos. MÓDULO `features/admin/data`.
//
// Las rutas se verificaron una a una contra `backend/src/modules/*/*.routes.ts`
// (el código real del backend), no solo contra `docs/API.md`. Los tres endpoints
// que API.md NO documentaba y que aquí sí se usan van marcados como DESVIACIÓN.
//
// Cada fila se estrecha con los lectores de `data/models/json_reader.dart`: un
// campo que llegue con otro tipo no revienta la tabla, se descarta.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_products.dart';

/// Datasource del catálogo de gestión.
class AdminCatalogDataSource {
  const AdminCatalogDataSource(this._dio);

  final Dio _dio;

  /// `GET /products` — catálogo completo, con stock y recuentos.
  Future<List<AdminProduct>> products({
    String? query,
    int? categoryId,
    bool includeInactive = true,
    bool? available,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.products,
      queryParameters: <String, dynamic>{
        'pageSize': 100,
        'sort': 'name',
        'order': 'asc',
        'includeInactive': includeInactive,
        if (query != null && query.trim().length >= 2) 'q': query.trim(),
        if (categoryId != null) 'categoryId': categoryId,
        if (available != null) 'available': available,
      },
    );
    return _map(unwrapList(response.data), AdminProduct.tryParse);
  }

  /// `GET /products/:id` — producto con variantes, complementos e ingredientes.
  Future<AdminProduct?> product(int productId) async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.productById(productId));
    return AdminProduct.tryParse(unwrapData(response.data));
  }

  /// `POST /products` — alta. El cuerpo lo arma el formulario.
  Future<AdminProduct> createProduct(Map<String, dynamic> body) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.products,
      data: body,
    );
    return AdminProduct.tryParse(unwrapData(response.data)) ??
        const AdminProduct(id: 0, sku: '', name: 'Creado', basePriceMinor: 0);
  }

  /// `PATCH /products/:id` — edición.
  ///
  /// `sku` NO se manda: es inmutable en v1 (API.md §7.11) y mandarlo da `400`.
  /// `isAvailable` tampoco: tiene su propio endpoint.
  Future<AdminProduct> updateProduct(int productId, Map<String, dynamic> body) async {
    final Response<dynamic> response = await _dio.patch<dynamic>(
      ApiEndpoints.productById(productId),
      data: body,
    );
    return AdminProduct.tryParse(unwrapData(response.data)) ??
        const AdminProduct(id: 0, sku: '', name: 'Actualizado', basePriceMinor: 0);
  }

  /// `PATCH /products/:id/availability` — disponible / agotado.
  ///
  /// Endpoint propio porque disponibilidad COMERCIAL y existencia en el catálogo
  /// no son lo mismo (BR-PRICE-006).
  Future<void> setAvailability(int productId, bool isAvailable, {String? reason}) async {
    await _dio.patch<dynamic>(
      ApiEndpoints.productAvailability(productId),
      data: <String, dynamic>{
        'isAvailable': isAvailable,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
  }

  /// `PATCH /products/:id/active` — activar / desactivar en el catálogo.
  Future<void> setActive(int productId, bool isActive, {String? reason}) async {
    await _dio.patch<dynamic>(
      ApiEndpoints.productActive(productId),
      data: <String, dynamic>{
        'isActive': isActive,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
  }

  /// `POST /products/:id/duplicate` — duplica con variantes y complementos.
  /// El `sku` es obligatorio y único.
  Future<AdminProduct> duplicateProduct(
    int productId, {
    required String sku,
    String? name,
    bool copyVariants = true,
    bool copyAddons = true,
    bool copyIngredients = true,
    bool isActive = false,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.productDuplicate(productId),
      data: <String, dynamic>{
        'sku': sku,
        if (name != null && name.isNotEmpty) 'name': name,
        'copyVariants': copyVariants,
        'copyAddons': copyAddons,
        'copyIngredients': copyIngredients,
        'isActive': isActive,
      },
    );
    return AdminProduct.tryParse(unwrapData(response.data)) ??
        const AdminProduct(id: 0, sku: '', name: 'Copia', basePriceMinor: 0);
  }

  /// `DELETE /products/:id` — baja lógica.
  Future<void> deleteProduct(int productId, {String? reason}) async {
    await _dio.delete<dynamic>(
      ApiEndpoints.productById(productId),
      data: <String, dynamic>{
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
  }

  /// `GET /categories` — categorías del catálogo.
  ///
  /// Sin `sort`: el defecto del endpoint ya es `sortOrder asc` (ver
  /// `core/network/README.md`, "Orden de listados").
  Future<List<AdminCategory>> categories({bool includeInactive = true}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.categories,
      queryParameters: <String, dynamic>{
        'pageSize': 100,
        // Máximo del endpoint (`docs/API.md` §5.1): por encima, `400`.
        'order': 'asc',
        'includeInactive': includeInactive,
      },
    );
    return _map(unwrapList(response.data), AdminCategory.tryParse);
  }

  /// `POST /categories` — alta de categoría.
  Future<AdminCategory> createCategory(Map<String, dynamic> body) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.categories,
      data: body,
    );
    return AdminCategory.tryParse(unwrapData(response.data)) ??
        const AdminCategory(id: 0, name: 'Categoría creada');
  }

  /// `PATCH /categories/:id` — edición.
  Future<void> updateCategory(int categoryId, Map<String, dynamic> body) async {
    await _dio.patch<dynamic>(
      ApiEndpoints.categoryById(categoryId),
      data: body,
    );
  }

  /// `DELETE /categories/:id` — baja lógica.
  ///
  /// `confirmOrphan` es OBLIGATORIO si la categoría tiene productos: sin él el
  /// backend responde `422 CATEGORY_HAS_PRODUCTS` (API.md §7.10). Los productos
  /// quedan con `categoryId = null`, NO se borran.
  Future<void> deleteCategory(int categoryId, {bool confirmOrphan = false}) async {
    await _dio.delete<dynamic>(
      ApiEndpoints.categoryById(categoryId),
      data: <String, dynamic>{'confirmOrphan': confirmOrphan},
    );
  }

  /// Lista parseada, descartando las filas sin los campos obligatorios.
  static List<T> _map<T>(
    List<Map<String, dynamic>> rows,
    T? Function(Map<String, dynamic> row) parse,
  ) {
    final List<T> out = <T>[];
    for (final Map<String, dynamic> row in rows) {
      final T? item = parse(row);
      if (item != null) out.add(item);
    }
    return out;
  }
}
