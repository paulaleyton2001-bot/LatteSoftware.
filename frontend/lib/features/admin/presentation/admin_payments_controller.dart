// Estado de la pantalla de Pagos del panel.
//
// EL REEMBOLSO ES LO QUE HACE INTERESANTE ESTA PANTALLA
// Listar pagos es leer. Reembolsar es escribir, y por eso tiene su propio
// `AsyncNotifier` con permiso propio (`payments:refund`, MANAGER+): si el usuario
// no lo tiene, el botón desaparece ANTES de llamar, y si aun así llegara, el
// backend responde `403` y el mensaje se muestra tal cual.
//
// EL SALDO REEMBOLSABLE LO CALCULA LA PANTALLA, PERO NO LO DECIDE
// `amountMinor - refundedMinor` es una resta, no una regla: el backend la aplica
// igual y devuelve `422 REFUND_EXCEEDS_PAID` si se pasa. El diálogo precarga ese
// saldo como importe MÁXIMO, que es lo que evita el error, y la validación real
// sigue siendo del servidor.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/admin_payments.dart';
import './admin_providers.dart';

/// Filtro por método de pago. `null` = todos.
final StateProvider<String?> adminPaymentMethodFilterProvider =
    StateProvider<String?>((Ref ref) => null);

/// Filtro por estado de pago. `null` = todos.
final StateProvider<String?> adminPaymentStatusFilterProvider =
    StateProvider<String?>((Ref ref) => null);

/// Texto de búsqueda por referencia.
final StateProvider<String> adminPaymentSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Listado de pagos con filtros.
final FutureProvider<List<AdminPayment>> adminPaymentsProvider =
    FutureProvider<List<AdminPayment>>(
  (Ref ref) async {
    final Result<List<AdminPayment>> result =
        await ref.watch(adminOpsRepositoryProvider).payments(
              method: ref.watch(adminPaymentMethodFilterProvider),
              status: ref.watch(adminPaymentStatusFilterProvider),
            );
    return switch (result) {
      Success<List<AdminPayment>>(:final List<AdminPayment> value) => value,
      FailureResult<List<AdminPayment>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminPayments',
);

/// Pagos ya filtrados por la búsqueda de referencia.
///
/// El resto de filtros van al SERVIDOR (son los del endpoint) y la búsqueda va en
/// memoria: escribir en un campo no puede disparar una petición por tecla.
/// Pagos ya filtrados por la búsqueda de referencia.
///
/// El resto de filtros van al SERVIDOR (son los del endpoint) y la búsqueda va en
/// memoria: escribir en un campo no puede disparar una petición por tecla.
final Provider<List<AdminPayment>> adminVisiblePaymentsProvider =
    Provider<List<AdminPayment>>((Ref ref) {
  final List<AdminPayment> all =
      ref.watch(adminPaymentsProvider).valueOrNull ?? const <AdminPayment>[];
  final String needle = ref.watch(adminPaymentSearchProvider).trim().toLowerCase();
  if (needle.isEmpty) return all;
  return <AdminPayment>[
    for (final AdminPayment payment in all)
      if (matchesPaymentSearch(payment, needle)) payment,
  ];
}, name: 'adminVisiblePayments');

/// `true` si [payment] coincide con la búsqueda [needle].
///
/// Se separa del provider para que la regla sea comprobable sin montar un árbol de
/// widgets: número de pago, referencia de caja, referencia del datáfono y número de
/// pedido. Son los cuatro campos con los que alguien busca un cobro.
bool matchesPaymentSearch(AdminPayment payment, String needle) {
  final String haystack = <String>[
    payment.paymentNumber ?? '',
    payment.referenceNumber ?? '',
    payment.providerReference ?? '',
    payment.orderNumber ?? '',
  ].join(' ').toLowerCase();
  return haystack.contains(needle);
}

/// Totales del listado, en centavos, para la cabecera.
class AdminPaymentsTotals {
  const AdminPaymentsTotals({
    this.approvedMinor = 0,
    this.refundedMinor = 0,
    this.count = 0,
  });

  final int approvedMinor;
  final int refundedMinor;
  final int count;

  /// Neto cobrado, ya descontados los reembolsos.
  int get netMinor => approvedMinor - refundedMinor;

  static AdminPaymentsTotals of(List<AdminPayment> payments) {
    int approved = 0;
    int refunded = 0;
    for (final AdminPayment payment in payments) {
      if (payment.status == 'APPROVED' ||
          payment.status == 'PARTIALLY_REFUNDED') {
        approved += payment.amountMinor;
      }
      refunded += payment.refundedMinor;
    }
    return AdminPaymentsTotals(
      approvedMinor: approved,
      refundedMinor: refunded,
      count: payments.length,
    );
  }
}

final Provider<AdminPaymentsTotals> adminPaymentsTotalsProvider =
    Provider<AdminPaymentsTotals>((Ref ref) {
  return AdminPaymentsTotals.of(
    ref.watch(adminVisiblePaymentsProvider),
  );
}, name: 'adminPaymentsTotals');

/// Reembolso de un pago. `AsyncNotifierProvider.family`: el estado de "reembolsando"
/// es POR PAGO, para no bloquear la fila de los demás.
final AsyncNotifierProviderFamily<AdminRefundController, void, int>
    adminRefundProvider =
    AsyncNotifierProvider.family<AdminRefundController, void, int>(
  AdminRefundController.new,
);

/// Controla el reembolso total o parcial de un pago.
class AdminRefundController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// `POST /payments/:id/refund`.
  ///
  /// [amountMinor] es el importe a devolver; el backend no deja pasar más de
  /// `amountMinor - refundedMinor` (BR-PAY-006). [reason] es obligatorio (2-300).
  Future<bool> refund({
    required int amountMinor,
    required String reason,
  }) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await ref
        .read(adminOpsRepositoryProvider)
        .refund(
          paymentId: arg,
          amountMinor: amountMinor,
          reason: reason,
        );
    // Sin guarda de disposal: `adminRefundProvider` no es `autoDispose`, así que
    // el notifier sobrevive al reembolso.
    switch (result) {
      case Success<void>():
        ref.invalidate(adminPaymentsProvider);
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  /// Limpia el error tras mostrarlo.
  void acknowledge() => state = const AsyncData<void>(null);
}

/// Etiquetas legibles de `PaymentMethod` y `PaymentStatus`.
const Map<String, String> kAdminPaymentMethodLabels = <String, String>{
  'CASH': 'Efectivo',
  'CARD': 'Tarjeta',
  'TRANSFER': 'Transferencia',
  'ONLINE': 'En línea',
};

const Map<String, String> kAdminPaymentStatusLabels = <String, String>{
  'PENDING': 'Pago pendiente',
  'APPROVED': 'Pagado',
  'FAILED': 'Pago fallido',
  'REFUNDED': 'Reembolsado',
  'PARTIALLY_REFUNDED': 'Reembolsado',
  'CANCELLED': 'Cancelado',
};
