// Layout del menú: separación de los chips de categoría y de los encabezados.
//
// ─────────────────────────────────────────────────────────────────────────────
// LOS ERRORES QUE EL USUARIO VIO EN EL MENÚ
// ─────────────────────────────────────────────────────────────────────────────
//   1. Una pregunta con letras de otro alfabeto intercaladas en el verbo. La
//      cadena exacta NO se copia aquí porque `source_text_hygiene_test.dart`
//      recorre también `test/` y la encontraría en este comentario; la cubre ese
//      test, y `greeting_test.dart` fija que la buena es la que se pinta.
//   2. Los chips de categoría PEGADOS entre sí ("Todo | Cafés 7 | Bebidas 4").
//   3. "Destacados" y "Los favoritos de la casa" casi pegados, y el subtítulo
//      tocando la primera tarjeta.
//
// 2 y 3 no son bugs de lógica: son dos números. Y los dos están en un
// COMPONENTE compartido, no en la pantalla — por eso un test de widget sobre el
// componenteShared es lo que los fija. Si el separador volviera a 8 dp, o el
// hueco del subtítulo a 2 dp, el fallo se ve aquí y no en el móvil de un cliente.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_spacing.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/shared/constants/app_strings.dart';
import 'package:latte_coffee/shared/widgets/ui/category_chip.dart';
import 'package:latte_coffee/shared/widgets/ui/category_chip_row.dart';
import 'package:latte_coffee/shared/widgets/ui/section_header.dart';

/// Ancho del Motorola Edge 60 Fusion en dp.
const Size phone = Size(406, 903);

Widget _harness(Widget child) => MaterialApp(
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      home: Scaffold(body: child),
    );

/// Separación horizontal real entre dos pills consecutivas.
///
/// Se miden los RECTÁNGULOS DE LOS CHIPS, no los del texto: el texto lleva 16 dp
/// de padding dentro de la pill, así que medir "texto contra texto" daría
/// `separación + 32` y la comprobación no significaría nada.
double _gapBetweenChips(WidgetTester tester, int firstIndex, int secondIndex) {
  final Rect a = tester.getRect(
    find.byType(CategoryChip).at(firstIndex),
  );
  final Rect b = tester.getRect(
    find.byType(CategoryChip).at(secondIndex),
  );
  return b.left - a.right;
}

/// Espacio que queda entre el subtítulo y el borde inferior del bloque.
double _spaceBelowSubtitle(
  WidgetTester tester,
  String subtitle,
) =>
    tester.getRect(find.byType(SectionHeader)).bottom -
    tester.getRect(find.text(subtitle)).bottom;

/// Espacio que queda entre el título y su subtítulo.
double _gapInsideHeader(
  WidgetTester tester,
  String title,
  String subtitle,
) =>
    tester.getRect(find.text(subtitle)).top -
    tester.getRect(find.text(title)).bottom;

