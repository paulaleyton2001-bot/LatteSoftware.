// Datasource remoto del checkout. Módulo `features/checkout/data`.
//
// ÚNICO archivo que conoce las rutas de esta feature. Los cuerpos JSON se arman
// aquí (salvo el de `POST /orders`, que necesita el carrito y por eso se monta en
// el repositorio).
//
// OJO CON DOS DETALLES DEL CONTRATO
// ---------------------------------
// 1. `GET /reservations/quote` es un **GET** con query (`chairId`, `startAt`,
//    `endAt`, `applyCouponCode`), no un POST. Devuelve `200` incluso con
//    conflicto: `isAvailable: false` y la reserva que estorba en `conflict`.
// 2. `POST /reservations` exige `startAt` y `endAt`, y `endAt > startAt`. Se
//    mandan en UTC ISO-8601, que es como el backend almacena (API.md §1).
// 3. `POST /orders` NO acepta campos de total: mandarlos da
//    `400 FIELD_NOT_EDITABLE` (BR-ORDER-014). Solo ids, cantidades y notas.


import 'package:dio/dio.dart';
import '../../../../../core/customer/chair_map.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../../data/models/json_reader.dart';
import '../../../domain/entities/chair_quote.dart';
import '../../../domain/repositories/checkout_repository.dart';
import '../../parsers/checkout_parsers.dart';

/// Llamadas HTTP del checkout.
class CheckoutRemoteDataSource {
  const CheckoutRemoteDataSource(this._dio);

  final Dio _dio;

  /// `GET /locations?isActive=true&pageSize=1&sort=name&order=asc`.
  ///
  /// Existe porque `GET /chairs/map` exige `locationId` en la query y la app no
  /// lo tiene de otra parte: el `businessId` sale del token, la sede no
  /// (`API.md` §7.5 devuelve la primera activa por defecto en `POST /orders`).
  Future<int?> defaultLocationId() async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.locations,
      queryParameters: <String, dynamic>{
        'isActive': true,
        'pageSize': 1,
        'sort': 'name',
        'order': 'asc',
      },
    );
    final List<Map<String, dynamic>> rows = unwrapList(response.data);
    if (rows.isEmpty) return null;
    return JsonReader.integer(rows.first['id']);
  }

  /// `GET /chairs/map?locationId=...`.
  Future<ChairMap> chairMap(int locationId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.chairsMap,
      queryParameters: <String, dynamic>{'locationId': locationId},
    );
    return CheckoutParsers.chairMap(unwrapData(response.data));
  }

  /// `GET /chairs/:id` — silla con `currentReservation` y `currentRental`.
  Future<ChairOccupancy> chairOccupancy(int chairId) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.chairById(chairId),
    );
    return CheckoutParsers.occupancy(unwrapData(response.data));
  }

  /// `GET /reservations/quote` (consulta; no crea nada).
  Future<ChairQuote> quote({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
    String? couponCode,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reservationsQuote,
      queryParameters: <String, dynamic>{
        'chairId': chairId,
        'startAt': startAt.toUtc().toIso8601String(),
        'endAt': endAt.toUtc().toIso8601String(),
        if (couponCode != null && couponCode.isNotEmpty)
          'applyCouponCode': couponCode,
      },
    );
    return CheckoutParsers.quote(unwrapData(response.data), chairId, startAt, endAt);
  }

  /// `POST /reservations` con `createOrder: false`.
  ///
  /// Se crea SIN pedido a propósito: el pedido completo (con los productos del
  /// carrito) se materializa después con un único `POST /orders` que ya lleva
  /// `reservationId`. Así hay un solo pedido, con sus ítems y sus totales, en vez
  /// de un pedido vacío que habría que rellenar después.
  Future<ReservationCreated> createReservation({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
    String? notes,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.reservations,
      data: <String, dynamic>{
        'chairId': chairId,
        'startAt': startAt.toUtc().toIso8601String(),
        'endAt': endAt.toUtc().toIso8601String(),
        'sendNotification': true,
        'createOrder': false,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
    return CheckoutParsers.reservation(unwrapData(response.data));
  }

  /// `POST /orders` — crea el pedido con los items del carrito.
  ///
  /// `channel: MOBILE_WEB` porque la orden viene de la app del cliente, no del
  /// POS (API.md §6.2). `place: true` para que pase a `PENDING` directamente:
  /// un `DRAFT` no lo ve nadie y sería un carrito guardado.
  Future<PlacedOrder> createOrder({
    required String type,
    required List<Map<String, dynamic>> items,
    int? chairId,
    int? reservationId,
    String? couponCode,
    String? customerNotes,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.orders,
      data: <String, dynamic>{
        'type': type,
        'channel': 'MOBILE_WEB',
        'place': true,
        'items': items,
        if (chairId != null) 'chairId': chairId,
        if (reservationId != null) 'reservationId': reservationId,
        if (couponCode != null && couponCode.isNotEmpty)
          'couponCode': couponCode,
        if (customerNotes != null && customerNotes.isNotEmpty)
          'customerNotes': customerNotes,
      },
    );
    return CheckoutParsers.placedOrder(unwrapData(response.data));
  }
}
