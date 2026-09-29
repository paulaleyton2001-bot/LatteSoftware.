// Historial de un cliente. MÓDULO `features/admin/domain/entities`.
//
// Es una ENTIDAD y no un tipo del datasource porque es un concepto del dominio
// (la ficha completa de una persona), no una forma de respuesta. Vivir en
// `data/` obligaba al contrato del repositorio a importar de la capa de datos,
// que es justo la dependencia prohibida.
//
// ⚠️ ES UNA UNIÓN DE TRES LLAMADAS, NO UN ENDPOINT
// `docs/API.md` §7.3 promete `GET /customers/:id/orders`, `/:id/reservations`,
// `/:id/rentals` y `/:id/payments`, pero NO existen en el router real del backend
// (la cabecera de `customers.routes.ts` lo declara). Se compone con los listados
// por `customerId`, que sí existen.

import 'package:flutter/foundation.dart';

import './admin_catalog.dart';
import './admin_rentals.dart';
import './admin_spaces.dart';

/// Historial de un cliente: pedidos, reservas y alquileres.
///
/// Los pagos NO entran aquí: `GET /payments` no tiene filtro por cliente, así que
/// se piden por pedido.
@immutable
class CustomerHistory {
  const CustomerHistory({
    this.orders = const <AdminOrder>[],
    this.reservations = const <AdminReservation>[],
    this.rentals = const <AdminRental>[],
  });

  /// Historial vacío. Es lo que se devuelve si fallan los tres listados: mejor
  /// mostrar la ficha sin historial que la pantalla entera en error.
  static const CustomerHistory empty = CustomerHistory();

  final List<AdminOrder> orders;
  final List<AdminReservation> reservations;
  final List<AdminRental> rentals;

  bool get isEmpty =>
      orders.isEmpty && reservations.isEmpty && rentals.isEmpty;

  int get totalOrders => orders.length;
  int get totalReservations => reservations.length;
  int get totalRentals => rentals.length;

  /// Minutos de alquiler del cliente, sumando los cerrados y los en curso.
  int get totalRentalMinutes => rentals.fold<int>(
        0,
        (int acc, AdminRental rental) =>
            acc + (rental.billedMinutes > 0
                ? rental.billedMinutes
                : rental.plannedMinutes),
      );

  /// Gasto total, en centavos, sumando lo PAGADO de cada pedido (no el total: un
  /// pedido a medias no es gasto del cliente).
  int get totalSpentMinor => orders.fold<int>(
        0,
        (int acc, AdminOrder order) => acc + order.paidMinor,
      );

  @override
  String toString() =>
      'CustomerHistory($totalOrders pedidos, $totalReservations reservas)';
}
