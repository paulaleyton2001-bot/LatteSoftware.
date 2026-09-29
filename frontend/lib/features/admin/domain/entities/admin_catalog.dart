// Entidades del panel de administración.
//
// grouped en archivos por DOMINIO, no por pantalla: el panel tiene trece
// subpantallas y casi todas leen los mismos tipos (un `OrderSummary` aparece en
// Órdenes, en el Dashboard y en el tablero del POS). Si cada pantalla declarara su
// copia, cambiar el parser del backend obligaría a tocar trece archivos.
//
// TODAS VIENEN DEL BACKEND SIN TRANSFORMAR DINERO
// El dinero es `int` en centavos de principio a fin y solo se formatea al pintarlo
// con `PriceDisplay` (docs/DESIGN-TOKENS §9.1). Ninguna entidad guarda un `double`
// de dinero ni un porcentaje ya dividido.
//
// LOS PORCENTAJES LLEGAN EN BASIS POINTS
// `occupancyRateBp` y `utilizationBp` son ENTEROS en centésimas de punto
// porcentual: 4567 = 45,67 %. Hay que dividirlos entre 100 para pintar. Este
// archivo NO los convierte: la conversión se hace en el `view model` de la
// pantalla (`admin_dashboard_view.dart`) y se documenta allí.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

/// Resumen de un pedido para las tablas de administración.
@immutable
class AdminOrder {
  const AdminOrder({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.type,
    required this.totalMinor,
    this.paidMinor = 0,
    this.balanceMinor = 0,
    this.itemCount = 0,
    this.channel = 'POS',
    this.customerId,
    this.customerName,
    this.chairId,
    this.chairCode,
    this.couponCode,
    this.placedAt,
    this.completedAt,
    this.createdAt,
  });

  final int id;
  final String orderNumber;
  final String status;
  final String type;
  final String channel;
  final int totalMinor;
  final int paidMinor;
  final int balanceMinor;
  final int itemCount;
  final int? customerId;
  final String? customerName;
  final int? chairId;
  final String? chairCode;
  final String? couponCode;
  final DateTime? placedAt;
  final DateTime? completedAt;
  final DateTime? createdAt;

  bool get hasBalance => balanceMinor > 0;
  bool get isClosed =>
      status == 'COMPLETED' || status == 'CANCELLED' || status == 'REFUNDED';

  /// Parseo tolerante. `null` si no trae `id` ni `orderNumber`.
  static AdminOrder? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    final String? number = JsonReader.string(json['orderNumber']);
    if (id == null || number == null) return null;
    return AdminOrder(
      id: id,
      orderNumber: number,
      status: JsonReader.stringOr(json['status'], 'PENDING'),
      type: JsonReader.stringOr(json['type'], 'TAKEAWAY'),
      channel: JsonReader.stringOr(json['channel'], 'POS'),
      totalMinor: JsonReader.integerOr(json['totalMinor'], 0),
      paidMinor: JsonReader.integerOr(json['paidMinor'], 0),
      balanceMinor: JsonReader.integerOr(json['balanceMinor'], 0),
      itemCount: JsonReader.integerOr(json['itemCount'], 0),
      customerId: JsonReader.integer(json['customerId']),
      customerName: JsonReader.string(json['customerName']),
      chairId: JsonReader.integer(json['chairId']),
      chairCode: JsonReader.string(json['chairCode']),
      couponCode: JsonReader.string(json['couponCode']),
      placedAt: JsonReader.dateTime(json['placedAt']),
      completedAt: JsonReader.dateTime(json['completedAt']),
      createdAt: JsonReader.dateTime(json['createdAt']),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AdminOrder &&
          other.id == id &&
          other.status == status &&
          other.totalMinor == totalMinor &&
          other.paidMinor == paidMinor &&
          other.balanceMinor == balanceMinor;

  @override
  int get hashCode => Object.hash(id, status, totalMinor, paidMinor, balanceMinor);

  @override
  String toString() => 'AdminOrder($orderNumber, $status)';
}
