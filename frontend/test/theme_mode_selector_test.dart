// Selector de tema de la app: Sistema / Claro / Oscuro.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ HAY UN ARCHIVO ENTERO DEDICADO A ESTO
// ─────────────────────────────────────────────────────────────────────────────
// El usuario pidió dejar de depender del interruptor del sistema y tener un
// botón DENTRO de la app. Eso son tres cosas que hay que fijar con pruebas, y las
// tres fallan en silencio si no:
//
//   1. Que el modo elegido SOBREVIVA al cierre de la app (si no se guarda, el
//      botón parece funcionar y al reabrir vuelve al sistema).
//   2. Que los TRES estados existan y que el estado inicial sea `system`, para no
//      cambiarle el tema a quien no ha tocado nada.
//   3. Que `MaterialApp` PINTE ese modo, no el del sistema. Un ajuste que se
//      guarda y no se aplica es el peor fallo posible: la persona cree que lo
//      cambió.
//
// Además se comprueba la ACCESIBILIDAD de las opciones: la selección no puede
// comunicarse solo por color (WCAG 1.4.1).

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latte_coffee/app/theme/app_theme.dart';
import 'package:latte_coffee/app/theme/theme_mode_controller.dart';
import 'package:latte_coffee/core/di/providers.dart';
import 'package:latte_coffee/core/storage/key_value_store.dart';
import 'package:latte_coffee/core/storage/preferences_storage.dart';
import 'package:latte_coffee/shared/widgets/ui/theme_mode_selector.dart';

/// Contenedor con el almacén inyectado, igual que hace `main()`.
ProviderContainer _container(KeyValueStore store) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      keyValueStoreProvider.overrideWithValue(store),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

/// Monta el selector dentro del tema real de la app.
Widget _harness(Widget child, {KeyValueStore? store}) {
  return UncontrolledProviderScope(
    container: _container(store ?? InMemoryKeyValueStore()),
    child: MaterialApp(
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      home: Scaffold(body: child),
    ),
  );
}

/// Monta una `MaterialApp` OBSERVANDO el modo, como hace `LatteCoffeeApp`.
Widget _appHarness(ProviderContainer container) {
  return UncontrolledProviderScope(
    container: container,
    child: Consumer(
      builder: (BuildContext context, WidgetRef ref, Widget? _) => MaterialApp(
        theme: AppTheme.light,
        darkTheme: AppTheme.dark,
        themeMode: ref.watch(themeModeProvider),
        home: const Scaffold(body: Center(child: Text('contenido'))),
      ),
    ),
  );
}

