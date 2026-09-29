// Entidades de inventario: ítems, movimientos y proveedores.
//
// MÓDULO `features/admin/domain/entities`. Ver `admin_records.dart` para el
// criterio de agrupación por dominio.
//
// EL SALDO SE CAMBIA CON AJUSTE, NO EDITANDO
// `PATCH /inventory/items/:id` RECHAZA `currentStock` con `422
// FIELD_NOT_EDITABLE` (BR-INV-005): el saldo solo cambia por
// `POST /inventory/items/:id/adjust`, que deja un movimiento con rastro. Por eso
// la pantalla de ítems tiene "Ajustar stock", no un campo editable de stock.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

/// Movimiento de inventario.
@immutable
class AdminInventoryMovement {
  const AdminInventoryMovement({
    required this.id,
    required this.movementType,
    required this.quantity,
    this.inventoryItemId,
    this.inventoryItemName,
    this.unit,
    this.balanceAfter,
    this.unitCostMinor,
    this.referenceType,
    this.referenceId,
    this.reason,
    this.performedBy,
    this.createdAt,
  });

  final int id;
  final int? inventoryItemId;
  final String? inventoryItemName;
  final String? unit;

  /// `InventoryMovementType`. Positivo suma, negativo resta.
  final String movementType;

  final double quantity;
  final double? balanceAfter;

  /// Centavos por unidad.
  final int? unitCostMinor;

  final String? referenceType;
  final int? referenceId;
  final String? reason;
  final String? performedBy;
  final DateTime? createdAt;

  /// `true` si el movimiento suma stock.
  bool get isInbound => quantity > 0;

  static AdminInventoryMovement? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminInventoryMovement(
      id: id,
      inventoryItemId: JsonReader.integer(json['inventoryItemId']),
      inventoryItemName: JsonReader.string(json['inventoryItemName']),
      unit: JsonReader.string(json['unit']),
      movementType: JsonReader.stringOr(json['movementType'], 'ADJUSTMENT'),
      quantity: JsonReader.integerOr(json['quantity'], 0).toDouble(),
      balanceAfter: JsonReader.integer(json['balanceAfter'])?.toDouble(),
      unitCostMinor: JsonReader.integer(json['unitCostMinor']),
      referenceType: JsonReader.string(json['referenceType']),
      referenceId: JsonReader.integer(json['referenceId']),
      reason: JsonReader.string(json['reason']),
      performedBy: JsonReader.string(json['performedBy']),
      createdAt: JsonReader.dateTime(json['createdAt']),
    );
  }

  @override
  String toString() => 'AdminInventoryMovement($movementType, $quantity)';
}

/// Proveedor, derivado de `inventory_items.supplier` por el backend.
@immutable
class AdminSupplier {
  const AdminSupplier({
    required this.name,
    this.itemCount = 0,
    this.totalStock = 0,
    this.totalValueMinor = 0,
    this.lowStockCount = 0,
  });

  final String name;
  final int itemCount;
  final double totalStock;
  final int totalValueMinor;
  final int lowStockCount;

  static AdminSupplier? tryParse(Map<String, dynamic> json) {
    final String? name = JsonReader.string(json['name']);
    if (name == null) return null;
    return AdminSupplier(
      name: name,
      itemCount: JsonReader.integerOr(json['itemCount'], 0),
      totalStock: JsonReader.integerOr(json['totalStock'], 0).toDouble(),
      totalValueMinor: JsonReader.integerOr(json['totalValueMinor'], 0),
      lowStockCount: JsonReader.integerOr(json['lowStockCount'], 0),
    );
  }

  @override
  String toString() => 'AdminSupplier($name, $itemCount ítems)';
}
