// El carrito del cliente en un móvil estrecho: la lista de productos se cortaba
// a media línea y el panel de cupón se comía la pantalla.
//
// ─────────────────────────────────────────────────────────────────────────────
// LO QUE SE VIÓ EN EL DISPOSITIVO (1080x2400, densidad 440 → 393x873 dp)
// ─────────────────────────────────────────────────────────────────────────────
//   Menú → Latte → «Añadir al pedido» → carrito (2 artículos).
//
//   La primera línea («Mocha») se veía entera y la SEGUNDA («Latte · Mediano»)
//   quedaba partida por la mitad en el borde inferior de su tarjeta, con el
//   panel de cupón empezando justo encima. El cliente no podía leer la línea ni
//   pinchar su stepper, y el carrito parecía roto.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ NO LO CAZABA NINGÚN TEST DE OVERFLOW
// ─────────────────────────────────────────────────────────────────────────────
// El bug NO era un desbordamiento. En `cart_page.dart` la columna angosta era
// `Expanded(líneas) + Divider + side`, y `side` —un `SingleChildScrollView`—
// iba SIN envolver. En un `Column`, un hijo no flexible se mide con su altura
// intrínseca y se queda con lo que pida; el `Expanded` se queda con el resto,
// que aquí era un borde de ~250 dp.
//
// El `ListView` de dentro RECORTA lo que no cabe en vez de desbordar, así que no
// hay franjas amarillas ni excepción de `RenderFlex`: el fallo es un recorte
// silencioso. Por eso el test no mira si hay overflow, sino si la lista recibe
// una altura CONCRETA Y SUFICIENTE para pintar una línea entera.
//
// ESTE ARCHIVO ES LA REGRESIÓN: sin él, el arrangement anterior (un `Expanded`
// sin `flex` y un `side` rígido) vuelve a pasar sin quejarse.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/core/customer/cart_providers.dart';
import 'package:latte_coffee/core/customer/cart_state.dart';
import 'package:latte_coffee/core/customer/cart_store.dart';
import 'package:latte_coffee/features/cart/presentation/cart_page.dart';

/// El Xiaomi Redmi Note 9 Pro: 1080x2400 px a 440 dpi.
const Size kEstrecho = Size(393, 873);

/// Datos de las líneas que se pintan en el carrito.
const int _precioMinor = 550000;
const int _minutos = 5;

/// Monta el carrito con [n] líneas de producto.
///
/// El `CartStore` se crea a mano y se inyecta en `cartStoreProvider` para que el
/// test controle el contenido sin pasar por la API.
Future<ProviderContainer> _carritoCon(int n) async {
  final ProviderContainer c = ProviderContainer();
  addTearDown(c.dispose);
  final CartStore store = c.read(cartStoreProvider);
  for (int i = 0; i < n; i++) {
    store.addLine(CartLine(
      id: store.nextLineId(),
      productId: i + 1,
      productName: i.isEven ? 'Mocha' : 'Latte',
      unitPriceMinor: _precioMinor,
      quantity: 1,
      preparationMinutes: _minutos,
    ));
  }
  return c;
}

Widget _carritoEn(ProviderContainer c, Size size) => UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
          body: SizedBox(
            width: size.width,
            height: size.height,
            child: CartPage(),
          ),
        ),
      ),
    );

/// Altura mínima que debe tener la lista de líneas.
///
/// Sale de la tarjeta de línea real (`CartLineCard`): imagen + nombre + stepper
/// + precio. Un poco menos de 120 dp es lo que hace falta para que una línea
/// se lea entera; el arrangement roto dejaba ~250 dp para DOS líneas con
/// separador, es decir ~110 por línea ya CON el borde de la segunda cortándose.
const double kAlturaMinimaLista = 260;