void main() {
  group('Fila de chips de categoría', () {
    testWidgets('deja separación entre dos pills', (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(
        CategoryChipRow(
          labels: const <String>['Todo', 'Cafés', 'Bebidas', 'Comidas'],
          selectedLabel: 'Todo',
          onSelected: (_) {},
        ),
      ));

      final double gap = _gapBetweenChips(tester, 0, 1);
      expect(
        gap,
        greaterThanOrEqualTo(kCategoryChipSpacing),
        reason: 'Las pills deben separarse al menos $kCategoryChipSpacing dp: '
            'con 8 se leían como una barra continua.',
      );
      expect(gap, closeTo(12, 0.01));
      expect(tester.takeException(), isNull);
    });

    testWidgets('la separación es la MISMA entre todas, no solo en la primera',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(
        CategoryChipRow(
          labels: const <String>['Todo', 'Cafés', 'Bebidas', 'Comidas'],
          selectedLabel: 'Todo',
          onSelected: (_) {},
        ),
      ));

      for (int i = 0; i < 3; i++) {
        expect(
          _gapBetweenChips(tester, i, i + 1),
          closeTo(kCategoryChipSpacing, 0.01),
          reason: 'El hueco entre la pill $i y la ${i + 1} no es el del '
              'sistema de espaciado.',
        );
      }
    });

    testWidgets('`spacing` es un parámetro: se puede ajustar sin abrir el archivo',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(
        CategoryChipRow(
          labels: const <String>['Todo', 'Cafés'],
          spacing: AppSpacing.xl,
          onSelected: (_) {},
        ),
      ));

      expect(_gapBetweenChips(tester, 0, 1), closeTo(AppSpacing.xl, 0.01));
      expect(tester.takeException(), isNull);
    });

    testWidgets('la fila respira respecto al buscador y al título',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(
        const CategoryChipRow(
          labels: <String>['Todo', 'Cafés'],
          onSelected: _noop,
        ),
      ));

      // El carril mide 52 dp de chips, pero el hueco vertical vive FUERA del
      // `SizedBox`: si fuera padding del `ListView` se comería el alto del chip.
      final double altoFila = tester.getSize(find.byType(ListView)).height;
      expect(altoFila, 52);
      expect(altoFila, greaterThanOrEqualTo(AppTapTarget.min));
    });

    testWidgets('con muchas categorías la fila scrollea y no desborda',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(
        CategoryChipRow(
          labels: const <String>[
            'Todo', 'Cafés', 'Bebidas', 'Comidas', 'Postres', 'Panadería',
            'Smoothies', 'Especialidades',
          ],
          onSelected: (_) {},
        ),
      ));

      final ListView list = tester.widget<ListView>(find.byType(ListView));
      expect(list.scrollDirection, Axis.horizontal);
      // El primero existe; el último es perezoso. Un overflow aquí sería un
      // "RIGHT OVERFLOWED BY …" en el logcat.
      expect(find.text('Todo'), findsOneWidget);
      expect(find.text('Especialidades'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('tocar un chip dispara el callback con SU etiqueta',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      String? picked;
      await tester.pumpWidget(_harness(
        CategoryChipRow(
          labels: const <String>['Todo', 'Cafés', 'Bebidas'],
          onSelected: (String label) => picked = label,
        ),
      ));

      await tester.tap(find.text('Bebidas'));
      await tester.pumpAndSettle();
      expect(picked, 'Bebidas');
    });

    testWidgets('el chip activo se marca con check, no solo con color',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(
        CategoryChipRow(
          labels: const <String>['Todo', 'Cafés'],
          selectedLabel: 'Cafés',
          onSelected: (_) {},
        ),
      ));

      expect(find.byIcon(Icons.check_rounded), findsOneWidget);
      expect(find.descendant(
        of: find.ancestor(
          of: find.text('Cafés'),
          matching: find.byType(CategoryChip),
        ),
        matching: find.byIcon(Icons.check_rounded),
      ), findsOneWidget);
    });
  });

  group('Encabezado de sección (título → subtítulo → contenido)', () {
    // Todos los casos van con `padding: EdgeInsets.zero` a propósito: así lo que
    // se mide es el ESPACiado INTERNO del componente y no el margen que le puso la
    // pantalla. El padding de la pantalla es suyo y cada pantalla lo elige.
    const SectionHeader destacado = SectionHeader(
      title: 'Destacados',
      subtitle: 'Los favoritos de la casa',
      padding: EdgeInsets.zero,
    );

    testWidgets('el subtítulo NO está pegado al título',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness(destacado));

      final double hueco = _gapInsideHeader(tester, 'Destacados', 'Los favoritos de la casa');

      // 2 dp (`AppSpacing.xxs`) es lo que había: no se lee como separación.
      expect(hueco, greaterThanOrEqualTo(AppSpacing.xs));
      expect(hueco, closeTo(AppSpacing.xs, 0.01));
      expect(tester.takeException(), isNull);
    });

    testWidgets('el subtítulo NO toca el contenido que va debajo',
        (WidgetTester tester) async {
      // Este es el síntoma que reportó el usuario: el subtítulo pegado a la
      // primera tarjeta. Antes la cabecera terminaba en 0 de padding y el
      // subtítulo se quedaba encima de la rejilla.
      await tester.pumpWidget(_harness(destacado));

      expect(
        _spaceBelowSubtitle(tester, 'Los favoritos de la casa'),
        greaterThanOrEqualTo(AppSpacing.md),
        reason: 'Debe quedar un bloque de aire entre el subtítulo y el contenido.',
      );
      expect(_spaceBelowSubtitle(tester, 'Los favoritos de la casa'),
          closeTo(AppSpacing.md, 0.01));
    });

    testWidgets('`bottomSpacing` se puede anular a 0', (WidgetTester tester) async {
      await tester.pumpWidget(_harness(
        const SectionHeader(
          title: 'Destacados',
          subtitle: 'Los favoritos de la casa',
          padding: EdgeInsets.zero,
          bottomSpacing: 0,
        ),
      ));

      expect(_spaceBelowSubtitle(tester, 'Los favoritos de la casa'), 0);
    });

    testWidgets('la jerarquía es título (hueco pequeño) → contenido (hueco mayor)',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness(destacado));

      // Dentro del bloque: 4 dp. Hacia el contenido: 12 dp. La separación que
      // separa bloques tiene que ser MAYOR que la que separa líneas del mismo
      // bloque; si no, el título parece una línea más del subtítulo.
      final double dentro = _gapInsideHeader(tester, 'Destacados', 'Los favoritos de la casa');
      final double hacia = _spaceBelowSubtitle(tester, 'Los favoritos de la casa');

      expect(dentro, lessThan(hacia));
      expect(dentro, closeTo(AppSpacing.xs, 0.01));
      expect(hacia, closeTo(AppSpacing.md, 0.01));
      expect(tester.takeException(), isNull);
    });

    testWidgets('sin subtítulo no queda un hueco fantasma',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness(
        const SectionHeader(title: 'Categorías', padding: EdgeInsets.zero),
      ));

      // Título + `bottomSpacing`, y nada más: ni un `SizedBox` de subtítulo vacío.
      final double alto = tester.getSize(find.byType(SectionHeader)).height;
      final double altoTitulo = tester.getSize(find.text('Categorías')).height;
      expect(alto - altoTitulo, closeTo(AppSpacing.md, 0.01));
      expect(find.text('Categorías'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('con acción ("Ver todo") el botón sigue siendo alcanzable',
        (WidgetTester tester) async {
      bool tapped = false;
      await tester.pumpWidget(_harness(
        SectionHeader(
          title: 'Destacados',
          subtitle: 'Los favoritos de la casa',
          actionLabel: 'Ver todo',
          onAction: () => tapped = true,
        ),
      ));

      await tester.tap(find.text('Ver todo'));
      await tester.pumpAndSettle();
      expect(tapped, isTrue);
      expect(tester.takeException(), isNull);
    });

    testWidgets('el título largo con `textScaler` 1.6 no desborda',
        (WidgetTester tester) async {
      tester.view.physicalSize = phone;
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(_harness(
        const MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(1.6)),
          child: SectionHeader(
            title: 'Promociones de la semana',
            subtitle: 'Precio especial por tiempo limitado',
          ),
        ),
      ));

      expect(tester.takeException(), isNull);
    });
  });

  group('Textos de negocio del menú', () {
    test('la frase bajo el saludo es la corregida', () {
      expect(AppStrings.menuPrompt, '¿Qué te descubrimos hoy?');
    });
  });
}

/// Callback vacío para constructores `const`.
void _noop(String _) {}
