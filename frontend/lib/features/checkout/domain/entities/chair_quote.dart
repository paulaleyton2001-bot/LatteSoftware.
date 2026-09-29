// Cotización de la silla y resultado del checkout. Módulo `checkout/domain`.
//
// LA COTIZACIÓN LA HACE EL SERVIDOR
// `GET /reservations/quote` (API.md §7.8) devuelve precio por hora, minutos
// facturables (con el mínimo de 30 min ya aplicado), subtotal, descuento, impuestos
// y total. Es una CONSULTA: no crea nada y, si hay conflicto, responde `200` con
// `isAvailable: false` y la reserva que estorba en `conflict` (no un `409`).
// Por eso `isAvailable` es un campo del modelo y no un error.
//
// EL TOTAL FINAL SIEMPRE VIENE DE `POST /orders`
// Lo que se ve aquí es una cotización previa; al confirmar, la pantalla de
// confirmación muestra las cifras que devuelve el servidor, sin transformarlas
// (BR-PRICE-008).

import 'package:flutter/foundation.dart';

import '../../../../core/utils/currency_formatter.dart';

/// Cotización de una silla para una franja horaria.
@immutable
class ChairQuote {  const ChairQuote({
    required this.chairId,
    required this.startAt,
    required this.endAt,
    required this.durationMinutes,
    required this.billableMinutes,
    required this.pricePerHourMinor,
    required this.subtotalMinor,
    required this.totalMinor,
    this.minimumApplied = false,
    this.discountMinor = 0,
    this.taxMinor = 0,
    this.serviceFeeMinor = 0,
    this.taxRateBp = 0,
    this.isAvailable = true,
    this.chairName,
    this.chairCode,
    this.zoneName,
    this.conflictCode,
    this.conflictEndAt,
    this.appliedRules = const <String>[],
  });

  final int chairId;
  final DateTime startAt;
  final DateTime endAt;

  /// Duración pedida por el cliente.
  final int durationMinutes;

  /// Minutos que se COBRAN (con el mínimo de 30 min ya aplicado por el servidor).
  final int billableMinutes;

  final int pricePerHourMinor;
  final int subtotalMinor;
  final int discountMinor;
  final int taxMinor;
  final int serviceFeeMinor;

  /// Total según el servidor, en centavos.
  final int totalMinor;

  /// `true` si el mínimo de 30 min se aplicó a esta cotización.
  final bool minimumApplied;

  /// `taxRateBp` en puntos básicos (1000 = 10 %).
  final int taxRateBp;

  /// `false` si la silla no está libre para esa franja.
  final bool isAvailable;

  final String? chairName;
  final String? chairCode;
  final String? zoneName;

  /// Código de la reserva que estorba, si la hay (`conflict.code`).
  final String? conflictCode;

  /// Fin de la reserva que estorba.
  final DateTime? conflictEndAt;

  /// Reglas de negocio que el servidor aplicó (`meta.appliedRules`).
  final List<String> appliedRules;

  /// Motivo por el que no está disponible, redactado para el usuario.
  String? get unavailableReason {
    if (isAvailable) return null;
    if (conflictCode != null) {
      return 'Esa silla ya está reservada ($conflictCode). Elige otra.';
    }
    return 'Esa silla no está libre en ese horario. Elige otra.';
  }

  /// Resumen legible del cobro, para el panel de detalle.
  String describe() {
    final StringBuffer buffer = StringBuffer();
    buffer.write('${CurrencyFormatter.formatMinor(pricePerHourMinor)} / hora');
    if (minimumApplied) buffer.write(' · mínimo de 30 min aplicado');
    return buffer.toString();
  }

  /// Cotización vacía: la que se muestra mientras se consulta, para que el panel
  /// no desaparezca y parpadee en cada cambio de silla.
  static ChairQuote pending({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
    int pricePerHourMinor = 0,
    String? chairCode,
  }) =>
      ChairQuote(
        chairId: chairId,
        startAt: startAt,
        endAt: endAt,
        durationMinutes: endAt.difference(startAt).inMinutes,
        billableMinutes: endAt.difference(startAt).inMinutes,
        pricePerHourMinor: pricePerHourMinor,
        subtotalMinor: 0,
        totalMinor: 0,
        chairCode: chairCode,
      );
}

