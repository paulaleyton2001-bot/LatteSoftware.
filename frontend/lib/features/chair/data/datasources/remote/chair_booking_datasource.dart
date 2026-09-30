// Llamadas HTTP del módulo de sillas. Módulo `features/chair/data/datasources/remote`.
//
// UN SOLO ARCHIVO CONOCE LAS RUTAS DE ESTA FEATURE
// Lee `ApiEndpoints` (que es donde viven los paths) y arma los cuerpos JSON. Los
// `fromJson` están aquí, y no en las entidades, para que el dominio no dependa de
// `dio` ni de la forma concreta del envoltorio `{ success, data, meta }`.
//
// ─────────────────────────────────────────────────────────────────────────────
// DESVIACIONES DE `docs/API.md` QUE ESTA CAPA TIENE QUE CONOCER
//
// 1. `POST /rentals` — API.md §7.9 dice `{ rental, chair, order, reservation }`.
//    El backend real devuelve `{ rental, chairStatus, chairStatusChangedAt }`
//    (`backend/src/modules/rentals/rentals.controller.ts` L142). Se lee la forma
//    real. Verificado con `curl` → 201:
//      {"data":{"rental":{...},"chairStatus":"OCCUPIED",
//                "chairStatusChangedAt":"2026-09-29T17:32:32.006Z"}, ...}
//
// 2. `GET /chairs/:id` — API.md §7.7 dice `{ ...Chair, zone, ... }` (aplanado).
//    El backend real anida: `{"data":{"chair":{...},"currentReservation":null,
//    "currentRental":{...},"stats":{...}}}`. Se lee `data.chair`.
//
// 3. `POST /rentals` NO exige cabecera `Idempotency-Key`. El enunciado del trabajo
//    la daba por obligatoria, pero API.md §1 y §14.8 son explícitos: «`POST
//    /payments` es el ÚNICO que exige `Idempotency-Key`», y el código del backend
//    solo la lee en `payments.controller.ts`. Verificado con `curl` → 201 sin ella.
//    Aun así SE ENVÍA: es una cabecera inocua, el backend la permite en CORS
//    (`shared/middleware/security.ts`), y deja la llamada lista para cuando el
//    walk-in se vuelva idempotente. El coste de mandarla es cero y el beneficio
//    (no tener que tocar esta capa) es real.
//
// 4. `POST /rentals/:id/extend` devuelve `{ rental, extension, order }` y
//    `POST /rentals/:id/complete` devuelve `{ rental, order, chair, charge }`.
//    De los dos solo se necesita `rental`.
//
// 5. `PATCH /chairs/:id/status` devuelve la silla COMPLETA en `data` (no un
//    resumen), así que se puede devolver un `ChairInfo` fresco sin volver a pedir
//    el mapa.
// ─────────────────────────────────────────────────────────────────────────────

import 'package:dio/dio.dart';

import '../../../../../core/customer/chair_map.dart';
import '../../../../../core/customer/venue_datasource.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../../../data/models/json_reader.dart';
import '../../../domain/entities/chair_booking.dart';
import '../../parsers/chair_parsers.dart';

/// Llamadas HTTP de la pestaña «Silla`.
class ChairBookingDataSource {
  const ChairBookingDataSource(this._dio);

  final Dio _dio;

  // -------------------------------------------------------------- Consulta

  /// `GET /chairs/:id` — silla + alquiler/reserva en curso.
  ///
  /// No trae datos del ocupante (solo sus horas), y por eso es la lectura que se
  /// usa siempre, para cualquier rol.
  Future<ChairOccupancy> chairOccupancy({
    required int chairId,
    required int currentUserId,
    required List<int> myActiveChairIds,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.chairById(chairId),
    );
    return ChairParsers.occupancy(
      unwrapData(response.data),
      currentUserId: currentUserId,
      myActiveChairIds: myActiveChairIds,
    );
  }

