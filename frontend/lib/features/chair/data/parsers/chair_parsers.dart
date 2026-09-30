// Traducción de las respuestas del módulo de sillas a entidades de dominio.
// Módulo `features/chair/data/parsers`.
//
// POR QUÉ HAY UN ARCHIVO DE PARSEO Y NO `fromJson` EN LAS ENTIDADES
// -----------------------------------------------------------------
// Dos razones, y las dos importan:
//
// 1. Las entidades (`chair_booking.dart`) no deben saber que la API envuelve todo
//    en `{ success, data, meta }`. Si lo supieran, cada entidaduria arrastraría
//    `unwrapData` y el dominio dejaría de ser testeable sin el cliente HTTP.
// 2. `GET /chairs/:id` devuelve la silla ANIDADA en `data.chair`, mientras que
//    `GET /chairs/map` devuelve las sillas PLANAS dentro de `zones[].chairs[]`.
//    Es el mismo concepto con dos formas distintas, y el parser es el sitio donde
//    se reconcilian.
//
// NADA DE ESTE ARCHIVO LANZA
// Un campo que falta o que cambia de tipo produce `null` o el valor por defecto del
// modelo, nunca una excepción: una app que se abre con datos parciales es mejor que
// una que se cierra con un `TypeError` (ver `data/models/json_reader.dart`).

import '../../../../core/customer/chair_map.dart';
import '../../../../core/customer/venue_datasource.dart';
import '../../../../data/models/json_reader.dart';
import '../../domain/entities/chair_booking.dart';

/// Lectores de las respuestas de sillas, reservas y alquileres.
abstract final class ChairParsers {
  const ChairParsers._();

  // ------------------------------------------------------------- Cotización

  /// `GET /reservations/quote` → [ChairBookingQuote].
  ///
  /// `isAvailable = false` NO es un error: es un `200` con la reserva que estorba
  /// en `conflict` (API.md §7.8). Se traduce tal cual.
  static ChairBookingQuote quote(
    Map<String, dynamic> data,
    ChairBookingSlot slot,
  ) {
    final Map<String, dynamic> chair = JsonReader.orEmpty(data['chair']);
    final Map<String, dynamic> zone = JsonReader.orEmpty(data['zone']);
    final Map<String, dynamic>? conflict = JsonReader.map(data['conflict']);

    return ChairBookingQuote(
      slot: slot,
      isAvailable: JsonReader.boolean(data['isAvailable'], fallback: true),
      pricePerHourMinor: JsonReader.integerOr(data['pricePerHourMinor'], 0),
      durationMinutes: JsonReader.integerOr(data['durationMinutes'], 0),
      billableMinutes: JsonReader.integerOr(data['billableMinutes'], 0),
      subtotalMinor: JsonReader.integerOr(data['subtotalMinor'], 0),
      discountMinor: JsonReader.integerOr(data['discountMinor'], 0),
      taxMinor: JsonReader.integerOr(data['taxMinor'], 0),
      serviceFeeMinor: JsonReader.integerOr(data['serviceFeeMinor'], 0),
      totalMinor: JsonReader.integerOr(data['totalMinor'], 0),
      minimumApplied: JsonReader.boolean(data['minApplied']),
      taxRateBp: JsonReader.integerOr(data['taxRateBp'], 0),
      conflictCode: JsonReader.string(conflict?['code']),
      chairName: JsonReader.string(chair['name']),
      chairCode: JsonReader.string(chair['code']),
      zoneName: JsonReader.string(zone['name']),
    );
  }

  // ---------------------------------------------------------------- Reserva

  /// `POST /reservations` → [ChairBooking].
  static ChairBooking booking(Map<String, dynamic> data) => ChairBooking(
        id: JsonReader.integerOr(data['id'], 0),
        code: JsonReader.stringOr(data['code'], 'Reserva'),
        status: JsonReader.stringOr(data['status'], 'PENDING'),
        chairId: JsonReader.integer(data['chairId']),
        chairCode: JsonReader.string(data['chairCode']),
        startAt: JsonReader.dateTime(data['startAt']),
        endAt: JsonReader.dateTime(data['endAt']),
        durationMinutes: JsonReader.integerOr(data['durationMinutes'], 0),
        pricePerHourMinor: JsonReader.integerOr(data['pricePerHourMinor'], 0),
        rentalTotalMinor: JsonReader.integerOr(data['rentalTotalMinor'], 0),
      );

  // -------------------------------------------------------------- Ocupación

