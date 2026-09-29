// Llamadas HTTP de reservas y alquileres. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/reservations/reservations.routes.ts` y
// `backend/src/modules/rentals/rentals.routes.ts`.
//
// RESERVA Y ALQUILER NO SON LO MISMO, Y LA DIFERENCIA CUESTA DINERO
//   - La RESERVA es una ventana futura: se confirma, se extiende y se cancela.
//   - El ALQUILER es una sesión en curso: se extiende con
//     `POST /rentals/:id/extend` (que suma al `balanceMinor` del pedido abierto) y
//     se cierra con `POST /rentals/:id/complete`, que aplica el mínimo de 30
//     minutos y cobra el exceso al PRECIO CONGELADO (BR-RENTAL-003/004).
// Extender la reserva de un alquiler ya ACTIVO da `422
// RESERVATION_ALREADY_ACTIVE`: el camino correcto es extender el alquiler.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_rentals.dart';
import '../../../domain/entities/admin_spaces.dart';

/// Datasource de reservas y alquileres.
class AdminRentalsDataSource {
  const AdminRentalsDataSource(this._dio);

  final Dio _dio;

  // ------------------------------------------------------------------ Reservas
  /// `GET /reservations` — ventana futura, con filtros de fecha, estado, silla y
  /// código. El backend resuelve el rango en la zona del NEGOCIO.
  Future<List<AdminReservation>> reservations({
    DateTime? from,
    DateTime? to,
    String? status,
    int? chairId,
    String? code,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reservations,
      queryParameters: <String, dynamic>{
        'pageSize': 100,
        // Sin `sort`: la columna por defecto de `GET /reservations` es
        // `startAt`, y `order` se aplica sobre ella (ver
        // `core/network/README.md`, "Orden de listados").
        'order': 'asc',
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
        if (status != null && status.isNotEmpty) 'status': status,
        if (chairId != null) 'chairId': chairId,
        if (code != null && code.isNotEmpty) 'code': code.trim(),
      },
    );
    return _map(unwrapList(response.data), AdminReservation.tryParse);
  }

  /// `POST /reservations/:id/confirm` — `PENDING` → `CONFIRMED`.
  ///
  /// No devuelve cuerpo útil: el llamador invalida el listado para releer el
  /// estado, que es la autoridad.
  Future<void> confirmReservation(int reservationId) async {
    await _dio.post<dynamic>(ApiEndpoints.reservationConfirm(reservationId));
  }

  /// `POST /reservations/:id/check-in` — `CONFIRMED` → `CHECKED_IN`.
  ///
  /// El check-in es el punto en el que la reserva pasa a ser un alquiler en
  /// curso: por eso NO se llama a `extendReservation` sobre una reserva ya
  /// activa (el backend responde `422 RESERVATION_ALREADY_ACTIVE`).
  Future<void> checkInReservation(int reservationId, {String? notes}) async {
    await _dio.post<dynamic>(
      ApiEndpoints.reservationCheckIn(reservationId),
      data: <String, dynamic>{
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
  }

  /// `POST /reservations/:id/extend` — mueve `endAt` de una reserva que AÚN no
  /// empezó. Solo válido en `PENDING`/`CONFIRMED`.
  Future<void> extendReservation(
    int reservationId,
    DateTime newEndAt,
  ) async {
    await _dio.post<dynamic>(
      ApiEndpoints.reservationExtend(reservationId),
      data: <String, dynamic>{'endAt': newEndAt.toUtc().toIso8601String()},
    );
  }

  /// `POST /reservations/:id/cancel` — motivo obligatorio; el backend guarda el
  /// motivo en el historial y libera la silla.
  Future<void> cancelReservation(int reservationId, String reason) async {
    await _dio.post<dynamic>(
      ApiEndpoints.reservationCancel(reservationId),
      data: <String, dynamic>{'reason': reason},
    );
  }

  // ------------------------------------------------------------------ Alquileres
  /// `GET /rentals/active` — los que muestran el temporizador en vivo.
  Future<List<AdminRental>> activeRentals({int? locationId}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.rentalsActive,
      queryParameters: <String, dynamic>{
        'pageSize': 100,
        // Sin `sort`: la columna por defecto de `GET /rentals/active` es
        // `startAt asc` (ver `core/network/README.md`, "Orden de listados").
        'order': 'asc',
        if (locationId != null) 'locationId': locationId,
      },
    );
    return _map(unwrapList(response.data), AdminRental.tryParse);
  }

  /// `GET /rentals` — histórico con filtros.
  Future<List<AdminRental>> rentals({
    String? status,
    int? chairId,
    int? customerId,
    DateTime? from,
    DateTime? to,
    int pageSize = 100,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.rentals,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        // Sin `sort`: la columna por defecto de `GET /rentals` es `startAt desc`
        // (ver `core/network/README.md`, "Orden de listados").
        'order': 'desc',
        if (status != null && status.isNotEmpty) 'status': status,
        if (chairId != null) 'chairId': chairId,
        if (customerId != null) 'customerId': customerId,
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      },
    );
    return _map(unwrapList(response.data), AdminRental.tryParse);
  }

  /// `POST /rentals/:id/extend` — añade minutos al alquiler en curso.
  ///
  /// `additionalMinutes` va de 5 a 1440. El coste se suma al `balanceMinor` del
  /// pedido abierto: no hay que tocar el pedido desde aquí.
  Future<Map<String, dynamic>> extendRental(
    int rentalId, {
    required int additionalMinutes,
    String? reason,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.rentalExtend(rentalId),
      data: <String, dynamic>{
        'additionalMinutes': additionalMinutes,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
    return unwrapData(response.data);
  }

  /// `POST /rentals/:id/complete` — cierra el alquiler y calcula el cobro.
  Future<Map<String, dynamic>> completeRental(
    int rentalId, {
    String? notes,
    bool waiveOvertime = false,
    String? waiveReason,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.rentalComplete(rentalId),
      data: <String, dynamic>{
        'waiveOvertime': waiveOvertime,
        if (waiveReason != null && waiveReason.isNotEmpty)
          'waiveReason': waiveReason,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
    return unwrapData(response.data);
  }

  /// `POST /rentals` — alquiler walk-in (cliente sin reserva).
  Future<Map<String, dynamic>> createRental({
    required int chairId,
    required int plannedMinutes,
    int? customerId,
    int? reservationId,
    String? notes,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.rentals,
      data: <String, dynamic>{
        'chairId': chairId,
        'plannedMinutes': plannedMinutes,
        if (customerId != null) 'customerId': customerId,
        if (reservationId != null) 'reservationId': reservationId,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
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