/// Pedido creado tras confirmar el checkout.
///
/// Solo se guardan los campos que la pantalla de confirmación necesita. El
/// `Order` completo está en `features/orders`, que lo vuelve a pedir por id si
/// hace falta el desglose.
@immutable
class PlacedOrder {
  const PlacedOrder({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.type,
    required this.totalMinor,
    required this.subtotalMinor,
    this.discountMinor = 0,
    this.taxMinor = 0,
    this.serviceFeeMinor = 0,
    this.paidMinor = 0,
    this.balanceMinor = 0,
    this.chairCode,
    this.reservationCode,
    this.rentalCode,
    this.placedAt,
    this.itemCount = 0,
    this.lines = const <PlacedOrderLine>[],
  });

  final int id;

  /// `ORD-000123` (API.md §7.12).
  final String orderNumber;

  /// `OrderStatus`.
  final String status;

  /// `OrderType`.
  final String type;

  final int subtotalMinor;
  final int discountMinor;
  final int taxMinor;
  final int serviceFeeMinor;

  /// Total devuelto por el servidor. Es el ÚNICO válido (BR-PRICE-008).
  final int totalMinor;

  final int paidMinor;

  /// Saldo pendiente. En esta app SIEMPRE es el total, porque no hay pasarela:
  /// el pago ocurre en el local.
  final int balanceMinor;

  final String? chairCode;

  /// Código de la reserva creada (`RES-000123`), si la hubo.
  final String? reservationCode;

  /// Código del alquiler, si se abrió uno.
  final String? rentalCode;

  final DateTime? placedAt;

  /// NÚMERO TOTAL de productos del pedido, no de líneas: 3 cafés + 2类产品 son 5.
  ///
  /// `POST /orders` NO envía este campo, así que el parser lo DERIVA de
  /// `items[]` (ver `CheckoutParsers.placedOrder`). Antes leía directamente
  /// `data['itemCount']`, que solo existe en `GET /orders`, y por eso valía
  /// siempre 0 en la confirmación: los productos "no aparecían".
  final int itemCount;

  /// Líneas del pedido tal como las devolvió el servidor (`items[]`).
  ///
  /// Están para que la confirmación ENSEÑE lo comprado. Se leen
  /// `nameSnapshot`/`lineTotalMinor` —el nombre y el importe con los que el
  /// servidor cobró— y no los del carrito local (BR-PRICE-008).
  final List<PlacedOrderLine> lines;

  /// `true` si queda saldo por pagar en el local (siempre, en este producto).
  bool get isPayableAtStore => balanceMinor > 0;
}

/// Una línea del pedido recién creado, tal como la devuelve el servidor.
///
/// Inmutable y comparable por valor: la confirmación la pinta en una lista
/// corta y no necesita identidad estable.
@immutable
class PlacedOrderLine {
  const PlacedOrderLine({
    required this.name,
    required this.quantity,
    required this.lineTotalMinor,
    this.variantName,
  });

  /// `nameSnapshot`: el nombre del producto en el momento del cobro.
  final String name;

  /// Variante elegida (`variantName`), si la línea tiene una.
  final String? variantName;

  /// Unidades de esta línea.
  final int quantity;

  /// `lineTotalMinor`: importe de la línea ya con descuentos.
  final int lineTotalMinor;

  /// Etiqueta completa para el lector de pantalla.
  String get semanticLabel => variantName == null
      ? '$quantity × $name'
      : '$quantity × $name, variante $variantName';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PlacedOrderLine &&
          other.name == name &&
          other.variantName == variantName &&
          other.quantity == quantity &&
          other.lineTotalMinor == lineTotalMinor;

  @override
  int get hashCode => Object.hash(name, variantName, quantity, lineTotalMinor);

  @override
  String toString() => 'PlacedOrderLine($quantity × $name)';
}

/// Reserva recién creada (`POST /reservations`).
///
/// Entidad mínima a propósito: el checkout solo necesita el `id` (para mandarlo
/// como `reservationId` en `POST /orders`) y el `code` (para mostrárselo a la
/// persona). Todo lo demás vive en `features/orders`, que vuelve a pedirla.
@immutable
class ReservationCreated {
  const ReservationCreated({
    required this.id,
    required this.code,
    required this.status,
    this.startAt,
    this.endAt,
    this.durationMinutes = 0,
    this.rentalTotalMinor = 0,
  });

  /// `chair_reservations.id`.
  final int id;

  /// `RES-` + 6-12 dígitos (API.md §7.8).
  final String code;

  /// `ReservationStatus`; `PENDING` en el momento de crearla.
  final String status;

  final DateTime? startAt;
  final DateTime? endAt;
  final int durationMinutes;

  /// Proyección del coste del alquiler que devuelve la reserva. Es ORIENTATIVA:
  /// el total con impuestos y cupón lo calcula `POST /orders`.
  final int rentalTotalMinor;
}

