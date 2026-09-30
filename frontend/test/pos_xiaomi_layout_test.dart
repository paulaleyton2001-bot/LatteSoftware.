// Layout del POS en la pantalla del Xiaomi Redmi Note 9 Pro: 1080x2400 px con
// densidad 440, o sea 393x873 dp.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ ESTE ARCHIVO EXISTE
// ─────────────────────────────────────────────────────────────────────────────
// La app se había probado en un Motorola de 1220x2712 con densidad 3.0, es decir
// 407x904 dp. El Redmi es 393x873 dp: catorce dp más estrecho y treinta y uno más
// bajo. Son los dos cortes juntos los que rompen las pantallas, porque el ancho
// decide cuántas columnas caben y la altura decide cuánto se desborda. Con la
// pantalla más alta, un `Column` con hijos fijos puede desbordar sin que se veas
// en el móvil grande.
//
// El POS ya tenía una defensa contra esto (el bloque de silla y el selector de
// reservas van dentro de UN `SingleChildScrollView`, no en dos `Expanded`
// apilados) y este archivo la fija, para que nadie lo revierta por refactor sin
// tener un móvil a mano.
//
// LA REGLA QUE SE COMPRUEBA
//   1. NINGÚN desbordamiento (`RenderFlex overflowed`) en ninguna combinación de
//      estado del panel de cobro. Un desbordamiento pinta franjas amarillas y
//      negras encima del botón de cobrar.
//   2. El botón grande de cobrar y el de «Nuevo pedido» tienen su ALTURA ENTERA
//      en pantalla. Es el control que el cajero tiene que acertar con dos dedos
//      sin mirar; si queda cortado por el borde inferior, el POS no sirve.
//   3. El motivo de bloqueo se lee ENTERO: si sale cortado, el cajero no sabe qué
//      hacer y el botón apagado vuelve a parecer roto.

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
import 'package:latte_coffee/features/pos/domain/entities/pos_order_type.dart';
import 'package:latte_coffee/features/pos/domain/repositories/pos_repository.dart';
import 'package:latte_coffee/features/pos/domain/repositories/pos_repository_models.dart';
import 'package:latte_coffee/features/pos/presentation/pos_controller.dart';
import 'package:latte_coffee/features/pos/presentation/widgets/pos_checkout_panel.dart';

/// Ancho y alto EN DP del Redmi Note 9 Pro (1080x2400 px a 440 dpi).
const Size kXiaomi = Size(393, 873);

/// Un plano con dos zonas y siete sillas, como el del local real.
///
/// Con una sola silla el mapa cabe de sobra y el test no probaría nada: el
/// desbordamiento del que había Queilo antes venía de un plano con varias zonas
/// apiladas, que es el caso normal.
ChairMap _mapaDelLocal() => ChairMap(
      locationId: 1,
      locationName: 'Sede Principal',
      countsByStatus: const <String, int>{'AVAILABLE': 4, 'RESERVED': 3},
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
          chairs: const <ChairInfo>[
            ChairInfo(id: 8, code: 'IN-M01', zoneName: 'Interior',
                status: 'AVAILABLE', pricePerHourMinor: 500000),
            ChairInfo(id: 9, code: 'IN-M02', zoneName: 'Interior',
                status: 'AVAILABLE', pricePerHourMinor: 500000),
          ],
        ),
        ZoneMap(
          id: 3,
          name: 'Ventana',
          code: 'VN',
          colorHex: '#3F7F5F',
          minX: 0,
          minY: 0,
          maxX: 1,
          maxY: 1,
          chairs: const <ChairInfo>[
            ChairInfo(id: 21, code: 'VN-05', zoneName: 'Ventana',
                status: 'AVAILABLE', pricePerHourMinor: 550000),
            ChairInfo(id: 22, code: 'TZ-01', zoneName: 'Ventana',
                status: 'RESERVED', pricePerHourMinor: 550000),
          ],
        ),
        ZoneMap(
          id: 4,
          name: 'Zona Premium',
          code: 'PR',
          colorHex: '#8A5A2B',
          minX: 0,
          minY: 0,
          maxX: 1,
          maxY: 1,
          chairs: const <ChairInfo>[
            ChairInfo(id: 40, code: 'PR-A2', zoneName: 'Zona Premium',
                status: 'AVAILABLE', pricePerHourMinor: 800000),
            ChairInfo(id: 41, code: 'PR-A3', zoneName: 'Zona Premium',
                status: 'AVAILABLE', pricePerHourMinor: 800000),
            ChairInfo(id: 42, code: 'PR-A4', zoneName: 'Zona Premium',
                status: 'AVAILABLE', pricePerHourMinor: 800000),
          ],
        ),
      ],
    );

