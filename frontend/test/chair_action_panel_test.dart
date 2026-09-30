// El panel de la silla, de verdad: se abre, cotiza y explica.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL CRASH QUE ESTE ARCHIVO HACE IMPOSIBLE QUE VUELVA
// ─────────────────────────────────────────────────────────────────────────────
// La primera versión del panel levantaba la hoja modal con
//
//     Semantics(scopesRoute: true, namesRoute: true, child: …)
//
// y Flutter 3.24 AFIRMA en `rendering/proxy_box.dart` L4291:
//
//     'explicitChildNodes must be set to true if scopes route is true'
//
// Al tocar una silla, la app pintaba la PANTALLA ROJA con el volcado de la
// aserción, en vez del panel. Reproducido en el dispositivo (Android 16) el
// 2026-09-29. Compilaba, `flutter analyze` salía limpio, los tests pasaban y
// solo se veía abriendo la app y tocando una silla.
//
// `flutter_test` ejecuta las mismas aserciones de depuración que el modo debug,
// así que este test reproduce el fallo sin necesidad de un dispositivo: basta con
// construir la misma estructura de `Semantics`.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/core/config/app_config.dart';
import 'package:latte_coffee/core/customer/chair_map.dart';
import 'package:latte_coffee/core/result/result.dart';
import 'package:latte_coffee/features/chair/domain/entities/chair_booking.dart';
import 'package:latte_coffee/features/chair/domain/entities/chair_capabilities.dart';
import 'package:latte_coffee/features/chair/domain/repositories/rental_repository.dart';
import 'package:latte_coffee/features/chair/presentation/chair_controller.dart';
import 'package:latte_coffee/features/chair/presentation/widgets/chair_action_panel.dart';
import 'package:latte_coffee/shared/widgets/ui/app_button.dart';
import 'package:latte_coffee/features/orders/domain/entities/rental.dart';

/// Tamaño de un móvil normal: la hoja se levanta en vertical.
const Size _phone = Size(390, 844);

const ChairInfo _tz01 = ChairInfo(
  id: 1,
  code: 'TZ-01',
  status: 'AVAILABLE',
  pricePerHourMinor: 600000,
  zoneId: 1,
  zoneName: 'Terraza',
  name: 'Terraza 1',
  numberLabel: '1',
);

const ChairInfo _vn02 = ChairInfo(
  id: 12,
  code: 'VN-02',
  status: 'OCCUPIED',
  pricePerHourMinor: 550000,
  zoneId: 3,
  zoneName: 'Ventana',
  name: 'Barra 2',
  numberLabel: 'B2',
);

/// Repositorio de mentira. Solo se usa para el panel, que no hace escrituras.
class _FakeRepository implements RentalRepository {
  _FakeRepository({required this.occupancy});

  final ChairOccupancy occupancy;

  @override
  Future<Result<ChairOccupancy>> chairOccupancy({
    required int chairId,
    required int currentUserId,
    required List<int> myActiveChairIds,
  }) async =>
      Success<ChairOccupancy>(occupancy);

  @override
  Future<Result<ChairRental?>> activeRentalByChair(int chairId) async =>
      Success<ChairRental?>(null);

  @override
  Future<Result<ChairBookingQuote>> quote({
    required int chairId,
    required ChairBookingSlot slot,
  }) async =>
      Success<ChairBookingQuote>(
        ChairBookingQuote(
          slot: slot,
          isAvailable: true,
          pricePerHourMinor: 600000,
          durationMinutes: slot.durationMinutes,
          billableMinutes: slot.durationMinutes,
          subtotalMinor: 600000,
          totalMinor: 714000,
        ),
      );

  @override
  Future<Result<ChairBooking>> createReservation({
    required int chairId,
    required ChairBookingSlot slot,
    String? notes,
  }) async =>
      const Success<ChairBooking>(
        ChairBooking(id: 11, code: 'RES-900011', status: 'PENDING'),
      );

  @override
  Future<Result<ChairBooking>> confirmReservation(int reservationId) async =>
      const Success<ChairBooking>(
        ChairBooking(id: 11, code: 'RES-900011', status: 'CONFIRMED'),
      );

  @override
  Future<Result<ChairBooking>> cancelReservation(
    int reservationId, {
    required String reason,
  }) async =>
      const Success<ChairBooking>(
        ChairBooking(id: 11, code: 'RES-900011', status: 'CANCELLED'),
      );

  @override
  Future<Result<List<Rental>>> myRentals() async =>
      const Success<List<Rental>>(<Rental>[]);

  @override
  Future<Result<ChairRental>> openWalkInRental({
    required int chairId,
    required int plannedMinutes,
    int? customerId,
  }) async =>
      const Success<ChairRental>(
        ChairRental(id: 9, code: 'RENT-900009', status: 'ACTIVE'),
      );

