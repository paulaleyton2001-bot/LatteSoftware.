// Regresión del Bug 2: en el POS, el cobro de un alquiler de silla era
// IMPOSIBLE desde la interfaz, y el camino que parecía existir creaba un pedido
// FANTASMA.
//
// ─────────────────────────────────────────────────────────────────────────────
// LO QUE SE VIO EN EL DISPOSITIVO, PASO A PASO
// ─────────────────────────────────────────────────────────────────────────────
//   Perfil → Punto de venta → 2 × Espresso + Americano → Cobro →
//   «Alquiler de silla».
//
//   El plano de sillas se pintaba perfecto y NO ACEPTABA NINGÚN TOQUE. Pulsando
//   donde fuera, la etiqueta seguía diciendo «El alquiler de silla necesita una
//   silla asignada» y el botón «Cobrar» seguía apagado. Aparte, la rejilla de
//   zonas desbordaba: «BOTTOM OVERFLOWED BY 139 PIXELS».
//
// ─────────────────────────────────────────────────────────────────────────────
// LAS CAUSAS REALES (ninguna era la sospechada de partida)
// ─────────────────────────────────────────────────────────────────────────────
//   1. `PosCheckoutPanel` montaba `const PosChairPicker()` SIN `onPicked`. Con
//      `onPicked == null`, `PosChairPicker` pasa `onSelect: null` a
//      `ChairMapGrid`, cuya documentación es literal: «`null` = el mapa es de
//      SOLO LECTURA (mirar no es elegir)». El plano era decorativo.
//   2. `PosDraftController.attachReservation` era CÓDIGO MUERTO: no lo llamaba
//      nadie. Como `PosDraft.needsReservation` es `true` siempre en
//      `CHAIR_RENTAL` sin reserva, el botón de Cobrar quedaba bloqueado para
//      siempre, y no había ninguna UI para elegir la reserva.
//
//   Sobre la hipótesis «`assignChair` sube TAKEAWAY a dineIn y nunca a
//   chairRental»: es CIERTO que nunca sube a `chairRental`, y es lo correcto —
//   tocar una silla es pedir una mesa, no contratar un alquiler que se cobra por
//   tiempo—. Pero no era el bloqueo: el cajero nunca llegaba a `assignChair`.
//
// ─────────────────────────────────────────────────────────────────────────────
// LO QUE SE COMPROBÓ CONTRA EL BACKEND (no contra el PDF del contrato)
// ─────────────────────────────────────────────────────────────────────────────
//   · `POST /rentals` NO crea pedido. La respuesta real es
//     `data: { rental, chairStatus, chairStatusChangedAt }`, sin `order`, y en
//     la tabla `orders` no aparece ninguna fila nueva. `docs/API.md` §7.9 dice lo
//     contrario. El código leía `data['order']`, así que `_parseOrder` con un
//     mapa vacío devolvía un `PosOrderResult` con `orderId = chairId` (¡el id de
//     la silla!), `orderNumber = 'ORD-000000'` y total 0.
//   · `POST /orders` con `type = CHAIR_RENTAL` y líneas de producto devuelve
//     `422 MIXED_ORDER_TYPE_NOT_ALLOWED` (BR-ORDER-012). Un alquiler NO lleva
//     productos: son dos pedidos.
//   · `POST /orders` sin `reservationId` devuelve
//     `422 RENTAL_REQUIRES_CHAIR_AND_RESERVATION` (BR-ORDER-008). La hipótesis
//     del enunciado sobre ESTA regla era correcta.
//   · `POST /rentals` con una reserva `PENDING` devuelve
//     `422 RESERVATION_NOT_ACTIVE` con la pista «Confirme la reserva antes de
//     abrir el alquiler».
//   · Con reserva `CONFIRMED` + alquiler `ACTIVE`, `POST /orders` SÍ calcula el
//     importe del alquiler. Sin alquiler activo lo crea con `totalMinor = 0`.
//
// El ciclo que funciona (verificado dos veces en el dispositivo):
//   1. reserva `CONFIRMED` (crear + confirmar, o una que ya existía),
//   2. `POST /rentals` con esa reserva → alquiler `ACTIVE`, silla `OCCUPIED`,
//   3. `POST /orders` con `type = CHAIR_RENTAL`, `chairId`, `reservationId` e
//      `items: []` → el servidor calcula el importe,
//   4. `POST /payments` → `COMPLETED` con `balance_minor = 0`.
// Resultado en el servidor: ORD-900028 (silla 8, reserva 17, alquiler 16,
// 595000, pagada) y ORD-900029 (silla 20, reserva 18, alquiler 17, 714000,
// pagada).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/core/customer/chair_map.dart';
import 'package:latte_coffee/core/customer/venue_providers.dart';
import 'package:latte_coffee/core/error/failures.dart';
import 'package:latte_coffee/core/result/result.dart';
import 'package:latte_coffee/features/pos/domain/entities/pos_charge.dart';
import 'package:latte_coffee/features/pos/domain/entities/pos_draft.dart';
import 'package:latte_coffee/features/pos/domain/entities/pos_order_type.dart';
import 'package:latte_coffee/features/pos/domain/repositories/pos_repository.dart';
import 'package:latte_coffee/features/pos/domain/repositories/pos_repository_models.dart';
import 'package:latte_coffee/features/pos/presentation/pos_controller.dart';
import 'package:latte_coffee/features/pos/presentation/widgets/pos_chair_picker.dart';
import 'package:latte_coffee/features/pos/presentation/widgets/pos_reservation_picker.dart';
import 'package:latte_coffee/shared/widgets/chair_map_grid.dart';