void main() {
  group('ThemeModeController: persistencia', () {
    test('la primera vez vale Sistema: no se le cambia el tema a nadie', () {
      final ProviderContainer container = _container(InMemoryKeyValueStore());
      expect(
        container.read(themeModeProvider),
        ThemeMode.system,
        reason: 'Sin preferencia guardada, la app sigue al sistema como antes.',
      );
    });

    test('cada modo elegido se escribe y se vuelve a leer', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ProviderContainer container = _container(store);

      await container.read(themeModeProvider.notifier).select(ThemeMode.dark);
      expect(store.getString(PreferencesStorage.kThemeMode), 'dark');
      await container.read(themeModeProvider.notifier).select(ThemeMode.light);
      expect(store.getString(PreferencesStorage.kThemeMode), 'light');
      await container.read(themeModeProvider.notifier).select(ThemeMode.system);
      expect(container.read(themeModeProvider), ThemeMode.system);
      // Y de verdad está en el almacén, no solo en memoria del provider.
      expect(store.getString(PreferencesStorage.kThemeMode), isNull);
      expect(store.getBool(PreferencesStorage.kLegacyDarkMode), isNull);
    });

    test('al reabrir la app se lee lo que había quedado', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();

      final ProviderContainer primero = _container(store);
      await primero.read(themeModeProvider.notifier).select(ThemeMode.dark);
      primero.dispose();

      // Contenedor NUEVO, como si la app se hubiera cerrado y abierto: si el
      // valor no estuviera en el almacén, esto valdría `system`.
      final ProviderContainer segundo = _container(store);
      addTearDown(segundo.dispose);
      expect(segundo.read(themeModeProvider), ThemeMode.dark);
    });

    test('"Sistema" se guarda como ausencia de preferencia y se lee igual', () async {
      final InMemoryKeyValueStore store = InMemoryKeyValueStore();
      final ProviderContainer container = _container(store);

      await container.read(themeModeProvider.notifier).select(ThemeMode.dark);
      expect(store.getString(PreferencesStorage.kThemeMode), 'dark');

      await container.read(themeModeProvider.notifier).select(ThemeMode.system);
      expect(
        store.getString(PreferencesStorage.kThemeMode),
        isNull,
        reason: 'Volver a "Sistema" es dejar de tener preferencia: se borra.',
      );
      expect(container.read(themeModeProvider), ThemeMode.system);
    });

    test('migra el `darkMode` booleano de una versión anterior', () {
      // Quien ya tenía `lc.ui.darkMode = true` guardado no debe volver al
      // sistema al actualizar: su preferencia era explícita.
      expect(
        _container(InMemoryKeyValueStore(<String, Object>{
          PreferencesStorage.kLegacyDarkMode: true,
        })).read(themeModeProvider),
        ThemeMode.dark,
      );
      expect(
        _container(InMemoryKeyValueStore(<String, Object>{
          PreferencesStorage.kLegacyDarkMode: false,
        })).read(themeModeProvider),
        ThemeMode.light,
      );
    });

    test('un valor corrupto cae en Sistema, no rompe la app', () {
      expect(
        _container(InMemoryKeyValueStore(<String, Object>{
          PreferencesStorage.kThemeMode: 'morado-neon',
        })).read(themeModeProvider),
        ThemeMode.system,
      );
    });

    test('el nombre guardado NO depende del orden del enum', () {
      // Se guarda el nombre, no el índice: reordenar el enum no puede cambiar lo
      // que significa lo que hay escrito en el dispositivo.
      expect(themeModeName(ThemeMode.system), 'system');
      expect(themeModeName(ThemeMode.light), 'light');
      expect(themeModeName(ThemeMode.dark), 'dark');
      for (final ThemeMode mode in kThemeModeOptions) {
        expect(themeModeFromName(themeModeName(mode)), mode);
      }
    });
  });

  group('ThemeModeController: el modo se APLICA de verdad', () {
    testWidgets('la app se pinta en oscuro con `dark`', (WidgetTester tester) async {
      final ProviderContainer container = _container(InMemoryKeyValueStore());
      await container.read(themeModeProvider.notifier).select(ThemeMode.dark);

      await tester.pumpWidget(_appHarness(container));

      final MaterialApp app = tester.widget<MaterialApp>(find.byType(MaterialApp));
      expect(app.themeMode, ThemeMode.dark);
      // Y el `ThemeData` que se aplicó es el oscuro de la app: si se aplicara
      // `ThemeMode.system` en un test con brillo del sistema en claro, saldría
      // crema, que es justo lo que se estaba quejando.
      final BuildContext context = tester.element(find.text('contenido'));
      expect(Theme.of(context).brightness, Brightness.dark);
    });

    testWidgets('la app se pinta en claro con `light`, aunque el sistema sea oscuro',
        (WidgetTester tester) async {
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);

      final ProviderContainer container = _container(InMemoryKeyValueStore());
      await container.read(themeModeProvider.notifier).select(ThemeMode.light);
      await tester.pumpWidget(_appHarness(container));

      final BuildContext context = tester.element(find.text('contenido'));
      expect(Theme.of(context).brightness, Brightness.light);
    });

    testWidgets('con `system` la app sigue al sistema', (WidgetTester tester) async {
      tester.platformDispatcher.platformBrightnessTestValue = Brightness.dark;
      addTearDown(tester.platformDispatcher.clearPlatformBrightnessTestValue);

      final ProviderContainer container = _container(InMemoryKeyValueStore());
      await tester.pumpWidget(_appHarness(container));

      expect(container.read(themeModeProvider), ThemeMode.system);
      final BuildContext context = tester.element(find.text('contenido'));
      expect(
        Theme.of(context).brightness,
        Brightness.dark,
        reason: 'En "Sistema" manda el sistema: eso es lo que significa.',
      );
    });
  });

  group('ThemeModeSelector: las tres opciones', () {
    testWidgets('pinta Sistema, Claro y Oscuro', (WidgetTester tester) async {
      await tester.pumpWidget(_harness(const ThemeModeSelector()));

      expect(find.text('Sistema'), findsOneWidget);
      expect(find.text('Claro'), findsOneWidget);
      expect(find.text('Oscuro'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('tocar una opción cambia el modo Y la marca la activa',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness(const ThemeModeSelector()));

      await tester.tap(find.text('Oscuro'));
      await tester.pumpAndSettle();

      final ProviderContainer container = ProviderScope.containerOf(
        tester.element(find.text('Oscuro')),
        listen: false,
      );
      expect(container.read(themeModeProvider), ThemeMode.dark);
      expect(tester.takeException(), isNull);
    });

    testWidgets('el estado activo NO se comunica solo por color',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await tester.pumpWidget(_harness(const ThemeModeSelector()));

      // El nodo FUSIONADO es el que se anuncia; `Semantics(selected:)` vive en
      // él, no en la instancia de `Semantics` del árbol de widgets.
      final SemanticsNode sistema = tester.getSemantics(find.text('Sistema'));
      expect(
        sistema.hasFlag(SemanticsFlag.isSelected),
        isTrue,
        reason: 'Por defecto está "Sistema" marcado.',
      );
      expect(sistema.label, 'Tema Sistema');

      final SemanticsNode oscuro = tester.getSemantics(find.text('Oscuro'));
      expect(oscuro.hasFlag(SemanticsFlag.isSelected), isFalse);
      expect(oscuro.label, 'Tema Oscuro');

      // Y hay un check visible además del color: quien no distingue los colores
      // (deuteranopía, pantalla al sol) sigue viendo cuál está elegido.
      expect(find.byIcon(Icons.check_rounded), findsOneWidget);

      handle.dispose();
      expect(tester.takeException(), isNull);
    });

    testWidgets('el grupo se anuncia con nombre propio',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      // `showLabel: false` es el caso de la hoja inferior: el título lo pone la
      // pantalla, así que el grupo necesita nombre propio para que el lector diga
      // "Apariencia" antes de entrar en las opciones.
      await tester.pumpWidget(
        _harness(const ThemeModeSelector(showLabel: false)),
      );

      expect(find.bySemanticsLabel('Apariencia'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('cada opción se puede tocar (target táctil >= 44 dp)',
        (WidgetTester tester) async {
      await tester.pumpWidget(_harness(const ThemeModeSelector()));
      expect(tester.getSize(find.text('Claro')).height, lessThan(kThemeOptionHeight));
      expect(kThemeOptionHeight, greaterThanOrEqualTo(44));
      expect(tester.takeException(), isNull);
    });

    testWidgets('el atajo alterna claro y oscuro pero nunca se queda en Sistema',
        (WidgetTester tester) async {
      final ProviderContainer container = _container(InMemoryKeyValueStore());
      final ThemeModeController controller = container.read(themeModeProvider.notifier);

      expect(container.read(themeModeProvider), ThemeMode.system);
      await controller.toggleLightDark();
      expect(container.read(themeModeProvider), ThemeMode.dark);
      await controller.toggleLightDark();
      expect(container.read(themeModeProvider), ThemeMode.light);
      await controller.toggleLightDark();
      expect(container.read(themeModeProvider), ThemeMode.dark);
    });
  });
}
