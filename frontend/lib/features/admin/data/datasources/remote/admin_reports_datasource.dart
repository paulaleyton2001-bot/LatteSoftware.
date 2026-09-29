// Llamadas HTTP de reportes. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/reports/reports.routes.ts`.
//
// EL PRESET LO RESUELVE EL BACKEND
// `docs/API.md` §5.2: `today`, `yesterday`, `last7`, `last30`, `thisMonth`,
// `lastMonth`, `custom`. El backend lo resuelve en la zona horaria del NEGOCIO, no
// en la del servidor ni en la del navegador, así que el cliente manda el LITERAL y
// no fechas calculadas a mano. Solo `custom` lleva `from`/`to`.
//
// EL CSV NO USA EL ENVOLTORIO JSON
// `POST /reports/export` es la única respuesta binaria/texto de la API:
// `text/csv` con BOM UTF-8 y separador `;`. Por eso pide `ResponseType.plain`.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';

/// Datasource de reportes.
class AdminReportsDataSource {
  const AdminReportsDataSource(this._dio);

  final Dio _dio;

  // ----------------------------------------------------------------- Reportes
  /// `GET /reports/dashboard` — KPIs del periodo.
  Future<Map<String, dynamic>> dashboard({
    String preset = 'today',
    int seriesDays = 7,
    bool includeSeries = true,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reportDashboard,
      queryParameters: <String, dynamic>{
        'preset': preset,
        'seriesDays': seriesDays,
        'includeSeries': includeSeries,
      },
    );
    return unwrapData(response.data);
  }

  /// `GET /reports/sales-by-hour` — 24 horas SIEMPRE presentes.
  Future<List<Map<String, dynamic>>> salesByHour({
    required String preset,
    DateTime? from,
    DateTime? to,
  }) async {
    return _series(ApiEndpoints.reportSalesByHour, preset, from, to);
  }

  /// `GET /reports/sales-by-day` — días sin actividad vienen en cero.
  Future<List<Map<String, dynamic>>> salesByDay({
    required String preset,
    DateTime? from,
    DateTime? to,
  }) async {
    return _series(ApiEndpoints.reportSalesByDay, preset, from, to);
  }

  /// `GET /reports/top-products` — más vendidos.
  Future<List<Map<String, dynamic>>> topProducts({
    required String preset,
    String orderBy = 'quantity',
    int limit = 10,
    DateTime? from,
    DateTime? to,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reportTopProducts,
      queryParameters: <String, dynamic>{
        'preset': preset,
        'orderBy': orderBy,
        'limit': limit,
        // `preset: custom` sin rango es un 400: los dos van siempre juntos.
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      },
    );
    return unwrapList(response.data);
  }

  /// `GET /reports/chair-occupancy` — ocupación por silla, zona y hora.
  Future<Map<String, dynamic>> chairOccupancy({
    required String preset,
    int? zoneId,
    DateTime? from,
    DateTime? to,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reportChairOccupancy,
      queryParameters: <String, dynamic>{
        'preset': preset,
        if (zoneId != null) 'zoneId': zoneId,
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      },
    );
    return unwrapData(response.data);
  }



  /// `GET /reports/inventory` — valorización de inventario.
  Future<Map<String, dynamic>> inventoryReport({required String preset}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reportInventory,
      queryParameters: <String, dynamic>{'preset': preset},
    );
    return unwrapData(response.data);
  }

  /// `GET /reports/sales` — ventas agregadas por periodo.
  Future<List<Map<String, dynamic>>> sales({
    required String preset,
    DateTime? from,
    DateTime? to,
    String groupBy = 'day',
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reportSales,
      queryParameters: <String, dynamic>{
        'preset': preset,
        'groupBy': groupBy,
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      },
    );
    return unwrapList(response.data);
  }

  /// `POST /reports/export` — CSV.
  ///
  /// Es la ÚNICA respuesta de la API que NO usa el envoltorio JSON: devuelve
  /// `text/csv` con BOM y separador `;` (convención es-CO). Por eso devuelve el
  /// `String` crudo y no `unwrapData`.
  Future<String> exportCsv({
    required String report,
    required String preset,
    DateTime? from,
    DateTime? to,
    List<String>? columns,
    String? filename,
  }) async {
    final Response<String> response = await _dio.post<String>(
      ApiEndpoints.reportExport,
      data: <String, dynamic>{
        'report': report,
        'format': 'csv',
        if (preset == 'custom')
          'from': (from ?? DateTime.now()).toUtc().toIso8601String(),
        if (preset == 'custom')
          'to': (to ?? DateTime.now()).toUtc().toIso8601String(),
        if (preset != 'custom') 'preset': preset,
        if (columns != null && columns.isNotEmpty) 'columns': columns,
        if (filename != null && filename.isNotEmpty) 'filename': filename,
        'includeTotalsRow': true,
      },
      options: Options(responseType: ResponseType.plain),
    );
    return response.data ?? '';
  }

  // ----------------------------------------------------------------- Privados
  Future<List<Map<String, dynamic>>> _series(
    String path,
    String preset,
    DateTime? from,
    DateTime? to,
  ) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      path,
      queryParameters: <String, dynamic>{
        if (preset == 'custom')
          'from': (from ?? DateTime.now()).toUtc().toIso8601String()
        else
          'preset': preset,
        if (preset == 'custom')
          'to': (to ?? DateTime.now()).toUtc().toIso8601String(),
      },
    );
    return unwrapList(response.data);
  }

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
