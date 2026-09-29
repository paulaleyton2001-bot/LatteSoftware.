// Estado del pedido EN CURSO del mostrador.
//
// QUÉ ES Y QUÉ NO ES
// Esto es el carrito del cajero: líneas, tipo de pedido, silla y notas. Se vive
// en un provider (`posDraftProvider`), NO en `setState`, porque lo tocan tres
// zonas de la pantalla a la vez (catálogo, panel de pedido y panel de cobro) y
// con `setState` quedarían tres copias desincronizadas.
//
// El dinero de las líneas es una PREVISUALIZACIÓN (BR-PRICE-008). El único total
// válido es el que devuelve el servidor tras `POST /orders`: la UI reemplaza sus
// cifras por las del servidor sin transformarlas. La excepción son los
// descuentos, que el servidor aplica y el cliente no puede anticipar.
//
// `POST /orders` NO lleva ids de línea: lleva `{ productId, variantId, quantity,
// addons, notes }`. Por eso las líneas del mostrador son locales y su `id` es
// interno; al crear el pedido, el servidor devuelve los `order_items` reales y
// el mostrador pasa a trabajar contra ellos.

import 'package:flutter/foundation.dart';
import './pos_order_type.dart';

/// Borrador del pedido que el cajero está armando. Inmutable.
@immutable
class PosDraft {
  const PosDraft({
    this.type = PosOrderType.takeaway,
    this.chairId,
    this.chairLabel,
    this.reservationId,
    this.rentalId,
    this.tableLabel = '',
    this.notes = '',
    this.couponCode,
  });

  /// Borrador vacío: para llevar y sin silla.
  static const PosDraft empty = PosDraft();

  final PosOrderType type;

  /// Silla asignada. `null` en `TAKEAWAY` (el backend lo prohíbe) y en
  /// `DINE_IN` sin mesa concreta.
  final int? chairId;

  /// Código/etiqueta visible de la silla, solo para pintar. La verdad es el id.
  final String? chairLabel;

  /// Obligatorio si `type = CHAIR_RENTAL` (API.md §7.12).
  final int? reservationId;

  /// Si el alquiler ya arrancó (`POST /rentals` crea el pedido).
  final int? rentalId;

  /// Etiqueta libre de mesa/barra (máx. 50 en la API).
  final String tableLabel;

  /// Notas internas del pedido (máx. 500).
  final String notes;

  /// Cupón a aplicar. El descuento real lo calcula el servidor.
  final String? couponCode;

  /// `true` si el tipo de pedido pide silla y no se ha elegido.
  bool get needsChair => type.requiresChair && chairId == null;

  /// `true` si el tipo pide reserva y no la hay.
  bool get needsReservation => type.requiresReservation && reservationId == null;

  /// `true` si falta algo obligatorio para mandar `POST /orders`.
  ///
  /// El catálogo y el panel de cobro usan esto para explicar por qué el botón
  /// de cobrar está apagado, en vez de dejar que el servidor responda `422` con
  /// un mensaje de sistema.
  bool get hasBlockingGap => needsChair || needsReservation;

  /// Explicación de la falta, o `null` si todo está listo.
  String? get blockingReason {
    if (needsChair) {
      return 'El alquiler de silla necesita una silla asignada.';
    }
    if (needsReservation) {
      return 'El alquiler de silla necesita la reserva asociada.';
    }
    return null;
  }

  PosDraft copyWith({
    PosOrderType? type,
    int? chairId,
    String? chairLabel,
    int? reservationId,
    int? rentalId,
    String? tableLabel,
    String? notes,
    String? couponCode,
    bool clearChair = false,
    bool clearReservation = false,
    bool clearRental = false,
    bool clearCoupon = false,
  }) {
    return PosDraft(
      type: type ?? this.type,
      chairId: clearChair ? null : (chairId ?? this.chairId),
      chairLabel: clearChair ? null : (chairLabel ?? this.chairLabel),
      reservationId:
          clearReservation ? null : (reservationId ?? this.reservationId),
      rentalId: clearRental ? null : (rentalId ?? this.rentalId),
      tableLabel: tableLabel ?? this.tableLabel,
      notes: notes ?? this.notes,
      couponCode: clearCoupon ? null : (couponCode ?? this.couponCode),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PosDraft &&
          other.type == type &&
          other.chairId == chairId &&
          other.reservationId == reservationId &&
          other.rentalId == rentalId &&
          other.tableLabel == tableLabel &&
          other.notes == notes &&
          other.couponCode == couponCode;

  @override
  int get hashCode => Object.hash(type, chairId, reservationId, rentalId,
      tableLabel, notes, couponCode);

  @override
  String toString() =>
      'PosDraft(${type.apiValue}, silla: $chairId, reserva: $reservationId)';
}
