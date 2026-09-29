// Producto del menú. Tres niveles de detalle, un solo tipo.

import 'package:flutter/foundation.dart';
//
// `GET /products?fields=basic` devuelve el subconjunto `ProductBasic` (API.md
// §6.3) que usa la REJILLA, y `GET /products/:id` devuelve el `Product` completo
// con `variants[]` y `addons[]` que usa la FICHA. Duplicar la entidad para la
// rejilla obligaría a convertir de un tipo a otro al navegar; con un tipo único
// y listas opcionales, la rejilla simply deja las listas vacías.
//
// El precio se resuelve AQUÍ, una sola vez, con la misma regla que documenta el
// backend (BR-PRICE-001): si hay promoción vigente gana `promoPriceMinor`, si no
// `basePriceMinor`. La aplicación final (con variante, complementos e impuestos)
// la hace el servidor.


/// Variante de tamaño/presentación de un producto (`product_variants`).
@immutable
class ProductVariant {
  const ProductVariant({
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

  /// Incremento sobre el precio base. Puede ser NEGATIVO (el backend lo admite).
  final int priceDeltaMinor;

  /// Precio absoluto de la variante, si el negocio lo fijó explícitamente.
  final int? priceMinor;

  /// Precio YA resuelto que devuelve el backend en `GET /products/:id/variants`
  /// ("para que el cliente no lo calcule", API.md §7.11). Cuando viene, es la
  /// autoridad; si no, la ficha usa [priceDeltaMinor] como aproximación.
  final int effectivePriceMinor;

  final bool isDefault;
  final bool isActive;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ProductVariant && other.id == id && other.name == name;

  @override
  int get hashCode => Object.hash(id, name);

  @override
  String toString() => 'ProductVariant($id, $name)';
}

/// Complemento de un producto (`product_addons`).
@immutable
class ProductAddon {
  const ProductAddon({
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

  /// Precio unitario en centavos.
  final int priceMinor;

  /// `true` = se puede pedir más de una unidad (hasta [maxSelect]).
  /// `false` = casilla simple (0 o 1), que es el caso habitual.
  final bool isMultiple;

  /// Tope de unidades cuando [isMultiple] es `true`. `null` = sin tope.
  final int? maxSelect;

  final bool isActive;

  /// Tope efectivo de unidades que la UI permite seleccionar.
  int get selectableMax => maxSelect == null
      ? kAddonHardMax
      : (maxSelect! < 1 ? 1 : (maxSelect! > kAddonHardMax ? kAddonHardMax : maxSelect!));

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ProductAddon && other.id == id && other.name == name;

  @override
  int get hashCode => Object.hash(id, name);

  @override
  String toString() => 'ProductAddon($id, $name)';
}

/// Tope duro de unidades por complemento. `API.md` §7.11 limita `quantity` de
/// `order_item_addons` a 20; el backend devuelve `422 ADDON_SELECTION_LIMIT` si
/// se supera `maxSelect`, y este valor evita llegar ahí desde la UI.
const int kAddonHardMax = 20;

/// Producto del menú.
@immutable
class MenuProduct {
  const MenuProduct({
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
    this.variants = const <ProductVariant>[],
    this.addons = const <ProductAddon>[],
  });

  final int id;
  final String name;
  final String? sku;
  final String? slug;
  final int? categoryId;

  final String? shortDescription;
  final String? description;
  final String? imageUrl;

  /// Precio base en centavos (`basePriceMinor`).
  final int basePriceMinor;

  /// Precio promocional en centavos, si hay.
  final int? promoPriceMinor;

  final DateTime? promoStartsAt;
  final DateTime? promoEndsAt;

  final bool isFeatured;
  final bool isAvailable;
  final bool isActive;
  final int preparationMinutes;
  final bool trackStock;

  /// Stock actual (`null` si el producto no lleva control de stock).
  final double? stock;

  final List<ProductVariant> variants;
  final List<ProductAddon> addons;

  // ------------------------------------------------------------- Presentación

  /// Descripción corta para la card. Si no hay `shortDescription`, se recorta el
  /// `description`; si tampoco, la ficha muestra solo el nombre.
  String get cardSubtitle {
    final String short = (shortDescription ?? '').trim();
    if (short.isNotEmpty) return short;
    final String long = (description ?? '').trim();
    if (long.isEmpty) return '';
    return long.length <= 90 ? long : '${long.substring(0, 89)}…';
  }

  /// Precio vigente en centavos (promo si la hay, base si no).
  int get currentPriceMinor => promoPriceMinor ?? basePriceMinor;

  /// Precio original para el tachado, o `null` si no hay promoción.
  int? get originalPriceMinor => promoPriceMinor == null ? null : basePriceMinor;

  /// `true` si hay promoción activa AHORA (dentro de la ventana del backend).
  bool get hasActivePromo {
    if (promoPriceMinor == null) return false;
    final DateTime now = DateTime.now().toUtc();
    if (promoStartsAt != null && now.isBefore(promoStartsAt!)) return false;
    if (promoEndsAt != null && now.isAfter(promoEndsAt!)) return false;
    return true;
  }

  /// Variante por defecto, o la primera activa. `null` si el producto no tiene
  /// variantes (el caso normal de una bebida).
  ProductVariant? get defaultVariant {
    if (variants.isEmpty) return null;
    for (final ProductVariant variant in variants) {
      if (variant.isActive && variant.isDefault) return variant;
    }
    for (final ProductVariant variant in variants) {
      if (variant.isActive) return variant;
    }
    return null;
  }

  /// Complementos seleccionables (los inactivos no se ofrecen).
  List<ProductAddon> get activeAddons =>
      addons.where((ProductAddon addon) => addon.isActive).toList(growable: false);

  /// Búsqueda local del buscador del menú: nombre, SKU, descripción y
  /// categoría. Acepta acentos (`café` encuentra `cafe`) porque el usuario
  /// escribe sin tildes medio siempre.
  bool matches(String query) {
    final String needle = _normalize(query);
    if (needle.isEmpty) return true;
    if (_normalize(name).contains(needle)) return true;
    if (sku != null && _normalize(sku!).contains(needle)) return true;
    if (shortDescription != null &&
        _normalize(shortDescription!).contains(needle)) {
      return true;
    }
    if (description != null && _normalize(description!).contains(needle)) {
      return true;
    }
    return false;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MenuProduct &&
          other.id == id &&
          other.basePriceMinor == basePriceMinor &&
          other.promoPriceMinor == promoPriceMinor &&
          other.isAvailable == isAvailable;

  @override
  int get hashCode =>
      Object.hash(id, basePriceMinor, promoPriceMinor, isAvailable);

  @override
  String toString() => 'MenuProduct($id, $name)';
}

/// Quita tildes y pasa a minúsculas para que el buscador no dependa de acentos.
String _normalize(String value) {
  const Map<String, String> accents = <String, String>{
    'á': 'a',
    'é': 'e',
    'í': 'i',
    'ó': 'o',
    'ú': 'u',
    'ü': 'u',
    'ñ': 'n',
    'Á': 'a',
    'É': 'e',
    'Í': 'i',
    'Ó': 'o',
    'Ú': 'u',
    'Ü': 'u',
    'Ñ': 'n',
  };
  final StringBuffer buffer = StringBuffer();
  for (final int rune in value.runes) {
    final String char = String.fromCharCode(rune).toLowerCase();
    buffer.write(accents[char] ?? char);
  }
  return buffer.toString();
}