  /// `GET /chairs/:id` → [ChairOccupancy].
  ///
  /// LA SILLA VIENE ANIDADA en `data.chair` (API.md §7.7 la documenta
  /// aplana; el backend real la anida). Se leen las dos formas para que el panel
  /// siga funcionando si el backend algún día aplana la respuesta.
  ///
  /// `currentUserId` y `myActiveChairIds` sirven para decidir si el alquiler vivo
  /// es del actor, y SOLO con información que ya está en la sesión: no se llama a
  /// `GET /rentals/chair/:id/active` para averiguarlo, porque ese endpoint no está
  /// acotado al actor y filtraría datos de otros clientes (ver la nota de
  /// privacidad en `chair_booking.dart`).
  static ChairOccupancy occupancy(
    Map<String, dynamic> data, {
    required int currentUserId,
    required List<int> myActiveChairIds,
  }) {
    final Map<String, dynamic> rawChair = data.containsKey('chair')
        ? JsonReader.orEmpty(data['chair'])
        : data;
    final ChairInfo? chair = VenueRemoteDataSource.parseChair(rawChair);
    if (chair == null) {
      // Sin `id` no hay silla que pintar. Se lanza porque el panel no puede
      // inventarse una: una silla sin id no se puede cotizar ni reservar.
      throw FormatException(
        'GET /chairs/:id no devolvió una silla con id utilizable.',
        data,
      );
    }

    final Map<String, dynamic>? rental = JsonReader.map(data['currentRental']);
    final Map<String, dynamic>? reservation =
        JsonReader.map(data['currentReservation']);

    return ChairOccupancy(
      chair: chair,
      rentalId: JsonReader.integer(rental?['id']),
      rentalCode: JsonReader.string(rental?['code']),
      rentalStartAt: JsonReader.dateTime(rental?['startAt']),
      rentalEndAt: JsonReader.dateTime(rental?['endAt']),
      rentalStatus: JsonReader.string(rental?['status']),
      reservationId: JsonReader.integer(reservation?['id']),
      reservationCode: JsonReader.string(reservation?['code']),
      reservationStartAt: JsonReader.dateTime(reservation?['startAt']),
      reservationEndAt: JsonReader.dateTime(reservation?['endAt']),
      reservationStatus: JsonReader.string(reservation?['status']),
      // "Es mía" se decide con los alquileres del propio actor, que el
      // controlador ya tiene cargados. Nunca preguntando por el ocupante.
      isMine: myActiveChairIds.contains(chair.id),
    );
  }

  // --------------------------------------------------------------- Alquiler

  /// `Rental` plano (`GET /rentals/chair/:id/active`, `POST /rentals`,
  /// `POST /rentals/:id/extend`, `POST /rentals/:id/complete`) → [ChairRental].
  static ChairRental rental(
    Map<String, dynamic> data, {
    int? currentUserId,
    bool includeOccupantIdentity = false,
  }) {
    final int? customerId = JsonReader.integer(data['customerId']);
    // El nombre del ocupante SOLO se conserva si quien pregunta tiene
    // `rentals:read:any`. Para el resto, `null` aunque el servidor lo mande: es la
    // mitigación de cliente al endpoint que no acota por actor.
    final String? name = includeOccupantIdentity
        ? JsonReader.string(data['customerName'])
        : null;
    return ChairRental(
      id: JsonReader.integerOr(data['id'], 0),
      code: JsonReader.stringOr(data['code'], 'Alquiler'),
      status: JsonReader.stringOr(data['status'], 'ACTIVE'),
      chairId: JsonReader.integer(data['chairId']),
      chairCode: JsonReader.string(data['chairCode']),
      startAt: JsonReader.dateTime(data['startAt']),
      endAt: JsonReader.dateTime(data['endAt']),
      plannedMinutes: JsonReader.integerOr(data['plannedMinutes'], 0),
      billedMinutes: JsonReader.integerOr(data['billedMinutes'], 0),
      pricePerHourMinor: JsonReader.integerOr(data['pricePerHourMinor'], 0),
      subtotalMinor: JsonReader.integerOr(data['subtotalMinor'], 0),
      extensionsMinor: JsonReader.integerOr(data['extensionsMinor'], 0),
      extraMinutesMinor: JsonReader.integerOr(data['extraMinutesMinor'], 0),
      totalMinor: JsonReader.integerOr(data['totalMinor'], 0),
      customerId: includeOccupantIdentity ? customerId : null,
      customerName: name,
      isMine: currentUserId != null && customerId != null && customerId == currentUserId,
    );
  }
}
