// DTOs de variantes y complementos del producto. Módulo `features/menu/data`.
//
// Van en su propio archivo porque son las DOS MITADES de la personalización y porque
// `ProductDto` (con la lista de productos y su caché) ya era el archivo más grande
// del módulo. Un `product_addons` no tiene nada que ver con el formato de un
// `product_variants` salvo que ambos sean personalizaciones.
//
// REFLEJAN EL JSON, NO EL DOMINIO
//   - `isMultiple` llega como `boolean` (API.md §1) aunque el esquema lo declare
//     `0 | 1`: `JsonReader.boolean` acepta ambos.
//   - `priceDeltaMinor` puede ser NEGATIVO: el backend lo admite y una reducción
//     tiene que leerse como reducción, no como un precio sin signo.
//
// `fromJson` ESCRITOS A MANO: ver `data/models/json_reader.dart`.

import '../../../../data/models/json_reader.dart';
import '../../domain/entities/menu_product.dart';

/// `product_variants` (`GET /products/:id` y `GET /products/:id/variants`).
class ProductVariantDto {
  const ProductVariantDto({
    required this.id,
    required this.name,
    this.code,
    this.priceDeltaMinor = 0,
    this.priceMinor,
    this.effectivePriceMinor = 0,
    this.isDefault = false,
    this.isActive = true,
  });

  final int id;
  final String name;
  final String? code;
  final int priceDeltaMinor;
  final int? priceMinor;
  final int effectivePriceMinor;
  final bool isDefault;
  final bool isActive;

  static ProductVariantDto? fromJson(Object? json) {
    // `JsonReader.map` devuelve `null` si no es un objeto; `orEmpty` lo traduce
    // a mapa vacío, que el `isEmpty` de abajo ya convierte en `null`.
    final Map<String, dynamic> map = JsonReader.orEmpty(json);
    if (map.isEmpty) return null;
    final int? id = JsonReader.integer(map['id']);
    final String? name = JsonReader.string(map['name']);
    if (id == null || name == null) return null;

    return ProductVariantDto(
      id: id,
      name: name,
      code: JsonReader.string(map['code']),
      priceDeltaMinor: JsonReader.integerOr(map['priceDeltaMinor'], 0),
      priceMinor: JsonReader.integer(map['priceMinor']),
      effectivePriceMinor: JsonReader.integerOr(map['effectivePriceMinor'], 0),
      isDefault: JsonReader.boolean(map['isDefault']),
      isActive: JsonReader.boolean(map['isActive'], fallback: true),
    );
  }

  ProductVariant toEntity() => ProductVariant(
        id: id,
        name: name,
        code: code,
        priceDeltaMinor: priceDeltaMinor,
        priceMinor: priceMinor,
        effectivePriceMinor: effectivePriceMinor,
        isDefault: isDefault,
        isActive: isActive,
      );
}

/// `product_addons` (`GET /products/:id` y `GET /products/:id/addons`).
class ProductAddonDto {
  const ProductAddonDto({
    required this.id,
    required this.name,
    this.code,
    this.priceMinor = 0,
    this.isMultiple = false,
    this.maxSelect,
    this.isActive = true,
  });

  final int id;
  final String name;
  final String? code;
  final int priceMinor;
  final bool isMultiple;
  final int? maxSelect;
  final bool isActive;

  static ProductAddonDto? fromJson(Object? json) {
    // `JsonReader.map` devuelve `null` si no es un objeto; `orEmpty` lo traduce
    // a mapa vacío, que el `isEmpty` de abajo ya convierte en `null`.
    final Map<String, dynamic> map = JsonReader.orEmpty(json);
    if (map.isEmpty) return null;
    final int? id = JsonReader.integer(map['id']);
    final String? name = JsonReader.string(map['name']);
    if (id == null || name == null) return null;

    return ProductAddonDto(
      id: id,
      name: name,
      code: JsonReader.string(map['code']),
      priceMinor: JsonReader.integerOr(map['priceMinor'], 0),
      isMultiple: JsonReader.boolean(map['isMultiple']),
      maxSelect: JsonReader.integer(map['maxSelect']),
      isActive: JsonReader.boolean(map['isActive'], fallback: true),
    );
  }

  ProductAddon toEntity() => ProductAddon(
        id: id,
        name: name,
        code: code,
        priceMinor: priceMinor,
        isMultiple: isMultiple,
        maxSelect: maxSelect,
        isActive: isActive,
      );
}
