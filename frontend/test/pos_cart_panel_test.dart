// Reproduce el bloqueo del mostrador: tocar productos del catálogo NO llegaba al
// panel «Pedido en curso», que se quedaba en «Pedido vacío» con el subtotal en $0.
//
// SÍNTOMA EN EL DISPOSITIVO (Motorola Edge 60 Fusion, Android 16)
//   Perfil → Punto de venta → Catálogo → tocar 2 veces «Espresso» → Pedido.
//   El panel seguía mostrando el estado que tenía al abrirse, y el subtotal no se
//   movía. Con el carrito ya vaciado la reproducción es literal: «Pedido vacío».
//
// LA CAUSA NO ESTÁ EN LA REJILLA
// `posAddProduct` escribe en el `CartStore` compartido y este SÍ se enteraba: el
// badge de navegación del cliente subía, y el carrito persistía a disco. Lo que
// estaba congelado era la LECTURA: `posLinesProvider` es un `Provider` de Riverpod
// que hace `ref.watch(cartStoreProvider).state.lines`, y esa dependencia (la
// INSTANCIA del store) no cambia nunca. Riverpod invalida un `Provider` cuando
// cambia una de sus dependencias, y un `ChangeNotifier` avisa por su propio canal
// (`notifyListeners`), que Riverpod no observa. Así que el provider se evaluaba
// una vez, al montar, y devolvía ese mismo `List` para siempre.
//
// Estos tests fijan las TRES lecturas que quedaban congeladas: las líneas del
// panel, el subtotal que ve el cajero y el subtotal que usa el camino de cobro.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/core/customer/cart_providers.dart';
import 'package:latte_coffee/core/customer/cart_store.dart';
import 'package:latte_coffee/core/utils/currency_formatter.dart';
import 'package:latte_coffee/features/pos/domain/entities/pos_catalog_item.dart';
import 'package:latte_coffee/features/pos/presentation/pos_cart_controller.dart';
import 'package:latte_coffee/features/pos/presentation/pos_controller.dart';
import 'package:latte_coffee/features/pos/presentation/widgets/pos_order_panel.dart';
import 'package:latte_coffee/features/pos/presentation/widgets/pos_product_grid.dart';

/// El producto que tocaba el cajero en la reproducción.
const PosCatalogItem _espresso = PosCatalogItem(
  id: 7,
  sku: 'CAF-ESPR',
  name: 'Espresso',
  basePriceMinor: 350000,
  preparationMinutes: 3,
);

/// Un producto caro, para que el subtotal esperado NO se confunda con el de otro.
const PosCatalogItem _combo = PosCatalogItem(
  id: 12,
  sku: 'CMB-DES',
  name: 'Combo desayuno',
  basePriceMinor: 1950000,
  preparationMinutes: 12,
);

/// Monta la rejilla y el panel del pedido en la misma pantalla, como en el
/// mostrador de escritorio (dos columnas) y como en la pestaña «Pedido» de móvil
/// cuando la rejilla ya está construida.
Widget _harness() => ProviderScope(
      overrides: <Override>[
        posVisibleCatalogProvider.overrideWith(
          (Ref ref) => const <PosCatalogItem>[_espresso, _combo],
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
          body: SafeArea(
            child: Row(
              children: <Widget>[
                const SizedBox(width: 300, child: PosProductGrid(minTileWidth: 140)),
                // El gutter va FUERA del panel: envolverlo en el `SizedBox` lo
                // aplastaría a 8 dp y sus hijos no llegarían a construirse.
                const SizedBox(width: 8),
                const Expanded(child: PosOrderPanel()),
              ],
            ),
          ),
        ),
      ),
    );

/// El producto dentro de la REJILLA del catálogo.
///
/// Hace falta acotar el finder: en cuanto el alta funciona, el mismo nombre
/// aparece también en la línea del pedido, y `tap()` sobre un finder ambiguo
/// revienta. Un test que solo pasara con el bug (donde el panel nunca se
/// actualiza) no comprobaría nada.
Finder _enRejilla(String nombre) => find.descendant(
      of: find.byType(PosProductGrid),
      matching: find.text(nombre),
    );

