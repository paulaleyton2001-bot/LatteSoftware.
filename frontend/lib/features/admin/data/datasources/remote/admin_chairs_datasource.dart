// Llamadas HTTP de sillas. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/spaces/spaces.routes.ts` (la parte de
// sillas).
//
// EL ESTADO DE UNA SILLA SE CAMBIA POR RUTA, NO POR EDICIÓN
// `PATCH /chairs/:id` RECHAZA `status` con `422 FIELD_NOT_EDITABLE` (API.md §7.7):
// hay cuatro rutas dedicadas. Además `PATCH /chairs/:id/status` solo acepta
// `AVAILABLE | BLOCKED | MAINTENANCE | CLEANING`; `OCCUPIED` y `RESERVED` los
// pone el flujo de alquileres y mandarlos da `422
// INVALID_CHAIR_STATUS_TRANSITION` (BR-CHAIR-003). Por eso el panel ofrece
// botones por acción (bloquear, mantenimiento) y no un desplegable con los seis
// estados.

import 'package:dio/dio.dart';
import '../../../../../core/customer/chair_map.dart';
import '../../../../../core/customer/venue_datasource.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_spaces.dart';

/// Datasource de sillas.
class AdminChairsDataSource {
  const AdminChairsDataSource(this._dio);

  final Dio _dio;

  // ------------------------------------------------------------------ Sillas
  /// `GET /chairs` — listado con filtros. `locationId` es OBLIGATORIO (API.md §7.7).
  Future<List<AdminChair>> chairs({
    required int locationId,
    int? zoneId,
    String? status,
    String? query,
    bool includeInactive = true,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.chairs,
      queryParameters: <String, dynamic>{
        'locationId': locationId,
        // 100 es el MÁXIMO que acepta `GET /chairs` (`docs/API.md` §5.1): con 200
        // el backend responde `400 VALIDATION_ERROR` en `pageSize` y el mapa de
        // sillas del panel se queda vacío.
        'pageSize': 100,
        'sort': 'code',
        'order': 'asc',
        'includeInactive': includeInactive,
        if (zoneId != null) 'zoneId': zoneId,
        if (status != null && status.isNotEmpty) 'status': status,
        if (query != null && query.trim().length >= 2) 'q': query.trim(),
      },
    );
    return _map(unwrapList(response.data), AdminChair.tryParse);
  }

  /// `GET /chairs/map` — plano completo. Reusa el parser del cliente.
  Future<ChairMap> chairMap(int locationId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.chairsMap,
      queryParameters: <String, dynamic>{'locationId': locationId},
    );
    return VenueRemoteDataSource.parseChairMap(unwrapData(response.data));
  }

  /// `POST /chairs` — alta de silla.
  Future<void> createChair(Map<String, dynamic> body) async {
    await _dio.post<dynamic>(ApiEndpoints.chairs, data: body);
  }

  /// `PATCH /chairs/:id` — edición.
  ///
  /// `status` y `code` NO se mandan: tienen sus propias rutas y mandarlos da `422
  /// FIELD_NOT_EDITABLE` (API.md §7.7).
  Future<void> updateChair(int chairId, Map<String, dynamic> body) async {
    await _dio.patch<dynamic>(ApiEndpoints.chairById(chairId), data: body);
  }

  /// `PATCH /chairs/:id/status` — estado manual.
  ///
  /// Solo acepta `AVAILABLE | BLOCKED | MAINTENANCE | CLEANING`. `OCCUPIED` y
  /// `RESERVED` los pone el flujo de alquileres y dan `422
  /// INVALID_CHAIR_STATUS_TRANSITION` si se intenta a mano.
  Future<void> setChairStatus(
    int chairId,
    String status, {
    String? reason,
  }) async {
    await _dio.patch<dynamic>(
      ApiEndpoints.chairStatus(chairId),
      data: <String, dynamic>{
        'status': status,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
  }

  /// `DELETE /chairs/:id` — baja lógica. `reason` es OBLIGATORIO.
  Future<void> deleteChair(int chairId, String reason) async {
    await _dio.delete<dynamic>(
      ApiEndpoints.chairById(chairId),
      data: <String, dynamic>{'reason': reason},
    );
  }

  /// `GET /chairs/:id/history` — historial de uso.
  ///
  /// Este endpoint es la ÚNICA excepción donde el backend compara `sort` contra
  /// una allowlist en camelCase (`startAt`, `endAt`, `durationMinutes`,
  /// `revenueMinor`), así que aquí sí se manda tal cual (ver
  /// `core/network/README.md`, "Orden de listados").
  Future<List<Map<String, dynamic>>> chairHistory(
    int chairId, {
    DateTime? from,
    DateTime? to,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.chairHistory(chairId),
      queryParameters: <String, dynamic>{
        'pageSize': 50,
        'sort': 'startAt',
        'order': 'desc',
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      },
    );
    return unwrapList(response.data);
  }

  /// `GET /chairs/:id/availability` — ocupación por rango (máx. 31 días).
  Future<Map<String, dynamic>> chairAvailability(
    int chairId, {
    required DateTime from,
    required DateTime to,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.chairAvailability(chairId),
      queryParameters: <String, dynamic>{
        'from': from.toUtc().toIso8601String(),
        'to': to.toUtc().toIso8601String(),
        'granularityMinutes': 30,
      },
    );
    return unwrapData(response.data);
  }

  /// Filtra las filas que el parser no pudo leer, para que un campo mal formado
  /// no tire la tabla entera.
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
