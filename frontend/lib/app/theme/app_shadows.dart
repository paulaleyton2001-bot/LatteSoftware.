// Elevaciones (sombras) del sistema de diseño.
//
// La referencia visual usa sombras "difusas, apenas perceptibles": radios de
// blur grandes y opacidad baja. Nunca sombras duras ni negras al 100 %.


import 'package:flutter/material.dart';
import './app_colors.dart';
import './app_radii.dart';

/// Niveles de elevación. Se referencian siempre por nombre, nunca por índice.
enum AppElevation {
  /// level0 — sin sombra. Superficies planas (chips, tiles, celdas de tabla).
  level0,

  /// level1 — card outlined: sombra mínima que separa del fondo crema.
  level1,

  /// level2 — card elevada, menús, popovers.
  level2,

  /// level3 — sheets, dropdowns, FAB.
  level3,

  /// level4 — diálogos y modales.
  level4,
}

abstract final class AppShadows {
  static const List<BoxShadow> none = <BoxShadow>[];

  static const List<BoxShadow> level1 = <BoxShadow>[
    BoxShadow(
      color: AppPalette.shadow1,
      blurRadius: 8,
      offset: Offset(0, 2),
      spreadRadius: -2,
    ),
  ];

  static const List<BoxShadow> level2 = <BoxShadow>[
    BoxShadow(
      color: AppPalette.shadow2,
      blurRadius: 16,
      offset: Offset(0, 4),
      spreadRadius: -4,
    ),
  ];

  static const List<BoxShadow> level3 = <BoxShadow>[
    BoxShadow(
      color: AppPalette.shadow3,
      blurRadius: 24,
      offset: Offset(0, 8),
      spreadRadius: -6,
    ),
  ];

  static const List<BoxShadow> level4 = <BoxShadow>[
    BoxShadow(
      color: AppPalette.shadow4,
      blurRadius: 32,
      offset: Offset(0, 12),
      spreadRadius: -8,
    ),
  ];

  /// Resuelve la lista de sombras de un nivel.
  static List<BoxShadow> of(AppElevation elevation) => switch (elevation) {
        AppElevation.level0 => none,
        AppElevation.level1 => level1,
        AppElevation.level2 => level2,
        AppElevation.level3 => level3,
        AppElevation.level4 => level4,
      };

  /// Decoración lista para `Card`/`Material`: sombra + color + radio.
  static BoxDecoration decoration({
    required Color color,
    AppElevation elevation = AppElevation.level0,
    double radius = AppRadii.lg,
    Border? border,
  }) {
    return BoxDecoration(
      color: color,
      borderRadius: BorderRadius.circular(radius),
      boxShadow: of(elevation),
      border: border,
    );
  }
}
