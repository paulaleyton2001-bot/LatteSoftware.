// Llamadas HTTP de clientes, descuentos y usuarios. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/customers/customers.routes.ts`,
// `backend/src/modules/discounts/discounts.routes.ts` y
// `backend/src/modules/users/users.routes.ts`.
//
// ⚠️ DISCREPANCIA DOCUMENTADA CON EL BACKEND
// `docs/API.md` §7.3 promete `GET /customers/:id/orders`, `/:id/reservations`,
// `/:id/rentals` y `/:id/payments`. NO EXISTEN en el router real: la cabecera de
// `customers.routes.ts` lo dice y apunta a que el cálculo está en el repositorio
// pero el endpoint no se montó. Por eso la ficha de cliente se compone con los
// listados por `customerId` (`GET /orders?customerId=`, `GET /reservations?
// customerId=`, `GET /rentals?customerId=`, `GET /payments?orderId=`), que sí
// existen. Cuando el backend los exponga, esta capa cambia y las pantallas no.
//
// EL HISTÓRICO DE UN CLIENTE ES UNA UNION, NO UNA LLAMADA
// Por lo anterior, `customerHistory` hace hasta cuatro peticiones y devuelve un
// resumen ya combinado. Es más lento que un endpoint único, pero hoy es la única
// forma correcta de no inventarse datos.
//
// NINGÚN LISTADO MANDA `sort`
// El backend compara `sort` contra los nombres de COLUMNA en `snake_case` y
// rechaza el camelCase que documenta `docs/API.md` con `400 INVALID_SORT_FIELD`
// (ver `core/network/README.md`, "Orden de listados"). Aquí no se manda porque la
// columna por defecto de cada endpoint (`createdAt` / `startAt`) ya es la que se
// quiere; `order` sí se manda y el backend lo aplica sobre esa columna.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_accounts.dart';
import '../../../domain/entities/admin_catalog.dart';
import '../../../domain/entities/admin_history.dart';
import '../../../domain/entities/admin_payments.dart';
import '../../../domain/entities/admin_rentals.dart';
import '../../../domain/entities/admin_spaces.dart';

/// Datasource de clientes, descuentos y usuarios.
class AdminDirectoryDataSource {
  const AdminDirectoryDataSource(this._dio);

  final Dio _dio;

