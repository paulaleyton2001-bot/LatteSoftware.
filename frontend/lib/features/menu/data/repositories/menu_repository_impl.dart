// Implementación de `MenuRepository`.
//
// REGLA DE ORO: ningún método lanza. Todo va en `Result<T>`: `DioException` →
// `ErrorMapper` (vía `ApiException`), `FormatException` (2xx inservible) →
// `UnknownFailure`.
//
// LA CACHÉ OFFLINE
// ---------------
// Un fallo de red NO es un carrito vacío: la cafetería y el cliente siguen
// abiertos aunque el backend no responda. Por eso, cuando la lectura falla, se
// devuelve el catálogo cacheado de la última ejecución correcta. La UI recibe
// `Success` con datos viejos y puede avisar "mostrando el menú guardado" — es
// justo el requisito de "arquitectura offline": la app abre con el último menú
// conocido.
//
// La escritura en caché NUNCA propaga un fallo: si el disco no responde, la
// sesión actual sigue en memoria.

import 'dart:convert';

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../../../core/storage/preferences_storage.dart';
import '../../domain/entities/menu_category.dart';
import '../../domain/entities/menu_product.dart';
import '../../domain/repositories/menu_repository.dart';
import '../datasources/remote/menu_remote_datasource.dart';
import '../models/category_dto.dart';
import '../models/product_dto.dart';

/// Repositorio del catálogo con caché local para arranque sin red.
class MenuRepositoryImpl implements MenuRepository {
  const MenuRepositoryImpl(this._remote, this._preferences);

  final MenuRemoteDataSource _remote;
  final PreferencesStorage _preferences;

  // -------------------------------------------------------------- Categorías
  @override
  Future<Result<List<MenuCategory>>> categories() async {
    try {
      final List<MenuCategoryDto> rows = await _remote.categories();
      final List<MenuCategory> list = <MenuCategory>[
        for (final MenuCategoryDto dto in rows) dto.toEntity(),
      ]..sort((MenuCategory a, MenuCategory b) => a.sortOrder.compareTo(b.sortOrder));
      await _writeCache('categories', jsonEncode(<Map<String, dynamic>>[
        for (final MenuCategory item in list) _categoryToJson(item),
      ]));
      return Success<List<MenuCategory>>(list);
    } on Object catch (error) {
      final List<MenuCategory> cached = _readCategoryCache();
      if (cached.isNotEmpty) return Success<List<MenuCategory>>(cached);
      return FailureResult<List<MenuCategory>>(ApiException.toFailure(error));
    }
  }

  // --------------------------------------------------------------- Productos
  @override
  Future<Result<MenuCatalog>> products() async {
    try {
      final List<MenuProductDto> rows = await _remote.products();
      final List<MenuProduct> list = <MenuProduct>[
        for (final MenuProductDto dto in rows)
          if (dto.isActive) dto.toEntity(),
      ];
      await _writeCache(
        'products',
        jsonEncode(<Map<String, dynamic>>[
          for (final MenuProduct item in list) _productToJson(item),
        ]),
      );
      return Success<MenuCatalog>(MenuCatalog(items: list));
    } on Object catch (error) {
      final List<MenuProduct> cached = _readProductCache();
      if (cached.isNotEmpty) {
        return Success<MenuCatalog>(MenuCatalog(items: cached, isStale: true));
      }
      return FailureResult<MenuCatalog>(ApiException.toFailure(error));
    }
  }

  @override
  Future<Result<MenuProduct>> product(int productId) async {
    try {
      final MenuProductDto dto = await _remote.product(productId);
      return Success<MenuProduct>(dto.toEntity());
    } on Object catch (error) {
      return FailureResult<MenuProduct>(ApiException.toFailure(error));
    }
  }

  // ------------------------------------------------------------------ Caché
  Future<void> _writeCache(String bucket, String payload) async {
    try {
      await _preferences.setString(_key(bucket), payload);
    } on Object {
      // Caché es caché: si no se puede escribir, la app sigue funcionando.
    }
  }

  String? _readRaw(String bucket) {
    try {
      return _preferences.getString(_key(bucket));
    } on Object {
      return null;
    }
  }

