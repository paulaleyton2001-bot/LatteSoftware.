// Modelo del carrito del cliente. VIVE EN `core/` Y NO EN `features/cart/` POR

import 'package:flutter/foundation.dart';
// UNA RAZÓN CONCRETA: lo consumen el menú, la ficha de producto, el checkout y el
// badge de navegación, y las features no se importan entre sí.
//
// `core/` no conoce el dominio de un producto (no hay `Product` aquí: solo ids,
// nombres y precios ya resueltos), pero sí conoce la regla de dinero del
// proyecto: todo el dinero es `int` en centavos y solo se formatea en
// `core/utils/currency_formatter.dart`.
//
// INMUTABILIDAD: cada operación devuelve un `CartState` nuevo. El store de este
// mismo módulo es el único que publica, y avisa con `ChangeNotifier` para que el
// badge de navegación se entere.
//
// BR-PRICE-008: `estimatedSubtotalMinor` es una PREVISUALIZACIÓN para dar
// feedback inmediato. El único total válido es el que devuelve el servidor tras
// `POST /orders`; la UI reemplaza sus cifras por las del servidor sin
// transformarlas.


/// Un complemento (extra) elegido dentro de una línea del carrito.
///
/// `POST /orders` solo manda `{ productAddonId, quantity }` (API.md §7.12), pero
/// el carrito guarda también el nombre y el precio para poder pintar la línea sin
/// volver a la red: son un snapshot, igual que hacen los `order_items` del
/// servidor.
@immutable
class CartAddonSelection {
  const CartAddonSelection({
    required this.addonId,
    required this.name,
    required this.priceMinor,
    this.quantity = 1,
  });

  /// `product_addons.id` (API.md §7.11). Es lo que se envía como
  /// `productAddonId`.
  final int addonId;

  /// Nombre congelado en el momento de añadirlo.
  final String name;

  /// Precio unitario en centavos del complemento.
  final int priceMinor;

  /// Cantidad (1..20, el máximo que acepta la API).
  final int quantity;

  /// Total de la línea del complemento: `priceMinor * quantity`.
  int get totalMinor => priceMinor * quantity;

  CartAddonSelection copyWith({int? quantity}) => CartAddonSelection(
        addonId: addonId,
        name: name,
        priceMinor: priceMinor,
        quantity: quantity ?? this.quantity,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CartAddonSelection &&
          other.addonId == addonId &&
          other.name == name &&
          other.priceMinor == priceMinor &&
          other.quantity == quantity;

  @override
  int get hashCode => Object.hash(addonId, name, priceMinor, quantity);

  @override
  String toString() => 'CartAddonSelection($name x$quantity)';
}

/// Una línea del carrito: producto + variante + complementos + notas.
@immutable
class CartLine {
  const CartLine({
    required this.id,
    required this.productId,
    required this.productName,
    required this.unitPriceMinor,
    this.productImageUrl,
    this.categoryName,
    this.variantId,
    this.variantName = '',
    this.addons = const <CartAddonSelection>[],
    this.quantity = 1,
    this.notes = '',
    this.preparationMinutes = 0,
  });

  /// Identificador LOCAL de la línea. No es un id del servidor: `POST /orders`
  /// no lleva ids de línea, solo `productId`/`variantId`/`addons`/cantidad.
  /// Sirve para editar y borrar una línea concreta del carrito.
  final String id;

  final int productId;
  final String productName;
  final String? productImageUrl;
  final String? categoryName;

  /// Precio unitario ya resuelto con la promoción vigente (`promoPriceMinor` si
  /// existe, si no `basePriceMinor`), en centavos.
  final int unitPriceMinor;

  final int? variantId;
  final String variantName;

  final List<CartAddonSelection> addons;

  /// Cantidad pedida. El máximo lo fija el backend por producto; aquí solo se
  /// limita a un rango usable.
  final int quantity;

  /// Instrucciones de preparación (máx. 300 en la API).
  final String notes;

  /// Minutos de preparación estimados, para el resumen del pedido.
  final int preparationMinutes;

  /// Subtotal de los complementos de esta línea (por unidad).
  int get addonsMinorMinor => addons.fold<int>(
        0,
        (int acc, CartAddonSelection item) => acc + item.totalMinor,
      );