/// Silla del dispositivo: 1220 px / densidad 3.0.
const int _sillaId = 8;
const String _sillaCodigo = 'IN-M02';

PosReservation _reserva({
  int id = 18,
  String status = 'CONFIRMED',
  DateTime? startAt,
  DateTime? endAt,
  String customerName = 'Camila Restrepo',
}) {
  final DateTime from = startAt ?? DateTime(2026, 9, 29, 10, 50);
  return PosReservation(
    id: id,
    code: 'RES-9000$id',
    status: status,
    startAt: from,
    endAt: endAt ?? from.add(const Duration(minutes: 90)),
    customerName: customerName,
    totalMinor: 600000,
  );
}

ChairMap _mapaConSillas() => ChairMap(
      locationId: 1,
      locationName: 'Sede Principal',
      countsByStatus: const <String, int>{'AVAILABLE': 2, 'RESERVED': 1},
      zones: <ZoneMap>[
        ZoneMap(
          id: 2,
          name: 'Interior',
          code: 'IN',
          colorHex: '#2F6B4F',
          minX: 0,
          minY: 0,
          maxX: 1,
          maxY: 1,
          chairs: <ChairInfo>[
            const ChairInfo(
              id: _sillaId,
              code: _sillaCodigo,
              zoneName: 'Interior',
              status: 'AVAILABLE',
              pricePerHourMinor: 500000,
            ),
            const ChairInfo(
              id: 9,
              code: 'IN-M03',
              zoneName: 'Interior',
              status: 'AVAILABLE',
              pricePerHourMinor: 500000,
            ),
            // Silla RESERVED: la que el cliente reservó. Con el filtro antiguo
            // (`isFreeNow`, solo `AVAILABLE`) desaparecía del plano, que era el
            // segundo fallo: el único cliente que había pagado era invisible.
            const ChairInfo(
              id: 20,
              code: 'TW-01',
              zoneName: 'Sala de Trabajo',
              status: 'RESERVED',
              pricePerHourMinor: 400000,
            ),
          ],
        ),
      ],
    );

/// Repositorio falso que registra el ORDEN de las llamadas.
///
/// El orden es la mitad de lo que hay que fijar: si el alquiler arrancara antes
/// de confirmar la reserva, el backend responde `422 RESERVATION_NOT_ACTIVE`, y
/// si faltara un paso el cajero se queda con la silla `OCCUPIED` y nada cobrado.
class _FakePosRepository implements PosRepository {
  final List<String> llamadas = <String>[];
  Failure? falloAlArrancar;
  Failure? falloAlConfirmar;
  Failure? falloAlCrear;

  @override
  Future<Result<PosReservation>> createReservation({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
  }) async {
    llamadas.add('createReservation');
    if (falloAlCrear case final Failure f) return FailureResult<PosReservation>(f);
    return Success<PosReservation>(_reserva(id: 17, status: 'PENDING'));
  }

  @override
  Future<Result<PosReservation>> confirmReservation(int reservationId) async {
    llamadas.add('confirmReservation($reservationId)');
    if (falloAlConfirmar case final Failure f) return FailureResult<PosReservation>(f);
    return Success<PosReservation>(_reserva(id: reservationId));
  }

