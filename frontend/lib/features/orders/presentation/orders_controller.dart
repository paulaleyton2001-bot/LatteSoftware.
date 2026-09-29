// Estado de la pestaña «Pedidos» y del detalle de un pedido.
//
// `ordersRepositoryProvider` LEE el `user.id` de la sesión en el momento de
// construirse. Como es un `Provider` normal (no `autoDispose`), se construye una
// sola vez por sesión y el id queda congelado: si el usuario cierra sesión, el
// contenedor se invalida entero (el router cambia de rama) y la siguiente
// lectura ya usa la cuenta nueva. Es lo que impide que la app pida los pagos de
// la persona anterior.



import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../data/datasources/remote/orders_remote_datasource.dart';
import '../data/repositories/orders_repository_impl.dart';
import '../domain/entities/order_detail.dart';
import '../domain/entities/order_summary.dart';
import '../domain/entities/payment_record.dart';
import '../domain/entities/rental.dart';
// `currentUserProvider` es de la feature de auth: el repositorio de pedidos
// filtra por el cliente de la sesión. Misma excepción que `home_page.dart`.
import '../../auth/presentation/auth_controller.dart';
import '../domain/repositories/orders_repository.dart';

/// Repositorio de pedidos. Punto de inyección de la feature.
final Provider<OrdersRepository> ordersRepositoryProvider =
    Provider<OrdersRepository>(
  (Ref ref) => OrdersRepositoryImpl(
    OrdersRemoteDataSource(ref.watch(apiClientProvider)),
    // `user` es `null` hasta que la sesión se resuelve; `?? 0` hace que las
    // lecturas de `customers/:id` no salgan a la red sin identidad.
    ref.watch(currentUserProvider)?.id ?? 0,
  ),
  name: 'ordersRepository',
);

/// Pestañas de la lista de pedidos.
enum OrdersFilter {
  /// Todos.
  all('Todos'),

  /// En curso: `DRAFT`, `PENDING`, `CONFIRMED`, `PREPARING`, `READY`,
  /// `DELIVERING`.
  inProgress('En curso'),

  /// Terminados: `COMPLETED` (y los cancelados se ven en "Todos").
  completed('Completados');

  const OrdersFilter(this.label);

  final String label;
}

/// Pedidos del cliente.
final FutureProvider<List<OrderSummary>> ordersProvider =
    FutureProvider<List<OrderSummary>>(
  (Ref ref) async {
    final Result<List<OrderSummary>> result =
        await ref.watch(ordersRepositoryProvider).orders();
    return switch (result) {
      Success<List<OrderSummary>>(:final List<OrderSummary> value) => value,
      FailureResult<List<OrderSummary>>(:final Failure failure) => throw failure,
    };
  },
  name: 'orders',
);

/// Detalle de un pedido.
final FutureProviderFamily<OrderDetail, int> orderDetailProvider =
    FutureProvider.family<OrderDetail, int>(
  (Ref ref, int orderId) async {
    final Result<OrderDetail> result =
        await ref.watch(ordersRepositoryProvider).order(orderId);
    return switch (result) {
      Success<OrderDetail>(:final OrderDetail value) => value,
      FailureResult<OrderDetail>(:final Failure failure) => throw failure,
    };
  },
  name: 'orderDetail',
);

/// Historial de pagos hechos en el local.
final FutureProvider<List<PaymentRecord>> paymentsProvider =
    FutureProvider<List<PaymentRecord>>(
  (Ref ref) async {
    final Result<List<PaymentRecord>> result =
        await ref.watch(ordersRepositoryProvider).payments();
    return switch (result) {
      Success<List<PaymentRecord>>(:final List<PaymentRecord> value) => value,
      FailureResult<List<PaymentRecord>>(:final Failure failure) => throw failure,
    };
  },
  name: 'payments',
);

