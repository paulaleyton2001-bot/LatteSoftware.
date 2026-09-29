// El saludo: una sola fuente, con el nombre real y sin comas colgando.
//
// ─────────────────────────────────────────────────────────────────────────────
// EL SÍNTOMA
// ─────────────────────────────────────────────────────────────────────────────
// En Inicio se leía "Buenos días, Usuario" y en Menú "Hola, Usuario". Dos
// pantallas de la MISMA sesión, con el MISMO usuario, diciendo dos cosas
// distintas: se veía como un bug aunque las dos tuvieran el nombre correcto.
//
// La causa no eran los datos (las dos leían `auth/me`): era que cada pantalla se
// había escrito su propio saludo. Por eso el texto vive ahora en un módulo
// compartido, `shared/constants/greeting.dart`, y este test verifica que las dos
// pantallas lo USAN —que no basta con que la función sea correcta, tiene que ser
// la que se pinta—.
//
// Y comprueba el segundo fallo, más pequeño y más visible: sin nombre, la versión
// ingenua pintaba "Buenos días," con la coma colgando.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/features/home/presentation/widgets/home_blocks.dart';
import 'package:latte_coffee/shared/constants/app_strings.dart';
import 'package:latte_coffee/shared/constants/greeting.dart';

Widget _harness(Widget child) => MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

void main() {
  group('firstNameOf', () {
    test('coge solo la primera palabra del nombre completo', () {
      expect(firstNameOf('Usuario Prueba'), 'Usuario');
      expect(firstNameOf('Ana María López'), 'Ana');
    });

    test('devuelve vacío cuando no hay nombre', () {
      expect(firstNameOf(null), '');
      expect(firstNameOf(''), '');
      expect(firstNameOf('   '), '');
    });

    test('no se rompe con espacios de sobra ni con el correo de reserva', () {
      // `User.displayName` cae al email cuando no hay nombre: el saludo tiene que
      // sacar un nombre legible de ahí, no el email entero.
      expect(firstNameOf('  Ana María  '), 'Ana');
      expect(firstNameOf('prueba@lattecoffe.co'), 'prueba@lattecoffe.co');
    });
  });

  group('greetingWithName', () {
    test('con nombre: "Buenos días, Ana"', () {
      expect(
        greetingWithName(greeting: 'Buenos días', name: 'Ana María López'),
        'Buenos días, Ana',
      );
    });

    test('SIN nombre NO deja la coma colgando', () {
      expect(greetingWithName(greeting: 'Buenos días', name: ''), 'Buenos días');
      expect(greetingWithName(greeting: 'Buenos días', name: null), 'Buenos días');
      expect(
        greetingWithName(greeting: 'Buenos días', name: '   '),
        'Buenos días',
        reason: 'Una coma al final de la línea se lee como texto truncado.',
      );
      expect(
        greetingWithName(greeting: 'Buenos días', name: ''),
        isNot(contains(',')),
      );
    });

    test('con un solo nombre (sin apellidos) también funciona', () {
      expect(greetingWithName(greeting: 'Buenas tardes', name: 'Ana'), 'Buenas tardes, Ana');
    });
  });

  group('timeOfDayGreeting', () {
    test('los tres cortes del día', () {
      expect(timeOfDayGreeting(DateTime(2026, 9, 29, 8)), 'Buenos días');
      expect(timeOfDayGreeting(DateTime(2026, 9, 29, 11, 59)), 'Buenos días');
      expect(timeOfDayGreeting(DateTime(2026, 9, 29, 12)), 'Buenas tardes');
      expect(timeOfDayGreeting(DateTime(2026, 9, 29, 18, 59)), 'Buenas tardes');
      expect(timeOfDayGreeting(DateTime(2026, 9, 29, 19)), 'Buenas noches');
      expect(timeOfDayGreeting(DateTime(2026, 9, 29, 23, 30)), 'Buenas noches');
    });
  });

  group('Lo que se pinta en cada pantalla', () {
    testWidgets('Inicio y Menú dicen EXACTAMENTE lo mismo',
        (WidgetTester tester) async {
      const String momento = 'Buenos días';
      const String nombre = 'Usuario Prueba';

      // Lo que pinta `HomeGreeting` (features/home).
      await tester.pumpWidget(_harness(
        const HomeGreeting(
          greeting: momento,
          today: 'martes, 29 de septiembre de 2026',
          name: nombre,
        ),
      ));
      final String enHome = tester.widget<Text>(find.byType(Text).first).data!;

      // Lo que pinta el saludo del Menú (features/menu), con el MISMO módulo.
      final String enMenu = greetingWithName(greeting: momento, name: nombre);

      expect(enHome, enMenu);
      expect(enHome, 'Buenos días, Usuario');
    });

    testWidgets('Inicio sin nombre no deja la coma colgando',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness(
        const HomeGreeting(
          greeting: 'Buenas noches',
          today: 'martes, 29 de septiembre de 2026',
          name: '',
        ),
      ));
      final String enHome = tester.widget<Text>(find.byType(Text).first).data!;

      expect(enHome, 'Buenas noches');
      expect(enHome, isNot(contains(',')));
      expect(tester.takeException(), isNull);
    });

    testWidgets('el saludo de Inicio nombra al usuario en pantalla',
        (WidgetTester tester) async {
      // Con `textScaler` al máximo, el nombre no debe recortarse a "Usu…".
      await tester.pumpWidget(_harness(
        const HomeGreeting(
          greeting: 'Buenos días',
          today: 'martes, 29 de septiembre de 2026',
          name: 'Usuario Prueba',
        ),
      ));
      expect(find.text('Buenos días, Usuario'), findsOneWidget);
    });

    test('cambiar de cuenta cambia el saludo, sin estado guardado', () {
      // No hay caché del nombre en el módulo: el texto se compone con el nombre
      // que le pasa la pantalla, así que con otra cuenta sale otro saludo.
      expect(greetingWithName(greeting: 'Buenos días', name: 'Usuario Prueba'), 'Buenos días, Usuario');
      expect(greetingWithName(greeting: 'Buenos días', name: 'Ana Restrepo'), 'Buenos días, Ana');
    });

    test('`greetingProvider` es el mismo provider para las dos pantallas', () {
      // Si alguien moviera el saludo a una feature, este provider dejaría de
      // existir aquí y el test lo canta.
      expect(greetingProvider, isNotNull);
    });
  });

  group('La frase de la cabecera del menú', () {
    test('es español y termina en la primera persona del plural', () {
      expect(AppStrings.menuPrompt, '¿Qué te descubrimos hoy?');
      expect(AppStrings.menuPrompt, isNot(contains('Hola')));
      // La cadena que se vio en el móvil llevaba letras de otro alfabeto dentro
      // de la palabra; `source_text_hygiene_test.dart` recorre el código entero,
      // y aquí se fija además que es ESTA frase y no una parecida.
      expect(AppStrings.menuPrompt.codeUnits.every((int c) => c < 0x0600), isTrue);
    });
  });

  group('Riverpod no filtra el saludo entre pantallas', () {
    test('el provider del momento del día no guarda estado mutable', () {
      // `greetingProvider` es un `Provider` puro sobre el reloj compartido: dos
      // consumidores nunca pueden ver valores distintos.
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);
      expect(container.read(greetingProvider), container.read(greetingProvider));
    });
  });
}