  @override
  Future<Result<ChairRental>> extendRental({
    required int rentalId,
    required int additionalMinutes,
  }) async =>
      const Success<ChairRental>(
        ChairRental(id: 9, code: 'RENT-900009', status: 'EXTENDED'),
      );

  @override
  Future<Result<ChairRental>> completeRental(int rentalId) async =>
      const Success<ChairRental>(
        ChairRental(id: 9, code: 'RENT-900009', status: 'COMPLETED'),
      );

  @override
  Future<Result<ChairInfo>> setChairStatus({
    required int chairId,
    required String status,
    String? reason,
  }) async =>
      Success<ChairInfo>(_tz01);
}

Widget _harness({
  required ChairOccupancy occupancy,
  required ChairCapabilities capabilities,
}) {
  return ProviderScope(
    overrides: <Override>[
      chairCapabilitiesOverride.overrideWithValue(capabilities),
      rentalRepositoryOverride.overrideWithValue(
        _FakeRepository(occupancy: occupancy),
      ),
    ],
    child: MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: SizedBox(
          width: _phone.width,
          child: ChairActionPanel(chairId: occupancy.chair.id),
        ),
      ),
    ),
  );
}

/// Las capacidades de un CUSTOMER, tal como las devuelve `GET /auth/me`.
final ChairCapabilities _customer = ChairCapabilities.fromPermissions(
  const <String>[
    'chairs:map',
    'chairs:read',
    'rentals:read',
    'reservations:cancel',
    'reservations:create',
    'reservations:read',
    'reservations:update',
  ],
);

/// Las de un ADMIN.
final ChairCapabilities _admin = ChairCapabilities.fromPermissions(
  const <String>[
    'chairs:map',
    'chairs:read',
    'chairs:status:update',
    'rentals:complete',
    'rentals:create',
    'rentals:extend',
    'rentals:read',
    'rentals:read:any',
    'reservations:create',
    'reservations:update',
  ],
);

/// `true` si el `AppButton` con esa clave se puede pulsar.
///
/// Se lee `onPressed` y no el color: un `AppButton` apagado tiene `onPressed ==
/// null` por construcción, y es lo que decide si el toque hace algo. Es el mismo
/// criterio que usa la pantalla.
bool _enabled(WidgetTester tester, String key) =>
    tester.widget<AppButton>(find.byKey(Key(key))).onPressed != null;