  List<MenuCategory> _readCategoryCache() {
    final String? raw = _readRaw('categories');
    if (raw == null || raw.isEmpty) return const <MenuCategory>[];
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! List) return const <MenuCategory>[];
      final List<MenuCategory> result = <MenuCategory>[];
      for (final Object? entry in decoded) {
        if (entry is! Map<String, dynamic>) continue;
        final MenuCategory? item = _categoryFromJson(entry);
        if (item != null) result.add(item);
      }
      return result;
    } on FormatException {
      return const <MenuCategory>[];
    }
  }

  List<MenuProduct> _readProductCache() {
    final String? raw = _readRaw('products');
    if (raw == null || raw.isEmpty) return const <MenuProduct>[];
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! List) return const <MenuProduct>[];
      final List<MenuProduct> result = <MenuProduct>[];
      for (final Object? entry in decoded) {
        if (entry is! Map<String, dynamic>) continue;
        final MenuProduct? item = _productFromJson(entry);
        if (item != null) result.add(item);
      }
      return result;
    } on FormatException {
      return const <MenuProduct>[];
    }
  }

  static String _key(String bucket) => 'lc.menu.cache.$bucket';

  // ------------------------------------------------------ (De)serialización
  // El formato en disco es una lista plana de campos planos: no vale la pena
  // reutilizar los DTO de red (que traen `ingredients`, `priceHistory` y otros
  // campos que la rejilla no usa) ni escrever un `fromJson` por entidad de
  // dominio. Lo que se necesita para pintar la rejilla cabe en estas dos tablas.
  static Map<String, dynamic> _categoryToJson(MenuCategory item) =>
      <String, dynamic>{
        'id': item.id,
        'name': item.name,
        'slug': item.slug,
        'icon': item.icon,
        'sortOrder': item.sortOrder,
        'isActive': item.isActive,
        'productCount': item.productCount,
        'activeProductCount': item.activeProductCount,
      };

  static MenuCategory? _categoryFromJson(Map<String, dynamic> json) {
    final Object? id = json['id'];
    final Object? name = json['name'];
    if (id is! int || name is! String) return null;
    final Object? sortOrder = json['sortOrder'];
    final Object? isActive = json['isActive'];
    final Object? count = json['productCount'];
    final Object? activeCount = json['activeProductCount'];
    final Object? slug = json['slug'];
    final Object? icon = json['icon'];
    return MenuCategory(
      id: id,
      name: name,
      slug: slug is String ? slug : null,
      icon: icon is String ? icon : null,
      sortOrder: sortOrder is int ? sortOrder : 0,
      isActive: isActive is bool ? isActive : true,
      productCount: count is int ? count : 0,
      activeProductCount: activeCount is int ? activeCount : 0,
    );
  }

  static Map<String, dynamic> _productToJson(MenuProduct item) =>
      <String, dynamic>{
        'id': item.id,
        'name': item.name,
        'sku': item.sku,
        'slug': item.slug,
        'categoryId': item.categoryId,
        'shortDescription': item.shortDescription,
        'imageUrl': item.imageUrl,
        'basePriceMinor': item.basePriceMinor,
        'promoPriceMinor': item.promoPriceMinor,
        'isFeatured': item.isFeatured,
        'isAvailable': item.isAvailable,
        'preparationMinutes': item.preparationMinutes,
      };

  static MenuProduct? _productFromJson(Map<String, dynamic> json) {
    final Object? id = json['id'];
    final Object? name = json['name'];
    final Object? base = json['basePriceMinor'];
    if (id is! int || name is! String || base is! int) return null;
    final Object? categoryId = json['categoryId'];
    final Object? sku = json['sku'];
    final Object? slug = json['slug'];
    final Object? short = json['shortDescription'];
    final Object? image = json['imageUrl'];
    final Object? promo = json['promoPriceMinor'];
    final Object? featured = json['isFeatured'];
    final Object? available = json['isAvailable'];
    final Object? prep = json['preparationMinutes'];
    return MenuProduct(
      id: id,
      name: name,
      sku: sku is String ? sku : null,
      slug: slug is String ? slug : null,
      categoryId: categoryId is int ? categoryId : null,
      shortDescription: short is String ? short : null,
      imageUrl: image is String ? image : null,
      basePriceMinor: base,
      promoPriceMinor: promo is int ? promo : null,
      isFeatured: featured is bool ? featured : false,
      isAvailable: available is bool ? available : true,
      preparationMinutes: prep is int ? prep : 0,
    );
  }
}
