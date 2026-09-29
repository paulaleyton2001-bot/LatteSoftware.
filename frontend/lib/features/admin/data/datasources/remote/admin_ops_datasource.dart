// Llamadas HTTP del panel: pedidos, pagos y reportes. MÓDULO `features/admin/data`.
//
// Verifica una a una contra `backend/src/modules/*/*.routes.ts` (el código real).
//
// LOS REPORTES ACEPTAN `preset`
// `docs/API.md` §5.2: `today`, `yesterday`, `last7`, `last30`, `thisMonth`,
// `lastMonth`, `custom` (este último con `from`/`to` en ISO UTC). El backend
// resuelve el preset en la zona horaria del NEGOCIO, no en la del servidor, así que
// el cliente manda el literal y no fechas inventadas.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_catalog.dart';

/// Datasource de pedidos, pagos y reportes.
class AdminOpsDataSource {
  const AdminOpsDataSource(this._dio);

  final Dio _dio;

  // ---------------------------------------------------------------- Pedidos
  /// `GET /orders` — listado con filtros de estado, tipo y rango.
  Future<List<AdminOrder>> orders({
    String? status,
    String? type,
    String? query,
    DateTime? from,
    DateTime? to,
    bool? hasUnpaidBalance,
    int pageSize = 100,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.orders,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        // Sin `sort`: el defecto de `GET /orders` ya es `createdAt desc`
        // (ver `core/network/README.md`, "Orden de listados").
        'order': 'desc',
        if (status != null && status.isNotEmpty) 'status': status,
        if (type != null && type.isNotEmpty) 'type': type,
        if (query != null && query.trim().length >= 2) 'q': query.trim(),
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
        if (hasUnpaidBalance != null) 'hasUnpaidBalance': hasUnpaidBalance,
      },
    );
    return _map(unwrapList(response.data), AdminOrder.tryParse);
  }

  /// `GET /orders/:id` — pedido completo con items, pagos y reembolsos.
  Future<Map<String, dynamic>> order(int orderId) async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.orderById(orderId));
    return unwrapData(response.data);
  }

  /// `POST /orders/:id/status` — transición de estado.
  ///
  /// `reason` es obligatorio si el destino es `CANCELLED` o `REFUNDED`; el
  /// backend responde `400` sin él. `pin` es opcional (cajero).
  Future<void> setOrderStatus(
    int orderId,
    String toStatus, {
    String? reason,
    String? pin,
  }) async {
    await _dio.post<dynamic>(
      ApiEndpoints.orderStatus(orderId),
      data: <String, dynamic>{
        'toStatus': toStatus,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
        if (pin != null && pin.isNotEmpty) 'pin': pin,
      },
    );
  }

  /// `GET /orders/:id/receipt` — comprobante (para reimprimir desde el panel).
  Future<Map<String, dynamic>> receipt(int orderId) async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.orderReceipt(orderId));
    return unwrapData(response.data);
  }

  /// `GET /orders/:id/history` — línea de tiempo de estados.
  Future<List<Map<String, dynamic>>> orderHistory(int orderId) async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.orderHistory(orderId));
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
