// Regresión del Bug 1: en la pestaña Menú, las tarjetas de producto se pegaban a
// x=0 y a x=916 (los dos bordes de la pantalla) mientras el saludo, el buscador,
// los chips y los títulos de sección sí tenían los 16 dp de
// `context.breakpoint.screenPadding`.
//
// MEDIDO EN EL DISPOSITIVO (Motorola Edge 60 Fusion, 1220 x 2712, densidad 3.0)
//   antes   → filas de la rejilla con contenido de x=0 a x=1219  (margen 0 px)
//   después → filas de la rejilla con contenido de x=45 a x=1175 (margen ~48 px)
//   referencia: el buscador marcaba x=45..1174, o sea el MISMO margen.
//
// LA CAUSA, EN DOS PARTES
//   1. `MenuProductSliver` no recibía ningún margen horizontal: su único `Padding`
//      era `EdgeInsets.only(bottom:)`, y `menu_body.dart` lo instanciaba tres
//      veces (destacados, promociones y todos) sin pasarle nada.
//   2. `_tileWidth` se calculaba sobre `constraints.crossAxisExtent` COMPLETO, así
//      que aunque se añadiera margen después, la celda se estiraría hasta el
//      borde: la aritmética de columnas se hacía sobre el ancho equivocado.
//
// Estos tests fijan las dos mitades por separado: que el margen se aplica, y que
// el ancho de celda se mide SOBRE EL ANCHO QUE QUEDA. Un arreglo que solo
// añadiese el `SliverPadding` sin mover la aritmética pasaría el primer test y
// dejaría las tarjetas pegadas al borde.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/features/menu/domain/entities/menu_product.dart';
import 'package:latte_coffee/features/menu/presentation/widgets/product_grid.dart';
import 'package:latte_coffee/shared/widgets/ui/product_card.dart';

/// Un producto cualquiera: lo que se mide es la CAJA, no su contenido.
const MenuProduct _producto = MenuProduct(
  id: 1,
  sku: 'CAF-LAT-01',
  name: 'Latte',
  basePriceMinor: 550000,
  categoryId: 1,
  preparationMinutes: 5,
);

List<MenuProduct> _productos(int n) =>
    List<MenuProduct>.generate(n, (int i) => _producto, growable: false);

/// Monta la rejilla como lo hace el menú: dentro de su propio scroll, con el
/// ancho de la pantalla y un margen de 16 dp, que es `screenPadding` en móvil.
Widget _harness({required EdgeInsetsGeometry padding, int total = 6}) {
  return ProviderScope(
    child: MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(
        body: CustomScrollView(
          slivers: <Widget>[
            MenuProductSliver(
              products: _productos(total),
              categoryNames: const <int, String>{1: 'Cafés'},
              padding: padding,
            ),
          ],
        ),
      ),
    ),
  );
}

/// Rectángulo en coordenadas de pantalla de la primera tarjeta.
Rect _primeraTarjeta(WidgetTester tester) {
  final Finder finder = find.byType(ProductCard).first;
  expect(finder, findsOneWidget, reason: 'no se pintó ninguna tarjeta');
  return tester.getRect(finder);
}

