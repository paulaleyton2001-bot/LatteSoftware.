// Regresión del módulo de sillas: la pestaña «Silla» en su conjunto.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ EXISTE ESTE ARCHIVO
// ─────────────────────────────────────────────────────────────────────────────
// La pestaña «Silla» estuvo meses con el mapa en solo lectura: al tocar una silla
// se pintaba un borde verde y no pasaba NADA, y la `RentalRepository` no declaraba
// ni un método de escritura, así que el `logcat` no mostraba ninguna llamada a la
// API porque la app NI LO INTENTABA. Compilaba, `flutter analyze` salía limpio y
// los tests pasaban.
//
// Estos tests fijan las cuatro cosas que转换 ese bug en algo que no se puede
// volver a romper sin que falle la suite:
//
//   1. LA MATRIZ DE PERMISOS. Verificada contra el backend con peticiones reales
//      (ver `lib/features/chair/domain/entities/chair_capabilities.dart`). Un
//      `CUSTOMER` puede RESERVAR y CONFIRMAR; NO puede alquilar sin cita, ni
//      extender, ni terminar, ni cambiar el estado de una silla. Si alguien
//      «arregla» la matriz por su cuenta, este test lo dice.
//
//   2. LA ETIQUETA DE LA CELDA. `numberLabel` venía con tres criterios distintos
//      (`1,2,3` en Terraza, `M1,M2` en Interior, `B1,B2` en Ventana) y el plano
//      mezclaba `TZ-01`, `IN-M01` y `VN-01`. Ahora la celda pinta SIEMPRE el
//      `code`, que es el único valor `UNIQUE` global e inmutable y el mismo que
//      aparece en el alquiler y en la reserva.
//
//   3. `PENDING` NO ES `CONFIRMED`. Verificado con `curl`: tras
//      `POST /reservations` la silla sigue en `AVAILABLE` y el `quote` de esa
//      franja da `isAvailable: false`. Solo `POST /reservations/:id/confirm` la
//      pasa a `CONFIRMED` y pone la silla en `RESERVED`. La UI que diga «ya está
//      reservada» con una `PENDING` está mintiendo.
//
//   4. EL ESTADO DE LA RESERVA SE CONSERVA. Antes era un `bool created`: el
//      `RES-900011` se perdía y quien reservaba no tenía nada que decir en el
//      mostrador. Y el fallo del envío vivía en un `_lastFailure` PRIVADO del
//      notifier que ningún widget leía, así que un `409` no pintaba nada.

import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/core/customer/chair_map.dart';
import 'package:latte_coffee/core/error/failures.dart';
import 'package:latte_coffee/features/chair/data/parsers/chair_parsers.dart';
import 'package:latte_coffee/features/chair/domain/entities/chair_booking.dart';
import 'package:latte_coffee/features/chair/domain/entities/chair_capabilities.dart';
import 'package:latte_coffee/features/chair/presentation/chair_booking_state.dart';

/// Permisos EXACTOS que devuelve `GET /auth/me` para cada rol.
///
/// No son inventados: se copiaron de la respuesta real del 2026-09-29
/// (`POST /auth/login` con `cliente1@lattecoffe.co` y con
/// `prueba@lattecoffe.co`). Fijarlos aquí es lo que convierte «lo que creo que
/// hace la matriz» en un contrato: si el backend cambia un permiso, este test
/// falla y hay que ir a mirarlo, en vez de que la app empiece a ofrecer botones
/// que van a recibir `403`.
const List<String> customerPermissions = <String>[
  'auth:login',
  'auth:logout',
  'auth:profile:read',
  'auth:register',
  'business:read',
  'categories:read',
  'chairs:map',
  'chairs:read',
  'customers:read',
  'customers:update',
  'discounts:read',
  'discounts:validate',
  'locations:read',
  'notifications:read',
  'orders:cancel',
  'orders:create',
  'orders:read',
  'orders:receipt:read',
  'orders:update',
  'payments:create',
  'payments:read',
  'products:read',
  'rentals:read',
  'reservations:cancel',
  'reservations:create',
  'reservations:read',
  'reservations:update',
  'zones:read',
];