  /// Precio de una unidad con sus complementos.
  int get unitTotalMinor => unitPriceMinor + addonsMinorMinor;

  /// Total de la línea: `unitTotalMinor * quantity`.
  int get lineTotalMinor => unitTotalMinor * quantity;

  /// `true` si hay algo que la haga única: misma variante, mismos complementos
  /// y mismas notas → se suman cantidades en vez de crear otra línea.
  String get mergeKey => <Object?>[
        productId,
        variantId,
        notes,
        ...addons.map((CartAddonSelection item) => '${item.addonId}x${item.quantity}'),
      ].join('|');

  CartLine copyWith({
    int? quantity,
    String? notes,
    List<CartAddonSelection>? addons,
  }) =>
      CartLine(
        id: id,
        productId: productId,
        productName: productName,
        unitPriceMinor: unitPriceMinor,
        productImageUrl: productImageUrl,
        categoryName: categoryName,
        variantId: variantId,
        variantName: variantName,
        addons: addons ?? this.addons,
        quantity: quantity ?? this.quantity,
        notes: notes ?? this.notes,
        preparationMinutes: preparationMinutes,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CartLine &&
          other.id == id &&
          other.productId == productId &&
          other.variantId == variantId &&
          other.unitPriceMinor == unitPriceMinor &&
          other.quantity == quantity &&
          other.notes == notes &&
          listEquals(other.addons, addons);

  @override
  int get hashCode => Object.hash(
        id,
        productId,
        variantId,
        unitPriceMinor,
        quantity,
        notes,
        Object.hashAll(addons),
      );

  @override
  String toString() => 'CartLine($productName x$quantity)';
}

/// Estado completo del carrito. Inmutable; solo `CartStore` publica cambios
/// (el store no se importa aquí: sería un ciclo).
@immutable
class CartState {
  const CartState({this.lines = const <CartLine>[], this.couponCode});

  /// Carrito vacío.
  const CartState.empty() : lines = const <CartLine>[], couponCode = null;

  final List<CartLine> lines;

  /// Cupón escrito por el cliente. Todavía NO está validado: el descuento real
  /// lo aplica el servidor en `POST /orders` (BR-DISC-001).
  final String? couponCode;

  /// Número total de artículos (`Suma de cantidades`). Es el número del badge.
  int get totalQuantity => lines.fold<int>(0, (int acc, CartLine l) => acc + l.quantity);

  /// Número de líneas distintas del carrito.
  int get lineCount => lines.length;

  bool get isEmpty => lines.isEmpty;

  bool get isNotEmpty => lines.isNotEmpty;

  /// PREVISUALIZACIÓN del subtotal en centavos (sin impuestos: el servidor los
  /// calcula con la tasa del negocio, que el cliente no conoce).
  int get estimatedSubtotalMinor => lines.fold<int>(
        0,
        (int acc, CartLine l) => acc + l.lineTotalMinor,
      );

  /// Minutos de preparación estimados de todo el pedido.
  int get estimatedPreparationMinutes => lines.fold<int>(
        0,
        (int acc, CartLine l) => acc + l.preparationMinutes * l.quantity,
      );

  /// Resumen de una línea para lectores de pantalla.
  String describeLine(CartLine line) {
    final String variant = line.variantName.isEmpty ? '' : ', ${line.variantName}';
    return '${line.productName}$variant, ${line.quantity} unidades';
  }

  CartState copyWith({
    List<CartLine>? lines,
    String? couponCode,
    bool clearCoupon = false,
  }) =>
      CartState(
        lines: lines ?? this.lines,
        couponCode: clearCoupon ? null : (couponCode ?? this.couponCode),
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CartState &&
          listEquals(other.lines, lines) &&
          other.couponCode == couponCode;

  @override
  int get hashCode => Object.hash(Object.hashAll(lines), couponCode);

  @override
  String toString() => 'CartState(${lines.length} líneas, $totalQuantity artículos)';
}

/// Límite de cantidad por línea. Es una COMODIDAD de UI (evita pulsar 200 veces);
/// el stock y los topes reales los valida el backend (`422 PRODUCT_UNAVAILABLE`,
/// `NEGATIVE_STOCK_BLOCKED`).
const int kCartMaxLineQuantity = 99;