  // --------------------------------------------------------------- Clientes
  /// `GET /customers` — listado con `q`, estado y paginación.
  Future<List<AdminCustomer>> customers({
    String? query,
    String? status,
    bool? hasOrders,
    int pageSize = 100,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.customers,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        'order': 'desc',
        if (query != null && query.trim().length >= 2) 'q': query.trim(),
        if (status != null && status.isNotEmpty) 'status': status,
        if (hasOrders != null) 'hasOrders': hasOrders,
      },
    );
    return _map(unwrapList(response.data), AdminCustomer.tryParse);
  }

  /// `GET /customers/:id` — ficha con `stats` agregadas.
  Future<AdminCustomer?> customer(int customerId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.customerById(customerId),
    );
    return AdminCustomer.tryParse(unwrapData(response.data));
  }

  /// `PATCH /customers/:id` — edición de la ficha.
  Future<void> updateCustomer(int customerId, Map<String, dynamic> body) async {
    await _dio.patch<dynamic>(ApiEndpoints.customerById(customerId), data: body);
  }

  /// Historial de un cliente, compuesto de los listados que SÍ existen.
  ///
  /// Se lanza en paralelo con `Future.wait`: son cuatro endpoints independientes y
  /// esperar en cascada tardaría cuatro veces más por la latencia de cada uno.
  /// Si uno falla, se devuelve la lista vacía de ese bloque en vez de tirar todo:
  /// es preferible ver "sus pedidos" y que falten las reservas a no ver nada.
  Future<CustomerHistory> customerHistory(int customerId) async {
    final List<List<Object>> results = await Future.wait<List<Object>>(
      <Future<List<Object>>>[
        _safeList(() => _ordersOf(customerId)),
        _safeList(() => _reservationsOf(customerId)),
        _safeList(() => _rentalsOf(customerId)),
      ],
    );
    return CustomerHistory(
      orders: results[0].cast<AdminOrder>(),
      reservations: results[1].cast<AdminReservation>(),
      rentals: results[2].cast<AdminRental>(),
    );
  }

  Future<List<AdminOrder>> _ordersOf(int customerId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.orders,
      queryParameters: <String, dynamic>{
        'customerId': customerId,
        'pageSize': 100,
        'order': 'desc',
      },
    );
    return _map(unwrapList(response.data), AdminOrder.tryParse);
  }

  Future<List<AdminReservation>> _reservationsOf(int customerId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reservations,
      queryParameters: <String, dynamic>{
        'customerId': customerId,
        'pageSize': 100,
        'order': 'desc',
      },
    );
    return _map(unwrapList(response.data), AdminReservation.tryParse);
  }

  Future<List<AdminRental>> _rentalsOf(int customerId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.rentals,
      queryParameters: <String, dynamic>{
        'customerId': customerId,
        'pageSize': 100,
        'order': 'desc',
      },
    );
    return _map(unwrapList(response.data), AdminRental.tryParse);
  }

  /// `GET /payments` de los pedidos de un cliente: se filtra por pedido, no por
  /// cliente, porque `GET /payments` NO tiene filtro `customerId` (API.md §7.13).
  Future<List<AdminPayment>> paymentsOfOrders(List<int> orderIds) async {
    final List<AdminPayment> all = <AdminPayment>[];
    for (final int orderId in orderIds.take(20)) {
      try {
        final Response<dynamic> response = await _dio.get<dynamic>(
          ApiEndpoints.payments,
          queryParameters: <String, dynamic>{'orderId': orderId, 'pageSize': 20},
        );
        all.addAll(_map(unwrapList(response.data), AdminPayment.tryParse));
      } on Object {
        // Un pedido sin pagos no rompe el historial: se sigue con el siguiente.
        continue;
      }
    }
    return all;
  }

  // ------------------------------------------------------------ Descuentos
  /// `GET /discounts` — listado con filtros de tipo, vigencia y búsqueda.
  Future<List<AdminDiscount>> discounts({
    String? query,
    String? type,
    bool? isActive,
    int pageSize = 100,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.discounts,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        'order': 'desc',
        if (query != null && query.trim().length >= 2) 'q': query.trim(),
        if (type != null && type.isNotEmpty) 'type': type,
        if (isActive != null) 'isActive': isActive,
      },
    );
    return _map(unwrapList(response.data), AdminDiscount.tryParse);
  }

  /// `POST /discounts` — alta de cupón.
  Future<void> createDiscount(Map<String, dynamic> body) async {
    await _dio.post<dynamic>(ApiEndpoints.discounts, data: body);
  }

  /// `PATCH /discounts/:id` — edición.
  ///
  /// El `code` solo se puede cambiar si el cupón no se ha usado nunca; si
  /// `usedCount > 0` el backend responde `422 DISCOUNT_CODE_IN_USE`.
  Future<void> updateDiscount(int discountId, Map<String, dynamic> body) async {
    await _dio.patch<dynamic>(ApiEndpoints.discountById(discountId), data: body);
  }

  /// `DELETE /discounts/:id` — baja lógica. Las redenciones históricas se conservan.
  Future<void> deleteDiscount(int discountId, {String? reason}) async {
    await _dio.delete<dynamic>(
      ApiEndpoints.discountById(discountId),
      data: <String, dynamic>{
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
  }

  /// `POST /discounts/validate` — previsualiza un cupón SIN aplicarlo.
  ///
  /// Devuelve `200` con `isValid: false` y `reason` si el cupón no sirve: es una
  /// consulta, no un error (API.md §7.14).
  Future<Map<String, dynamic>> validateDiscount({
    required String code,
    required int subtotalMinor,
    int? customerId,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.discountsValidate,
      data: <String, dynamic>{
        'code': code,
        'subtotalMinor': subtotalMinor,
        if (customerId != null) 'customerId': customerId,
      },
    );
    return unwrapData(response.data);
  }

  // ----------------------------------------------------------------- Privados
  /// Ejecuta [action] y devuelve una lista vacía si falla.
  ///
  /// El historial de cliente es una unión de varias fuentes: que una falle no debe
  /// dejar al usuario sin las otras. Se declara con `<T extends List<Object>>`
  /// para que el fallback sea una lista REALMENTE del mismo tipo, en vez de un
  /// `as` forzado que revienta en cuanto el tipo no cuadre.
  Future<T> _safeList<T extends List<Object>>(Future<T> Function() action) async {
    try {
      return await action();
    } on Object {
      return List<Object>.empty() as T;
    }
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
