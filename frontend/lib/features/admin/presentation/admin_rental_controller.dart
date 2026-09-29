// Extensión y cierre de alquileres. MÓDULO `features/admin/presentation`.
//
// Ver `admin_reservations_controller.dart` para la diferencia entre reserva y
// alquiler.
//
// EL COBRO LO CALCULA EL SERVIDOR
// `POST /rentals/:id/complete` devuelve `charge` con `billedMinutes` (mínimo de 30
// aplicado), `overtimeMinutes`, `extraMinutesMinor` y el total. La app NO recalcula
// ninguno de esos valores: si los calculara en cliente, la cifra de la pantalla
// dejaría de cuadrar con la del cobro en cuanto cambiara el precio congelado.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import './admin_providers.dart';
import './admin_reservations_controller.dart';
import './admin_spaces_controller.dart';

/// Extensión y cierre de un alquiler en curso.
final AsyncNotifierProviderFamily<AdminRentalController, void, int>
    adminRentalProvider =
    AsyncNotifierProvider.family<AdminRentalController, void, int>(
  AdminRentalController.new,
);

/// Controla extender y cerrar un alquiler.
class AdminRentalController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// `POST /rentals/:id/extend`. Suma el coste al `balanceMinor` del pedido abierto.
  Future<bool> extend(int additionalMinutes) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await ref
        .read(adminSpacesRepositoryProvider)
        .extendRental(arg, additionalMinutes.clamp(5, 1440));
    // Sin guarda de disposal: `adminRentalProvider` no es `autoDispose`, así que
    // el notifier sobrevive a la llamada.
    switch (result) {
      case Success<void>():
        ref.invalidate(adminActiveRentalsProvider);
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  /// `POST /rentals/:id/complete` — cierra y calcula el cobro real.
  Future<Map<String, dynamic>?> complete({String? notes}) async {
    if (state.isLoading) return null;
    state = const AsyncLoading<void>();
    final Result<Map<String, dynamic>> result =
        await ref.read(adminSpacesRepositoryProvider).completeRental(
              arg,
              notes: notes,
            );
    // Sin guarda de disposal: `adminRentalProvider` no es `autoDispose`, así que
    // el notifier sobrevive al cierre.
    switch (result) {
      case Success<Map<String, dynamic>>(:final Map<String, dynamic> value):
        ref.invalidate(adminActiveRentalsProvider);
        ref.invalidate(adminChairsProvider);
        state = const AsyncData<void>(null);
        return value;
      case FailureResult<Map<String, dynamic>>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return null;
    }
  }

  void acknowledge() => state = const AsyncData<void>(null);
}
