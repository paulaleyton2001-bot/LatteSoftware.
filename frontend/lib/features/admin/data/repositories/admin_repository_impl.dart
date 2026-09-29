// Implementación de `AdminOpsRepository` y `AdminCatalogRepository`.
//
// NINGÚN MÉTODO LANZA. `DioException` → `ErrorMapper` (vía `ApiException`) y
// cualquier otra excepción → `UnknownFailure`. Se verá repetido en los otros
// repositorios del panel: es deliberado, porque un `catch` compartido entre cinco
// dominios distintos acabaría devolviendo el fallo equivocado a alguna pantalla.
//
// LOS ERRORES DE NEGOCIO SE DEJAN PASAR
// Un `422 PRODUCT_UNAVAILABLE` o un `409 CHAIR_OCCUPIED` NO se traducen ni se
// disimulan: `ErrorMapper` ya los convierte en `BusinessRuleFailure` y
// `ConflictFailure` con el mensaje en español del backend, que es lo que hay que
// mostrarle a quien estáEditable el formulario.

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/admin_catalog.dart';
import '../../domain/entities/admin_payments.dart';
import '../../domain/repositories/admin_repository.dart';
import '../datasources/remote/admin_ops_datasource.dart';
import '../datasources/remote/admin_payments_datasource.dart';
import '../datasources/remote/admin_reports_datasource.dart';

/// Repositorio de pedidos, pagos y reportes.
class AdminOpsRepositoryImpl implements AdminOpsRepository {
  const AdminOpsRepositoryImpl(this._ops, this._payments, this._reports);

  final AdminOpsDataSource _ops;
  final AdminPaymentsDataSource _payments;
  final AdminReportsDataSource _reports;

  @override
  Future<Result<List<AdminOrder>>> orders({
    String? status,
    String? type,
    String? query,
    DateTime? from,
    DateTime? to,
    bool? hasUnpaidBalance,
  }) =>
      _guard(() => _ops.orders(
            status: status,
            type: type,
            query: query,
            from: from,
            to: to,
            hasUnpaidBalance: hasUnpaidBalance,
          ));

  @override
  Future<Result<Map<String, dynamic>>> order(int orderId) =>
      _guard(() => _ops.order(orderId));

  @override
  Future<Result<void>> setOrderStatus(
    int orderId,
    String toStatus, {
    String? reason,
    String? pin,
  }) =>
      _guard(() => _ops.setOrderStatus(orderId, toStatus, reason: reason, pin: pin));

  @override
  Future<Result<Map<String, dynamic>>> receipt(int orderId) =>
      _guard(() => _ops.receipt(orderId));

  @override
  Future<Result<List<Map<String, dynamic>>>> orderHistory(int orderId) =>
      _guard(() => _ops.orderHistory(orderId));

  @override
  Future<Result<List<AdminPayment>>> payments({
    String? method,
    String? status,
    int? orderId,
    DateTime? from,
    DateTime? to,
  }) =>
      _guard(() => _payments.payments(
            method: method,
            status: status,
            orderId: orderId,
            from: from,
            to: to,
          ));

  @override
  Future<Result<void>> refund({
    required int paymentId,
    required int amountMinor,
    required String reason,
  }) =>
      _guard(() => _payments.refund(
            paymentId,
            amountMinor: amountMinor,
            reason: reason,
          ));

  @override
  Future<Result<Map<String, dynamic>>> dashboard({
    String preset = 'today',
    int seriesDays = 7,
  }) =>
      _guard(() => _reports.dashboard(preset: preset, seriesDays: seriesDays));

  @override
  Future<Result<List<Map<String, dynamic>>>> salesByHour({
    required String preset,
    DateTime? from,
    DateTime? to,
  }) =>
      _guard(() => _reports.salesByHour(preset: preset, from: from, to: to));

  @override
  Future<Result<List<Map<String, dynamic>>>> salesByDay({
    required String preset,
    DateTime? from,
    DateTime? to,
  }) =>
      _guard(() => _reports.salesByDay(preset: preset, from: from, to: to));

  @override
  Future<Result<List<Map<String, dynamic>>>> topProducts({
    required String preset,
    String orderBy = 'quantity',
    int limit = 10,
    DateTime? from,
    DateTime? to,
  }) =>
      _guard(() => _reports.topProducts(
            preset: preset,
            from: from,
            to: to,
            orderBy: orderBy,
            limit: limit,
          ));

  @override
  Future<Result<Map<String, dynamic>>> chairOccupancy({
    required String preset,
    int? zoneId,
    DateTime? from,
    DateTime? to,
  }) =>
      _guard(() => _reports.chairOccupancy(
            preset: preset,
            zoneId: zoneId,
            from: from,
            to: to,
          ));

  @override
  Future<Result<Map<String, dynamic>>> inventoryReport(String preset) =>
      _guard(() => _reports.inventoryReport(preset: preset));

  @override
  Future<Result<List<Map<String, dynamic>>>> sales({
    required String preset,
    DateTime? from,
    DateTime? to,
    String groupBy = 'day',
  }) =>
      _guard(() => _reports.sales(
            preset: preset,
            from: from,
            to: to,
            groupBy: groupBy,
          ));

  @override
  Future<Result<String>> exportCsv({
    required String report,
    required String preset,
    DateTime? from,
    DateTime? to,
    List<String>? columns,
  }) =>
      _guard(() => _reports.exportCsv(
            report: report,
            preset: preset,
            from: from,
            to: to,
            columns: columns,
          ));
}

/// Envuelve cualquier excepción en un `FailureResult<T>`.
Future<Result<T>> _guard<T>(Future<T> Function() action) async {
  try {
    return Success<T>(await action());
  } on Object catch (error) {
    return FailureResult<T>(ApiException.toFailure(error));
  }
}
