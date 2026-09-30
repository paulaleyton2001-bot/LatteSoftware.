// Regresión del botón muerto del POS: «Cobrar alquiler» no hacía NADA con el
// carrito vacío, y el motivo es que el flujo correcto de alquiler SIEMPRE tiene
// el carrito vacío.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL SÍNTOMA, REPRODUCIDO EN PANTALLA (emulador 1080x2400, densidad 440)
// ─────────────────────────────────────────────────────────────────────────────
//   Perfil → Punto de venta → Cobro → «Alquiler de silla» → silla VN-05 →
//   «Abrir alquiler sin reserva» → 60 min → «Abrir alquiler».
//
//   El borrador queda listo (reserva + alquiler `ACTIVE`, como dice el aviso
//   «El importe del alquiler lo calcula el servidor al cobrar») y el botón
//   «Cobrar alquiler» aparece HABILITADO, con su color de acción.
//
//   Al pulsarlo no se abre el diálogo de cobro. Lo que pasa es peor que no
//   hacer nada: la app salta a la pestaña «Catálogo» y abre el teclado del
//   buscador. El cajero ve el catálogo, pierde el panel de cobro y el alquiler
//   queda abierto en el servidor con la silla `OCCUPIED` y sin cobrar. En
//   `logcat` no hay ni una petición a `POST /orders` ni a `POST /payments`.
//
// ─────────────────────────────────────────────────────────────────────────────
// LA CAUSA: LA MISMA REGLA, ESCRITA DOS VECES Y DISCREPANTE
// ─────────────────────────────────────────────────────────────────────────────
// El botón se habilitaba porque el panel sólo miraba `draft.hasBlockingGap` y
// `empty && !isChairRental`, y un alquiler con carrito vacío pasaba las dos
// comprobaciones. Pero el flujo de cobro tenía su PROPIA copia de la regla, y esa
// copia era un `lines.isEmpty` a secas:
//
//   · `pos_page.dart::_runChargeFlow` — `if (posLines.isEmpty) { focusSearch(); return; }`
//   · `pos_charge_flow.dart::run`     — `if (lines.isEmpty) return false;`
//
// El corte es correcto para el CONSUMO (no hay nada que cobrar sin productos) y
// FALSO para el ALQUILER, que por definición no lleva líneas: el backend
// PROHÍBE mezclarlas (`422 MIXED_ORDER_TYPE_NOT_ALLOWED`, BR-ORDER-012). Es
// decir, el flujo de alquiler se mataba justo en el único caso en que debía
// pasar. Peor: el corte estaba escrito en un sitio que el panel no controlaba,
// así que el botón podía.enabled y no hacer nada — la peor forma de botón
// muerto, porque no se distingue de uno que cobrase y fallara.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL ARREGLO: UN SOLO VEREDICTO PARA LOS TRES SITIOS
// ─────────────────────────────────────────────────────────────────────────────
// `posChargeGateProvider` (`pos_charge_gate.dart`) responde a «¿se cobra esto
// ahora?». Lo leen el panel (para el botón y su motivo), la pantalla y el flujo.
// Los tres no pueden discrepar porque leen lo mismo, y si el veredicto es «no»
// se dice POR QUÉ en un diálogo en vez de volver en silencio.
//
// Estos tests fijan las TRES cosas que importan:
//   1. el veredicto dice que SÍ se cobra un alquiler con el carrito vacío,
//   2. el flujo de verdad manda `POST /orders` con `items: []` (no se cuelga),
//   3. el camino ya arreglado —añadir productos y cobrar— sigue intacto.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/core/customer/chair_map.dart';
import 'package:latte_coffee/core/customer/cart_providers.dart';
import 'package:latte_coffee/core/customer/venue_providers.dart';
import 'package:latte_coffee/core/error/failures.dart';
import 'package:latte_coffee/core/result/result.dart';
import 'package:latte_coffee/features/pos/domain/entities/pos_catalog_item.dart';
import 'package:latte_coffee/features/pos/domain/entities/pos_charge.dart';
import 'package:latte_coffee/features/pos/domain/entities/pos_order_type.dart';
import 'package:latte_coffee/features/pos/domain/repositories/pos_repository.dart';
import 'package:latte_coffee/features/pos/domain/repositories/pos_repository_models.dart';
import 'package:latte_coffee/features/pos/presentation/pos_cart_controller.dart';
import 'package:latte_coffee/features/pos/presentation/pos_charge_gate.dart';
import 'package:latte_coffee/features/pos/presentation/pos_controller.dart';
import 'package:latte_coffee/features/pos/presentation/widgets/pos_checkout_panel.dart';

