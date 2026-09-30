// Control de las ACCIONES sobre una silla y sobre un alquiler.
// Módulo `features/chair/presentation`.
//
// QUÉ HAY AQUÍ Y POR QUÉ NO ESTÁ EN EL DE LA RESERVA
// ----------------------------------------------------
// Son dos máquinas distintas. La reserva (`chair_booking_controller.dart`) tiene
// varias decisiones que encadenar y un estado que se va mostrando. Estas acciones son
// pulsaciones sueltas —«alquilar ahora», «extender 30 min», «terminar», «bloquear»—
// y lo que necesitan es una cosa en común: poder decir «voy», «ya está» y «ha
// fallado por esto» sin que dos de ellas se pisen.
//
// UN ESTADO POR ACCIÓN, NO UN ESTADO GLOBAL
// Cada familia de provider tiene su propio `AsyncValue`: extender no puede dejar el
// botón de «terminar» en gris, y bloquear una silla no puede borrar el error de una
// reserva que falló hace un segundo. Un único `isBusy` compartido sería la causa
// típica del «el botón no responde».
//
// EL 409 SE TRATA, NO SE ESCONDE
// `POST /rentals` sobre una silla que alguien se/ha sentado devuelve `409
// CHAIR_OCCUPIED`. El resultado del helper [_finish] es `ActionOutcome.conflict`, la
// interfaz lo explica y el mapa se refresca: la siguiente vez que se mire el plano,
// la silla ya está en `OCCUPIED` y el mensaje tiene sentido.
//
// PERO NO SE PIDE NADA QUE NO SE PUEDA HACER
// Cada método vuelve a comprobar el permiso antes de salir a la red. No es
// desconfianza del backend: es que el permiso puede haber caducado entre que se pintó
// el panel y que se pulsó (una sesión revalidada, un cambio de rol), y un `403` en
// ese punto sería una pantalla roja sin explicación.

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/customer/chair_map.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/chair_booking.dart';
import '../domain/entities/chair_capabilities.dart';
import 'chair_controller.dart';

/// Cómo ha terminado una acción. La interfaz decide el mensaje a partir de aquí.
enum ActionOutcome {
  /// La acción se aplicó en el servidor.
  done,

  /// El servidor respondió `409`: el estado cambió mientras tanto.
  conflict,

  /// El servidor respondió `403`: el permiso ya no está.
  forbidden,

  /// No había conexión, o el servidor falló.
  failed,
}

/// Resultado de una acción, con lo que la interfaz necesita para explicarla.
class ActionResult {
  const ActionResult(this.outcome, {this.failure, this.rental});

  const ActionResult.success(ChairRental? rental)
      : this(ActionOutcome.done, rental: rental);

  const ActionResult.conflict(Failure failure) : this(ActionOutcome.conflict, failure: failure);

  const ActionResult.forbidden(Failure failure) : this(ActionOutcome.forbidden, failure: failure);

  const ActionResult.failed(Failure failure) : this(ActionOutcome.failed, failure: failure);

  final ActionOutcome outcome;

  final Failure? failure;

  /// El alquiler resultante, cuando la acción fue sobre un alquiler.
  final ChairRental? rental;

  bool get isSuccess => outcome == ActionOutcome.done;

  /// `true` si el motivo es que el estado cambió: la interfaz refresca el mapa.
  bool get needsMapRefresh => outcome == ActionOutcome.conflict;

  @override
  String toString() => 'ActionResult($outcome)';
}

/// Resultado de un cambio de estado de la silla.
class ChairStatusResult {
  const ChairStatusResult(this.outcome, {this.failure, this.chair});

  final ActionOutcome outcome;
  final Failure? failure;

  /// La silla ya con el estado nuevo. El backend la devuelve entera
  /// (`PATCH /chairs/:id/status`), así que no hace falta volver a pedir el mapa.
  final ChairInfo? chair;

  bool get isSuccess => outcome == ActionOutcome.done;

  @override
  String toString() => 'ChairStatusResult($outcome)';
}

/// Acción en curso de un alquiler: extender o cerrar.
final AutoDisposeAsyncNotifierProviderFamily<RentalActionController, void, int>
    rentalActionProvider =
    AutoDisposeAsyncNotifierProvider.family<RentalActionController, void, int>(
  RentalActionController.new,
);

