// Datasource remoto de pedidos, alquileres y pagos. Módulo `features/orders/data`.
//
// Cubre las lecturas que necesita el CLIENTE. Las escrituras de estado
// (confirmar, cancelar, cambiar estado) NO están aquí a propósito: un `CUSTOMER`
// no tiene permiso (`orders:status:update` es denegado para él, DESIGN.md §9.3) y
// ningunas las lanza la app del cliente. Lo que sí escribe el cliente es
// `POST /rentals/:id/extend`, y por eso ese método sí existe.


import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/order_detail.dart';
import '../../../domain/entities/order_item.dart';
import '../../../domain/entities/order_summary.dart';
import '../../../domain/entities/payment_record.dart';
import '../../../domain/entities/rental.dart';

/// Llamadas HTTP de `/api/v1/orders`, `/api/v1/rentals` y
/// `/api/v1/customers`.
class OrdersRemoteDataSource {
  const OrdersRemoteDataSource(this._dio);

  final Dio _dio;

  /// `GET /orders` — resumen de los pedidos del cliente.
  ///
  /// Un `CUSTOMER` solo ve los suyos: el service impone
  /// `customerId = auth.userId` (API.md §7.12), así que la app no tiene que
  /// mandar el `customerId` ni filtrar por su cuenta. `pageSize: 100` es el
  /// máximo del endpoint y evita paginar la lista de un cliente normal.
  ///
  /// Sin `sort`: el orden por defecto de `GET /orders` ya es `createdAt desc`
  /// (ver `core/network/README.md`, "Orden de listados").
  Future<List<OrderSummary>> orders({String? status, int? orderId}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.orders,
      queryParameters: <String, dynamic>{
        'pageSize': 100,
        'order': 'desc',
        if (status != null) 'status': status,
        if (orderId != null) 'orderNumber': orderId,
      },
    );
    // Una fila sin `id` ni `orderNumber` es basura del proxy: se descarta en vez de
    // inventarle un pedido. `nonNulls` es el filtro, sin un `where` a mano.
    return <OrderSummary>[
      for (final Map<String, dynamic> row in unwrapList(response.data))
        if (_parseSummary(row) case final OrderSummary summary) summary,
    ];
  }

  /// `GET /orders/:id` — pedido completo con `items[]`, `rental` y `payments[]`.
  Future<OrderDetail> order(int orderId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.orderById(orderId),
    );
    return parseOrderDetail(unwrapData(response.data));
  }

  /// `GET /rentals` — alquileres del cliente.
  ///
  /// `from`/`to` acotan a una ventana razonable alrededor de ahora: un cliente
  /// no tiene cientos de alquileres y traerlos todos sería gastar cuota para
  /// pintar uno.
  Future<List<Rental>> rentals({required int customerId}) async {
    final DateTime now = DateTime.now().toUtc();
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.rentals,
      queryParameters: <String, dynamic>{
        'pageSize': 50,
        'order': 'desc',
        'from': now.subtract(const Duration(days: 7)).toIso8601String(),
        'to': now.add(const Duration(days: 7)).toIso8601String(),
        // El endpoint acepta `customerId` pero un CUSTOMER solo ve los suyos y
        // el filtro se ignora si envía otro id. MANDARLO es lo que acota la
        // lista a este cliente cuando quien mira es un empleado con
        // `rentals:read:any` (POS, panel): sin él, un ADMIN vería los alquileres
        // de todo el negocio en «Mi silla».
        'customerId': customerId,
      },
    );
    // Cinturón y tirantes: si el backend devolviera algo que no es suyo, la fila
    // se descarta en vez de pintarse.
    final int own = customerId;
    return <Rental>[
      for (final Map<String, dynamic> row in unwrapList(response.data))
        if (own > 0) Rental.fromJson(row),
    ];
  }

  /// `POST /rentals/:id/extend` — extiende el alquiler activo.
  ///
  /// Body mínimo: `additionalMinutes` es obligatorio (5-1440). El saldo se suma
  /// a `orders.balance_minor` del pedido abierto, así que no hay que tocar el
  /// pedido desde el cliente.
  Future<Rental> extendRental(int rentalId, int additionalMinutes) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.rentalExtend(rentalId),
      data: <String, dynamic>{'additionalMinutes': additionalMinutes},
    );
    final Map<String, dynamic> data = unwrapData(response.data);
    // La respuesta envuelve en `rental`; si viniera plano, se acepta igual.
    return Rental.fromJson(<String, dynamic>{
      ...data,
      ...(data['rental'] is Map<String, dynamic>
          ? data['rental']! as Map<String, dynamic>
          : const <String, dynamic>{}),
    });
  }

  /// `GET /payments` — historial de pagos hechos en el local.
  ///
  /// POR QUÉ NO `GET /customers/:id/payments`
  /// Ese endpoint está en `docs/API.md` §7.3 pero NO está implementado: el
  /// backend responde `404 NOT_FOUND_ERROR` (lo declara él mismo en
  /// `backend/src/modules/customers/customers.routes.ts`). `GET /payments` sí
  /// existe, y su service fuerza `customerId = actor.id` cuando el actor no
  /// tiene `payments:read:any`, así que para el cliente devuelve solo lo suyo.
  /// Limitación conocida: `GET /payments` no admite filtro `customerId`
  /// (API.md §7.13), así que una cuenta de personal ve en este historial los
  /// pagos del negocio entero, no los suyos.
  Future<List<PaymentRecord>> payments(int customerId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.payments,
      queryParameters: <String, dynamic>{'pageSize': 50, 'order': 'desc'},
    );
    return <PaymentRecord>[
      for (final Map<String, dynamic> row in unwrapList(response.data))
        PaymentRecord.fromJson(row),
    ];
  }

  /// `GET /reservations?customerId=:id` — reservas del cliente.
  ///
  /// Mismo criterio que en [payments]: `/customers/:id/reservations` da `404`
  /// porque no está implementado. `GET /reservations` acepta `customerId`, y el
  /// service lo SOBRESCRIBE con el del token cuando el actor es un `CUSTOMER`
  /// (API.md §9.3), de modo que un empleado con permiso sí ve las de su cliente
  /// y un cliente normal solo las suyas aunque manipule el parámetro.
  Future<List<Map<String, dynamic>>> reservations(int customerId) async {
    final DateTime now = DateTime.now().toUtc();
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reservations,
      queryParameters: <String, dynamic>{
        'pageSize': 50,
        'order': 'desc',
        'from': now.subtract(const Duration(days: 30)).toIso8601String(),
        'to': now.add(const Duration(days: 90)).toIso8601String(),
        'customerId': customerId,
      },
    );
    return unwrapList(response.data);
  }

  // ----------------------------------------------------------------- Parsers
  /// Resumen de un pedido. `null` si no trae `id` ni `orderNumber`.
  static OrderSummary? _parseSummary(Map<String, dynamic> json) {
    final int? id = _int(json['id']);
    final String? number = _str(json['orderNumber']);
    if (id == null || number == null) return null;
    return OrderSummary(
      id: id,
      orderNumber: number,
      status: _str(json['status']) ?? 'PENDING',
      type: _str(json['type']) ?? 'TAKEAWAY',
      channel: _str(json['channel']) ?? 'POS',
      chairCode: _str(json['chairCode']),
      totalMinor: _int(json['totalMinor']) ?? 0,
      paidMinor: _int(json['paidMinor']) ?? 0,
      balanceMinor: _int(json['balanceMinor']) ?? 0,
      itemCount: _int(json['itemCount']) ?? 0,
      placedAt: _date(json['placedAt']),
      completedAt: _date(json['completedAt']),
      createdAt: _date(json['createdAt']),
    );
  }

  /// Detalle completo de un pedido.
  static OrderDetail parseOrderDetail(Map<String, dynamic> json) {
    final List<Object?> rawItems =
        json['items'] is List ? json['items']! as List : const <Object?>[];
    final List<Object?> rawPayments =
        json['payments'] is List ? json['payments']! as List : const <Object?>[];
    final Map<String, dynamic> rentalMap = _map(json['rental']);

    return OrderDetail(
      summary: _parseSummary(json) ??
          OrderSummary(
            id: _int(json['id']) ?? 0,
            orderNumber: _str(json['orderNumber']) ?? 'ORD-000000',
            status: _str(json['status']) ?? 'PENDING',
            type: _str(json['type']) ?? 'TAKEAWAY',
            totalMinor: _int(json['totalMinor']) ?? 0,
          ),
      items: <OrderItem>[
        for (final Object? row in rawItems)
          if (row is Map<String, dynamic>) OrderItem.fromJson(row),
      ],
      rental: rentalMap.isEmpty ? null : Rental.fromJson(rentalMap),
      payments: <PaymentRecord>[
        for (final Object? row in rawPayments)
          if (row is Map<String, dynamic>) PaymentRecord.fromJson(row),
      ],
      couponCode: _str(json['couponCode']),
      customerNotes: _str(json['customerNotes']),
      notes: _str(json['notes']),
      reservationCode: _str(_map(json['reservation'])['code']),
      rentalCode: _str(rentalMap['code']),
      tableLabel: _str(json['tableLabel']),
      subtotalMinor: _int(json['subtotalMinor']) ?? 0,
      discountMinor: _int(json['discountMinor']) ?? 0,
      taxMinor: _int(json['taxMinor']) ?? 0,
      serviceFeeMinor: _int(json['serviceFeeMinor']) ?? 0,
    );
  }

  // ---------------------------------------------------------------- Lectores
  static int? _int(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }

  static String? _str(Object? value) =>
      value is String && value.trim().isNotEmpty ? value : null;

  static DateTime? _date(Object? value) {
    final String? raw = _str(value);
    if (raw == null) return null;
    return DateTime.tryParse(raw)?.toUtc();
  }

  static Map<String, dynamic> _map(Object? value) =>
      value is Map<String, dynamic> ? value : const <String, dynamic>{};
}
