// Variantes, complementos y receta de un producto.
//
// MÓDULO `features/admin/data`. Verifica contra `catalog.routes.ts`.
//
// ⚠️ ORDEN DE RUTAS EN EL BACKEND
// `productsRouter` declara `GET /products/ingredients` ANTES que `/:id`, porque
// Express enruta en orden de declaración y `ingredients` no es un id. Está anotado
// en `catalog.routes.ts` para que nadie lo invierta. Aquí solo se usan las rutas
// de DOS segmentos (`/:id/variants`, `/:id/addons`, `/:id/ingredients`), que no
// tienen esa ambigüedad.
//
// LA RECETA ES LA QUE MANEJA EL INVENTARIO
// `lineCostMinor` es el coste de UNA unidad del producto según la receta
// (API.md §7.11). Multiplicar por el precio de venta da el margen, que es lo que
// hace útil esta pantalla.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';

/// Datasource de variantes, complementos e ingredientes.
class AdminCatalogVariantsDataSource {
  const AdminCatalogVariantsDataSource(this._dio);

  final Dio _dio;

  // --------------------------------------------------------------- Variantes
  /// `GET /products/:id/variants`. `effectivePriceMinor` ya viene resuelto.
  Future<List<Map<String, dynamic>>> variants(int productId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.productVariants(productId),
    );
    return unwrapList(response.data);
  }

  /// `POST /products/:id/variants`.
  ///
  /// `priceDeltaMinor` puede ser NEGATIVO (el "grande" suele costar menos por
  /// unidad que el mediano). `priceMinor`, si se manda, SOBREESCRIBE el precio
  /// base del producto para ese tamaño.
  Future<void> createVariant(int productId, Map<String, dynamic> body) async {
    await _dio.post<dynamic>(
      ApiEndpoints.productVariants(productId),
      data: body,
    );
  }

  /// `PATCH /products/variants/:variantId`.
  Future<void> updateVariant(int variantId, Map<String, dynamic> body) async {
    await _dio.patch<dynamic>(ApiEndpoints.productVariant(variantId), data: body);
  }

  /// `DELETE /products/variants/:variantId`.
  ///
  /// Da `422 LAST_DEFAULT_VARIANT` si es la única variante por defecto y el
  /// producto la necesita.
  Future<void> deleteVariant(int variantId) async {
    await _dio.delete<dynamic>(ApiEndpoints.productVariant(variantId));
  }

  // ----------------------------------------------------------- Complementos
  /// `GET /products/:id/addons`.
  Future<List<Map<String, dynamic>>> addons(int productId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.productAddons(productId),
    );
    return unwrapList(response.data);
  }

  /// `POST /products/:id/addons`.
  Future<void> createAddon(int productId, Map<String, dynamic> body) async {
    await _dio.post<dynamic>(ApiEndpoints.productAddons(productId), data: body);
  }

  /// `PATCH /products/addons/:addonId`.
  Future<void> updateAddon(int addonId, Map<String, dynamic> body) async {
    await _dio.patch<dynamic>(ApiEndpoints.productAddon(addonId), data: body);
  }

  /// `DELETE /products/addons/:addonId`.
  Future<void> deleteAddon(int addonId) async {
    await _dio.delete<dynamic>(ApiEndpoints.productAddon(addonId));
  }

  // ------------------------------------------------------------------ Receta
  /// `GET /products/:id/ingredients` — receta con coste por unidad.
  Future<List<Map<String, dynamic>>> ingredients(int productId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.productIngredients(productId),
    );
    return unwrapList(response.data);
  }

  /// `POST /products/:id/ingredients` — añade un insumo a la receta.
  ///
  /// `ingredientId` es un INGREDIENTE, no un producto: los insumos son el catálogo
  /// maestro del inventario y los productos lo consumen. `updateStock: true` crea
  /// el `inventory_item` si el insumo no tenía uno.
  Future<void> addIngredient(int productId, Map<String, dynamic> body) async {
    await _dio.post<dynamic>(
      ApiEndpoints.productIngredients(productId),
      data: body,
    );
  }

  /// `DELETE /products/:id/ingredients/:ingredientId`.
  ///
  /// Quita el insumo de la receta; NO toca el inventario (API.md §7.11).
  Future<void> removeIngredient(int productId, int ingredientId) async {
    await _dio.delete<dynamic>(
      '${ApiEndpoints.productIngredients(productId)}/$ingredientId',
    );
  }


}