void main() {
  setUpAll(() async {
    // MISMO paso que `main()`: el panel pinta fechas («Desde», «Hasta», «Franja»)
    // y sin inicializar el locale de `intl` cualquier `DateFormat` revienta. No es
    // un detalle del test: es lo que hace la app al arrancar.
    await initializeDateFormatting(AppConfig.locale);
  });

  group('La hoja modal no revienta al abrirla', () {
    testWidgets(
      'la estructura de `Semantics` que usaba la hoja se construye sin aserciones',
      (WidgetTester tester) async {
        // La aserción de Flutter 3.24 (`proxy_box.dart` L4291) salta al construir
        // el árbol de semántica, no al pintar: por eso este test no necesita que
        // haya red ni providers, solo la misma estructura.
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Semantics(
                scopesRoute: true,
                namesRoute: true,
                explicitChildNodes: true,
                child: Text('Panel de la silla'),
              ),
            ),
          ),
        );
        expect(tester.takeException(), isNull);
        expect(find.text('Panel de la silla'), findsOneWidget);
      },
    );
  });

  group('Panel de una silla libre, como CUSTOMER', () {
    testWidgets('enseña código, zona, precio y las dos acciones', (
      WidgetTester tester,
    ) async {
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _harness(
          occupancy: ChairOccupancy(chair: _tz01),
          capabilities: _customer,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('TZ-01'), findsOneWidget, reason: 'el código, no el «1»');
      expect(find.textContaining('Terraza'), findsWidgets);
      expect(find.textContaining('\$6.000'), findsOneWidget,
          reason: 'el precio por hora es lo primero que hay que ver');
      expect(find.textContaining('libre ahora mismo'), findsOneWidget);

      // Reservar SÍ se puede para un cliente.
      expect(_enabled(tester, 'chair-reserve'), isTrue);
    });

    testWidgets('«alquilar sin cita» se ve DESHABILITADO, con el motivo debajo',
        (WidgetTester tester) async {
      // Ocultarlo dejaría a quien está en el local creyendo que la app está rota;
      // ofrecerlo y recibir un `403` sería peor: la app mintiendo.
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _harness(
          occupancy: ChairOccupancy(chair: _tz01),
          capabilities: _customer,
        ),
      );
      await tester.pumpAndSettle();

      expect(_enabled(tester, 'chair-walk-in'), isFalse);
      expect(
        find.textContaining('rentals:create'),
        findsOneWidget,
        reason: 'el motivo tiene que estar a la vista, no en un tooltip',
      );
    });
  });

  group('Panel de una silla ocupada', () {
    testWidgets('un CUSTOMER ve QUIÉN y HASTA CUÁNDO, sin acciones sobre ella',
        (WidgetTester tester) async {
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _harness(
          occupancy: ChairOccupancy(
            chair: _vn02,
            rentalId: 9,
            rentalCode: 'RENT-900009',
            rentalStartAt: DateTime.utc(2026, 9, 29, 18, 55),
            rentalEndAt: DateTime.utc(2026, 9, 29, 20, 55),
            rentalStatus: 'ACTIVE',
          ),
          capabilities: _customer,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('usando ahora mismo'), findsOneWidget);
      expect(find.text('RENT-900009'), findsOneWidget);
      // Sin `rentals:read:any` el nombre de OTRO no se nombra.
      expect(find.text('Otra persona'), findsOneWidget);
      // Y no se puede reservar ni alquilar una silla ocupada.
      expect(find.textContaining('No se puede reservar ni alquilar'), findsOneWidget);
    });

    testWidgets('con permiso, el alquiler vivo SÍ se puede ampliar y cerrar',
        (WidgetTester tester) async {
      // Es el camino que el personal necesita con la silla delante: antes solo
      // existían esas acciones en la tarjeta «Tu silla», que para un walk-in sin
      // cliente no aparece nunca.
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _harness(
          occupancy: ChairOccupancy(
            chair: _vn02,
            rentalId: 9,
            rentalCode: 'RENT-900009',
            rentalStartAt: DateTime.utc(2026, 9, 29, 18, 55),
            rentalEndAt: DateTime.utc(2026, 9, 29, 20, 55),
            rentalStatus: 'ACTIVE',
          ),
          capabilities: _admin,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('Alquiler en curso'), findsOneWidget);
      expect(_enabled(tester, 'chair-extend'), isTrue);
      expect(_enabled(tester, 'chair-complete'), isTrue);
    });

    testWidgets('sin permiso, los mismos botones salen apagados CON el motivo',
        (WidgetTester tester) async {
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _harness(
          occupancy: ChairOccupancy(
            chair: _vn02,
            rentalId: 9,
            rentalCode: 'RENT-900009',
            rentalStartAt: DateTime.utc(2026, 9, 29, 18, 55),
            rentalEndAt: DateTime.utc(2026, 9, 29, 20, 55),
            rentalStatus: 'ACTIVE',
          ),
          capabilities: _customer,
        ),
      );
      await tester.pumpAndSettle();

      expect(_enabled(tester, 'chair-extend'), isFalse);
      expect(_enabled(tester, 'chair-complete'), isFalse);
      expect(find.textContaining('rentals:extend'), findsOneWidget);
      expect(find.textContaining('rentals:complete'), findsOneWidget);
    });

    testWidgets('sin `rentalId` no se ofrecen acciones que no podrían llamar a nadie',
        (WidgetTester tester) async {
      // `GET /chairs/:id` podría no traer `currentRental.id`. Preferimos no
      // ofrecer el botón a ofrecer uno que fallaría al pulsarlo.
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _harness(
          occupancy: ChairOccupancy(
            chair: _vn02,
            rentalCode: 'RENT-900009',
            rentalStartAt: DateTime.utc(2026, 9, 29, 18, 55),
            rentalEndAt: DateTime.utc(2026, 9, 29, 20, 55),
            rentalStatus: 'ACTIVE',
          ),
          capabilities: _admin,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('chair-extend')), findsNothing);
    });
  });

  group('Panel de una silla con reserva PENDING', () {
    testWidgets('avisa de que la silla todavía puede ocuparla alguien',
        (WidgetTester tester) async {
      // `POST /reservations` deja la reserva en `PENDING` y la silla en
      // `AVAILABLE` (verificado con `curl`). Pintar «Reservada» ahí sería mentir.
      tester.view.physicalSize = _phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        _harness(
          occupancy: ChairOccupancy(
            chair: _tz01,
            reservationId: 11,
            reservationCode: 'RES-900011',
            reservationStatus: 'PENDING',
            reservationStartAt: DateTime.utc(2026, 9, 29, 19),
            reservationEndAt: DateTime.utc(2026, 9, 29, 21),
          ),
          capabilities: _customer,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('RES-900011'), findsOneWidget);
      expect(find.textContaining('pendiente de confirmar'), findsOneWidget);
    });
  });
}