  /// `GET /rentals/chair/:chairId/active` — alquiler vivo, o `null` con `200`.
  ///
  /// SOLO se llama si `rentals:read:any` está en el token. El endpoint no está
  /// acotado al actor (`rentals.service.ts#getActiveByChair` llama a
  /// `findActiveByChair` sin filtrar), de modo que devolvería el nombre de
  /// cualquier cliente a cualquiera que preguntara. Con
  /// [includeOccupantIdentity] en `false` el parser borra `customerId` y
  /// `customerName` aunque el servidor los mande.
  Future<ChairRental?> activeRentalByChair(
    int chairId, {
    required int currentUserId,
    required bool includeOccupantIdentity,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.rentalActiveByChair(chairId),
    );
    final Object? data = _payloadOf(response.data);
    if (data is! Map<String, dynamic>) return null;
    return ChairParsers.rental(
      data,
      currentUserId: currentUserId,
      includeOccupantIdentity: includeOccupantIdentity,
    );
  }

  /// `GET /reservations/quote` — cotización. `GET`, no `POST`, y con query.
  Future<ChairBookingQuote> quote({
    required int chairId,
    required ChairBookingSlot slot,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.reservationsQuote,
      queryParameters: <String, dynamic>{
        'chairId': chairId,
        'startAt': slot.startAt.toUtc().toIso8601String(),
        'endAt': slot.endAt.toUtc().toIso8601String(),
      },
    );
    return ChairParsers.quote(unwrapData(response.data), slot);
  }

  // -------------------------------------------------------------- Reserva

  /// `POST /reservations`.
  ///
  /// `createOrder: false` a propósito: esta reserva no lleva productos, así que no
  /// hay nada que facturar todavía. El cobro nace cuando alguien consume algo o
  /// cuando sala hace el check-in.
  Future<ChairBooking> createReservation({
    required int chairId,
    required ChairBookingSlot slot,
    String? notes,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.reservations,
      data: <String, dynamic>{
        'chairId': chairId,
        'startAt': slot.startAt.toUtc().toIso8601String(),
        'endAt': slot.endAt.toUtc().toIso8601String(),
        'sendNotification': true,
        'createOrder': false,
        if (notes != null && notes.isNotEmpty) 'notes': notes,
      },
    );
    return ChairParsers.booking(unwrapData(response.data));
  }