/// Extensión de un alquiler en curso.
///
/// `AsyncNotifier<Duration?>`: `null` = sin extensión pendiente; `Duration` =
/// minutos añadidos. Un `data` con valor significa "el servidor ya confirmó la
/// extensión". `loading` = en curso; `error` = el `403` de `rentals:extend` (un
/// `CUSTOMER` no puede) o un conflicto de silla.
final AsyncNotifierProviderFamily<ExtendRentalController, Duration?, Rental>
    extendRentalProvider =
    AsyncNotifierProvider.family<ExtendRentalController, Duration?, Rental>(
  ExtendRentalController.new,
);

/// Controla la extensión de un alquiler.
class ExtendRentalController extends FamilyAsyncNotifier<Duration?, Rental> {
  @override
  FutureOr<Duration?> build(Rental arg) => null;

  /// `POST /rentals/:id/extend` con [additionalMinutes].
  ///
  /// El backend revalida que la ventana nueva no choque con otra reserva o
  /// alquiler y responde `409 CHAIR_ALREADY_RESERVED` si es el caso; ese `409`
  /// llega a la UI como `ConflictFailure` y el mensaje dice que elija otra silla o
  /// pregunte en el mostrador.
  Future<void> extend(int rentalId, int additionalMinutes) async {
    state = const AsyncLoading<Duration?>();
    final Result<Rental> result = await ref
        .read(ordersRepositoryProvider)
        .extendRental(rentalId, additionalMinutes);
    // Sin guarda de disposal: el provider de extender no es `autoDispose`, así que
    // el notifier sobrevive a la llamada.
    // Tras extender, el detalle del pedido y el mapa quedan desfasados: se
    // invalidan para que la pantalla muestre la ventana nueva.
    ref.invalidate(orderDetailProvider);
    state = switch (result) {
      Success<Rental>() => AsyncData<Duration?>(
          Duration(minutes: additionalMinutes.clamp(5, 1440)),
        ),
      FailureResult<Rental>(:final Failure failure) =>
        AsyncError<Duration?>(failure, StackTrace.current),
    };
  }
}

/// Filtro activo de la lista de pedidos.
///
/// `StateProvider` porque es un valor de la PANTALLA (una pestaña), no estado de
/// negocio: no se persiste, no lo lee nadie más y no necesita un `Notifier`.
final StateProvider<OrdersFilter> ordersFilterProvider =
    StateProvider<OrdersFilter>((Ref ref) => OrdersFilter.all);

/// Pedidos ya filtrados por la pestaña activa.
final Provider<List<OrderSummary>> filteredOrdersProvider =
    Provider<List<OrderSummary>>((Ref ref) {
  final List<OrderSummary> all =
      ref.watch(ordersProvider).valueOrNull ?? const <OrderSummary>[];
  return switch (ref.watch(ordersFilterProvider)) {
    OrdersFilter.all => all,
    OrdersFilter.inProgress =>
      all.where((OrderSummary o) => o.isInProgress).toList(growable: false),
    OrdersFilter.completed =>
      all.where((OrderSummary o) => o.isClosed).toList(growable: false),
  };
}, name: 'filteredOrders');

/// Conteo por pestaña, para los rótulos ("En curso (2)").
@immutable
class OrdersCounts {
  const OrdersCounts({this.all = 0, this.inProgress = 0, this.completed = 0});

  final int all;
  final int inProgress;
  final int completed;
}

/// Recuento de pedidos por estado.
final Provider<OrdersCounts> ordersCountsProvider = Provider<OrdersCounts>(
  (Ref ref) {
    final List<OrderSummary> all =
        ref.watch(ordersProvider).valueOrNull ?? const <OrderSummary>[];
    return OrdersCounts(
      all: all.length,
      inProgress: all.where((OrderSummary o) => o.isInProgress).length,
      completed: all.where((OrderSummary o) => o.isClosed).length,
    );
  },
  name: 'ordersCounts',
);
