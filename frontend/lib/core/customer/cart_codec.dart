// Persistencia del carrito en `PreferencesStorage`.
//
// SEPARADO DE `CartState` A PROPÓSITO: el modelo es dominio puro (inmutable,
// sin `dart:convert`) y la serialización es un detalle de almacenamiento. Si el
// formato en disco cambia, este archivo es el único que se toca.
//
// Es una CACHÉ, no una fuente de verdad: si el JSON está corrupto se descarta y
// el carrito empieza vacío. Perder el carrito es molesto; refuses a arrancar, no.


import 'dart:convert';

import './cart_state.dart';

/// Codec del carrito. Tolera datos incompletos: una línea sin `productId` se
/// ignora en lugar de romper la lectura completa.
abstract final class CartCodec {
  const CartCodec._();

  /// Serializa el carrito a JSON.
  static String encode(CartState state) => jsonEncode(<String, dynamic>{
        'version': 1,
        'couponCode': state.couponCode,
        'lines': <Map<String, dynamic>>[
          for (final CartLine line in state.lines) _encodeLine(line),
        ],
      });

  /// Lee el carrito. Devuelve un carrito vacío si el JSON no es usable.
  static CartState decode(String? raw) {
    if (raw == null || raw.isEmpty) return const CartState.empty();
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return const CartState.empty();
      final List<CartLine> lines = <CartLine>[];
      final Object? rawLines = decoded['lines'];
      if (rawLines is List) {
        for (final Object? entry in rawLines) {
          final CartLine? line = _decodeLine(entry);
          if (line != null) lines.add(line);
        }
      }
      final Object? coupon = decoded['couponCode'];
      return CartState(
        lines: List<CartLine>.unmodifiable(lines),
        couponCode: coupon is String && coupon.isNotEmpty ? coupon : null,
      );
    } on FormatException {
      return const CartState.empty();
    }
  }

  static Map<String, dynamic> _encodeLine(CartLine line) => <String, dynamic>{
        'id': line.id,
        'productId': line.productId,
        'productName': line.productName,
        'productImageUrl': line.productImageUrl,
        'categoryName': line.categoryName,
        'unitPriceMinor': line.unitPriceMinor,
        'variantId': line.variantId,
        'variantName': line.variantName,
        'quantity': line.quantity,
        'notes': line.notes,
        'preparationMinutes': line.preparationMinutes,
        'addons': <Map<String, dynamic>>[
          for (final CartAddonSelection addon in line.addons)
            <String, dynamic>{
              'addonId': addon.addonId,
              'name': addon.name,
              'priceMinor': addon.priceMinor,
              'quantity': addon.quantity,
            },
        ],
      };

  static CartLine? _decodeLine(Object? entry) {
    if (entry is! Map<String, dynamic>) return null;
    final Object? productId = entry['productId'];
    final Object? name = entry['productName'];
    final Object? price = entry['unitPriceMinor'];
    if (productId is! int || name is! String || price is! int) return null;

    final List<CartAddonSelection> addons = <CartAddonSelection>[];
    final Object? rawAddons = entry['addons'];
    if (rawAddons is List) {
      for (final Object? raw in rawAddons) {
        if (raw is! Map<String, dynamic>) continue;
        final Object? addonId = raw['addonId'];
        final Object? addonName = raw['name'];
        final Object? addonPrice = raw['priceMinor'];
        if (addonId is! int || addonName is! String || addonPrice is! int) continue;
        final Object? qty = raw['quantity'];
        addons.add(CartAddonSelection(
          addonId: addonId,
          name: addonName,
          priceMinor: addonPrice,
          quantity: qty is int && qty > 0 ? qty : 1,
        ));
      }
    }

    final Object? id = entry['id'];
    final Object? quantity = entry['quantity'];
    final Object? variantId = entry['variantId'];
    final Object? imageUrl = entry['productImageUrl'];
    final Object? categoryName = entry['categoryName'];
    final Object? variantName = entry['variantName'];
    final Object? notes = entry['notes'];
    final Object? prep = entry['preparationMinutes'];

    return CartLine(
      id: id is String && id.isNotEmpty ? id : 'restored-$productId',
      productId: productId,
      productName: name,
      unitPriceMinor: price,
      productImageUrl: imageUrl is String && imageUrl.isNotEmpty ? imageUrl : null,
      categoryName: categoryName is String && categoryName.isNotEmpty ? categoryName : null,
      variantId: variantId is int ? variantId : null,
      variantName: variantName is String ? variantName : '',
      addons: List<CartAddonSelection>.unmodifiable(addons),
      quantity: quantity is int && quantity > 0 ? quantity : 1,
      notes: notes is String ? notes : '',
      preparationMinutes: prep is int && prep > 0 ? prep : 0,
    );
  }
}