void main() {
  group('Carrito en pantalla estrecha (393x873 dp)', () {
    testWidgets('la lista de productos conserva altura útil con el cupón y los '
        'totales debajo', (WidgetTester tester) async {
      final ProviderContainer c = await _carritoCon(2);
      await tester.pumpWidget(_carritoEn(c, kEstrecho));
      await tester.pumpAndSettle();

      // La lista de productos es el primer `ListView` del árbol.
      final Finder lista = find.byType(ListView).first;
      final double altura = tester.getSize(lista).height;

      expect(
        altura,
        greaterThanOrEqualTo(kAlturaMinimaLista),
        reason: 'con el cupón, los totales y el aviso de preparación, la lista '
            'de productos se quedaba en ${altura.toStringAsFixed(0)} dp y la '
            'segunda línea quedaba cortada por la mitad. El arrangement tiene '
            'que repartir el alto, no dejar que el panel se lo lleve todo.',
      );
    });

    testWidgets('la lista y el panel se reparten el alto: la lista manda',
        (WidgetTester tester) async {
      final ProviderContainer c = await _carritoCon(2);
      await tester.pumpWidget(_carritoEn(c, kEstrecho));
      await tester.pumpAndSettle();

      // El cliente está revisando la LISTA; el resumen ya tiene su copia en el
      // CTA fijo de abajo. Con `flex` 3:2 la lista tiene que ser más alta.
      final double alturaLista = tester.getSize(find.byType(ListView).first).height;
      final double alturaPanel =
          tester.getSize(find.byType(SingleChildScrollView).last).height;

      expect(
        alturaLista,
        greaterThan(alturaPanel),
        reason: 'la lista de productos es la parte principal en móvil',
      );
    });

    testWidgets('con muchas líneas, la lista sigue desplazándose sin desbordar',
        (WidgetTester tester) async {
      // Con ocho productos el caso es el inverso al del bug: ahora la lista es
      // la que crece. Se comprueba que no desborda y que se puede desplazar.
      final ProviderContainer c = await _carritoCon(8);
      await tester.pumpWidget(_carritoEn(c, kEstrecho));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull, reason: 'ningún desbordamiento');

      final Finder lista = find.byType(ListView).first;
      await tester.drag(lista, const Offset(0, -400));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull,
          reason: 'desplazar la lista con el cupón abierto no debe romper nada');
    });

    testWidgets('las dos zonas son alcanzables: producto y panel',
        (WidgetTester tester) async {
      final ProviderContainer c = await _carritoCon(2);
      await tester.pumpWidget(_carritoEn(c, kEstrecho));
      await tester.pumpAndSettle();

      // Los nombres de los productos tienen que verse: es el caso roto.
      expect(find.text('Mocha'), findsOneWidget);
      expect(find.text('Latte'), findsOneWidget);
      // Y el panel de cupón también, que es la otra mitad de la pantalla.
      expect(find.text('Cupón'), findsOneWidget);
      expect(find.text('Continuar al checkout'), findsOneWidget);
    });

    testWidgets('el resumen NO desborda a lo ancho: la fila de «Impuestos y '
        'cargos» lleva prosa, no un importe', (WidgetTester tester) async {
      // El segundo defecto que salió en esta pantalla, y que es el motivo de que
      // este archivo mire el ancho y no solo el alto.
      //
      // En `cart_totals_card.dart` la fila etiqueta/valor tenía el valor como
      // `Text` RÍGIDO. Todas las filas llevan importes («$11.000») y caben de
      // sobra, pero «Impuestos y cargos» lleva «Se calculan en el local», que es
      // una frase. En 393 dp la fila se pasaba 3.8 px:
      //
      //   A RenderFlex overflowed by 3.8 pixels on the right.
      //
      // Tres coma ocho píxeles no se ven a simple vista, pero el `RenderFlex`
      // marca el borde con la franja amarilla y negra, y encima del total.
      //
      // El arreglo es `Flexible` en el valor. Este test fija que el resumen se
      // construye sin desbordar NADA a este ancho, que es la condición exacta
      // que fallaba.
      final ProviderContainer c = await _carritoCon(2);
      await tester.pumpWidget(_carritoEn(c, kEstrecho));
      await tester.pumpAndSettle();

      // `takeException` recoge la aserción del `RenderFlex` si la hubo.
      expect(
        tester.takeException(),
        isNull,
        reason: 'el resumen del carrito desbordó a lo ancho en 393 dp: la fila '
            'de «Impuestos y cargos» lleva un valor de prosa que no cabe junto '
            'a la etiqueta',
      );

      // Y la fila que fallaba está presente y completa.
      expect(find.text('Impuestos y cargos'), findsOneWidget);
      expect(find.text('Se calculan en el local'), findsOneWidget);
    });
  });

  group('Carrito en pantalla ancha (no debe cambiar)', () {
    testWidgets('el layout de dos columnas sigue intacto',
        (WidgetTester tester) async {
      // El arreglo es del `!wide`. En ancho, `lines` y `side` van en `Row` con
      // `Expanded(flex:)` y no se tocan, pero se fija para que nadie rehaga el
      // reparto de la columna angosta rompiendo el escritorio.
      final ProviderContainer c = await _carritoCon(2);
      await tester.pumpWidget(_carritoEn(c, const Size(1280, 900)));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(find.text('Mocha'), findsOneWidget);
      expect(find.text('Cupón'), findsOneWidget);
    });
  });
}
