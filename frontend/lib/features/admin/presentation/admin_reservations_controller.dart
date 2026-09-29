// Estado de Reservas y Alquileres del panel. MÓDULO `features/admin/presentation`.
//
// SEPARADO DE SILLAS POR UNA RAZÓN CONCRETA
// Las sillas se cambian de estado desde el mapa; las reservas se gestionan desde
// una lista con fechas. Compartían archivo, las dos pantallas tocaban providers de
// la otra y cualquier cambio obligaba a leer 300 líneas para no romper nada.
//
// RESERVA Y ALQUILER NO SON LO MISMO
//   - La RESERVA es una ventana futura: se confirma, se extiende y se cancela.
//   - El ALQUILER es una sesión en curso: se extiende cobrando el extra y se cierra
//     calculando el cobro real (BR-RENTAL-003/004).
// Extender la reserva de un alquiler ACTIVO da `422
// RESERVATION_ALREADY_ACTIVE`: el camino correcto es extender el alquiler.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/admin_rentals.dart';
import '../domain/entities/admin_spaces.dart';
import './admin_providers.dart';
import './admin_spaces_controller.dart';

/// Alquileres en curso, los que llevan el temporizador en vivo.
final FutureProvider<List<AdminRental>> adminActiveRentalsProvider =
    FutureProvider<List<AdminRental>>(
  (Ref ref) async {
    final int? locationId = await ref.watch(adminLocationIdProvider.future);
    final Result<List<AdminRental>> result =
        await ref.watch(adminSpacesRepositoryProvider).activeRentals(
              locationId: locationId,
            );
    return switch (result) {
      Success<List<AdminRental>>(:final List<AdminRental> value) => value,
      FailureResult<List<AdminRental>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminActiveRentals',
);

/// Reservas en la ventana por defecto: desde hace una semana hasta dentro de un
/// mes. Es lo que un mostrador necesita: lo pasado ya no se gestiona y lo lejano no
/// se puede confirmar todavía.
final FutureProvider<List<AdminReservation>> adminReservationsProvider =
    FutureProvider<List<AdminReservation>>(
  (Ref ref) async {
    final DateTime now = DateTime.now();
    final Result<List<AdminReservation>> result =
        await ref.watch(adminSpacesRepositoryProvider).reservations(
              from: now.subtract(const Duration(days: 7)),
              to: now.add(const Duration(days: 30)),
              status: ref.watch(adminReservationStatusProvider),
            );
    return switch (result) {
      Success<List<AdminReservation>>(:final List<AdminReservation> value) => value,
      FailureResult<List<AdminReservation>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminReservations',
);

/// Filtro de reservas por estado. `null` = todas.
final StateProvider<String?> adminReservationStatusProvider =
    StateProvider<String?>((Ref ref) => null);

/// Acciones de una reserva (confirmar, check-in, extender, cancelar).
final AsyncNotifierProviderFamily<AdminReservationController, void, int>
    adminReservationProvider =
    AsyncNotifierProvider.family<AdminReservationController, void, int>(
  AdminReservationController.new,
);

/// Controla las acciones de una reserva.
class AdminReservationController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// `POST /reservations/:id/confirm`.
  Future<bool> confirm() => _run(
        () => ref.read(adminSpacesRepositoryProvider).confirmReservation(arg),
      );

  /// `POST /reservations/:id/check-in` — activa la reserva y abre el alquiler.
  Future<bool> checkIn() => _run(
        () => ref.read(adminSpacesRepositoryProvider).checkInReservation(arg),
      );

  /// `POST /reservations/:id/extend`.
  ///
  /// Da `422 RESERVATION_ALREADY_ACTIVE` si el alquiler ya arrancó: ahí el camino
  /// correcto es `POST /rentals/:id/extend` (ver `admin_rental_controller.dart`).
  Future<bool> extend(DateTime newEndAt) => _run(
        () => ref
            .read(adminSpacesRepositoryProvider)
            .extendReservation(arg, newEndAt),
      );

  /// `POST /reservations/:id/cancel`. El motivo es obligatorio.
  Future<bool> cancel(String reason) => _run(
        () => ref.read(adminSpacesRepositoryProvider).cancelReservation(
              arg,
              reason,
            ),
      );

  Future<bool> _run(Future<Result<void>> Function() action) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await action();
    // Sin guarda de disposal: el provider de acciones de reserva no es
    // `autoDispose`, así que el notifier sobrevive a cualquier `await`.
    switch (result) {
      case Success<void>():
        ref.invalidate(adminReservationsProvider);
        ref.invalidate(adminChairsProvider);
        ref.invalidate(adminActiveRentalsProvider);
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  void acknowledge() => state = const AsyncData<void>(null);
}
