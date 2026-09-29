// Llamadas HTTP de pagos. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/payments/payments.routes.ts`.
//
// EL REEMBOLSO ES UNA ANOTACIÓN DE CAJA
// `POST /payments/:id/refund` no llama a nadie: este producto no tiene pasarela,
// así que el reembolso REGISTRA lo que se devolvió en efectivo. Por eso el
// formulario pide SIEMPRE un motivo (2-300 caracteres) y la pantalla usa
// `ConfirmDialog` destructivo antes de llamar: un reembolso mal registrado es un
// descuadre de caja que alguien tiene que arreglar a mano.
//
// PERMISO `payments:refund` = MANAGER+
// Si el usuario no lo tiene, el backend responde `403 INSUFFICIENT_PERMISSIONS`
// y la acción desaparece de la UI (el backend es la autoridad, no la lista local).

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_payments.dart';

/// Datasource de pagos.
class AdminPaymentsDataSource {
  const AdminPaymentsDataSource(this._dio);

  final Dio _dio;

  // ---------------------------------------------------------------- Listados
  /// `GET /payments` — listado con filtros por método, estado y rango.
  Future<List<AdminPayment>> payments({
    String? method,
    String? status,
    int? orderId,
    String? referenceNumber,
    DateTime? from,
    DateTime? to,
    int pageSize = 100,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.payments,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        // Sin `sort`: el defecto de `GET /payments` ya es `createdAt desc`
        // (ver `core/network/README.md`, "Orden de listados").
        'order': 'desc',
        if (method != null && method.isNotEmpty) 'method': method,
        if (status != null && status.isNotEmpty) 'status': status,
        if (orderId != null) 'orderId': orderId,
        if (referenceNumber != null && referenceNumber.isNotEmpty)
          'referenceNumber': referenceNumber,
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      },
    );
    return _map(unwrapList(response.data), AdminPayment.tryParse);
  }

  /// `GET /payments/:id` — pago con su pedido y sus reembolsos.
  Future<Map<String, dynamic>> payment(int paymentId) async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.paymentById(paymentId));
    return unwrapData(response.data);
  }

  /// `POST /payments/:id/refund` — reembolso TOTAL o PARCIAL.
  ///
  /// `amountMinor` no puede superar `amountMinor - refundedMinor` (BR-PAY-006);
  /// el backend responde `422 REFUND_EXCEEDS_PAID` si se pasa. `reason` es
  /// obligatorio (2-300 caracteres). Requiere permiso `payments:refund`, que es
  /// MANAGER+.
  Future<Map<String, dynamic>> refund(
    int paymentId, {
    required int amountMinor,
    required String reason,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.paymentRefund(paymentId),
      data: <String, dynamic>{
        'amountMinor': amountMinor,
        'reason': reason,
        'notifyCustomer': false,
      },
    );
    return unwrapData(response.data);
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
