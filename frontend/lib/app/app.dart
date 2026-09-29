// Raíz de la aplicación.
//
// Aplica el tema (claro/oscuro según la preferencia guardada) y el `GoRouter`.
// Es el único lugar donde se decide `MaterialApp.router`; las pantallas no tocan
// el tema global más que para leer tokens del contexto.
//
// El `themeMode` NO es `ThemeMode.system` fijo: lo decide `themeModeProvider`
// (`theme/theme_mode_controller.dart`), que expone los tres estados —Sistema,
// Claro y Oscuro— y los persiste en `PreferencesStorage`.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import './router.dart';
import './theme/app_theme.dart';
import './theme/theme_mode_controller.dart';

/// Aplicación Latte Coffee.
class LatteCoffeeApp extends ConsumerWidget {
  const LatteCoffeeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Latte Coffee',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      // Lo elige la persona en Perfil → Apariencia (Sistema / Claro / Oscuro) y
      // se persiste en `PreferencesStorage`. Antes era `ThemeMode.system` fijo.
      themeMode: ref.watch(themeModeProvider),
      routerConfig: router,
      builder: (BuildContext context, Widget? child) {
        // Fija el tamaño base del texto dentro de los límites de accesibilidad:
        // por debajo de 0.85 el layout de tablas se rompe; por encima de 1.6
        // los cards de producto desbordan.
        final media = MediaQuery.of(context);
        return MediaQuery(
          data: media.copyWith(
            textScaler: media.textScaler.clamp(
              minScaleFactor: 0.85,
              maxScaleFactor: 1.6,
            ),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
