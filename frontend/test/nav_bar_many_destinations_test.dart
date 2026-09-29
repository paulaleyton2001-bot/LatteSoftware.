// La barra de navegación inferior con MUCHOS destinos.
//
// El bug: el panel de administración tiene 12 destinos y la `NavigationBar` de
// Material repartía el ancho a partes iguales (~30 dp por etiqueta). "Resumen"
// se partía en "Resum / en", "Configuración" en tres líneas y el texto se
// deformaba con `FittedBox` hasta ser ilegible. Es la misma categoría de fallo
// que el usuario reportó como «Postres recortado».
//
// Regla fijada aquí: con 6 destinos o menos se usa la `NavigationBar` de Material
// (reparte bien el ancho y muestra la etiqueta completa); a partir de 7, un
// carrusel horizontal donde cada destino mide lo que necesita y el carril
// scrollea.

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/shared/constants/app_destination.dart';
import 'package:latte_coffee/shared/widgets/adaptive_nav_bars.dart';

/// Ancho del Motorola Edge 60 Fusion en dp.
const Size phone = Size(406, 903);

List<AppDestination> _destinations(int count) => <AppDestination>[
      for (int i = 0; i < count; i++)
        AppDestination(
          label: const <String>[
            'Resumen',
            'Órdenes',
            'Sillas y zonas',
            'Reservas y alquileres',
            'Inventario',
            'Productos',
            'Pagos',
            'Clientes',
            'Reportes',
            'Descuentos',
            'Usuarios',
            'Configuración',
          ][i],
          icon: Icons.circle,
          selectedIcon: Icons.circle_outlined,
          location: '/admin/d$i',
        ),
    ];

Widget harness(Widget child) => MaterialApp(
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      home: Scaffold(body: child),
    );

void main() {
  group('Barra inferior con 5 destinos (cliente)', () {
    testWidgets('usa la NavigationBar de Material', (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness(AppNavigationBar(
        destinations: _destinations(5),
        currentLocation: '/admin/d0',
        onSelected: (_) {},
      )));

      expect(find.byType(NavigationBar), findsOneWidget);
      // Etiquetas enteras, sin partirse.
      expect(find.text('Sillas y zonas'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('Barra inferior con 12 destinos (administración)', () {
    testWidgets('NO usa NavigationBar: pasa a carrusel', (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness(AppNavigationBar(
        destinations: _destinations(12),
        currentLocation: '/admin/d0',
        onSelected: (_) {},
      )));

      // La `NavigationBar` de Material es la que partía las etiquetas.
      expect(find.byType(NavigationBar), findsNothing);

      // El carril existe y es horizontal.
      final ListView list = tester.widget<ListView>(find.byType(ListView));
      expect(list.scrollDirection, Axis.horizontal);

      expect(tester.takeException(), isNull);
    });

    testWidgets('cada etiqueta se pinta ENTERA, en una sola línea',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness(AppNavigationBar(
        destinations: _destinations(12),
        currentLocation: '/admin/d0',
        onSelected: (_) {},
      )));

      // "Resumen" es el primero y siempre está a la vista: si se parte en dos
      // líneas es que el carrusel no está midiendo el texto.
      final Text resumen = tester.widget<Text>(find.text('Resumen'));
      expect(resumen.maxLines, 1);
      expect(tester.getSize(find.text('Resumen')).height, lessThan(24));

      // Y los largos se scrollean, no se deforman: "Configuración" (la última)
      // no está construido todavía, lo que demuestra que el carril es perezoso.
      expect(find.text('Configuración'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('el destino activo se marca con píldora y check',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(harness(AppNavigationBar(
        destinations: _destinations(12),
        currentLocation: '/admin/d0',
        onSelected: (_) {},
      )));

      // `Semantics` se fusiona en el árbol de semántica, así que se consulta
      // el nodo FUSIONADO (el que se anuncia), no el widget suelto: el
      // `selected` lo lleva el nodo accesible, no la instancia de `Semantics`.
      final SemanticsNode node = tester.getSemantics(find.text('Resumen'));
      expect(
        node.label,
        'Resumen',
        reason: 'La etiqueta accesible debe decir el nombre completo.',
      );
      expect(
        node.hasFlag(SemanticsFlag.isSelected),
        isTrue,
        reason: 'El destino activo se anuncia como seleccionado.',
      );

      expect(tester.takeException(), isNull);
    });

    testWidgets('tocar un destino dispara el callback con ESE destino',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      AppDestination? picked;
      await tester.pumpWidget(harness(AppNavigationBar(
        destinations: _destinations(12),
        currentLocation: '/admin/d0',
        onSelected: (AppDestination item) => picked = item,
      )));

      await tester.tap(find.text('Órdenes'));
      await tester.pumpAndSettle();

      expect(picked, isNotNull);
      expect(picked!.label, 'Órdenes');
    });
  });

  group('Índice del destino activo', () {
    test('cae en 0 si la ruta no está en la lista', () {
      expect(
        selectedIndex(_destinations(5), '/otra/ruta'),
        0,
      );
    });

    test('encuentra el destino por ruta exacta', () {
      expect(selectedIndex(_destinations(12), '/admin/d3'), 3);
    });
  });
}
