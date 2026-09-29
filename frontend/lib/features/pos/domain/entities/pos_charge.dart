// Solicitud de cobro del mostrador y su resultado.
//
// EL COBRO SIN PASARELA
// No hay integración, no hay redirección y no seGuarda ningún dato de tarjeta.
// El cajero cobra en la caja o con el datáfono y ANOTA lo que pasó aquí:
//   - Efectivo: el monto recibido; el backend calcula el cambio y lo devuelve
//     en `changeDueMinor` (API.md §7.13). En efectivo `amountMinor` PUEDE
//     exceder el saldo a propósito: es el pago con cambio.
//   - Tarjeta: el monto EXACTO a cobrar (el datáfono ya cobró) y la referencia de
//     aprobación que el cajero copia del ticket del datáfono. Sin
//     `providerReference` el backend responde `400` cuando el proveedor lo exige
//     (`GET /payments/methods` lo publica por método).
//
// IDEMPOTENCIA
// `POST /payments` exige la cabecera `Idempotency-Key` (UUID v4): sin ella
// devuelve `400 VALIDATION_ERROR` con `details.code = 'IDEMPOTENCY_KEY_REQUIRED'`.
// La clave se genera UNA vez por intento de cobro y se conserva mientras el
// diálogo siga abierto, de modo que pulsar "Confirmar" dos veces o un reintento
// tras un timeout ambiguo NO cobran dos veces: el backend responde `200` con
// `meta.idempotent = true` y el mismo cuerpo.

import 'package:flutter/foundation.dart';

/// Método de cobro del mostrador.
///
/// Son literales de `PaymentMethod` (API.md §6.2). `TRANSFER` y `ONLINE`
/// existen en la API pero el mostrador NO los ofrece: este producto cobra en
/// efectivo o con datáfono. Si `GET /payments/methods` habilita métodos que
/// aquí no están modelados, el diálogo los muestra como no disponibles en vez de
/// inventar su flujo.
enum PosPaymentMethod {
  /// Efectivo. `amountMinor` puede exceder el saldo (es el pago con cambio).
  cash('CASH', 'Efectivo'),

  /// Tarjeta mediante datáfono propio del local. Exige referencia de aprobación.
  card('CARD', 'Tarjeta (datáfono)');

  const PosPaymentMethod(this.apiValue, this.label);

  final String apiValue;
  final String label;

  /// `true` si el cajero tiene que anotar la referencia de aprobación.
  ///
  /// `CARD` siempre la necesita: es el único vínculo entre el cobro del
  /// datáfono y el registro en el sistema, y sin ella la conciliación del cierre
  /// de caja no se puede hacer.
  bool get requiresReference => this == PosPaymentMethod.card;

  /// `true` si el monto pagado puede ser mayor que el saldo (el cambio).
  bool get allowsOverpayment => this == PosPaymentMethod.cash;
}

/// Lo que el cajero escribe en el diálogo de cobro.
@immutable
class PosChargeRequest {
  const PosChargeRequest({
    required this.method,
    required this.amountMinor,
    this.referenceNumber,
    this.receiptNumber,
    this.notes,
  });

  final PosPaymentMethod method;

  /// Centavos a imputar. En efectivo puede ser mayor que el saldo; en tarjeta es
  /// el total exacto.
  final int amountMinor;

  /// Referencia de aprobación del datáfono. Requerida en tarjeta.
  final String? referenceNumber;

  /// Número de recibo del datáfono (opcional, máx. 50).
  final String? receiptNumber;

  /// Nota del cobro (máx. 300).
  final String? notes;

  /// `true` si la referencia quedó vacía siendo obligatoria.
  bool get missingRequiredReference => method.requiresReference &&
      (referenceNumber == null || referenceNumber!.trim().isEmpty);

  PosChargeRequest copyWith({
    PosPaymentMethod? method,
    int? amountMinor,
    String? referenceNumber,
    String? receiptNumber,
    String? notes,
  }) {
    return PosChargeRequest(
      method: method ?? this.method,
      amountMinor: amountMinor ?? this.amountMinor,
      referenceNumber: referenceNumber ?? this.referenceNumber,
      receiptNumber: receiptNumber ?? this.receiptNumber,
      notes: notes ?? this.notes,
    );
  }

  /// Cuerpo JSON de `POST /payments`.
  ///
  /// `provider` NO se manda en efectivo (la API dice "req. salvo CASH") y en
  /// tarjeta se manda `CASH_REGISTRY`: no es una pasarela, es el registro manual
  /// de lo que pasó por el datáfono del local (BR-SEC-006, sin datos de tarjeta).
  Map<String, dynamic> toPaymentBody(int orderId) => <String, dynamic>{
        'orderId': orderId,
        'method': method.apiValue,
        'amountMinor': amountMinor,
        if (!method.allowsOverpayment) 'provider': 'CASH_REGISTRY',
        if (method.requiresReference && referenceNumber != null)
          'providerReference': referenceNumber!.trim(),
        if (receiptNumber != null && receiptNumber!.trim().isNotEmpty)
          'receiptNumber': receiptNumber!.trim(),
        if (notes != null && notes!.trim().isNotEmpty) 'notes': notes!.trim(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PosChargeRequest &&
          other.method == method &&
          other.amountMinor == amountMinor &&
          other.referenceNumber == referenceNumber &&
          other.receiptNumber == receiptNumber;

  @override
  int get hashCode =>
      Object.hash(method, amountMinor, referenceNumber, receiptNumber);

  @override
  String toString() =>
      'PosChargeRequest(${method.apiValue}, $amountMinor centavos)';
}

/// Resultado de un cobro aceptado por el servidor.
@immutable
class PosChargeResult {
  const PosChargeResult({
    required this.paymentId,
    required this.orderId,
    required this.amountMinor,
    required this.balanceMinor,
    this.changeDueMinor = 0,
    this.orderNumber,
    this.orderStatus,
  });

  final int paymentId;
  final int orderId;

  /// Imputado al pedido (NO lo que el cliente entregó: en efectivo, entregar
  /// $50.000 para un saldo de $18.000 imputa $18.000 y deja $32.000 de cambio).
  final int amountMinor;

  /// Saldo que queda tras el pago. `0` = pedido pagado.
  final int balanceMinor;

  /// Cambio a entregar. Solo en efectivo, y lo calcula el servidor.
  final int changeDueMinor;

  final String? orderNumber;
  final String? orderStatus;

  /// `true` si el pedido quedó completamente pagado.
  bool get isFullyPaid => balanceMinor <= 0;

  @override
  String toString() =>
      'PosChargeResult(pago $paymentId, saldo $balanceMinor, cambio $changeDueMinor)';
}
