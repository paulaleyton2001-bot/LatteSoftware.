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
  ///
  /// `needsStartedRental` entra en la lista porque es la condición que más caro
  /// sale: sin alquiler arrancado, `POST /orders` SÍ acepta el pedido
  /// `CHAIR_RENTAL`, pero lo crea con `totalMinor = 0` —comprobado en el
  /// backend—. Cobrar ese pedido cobra cero por una hora de silla, y es el peor
  /// resultado posible: el cajero ve que cobró y el local no se lleva nada.
  bool get hasBlockingGap =>
      needsChair || needsReservation || needsStartedRental;

  /// `true` si hay reserva elegida pero el alquiler todavía no ha arrancado.
  ///
  /// El importe del alquiler lo calcula el servidor a partir de un alquiler
  /// `ACTIVE` (precio congelado de la silla por los minutos), no a partir de la
  /// reserva: la reserva solo dice que el cliente tiene derecho a la silla.
  bool get needsStartedRental =>
      isChairRental && reservationId != null && rentalId == null;

  /// Explicación de la falta, o `null` si todo está listo.
  ///
  /// Los mensajes dicen QUÉ HACER, no qué falta. El cajero no puede resolver solo
  /// un «falta la reserva»: tiene que abrir el selector de reservas o el
  /// alquiler sin reserva, y el mensaje le dice cuál de los dos.
  String? get blockingReason {
    if (needsChair) {
      return 'Elige la silla del alquiler en el plano de arriba.';
    }
    if (needsStartedRental) {
      return 'Abre el alquiler de esta reserva para que el servidor calcule su '
          'importe. Sin alquiler arrancado, el pedido se crearía por cero.';
    }
    if (needsReservation) {
      return 'Elige la reserva del cliente para esta silla, o abre un alquiler sin '
          'reserva si viene sin ella.';
    }
    return null;
  }

  /// `true` si el alquiler ya arrancó (`POST /rentals` hecho).
  ///
  /// El backend solo calcula el importe del alquiler si hay un alquiler ACTIVO
  /// asociado a la silla y a la reserva: sin él el pedido se crea con
  /// `totalMinor = 0` y el cajero cobra cero por una hora de silla.
  bool get hasStartedRental => rentalId != null;

  /// `true` si el tipo de pedido es un alquiler.
  ///
  /// El backend PROHÍBE mezclar: `POST /orders` con `type = CHAIR_RENTAL` y
  /// líneas de producto devuelve `422 MIXED_ORDER_TYPE_NOT_ALLOWED` (BR-ORDER-012,
  /// «Un pedido de alquiler no lleva líneas de producto»). El alquiler se cobra
  /// en su propio pedido y el consumo en otro, así que la UI lo dice antes de
  /// que el cajero lo descubra con un error.
  bool get isChairRental => type == PosOrderType.chairRental;

  /// `true` si hay un alquiler A MEDIO MONTAR en el borrador.
  ///
  /// EL MISMO CORTOCIRCUITO QUE MATABA EL COBRO, OTRA VEZ
  /// La pantalla pregunta «¿hay algo que perder?» mirando solo las líneas del
  /// carrito. Para un alquiler eso es SIEMPRE cero, y el resultado era peor que
  /// un botón muerto: el cajero abría el alquiler (tres llamadas al backend, la
  /// silla queda `OCCUPIED`) y al pulsar atrás o «Nuevo pedido» no se le pedía
  /// confirmación, se perdía el borrador en silencio y el alquiler se quedaba
  /// abierto en el servidor sin nadie que lo fuera a cobrar. Por eso el trabajo
  /// en curso se mira AQUÍ y no en la longitud de una lista.
  bool get hasRentalWork =>
      isChairRental &&
      (chairId != null || reservationId != null || rentalId != null);

  /// `true` si el borrador tiene algo que el cajero perdería al salir.
  ///
  /// Cubre los tres tipos de trabajo del mostrador: productos en el carrito, un
  /// alquiler a medio montar, y los datos sueltos (mesa, notas, cupón). Los tres
  /// se pierden sin más al cerrar el POS, así que los tres justifican el aviso.
  bool get hasPendingWork =>
      hasRentalWork ||
      tableLabel.isNotEmpty ||
      notes.isNotEmpty ||
      couponCode != null;

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
