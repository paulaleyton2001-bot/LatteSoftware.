// Contrato del negocio. Módulo `features/home/domain`.
//
// UNA SOLA OPERACIÓN
// `GET /business` y `GET /business/hours` siempre se piden juntos (el nombre sin
// horario no sirve de nada y el horario sin nombre no se puede atribuir), así que
// la interfaz expone una lectura compuesta en vez de dos. Quien necesite solo el
// nombre (un `KpiTile`, un log) lo obtiene de la caché de
// `PreferencesStorage.cachedBusiness` sin salir a la red.

import '../../../../core/result/result.dart';
import '../entities/business_status.dart';

/// Lecturas del local.
abstract interface class BusinessRepository {
  /// Estado del local, con su horario semanal.
  ///
  /// Ante un fallo de red devuelve la CACHÉ con `fromCache: true` para que la app
  /// abra igual: una cafetería con wifi caído sigue teniendo nombre y horario.
  Future<Result<BusinessStatus>> status();
}