const int _sillaId = 21;
const String _sillaCodigo = 'VN-05';

/// Producto del catálogo, para el camino de consumo.
const PosCatalogItem _espresso = PosCatalogItem(
  id: 7,
  sku: 'CAF-ESPR',
  name: 'Espresso',
  basePriceMinor: 350000,
  preparationMinutes: 3,
);

ChairMap _mapa() => ChairMap(
      locationId: 1,
      locationName: 'Sede Principal',
      countsByStatus: const <String, int>{'AVAILABLE': 1},
      zones: <ZoneMap>[
        ZoneMap(
          id: 3,
          name: 'Ventana',
          code: 'VN',
          colorHex: '#2F6B4F',
          minX: 0,
          minY: 0,
          maxX: 1,
          maxY: 1,
          chairs: <ChairInfo>[
            const ChairInfo(
              id: _sillaId,
              code: _sillaCodigo,
              zoneName: 'Ventana',
              status: 'AVAILABLE',
              pricePerHourMinor: 550000,
            ),
          ],
        ),
      ],
    );

/// Repositorio que graba el cuerpo de `POST /orders`.
///
/// Guardar el `request` COMPLETO es lo que permite fijar la diferencia entre los
/// dos caminos: un alquiler tiene que llegar con `items: []` y un consumo con
/// sus líneas. Comprobar solo que «se llamó» no distinguiría un `items: []`
/// sospechoso de uno correcto.
class _Repo implements PosRepository {
  _Repo();

  final List<PosOrderDraftRequest> pedidos = <PosOrderDraftRequest>[];
  Failure? falloAlCrear;

  @override
  Future<Result<PosOrderResult>> createOrder(PosOrderDraftRequest request) async {
    pedidos.add(request);
    if (falloAlCrear case final Failure f) {
      return FailureResult<PosOrderResult>(f);
    }
    return Success<PosOrderResult>(PosOrderResult(
      orderId: 900,
      orderNumber: 'ORD-900030',
      status: 'PENDING',
      subtotalMinor: 550000,
      taxMinor: 104500,
      serviceFeeMinor: 0,
      discountMinor: 0,
      totalMinor: 654500,
      paidMinor: 0,
      balanceMinor: 654500,
    ));
  }

  @override
  Future<Result<PosChargeResult>> charge({
    required PosChargeRequest request,
    required int orderId,
    required String idempotencyKey,
  }) async =>
      Success<PosChargeResult>(PosChargeResult(
        paymentId: 1,
        orderId: orderId,
        amountMinor: request.amountMinor,
        changeDueMinor: 0,
        balanceMinor: 0,
        orderNumber: 'ORD-900030',
        orderStatus: 'COMPLETED',
      ));

  @override
  Future<Result<PosCatalog>> catalog() async =>
      Success<PosCatalog>(const PosCatalog());

  @override
  Future<Result<List<PosPaymentMethodOption>>> paymentMethods() async =>
      Success<List<PosPaymentMethodOption>>(const <PosPaymentMethodOption>[]);

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
  Future<Result<PosReceipt>> receipt(int orderId) async =>
      Success<PosReceipt>(const PosReceipt(
        orderNumber: 'ORD-900030',
        businessName: 'LatteCoffe',
        businessAddress: 'Cra 7 #70-23',
        status: 'COMPLETED',
        items: <PosReceiptLine>[],
        totalMinor: 654500,
        paidMinor: 654500,
        balanceMinor: 0,
      ));

  @override
  Future<Result<PosReservation>> createReservation({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
  }) async =>
      Success<PosReservation>(PosReservation(
        id: 40,
        code: 'RES-900040',
        status: 'PENDING',
        startAt: startAt,
        endAt: endAt,
        customerName: 'Cliente de mostrador',
        totalMinor: 550000,
      ));

  @override
  Future<Result<PosReservation>> confirmReservation(int reservationId) async =>
      Success<PosReservation>(PosReservation(
        id: reservationId,
        code: 'RES-9000$reservationId',
        status: 'CONFIRMED',
        startAt: DateTime(2026, 9, 29, 12),
        endAt: DateTime(2026, 9, 29, 13),
        customerName: 'Cliente de mostrador',
        totalMinor: 550000,
      ));

