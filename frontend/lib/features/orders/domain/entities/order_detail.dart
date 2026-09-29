// Detalle de un pedido (`GET /orders/:id`). Módulo `features/orders/domain`.
//
// Se separa de `OrderSummary` porque el detalle trae cosas que el resumen no
// tiene: `items[]` con sus complementos, `chair`, `reservation`, `rental` y
// `payments[]`. Mezclarlas haría `items` nullable en todas partes y ocultaría
// exactamente lo que la pantalla de detalle existe para mostrar.


import 'package:flutter/foundation.dart';
import './order_item.dart';
import './order_summary.dart';
import './payment_record.dart';
import './rental.dart';

/// Pedido completo.
@immutable
class OrderDetail {
  const OrderDetail({
    required this.summary,
    this.items = const <OrderItem>[],
    this.rental,
    this.payments = const <PaymentRecord>[],
    this.couponCode,
    this.customerNotes,
    this.notes,
    this.reservationCode,
    this.rentalCode,
    this.tableLabel,
    this.serviceFeeMinor = 0,
    this.subtotalMinor = 0,
    this.discountMinor = 0,
    this.taxMinor = 0,
  });

  /// Datos de cabecera (los mismos del listado).
  final OrderSummary summary;

  final List<OrderItem> items;

  /// Alquiler de silla asociado, si lo hay. Es lo que activa el temporizador.
  final Rental? rental;

  final List<PaymentRecord> payments;

  final String? couponCode;
  final String? customerNotes;

  /// Notas internas del negocio. NO se pintan: son para el personal.
  final String? notes;

  final String? reservationCode;
  final String? rentalCode;
  final String? tableLabel;

  final int subtotalMinor;
  final int discountMinor;
  final int taxMinor;
  final int serviceFeeMinor;

  /// `true` si el pedido tiene un alquiler de silla VIVO (temporizador en marcha).
  bool get hasLiveRental => rental != null && rental!.isLive;

  /// Total de artículos, como `double`.
  ///
  /// Lo es porque [OrderItem.quantity] también lo es: una línea puede pesar medio
  /// kilo de café, y sumar `0.5` dentro de un `int` lo truncaría a cero. Quien
  /// pinte un CONTADOR entero redondea al presentar, no al calcular.
  double get totalQuantity =>
      items.fold<double>(0, (double acc, OrderItem item) => acc + item.quantity);

  /// Suma de pagos aprobados, en centavos. `0` mientras no se haya cobrado nada
  /// en el local.
  int get paidMinor => payments
      .where((PaymentRecord p) => p.status == 'APPROVED' || p.isRefund)
      .fold<int>(0, (int acc, PaymentRecord p) => acc + p.amountMinor);

  /// Saldo pendiente, según los pagos registrados.
  int get balanceMinor => (summary.totalMinor - paidMinor).clamp(0, summary.totalMinor);
}