const List<String> adminPermissions = <String>[
  'chairs:map',
  'chairs:read',
  'chairs:status:update',
  'rentals:complete',
  'rentals:create',
  'rentals:extend',
  'rentals:read',
  'rentals:read:any',
  'reservations:cancel',
  'reservations:checkin',
  'reservations:create',
  'reservations:extend',
  'reservations:read',
  'reservations:update',
];

ChairInfo _chair({
  int id = 1,
  String code = 'TZ-01',
  String? numberLabel,
  String status = 'AVAILABLE',
  int price = 600000,
  bool bookable = true,
}) =>
    ChairInfo(
      id: id,
      code: code,
      status: status,
      pricePerHourMinor: price,
      numberLabel: numberLabel,
    );

void main() {
  group('Matriz de permisos (verificada con curl el 2026-09-29)', () {
    test('CUSTOMER puede reservar y confirmar, pero no alquilar sin cita', () {
      final ChairCapabilities caps =
          ChairCapabilities.fromPermissions(customerPermissions);

      expect(caps.canReserve, isTrue, reason: 'POST /reservations → 201');
      expect(caps.canConfirmReservation, isTrue,
          reason: 'POST /reservations/:id/confirm → 200');
      expect(caps.canCancelReservation, isTrue,
          reason: 'POST /reservations/:id/cancel → 200');

      // Los cuatro 403 verificados con el token de `cliente1@lattecoffe.co`:
      //   POST /rentals               → 403 "rentals:create"
      //   POST /rentals/:id/extend    → 403 "rentals:extend"
      //   POST /rentals/:id/complete  → 403 "rentals:complete"
      //   PATCH /chairs/:id/status    → 403 "chairs:status:update"
      expect(caps.canOpenWalkIn, isFalse);
      expect(caps.canExtendRental, isFalse);
      expect(caps.canCompleteRental, isFalse);
      expect(caps.canChangeChairStatus, isFalse);
    });

    test('un CUSTOMER NO ve la identidad de quien ocupa otra silla', () {
      // `GET /rentals/chair/:id/active` NO está acotado al actor: un CUSTOMER
      // recibe el `customerName` de cualquiera. `canSeeOccupantIdentity` es lo que
      // impide que la app lo pida y lo pinte.
      expect(
        ChairCapabilities.fromPermissions(customerPermissions)
            .canSeeOccupantIdentity,
        isFalse,
      );
    });

    test('ADMIN puede todo lo del módulo de sillas', () {
      final ChairCapabilities caps =
          ChairCapabilities.fromPermissions(adminPermissions);
      expect(caps.canReserve, isTrue);
      expect(caps.canOpenWalkIn, isTrue);
      expect(caps.canExtendRental, isTrue);
      expect(caps.canCompleteRental, isTrue);
      expect(caps.canChangeChairStatus, isTrue);
      expect(caps.canSeeOccupantIdentity, isTrue);
    });

    test('sin sesión no hay ninguna capacidad y sí un motivo para cada una', () {
      const ChairCapabilities caps = ChairCapabilities.none;
      expect(caps.isReadOnly, isTrue);
      // Un botón apagado SIN motivo es un botón muerto: estas son las cuatro
      // cadenas que la pantalla pinta debajo de cada uno.
      for (final String? reason in <String?>[
        caps.walkInBlockedReason,
        caps.extendBlockedReason,
        caps.completeBlockedReason,
        caps.chairStatusBlockedReason,
      ]) {
        expect(reason, isNotNull);
        expect(reason, isNotEmpty);
      }
    });

    test('con permiso no hay motivo de denegación que pintar', () {
      final ChairCapabilities caps =
          ChairCapabilities.fromPermissions(adminPermissions);
      expect(caps.walkInBlockedReason, isNull);
      expect(caps.extendBlockedReason, isNull);
      expect(caps.completeBlockedReason, isNull);
      expect(caps.chairStatusBlockedReason, isNull);
    });
  });

  group('Etiqueta de la celda del mapa', () {
    test('pinta el `code`, no el `numberLabel` de cada zona', () {
      // LaMezcla que se veía antes: `1,2,3` en Terraza, `M1,M2` en Interior,
      // `B1,B2` en Ventana. Con el `code` el plano tiene un solo criterio.
      expect(_chair(code: 'TZ-01', numberLabel: '1').cellLabel, 'TZ-01');
      expect(_chair(code: 'IN-M01', numberLabel: 'M1').cellLabel, 'IN-M01');
      expect(_chair(code: 'VN-01', numberLabel: 'B1').cellLabel, 'VN-01');
    });

    test('el mismo `code` en tres zonas da tres etiquetas distintas', () {
      // Si dos zonas pintaran el `numberLabel`, `1` y `M1` podrían referirse a la
      // misma silla y no habría forma de saberlo.
      expect(
        <String>{
          _chair(id: 1, code: 'TZ-01', numberLabel: '1').cellLabel,
          _chair(id: 7, code: 'IN-M01', numberLabel: 'M1').cellLabel,
          _chair(id: 11, code: 'VN-01', numberLabel: 'B1').cellLabel,
        },
        hasLength(3),
      );
    });

    test('sin `code` legible cae a `S<id>` en vez de romperse', () {
      expect(_chair(id: 42, code: '   ').cellLabel, 'S42');
    });

    test('el nombre comercial NO se pierde: vive aparte', () {
      final ChairInfo chair = ChairInfo(
        id: 1,
        code: 'TZ-01',
        status: 'AVAILABLE',
        pricePerHourMinor: 600000,
        name: 'Terraza 1',
        numberLabel: '1',
      );
      expect(chair.cellLabel, 'TZ-01');
      expect(chair.displayName, 'Terraza 1');
      expect(chair.businessName, 'Terraza 1');
    });
  });

  group('PENDING no es CONFIRMED', () {
    test('una reserva recién creada está PENDING y no aparta la silla', () {
      // Reproduce lo que se vio con `curl`: `POST /reservations` → 201 PENDING y
      // `GET /chairs/:id` → `status: "AVAILABLE"`. La UI que dijera «la silla ya
      // está reservada» con este estado estaría mintiendo sobre el dinero.
      const ChairBooking pending = ChairBooking(
        id: 11,
        code: 'RES-900011',
        status: 'PENDING',
      );
      expect(pending.isPending, isTrue);
      expect(pending.isOpen, isTrue, reason: 'se puede cancelar o confirmar');

      final ChairOccupancy occupancy = ChairOccupancy(
        chair: _chair(status: 'AVAILABLE'),
        reservationId: 11,
        reservationCode: 'RES-900011',
        reservationStatus: 'PENDING',
      );
      expect(occupancy.hasPendingReservation, isTrue);
    });

    test('una reserva confirmada ya NO es pendiente', () {
      const ChairBooking confirmed = ChairBooking(
        id: 11,
        code: 'RES-900011',
        status: 'CONFIRMED',
      );
      expect(confirmed.isPending, isFalse);
      final ChairOccupancy occupancy = ChairOccupancy(
        chair: _chair(status: 'RESERVED'),
        reservationId: 11,
        reservationCode: 'RES-900011',
        reservationStatus: 'CONFIRMED',
      );
      expect(occupancy.hasPendingReservation, isFalse);
    });

    test('cancelada ya no está pendiente ni abierta', () {
      const ChairBooking cancelled = ChairBooking(
        id: 11,
        code: 'RES-900011',
        status: 'CANCELLED',
      );
      expect(cancelled.isPending, isFalse);
      expect(cancelled.isOpen, isFalse);
    });
  });

  group('El estado de la reserva se conserva (el código no se pierde)', () {
    ChairBookingState _stateWith(ChairBooking booking) => ChairBookingState(
          startAt: DateTime.utc(2026, 9, 29, 19),
          durationMinutes: 120,
          stage: ChairBookingStage.done,
          booking: booking,
        );

    test('la reserva creada queda en el estado, con su código', () {
      final ChairBookingState state = _stateWith(
        const ChairBooking(
          id: 11,
          code: 'RES-900011',
          status: 'PENDING',
          chairCode: 'TZ-01',
        ),
      );
      expect(state.created, isTrue);
      expect(state.booking?.code, 'RES-900011');
      expect(state.booking?.chairCode, 'TZ-01');
    });

    test('«puede confirmar» necesita las DOS cosas: PENDING y permiso', () {
      final ChairBookingState state = _stateWith(
        const ChairBooking(id: 11, code: 'RES-900011', status: 'PENDING'),
      );
      expect(
        state.canConfirmReservation(pending: true, hasPermission: true),
        isTrue,
      );
      // Sin permiso, `false`: es lo que deja el botón apagado CON el motivo debajo
      // en vez de muerto.
      expect(
        state.canConfirmReservation(pending: true, hasPermission: false),
        isFalse,
      );
      // Ya confirmada, tampoco: confirmar dos veces daría 422.
      expect(
        state.canConfirmReservation(pending: false, hasPermission: true),
        isFalse,
      );
    });

    test('con una reserva ya creada no se puede volver a enviar', () {
      final ChairBookingState state = _stateWith(
        const ChairBooking(id: 11, code: 'RES-900011', status: 'PENDING'),
      );
      expect(state.canSubmit, isFalse);
      expect(state.blockedReason, 'Esta reserva ya está creada.');
    });

    test('el fallo del envío vive en el estado, para que se PINTE', () {
      // Antes vivía en un `_lastFailure` privado del notifier: ningún widget lo
      // leía, así que un `409` no pintaba NADA.
      final ChairBookingState state = ChairBookingState(
        startAt: DateTime.utc(2026, 9, 29, 19),
      ).copyWith(
        failure: const ConflictFailure(code: 'CHAIR_ALREADY_RESERVED'),
      );
      expect(state.failure, isNotNull);
      expect(state.failure!.code, 'CHAIR_ALREADY_RESERVED');
    });

    test('`copyWith(clearFailure: true)` limpia el error anterior', () {
      final ChairBookingState withError = ChairBookingState(
        startAt: DateTime.utc(2026, 9, 29, 19),
      ).copyWith(failure: const ValidationFailure(message: 'algo'));
      expect(withError.failure, isNotNull);
      expect(withError.copyWith(clearFailure: true).failure, isNull);
    });
  });

  group('Traducción de fallos de reserva', () {
    test('el 409 se explica en español, no con el código', () {
      final Failure translated = explainBookingFailure(
        const ConflictFailure(
          code: 'CHAIR_ALREADY_RESERVED',
          message: 'La silla ya está reservada en esa franja horaria',
        ),
      );
      expect(translated.code, 'CHAIR_ALREADY_RESERVED',
          reason: 'el código se conserva para soporte');
      expect(translated.message, isNot(contains('CHAIR_ALREADY_RESERVED')));
      expect(translated.message, contains('Otra persona'));
    });

    test('conserva el SUBTIPO, para que el banner siga siendo el correcto', () {
      // Si se devolviera un `UnknownFailure`, un 409 se pintaría con el icono de
      // «error desconocido» y `isRetryable` cambiaría de verdad.
      final Failure translated = explainBookingFailure(
        const ConflictFailure(code: 'CHAIR_ALREADY_RESERVED'),
      );
      expect(translated, isA<ConflictFailure>());
      expect(translated.isRetryable, isFalse);

      final Failure network = explainBookingFailure(
        const NetworkFailure(message: 'sin conexión'),
      );
      expect(network, isA<NetworkFailure>());
      expect(network.isRetryable, isTrue,
          reason: 'un fallo de red tiene que poder reintentarse');
    });

    test('un fallo sin código propio devuelve el MISMO objeto', () {
      const Failure original = ServerFailure();
      expect(identical(explainBookingFailure(original), original), isTrue);
    });

    test('cubre los códigos reales del backend', () {
      for (final String code in <String>[
        'PAST_DATE',
        'INVALID_ADVANCE_TIME',
        'RESERVATION_TOO_LONG',
        'CHAIR_NOT_BOOKABLE',
        'INVALID_DATE_RANGE',
        'INVALID_RESERVATION_TRANSITION',
      ]) {
        final Failure translated =
            explainBookingFailure(ValidationFailure(message: 'crudo', code: code));
        expect(translated.message, isNot('crudo'), reason: 'código $code');
      }
    });
  });

  group('Franja de reserva', () {
    test('una duración no válida bloquea el envío CON motivo', () {
      final ChairBookingState state = ChairBookingState(
        startAt: DateTime.utc(2030, 1, 1, 15),
        durationMinutes: 0,
      );
      expect(state.canSubmit, isFalse);
      expect(state.blockedReason, isNotNull);
    });

    test('una franja en el pasado bloquea el envío CON motivo', () {
      final ChairBookingState state =
          ChairBookingState(startAt: DateTime.utc(2020, 1, 1, 15));
      expect(state.canSubmit, isFalse);
      expect(state.blockedReason, contains('ya pasó'));
    });

    test('el fin es el inicio más la duración efectiva', () {
      final ChairBookingState state = ChairBookingState(
        startAt: DateTime.utc(2030, 1, 1, 15),
        durationMinutes: 60,
        customMinutes: 90,
      );
      expect(state.effectiveMinutes, 90);
      expect(state.endAt, DateTime.utc(2030, 1, 1, 16, 30));
      expect(state.slot.durationMinutes, 90);
    });

    test('las duraciones fijas cubren lo que la gente pide de verdad', () {
      expect(kChairDurationPresets, <int>[30, 60, 120, 180, 240]);
      expect(chairDurationLabel(30), '30 min');
      expect(chairDurationLabel(60), '1 h');
      expect(chairDurationLabel(120), '2 h');
      expect(chairDurationLabel(90), '1 h 30 min');
    });
  });

  group('Parseo de la ocupación (GET /chairs/:id)', () {
    test('lee la silla ANIDADA en `data.chair`, que es como la manda el backend',
        () {
      final ChairOccupancy occupancy = ChairParsers.occupancy(
        <String, dynamic>{
          'chair': <String, dynamic>{
            'id': 7,
            'code': 'IN-M01',
            'status': 'OCCUPIED',
            'pricePerHourMinor': 500000,
          },
          'currentRental': <String, dynamic>{
            'id': 4,
            'code': 'RENT-900004',
            'status': 'ACTIVE',
            'startAt': '2026-09-29T17:27:19.844Z',
            'endAt': '2026-09-29T18:27:19.844Z',
          },
        },
        currentUserId: 11,
        myActiveChairIds: const <int>[],
      );
      expect(occupancy.chair.id, 7);
      expect(occupancy.rentalId, 4,
          reason: 'sin esto no se puede llamar a /rentals/:id/extend');
      expect(occupancy.hasLiveRental, isTrue);
      expect(occupancy.isMine, isFalse);
    });

    test('«es mía» sale de los alquileres del actor, no de preguntar al servidor',
        () {
      final ChairOccupancy occupancy = ChairParsers.occupancy(
        <String, dynamic>{
          'chair': <String, dynamic>{
            'id': 12,
            'code': 'VN-02',
            'status': 'OCCUPIED',
            'pricePerHourMinor': 550000,
          },
          'currentRental': <String, dynamic>{
            'id': 9,
            'code': 'RENT-900009',
            'status': 'ACTIVE',
            'startAt': '2026-09-29T18:55:47.753Z',
            'endAt': '2026-09-29T20:55:47.753Z',
          },
        },
        currentUserId: 7,
        myActiveChairIds: const <int>[12],
      );
      expect(occupancy.isMine, isTrue);
    });

    test('una silla sin alquiler NO inventa uno', () {
      final ChairOccupancy occupancy = ChairParsers.occupancy(
        <String, dynamic>{
          'chair': <String, dynamic>{
            'id': 1,
            'code': 'TZ-01',
            'status': 'AVAILABLE',
            'pricePerHourMinor': 600000,
          },
          'currentRental': null,
          'currentReservation': null,
        },
        currentUserId: 7,
        myActiveChairIds: const <int>[],
      );
      expect(occupancy.rentalId, isNull);
      expect(occupancy.hasLiveRental, isFalse);
      expect(occupancy.hasFutureReservation, isFalse);
    });

    test('`withOccupant(allowed: false)` borra la identidad aunque venga', () {
      const ChairOccupancy base = ChairOccupancy(chair: ChairInfo(
        id: 1,
        code: 'TZ-01',
        status: 'OCCUPIED',
        pricePerHourMinor: 600000,
      ));
      final ChairOccupancy guarded = base.withOccupant(
        const ChairRental(
          id: 9,
          code: 'RENT-900009',
          status: 'ACTIVE',
          customerId: 7,
          customerName: 'Camila Restrepo',
        ),
        allowed: false,
        currentUserId: 11,
      );
      expect(guarded.occupantName, isNull);
      expect(guarded.displayOccupantName, isNull);
      expect(guarded.isMine, isFalse);
    });
  });

  group('Parseo de la cotización (GET /reservations/quote)', () {
    test('`isAvailable: false` NO es un error: es un 200 con la que estorba', () {
      final ChairBookingQuote quote = ChairParsers.quote(
        <String, dynamic>{
          'chair': <String, dynamic>{'id': 4, 'code': 'TZ-04'},
          'zone': <String, dynamic>{'id': 1, 'name': 'Terraza'},
          'durationMinutes': 120,
          'billableMinutes': 120,
          'pricePerHourMinor': 600000,
          'subtotalMinor': 1200000,
          'taxMinor': 228000,
          'totalMinor': 1428000,
          'isAvailable': false,
          'conflict': <String, dynamic>{'code': 'RES-900005'},
        },
        ChairBookingSlot(
          startAt: DateTime.utc(2026, 9, 29, 19),
          endAt: DateTime.utc(2026, 9, 29, 21),
        ),
      );
      expect(quote.isAvailable, isFalse);
      expect(quote.conflictCode, 'RES-900005');
      expect(quote.unavailableReason, contains('RES-900005'));
      expect(quote.totalMinor, 1428000);
    });

    test('el total es el del SERVIDOR, sin recalcularlo aquí', () {
      final ChairBookingQuote quote = ChairParsers.quote(
        <String, dynamic>{
          'pricePerHourMinor': 600000,
          'subtotalMinor': 600000,
          'taxMinor': 114000,
          'totalMinor': 714000,
          'billableMinutes': 60,
          'isAvailable': true,
        },
        ChairBookingSlot(
          startAt: DateTime.utc(2026, 9, 29, 19),
          endAt: DateTime.utc(2026, 9, 29, 20),
        ),
      );
      expect(quote.totalMinor, 714000,
          reason: 'BR-PRICE-008: el importe lo fija el servidor');
    });
  });

  group('Privacidad del ocupante', () {
    test('sin `rentals:read:any` el parser borra el nombre aunque venga', () {
      final ChairRental rental = ChairParsers.rental(
        <String, dynamic>{
          'id': 9,
          'code': 'RENT-900009',
          'status': 'ACTIVE',
          'customerId': 7,
          'customerName': 'Camila Restrepo',
        },
        includeOccupantIdentity: false,
      );
      expect(rental.customerName, isNull);
      expect(rental.customerId, isNull);
    });

    test('con `rentals:read:any` el nombre se conserva', () {
      final ChairRental rental = ChairParsers.rental(
        <String, dynamic>{
          'id': 9,
          'code': 'RENT-900009',
          'status': 'ACTIVE',
          'customerId': 7,
          'customerName': 'Camila Restrepo',
        },
        includeOccupantIdentity: true,
      );
      expect(rental.customerName, 'Camila Restrepo');
      expect(rental.customerId, 7);
    });
  });
}