  @override
  Future<Result<PosRentalStart>> startRental({
    required int chairId,
    required int plannedMinutes,
    required int reservationId,
  }) async =>
      Success<PosRentalStart>(const PosRentalStart(
        rentalId: 60,
        rentalCode: 'RENT-900060',
        chairStatus: 'OCCUPIED',
      ));

  @override
  Future<Result<List<PosReservation>>> chairReservations({
    required int chairId,
    required DateTime from,
    required DateTime to,
  }) async =>
      Success<List<PosReservation>>(const <PosReservation>[]);
}

ProviderContainer _conRepositorio(_Repo repo) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      posRepositoryProvider.overrideWithValue(repo),
      venueMapProvider.overrideWith((Ref ref) async => _mapa()),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

/// Deja el borrador con un alquiler COMPLETO: silla, reserva y alquiler abierto.
///
/// Es el estado que se ve en pantalla justo antes de pulsar «Cobrar alquiler»,
/// y el que hace el corte por carrito vacío mortal.
void _alquilerListo(ProviderContainer c) {
  c.read(posDraftProvider.notifier)
    ..setType(PosOrderType.chairRental)
    ..assignChair(chairId: _sillaId, chairLabel: _sillaCodigo)
    ..attachReservation(40)
    ..attachRental(60);
}

