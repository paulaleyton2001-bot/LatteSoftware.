// Tipo de pedido del mostrador y su capa de presentación.
//
// `OrderType` (API.md §6.2) son LITERALES del backend, no un enum de Dart: el
// backend puede añadir `KITCHEN` o `DELIVERY` mañana, y un enum cerrado haría
// que el parseo fallara y el mostrador se quedara sin poder cobrar.
//
// Este archivo solo aporta el CATÁLOGO DE LOS TRES TIPOS QUE EL PRODUCTO
// SOPORTA HOY, con su etiqueta, su ícono y su regla de negocio en cliente. La
// verdad sigue siendo el string: `PosOrderType.takeaway == 'TAKEAWAY'`.

import 'package:flutter/material.dart';

/// Tipos de pedido que el mostrador sabe construir.
enum PosOrderType {
  /// Para llevar. Lo más rápido de vender: no necesita silla ni mapa.
  takeaway('TAKEAWAY', 'Para llevar', Icons.takeout_dining_rounded),

  /// En el local. Puede llevar `tableLabel`; la silla es opcional.
  dineIn('DINE_IN', 'En el local', Icons.table_restaurant_rounded),

  /// Alquiler de silla. OBLIGATORIO `chairId` + `reservationId` (API.md §7.12).
  chairRental(
    'CHAIR_RENTAL',
    'Alquiler de silla',
    Icons.event_seat_rounded,
  );

  const PosOrderType(this.apiValue, this.label, this.icon);

  /// Literal exacto que viaja en el body de `POST /orders`.
  final String apiValue;

  /// Etiqueta visible para el cajero.
  final String label;

  /// Ícono del selector. Tercer canal además del color del chip.
  final IconData icon;

  /// `true` si el tipo obliga a elegir silla antes de cobrar.
  bool get requiresChair => this == PosOrderType.chairRental;

  /// `true` si el tipo obliga a una reserva (API.md §7.12 exige `chairId` Y
  /// `reservationId` cuando `type = CHAIR_RENTAL`).
  bool get requiresReservation => this == PosOrderType.chairRental;

  /// `true` si el backend prohíbe mandar `chairId` (se ignora con warning).
  bool get forbidsChair => this == PosOrderType.takeaway;
}