void main() {
  group('Panel del pedido del POS', () {
    testWidgets('tocar un producto del catálogo lo pinta en el panel',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness());
      await tester.pump();

      // Punto de partida: pedido vacío.
      expect(find.text('Pedido vacío'), findsOneWidget);
      expect(find.text('Subtotal estimado'), findsOneWidget);

      // Un toque = una unidad (el requisito del mostrador).
      await tester.tap(_enRejilla('Espresso'));
      await tester.pump();

      expect(
        find.text('Pedido vacío'),
        findsNothing,
        reason: 'El panel del pedido no se enteró del alta: la rejilla escribe en '
            'el CartStore pero la lectura del panel quedó congelada.',
      );
      // El nombre aparece en la rejilla y en la línea del pedido.
      expect(find.text('Espresso'), findsNWidgets(2));
      // Con una unidad, el importe de la línea y el subtotal coinciden: $3.500
      // en cada sitio (la celda del catálogo pinta $3.500 y el panel, la línea y
      // el pie). Lo que importa es que el panel ya no dice «Pedido vacío».
      expect(find.text(CurrencyFormatter.formatMinor(350000)), findsNWidgets(3));
    });

    testWidgets('dos toques del mismo producto suman en la misma línea',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness());
      await tester.pump();

      await tester.tap(_enRejilla('Espresso'));
      await tester.pump();
      await tester.tap(_enRejilla('Espresso'));
      await tester.pump();

      expect(find.text('Pedido vacío'), findsNothing);
      // 2 × $3.500 = $7.000, en la línea y en el subtotal. NO dos líneas de
      // $3.500: el store fusiona por `mergeKey` y el panel debe reflejarlo.
      expect(find.text(CurrencyFormatter.formatMinor(700000)), findsNWidgets(2));
      expect(find.text(CurrencyFormatter.formatMinor(350000)), findsOneWidget,
          reason: 'El catálogo sigue pintando el precio UNITARIO, no el total.');
    });

    testWidgets('tocar dos productos distintos suma sus importes',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness());
      await tester.pump();

      await tester.tap(_enRejilla('Espresso'));
      await tester.pump();
      await tester.tap(_enRejilla('Combo desayuno'));
      await tester.pump();

      // $3.500 + $19.500 = $23.000
      expect(find.text(CurrencyFormatter.formatMinor(2300000)), findsOneWidget);
      expect(find.text('Combo desayuno'), findsNWidgets(2));
    });

    testWidgets('bajar la cantidad a cero borra la línea y vuelve el estado vacío',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness());
      await tester.pump();

      await tester.tap(_enRejilla('Espresso'));
      await tester.pump();
      expect(find.text('Pedido vacío'), findsNothing);

      // El botón «−» del panel es el que llama a `CartStore.setQuantity(…, 0)`.
      await tester.tap(find.byIcon(Icons.remove_rounded).first);
      await tester.pump();

      expect(find.text('Pedido vacío'), findsOneWidget);
      expect(find.text(CurrencyFormatter.formatMinor(0)), findsOneWidget);
    });
  });

  group('Lectura del pedido para el cobro', () {
    // Estos NO usan widgets a propósito: `pos_page.dart` y `pos_charge_flow.dart`
    // leen con `ref.read(posLinesProvider)`, no con `watch`. Un `Provider` roto se
    // manifesto ahí como un cobro que salía con las líneas viejas (o que no salía
    // nunca, con `isEmpty` congelado en `true` y el botón de cobrar inerte).
    // Un test de widget no los cubriría, porque el `read` no reconstruye nada.

    ProviderContainer _conCarrito() {
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);
      return container;
    }

    test('el subtotal del cobro sigue a las altas del catálogo', () {
      final ProviderContainer container = _conCarrito();
      final CartStore store = container.read(cartStoreProvider);

      expect(container.read(posLinesProvider), isEmpty);
      expect(container.read(posSubtotalMinorProvider), 0);

      posAddProduct(store, _espresso);
      posAddProduct(store, _espresso);

      expect(container.read(posLinesProvider), hasLength(1));
      expect(container.read(posSubtotalMinorProvider), 700000);
      expect(container.read(posPreparationMinutesProvider), 6);
    });

    test('tras cobrar y limpiar, el pedido vuelve a estar vacío', () {
      final ProviderContainer container = _conCarrito();
      final CartStore store = container.read(cartStoreProvider);

      posAddProduct(store, _combo);
      expect(container.read(posLinesProvider), hasLength(1));

      // Esto es lo que hace `PosChargeFlow._afterCharge` al cobrar bien.
      store.clear();

      expect(container.read(posLinesProvider), isEmpty);
      expect(container.read(posSubtotalMinorProvider), 0);
    });

    test('el cliente y el POS leen el MISMO carrito', () {
      // OJO: este NO es un test de regresión del bug. Sigue en verde con la
      // lectura rota, y a propósito: no lee el provider ANTES de mutar, así que
      // calcula el valor bueno por casualidad. Lo que fija es la DECISIÓN de
      // diseño del mostrador (compartir carrito con el cliente) para que nadie la
      // rompa por refactor sin darse cuenta. Los tests que sí cazan el bug son los
      // de arriba, que leen y luego mutan.
      final ProviderContainer container = _conCarrito();
      posAddProduct(container.read(cartStoreProvider), _espresso);

      expect(container.read(cartLinesProvider), hasLength(1));
      expect(container.read(cartBadgeCountProvider), 1);
      expect(container.read(posLinesProvider), hasLength(1));
    });
  });
}
