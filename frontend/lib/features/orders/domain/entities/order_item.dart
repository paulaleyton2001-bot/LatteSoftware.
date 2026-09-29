// Línea de pedido. Módulo `features/orders/domain/entities`.
//
// SEPARADA DE `OrderSummary` POR LA MISMA RAZÓN QUE `Rental`
// El detalle del pedido la usa; el listado no. Un archivo por entidad hace que la
// dependencia sea explícita.
//
// LOS DATOS SON SNAPSHOTS, SIEMPRE
// `nameSnapshot`, `unitPriceMinor` y `lineTotalMinor` son lo que el servidor guardó
// al crear el pedido (BR-PRICE-004). Se pinta ese snapshot, NUNCA el catálogo
// actual: si el producto se renombró o se borró, el comprobante tiene que seguir
// diciendo lo que se pidió, y su precio no puede cambiar porque el negocio haya
// subido la tarifa.


import 'package:flutter/foundation.dart';
import './json_readers.dart';

/// Complemento de una línea de pedido (`order_item_addons`).
@immutable
class OrderItemAddon {
  const OrderItemAddon({
    required this.name,
    required this.priceMinor,
    this.quantity = 1,
  });

  final String name;
  final int priceMinor;
  final int quantity;

  int get totalMinor => priceMinor * quantity;

  factory OrderItemAddon.fromJson(Map<String, dynamic> json) => OrderItemAddon(
        name: readString(json['name']) ?? 'Extra',
        priceMinor: readInt(json['priceMinor']) ?? 0,
        quantity: readInt(json['quantity']) ?? 1,
      );
}

/// Línea de pedido (`OrderItem`, API.md §6.3).
@immutable
class OrderItem {
  const OrderItem({
    required this.id,
    required this.name,
    required this.quantity,
    required this.unitPriceMinor,
    this.variantName,
    this.lineTotalMinor = 0,
    this.discountMinor = 0,
    this.taxMinor = 0,
    this.notes,
    this.status = 'PENDING',
    this.addons = const <OrderItemAddon>[],
  });

  final int id;

  /// `nameSnapshot` congelado en el momento del pedido.
  final String name;

  final String? variantName;

  /// Cantidad pedida. `double` en la API (admite pesajes) pero la ficha la muestra
  /// como número entero cuando es entera, que es el 99 % de los casos.
  final double quantity;

  final int unitPriceMinor;
  final int lineTotalMinor;
  final int discountMinor;
  final int taxMinor;

  /// Instrucciones de preparación que dejó la persona.
  final String? notes;

  /// `OrderItemStatus`: `PENDING`, `READY` o `CANCELLED`.
  final String status;

  final List<OrderItemAddon> addons;

  /// Nombre con su variante, para la línea de la ficha.
  String get displayName => variantName == null ? name : '$name · $variantName';

  /// Cantidad como texto: `2` en vez de `2.0`.
  String get quantityLabel {
    final int whole = quantity.round();
    return quantity == whole.toDouble() ? '$whole' : '$quantity';
  }

  factory OrderItem.fromJson(Map<String, dynamic> json) {
    final Object? rawAddons = json['addons'];
    return OrderItem(
      id: readInt(json['id']) ?? 0,
      name: readString(json['nameSnapshot']) ?? readString(json['name']) ?? 'Producto',
      variantName: readString(json['variantName']),
      quantity: readNum(json['quantity']) ?? 1,
      unitPriceMinor: readInt(json['unitPriceMinor']) ?? 0,
      lineTotalMinor: readInt(json['lineTotalMinor']) ?? 0,
      discountMinor: readInt(json['discountMinor']) ?? 0,
      taxMinor: readInt(json['taxMinor']) ?? 0,
      notes: readString(json['notes']),
      status: readString(json['status']) ?? 'PENDING',
      addons: <OrderItemAddon>[
        if (rawAddons is List)
          for (final Object? row in rawAddons)
            if (row is Map<String, dynamic>) OrderItemAddon.fromJson(row),
      ],
    );
  }

  @override
  String toString() => 'OrderItem($quantityLabel × $displayName)';
}