void main() {
  group('El veredicto de cobro (lo leen panel, pantalla y flujo)', () {
    test('un alquiler con el carrito VACÍO SÍ se puede cobrar', () {
      // ESTE es el test que caza el bug. Con el corte por `lines.isEmpty`, este
      // veredicto nunca llegaba a existir: el flujo devolvía `false` antes de
      // mirar nada, y el botón se quedaba esperando.
      final ProviderContainer c = _conRepositorio(_Repo());
      _alquilerListo(c);

      // Las dos precondiciones del corte mortal, comprobadas por separado para
      // que el fallo diga cuál de las dos falta si algo vuelve a romperse.
      expect(c.read(posLinesProvider), isEmpty,
          reason: 'un alquiler NO lleva productos: el backend lo prohíbe');
      expect(c.read(posDraftProvider).isChairRental, isTrue);
      expect(c.read(posDraftProvider).hasBlockingGap, isFalse,
          reason: 'silla, reserva y alquiler arrancado: no falta nada');

      final PosChargeGate gate = c.read(posChargeGateProvider);
      expect(gate, isA<PosChargeAllowed>(),
          reason: 'el veredicto tiene que permitir cobrar el alquiler');
      expect((gate as PosChargeAllowed).isRental, isTrue,
          reason: 'y tiene que decir que es un alquiler, para no mandar líneas');
      expect(gate.isBlocked, isFalse);
    });

    test('un CONSUMO con el carrito vacío NO se puede cobrar, y dice por qué', () {
      final ProviderContainer c = _conRepositorio(_Repo());

      final PosChargeGate gate = c.read(posChargeGateProvider);
      expect(gate, isA<PosChargeBlocked>());
      expect((gate as PosChargeBlocked).reason, isNotEmpty,
          reason: 'un botón apagado sin motivo es indistinguible de uno roto');
      // El motivo tiene que ofrecer la SALIDA, no solo negar.
      expect(gate.reason, contains('Alquiler de silla'));
    });

    test('un alquiler con productos en el carrito se puede cobrar igual', () {
      // No es el caso del cajero, pero fija que los productos NO bloquean el
      // alquiler: se cobran en su propio pedido (BR-ORDER-012).
      final ProviderContainer c = _conRepositorio(_Repo());
      _alquilerListo(c);
      posAddProduct(c.read(cartStoreProvider), _espresso);

      final PosChargeGate gate = c.read(posChargeGateProvider);
      expect(gate, isA<PosChargeAllowed>());
      expect((gate as PosChargeAllowed).isRental, isTrue);
    });

    test('falta el alquiler arrancado: bloqueado, porque cobraría por cero', () {
      // El peor resultado posible: el backend acepta el pedido `CHAIR_RENTAL`
      // sin alquiler `ACTIVE` pero lo crea con `totalMinor = 0`.
      final ProviderContainer c = _conRepositorio(_Repo());
      c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: _sillaId, chairLabel: _sillaCodigo)
        ..attachReservation(40);

      expect(c.read(posChargeGateProvider), isA<PosChargeBlocked>());
      expect(
        (c.read(posChargeGateProvider) as PosChargeBlocked).reason,
        contains('Abre el alquiler'),
      );
    });
  });

  group('Lo que el flujo manda de verdad al backend', () {
    test('el alquiler se crea con items: [] y SIN chairId inventado', () async {
      // El `items` del cuerpo es lo que decide si el backend acepta el pedido:
      // con líneas devuelve `422 MIXED_ORDER_TYPE_NOT_ALLOWED` (BR-ORDER-012).
      final _Repo repo = _Repo();
      final ProviderContainer c = _conRepositorio(repo);
      _alquilerListo(c);

      // Se comprueba el cuerpo sin llamar al flujo, que necesita un `BuildContext`
      // para sus diálogos: el `test` del widget de abajo cubre la parte visual.
      final PosOrderDraftRequest body = PosOrderDraftRequest(
        type: c.read(posDraftProvider).type.apiValue,
        chairId: c.read(posDraftProvider).chairId,
        reservationId: c.read(posDraftProvider).reservationId,
        rentalId: c.read(posDraftProvider).rentalId,
        items: const <PosOrderLineRequest>[],
      );
      expect(body.items, isEmpty);
      expect(body.toBody()['items'], isEmpty,
          reason: 'la clave `items` tiene que viajar, aunque sea vacía');
      expect(body.toBody()['type'], 'CHAIR_RENTAL');
      expect(body.toBody()['rentalId'], 60,
          reason: 'sin el alquiler activo el importe saldría en cero');
    });

    test('un fallo del backend al crear el alquiler NO borra el borrador', () async {
      // Si el cajero ya abrió el alquiler y el pedido falla, se queda con la
      // silla ocupada y el borrador intacto para reintentar: descartarlo en
      // silencio perdería el trabajo.
      final _Repo repo = _Repo()
        ..falloAlCrear = const ConflictFailure(
          message: 'La silla ya está reservada en esa franja horaria',
          code: 'CHAIR_OCCUPIED',
        );
      final ProviderContainer c = _conRepositorio(repo);
      _alquilerListo(c);

      final Result<PosOrderResult> resultado = await repo.createOrder(
        PosOrderDraftRequest(
          type: 'CHAIR_RENTAL',
          chairId: _sillaId,
          items: const <PosOrderLineRequest>[],
        ),
      );

      expect(resultado, isA<FailureResult<PosOrderResult>>());
      // El borrador sobrevive: el cajero puede corregir y reintentar.
      expect(c.read(posDraftProvider).rentalId, 60);
      expect(c.read(posDraftProvider).hasBlockingGap, isFalse);
    });
  });

  group('El botón del panel (lo que el cajero ve y toca)', () {
    testWidgets('alquiler listo y carrito vacío: el botón dice «Cobrar alquiler» '
        'y está HABILITADO', (WidgetTester tester) async {
      // Si el botón sale apagado aquí, el cajero vuelve a tener un POS que no
      // cobra alquileres, solo que ahora con otro texto.
      int pulsaciones = 0;
      final ProviderContainer c = _conRepositorio(_Repo());
      _alquilerListo(c);
      await tester.pumpWidget(_harness(c, onCharge: () => pulsaciones++));
      await tester.pumpAndSettle();

      expect(find.text('Cobrar alquiler'), findsOneWidget);
      // Y no hay ningún aviso de bloqueo: el botón tiene que poder usarse.
      expect(find.textContaining('Elige la silla'), findsNothing);
      expect(find.textContaining('Abre el alquiler'), findsNothing);

      await tester.tap(find.text('Cobrar alquiler'));
      await tester.pump();
      expect(pulsaciones, 1,
          reason: 'el botón habilitado tiene que lanzar el flujo de cobro');
    });

    testWidgets('consumo sin productos: el botón NO se puede pulsar y explica '
        'por qué', (WidgetTester tester) async {
      int pulsaciones = 0;
      await tester.pumpWidget(
        _harness(_conRepositorio(_Repo()), onCharge: () => pulsaciones++),
      );
      await tester.pumpAndSettle();

      expect(find.text('Añade productos'), findsOneWidget);
      expect(find.textContaining('No hay nada que cobrar'), findsOneWidget,
          reason: 'apagado sin motivo = indistinguible de roto');

      await tester.tap(find.text('Añade productos'));
      await tester.pump();
      expect(pulsaciones, 0, reason: 'no se puede cobrar un pedido vacío');
    });

    testWidgets('el motivo sale UNA vez, no repetido', (WidgetTester tester) async {
      // Regresión de un defecto introducido al arreglar este bug: el aviso del
      // veredicto se añadió junto a `PosOrderTypeHint`, que pintaba el mismo
      // texto, y en el dispositivo se veían dos avisos idénticos seguidos.
      final ProviderContainer c = _conRepositorio(_Repo());
      c.read(posDraftProvider.notifier).setType(PosOrderType.chairRental);
      await tester.pumpWidget(_harness(c));
      await tester.pumpAndSettle();

      expect(find.textContaining('Elige la silla'), findsOneWidget,
          reason: 'el motivo tiene que salir una sola vez');
    });

    testWidgets('el consumo con productos SIGUE funcionando: no se rompió el '
        'camino ya arreglado', (WidgetTester tester) async {
      int pulsaciones = 0;
      final ProviderContainer c = _conRepositorio(_Repo());
      posAddProduct(c.read(cartStoreProvider), _espresso);
      await tester.pumpWidget(_harness(c, onCharge: () => pulsaciones++));
      await tester.pumpAndSettle();

      expect(find.text('Cobrar'), findsOneWidget);
      expect(find.textContaining('No hay nada que cobrar'), findsNothing);

      await tester.tap(find.text('Cobrar'));
      await tester.pump();
      expect(pulsaciones, 1);
    });
  });

  group('Perder el trabajo en curso (mismo corte por lista vacía)', () {
    test('un alquiler a medio montar CUENTA como trabajo en curso', () {
      // `PopScope` y «Nuevo pedido» miraban solo el carrito. En un alquiler el
      // carrito está vacío, así que se descartaba en silencio un alquiler ya
      // abierto en el servidor: silla `OCCUPIED` y tiempo sin cobrar.
      final ProviderContainer c = _conRepositorio(_Repo());
      expect(c.read(posDraftProvider).hasPendingWork, isFalse);

      c.read(posDraftProvider.notifier).setType(PosOrderType.chairRental);
      c.read(posDraftProvider.notifier)
          .assignChair(chairId: _sillaId, chairLabel: _sillaCodigo);
      expect(c.read(posDraftProvider).hasPendingWork, isTrue,
          reason: 'la silla ya elegida es trabajo que se puede perder');

      c.read(posDraftProvider.notifier).attachRental(60);
      expect(c.read(posDraftProvider).hasPendingWork, isTrue,
          reason: 'con el alquiler abierto en el servidor, más todavía');

      c.read(posDraftProvider.notifier).reset();
      expect(c.read(posDraftProvider).hasPendingWork, isFalse);
    });

    test('un borrador de consumo sin productos NO cuenta', () {
      // Si no, el cajero no podría nunca volver atrás desde un POS vacío.
      final ProviderContainer c = _conRepositorio(_Repo());
      expect(c.read(posDraftProvider).hasPendingWork, isFalse);
      expect(c.read(posLinesProvider), isEmpty);
    });

    test('las notas y el cupón también cuentan como trabajo en curso', () {
      final ProviderContainer c = _conRepositorio(_Repo());
      final PosDraftController draft = c.read(posDraftProvider.notifier);
      draft.setNotes('Cliente pide la mesa del fondo');
      expect(c.read(posDraftProvider).hasPendingWork, isTrue);

      draft.reset();
      draft.setCoupon('VERANO10');
      expect(c.read(posDraftProvider).hasPendingWork, isTrue);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Harnesses
// ─────────────────────────────────────────────────────────────────────────────

/// Monta el panel de cobro con un `ProviderContainer` CONTROLADO por el test.
///
/// Se usa `UncontrolledProviderScope` y no `ProviderScope` a propósito: el test
/// necesita mutar el borrador y que el widget lo vea. Con un `ProviderScope`
/// normal el contenedor se crearía dentro del árbol y no habría forma de
/// alcanzarlo, así que el `setType` se aplicaría a otro provider y el `pump`
/// no pintaría nada. El contenedor se lo crea el test y se lo pasa.
Widget _harness(ProviderContainer c, {VoidCallback? onCharge}) {
  return UncontrolledProviderScope(
    container: c,
    // `PosCheckoutPanel` sin `PosWorkspace`: aquí solo importan el botón y su
    // estado, no el layout de tres columnas. El ancho es el del Xiaomi en dp.
    child: MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: SizedBox(
          width: 393,
          height: 720,
          child: PosCheckoutPanel(
            onCharge: onCharge ?? () {},
            onNewOrder: () {},
          ),
        ),
      ),
    ),
  );
}