  /// `POST /reservations/:id/confirm` (`reservations:update`).
  ///
  /// POR QUÉ EXISTE Y POR QUÉ LA PIDE EL CLIENTE
  /// `POST /reservations` devuelve la reserva en `PENDING`, y una `PENDING` NO aparta
  /// la silla: verificado con `curl`, tras crearla `GET /chairs/:id` sigue
  /// devolviendo `status: "AVAILABLE"` y el `quote` de esa franja da
  /// `isAvailable: false`. La silla pasa a `RESERVED` solo al confirmar.
  ///
  /// El permiso es `reservations:update`, que el `CUSTOMER` SÍ tiene (comprobado:
  /// `POST /reservations/6/confirm` → `200` con el token de `cliente1@`). Dejar la
  /// reserva en `PENDING` sin poder confirmarla desde el móvil convertiría el
  /// producto diferencial en un formulario que no aparta nada.
  Future<ChairBooking> confirmReservation(int reservationId) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.reservationConfirm(reservationId),
    );
    return ChairParsers.booking(unwrapData(response.data));
  }

  /// `POST /reservations/:id/cancel` (`reservations:cancel`).
  ///
  /// `reason` es obligatorio (`API.md` §7.8: `400` sin él) y se manda siempre con
  /// un texto legible, porque es lo que verá el personal en el historial.
  Future<ChairBooking> cancelReservation(
    int reservationId, {
    required String reason,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.reservationCancel(reservationId),
      data: <String, dynamic>{'reason': reason},
    );
    return ChairParsers.booking(unwrapData(response.data));
  }

  // ------------------------------------------------------------- Alquileres

  /// `POST /rentals` — alquiler sin cita (exige `rentals:create`).
  ///
  /// La cabecera `Idempotency-Key` se manda aunque el backend no la exija (ver la
  /// nota 3 de la cabecera del archivo). El valor se genera UNA vez por intento
  /// desde el controlador, no aquí: si se generara en cada llamada, un reintento
  /// recibiría una clave nueva y no protegería de nada.
  Future<ChairRental> openWalkInRental({
    required int chairId,
    required int plannedMinutes,
    required String idempotencyKey,
    int? customerId,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.rentals,
      data: <String, dynamic>{
        'chairId': chairId,
        'plannedMinutes': plannedMinutes,
        if (customerId != null && customerId > 0) 'customerId': customerId,
      },
      options: Options(
        headers: <String, dynamic>{
          ApiEndpoints.idempotencyHeader: idempotencyKey,
        },
      ),
    );
    // La respuesta envuelve el alquiler en `{ rental: {...} }` (desviación 1).
    final Map<String, dynamic> data = unwrapData(response.data);
    final Map<String, dynamic> rental =
        JsonReader.orEmpty(data['rental']);
    return ChairParsers.rental(rental.isEmpty ? data : rental);
  }

  /// `POST /rentals/:id/extend` (`rentals:extend`).
  Future<ChairRental> extendRental({
    required int rentalId,
    required int additionalMinutes,
  }) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.rentalExtend(rentalId),
      data: <String, dynamic>{'additionalMinutes': additionalMinutes},
    );
    final Map<String, dynamic> data = unwrapData(response.data);
    final Map<String, dynamic> rental = JsonReader.orEmpty(data['rental']);
    return ChairParsers.rental(rental.isEmpty ? data : rental);
  }

  /// `POST /rentals/:id/complete` (`rentals:complete`).
  Future<ChairRental> completeRental(int rentalId) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.rentalComplete(rentalId),
      data: <String, dynamic>{},
    );
    final Map<String, dynamic> data = unwrapData(response.data);
    final Map<String, dynamic> rental = JsonReader.orEmpty(data['rental']);
    return ChairParsers.rental(rental.isEmpty ? data : rental);
  }

  // ------------------------------------------------------------------ Silla

  /// `PATCH /chairs/:id/status` (`chairs:status:update`).
  ///
  /// `reason` es obligatorio para `BLOCKED` y `MAINTENIMIENTO`; sin él el backend
  /// responde `400`, así que se comprueba aquí y se lanza antes de wasting un viaje.
  Future<ChairInfo> setChairStatus({
    required int chairId,
    required String status,
    String? reason,
  }) async {
    final bool needsReason = status == 'BLOCKED' || status == 'MAINTENANCE';
    if (needsReason && (reason == null || reason.trim().isEmpty)) {
      throw ArgumentError.value(
        reason,
        'reason',
        'El estado $status exige un motivo (API.md §7.7).',
      );
    }
    final Response<dynamic> response = await _dio.patch<dynamic>(
      ApiEndpoints.chairStatus(chairId),
      data: <String, dynamic>{
        'status': status,
        if (needsReason) 'reason': reason!.trim(),
      },
    );
    // Devuelve la silla completa, así que no hace falta volver a pedir el mapa
    // para conocer el estado nuevo.
    final ChairInfo? chair =
        VenueRemoteDataSource.parseChair(unwrapData(response.data));
    if (chair == null) {
      throw StateError(
        'La respuesta de PATCH /chairs/$chairId/status no trajo una silla legible.',
      );
    }
    return chair;
  }

  /// Saca el `data` del envoltorio, tolerando que ya venga desenvolverto.
  ///
  /// `unwrapData` de `api_client.dart` es el sitio natural, pero devuelve
  /// `Map<String, dynamic>` y aquí hace falta distinguir "sin alquiler" (`null`)
  /// de "con alquiler" (mapa), que es un caso legítimo de `GET
  /// /rentals/chair/:id/active` (API.md §7.9: `data = null` con `200`).
  Object? _payloadOf(Object? body) {
    if (body is! Map<String, dynamic>) return null;
    if (body.containsKey('data')) return body['data'];
    return body;
  }
}
