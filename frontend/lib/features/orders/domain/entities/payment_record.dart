// Pago registrado. Módulo `features/orders/domain/entities`.
//
// POR QUÉ EXISTE ESTA ENTIDAD SI NO HAY PASARELA
// La app del cliente NUNCA crea un pago. El cobro se hace en el mostrador, en
// efectivo o con tarjeta, y lo registra el personal con `POST /payments` (permiso
// `payments:create`, que un `CUSTOMER` sí tiene "parcial" para su propio pedido, pero
// la app del cliente no lo usa). Esta entidad existe para LEER ese histórico.
//
// CERO DATOS SENSIBLES
// La API garantiza que `Payment` nunca expone `metadata` ni datos de tarjeta
// (BR-SEC-006), así que aquí solo hay número, método, importe, fecha y estado. No hay
// nada que censurar antes de pintar.



import 'package:flutter/foundation.dart';
import './json_readers.dart';

/// Pago registrado en el local (`Payment`, API.md §6.3).
@immutable
class PaymentRecord {
  const PaymentRecord({
    required this.id,
    required this.amountMinor,
    this.paymentNumber,
    this.orderId,
    this.orderNumber,
    this.method,
    this.provider,
    this.status = 'PENDING',
    this.refundedMinor = 0,
    this.receiptNumber,
    this.approvedAt,
    this.createdAt,
  });

  final int id;
  final String? paymentNumber;
  final int? orderId;
  final String? orderNumber;

  /// `PaymentMethod`: `CASH`, `CARD`, `TRANSFER` u `ONLINE`.
  final String? method;

  /// `PaymentProvider`. En el mostrador es `CASH_REGISTRY` (la caja).
  final String? provider;

  /// `PaymentStatus`.
  final String status;

  final int amountMinor;
  final int refundedMinor;
  final String? receiptNumber;
  final DateTime? approvedAt;
  final DateTime? createdAt;

  /// Etiqueta del método tal y como lo ve la persona.
  ///
  /// Se traduce aquí y no en el widget porque la misma etiqueta aparece en el
  /// historial y en el detalle del pedido, y "CASH" no le dice nada a quien lee
  /// español.
  String get methodLabel => switch (method) {
        'CASH' => 'Efectivo',
        'CARD' => 'Tarjeta',
        'TRANSFER' => 'Transferencia',
        'ONLINE' => 'Pago en línea',
        _ => method ?? 'Pago',
      };

  /// `true` si el pago fue devuelto total o parcialmente.
  bool get isRefund => status == 'REFUNDED' || status == 'PARTIALLY_REFUNDED';

  /// `true` si el pago imputa saldo (aprobado o reembolsado).
  bool get countsAsPaid => status == 'APPROVED' || isRefund;

  factory PaymentRecord.fromJson(Map<String, dynamic> json) => PaymentRecord(
        id: readInt(json['id']) ?? 0,
        paymentNumber: readString(json['paymentNumber']),
        orderId: readInt(json['orderId']),
        orderNumber: readString(json['orderNumber']),
        method: readString(json['method']),
        provider: readString(json['provider']),
        status: readString(json['status']) ?? 'PENDING',
        amountMinor: readInt(json['amountMinor']) ?? 0,
        refundedMinor: readInt(json['refundedMinor']) ?? 0,
        receiptNumber: readString(json['receiptNumber']),
        approvedAt: readDate(json['approvedAt']),
        createdAt: readDate(json['createdAt']),
      );

  @override
  String toString() => 'PaymentRecord($paymentNumber, $status)';
}
