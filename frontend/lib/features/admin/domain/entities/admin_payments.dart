// Pago registrado en el local. MÓDULO `features/admin/domain/entities`.
//
// Ver `admin_records.dart` para el criterio de agrupación.
//
// NO HAY PASARELA
// `provider` no es un procesador de pago: en este producto es `CASH_REGISTRY`
// tanto para efectivo como para tarjeta, y `providerReference` es el número que
// el cajero copió del datáfono. El reembolso (`POST /payments/:id/refund`) es una
// anotación de caja, no una llamada a un proveedor: nadie devuelve dinero desde
// aquí, se registra lo que se devolvió.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

/// Pago registrado en el local.
@immutable
class AdminPayment {
  const AdminPayment({
    required this.id,
    required this.method,
    required this.status,
    required this.amountMinor,
    this.paymentNumber,
    this.orderId,
    this.orderNumber,
    this.provider,
    this.providerReference,
    this.refundedMinor = 0,
    this.currencyCode = 'COP',
    this.referenceNumber,
    this.receiptNumber,
    this.approvedAt,
    this.failureReason,
    this.createdAt,
  });

  final int id;
  final String? paymentNumber;
  final int? orderId;
  final String? orderNumber;

  /// `PaymentMethod`: `CASH`, `CARD`, `TRANSFER`, `ONLINE`.
  final String method;

  /// `PaymentProvider`. En este producto el efectivo es `CASH_REGISTRY` y la
  /// tarjeta también: no hay pasarela, la referencia la anota el cajero.
  final String? provider;

  /// Referencia de aprobación del datáfono, o `null` en efectivo.
  final String? providerReference;

  final String status;
  final int amountMinor;
  final int refundedMinor;
  final String currencyCode;

  /// Referencia interna de la caja.
  final String? referenceNumber;
  final String? receiptNumber;

  final DateTime? approvedAt;
  final String? failureReason;
  final DateTime? createdAt;

  /// Saldo reembolsable: `amountMinor - refundedMinor` (BR-PAY-006).
  int get refundableMinor => amountMinor - refundedMinor;

  /// `true` si no queda nada por reembolsar.
  bool get isFullyRefunded => refundableMinor <= 0;

  /// `true` si se puede reembolsar (el pago está aprobado y queda saldo).
  bool get isRefundable =>
      refundableMinor > 0 &&
      (status == 'APPROVED' || status == 'PARTIALLY_REFUNDED');

  static AdminPayment? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminPayment(
      id: id,
      paymentNumber: JsonReader.string(json['paymentNumber']),
      orderId: JsonReader.integer(json['orderId']),
      orderNumber: JsonReader.string(json['orderNumber']),
      method: JsonReader.stringOr(json['method'], 'CASH'),
      provider: JsonReader.string(json['provider']),
      providerReference: JsonReader.string(json['providerReference']),
      status: JsonReader.stringOr(json['status'], 'PENDING'),
      amountMinor: JsonReader.integerOr(json['amountMinor'], 0),
      refundedMinor: JsonReader.integerOr(json['refundedMinor'], 0),
      currencyCode: JsonReader.stringOr(json['currencyCode'], 'COP'),
      referenceNumber: JsonReader.string(json['referenceNumber']),
      receiptNumber: JsonReader.string(json['receiptNumber']),
      approvedAt: JsonReader.dateTime(json['approvedAt']),
      failureReason: JsonReader.string(json['failureReason']),
      createdAt: JsonReader.dateTime(json['createdAt']),
    );
  }

  @override
  String toString() => 'AdminPayment($id, $method, $status)';
}