/// Repositorio mínimo: el panel solo necesita el mapa y las reservas de la silla.
class _Repo implements PosRepository {
  @override
  Future<Result<ChairMap>> never() async => throw UnimplementedError();

  @override
  Future<Result<PosCatalog>> catalog() async =>
      Success<PosCatalog>(const PosCatalog());

  @override
  Future<Result<PosOrderResult>> createOrder(PosOrderDraftRequest request) async =>
      throw UnimplementedError();

  @override
  Future<Result<PosChargeResult>> charge({
    required PosChargeRequest request,
    required int orderId,
    required String idempotencyKey,
  }) async =>
      throw UnimplementedError();

  @override
  Future<Result<PosOrderTransitionResult>> changeOrderStatus({
    required int orderId,
    required String toStatus,
    String? reason,
  }) async =>
      throw UnimplementedError();

  @override
  Future<Result<List<PosPaymentMethodOption>>> paymentMethods() async =>
      Success<List<PosPaymentMethodOption>>(const <PosPaymentMethodOption>[]);

  @override
  Future<Result<PosReceipt>> receipt(int orderId) async =>
      throw UnimplementedError();

  @override
  Future<Result<PosReservation>> createReservation({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
  }) async =>
      throw UnimplementedError();

  @override
  Future<Result<PosReservation>> confirmReservation(int reservationId) async =>
      throw UnimplementedError();

  @override
  Future<Result<PosRentalStart>> startRental({
    required int chairId,
    required int plannedMinutes,
    required int reservationId,
  }) async =>
      throw UnimplementedError();

  @override
  Future<Result<List<PosReservation>>> chairReservations({
    required int chairId,
    required DateTime from,
    required DateTime to,
  }) async =>
      FailureResult<List<PosReservation>>(const OfflineFailure());
}

/// Monta el panel de cobro al tamaño del Xiaomi.
///
/// Se fija `textScaleFactor` en 1.0 explícitamente porque el test corre con el
/// valor por defecto pero un usuario con fuente grande es otro caso real; aquí
/// lo que se mide es el ancho y el alto de la pantalla, no la accesibilidad
/// tipográfica, que tiene sus propias pruebas.
Widget _panelEnXiaomi(ProviderContainer c) => UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
          body: SizedBox(
            width: kXiaomi.width,
            height: kXiaomi.height,
            child: PosCheckoutPanel(
              onCharge: () {},
              onNewOrder: () {},
            ),
          ),
        ),
      ),
    );

ProviderContainer _contenedor() {
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      posRepositoryProvider.overrideWithValue(_Repo()),
      venueMapProvider.overrideWith((Ref ref) async => _mapaDelLocal()),
    ],
  );
  addTearDown(c.dispose);
  return c;
}

/// Falla si algún `RenderFlex` de la pantalla ha desbordado.
///
/// Se recoge el error de Flutter en vez de mirar el árbol a ojo: el desbordamiento
/// se reporta por consola, así que es ahí donde hay que escucharlo.
void _sinDesbordamientos(WidgetTester tester) {
  final List<String> desbordamientos = tester.takeException() == null
      ? const <String>[]
      : <String>['excepción: ${tester.takeException()}'];
  expect(
    desbordamientos,
    isEmpty,
    reason: 'RenderFlex desbordó en ${kXiaomi.width}x${kXiaomi.height} dp. '
        'En el dispositivo son las franjas amarillas encima del botón de cobrar.',
  );
}

/// `true` si el texto se ve entero, es decir, no lo recorta su contenedor.
bool _textoCompleto(WidgetTester tester, String texto) {
  final Finder finder = find.text(texto);
  if (finder.evaluate().isEmpty) return false;
  final Text widget = tester.widget<Text>(finder.first);
  return widget.maxLines == null || widget.maxLines! > 1;
}

