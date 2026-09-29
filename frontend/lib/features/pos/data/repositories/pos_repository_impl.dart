// Implementación de `PosRepository` sobre el datasource remoto.
//
// NINGÚN MÉTODO LANZA. Todo va en `Result<T>`: `DioException` → `ErrorMapper`
// (vía `ApiException`) y cualquier otra excepción → `UnknownFailure`.
//
// LA REGLA DEL COBRO
// Un `402 PAYMENT_ERROR` NO se reintenta a ciegas (repetir un cobro es peor que
// tardar), y un `NetworkFailure` durante `POST /payments` es el caso AMBIGUO por
// definición: puede que el servidor lo recibiera y la respuesta se perdiera. Por
// eso la UI conserva la MISMA `Idempotency-Key` para reintentar y el backend
// responde `200` con `meta.idempotent = true` en vez de cobrar dos veces. Este
// archivo solo propaga el fallo; la política de reintento es del controlador.

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/pos_charge.dart';
import '../../domain/repositories/pos_repository.dart';
import '../../domain/repositories/pos_repository_models.dart';
import '../datasources/remote/pos_remote_datasource.dart';

/// Repositorio del mostrador.
class PosRepositoryImpl implements PosRepository {
  const PosRepositoryImpl(this._remote);

  final PosRemoteDataSource _remote;

  @override
  Future<Result<PosCatalog>> catalog() => _guard(_remote.catalog);

  @override
  Future<Result<PosOrderResult>> createOrder(PosOrderDraftRequest request) =>
      _guard(() => _remote.createOrder(request));

  @override
  Future<Result<PosChargeResult>> charge({
    required PosChargeRequest request,
    required int orderId,
    required String idempotencyKey,
  }) =>
      _guard(() => _remote.charge(
            request: request,
            orderId: orderId,
            idempotencyKey: idempotencyKey,
          ));

  @override
  Future<Result<PosOrderTransitionResult>> changeOrderStatus({
    required int orderId,
    required String toStatus,
    String? reason,
  }) =>
      _guard(() => _remote.changeOrderStatus(
            orderId: orderId,
            toStatus: toStatus,
            reason: reason,
          ));

  @override
  Future<Result<List<PosPaymentMethodOption>>> paymentMethods() =>
      _guard(_remote.paymentMethods);

  @override
  Future<Result<PosOrderResult>> createWalkInRental({
    required int chairId,
    required int plannedMinutes,
  }) =>
      _guard(() => _remote.createWalkInRental(
            chairId: chairId,
            plannedMinutes: plannedMinutes,
          ));

  @override
  Future<Result<PosReceipt>> receipt(int orderId) =>
      _guard(() => _remote.receipt(orderId));

  /// Envuelve cualquier excepción en un `FailureResult`.
  Future<Result<T>> _guard<T>(Future<T> Function() action) async {
    try {
      return Success<T>(await action());
    } on Object catch (error) {
      return FailureResult<T>(ApiException.toFailure(error));
    }
  }
}
