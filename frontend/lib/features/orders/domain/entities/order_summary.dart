// Resumen de un pedido en lista (`GET /orders`, API.md §7.12).
//
// DISTINTO DE `OrderDetail`, Y A PROPÓSITO
// El listado devuelve un RESUMEN sin `items[]`. Mezclar las dos entidades haría
// `items` nullable en todas partes y ocultaría justo lo que la pantalla de detalle
// existe para mostrar.
//
// `status` y `type` son `String` y no enums: un valor nuevo del backend no debe
// romper el parseo, y el catálogo visual (`StatusBadge`) ya sabe caer en
// "Desconocido" con un literal que no conoce (docs/DESIGN-TOKENS §6.1).
//
// EL DINERO SIEMPRE ES `int` EN CENTAVOS
// Todo `*Minor` de la API. Se formatea solo en `PriceDisplay` /
// `CurrencyFormatter` (docs/DESIGN-TOKENS §9.1). Nunca `double`.


import 'package:flutter/foundation.dart';

/// Resumen de un pedido en la lista.
@immutable
class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.orderNumber,
    required this.status,
    required this.type,
    required this.totalMinor,
    this.channel = 'POS',
    this.chairCode,
    this.paidMinor = 0,
    this.balanceMinor = 0,
    this.itemCount = 0,
    this.placedAt,
    this.completedAt,
    this.createdAt,
  });

  final int id;

  /// `ORD-` + 6 dígitos.
  final String orderNumber;

  /// `OrderStatus`.
  final String status;

  /// `OrderType`: `TAKEAWAY`, `DINE_IN` o `CHAIR_RENTAL`.
  final String type;

  /// `OrderChannel`: `COUNTER`, `MOBILE_WEB` o `POS`.
  final String channel;

  final String? chairCode;
  final int totalMinor;
  final int paidMinor;

  /// Saldo pendiente.
  ///
  /// En la app del cliente equivale al total hasta que alguien cobra en el local:
  /// no hay pasarela, así que el pago nunca se registra desde el móvil.
  final int balanceMinor;

  final int itemCount;
  final DateTime? placedAt;
  final DateTime? completedAt;
  final DateTime? createdAt;

  /// `true` si el pedido sigue vivo (pendiente, confirmado, en preparación…).
  bool get isInProgress => inProgressStatuses.contains(status);

  /// `true` si el pedido terminó bien.
  bool get isClosed => status == 'COMPLETED';

  /// `true` si se canceló o se devolvió.
  bool get isCancelled => status == 'CANCELLED' || status == 'REFUNDED';

  /// `true` si este pedido incluye alquiler de silla.
  bool get hasChairRental => type == 'CHAIR_RENTAL';

  /// Etiqueta legible del tipo para la card.
  String get typeLabel => switch (type) {
        'TAKEAWAY' => 'Para llevar',
        'DINE_IN' => 'Consumir aquí',
        'CHAIR_RENTAL' => 'Alquiler de silla',
        _ => type,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is OrderSummary &&
          other.id == id &&
          other.status == status &&
          other.totalMinor == totalMinor;

  @override
  int get hashCode => Object.hash(id, status, totalMinor);

  @override
  String toString() => 'OrderSummary($orderNumber, $status)';
}

/// Estados que consideran el pedido "en curso" (pestaña En curso).
///
/// Es una lista y no un `switch` porque el filtro de la pestaña se aplica a una
/// lista de pedidos y recorrerla con un `switch` por cada elemento sería más
/// lento sin ganar nada.
const Set<String> inProgressStatuses = <String>{
  'DRAFT',
  'PENDING',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'DELIVERING',
};
