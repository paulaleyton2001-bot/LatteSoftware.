// Llamadas HTTP de zonas y sedes. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/spaces/spaces.routes.ts` (la parte de
// zonas) y `backend/src/modules/locations/locations.routes.ts`.
//
// `GET /zones` EXIGE `locationId`: sin él el backend responde `400`. El panel
// resuelve antes la sede activa, que es la misma que usa el POS.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_spaces.dart';

/// Datasource de zonas y sedes.
class AdminZonesDataSource {
  const AdminZonesDataSource(this._dio);

  final Dio _dio;

  // ------------------------------------------------------------------- Zonas
  /// `GET /zones` — `locationId` es obligatorio.
  Future<List<AdminZone>> zones({required int locationId}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.zones,
      queryParameters: <String, dynamic>{
        'locationId': locationId,
        // 100 es el MÁXIMO que acepta el endpoint (`docs/API.md` §5.1): con 200
        // el backend responde `400 VALIDATION_ERROR` en `pageSize` y el panel de
        // espacios se queda sin zonas.
        'pageSize': 100,
        // Sin `sort`: la columna por defecto de `GET /zones` es `sortOrder asc`
        // (ver `core/network/README.md`, "Orden de listados").
        'order': 'asc',
        'includeInactive': true,
      },
    );
    return _map(unwrapList(response.data), AdminZone.tryParse);
  }

  /// `POST /zones` — alta de zona.
  Future<void> createZone(Map<String, dynamic> body) async {
    await _dio.post<dynamic>(ApiEndpoints.zones, data: body);
  }

  /// `PATCH /zones/:id` — edición. `capacity` se ignora (es derivada).
  Future<void> updateZone(int zoneId, Map<String, dynamic> body) async {
    await _dio.patch<dynamic>(ApiEndpoints.zoneById(zoneId), data: body);
  }

  /// `DELETE /zones/:id` — baja lógica. `422 ZONE_NOT_EMPTY` si tiene sillas.
  Future<void> deleteZone(int zoneId) async {
    await _dio.delete<dynamic>(ApiEndpoints.zoneById(zoneId));
  }

  // -------------------------------------------------------------------- Sedes
  /// `GET /locations` — sedes activas del negocio. La primera es la del POS.
  Future<List<Map<String, dynamic>>> locations() async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.locations,
      queryParameters: <String, dynamic>{
        'isActive': true,
        'pageSize': 50,
        'sort': 'name',
        'order': 'asc',
      },
    );
    return unwrapList(response.data);
  }

  /// Filtra las filas que el parser no pudo leer.
  static List<T> _map<T>(
    List<Map<String, dynamic>> rows,
    T? Function(Map<String, dynamic> row) parse,
  ) {
    final List<T> out = <T>[];
    for (final Map<String, dynamic> row in rows) {
      final T? item = parse(row);
      if (item != null) out.add(item);
    }
    return out;
  }
}