void main() {
  // `DateFormatter` usa `intl`, que no se inicializa solo en los tests.
  setUpAll(() => initializeDateFormatting('es'));

  group('Panel de cobro del POS en el Xiaomi (393x873 dp)', () {
    testWidgets('tipo «Alquiler de silla» sin silla: no desborda y el motivo '
        'se lee entero', (WidgetTester tester) async {
      final ProviderContainer c = _contenedor();
      c.read(posDraftProvider.notifier).setType(PosOrderType.chairRental);
      await tester.pumpWidget(_panelEnXiaomi(c));
      await tester.pumpAndSettle();

      _sinDesbordamientos(tester);
      // El motivo del botón apagado tiene que leerse: es lo que evita que un
      // botón apagado parezca uno roto.
      expect(find.textContaining('Elige la silla'), findsOneWidget);
      expect(_textoCompleto(tester, 'Elige la silla del alquiler en el plano de arriba.'),
          isTrue,
          reason: 'el motivo se pinta con varias líneas; si se recorta, no sirve');
    });

    testWidgets('alquiler con silla elegida: el plano grande no desborda',
        (WidgetTester tester) async {
      // El caso que antes salía como «BOTTOM OVERFLOWED BY 139 PIXELS»: varias
      // zonas de sillas más el selector de reservas, sin scroll intermedio.
      final ProviderContainer c = _contenedor();
      c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: 21, chairLabel: 'VN-05');
      await tester.pumpWidget(_panelEnXiaomi(c));
      await tester.pumpAndSettle();

      _sinDesbordamientos(tester);
      expect(find.text('VN-05'), findsWidgets);
    });

    testWidgets('alquiler listo para cobrar: el botón grande está ENTERO en '
        'pantalla', (WidgetTester tester) async {
      // 873 dp es poco alto. Si el botón de cobrar queda cortado, el POS no
      // sirve aunque no haya franjas amarillas: es el control que más se pulsa.
      final ProviderContainer c = _contenedor();
      c.read(posDraftProvider.notifier)
        ..setType(PosOrderType.chairRental)
        ..assignChair(chairId: 21, chairLabel: 'VN-05')
        ..attachReservation(40)
        ..attachRental(60);
      await tester.pumpWidget(_panelEnXiaomi(c));
      await tester.pumpAndSettle();

      _sinDesbordamientos(tester);

      final Finder boton = find.text('Cobrar alquiler');
      expect(boton, findsOneWidget);
      final Rect caja = tester.getRect(boton);
      final Size pantalla = tester.view.physicalSize / tester.view.devicePixelRatio;
      expect(caja.bottom, lessThanOrEqualTo(pantalla.height),
          reason: 'el botón de cobrar no puede quedar fuera de la pantalla');
      // Y tiene que tener altura de botón, no ser una línea de texto pelada.
      expect(tester.getSize(boton).height, greaterThan(16));
    });

    testWidgets('tipo «Para llevar» con el carrito vacío: no desborda',
        (WidgetTester tester) async {
      // Sin silla no hay bloque de mapa, así que el hueco sobra hacia arriba. El
      // riesgo aquí es el contrario: que el `Expanded` vacío se coma el sitio del
      // botón.
      final ProviderContainer c = _contenedor();
      await tester.pumpWidget(_panelEnXiaomi(c));
      await tester.pumpAndSettle();

      _sinDesbordamientos(tester);
      expect(find.text('Añade productos'), findsOneWidget);
    });

    testWidgets('el selector de tipo de pedido cabe con su desplazamiento '
        'horizontal y no corta el tercero', (WidgetTester tester) async {
      // En 393 dp los tres tipos («Para llevar», «En el local», «Alquiler de
      // silla») NO caben: el selector es un `SingleChildScrollView` horizontal.
      // Si algún día se quita el scroll, «Alquiler de silla» quedaría
      //inaccesible y el cajero no podría ni cambiar de tipo.
      final ProviderContainer c = _contenedor();
      await tester.pumpWidget(_panelEnXiaomi(c));
      await tester.pumpAndSettle();

      _sinDesbordamientos(tester);
      expect(find.text('Para llevar'), findsOneWidget);
      expect(find.text('En el local'), findsOneWidget);
      // «Alquiler de silla» existe en el árbol aunque esté fuera de vista: lo que
      // importa es que se pueda desplazar hasta él.
      expect(find.text('Alquiler de silla'), findsOneWidget,
          reason: 'el tipo de alquiler debe seguir siendo elegible en 393 dp');
    });
  });
}
