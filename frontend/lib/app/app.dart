// Raíz de la aplicación.
//
// Aplica el tema (claro/oscuro según el sistema) y el `GoRouter`. Es el único
// lugar donde se decide `MaterialApp.router`; las pantallas no tocan el tema
// global más que para leer tokens del contexto.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../app/theme/app_theme.dart';
import 'router.dart';

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
      // Sigue la preferencia del sistema. Cuando exista el toggle de tema en
      // Perfil, se cambia a `ThemeMode` desde un provider.
      themeMode: ThemeMode.system,
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
