// Implementación de `RentalRepository`. Módulo `features/chair/data`.
//
// NINGÚN MÉTODO LANZA: todo va en `Result<T>`, con `ApiException` como única
// puerta de entrada de fallos de red.

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../../orders/domain/entities/rental.dart';
import '../../domain/repositories/rental_repository.dart';
import '../datasources/remote/chair_remote_datasource.dart';

/// Repositorio de alquileres sobre el datasource remoto.
class RentalRepositoryImpl implements RentalRepository {
  const RentalRepositoryImpl(this._remote, this._customerId);

  final ChairRemoteDataSource _remote;

  /// `id` del cliente autenticado. `0` = sin sesión: no se sale a la red.
  final int _customerId;

  @override
  Future<Result<List<Rental>>> myRentals() async {
    if (_customerId <= 0) {
      return const Success<List<Rental>>(<Rental>[]);
    }
    try {
      return Success<List<Rental>>(await _remote.myRentals());
    } on Object catch (error) {
      return FailureResult<List<Rental>>(ApiException.toFailure(error));
    }
  }
}
