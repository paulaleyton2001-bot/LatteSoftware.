// Implementación de `OrdersRepository`. Módulo `features/orders/data`.
//
// NINGÚN MÉTODO LANZA. Todo va en `Result<T>`: `DioException` → `ErrorMapper`
// (vía `ApiException`), y cualquier otra excepción → `UnknownFailure`.
//
// POR QUÉ EL `customerId` SE SACA DE LA SESIÓN Y NO DE UN PARÁMETRO
// `GET /customers/:id/payments` exige un id. El único válido es el del actor: si
// la app mandara otro, el backend lo rechazaría (`customers:read` es parcial para
// `CUSTOMER`) y, más importante, la UI no debe poder pedir los pagos de otra
// persona. El id sale de `domain/entities/user.dart`, que es lo único que hay.

import '../../../../core/error/failures.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/order_detail.dart';
import '../../domain/entities/order_summary.dart';
import '../../domain/entities/payment_record.dart';
import '../../domain/entities/rental.dart';
import '../../domain/repositories/orders_repository.dart';
import '../datasources/remote/orders_remote_datasource.dart';

/// Repositorio de pedidos sobre el datasource remoto.
class OrdersRepositoryImpl implements OrdersRepository {
  const OrdersRepositoryImpl(this._remote, this._customerId);

  final OrdersRemoteDataSource _remote;

  /// `id` del cliente autenticado, resuelto al construir el repositorio. `0` si
  /// no hay sesión: en ese caso las lecturas de `customers/:id` se cortan antes
  /// de salir a la red.
  final int _customerId;

  @override
  Future<Result<List<OrderSummary>>> orders() => _guard(() async {
        return Success<List<OrderSummary>>(await _remote.orders());
      });

  @override
  Future<Result<OrderDetail>> order(int orderId) => _guard(() async {
        return Success<OrderDetail>(await _remote.order(orderId));
      });

  @override
  Future<Result<List<Rental>>> rentals() => _guard(() async {
        if (_customerId <= 0) {
          return Success<List<Rental>>(const <Rental>[]);
        }
        return Success<List<Rental>>(await _remote.rentals(customerId: _customerId));
      });

  @override
  Future<Result<Rental>> extendRental(int rentalId, int additionalMinutes) =>
      _guard(() async {
        final int minutes = additionalMinutes.clamp(5, 1440);
        return Success<Rental>(await _remote.extendRental(rentalId, minutes));
      });

  @override
  Future<Result<List<PaymentRecord>>> payments() => _guard(() async {
        if (_customerId <= 0) {
          return Success<List<PaymentRecord>>(const <PaymentRecord>[]);
        }
        return Success<List<PaymentRecord>>(await _remote.payments(_customerId));
      });

  /// Ejecuta [action]; cualquier excepción sale como `FailureResult`.
  Future<Result<T>> _guard<T>(Future<Result<T>> Function() action) async {
    try {
      return await action();
    } on Object catch (error) {
      return FailureResult<T>(_translate(ApiException.toFailure(error)));
    }
  }

  /// Ajusta el mensaje de los `403` de extensión de alquiler.
  ///
  /// `rentals:extend` está denegado a `CUSTOMER` (DESIGN.md §9.3), así que el
  /// backend responderá `403 INSUFFICIENT_PERMISSIONS`. El mensaje genérico ("no
  /// tienes permisos") no ayuda a nadie en el mostrador; aquí se dice qué hacer.
  static Failure _translate(Failure failure) {
    if (failure is! ForbiddenFailure) return failure;
    return ForbiddenFailure(
      message: 'Pedir más tiempo lo hacemos en el mostrador. Cuéntale al personal '
          'y lo amplían al instante.',
      code: failure.code,
      requestId: failure.requestId,
    );
  }
}
