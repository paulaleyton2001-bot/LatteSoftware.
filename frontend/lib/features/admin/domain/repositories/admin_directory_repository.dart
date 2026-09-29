// Contrato de datos de clientes, descuentos, usuarios y configuración.
//
// Capa de dominio. Ver `admin_repository.dart` para el criterio.

import '../../../../core/result/result.dart';
import '../entities/admin_accounts.dart';
import '../entities/admin_business.dart';
import '../entities/admin_history.dart';
import '../entities/admin_payments.dart';

/// Datos de clientes, descuentos, usuarios y configuración.
abstract interface class AdminDirectoryRepository {
  /// `GET /customers`.
  Future<Result<List<AdminCustomer>>> customers({
    String? query,
    String? status,
    bool? hasOrders,
  });

  /// `GET /customers/:id`.
  Future<Result<AdminCustomer?>> customer(int customerId);

  /// `PATCH /customers/:id`.
  Future<Result<void>> updateCustomer(int customerId, Map<String, dynamic> body);

  /// Historial del cliente, compuesto de los listados que sí existen.
  Future<Result<CustomerHistory>> customerHistory(int customerId);

  /// Pagos de los pedidos de un cliente.
  Future<Result<List<AdminPayment>>> paymentsOfOrders(List<int> orderIds);

  /// `GET /discounts`.
  Future<Result<List<AdminDiscount>>> discounts({
    String? query,
    String? type,
    bool? isActive,
  });

  /// `POST /discounts`.
  Future<Result<void>> createDiscount(Map<String, dynamic> body);

  /// `PATCH /discounts/:id`.
  Future<Result<void>> updateDiscount(int discountId, Map<String, dynamic> body);

  /// `DELETE /discounts/:id`.
  Future<Result<void>> deleteDiscount(int discountId, {String? reason});

  /// `POST /discounts/validate` — previsualiza sin aplicar.
  Future<Result<Map<String, dynamic>>> validateDiscount({
    required String code,
    required int subtotalMinor,
    int? customerId,
  });

  /// `GET /users`.
  Future<Result<List<AdminUser>>> users({
    String? query,
    String? role,
    String? status,
  });

  /// `POST /users`.
  ///
  /// `body` exige `roles` con al menos un elemento: el backend rechaza con 400 un
  /// alta sin rol, así que la pantalla tiene que recogerlo antes de llamar.
  Future<Result<AdminUserCreated>> createUser(Map<String, dynamic> body);

  /// `PATCH /users/:id`.
  Future<Result<void>> updateUser(int userId, Map<String, dynamic> body);

  /// `PATCH /users/:id/status`.
  Future<Result<void>> setUserStatus(
    int userId,
    String status, {
    String? reason,
  });

  /// `POST /users/:id/roles`.
  Future<Result<void>> assignRole(int userId, int roleId);

  /// `DELETE /users/:id/roles/:roleId`.
  Future<Result<void>> removeRole(int userId, int roleId);

  /// `GET /meta/roles` — roles con sus ids.
  Future<Result<List<Map<String, dynamic>>>> roles();

  /// `GET /business`.
  Future<Result<AdminBusiness>> business();

  /// `PATCH /business`.
  Future<Result<AdminBusiness>> updateBusiness(Map<String, dynamic> body);

  /// `GET /business/hours`.
  Future<Result<List<AdminBusinessHour>>> hours();

  /// `PUT /business/hours` — los SIETE días, siempre.
  Future<Result<List<AdminBusinessHour>>> replaceHours(
    List<AdminBusinessHour> hours,
  );

  /// `GET /business/holidays`.
  Future<Result<List<AdminHoliday>>> holidays({bool includePast});

  /// `POST /business/holidays`.
  Future<Result<void>> createHoliday({
    required String holidayDate,
    required String name,
    bool isClosed,
  });

  /// `DELETE /business/holidays/:id`.
  Future<Result<void>> deleteHoliday(int holidayId);

  /// `GET /business/status` — DESVIACIÓN DOCUMENTADA (existe, API.md no lo lista).
  Future<Result<Map<String, dynamic>>> businessStatus();
}
