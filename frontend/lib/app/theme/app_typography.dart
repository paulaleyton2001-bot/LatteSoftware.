// Escala tipográfica de "Latte Coffee".

import 'package:flutter/material.dart';
//
// Decisión: se usa la familia sans-serif del sistema (Roboto en Android/Linux,
// SF Pro en iOS/macOS, Segoe UI en Windows) declarada una sola vez en
// `AppTheme` con `fontFamily: null` + `Typography.material2021`. NO se cargan
// Google Fonts: una fuente remota añade una petición de red crítica en el
// LCP, falla en modo offline y complica el renderizado nativo de Flutter.
//
// Si más adelante se decide una marca tipográfica propia, el punto de cambio
// único es [AppTypography.fontFamily] + [AppTheme.build]; ningún widget
// declara `fontFamily` ni `TextStyle` sueltas.


/// Estilos tipográficos de uso frecuente, expuestos como `const`.
abstract final class AppTextStyles {
  // ------------------------------------------------------------------ Display
  /// Hero / cifras enormes (p. ej. temporizador de silla, total del checkout).
  static const TextStyle displayLarge = TextStyle(
    fontSize: 40,
    height: 1.10,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.8,
  );

  static const TextStyle displayMedium = TextStyle(
    fontSize: 32,
    height: 1.15,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.5,
  );

  /// Números de KPI del dashboard.
  static const TextStyle displaySmall = TextStyle(
    fontSize: 28,
    height: 1.20,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.4,
  );

  // ----------------------------------------------------------------- Headline
  static const TextStyle headlineLarge = TextStyle(
    fontSize: 26,
    height: 1.20,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.3,
  );

  static const TextStyle headlineMedium = TextStyle(
    fontSize: 22,
    height: 1.25,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.2,
  );

  /// Título de página / card destacada.
  static const TextStyle headlineSmall = TextStyle(
    fontSize: 19,
    height: 1.30,
    fontWeight: FontWeight.w700,
  );

  // -------------------------------------------------------------------- Title
  /// Título de card de producto / de sección.
  static const TextStyle titleLarge = TextStyle(
    fontSize: 17,
    height: 1.35,
    fontWeight: FontWeight.w700,
  );

  static const TextStyle titleMedium = TextStyle(
    fontSize: 15,
    height: 1.40,
    fontWeight: FontWeight.w600,
  );

  /// Header de columna / campo de formulario.
  static const TextStyle titleSmall = TextStyle(
    fontSize: 13,
    height: 1.40,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
  );

  // --------------------------------------------------------------------- Body
  static const TextStyle bodyLarge = TextStyle(
    fontSize: 16,
    height: 1.50,
    fontWeight: FontWeight.w400,
  );

  /// Cuerpo por defecto de la app (descripciones, notas, párrafos).
  static const TextStyle bodyMedium = TextStyle(
    fontSize: 14,
    height: 1.50,
    fontWeight: FontWeight.w400,
  );

  static const TextStyle bodySmall = TextStyle(
    fontSize: 13,
    height: 1.45,
    fontWeight: FontWeight.w400,
  );

  // -------------------------------------------------------------------- Label
  /// Etiqueta de chip, botón, tab.
  static const TextStyle labelLarge = TextStyle(
    fontSize: 14,
    height: 1.25,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.1,
  );

  static const TextStyle labelMedium = TextStyle(
    fontSize: 12,
    height: 1.20,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.2,
  );

  /// Labels en MAYÚSCULAS de tablas admin (tracking amplio).
  static const TextStyle labelSmall = TextStyle(
    fontSize: 11,
    height: 1.20,
    fontWeight: FontWeight.w600,
    letterSpacing: 0.6,
  );

  // ------------------------------------------------------------------ Caption
  /// Texto auxiliar bajo un campo, timestamps, pies de tabla.
  static const TextStyle captionMedium = TextStyle(
    fontSize: 12,
    height: 1.35,
    fontWeight: FontWeight.w400,
  );

  /// Caption de baja importance (no esencial: tolera 3:1 de contraste).
  static const TextStyle captionSmall = TextStyle(
    fontSize: 11,
    height: 1.30,
    fontWeight: FontWeight.w400,
  );

  // ------------------------------------------------------------------ Especiales
  /// Timer de silla: `02:24:41`. Monoespaciada del sistema + tabular figures.
  static const TextStyle timerLarge = TextStyle(
    fontSize: 34,
    height: 1.10,
    fontWeight: FontWeight.w700,
    letterSpacing: 1.5,
    fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
  );

  /// Timer compacto en cards del mapa.
  static const TextStyle timerMedium = TextStyle(
    fontSize: 18,
    height: 1.20,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.8,
    fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
  );

  /// Precio normal de producto (`$5.000`).
  static const TextStyle price = TextStyle(
    fontSize: 15,
    height: 1.25,
    fontWeight: FontWeight.w700,
    fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
  );

  /// Precio grande (detalle de producto, total del checkout).
  static const TextStyle priceLarge = TextStyle(
    fontSize: 24,
    height: 1.20,
    fontWeight: FontWeight.w700,
    fontFeatures: <FontFeature>[FontFeature.tabularFigures()],
  );

  /// Título del hero (panel marrón). SIN color: el que se pinte decide el del
  /// texto y lo toma de `AppTokens.heroTitle`. Antes iba crema fija
  /// (`#F5EFE6` / `#D8CCBE`) dentro del propio `TextStyle`, así que se aplicaba
  /// en los DOS modos: en claro lavaba el hero y en oscuro era un parche que
  /// no se correspondía con ningún otro texto de la app.
  static const TextStyle heroTitle = TextStyle(
    fontSize: 24,
    height: 1.20,
    fontWeight: FontWeight.w700,
  );

  /// Subtítulo del hero. Mismo criterio que [heroTitle]: sin color fijo.
  static const TextStyle heroSubtitle = TextStyle(
    fontSize: 14,
    height: 1.40,
    fontWeight: FontWeight.w400,
  );
}

/// Construye el [TextTheme] completo de la app.
///
/// `base` normalmente es `Typography.material2021().black` o el `TextTheme`
/// del tema base; se usa como origen para no perder estilos de Material.
TextTheme buildAppTextTheme(TextTheme base) {
  return base.copyWith(
    displayLarge: AppTextStyles.displayLarge,
    displayMedium: AppTextStyles.displayMedium,
    displaySmall: AppTextStyles.displaySmall,
    headlineLarge: AppTextStyles.headlineLarge,
    headlineMedium: AppTextStyles.headlineMedium,
    headlineSmall: AppTextStyles.headlineSmall,
    titleLarge: AppTextStyles.titleLarge,
    titleMedium: AppTextStyles.titleMedium,
    titleSmall: AppTextStyles.titleSmall,
    bodyLarge: AppTextStyles.bodyLarge,
    bodyMedium: AppTextStyles.bodyMedium,
    bodySmall: AppTextStyles.bodySmall,
    labelLarge: AppTextStyles.labelLarge,
    labelMedium: AppTextStyles.labelMedium,
    labelSmall: AppTextStyles.labelSmall,
  );
}
