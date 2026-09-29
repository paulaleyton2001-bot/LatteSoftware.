// Implementación de `ProfileRepository`. Módulo `features/profile/data`.
//
// NINGÚN MÉTODO LANZA: `Result<T>` siempre, con `ApiException` como única puerta
// de entrada de los fallos de red.

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/customer_stats.dart';
import '../../domain/repositories/profile_repository.dart';
import '../datasources/remote/profile_remote_datasource.dart';

/// Repositorio del perfil sobre el datasource remoto.
class ProfileRepositoryImpl implements ProfileRepository {
  const ProfileRepositoryImpl(this._remote, this._customerId);

  final ProfileRemoteDataSource _remote;

  /// `id` del cliente autenticado. `0` = sin sesión: las lecturas que lo
  /// necesitan se cortan antes de salir a la red.
  final int _customerId;

  @override
  Future<Result<CustomerStats>> stats() => _guard(() async {
        return Success<CustomerStats>(await _remote.myStats());
      });

  @override
  Future<Result<List<CustomerReservation>>> reservations() => _guard(() async {
        if (_customerId <= 0) {
          return const Success<List<CustomerReservation>>(<CustomerReservation>[]);
        }
        return Success<List<CustomerReservation>>(
          await _remote.reservations(_customerId),
        );
      });

  @override
  Future<Result<NotificationPreferences>> notificationPreferences() =>
      _guard(() async {
        return Success<NotificationPreferences>(
          await _remote.notificationPreferences(),
        );
      });

  @override
  Future<Result<NotificationPreferences>> updateNotificationPreferences(
    NotificationPreferences preferences,
  ) =>
      _guard(() async {
        return Success<NotificationPreferences>(
          await _remote.updateNotificationPreferences(preferences.toJson()),
        );
      });

  Future<Result<T>> _guard<T>(Future<Result<T>> Function() action) async {
    try {
      return await action();
    } on Object catch (error) {
      return FailureResult<T>(ApiException.toFailure(error));
    }
  }
}