  @override
  Future<Result<PosRentalStart>> startRental({
    required int chairId,
    required int plannedMinutes,
    required int reservationId,
  }) async {
    llamadas.add('startRental($chairId, $plannedMinutes, $reservationId)');
    if (falloAlArrancar case final Failure f) return FailureResult<PosRentalStart>(f);
    return Success<PosRentalStart>(const PosRentalStart(
      rentalId: 16,
      rentalCode: 'RENT-900016',
      chairStatus: 'OCCUPIED',
    ));
  }

  @override
  Future<Result<List<PosReservation>>> chairReservations({
    required int chairId,
    required DateTime from,
    required DateTime to,
  }) async {
    llamadas.add('chairReservations($chairId)');
    return Success<List<PosReservation>>(<PosReservation>[_reserva()]);
  }

  @override
  Future<Result<PosCatalog>> catalog() async =>
      Success<PosCatalog>(const PosCatalog());

  @override
  Future<Result<PosOrderResult>> createOrder(PosOrderDraftRequest request) async {
    llamadas.add('createOrder(${request.type})');
    return Success<PosOrderResult>(const PosOrderResult(
      orderId: 1,
      orderNumber: 'ORD-900028',
      status: 'PENDING',
      subtotalMinor: 500000,
      taxMinor: 95000,
      serviceFeeMinor: 0,
      discountMinor: 0,
      totalMinor: 595000,
      paidMinor: 0,
      balanceMinor: 595000,
    ));
  }

  @override
  Future<Result<PosChargeResult>> charge({
    required PosChargeRequest request,
    required int orderId,
    required String idempotencyKey,
  }) async =>
      Success<PosChargeResult>(const PosChargeResult(
        paymentId: 1,
        orderId: 1,
        amountMinor: 595000,
        changeDueMinor: 0,
        balanceMinor: 0,
        orderNumber: 'ORD-900028',
        orderStatus: 'COMPLETED',
      ));

  @override
  Future<Result<PosOrderTransitionResult>> changeOrderStatus({
    required int orderId,
    required String toStatus,
    String? reason,
  }) async =>
      Success<PosOrderTransitionResult>(
        PosOrderTransitionResult(orderId: orderId, status: toStatus, orderNumber: 'ORD-1'),
      );

  @override
  Future<Result<List<PosPaymentMethodOption>>> paymentMethods() async =>
      Success<List<PosPaymentMethodOption>>(const <PosPaymentMethodOption>[]);

  @override
  Future<Result<PosReceipt>> receipt(int orderId) async =>
      Success<PosReceipt>(const PosReceipt(
        orderNumber: 'ORD-1',
        businessName: 'LatteCoffe',
        businessAddress: 'Cra 7 #70-23',
        status: 'COMPLETED',
        items: <PosReceiptLine>[],
        totalMinor: 595000,
        paidMinor: 595000,
        balanceMinor: 0,
      ));
}

