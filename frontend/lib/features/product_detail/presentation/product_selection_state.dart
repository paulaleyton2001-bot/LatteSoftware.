// Estado de la selección en la ficha de producto (variante + extras + cantidad +
// notas). Módulo `features/product_detail/presentation`.
//
// SE SEPARA DEL CONTROLADOR POR UNA RAZÓN CONCRETA
// La clase es la que lee el producto y devuelve el precio unitario, los complementos
// y el total. El controlador solo publica el resultado y construye la línea del
// carrito. Juntas eran un archivo de 280 líneas donde no se distinguía qué es dato y
// qué es acción.
//
// LA SELECCIÓN ES ESTADO LOCAL, NO DE SERVIDOR
// Es la parte de la pantalla donde la persona está decidiendo, y cada cambio tiene
// que verse AL INSTANTE para que el total se mueva. Por eso vive en un provider y
// no en `setState`: el cálculo del total vive en [ProductSelectionState.totalMinor]
// y el pie lo lee, así que si estuviera en el widget habría que duplicarlo o
// pasarlo por parámetro.
//
// EL PRECIO ES UNA PREVISUALIZACIÓN
// `unitPriceMinor` y `totalMinor` sirven para dar feedback inmediato. El precio
// DEFINITIVO lo calcula `POST /orders`, que solo recibe ids y cantidad
// (BR-PRICE-008): la app no puede "corregir" al servidor, y por eso aquí no se
// intenta.



import 'package:flutter/foundation.dart';
import '../../../core/customer/cart_state.dart';
import '../../menu/domain/entities/menu_product.dart';

// ------------------------------------------------------- Selección en curso

/// Estado de la selección del producto (variante + extras + cantidad + notas).
@immutable
class ProductSelectionState {
  const ProductSelectionState({
    this.variantId,
    this.addons = const <int, int>{},
    this.quantity = 1,
    this.notes = '',
  });

  /// Variante elegida. `null` = el producto no tiene variantes.
  final int? variantId;

  /// Complementos elegidos: `{ addonId: unidades }`.
  final Map<int, int> addons;

  final int quantity;
  final String notes;

  /// Variante resuelta dentro del producto, o `null`.
  ProductVariant? variantIn(MenuProduct product) {
    if (product.variants.isEmpty) return null;
    for (final ProductVariant variant in product.variants) {
      if (variant.id == variantId) return variant;
    }
    return product.defaultVariant;
  }

  /// Complementos resueltos, solo los que siguen activos en [product].
  List<CartAddonSelection> addonSelections(MenuProduct product) =>
      <CartAddonSelection>[
        for (final ProductAddon addon in product.activeAddons)
          if ((addons[addon.id] ?? 0) > 0)
            CartAddonSelection(
              addonId: addon.id,
              name: addon.name,
              priceMinor: addon.priceMinor,
              quantity: addons[addon.id]!,
            ),
      ];

  /// PREVISUALIZACIÓN del precio de UNA unidad, en centavos.
  ///
  /// BR-PRICE-001 (el servidor manda): si la variante trae `effectivePriceMinor`
  /// (que el backend ya resolvió) se usa ese; si no, se aplica el
  /// `priceDeltaMinor` sobre el precio vigente del producto. El total DEFINITIVO
  /// lo calcula `POST /orders`.
  int unitPriceMinor(MenuProduct product) {
    final ProductVariant? variant = variantIn(product);
    if (variant == null) return product.currentPriceMinor;
    if (variant.effectivePriceMinor > 0) return variant.effectivePriceMinor;
    return product.currentPriceMinor + variant.priceDeltaMinor;
  }

  /// PREVISUALIZACIÓN del total de la línea, en centavos.
  int totalMinor(MenuProduct product) {
    final int addonsTotal = addonSelections(product).fold<int>(
      0,
      (int acc, CartAddonSelection addon) => acc + addon.totalMinor,
    );
    return (unitPriceMinor(product) + addonsTotal) * quantity;
  }

  /// Nº de complementos elegidos (para el resumen "2 extras").
  int get addonCount => addons.values.fold<int>(0, (int a, int b) => a + b);

  ProductSelectionState copyWith({
    int? variantId,
    bool clearVariant = false,
    Map<int, int>? addons,
    int? quantity,
    String? notes,
  }) =>
      ProductSelectionState(
        variantId: clearVariant ? null : (variantId ?? this.variantId),
        addons: addons ?? this.addons,
        quantity: quantity ?? this.quantity,
        notes: notes ?? this.notes,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ProductSelectionState &&
          other.variantId == variantId &&
          other.quantity == quantity &&
          other.notes == notes &&
          mapEquals(other.addons, addons);

  @override
  int get hashCode => Object.hash(
        variantId,
        quantity,
        notes,
        Object.hashAllUnordered(
          addons.entries.map((MapEntry<int, int> e) => '${e.key}:${e.value}'),
        ),
      );
}
