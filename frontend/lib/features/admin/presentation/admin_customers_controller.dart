// Estado de la pantalla de Clientes del panel.
//
// ⚠️ EL HISTORIAL ES UNA UNIÓN DE TRES LLAMADAS
// `docs/API.md` §7.3 promete `GET /customers/:id/orders`, `/:id/reservations`,
// `/:id/rentals` y `/:id/payments`, pero NO EXISTEN en el router real del backend
// (lo declara la cabecera de `customers.routes.ts`: los datos están en el
// repositorio, el endpoint no se montó). Por eso `customerHistoryProvider`
// compone los LISTADOS por `customerId`, que sí existen, y los pagos se piden por
// pedido porque `GET /payments` no tiene filtro `customerId`.
//
// Cuando el backend exponga los cuatro endpoints, cambia SOLO este archivo: las
// pantallas consumen `CustomerHistory` y no saben de dónde sale.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/admin_accounts.dart';
import '../domain/entities/admin_catalog.dart';
import '../domain/entities/admin_history.dart';
import '../domain/entities/admin_payments.dart';
import './admin_providers.dart';

/// Búsqueda de clientes por nombre, correo o teléfono.
final StateProvider<String> adminCustomerSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Filtro por estado de la cuenta. `null` = todos.
final StateProvider<String?> adminCustomerStatusProvider =
    StateProvider<String?>((Ref ref) => null);

/// Listado de clientes.
final FutureProvider<List<AdminCustomer>> adminCustomersProvider =
    FutureProvider<List<AdminCustomer>>(
  (Ref ref) async {
    final Result<List<AdminCustomer>> result =
        await ref.watch(adminDirectoryRepositoryProvider).customers(
              status: ref.watch(adminCustomerStatusProvider),
            );
    return switch (result) {
      Success<List<AdminCustomer>>(:final List<AdminCustomer> value) => value,
      FailureResult<List<AdminCustomer>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminCustomers',
);

/// Clientes tras la búsqueda en memoria.
final Provider<List<AdminCustomer>> adminVisibleCustomersProvider =
    Provider<List<AdminCustomer>>((Ref ref) {
  final List<AdminCustomer> all =
      ref.watch(adminCustomersProvider).valueOrNull ?? const <AdminCustomer>[];
  final String needle =
      ref.watch(adminCustomerSearchProvider).trim().toLowerCase();
  if (needle.isEmpty) return all;
  return <AdminCustomer>[
    for (final AdminCustomer customer in all)
      if ('${customer.fullName} ${customer.email} ${customer.phone ?? ''}'
          .toLowerCase()
          .contains(needle))
        customer,
  ];
}, name: 'adminVisibleCustomers');

/// Ficha de un cliente.
final FutureProviderFamily<AdminCustomer?, int> adminCustomerProvider =
    FutureProvider.family<AdminCustomer?, int>(
  (Ref ref, int customerId) async {
    final Result<AdminCustomer?> result =
        await ref.watch(adminDirectoryRepositoryProvider).customer(customerId);
    return switch (result) {
      Success<AdminCustomer?>(:final AdminCustomer? value) => value,
      FailureResult<AdminCustomer?>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminCustomer',
);

/// Historial completo del cliente (pedidos, reservas y alquileres).
final FutureProviderFamily<CustomerHistory, int> adminCustomerHistoryProvider =
    FutureProvider.family<CustomerHistory, int>(
  (Ref ref, int customerId) async {
    final Result<CustomerHistory> result =
        await ref.watch(adminDirectoryRepositoryProvider).customerHistory(
              customerId,
            );
    return switch (result) {
      Success<CustomerHistory>(:final CustomerHistory value) => value,
      FailureResult<CustomerHistory>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminCustomerHistory',
);

/// Pagos de los pedidos de un cliente.
///
/// Es un `FutureProvider.family` NORMAL, no derivado del historial, porque necesita
/// los ids de pedido: pedirlo "en cascada" añadiría una segunda espera al abrir la
/// ficha. Se dispara en paralelo desde la pantalla.
final FutureProviderFamily<List<AdminPayment>, List<int>>
    adminCustomerPaymentsProvider =
    FutureProvider.family<List<AdminPayment>, List<int>>(
  (Ref ref, List<int> orderIds) async {
    if (orderIds.isEmpty) return const <AdminPayment>[];
    final Result<List<AdminPayment>> result =
        await ref
            .read(adminDirectoryRepositoryProvider)
            .paymentsOfOrders(orderIds);
    return switch (result) {
      Success<List<AdminPayment>>(:final List<AdminPayment> value) => value,
      FailureResult<List<AdminPayment>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminCustomerPayments',
);

/// Resumen de la ficha, con los totales del historial ya sumados.
class AdminCustomerSummary {
  const AdminCustomerSummary({
    required this.customer,
    required this.history,
    this.payments = const <AdminPayment>[],
  });

  final AdminCustomer customer;
  final CustomerHistory history;
  final List<AdminPayment> payments;

  /// Gasto total en centavos, sumando lo pagado de cada pedido.
  int get spentMinor => history.totalSpentMinor;

  /// Ticket promedio en centavos. `0` si no hay pedidos: dividir por cero daría
  /// `NaN`, que se pinta como "NaN $".
  int get averageTicketMinor =>
      history.totalOrders == 0 ? 0 : history.totalSpentMinor ~/ history.totalOrders;

  /// Minutos de silla alquilados, cerrados y en curso.
  int get rentalMinutes => history.totalRentalMinutes;

  /// Ids de pedido del cliente, para pedir sus pagos.
  List<int> get orderIds => <int>[
        for (final AdminOrder order in history.orders) order.id,
      ];
}
