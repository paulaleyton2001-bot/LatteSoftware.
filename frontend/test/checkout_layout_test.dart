// Reproduce en aislamiento el fallo del checkout vacío: el paso «Tipo» no
// pinta NADA en un móvil de 19,5:9 (1220×2712 px, 406×903 dp).
//
// El síntoma en el dispositivo era una pantalla de «Finalizar pedido» con la
// barra de pasos y el botón, y un hueco completamente vacío en medio.
//
// Cómo se reproduce aquí: se monta `CheckoutNarrowLayout` con un carrito real y se
// comprueba que hay tarjetas de tipo de pedido visibles. Si el `LayoutBuilder`
// de `OrderTypeSelector` recibiera una altura no acotada, el `Row` con
// `CrossAxisAlignment.stretch` no podría resolver su altura y el árbol entero se
// pintaría a 0.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/core/customer/cart_state.dart';
import 'package:latte_coffee/features/checkout/domain/entities/checkout_options.dart';
import 'package:latte_coffee/features/checkout/presentation/checkout_state.dart';
import 'package:latte_coffee/features/checkout/presentation/widgets/checkout_layouts.dart';
import 'package:latte_coffee/features/checkout/presentation/widgets/order_type_selector.dart';

/// Carrito con dos líneas, como el que se crea en la prueba del dispositivo.
CartState _cart() => CartState(
      lines: <CartLine>[
        const CartLine(
          id: 'l1',
          productId: 1,
          productName: 'Latte',
          variantName: 'Mediano',
          unitPriceMinor: 550000,
          quantity: 1,
        ),
        const CartLine(
          id: 'l2',
          productId: 9,
          productName: 'Tiramisú',
          unitPriceMinor: 1400000,
          quantity: 3,
        ),
      ],
    );

void main() {
  // El ancho del Motorola Edge 60 Fusion en dp: 1220 px / 3 de densidad.
  const Size phone = Size(406, 903);

  Widget harness(Widget child) => ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light,
          darkTheme: AppTheme.dark,
          home: Scaffold(
            body: SafeArea(child: child),
          ),
        ),
      );

  group('Selector de tipo de pedido', () {
    testWidgets('pinta las tres tarjetas en móvil 19,5:9', (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness(const OrderTypeSelector()));

      expect(find.text('Para llevar'), findsOneWidget);
      expect(find.text('Consumir aquí'), findsOneWidget);
      expect(find.text('Reservar silla'), findsOneWidget);

      // Y son REALMENTE visibles: el fallo anterior no era «no hay texto» sino
      // «el árbol tiene altura 0».
      for (final String label in <String>[
        'Para llevar',
        'Consumir aquí',
        'Reservar silla',
      ]) {
        expect(tester.getSize(find.text(label)).height, greaterThan(0));
      }
    });

    testWidgets('ninguna tarjeta desborda en móvil', (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness(const OrderTypeSelector()));

      // Si algo se saliera, Flutter lo pintaría como franja amarilla en
      // `tester.takeException()`.
      expect(tester.takeException(), isNull);
    });
  });

  group('Layout estrecho del checkout', () {
    testWidgets('el cuerpo del checkout no queda vacío', (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness(Builder(builder: (BuildContext context) {
        return CheckoutNarrowLayout(
          cart: _cart(),
          state: const CheckoutState(),
          discountMinor: 0,
        );
      })));

      // El bloque de tipo es lo primero y siempre visible.
      expect(find.text('Para llevar'), findsOneWidget);

      // Y el contenido tiene altura real, no 0.
      final Size size = tester.getSize(find.byType(CheckoutNarrowLayout));
      expect(size.height, greaterThan(100));
      expect(tester.takeException(), isNull);
    });
  });

  group('Datos del selector', () {
    test('las tres opciones de tipo están declaradas', () {
      expect(kOrderTypeOptions, hasLength(3));
      expect(
        kOrderTypeOptions.map((OrderTypeOption o) => o.type),
        containsAll(<String>['TAKEAWAY', 'DINE_IN', 'CHAIR_RENTAL']),
      );
      // Cada opción describe lo que pasa: es la decisión que más dudas genera.
      for (final OrderTypeOption option in kOrderTypeOptions) {
        expect(option.label, isNotEmpty);
        expect(option.description, isNotEmpty);
      }
    });
  });
}