/// Control de las acciones sobre un alquiler (extender, cerrar).
class RentalActionController extends AutoDisposeFamilyAsyncNotifier<void, int> {
  /// `true` en cuanto el notifier se libera (Riverpod 2.5 no tiene `ref.mounted`).
  bool _disposed = false;

  @override
  Future<void> build(int rentalId) async {
    ref.onDispose(() => _disposed = true);
  }

  /// `POST /rentals/:id/extend`. Exige `rentals:extend`.
  Future<ActionResult> extend(int additionalMinutes) async {
    final ChairCapabilities caps = ref.read(chairCapabilitiesProvider);
    if (!caps.canExtendRental) {
      return ActionResult.forbidden(
        ForbiddenFailure(message: caps.extendBlockedReason ?? ''),
      );
    }
    state = const AsyncValue<void>.loading();
    final ActionResult result = await _run(
      () => ref
          .read(rentalRepositoryProvider)
          .extendRental(rentalId: arg, additionalMinutes: additionalMinutes),
    );
    return result;
  }

  /// `POST /rentals/:id/complete`. Exige `rentals:complete`.
  Future<ActionResult> complete() async {
    final ChairCapabilities caps = ref.read(chairCapabilitiesProvider);
    if (!caps.canCompleteRental) {
      return ActionResult.forbidden(
        ForbiddenFailure(message: caps.completeBlockedReason ?? ''),
      );
    }
    state = const AsyncValue<void>.loading();
    return _run(
      () => ref.read(rentalRepositoryProvider).completeRental(arg),
    );
  }

  /// Traduce un `Result` a [ActionResult] y deja el estado en listo o con error.
  Future<ActionResult> _run(
    Future<Result<ChairRental>> Function() action,
  ) async {
    final Result<ChairRental> result = await action();
    if (_disposed) return const ActionResult.success(null);
    switch (result) {
      case Success<ChairRental>(:final ChairRental value):
        state = const AsyncValue<void>.data(null);
        // El alquiler ya no es el mismo (más largo, o cerrado): el mapa, la tarjeta
        // y la lista de alquileres tienen que reflejarlo sin que nadie los recargue.
        _refreshEverything();
        return ActionResult.success(value);
      case FailureResult<ChairRental>(:final Failure failure):
        state = AsyncValue<void>.error(failure, StackTrace.current);
        return switch (failure) {
          ConflictFailure() => ActionResult.conflict(failure),
          ForbiddenFailure() => ActionResult.forbidden(failure),
          _ => ActionResult.failed(failure),
        };
    }
  }

  void _refreshEverything() {
    ref.invalidate(chairTabMapProvider);
    ref.invalidate(myRentalsProvider);
  }
}

/// Alquiler walk-in de una silla. Un provider por silla.
final AutoDisposeAsyncNotifierProviderFamily<WalkInController, void, int>
    walkInProvider =
    AutoDisposeAsyncNotifierProvider.family<WalkInController, void, int>(
  WalkInController.new,
);

/// Control del alquiler sin cita (`POST /rentals`).
class WalkInController extends AutoDisposeFamilyAsyncNotifier<void, int> {
  /// `true` en cuanto el notifier se libera (Riverpod 2.5 no tiene `ref.mounted`).
  bool _disposed = false;

  @override
  Future<void> build(int chairId) async {
    ref.onDispose(() => _disposed = true);
  }

  /// Abre el alquiler. Exige `rentals:create`, denegado a `CUSTOMER`.
  ///
  /// [customerId] se manda solo si el panel lo ha pedido (personal que asigna el
  /// alquiler a un cliente concreto). Para un `CUSTOMER` el servidor pone el suyo y
  /// mandarlo explícitamente no aportaría nada.
  Future<ActionResult> open({required int plannedMinutes, int? customerId}) async {
    final ChairCapabilities caps = ref.read(chairCapabilitiesProvider);
    if (!caps.canOpenWalkIn) {
      return ActionResult.forbidden(
        ForbiddenFailure(message: caps.walkInBlockedReason ?? ''),
      );
    }
    state = const AsyncValue<void>.loading();
    final Result<ChairRental> result = await ref
        .read(rentalRepositoryProvider)
        .openWalkInRental(
          chairId: arg,
          plannedMinutes: plannedMinutes,
          customerId: customerId,
        );
    if (_disposed) return const ActionResult.success(null);
    switch (result) {
      case Success<ChairRental>(:final ChairRental value):
        state = const AsyncValue<void>.data(null);
        // La silla pasa a `OCCUPIED` y la tarjeta «Tu silla» tiene que aparecer ya.
        ref.invalidate(chairTabMapProvider);
        ref.invalidate(myRentalsProvider);
        return ActionResult.success(value);
      case FailureResult<ChairRental>(:final Failure failure):
        state = AsyncValue<void>.error(failure, StackTrace.current);
        // `409 CHAIR_OCCUPIED`: alguien se sentó entre que se miró el plano y que se
        // pulsó. Se refresca el mapa para que el siguiente estado visto sea el real.
        if (failure is ConflictFailure ||
            failure.code == 'CHAIR_OCCUPIED') {
          ref.invalidate(chairTabMapProvider);
          ref.invalidate(chairOccupancyProvider(arg));
        }
        return switch (failure) {
          ConflictFailure() => ActionResult.conflict(failure),
          ForbiddenFailure() => ActionResult.forbidden(failure),
          _ => ActionResult.failed(failure),
        };
    }
  }
}

