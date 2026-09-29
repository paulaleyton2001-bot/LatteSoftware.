// Implementación de `BusinessRepository`. Módulo `features/home/data`.
//
// LA CACHÉ DEL NEGOCIO ES LO QUE PERMITE ABRIR LA APP SIN RED
// `PreferencesStorage.cachedBusiness` ya existía en `core/storage` para esto. El
// repositorio escribe ahí cada lectura correcta y la devuelve cuando la red
// falla. Es un dato NO sensible (el nombre y el horario de un café son públicos),
// por lo que puede ir en `shared_preferences` sin problema.

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../../../core/storage/preferences_storage.dart';
import '../../domain/entities/business_status.dart';
import '../../domain/repositories/business_repository.dart';
import '../datasources/remote/business_remote_datasource.dart';

/// Repositorio del negocio con caché local.
class BusinessRepositoryImpl implements BusinessRepository {
  const BusinessRepositoryImpl(this._remote, this._preferences);

  final BusinessRemoteDataSource _remote;
  final PreferencesStorage _preferences;

  @override
  Future<Result<BusinessStatus>> status() async {
    try {
      final BusinessStatus fresh = await _remote.status();
      // La escritura en caché no propaga: si el disco falla, la app funciona igual
      // con los datos que ya tiene en memoria.
      await _writeCache(fresh);
      return Success<BusinessStatus>(fresh);
    } on Object catch (error) {
      final BusinessStatus? cached = _readCache();
      if (cached != null) return Success<BusinessStatus>(cached);
      return FailureResult<BusinessStatus>(ApiException.toFailure(error));
    }
  }

  /// Devuelve la copia de caché, o `null` si no hay o está corrupta.
  ///
  /// `fromCache: true` en la entidad resultante: la UI lo usa para avisar
  /// "información guardada, puede estar desfasada" en lugar de fingir que es de
  /// ahora.
  BusinessStatus? _readCache() {
    final Map<String, dynamic>? json = _preferences.cachedBusiness;
    if (json == null) return null;
    return BusinessStatus.fromCache(json);
  }

  Future<void> _writeCache(BusinessStatus status) async {
    try {
      await _preferences.setCachedBusiness(status.toCacheJson());
    } on Object {
      return;
    }
  }
}
