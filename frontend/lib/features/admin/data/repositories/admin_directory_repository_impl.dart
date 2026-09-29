// Implementación de `AdminDirectoryRepository` (clientes, descuentos, usuarios y
// configuración del negocio).
//
// Ver `admin_repository_impl.dart` para el criterio.

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/admin_accounts.dart';
import '../../domain/entities/admin_business.dart';
import '../../domain/entities/admin_history.dart';
import '../../domain/entities/admin_payments.dart';
import '../../domain/repositories/admin_directory_repository.dart';
import '../datasources/remote/admin_business_datasource.dart';
import '../datasources/remote/admin_directory_datasource.dart';
import '../datasources/remote/admin_users_datasource.dart';

/// Repositorio de clientes, descuentos, usuarios y configuración.
class AdminDirectoryRepositoryImpl implements AdminDirectoryRepository {
  const AdminDirectoryRepositoryImpl(
    this._directory,
    this._users,
    this._business,
  );

  final AdminDirectoryDataSource _directory;
  final AdminUsersDataSource _users;
  final AdminBusinessDataSource _business;

  // ---------------------------------------------------------------- Clientes
  @override
  Future<Result<List<AdminCustomer>>> customers({
    String? query,
    String? status,
    bool? hasOrders,
  }) =>
      _guard(() => _directory.customers(
            query: query,
            status: status,
            hasOrders: hasOrders,
          ));

  @override
  Future<Result<AdminCustomer?>> customer(int customerId) =>
      _guard(() => _directory.customer(customerId));

  @override
  Future<Result<void>> updateCustomer(
    int customerId,
    Map<String, dynamic> body,
  ) =>
      _guard(() => _directory.updateCustomer(customerId, body));

  @override
  Future<Result<CustomerHistory>> customerHistory(int customerId) =>
      _guard(() => _directory.customerHistory(customerId));

  @override
  Future<Result<List<AdminPayment>>> paymentsOfOrders(List<int> orderIds) =>
      _guard(() => _directory.paymentsOfOrders(orderIds));

  // -------------------------------------------------------------- Descuentos
  @override
  Future<Result<List<AdminDiscount>>> discounts({
    String? query,
    String? type,
    bool? isActive,
  }) =>
      _guard(() => _directory.discounts(
            query: query,
            type: type,
            isActive: isActive,
          ));

  @override
  Future<Result<void>> createDiscount(Map<String, dynamic> body) =>
      _guard(() => _directory.createDiscount(body));

  @override
  Future<Result<void>> updateDiscount(
    int discountId,
    Map<String, dynamic> body,
  ) =>
      _guard(() => _directory.updateDiscount(discountId, body));

  @override
  Future<Result<void>> deleteDiscount(int discountId, {String? reason}) =>
      _guard(() => _directory.deleteDiscount(discountId, reason: reason));

  @override
  Future<Result<Map<String, dynamic>>> validateDiscount({
    required String code,
    required int subtotalMinor,
    int? customerId,
  }) =>
      _guard(() => _directory.validateDiscount(
            code: code,
            subtotalMinor: subtotalMinor,
            customerId: customerId,
          ));

  // ---------------------------------------------------------------- Usuarios
  @override
  Future<Result<List<AdminUser>>> users({
    String? query,
    String? role,
    String? status,
  }) =>
      _guard(() => _users.users(query: query, role: role, status: status));

  @override
  Future<Result<AdminUserCreated>> createUser(Map<String, dynamic> body) =>
      _guard(() => _users.createUser(body));

  @override
  Future<Result<void>> updateUser(int userId, Map<String, dynamic> body) =>
      _guard(() => _users.updateUser(userId, body));

  @override
  Future<Result<void>> setUserStatus(
    int userId,
    String status, {
    String? reason,
  }) =>
      _guard(() => _users.setUserStatus(userId, status, reason: reason));

  @override
  Future<Result<void>> assignRole(int userId, int roleId) =>
      _guard(() => _users.assignRole(userId, roleId));

  @override
  Future<Result<void>> removeRole(int userId, int roleId) =>
      _guard(() => _users.removeRole(userId, roleId));

  @override
  Future<Result<List<Map<String, dynamic>>>> roles() => _guard(_business.roles);

  // -------------------------------------------------------------- Negocio
  @override
  Future<Result<AdminBusiness>> business() => _guard(_business.business);

  @override
  Future<Result<AdminBusiness>> updateBusiness(Map<String, dynamic> body) =>
      _guard(() => _business.updateBusiness(body));

  @override
  Future<Result<List<AdminBusinessHour>>> hours() => _guard(_business.hours);

  @override
  Future<Result<List<AdminBusinessHour>>> replaceHours(
    List<AdminBusinessHour> hours,
  ) =>
      _guard(() => _business.replaceHours(hours));

  @override
  Future<Result<List<AdminHoliday>>> holidays({bool includePast = false}) =>
      _guard(() => _business.holidays(includePast: includePast));

  @override
  Future<Result<void>> createHoliday({
    required String holidayDate,
    required String name,
    bool isClosed = true,
  }) =>
      _guard(() => _business.createHoliday(
            holidayDate: holidayDate,
            name: name,
            isClosed: isClosed,
          ));

  @override
  Future<Result<void>> deleteHoliday(int holidayId) =>
      _guard(() => _business.deleteHoliday(holidayId));

  @override
  Future<Result<Map<String, dynamic>>> businessStatus() =>
      _guard(_business.status);
}

/// Envuelve cualquier excepción en un `FailureResult<T>`.
Future<Result<T>> _guard<T>(Future<T> Function() action) async {
  try {
    return Success<T>(await action());
  } on Object catch (error) {
    return FailureResult<T>(ApiException.toFailure(error));
  }
}