/// Cambio de estado de una silla. Un provider por silla.
final AutoDisposeAsyncNotifierProviderFamily<ChairStatusController, void, int>
    chairStatusProvider =
    AutoDisposeAsyncNotifierProvider.family<ChairStatusController, void, int>(
  ChairStatusController.new,
);

/// Control de `PATCH /chairs/:id/status`.
class ChairStatusController extends AutoDisposeFamilyAsyncNotifier<void, int> {
  /// `true` en cuanto el notifier se libera (Riverpod 2.5 no tiene `ref.mounted`).
  bool _disposed = false;

  @override
  Future<void> build(int chairId) async {
    ref.onDispose(() => _disposed = true);
  }

  /// Pone la silla en [status]. Exige `chairs:status:update`.
  ///
  /// `reason` es obligatorio para `BLOCKED` y `MAINTENANCE`: el backend responde
  /// `400` sin él, y la comprobación se hace antes de salir a la red para no gastar
  /// un viaje en un error que la app ya sabe de antemano.
  Future<ChairStatusResult> setStatus(String status, {String? reason}) async {
    final ChairCapabilities caps = ref.read(chairCapabilitiesProvider);
    if (!caps.canChangeChairStatus) {
      return ChairStatusResult(
        ActionOutcome.forbidden,
        failure: ForbiddenFailure(
          message: caps.chairStatusBlockedReason ?? '',
        ),
      );
    }
    if ((status == 'BLOCKED' || status == 'MAINTENANCE') &&
        (reason == null || reason.trim().isEmpty)) {
      return const ChairStatusResult(
        ActionOutcome.failed,
        failure: ValidationFailure(
          message: 'Escribe el motivo: queda en el historial de la silla.',
        ),
      );
    }

    state = const AsyncValue<void>.loading();
    final Result<ChairInfo> result = await ref
        .read(rentalRepositoryProvider)
        .setChairStatus(chairId: arg, status: status, reason: reason);
    if (_disposed) {
      return const ChairStatusResult(ActionOutcome.done);
    }
    switch (result) {
      case Success<ChairInfo>(:final ChairInfo value):
        state = const AsyncValue<void>.data(null);
        // El estado de la silla cambió: el plano y el panel abierto tienen que
        // reflejarlo. Invalidation del occupancy porque es el provider del panel.
        ref.invalidate(chairTabMapProvider);
        ref.invalidate(chairOccupancyProvider(arg));
        return ChairStatusResult(ActionOutcome.done, chair: value);
      case FailureResult<ChairInfo>(:final Failure failure):
        state = AsyncValue<void>.error(failure, StackTrace.current);
        // `422 CHAIR_HAS_ACTIVE_BOOKING` (no se puede bloquear una silla con
        // reservas) y `409 CHAIR_OCCUPIED` son los dos casos en los que el mapa
        // mostrado puede estar caducado.
        if (failure.code == 'CHAIR_HAS_ACTIVE_BOOKING' ||
            failure.code == 'CHAIR_OCCUPIED') {
          ref.invalidate(chairTabMapProvider);
          ref.invalidate(chairOccupancyProvider(arg));
        }
        return ChairStatusResult(
          switch (failure) {
            ConflictFailure() => ActionOutcome.conflict,
            ForbiddenFailure() => ActionOutcome.forbidden,
            _ => ActionOutcome.failed,
          },
          failure: failure,
        );
    }
  }
}
