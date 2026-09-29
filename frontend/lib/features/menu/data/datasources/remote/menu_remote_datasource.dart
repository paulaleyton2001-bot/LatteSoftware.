// Datasource remoto del catálogo. Módulo `features/menu/data`.
//
// Es el ÚNICO archivo de esta feature que conoce rutas, query strings y la
// forma del JSON. No conoce `Failure`, ni `Result`, ni entidades: devuelve DTOs y
// deja que la excepción de `dio` suba al repositorio, que la mapea. Así el
// mapeo de errores se puede probar sin red.
//
// PAGINACIÓN DEL CATÁLOGO
// `GET /products` pagina (`pageSize` máximo 100). El menú necesita el catálogo
// COMPLETO para que el buscador y los filtros por categoría funcionen sobre el
// dispositivo, así que se recorren páginas hasta llenar `meta.total`, con un
// tope de [maxPages]: una app abierta con un catálogo enorme no debe descargar
// 50 000 filas para pintar la primera pantalla, y el tope está declarado aquí,
// no escondido en un bucle infinito.


import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../../data/models/json_reader.dart';
import '../../models/category_dto.dart';
import '../../models/product_dto.dart';

/// Llamadas HTTP a `/api/v1/categories` y `/api/v1/products`.
class MenuRemoteDataSource {
  const MenuRemoteDataSource(this._dio);

  final Dio _dio;

  /// Tope de páginas de productos que se descargan para el menú.
  static const int maxPages = 6;

  /// `GET /categories?includeProductCount=true&order=asc`.
  ///
  /// `includeProductCount` trae `productCount` y `activeProductCount`, que son
  /// los números que se pintan en los chips: un filtro que lleva a 0 productos
  /// no debe existir.
  ///
  /// POR QUÉ NO SE MANDA `sort` (ver `core/network/README.md`, "Orden de listados")
  /// `docs/API.md` §7.10 documenta `sort=sortOrder`, pero el backend compara ese
  /// valor contra su allowlist de COLUMNAS (`sort_order`) con `toLowerCase()`, así
  /// que `sortOrder` no casa y responde `400 INVALID_SORT_FIELD`. El orden por
  /// defecto del endpoint ya es `sort_order asc`, que es el que se quiere: se
  /// manda solo `order`, que el backend honra sobre la columna por defecto.
  Future<List<MenuCategoryDto>> categories() async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.categories,
      queryParameters: <String, dynamic>{
        'includeProductCount': true,
        'order': 'asc',
        'pageSize': AppConfigPageSize,
      },
    );
    final List<MenuCategoryDto> result = <MenuCategoryDto>[];
    for (final Map<String, dynamic> row in unwrapList(response.data)) {
      final MenuCategoryDto? dto = MenuCategoryDto.fromJson(row);
      if (dto != null) result.add(dto);
    }
    return result;
  }

  /// `GET /products?fields=basic&isActive=true&order=asc`.
  ///
  /// `fields=basic` es la optimización que el propio `API.md` §7.11 define para la
  /// pantalla de catálogo ("mantiene la respuesta por debajo de 200 KB con 500
  /// productos"). La ficha del producto pide el recurso completo por id, así que
  /// no se pierde nada por no traer aquí `variants`/`addons`.
  ///
  /// Sin `sort` por el mismo motivo que en [categories] (allowlist de columnas en
  /// `snake_case`): el defecto del endpoint es `sort_order asc`.
  Future<List<MenuProductDto>> products({int? categoryId}) async {
    final List<MenuProductDto> result = <MenuProductDto>[];
    int page = 1;
    int total = 0;

    while (page <= maxPages) {
      final Response<dynamic> response = await _dio.get<dynamic>(
        ApiEndpoints.products,
        queryParameters: <String, dynamic>{
          'fields': 'basic',
          'isActive': true,
          'order': 'asc',
          'pageSize': AppConfigPageSize,
          'page': page,
          if (categoryId != null) 'categoryId': categoryId,
        },
      );
      result.addAll(_parseProducts(response.data));

      total = _totalOf(response.data);
      if (result.length >= total || total == 0) break;
      page += 1;
    }
    return result;
  }

  /// `GET /products/:id` — con `variants[]`, `addons[]` e `ingredients[]`.
  Future<MenuProductDto> product(int productId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.productById(productId),
    );
    final MenuProductDto? dto =
        MenuProductDto.fromJson(unwrapData(response.data));
    if (dto == null) {
      throw FormatException(
        'Respuesta inesperada del servidor en ${ApiEndpoints.productById(productId)}.',
      );
    }
    return dto;
  }

  // ----------------------------------------------------------------- Privados
  static List<MenuProductDto> _parseProducts(Object? responseData) {
    final List<MenuProductDto> rows = <MenuProductDto>[];
    for (final Map<String, dynamic> raw in unwrapList(responseData)) {
      final MenuProductDto? dto = MenuProductDto.fromJson(raw);
      if (dto != null) rows.add(dto);
    }
    return rows;
  }

  /// `meta.total` del envoltorio (`API.md` §3.1). `0` si no viene.
  static int _totalOf(Object? responseData) {
    final Map<String, dynamic> body = JsonReader.map(responseData) ??
        const <String, dynamic>{};
    return JsonReader.integerOr(JsonReader.orEmpty(body['meta'])['total'], 0);
  }
}

/// `pageSize` de las lecturas de catálogo. Coincide con el máximo que acepta la
/// API (`AppConfig.maxPageSize`), declarado aquí para que el datasource de la
/// feature no tenga que importar `core/config` solo por una constante.
const int AppConfigPageSize = 100;