ProviderContainer _conRepositorio(_FakePosRepository repo) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      posRepositoryProvider.overrideWithValue(repo),
      venueMapProvider.overrideWith((Ref ref) async => _mapaConSillas()),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  // `DateFormatter` usa `intl`, y `intl` no se inicializa solo en los tests: sin
  // esto, pintar la hora de una reserva revienta con `LocaleDataException`.
  setUpAll(() => initializeDateFormatting('es'));

  group('POS · el borrador de un alquiler se puede dejar listo', () {
    test('elegir silla + reserva + alquiler DESBLOQUEA el cobro', () {
      final ProviderContainer c = _conRepositorio(_FakePosRepository());
      final PosDraftController draft = c.read(posDraftProvider.notifier);

      draft.setType(PosOrderType.chairRental);
      expect(c.read(posDraftProvider).hasBlockingGap, isTrue,
          reason: 'sin silla no se puede cobrar');

      draft.assignChair(chairId: _sillaId, chairLabel: _sillaCodigo);
      expect(c.read(posDraftProvider).needsChair, isFalse);
      expect(c.read(posDraftProvider).hasBlockingGap, isTrue,
          reason: 'sin reserva tampoco: el backend da 422');

      draft.attachReservation(18);
      expect(c.read(posDraftProvider).needsReservation, isFalse);
      // ESTE es el test que fija el fallo del cobro por cero: con la reserva
      // puesta pero sin alquiler arrancado, `POST /orders` crearía el pedido con
      // `totalMinor = 0`. Tiene que seguir bloqueado.
      expect(c.read(posDraftProvider).needsStartedRental, isTrue);
      expect(c.read(posDraftProvider).hasBlockingGap, isTrue,
          reason: 'sin alquiler activo el pedido valdría cero');

      draft.attachRental(16);
      expect(c.read(posDraftProvider).hasStartedRental, isTrue);
      expect(c.read(posDraftProvider).hasBlockingGap, isFalse,
          reason: 'con silla, reserva y alquiler el cobro se habilita');
    });

    test('un alquiler NO necesita productos en el carrito para cobrarse', () {
      // El backend acepta `items: []` en `CHAIR_RENTAL`; lo que no acepta son
      // productos MEZCLADOS (`422 MIXED_ORDER_TYPE_NOT_ALLOWED`).
      final ProviderContainer c = _conRepositorio(_FakePosRepository());
      final PosDraftController draft = c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: _sillaId, chairLabel: _sillaCodigo)
        ..attachReservation(18)
        ..attachRental(16);

      final PosDraft state = c.read(posDraftProvider);
      expect(state.isChairRental, isTrue);
      expect(state.hasBlockingGap, isFalse);
      expect(draft, isNotNull);
    });

    test('CAMBIAR DE SILLA tira la reserva: si no, el backend da 422', () {
      // Verificado contra el backend: `POST /orders` con una reserva de otra
      // silla responde «La silla no corresponde a la reserva»
      // (`RENTAL_REQUIRES_CHAIR_AND_RESERVATION`).
      final ProviderContainer c = _conRepositorio(_FakePosRepository());
      c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: _sillaId, chairLabel: _sillaCodigo)
        ..attachReservation(18)
        ..attachRental(16);

      c.read(posDraftProvider.notifier).assignChair(chairId: 20, chairLabel: 'TW-01');

      expect(c.read(posDraftProvider).reservationId, isNull);
      expect(c.read(posDraftProvider).rentalId, isNull);
    });

    test('tocar una silla NO convierte el pedido en alquiler', () {
      // Elegir una mesa es pedir una mesa. Si esto subiera a `chairRental`, el
      // cajero acabaría con un alquiler que no pidió y que se cobra por tiempo.
      final ProviderContainer c = _conRepositorio(_FakePosRepository());
      c.read(posDraftProvider.notifier).assignChair(
            chairId: _sillaId,
            chairLabel: _sillaCodigo,
          );
      expect(c.read(posDraftProvider).type, PosOrderType.dineIn);
    });

    test('el motivo de bloqueo DICE QUÉ HACER, no solo qué falta', () {
      final ProviderContainer c = _conRepositorio(_FakePosRepository());
      c.read(posDraftProvider.notifier).setType(PosOrderType.chairRental);
      expect(c.read(posDraftProvider).blockingReason, contains('silla'));

      c.read(posDraftProvider.notifier).assignChair(chairId: _sillaId, chairLabel: _sillaCodigo);
      expect(c.read(posDraftProvider).blockingReason, contains('reserva'));

      c.read(posDraftProvider.notifier).attachReservation(18);
      expect(c.read(posDraftProvider).blockingReason, contains('Abre el alquiler'));
    });
  });

  group('POS · alquiler sin reserva (tres llamadas, en orden)', () {
    test('crea la reserva, la confirma, arranca el alquiler y guarda los ids', () async {
      final _FakePosRepository repo = _FakePosRepository();
      final ProviderContainer c = _conRepositorio(repo);
      c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: _sillaId, chairLabel: _sillaCodigo);

      final PosWalkInResult? result = await c
          .read(posWalkInProvider.notifier)
          .open(chairId: _sillaId, plannedMinutes: 60);
      await c.read(posWalkInProvider.future);

      expect(repo.llamadas, <String>[
        'createReservation',
        'confirmReservation(17)',
        'startRental(8, 60, 17)',
      ]);
      expect(result, isNotNull);
      expect(result!.rentalId, 16);

      final PosDraft state = c.read(posDraftProvider);
      expect(state.reservationId, 17);
      expect(state.rentalId, 16);
      expect(state.chairId, _sillaId, reason: 'el borrador NO se resetea: el cajero debe ver su silla');
      expect(state.hasBlockingGap, isFalse);
    });

    test('el error PERSISTE: llamar a acknowledge() lo borraba de la pantalla',
        () async {
      // Regresión de un fallo encontrado EN EL DISPOSITIVO: tras un
      // `409 CHAIR_ALREADY_RESERVED` el panel quedaba idéntico a como estaba,
      // con la impresión de que el botón «Abrir alquiler» no hace nada. La causa
      // era un `acknowledge()` que se llamaba justo después de que el
      // `AsyncError` se pintara, borrándolo.
      final _FakePosRepository repo = _FakePosRepository()
        ..falloAlCrear = const ConflictFailure(
          message: 'La silla ya está reservada en esa franja horaria',
          code: 'CHAIR_ALREADY_RESERVED',
        );
      final ProviderContainer c = _conRepositorio(repo);
      c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: _sillaId, chairLabel: _sillaCodigo);

      await c.read(posWalkInProvider.notifier)
          .open(chairId: _sillaId, plannedMinutes: 60);

      // El estado de error debe seguir ahí para que el aviso rojo se pinte.
      expect(c.read(posWalkInProvider).hasError, isTrue);
      expect(posRentalFailureMessage(c.read(posWalkInProvider).error),
          contains('otra silla'));

      // Cambiar de silla es lo que lo deja obsoleto, y ahí sí se limpia.
      c.read(posDraftProvider.notifier).assignChair(chairId: 20, chairLabel: 'TW-01');
      expect(c.read(posWalkInProvider).hasError, isFalse);
    });

    test('si el alquiler falla, el error SALE y no queda nada a medias', () async {
      final _FakePosRepository repo = _FakePosRepository()
        ..falloAlArrancar = const BusinessRuleFailure(
          message: 'La reserva no está confirmada',
          code: 'RESERVATION_NOT_ACTIVE',
        );
      final ProviderContainer c = _conRepositorio(repo);
      c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: _sillaId, chairLabel: _sillaCodigo);

      final PosWalkInResult? result = await c
          .read(posWalkInProvider.notifier)
          .open(chairId: _sillaId, plannedMinutes: 60);

      expect(result, isNull);
      expect(c.read(posWalkInProvider).hasError, isTrue);
      // Nada colgado: la silla sigue libre y el borrador no inventa un alquiler.
      expect(c.read(posDraftProvider).rentalId, isNull);
      expect(c.read(posDraftProvider).hasBlockingGap, isTrue);
    });
  });

  group('POS · alquiler de una reserva que YA existe', () {
    test('tocar la reserva arranca su alquiler y habilita el cobro', () async {
      final _FakePosRepository repo = _FakePosRepository();
      final ProviderContainer c = _conRepositorio(repo);
      c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: 20, chairLabel: 'TW-01');

      await c.read(posWalkInProvider.notifier)
          .startFromReservation(chairId: 20, reservation: _reserva());
      await c.read(posWalkInProvider.future);

      // Ya estaba CONFIRMED, así que no se vuelve a confirmar (es idempotente,
      // pero sería una llamada de más).
      expect(repo.llamadas, <String>['startRental(20, 90, 18)'],
          reason: 'los minutos salen de la propia reserva, no de un diálogo');

      final PosDraft state = c.read(posDraftProvider);
      expect(state.reservationId, 18);
      expect(state.rentalId, 16);
      expect(state.hasBlockingGap, isFalse);
    });

    test('una reserva PENDING se confirma antes de arrancar el alquiler', () async {
      final _FakePosRepository repo = _FakePosRepository();
      final ProviderContainer c = _conRepositorio(repo);

      await c.read(posWalkInProvider.notifier).startFromReservation(
        chairId: 20,
        reservation: _reserva(id: 19, status: 'PENDING'),
      );
      await c.read(posWalkInProvider.future);

      expect(repo.llamadas, <String>['confirmReservation(19)', 'startRental(20, 90, 19)']);
    });
  });

  group('POS · el plano de sillas DEBE ser pulsable', () {
    testWidgets('tocar una silla la elige (el bug era que no hacía NADA)', (WidgetTester tester) async {
      final int? elegida = await _tocarPrimeraSilla(tester);
      expect(elegida, isNotNull, reason: 'el plano del POS no aceptó el toque');
    });

    testWidgets('el plano del POS MUESTRA las sillas reservadas', (WidgetTester tester) async {
      // Con el filtro antiguo (`isFreeNow`, solo `AVAILABLE`) la silla del cliente
      // que reservó salía del plano, y el cajero solo podía ofrecerle un alquiler
      // sin reserva.
      await tester.pumpWidget(_harnessDelPicker());
      await tester.pumpAndSettle();
      expect(find.text('TW-01'), findsOneWidget,
          reason: 'la silla RESERVED debe verse: es la que tiene reserva');
      expect(find.text('Reservada'), findsOneWidget);
    });
  });

  group('POS · estados del selector de reservas', () {
    testWidgets('con lista, muestra la reserva con su hora y su estado', (WidgetTester tester) async {
      await tester.pumpWidget(_harnessDeReservas(_FakePosRepository()));
      await tester.pumpAndSettle();

      expect(find.textContaining('RES-900018'), findsOneWidget);
      expect(find.textContaining('confirmada'), findsOneWidget);
      expect(find.textContaining('Camila Restrepo'), findsOneWidget);
    });

    testWidgets('sin reservas: estado vacío que dice qué hacer', (WidgetTester tester) async {
      final _FakePosRepository repo = _SinReservas();
      await tester.pumpWidget(_harnessDeReservas(repo));
      await tester.pumpAndSettle();

      expect(find.text('Esta silla no tiene reservas'), findsOneWidget);
      expect(find.textContaining('alquiler sin reserva'), findsWidgets);
    });

    testWidgets('sin conexión: lo dice SIN prometer que se reenviará', (WidgetTester tester) async {
      // El mostrador no encola nada (`NoopSyncEngine`): prometer sincronización
      // sería mentir.
      final _FakePosRepository repo = _SinConexion();
      await tester.pumpWidget(_harnessDeReservas(repo));
      await tester.pumpAndSettle();

      expect(find.text('Sin conexión'), findsOneWidget);
    });

    test('el fallo se traduce a la acción que lo resuelve', () {
      expect(
        posRentalFailureMessage(const BusinessRuleFailure(
          message: 'Un pedido de alquiler necesita la reserva asociada',
          code: 'RENTAL_REQUIRES_CHAIR_AND_RESERVATION',
        )),
        contains('reserva'),
      );
      expect(
        posRentalFailureMessage(const BusinessRuleFailure(
          message: 'La silla ya está reservada',
          code: 'CHAIR_ALREADY_RESERVED',
        )),
        contains('otra silla'),
      );
      // Sin conexión no se puede haber cobrado nada, y hay que decirlo. Un
      // `NetworkFailure` (timeout) cuenta igual que un `OfflineFailure`.
      expect(
        posRentalFailureMessage(const OfflineFailure()),
        contains('se ha cobrado nada'),
      );
      expect(
        posRentalFailureMessage(const NetworkFailure(message: 'timeout', code: 'TIMEOUT')),
        contains('se ha cobrado nada'),
      );
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Harnesses
// ─────────────────────────────────────────────────────────────────────────────

Widget _harnessDelPicker() => ProviderScope(
      overrides: <Override>[
        venueMapProvider.overrideWith((Ref ref) async => _mapaConSillas()),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(
          body: SizedBox(
            width: 400,
            height: 600,
            child: PosChairPicker(onPicked: _ignorar),
          ),
        ),
      ),
    );

void _ignorar(ChairInfo _) {}

/// Toca la primera celda del mapa y devuelve el id de la silla elegida.
Future<int?> _tocarPrimeraSilla(WidgetTester tester) async {
  int? elegida;
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        venueMapProvider.overrideWith((Ref ref) async => _mapaConSillas()),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
          body: SizedBox(
            width: 400,
            height: 600,
            child: PosChairPicker(onPicked: (ChairInfo c) => elegida = c.id),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();

  await tester.tap(find.byType(ChairMapCell).first);
  await tester.pumpAndSettle();
  return elegida;
}

Widget _harnessDeReservas(_FakePosRepository repo) => ProviderScope(
      overrides: <Override>[
        posRepositoryProvider.overrideWithValue(repo),
        venueMapProvider.overrideWith((Ref ref) async => _mapaConSillas()),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(
          body: SizedBox(
            width: 400,
            height: 700,
            child: PosReservationPicker(chairId: _sillaId),
          ),
        ),
      ),
    );

/// Repositorio sin ninguna reserva: obliga al estado vacío.
class _SinReservas extends _FakePosRepository {
  @override
  Future<Result<List<PosReservation>>> chairReservations({
    required int chairId,
    required DateTime from,
    required DateTime to,
  }) async =>
      Success<List<PosReservation>>(const <PosReservation>[]);
}

/// Repositorio sin red: obliga al estado de sin conexión.
class _SinConexion extends _FakePosRepository {
  @override
  Future<Result<List<PosReservation>>> chairReservations({
    required int chairId,
    required DateTime from,
    required DateTime to,
  }) async =>
      FailureResult<List<PosReservation>>(const OfflineFailure());
}
