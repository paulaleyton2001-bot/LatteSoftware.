// DTO del producto del menú. Módulo `features/menu/data`.
//
// UN SOLO PARSER PARA `Product` Y `ProductBasic`
// `GET /products?fields=basic` devuelve un subconjunto de 10 columnas pensado para la
// pantalla de catálogo ("mantiene la respuesta por debajo de 200 KB con 500
// productos", API.md §7.11) y `GET /products/:id` devuelve el recurso completo. Los
// dos comparten todos los campos que la UI necesita y los que solo trae el completo
// (`variants`, `addons`) llegan ausentes en el básico: un parser único con listas
// opcionales cubre ambos sin tener que convertir de un tipo a otro al navegar.
//
// REFLEJA EL JSON, NO EL DOMINIO
//   - los ids se leen con `JsonReader.integer`, que devuelve `null` si no se pueden
//     convertir: un id ilegible hace que se descarte la fila, no que se convierta en
//     0 (un producto con id 0 rompería `POST /orders`);
//   - `stock` es `number` (puede ser `0.5`) y llega como `{ currentStock }` en el
//     detalle: se leen las dos formas y se normalizan a `double?`.

import '../../../../data/models/json_reader.dart';
import '../../domain/entities/menu_product.dart';
import './option_dto.dart';

/// `Product` y `ProductBasic` de `API.md` §6.3 con el mismo parser: los dos
/// comparten todos los campos que la UI necesita, y los que solo trae el
/// completo (`variants`, `addons`) llegan ausentes en el básico.
class MenuProductDto {
  const MenuProductDto({
    required this.id,
    required this.name,
    required this.basePriceMinor,
    this.categoryId,
    this.sku,
    this.slug,
    this.shortDescription,
    this.description,
    this.imageUrl,
    this.promoPriceMinor,
    this.promoStartsAt,
    this.promoEndsAt,
    this.isFeatured = false,
    this.isAvailable = true,
    this.isActive = true,
    this.preparationMinutes = 0,
    this.trackStock = false,
    this.stock,
    this.variants = const <ProductVariantDto>[],
    this.addons = const <ProductAddonDto>[],
  });

  final int id;
  final String name;
  final String? sku;
  final String? slug;
  final int? categoryId;
  final String? shortDescription;
  final String? description;
  final String? imageUrl;
  final int basePriceMinor;
  final int? promoPriceMinor;
  final DateTime? promoStartsAt;
  final DateTime? promoEndsAt;
  final bool isFeatured;
  final bool isAvailable;
  final bool isActive;
  final int preparationMinutes;
  final bool trackStock;
  final double? stock;
  final List<ProductVariantDto> variants;
  final List<ProductAddonDto> addons;

  static MenuProductDto? fromJson(Object? json) {
    // `JsonReader.map` devuelve `null` si no es un objeto; `orEmpty` lo traduce
    // a mapa vacío, que el `isEmpty` de abajo ya convierte en `null`.
    final Map<String, dynamic> map = JsonReader.orEmpty(json);
    if (map.isEmpty) return null;
    final int? id = JsonReader.integer(map['id']);
    final String? name = JsonReader.string(map['name']);
    // `basePriceMinor` es obligatorio: sin él no hay `PriceDisplay` posible y
    // la card rompería el formateo. Se descarta la fila.
    final int? basePrice = JsonReader.integer(map['basePriceMinor']);
    if (id == null || name == null || basePrice == null) return null;

    final List<ProductVariantDto> variants = <ProductVariantDto>[];
    for (final Map<String, dynamic> row in JsonReader.mapList(map['variants'])) {
      final ProductVariantDto? variant = ProductVariantDto.fromJson(row);
      if (variant != null) variants.add(variant);
    }
    final List<ProductAddonDto> addons = <ProductAddonDto>[];
    for (final Map<String, dynamic> row in JsonReader.mapList(map['addons'])) {
      final ProductAddonDto? addon = ProductAddonDto.fromJson(row);
      if (addon != null) addons.add(addon);
    }

    return MenuProductDto(
      id: id,
      name: name,
      sku: JsonReader.string(map['sku']),
      slug: JsonReader.string(map['slug']),
      categoryId: JsonReader.integer(map['categoryId']),
      shortDescription: JsonReader.string(map['shortDescription']),
      description: JsonReader.string(map['description']),
      imageUrl: JsonReader.string(map['imageUrl']),
      basePriceMinor: basePrice,
      promoPriceMinor: JsonReader.integer(map['promoPriceMinor']),
      promoStartsAt: JsonReader.dateTime(map['promoStartsAt']),
      promoEndsAt: JsonReader.dateTime(map['promoEndsAt']),
      isFeatured: JsonReader.boolean(map['isFeatured']),
      isAvailable: JsonReader.boolean(map['isAvailable'], fallback: true),
      isActive: JsonReader.boolean(map['isActive'], fallback: true),
      preparationMinutes: JsonReader.integerOr(map['preparationMinutes'], 0),
      trackStock: JsonReader.boolean(map['trackStock']),
      stock: _readStock(map['stock']),
      variants: List<ProductVariantDto>.unmodifiable(variants),
      addons: List<ProductAddonDto>.unmodifiable(addons),
    );
  }

  MenuProduct toEntity() => MenuProduct(
        id: id,
        name: name,
        sku: sku,
        slug: slug,
        categoryId: categoryId,
        shortDescription: shortDescription,
        description: description,
        imageUrl: imageUrl,
        basePriceMinor: basePriceMinor,
        promoPriceMinor: promoPriceMinor,
        promoStartsAt: promoStartsAt,
        promoEndsAt: promoEndsAt,
        isFeatured: isFeatured,
        isAvailable: isAvailable,
        isActive: isActive,
        preparationMinutes: preparationMinutes,
        trackStock: trackStock,
        stock: stock,
        variants: <ProductVariant>[
          for (final ProductVariantDto variant in variants) variant.toEntity(),
        ],
        addons: <ProductAddon>[
          for (final ProductAddonDto addon in addons) addon.toEntity(),
        ],
      );

  /// `stock` es `number | null` en el listado y `{ currentStock, ... }` en el
  /// detalle. Se leen las dos formas y se normaliza a `double?`.
  static double? _readStock(Object? value) {
    if (value is num) return value.toDouble();
    final Map<String, dynamic>? map = JsonReader.map(value);
    if (map == null) return null;
    final Object? current = map['currentStock'];
    return current is num ? current.toDouble() : null;
  }
}
