// Estado de la pantalla de Órdenes del panel.
//
// UN SOLO ESTADO PARA LISTA Y DETALLE
// El listado, el detalle y el cambio de estado salen de la misma fuente
// (`adminOrdersProvider`). Al cambiar un estado se invalida la lista y el detalle,
// y no al revés: si fueran dos providers, un pedido recién actualizado aparecería
// con su estado viejo en una de las dos pantallas.
//
// LOS FILTROS SON ESTADO DE PANTALLA, NO DE NEGOCIO
// `StateProvider`: no se persisten, no los lee nadie más y no necesitan un
// `Notifier`. El RANGO DE FECHAS sí se materializa en un `AdminDateRange` que se
// envía como `from`/`to` ISO, porque el backend filtra por fechas reales.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../core/utils/date_formatter.dart';
import '../domain/entities/admin_catalog.dart';
import '../domain/entities/admin_order_detail.dart';
import './admin_providers.dart';

/// Filtro por estado de pedido. `null` = todos.
final StateProvider<String?> adminOrderStatusFilterProvider =
    StateProvider<String?>((Ref ref) => null);

/// Filtro por tipo de pedido. `null` = todos.
final StateProvider<String?> adminOrderTypeFilterProvider =
    StateProvider<String?>((Ref ref) => null);

/// Preset de rango de fechas. `null` = sin filtro de fecha.
final StateProvider<String?> adminOrderPresetProvider =
    StateProvider<String?>((Ref ref) => 'today');

/// Rango personalizado, usado solo con `preset = 'custom'`.
final StateProvider<DateRange> adminOrderRangeProvider =
    StateProvider<DateRange>((Ref ref) => DateRange.today());

/// Texto de búsqueda (número de pedido o nota del cliente).
final StateProvider<String> adminOrderSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Rango de fechas resuelto a los parámetros que espera `GET /orders`.
class DateRange {
  const DateRange({required this.from, required this.to});

  /// Rango de HOY completo. Los pedidos se filtran por `createdAt`.
  factory DateRange.today() {
    final DateTime now = DateTime.now();
    return DateRange(
      from: DateTime(now.year, now.month, now.day),
      to: DateTime(now.year, now.month, now.day, 23, 59, 59, 999),
    );
  }

  /// Últimos [days] días, incluido hoy.
  factory DateRange.lastDays(int days) {
    final DateTime now = DateTime.now();
    return DateRange(
      from: DateTime(now.year, now.month, now.day)
          .subtract(Duration(days: days - 1)),
      to: DateTime(now.year, now.month, now.day, 23, 59, 59, 999),
    );
  }

  final DateTime from;
  final DateTime to;

  /// Texto legible para el botón de filtro.
  String get label => '${DateFormatter.date(from)} – ${DateFormatter.date(to)}';
}

/// Listado de pedidos con todos los filtros aplicados.
///
/// `pageSize: 100` es el máximo del endpoint. Con los filtros del panel, el
/// listado cabe en una página y no hace falta paginar.
final FutureProvider<List<AdminOrder>> adminOrdersProvider =
    FutureProvider<List<AdminOrder>>(
  (Ref ref) async {
    final String? preset = ref.watch(adminOrderPresetProvider);
    final DateRange? range = preset == 'custom'
        ? ref.watch(adminOrderRangeProvider)
        : null;
    final Result<List<AdminOrder>> result =
        await ref.watch(adminOpsRepositoryProvider).orders(
              status: ref.watch(adminOrderStatusFilterProvider),
              type: ref.watch(adminOrderTypeFilterProvider),
              query: ref.watch(adminOrderSearchProvider),
              from: range?.from,
              to: range?.to,
            );
    return switch (result) {
      Success<List<AdminOrder>>(:final List<AdminOrder> value) => value,
      FailureResult<List<AdminOrder>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminOrders',
);

/// Detalle de un pedido. `getOrder(id)` lo invalida tras cambiar el estado.
final FutureProviderFamily<AdminOrderDetail, int> adminOrderDetailProvider =
    FutureProvider.family<AdminOrderDetail, int>(
  (Ref ref, int orderId) async {
    final Result<Map<String, dynamic>> result =
        await ref.watch(adminOpsRepositoryProvider).order(orderId);
    return switch (result) {
      Success<Map<String, dynamic>>(:final Map<String, dynamic> value) =>
        AdminOrderDetail.fromJson(value, orderId),
      FailureResult<Map<String, dynamic>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminOrderDetail',
);

/// Cambio de estado de un pedido.
///
/// `AsyncNotifierProvider.family` por pedido: el estado de "cambiando" es POR
/// pedido, no global. Con un `AsyncNotifier` único, tocar un pedido en la lista
/// apagaría todos los botones de la pantalla.
final AsyncNotifierProviderFamily<AdminOrderStatusController, void, int>
    adminOrderStatusProvider =
    AsyncNotifierProvider.family<AdminOrderStatusController, void, int>(
  AdminOrderStatusController.new,
);

/// Controla la transición de estado de un pedido.
class AdminOrderStatusController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// `POST /orders/:id/status`.
  ///
  /// `reason` es obligatorio si el destino es `CANCELLED` o `REFUNDED`; sin él el
  /// backend responde `400`. El mensaje de error se deja tal cual: el backend
  /// escribe en español y ya dice qué pasó (`INVALID_ORDER_TRANSITION` con
  /// `details.allowed`).
  Future<bool> change(String toStatus, {String? reason, String? pin}) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await ref
        .read(adminOpsRepositoryProvider)
        .setOrderStatus(arg, toStatus, reason: reason, pin: pin);
    // Sin guarda de disposal: el provider de acciones no es `autoDispose`, así que
    // el notifier sobrevive a cualquier `await`.
    switch (result) {
      case Success<void>():
        // Listado y detalle quedan desfasados: ambos se releen.
        ref.invalidate(adminOrdersProvider);
        ref.invalidate(adminOrderDetailProvider(arg));
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  /// Limpia el error tras mostrarlo, para que la fila no quede en rojo.
  void acknowledge() => state = const AsyncData<void>(null);
}

/// Próximo estado de un pedido, o `null` si ya está cerrado.
String? nextOrderStatus(String status) => switch (status) {
      'DRAFT' => 'PENDING',
      'PENDING' => 'CONFIRMED',
      'CONFIRMED' => 'PREPARING',
      'PREPARING' => 'READY',
      'READY' => 'COMPLETED',
      _ => null,
    };

/// Etiquetas legibles de `OrderStatus` para botones y `Semantics`.
const Map<String, String> kAdminOrderStatusLabels = <String, String>{
  'DRAFT': 'Borrador',
  'PENDING': 'Pendiente',
  'CONFIRMED': 'Confirmado',
  'PREPARING': 'En preparación',
  'READY': 'Listo',
  'DELIVERING': 'En camino',
  'COMPLETED': 'Completado',
  'CANCELLED': 'Cancelado',
  'REFUNDED': 'Reembolsado',
};
