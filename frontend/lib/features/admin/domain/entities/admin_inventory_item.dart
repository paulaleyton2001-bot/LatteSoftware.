// Ítem de inventario. MÓDULO `features/admin/domain/entities`.
//
// Un archivo por tipo, no por dominio, cuando el tipo es grande: `AdminInventoryItem`
// arrastra el cálculo del valorizado y no tiene nada en común con el pago ni con
// el cupón. Mezclados en un archivo de 270 líneas, cambiar uno obligaba a abrir el
// otro.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

@immutable
class AdminInventoryItem {
  const AdminInventoryItem({
    required this.id,
    required this.name,
    this.productId,
    this.ingredientId,
    this.sku,
    this.unit = 'UND',
    this.currentStock = 0,
    this.minStock = 0,
    this.maxStock = 0,
    this.costMinor = 0,
    this.supplier,
    this.locationStorage,
    this.isTracked = true,
    this.isLowStock = false,
  });

  final int id;
  final int? productId;
  final int? ingredientId;
  final String name;
  final String? sku;
  final String unit;

  /// Cantidades pueden ser fraccionarias (`0.5` kg de café). El dinero NO: es `int`.
  final double currentStock;
  final double minStock;
  final double maxStock;

  /// Coste unitario en centavos.
  final int costMinor;

  final String? supplier;
  final String? locationStorage;
  final bool isTracked;

  /// Lo CALCULA el backend con `minStock` o, si es 0, con
  /// `businesses.lowStockAlertThreshold`. La app no lo recalcula: si el negocio
  /// cambia el umbral, el backend es la autoridad.
  final bool isLowStock;

  /// Valorizado en centavos: `currentStock * costMinor`, redondeado a entero.
  int get valueMinor => (currentStock * costMinor).round();

  /// `true` si se agotó (`<= 0`).
  bool get isOutOfStock => currentStock <= 0;

  static AdminInventoryItem? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminInventoryItem(
      id: id,
      productId: JsonReader.integer(json['productId']),
      ingredientId: JsonReader.integer(json['ingredientId']),
      name: JsonReader.stringOr(json['name'], 'Ítem $id'),
      sku: JsonReader.string(json['sku']),
      unit: JsonReader.stringOr(json['unit'], 'UND'),
      currentStock: JsonReader.integerOr(json['currentStock'], 0).toDouble(),
      minStock: JsonReader.integerOr(json['minStock'], 0).toDouble(),
      maxStock: JsonReader.integerOr(json['maxStock'], 0).toDouble(),
      costMinor: JsonReader.integerOr(json['costMinor'], 0),
      supplier: JsonReader.string(json['supplier']),
      locationStorage: JsonReader.string(json['locationStorage']),
      isTracked: JsonReader.boolean(json['isTracked'], fallback: true),
      isLowStock: JsonReader.boolean(json['isLowStock']),
    );
  }

  @override
  String toString() => 'AdminInventoryItem($name, $currentStock)';
}