void main() {
  group('Menú · margen horizontal de la rejilla de productos', () {
    // Ancho de pantalla del móvil de prueba. En `mobile` la retícula son 2
    // columnas, igual que en el dispositivo real.
    const double anchoPantalla = 400;

    testWidgets('la tarjeta respeta el margen: NO empieza en x=0', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(anchoPantalla, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(padding: const EdgeInsets.symmetric(horizontal: 16)));
      await tester.pumpAndSettle();

      final Rect card = _primeraTarjeta(tester);
      // Este es el que fallaba: `card.left == 0`.
      expect(
        card.left,
        greaterThanOrEqualTo(16),
        reason: 'la tarjeta se pega al borde izquierdo: falta el margen',
      );
      // Y el derecho, que es el otro extremo del síntoma reportado.
      expect(
        anchoPantalla - card.right,
        greaterThanOrEqualTo(16),
        reason: 'la tarjeta se pega al borde derecho: falta el margen',
      );
    });

    testWidgets('el ancho de celda se mide sobre el espacio que QUEDA tras el margen',
        (WidgetTester tester) async {
      tester.view.physicalSize = const Size(anchoPantalla, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(padding: const EdgeInsets.symmetric(horizontal: 16)));
      await tester.pumpAndSettle();

      final Rect card = _primeraTarjeta(tester);
      // 2 columnas (`menuGridColumns` en `mobile`), 16 dp de margen a cada lado
      // y `AppSpacing.md` = 12 dp de separador entre ellas:
      //   (400 - 16 - 16 - 12) / 2 = 178
      //
      // Si `_tileWidth` siguiera midiendo sobre el ancho COMPLETO, la celda
      // mediría (400 - 12) / 2 = 194 y la tarjeta se saldría 16 dp por la
      // derecha. Este es el segundo assert del bug, el que un `SliverPadding`
      // puesto en el sitio equivocado no arregla.
      expect(card.width, closeTo(178, 1.0));
    });

    testWidgets('sin margen (valor por defecto) el comportamiento NO cambia', (WidgetTester tester) async {
      tester.view.physicalSize = const Size(anchoPantalla, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      // `MenuProductSliver` se usa también desde `ProductGrid`, que envuelve el
      // sliver en su propio `SliverPadding`. El valor por defecto `EdgeInsets.zero`
      // es lo que garantiza que ese uso no cambia de tamaño.
      await tester.pumpWidget(_harness(padding: EdgeInsets.zero));
      await tester.pumpAndSettle();

      final Rect card = _primeraTarjeta(tester);
      expect(card.left, 0, reason: 'sin margen la celda debe llegar al borde');
      // (400 - 12) / 2 = 194
      expect(card.width, closeTo(194, 1.0));
    });

    testWidgets('con margen 0 y con margen 16 la altura de la tarjeta NO cambia', (WidgetTester tester) async {
      // El alto se calcula a partir del ancho de celda (`minExtentForTileWidth`),
      // así que reducir el ancho disponible lo encoge. Esta comprobación fija que
      // el arreglo del margen no introduce un desbordamiento vertical nuevo: la
      // tarjeta sigue cabiendo en su propia caja, sin franjas de recorte.
      tester.view.physicalSize = const Size(anchoPantalla, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(padding: EdgeInsets.zero));
      await tester.pumpAndSettle();
      final double altoSinMargen = _primeraTarjeta(tester).height;

      await tester.pumpWidget(_harness(padding: const EdgeInsets.symmetric(horizontal: 16)));
      await tester.pumpAndSettle();
      final double altoConMargen = _primeraTarjeta(tester).height;

      expect(altoConMargen, lessThan(altoSinMargen));
      expect(altoConMargen, greaterThan(0));
    });

    testWidgets('las tres rejillas del menú llevan el mismo margen', (WidgetTester tester) async {
      // Reproduce la composición real de `MenuBody`: destacados, promociones y
      // el resto, las tres con `padding: EdgeInsets.symmetric(horizontal: 16)`.
      // Antes las tres se pintaban a sangre.
      tester.view.physicalSize = const Size(anchoPantalla, 1200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      const EdgeInsetsGeometry margen = EdgeInsets.symmetric(horizontal: 16);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: AppTheme.light,
            home: Scaffold(
              body: CustomScrollView(
                slivers: <Widget>[
                  for (final List<MenuProduct> grupo in <List<MenuProduct>>[
                    _productos(2),
                    _productos(2),
                    _productos(2),
                  ])
                    MenuProductSliver(
                      products: grupo,
                      categoryNames: const <int, String>{1: 'Cafés'},
                      padding: margen,
                    ),
                ],
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      final Iterable<Rect> tarjetas = tester
          .widgetList<ProductCard>(find.byType(ProductCard))
          .map((ProductCard c) => tester.getRect(find.byWidget(c)));
      expect(tarjetas.length, 6);
      for (final Rect card in tarjetas) {
        expect(card.left, greaterThanOrEqualTo(16));
        expect(anchoPantalla - card.right, greaterThanOrEqualTo(16));
      }
    });
  });
}
