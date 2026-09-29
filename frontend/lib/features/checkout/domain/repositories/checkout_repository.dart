// Contrato del checkout. Módulo `features/checkout/domain`.
//
// FLUJO QUE REFLEJA ESTA INTERFAZ (y que el cliente pidió explícitamente)
//   1. Elegir tipo de pedido: TAKEAWAY | DINE_IN | CHAIR_RENTAL
//   2. Si es DINE_IN o CHAIR_RENTAL: preguntar «¿Quieres reservar una silla?»;
//      si la respuesta es NO se continúa sin silla (DINE_IN sin `chairId` es
//      válido: API.md §7.12 dice que `chairId` es opcional en `DINE_IN`).
//   3. Si hay silla: elegir duración.
//   4. Cotizar con `GET /reservations/quote` para ver el precio real ANTES de
//      confirmar.
//   5. Confirmar: reserva (si hay silla) + `POST /orders`.
//
// NO HAY PAGAR. No existe ningún método de pago en esta interfaz, y a propósito:
// la cafetería cobra en el local, en efectivo o con tarjeta. `POST /payments` no
// lo consume la app del cliente.

// `domain/` solo importa `package:flutter/foundation.dart` para `@immutable`:
// es la excepción que la norma permite (el resto de imports son de `core/`).

import 'package:flutter/foundation.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/result/result.dart';
import '../entities/chair_quote.dart';

/// Lecturas y escrituras del checkout.
abstract interface class CheckoutRepository {
  /// `GET /locations` — para resolver la sede que exige `locationId` en el mapa.
  ///
  /// Se pide solo la primera activa: la app del cliente trabaja con la sede donde
  /// está la persona, y `GET /chairs/map` requiere el id sí o sí.
  Future<Result<int?>> defaultLocationId();

  /// `GET /chairs/map?locationId=...` — zonas, sillas y contadores.
  Future<Result<ChairMap>> chairMap(int locationId);

  /// `GET /chairs/:id` — detalle con `currentReservation` y `currentRental`.
  ///
  /// El mapa NO trae quién ocupa la silla ni hasta cuándo, así que el panel de
  /// detalle lo pide aquí. Devuelve `null` en [occupancyEndAt] si la API no
  /// informa de la reserva o el alquiler.
  Future<Result<ChairOccupancy?>> chairOccupancy(int chairId);

  /// `GET /reservations/quote?chairId&startAt&endAt&applyCouponCode`.
  ///
  /// No crea nada. Si hay conflicto devuelve `200` con `isAvailable: false`.
  Future<Result<ChairQuote>> quote({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
    String? couponCode,
  });

  /// Ejecuta el checkout completo y devuelve el pedido creado.
  ///
  /// Internamente: `POST /reservations` (si hay silla) y `POST /orders`. Se
  /// expone como UNA operación porque desde el punto de vista del usuario es una
  /// sola acción, y porque si la reserva se crea pero el pedido falla hay que
  /// poder explicar qué pasó sin que la UI hagaMalabares.
  Future<Result<PlacedOrder>> place(CheckoutRequest request);
}

/// Pedido de checkout ya resuelto por la UI.
@immutable
class CheckoutRequest {
  const CheckoutRequest({
    required this.type,
    required this.cart,
    this.chairId,
    this.startAt,
    this.endAt,
    this.couponCode,
    this.customerNotes,
  });

  /// `OrderType` (`TAKEAWAY` | `DINE_IN` | `CHAIR_RENTAL`).
  final String type;

  final CartState cart;

  /// `null` = sin silla (TAKEAWAY, o DINE_IN en el que el cliente dijo que no).
  final int? chairId;

  /// Inicio de la reserva. `null` si no hay silla.
  final DateTime? startAt;

  /// Fin de la reserva. `null` si no hay silla.
  final DateTime? endAt;

  final String? couponCode;

  /// Notas del cliente (`customerNotes`, máx. 500).
  final String? customerNotes;
}

/// Final de la reserva/alquiler de una silla, tal y como lo informa la API.
@immutable
class ChairOccupancy {
  const ChairOccupancy({
    required this.chairId,
    this.status = 'AVAILABLE',
    this.occupiedUntil,
    this.occupiedByLabel,
    this.reservationCode,
    this.rentalCode,
  });

  final int chairId;

  /// `ChairStatus` actual.
  final String status;

  /// Hasta cuándo está ocupada o reservada.
  final DateTime? occupiedUntil;

  /// Descripción de quién la ocupa.
  ///
  /// `GET /chairs/:id` devuelve `currentReservation` y `currentRental` SIN el
  /// nombre del cliente, y un `CUSTOMER` no tiene por qué saberlo. Se rellena con
  /// una etiqueta neutra ("Otro cliente") en lugar de inventar el dato.
  final String? occupiedByLabel;

  final String? reservationCode;
  final String? rentalCode;
}
