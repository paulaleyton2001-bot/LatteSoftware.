// Catálogo del mostrador: proyección de producto para la rejilla del POS.
//
// POR QUÉ NO SE REUSA `MenuProduct`
// `MenuProduct` viene de `GET /menu`, que es la carta PÚBLICA del cliente: trae
// descripción larga, etiquetas y datos pensados para vender. El mostrador necesita
// otra cosa: meterse rápido, ver el precio grande, y saber si se puede vender AHORA
// (disponibilidad comercial) y si lleva control de stock. Eso es `ProductBasic`
// (`GET /products?fields=basic`, API.md §7.11), que existe precisamente para el POS
// y baja la respuesta por debajo de 200 KB con 500 productos.
//
// El dinero llega en CENTAVOS (`basePriceMinor`) y no se toca aquí: se formatea
// con `PriceDisplay`, que es el único widget autorizado a pintar dinero.

import 'package:flutter/foundation.dart';

/// Producto del catálogo del mostrador (`ProductBasic` de `docs/API.md` §6.3).
@immutable
class PosCatalogItem {
  const PosCatalogItem({
    required this.id,
    required this.sku,
    required this.name,
    required this.basePriceMinor,
    this.promoPriceMinor,
    this.imageUrl,
    this.isAvailable = true,
    this.isFeatured = false,
    this.preparationMinutes = 5,
    this.categoryId,
  });

  final int id;
  final String sku;
  final String name;
  final String? imageUrl;
  final int? categoryId;

  /// Precio base en centavos. Nunca `double` (docs/DESIGN-TOKENS §9.1).
  final int basePriceMinor;

  /// Precio promocional en centavos, o `null` si no hay promoción vigente.
  final int? promoPriceMinor;

  /// `false` = agotado o fuera de temporada. Se puede reactivar con
  /// `PATCH /products/:id/availability`; no es lo mismo que `isActive`
  /// (BR-PRICE-006), que este endpoint no trae.
  final bool isAvailable;

  final bool isFeatured;
  final int preparationMinutes;

  /// Precio vigente ya resuelto (BR-PRICE-001).
  int get effectivePriceMinor => promoPriceMinor ?? basePriceMinor;

  /// `true` si hay precio original que tachar.
  bool get hasPromo => promoPriceMinor != null && promoPriceMinor! < basePriceMinor;

  /// `true` si el cajero puede venderlo ahora mismo.
  bool get isSellable => isAvailable;

  /// Texto que busca el buscador del mostrador: nombre + SKU (API.md §5.3 dice
  /// que `q` busca por nombre, SKU y descripción corta).
  String get searchHaystack => '$name $sku'.toLowerCase();

  /// Parseo tolerante de una fila de `GET /products?fields=basic`.
  ///
  /// Devuelve `null` si no trae `id`: sin id no se puede añadir al pedido, y
  /// una celda vacía en el catálogo es mejor que un error al cobrar.
  static PosCatalogItem? tryParse(Map<String, dynamic> json) {
    // El id se NORMALIZA con [_toInt] en vez de usar `rawId.toInt()` sobre un
    // `Object?`: tras el `is! num` el analizador no estrecha el tipo, así que
    // `.toInt()` no se puede invocar sin comprobar. Un id de doble se trunca a
    // entero una sola vez, no dos.
    final int? id = _toInt(json['id']);
    if (id == null) return null;
    final Object? rawName = json['name'];
    if (rawName is! String || rawName.trim().isEmpty) return null;
    final int? base = _toInt(json['basePriceMinor']);
    if (base == null) return null;
    return PosCatalogItem(
      id: id,
      sku: json['sku'] is String ? json['sku']! as String : 'SKU-$id',
      name: rawName,
      imageUrl: json['imageUrl'] is String ? json['imageUrl']! as String : null,
      categoryId: _toInt(json['categoryId']),
      basePriceMinor: base,
      promoPriceMinor: _toInt(json['promoPriceMinor']),
      isAvailable: json['isAvailable'] is bool ? json['isAvailable']! as bool : true,
      isFeatured: json['isFeatured'] is bool ? json['isFeatured']! as bool : false,
      preparationMinutes: _toInt(json['preparationMinutes']) ?? 5,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PosCatalogItem &&
          other.id == id &&
          other.name == name &&
          other.basePriceMinor == basePriceMinor &&
          other.promoPriceMinor == promoPriceMinor &&
          other.isAvailable == isAvailable;

  @override
  int get hashCode =>
      Object.hash(id, name, basePriceMinor, promoPriceMinor, isAvailable);

  @override
  String toString() => 'PosCatalogItem($id, $name)';
}

int? _toInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  return null;
}
