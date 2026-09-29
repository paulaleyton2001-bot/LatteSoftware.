// Tipo de pedido y flujo del checkout. Módulo `features/checkout/domain`.

import 'package:flutter/material.dart';
//
// `OrderType` NO es un enum de Dart con `switch`: los literales exactos son los
// de `OrderType` en `API.md` §6.2 (`TAKEAWAY`, `DINE_IN`, `CHAIR_RENTAL`) y
// llegan como `String` en `GET /orders`. Un enum obligaría a parsear y a
//converter en cada frontera, y un valor nuevo del backend dejaría al cliente sin
// poder ni pintar la orden. Se comparan literales, que es lo que hace `User`
// con `roles` y `permissions` por el mismo motivo.


/// Tipo de pedido (`OrderType`, API.md §6.2).
@immutable
class OrderTypeOption {
  const OrderTypeOption({
    required this.type,
    required this.label,
    required this.description,
    required this.icon,
  });

  /// Literal que se manda en `POST /orders` (`type`).
  final String type;

  /// Texto de la tarjeta.
  final String label;

  /// Una línea que explica qué pasa: es la decisión que más anxiety genera.
  final String description;

  final IconData icon;

  /// `true` si este tipo implica ELEGIR una silla (y por tanto una duración).
  bool get needsChair =>
      type == 'DINE_IN' || type == 'CHAIR_RENTAL';

  /// `true` si este tipo implica ALQUILAR la silla por tiempo (y no solo
  /// consumirse en ella).
  bool get isRental => type == 'CHAIR_RENTAL';

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is OrderTypeOption && other.type == type;

  @override
  int get hashCode => type.hashCode;

  @override
  String toString() => 'OrderTypeOption($type)';
}

/// Las tres opciones de tipo de pedido, en el orden en que se pintan.
const List<OrderTypeOption> kOrderTypeOptions = <OrderTypeOption>[
  OrderTypeOption(
    type: 'TAKEAWAY',
    label: 'Para llevar',
    description: 'Te lo preparamos y te lo llevas.',
    icon: Icons.takeout_dining_rounded,
  ),
  OrderTypeOption(
    type: 'DINE_IN',
    label: 'Consumir aquí',
    description: 'Te sientas en el local el tiempo que quieras.',
    icon: Icons.restaurant_rounded,
  ),
  OrderTypeOption(
    type: 'CHAIR_RENTAL',
    label: 'Reservar silla',
    description: 'Alquilas tu silla por el tiempo que elijas.',
    icon: Icons.event_seat_rounded,
  ),
];

/// Opciones de duración del alquiler. `null` en [minutes] = "personalizado".
@immutable
class DurationOption {
  const DurationOption({required this.label, this.minutes, this.custom = false});

  final String label;

  /// Minutos reservados. `null` si es la opción personalizada.
  final int? minutes;

  final bool custom;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is DurationOption && other.minutes == minutes && other.custom == custom;

  @override
  int get hashCode => Object.hash(minutes, custom);

  @override
  String toString() => 'DurationOption($label)';
}

/// Duridades ofrecidas. Los valores salen de la práctica del local y del mínimo
/// de 30 min que el servidor aplica al cobrar (`billableMinutes`, API.md §7.8).
const List<DurationOption> kDurationOptions = <DurationOption>[
  DurationOption(label: '30 min', minutes: 30),
  DurationOption(label: '1 h', minutes: 60),
  DurationOption(label: '2 h', minutes: 120),
  DurationOption(label: '3 h', minutes: 180),
  DurationOption(label: '4 h', minutes: 240),
  DurationOption(label: 'Otro', custom: true),
];

/// Topes de la duración personalizada. El servidor rechaza con
/// `422 RESERVATION_TOO_LONG` lo que supere `businesses.maxReservationMinutes`
/// (1-1440), así que la UI no deja escribir por encima de un día.
const int kMinRentalMinutes = 15;
const int kMaxRentalMinutes = 1440;
