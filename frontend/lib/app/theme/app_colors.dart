// Paleta del sistema de diseño "Latte Coffee".
//
// Este archivo es el ÚNICO lugar donde se definen colores literales de la app.
// Ningún otro archivo debe escribir un `Color(0x...)` o un hex hardcodeado:
// se importa `AppColors` y se usa el token semántico.
//
// Los valores se calibraron contra WCAG 2.1 AA (ver docs/DESIGN-TOKENS.md §1.4
// para la tabla completa de contraste verificada).
//
// REGLA CRÍTICA: el verde salvia `#7FBF9A` es el acento de marca (gráficos,
// logo, ilustraciones, hover), pero NO cumple AA con texto blanco encima
// (ratio 2.14). Para superficies rellenas con texto se usa `actionPrimary`
// `#2F7D57` (ratio 5.01 con blanco).
library;

import 'package:flutter/material.dart';

/// Tokens de color literales de la paleta.
///
/// Se mantienen privados por diseño: el código de aplicación debe consumir los
/// ensembles de [AppColors] / [AppStateColors] / [AppChartColors], no un hex suelto.
abstract final class AppPalette {
  // ---------------------------------------------------------------- Neutros cálidos
  /// Fondo de la aplicación (crema muy claro). `bg.app`
  static const Color background = Color(0xFFFAF8F4);
  /// Superficie alternativa crema (chips inactivos, filas de tabla). `bg.surface`
  static const Color surfaceMuted = Color(0xFFF7F3EC);
  /// Superficie hundida (skeletons, campos deshabilitados, cabeceras). `bg.sunken`
  static const Color surfaceSunken = Color(0xFFF1EADF);
  /// Superficie principal (cards, sheets, diálogos).
  static const Color surface = Color(0xFFFFFFFF);

  /// Borde hairline por defecto (cards outlined, separadores). `border.subtle`
  static const Color borderSubtle = Color(0xFFEDE7DE);
  /// Borde de card outlined y de chip: 1.67:1 sobre blanco. Decorativo; la
  /// card apoya la separación en la sombra y el chip en su relleno. `border.default`
  static const Color borderDefault = Color(0xFFD2C7B7);
  /// Borde de input en reposo (1.67:1). Todo input tiene etiqueta visible, que
  /// es lo que lo identifica; el borde refuerza, no informa. `border.input`
  static const Color borderInput = Color(0xFFC2B4A0);
  /// Borde de control identificable SOLO por su borde (checkbox, radio, switch):
  /// 3.86:1 en blanco. Cumple WCAG 1.4.11. `border.strong`
  static const Color borderStrong = Color(0xFF8A8078);

  // ------------------------------------------------------------------------- Tinta
  /// Texto principal / títulos / números KPI. `text.primary` (13.37:1 en blanco)
  static const Color ink = Color(0xFF3B2C23);
  /// Espresso 700: subtítulos de alto peso, hover de la tinta. `text.strong`
  static const Color inkStrong = Color(0xFF4A382C);
  /// Texto secundario legible (AA 5.70:1 en blanco). `text.secondary`
  static const Color textSecondary = Color(0xFF6E655D);
  /// Gris cálido 600 (4.83:1 en blanco). Solo texto grande o no esencial.
  static const Color textTertiary = Color(0xFF7A7069);
  /// Gris cálido claro de la referencia (3.86:1). Decorativo / no esencial.
  static const Color textMuted = Color(0xFF8A8078);
  /// Texto e iconos deshabilitados (2.52:1 en blanco — exento por WCAG 1.4.3,
  /// pero nunca debe ser el único portador de información).
  static const Color textDisabled = Color(0xFFA9A29A);
  /// Texto sobre un control primario deshabilitado (3.14:1 sobre su fondo).
  static const Color textOnDisabled = Color(0xFF6B7A70);

  /// Color de las barras de foco/selección de inputs.
  static const Color focusRing = Color(0xFF2F7D57);

  // ------------------------------------------------------------------ Verdes marca
  /// Salvia 300: acentos, gráficos, hover suave. `brand.sageLight`
  static const Color sageLight = Color(0xFF8FC9A8);
  /// Salvia 400: acento de marca puro. `brand.sage` (NO usar con texto blanco)
  static const Color sage = Color(0xFF7FBF9A);
  /// Salvia 600: pressed de acentos, bordes verdes. `brand.sageDark`
  static const Color sageDark = Color(0xFF5E9B79);

  /// Verde 700 — fondo del botón primario, tabs activas. `action.primary` (AA con blanco)
  static const Color green700 = Color(0xFF2F7D57);
  /// Verde 800 — pressed del botón primario.
  static const Color green800 = Color(0xFF2A6B4A);
  /// Verde 900 — texto/hover verde sobre superficie verde.
  static const Color green900 = Color(0xFF1F5A3E);
  /// Verde 950 — texto verde AA sobre superficie clara.
  static const Color green950 = Color(0xFF1F5A3E);
  /// Superficie verde muy clara (chips activos, badges info). `surface.greenSubtle`
  static const Color greenSubtle = Color(0xFFE4F1E9);
  /// Superficie verde media (chips activos hover, realce). `surface.greenMuted`
  static const Color greenMuted = Color(0xFFD3E9DD);

  // ------------------------------------------------------------------------- Hero
  /// Panel marrón espresso (hero POS, banners). `hero.panel`
  static const Color espresso = Color(0xFF3B2C23);
  /// Overlay del gradiente del hero (gradiente espresso → espresso70).
  static const Color espresso70 = Color(0xFF6B584A);

  // ------------------------------------------------------------------------ Estado
  /// Rojo suave de la referencia — indicadores/gráficos, NO texto. `state.error`
  static const Color errorSoft = Color(0xFFE88B8B);
  /// Rojo 700 de acción (botón danger). `action.danger`
  static const Color errorDark = Color(0xFFB3261E);
  /// Rojo 800 para texto sobre superficie roja. `text.error`
  static const Color errorText = Color(0xFF8C2F22);
  /// Superficie roja diluida (badges, error banners). `surface.errorSubtle`
  static const Color errorSubtle = Color(0xFFFBE9E6);

  /// Naranja suave de la referencia (warning/ocupado). `state.warning`
  static const Color warningSoft = Color(0xFFE8B87B);
  /// Naranja 700 de acción. `action.warning`
  static const Color warningDark = Color(0xFF9A6114);
  /// Texto warning sobre superficie diluida (6.63:1). `text.warning`
  static const Color warningText = Color(0xFF7A4A18);
  /// Superficie naranja diluida. `surface.warningSubtle`
  static const Color warningSubtle = Color(0xFFFCF0E2);

  /// Verde de éxito (chart success, KPIs positivos). `state.success`
  static const Color success = Color(0xFF2F7D57);
  /// Superficie éxito diluida. `surface.successSubtle`
  static const Color successSubtle = Color(0xFFDFF2E7);

  /// Azul de información / reserva. `state.info`
  static const Color info = Color(0xFF2B4C8C);
  /// Superficie azul diluida. `surface.infoSubtle`
  static const Color infoSubtle = Color(0xFFE7ECFA);

  /// Violeta de limpieza. `state.cleaning`
  static const Color cleaning = Color(0xFF5F3E8E);
  /// Superficie violeta diluida. `surface.cleaningSubtle`
  static const Color cleaningSubtle = Color(0xFFF0E9FB);
}

/// Colores semánticos de la interfaz.
///
/// Cualquier widget de la app debe leer de aquí, nunca de [AppPalette].
abstract final class AppColors {
  // ---------------------------------------------------------------------- Fondos
  static const Color background = AppPalette.background;
  static const Color surfaceMuted = AppPalette.surfaceMuted;
  static const Color surfaceSunken = AppPalette.surfaceSunken;
  static const Color surface = AppPalette.surface;

  // ------------------------------------------------------------------- Texto/iconos
  static const Color textPrimary = AppPalette.ink;
  static const Color textStrong = AppPalette.inkStrong;
  static const Color textSecondary = AppPalette.textSecondary;
  static const Color textTertiary = AppPalette.textTertiary;
  static const Color textMuted = AppPalette.textMuted;
  static const Color textDisabled = AppPalette.textDisabled;
  static const Color textOnDisabled = AppPalette.textOnDisabled;
  static const Color textOnDark = Color(0xFFF5EFE6);

  // -------------------------------------------------------------------- Superficies
  static const Color surfaceGreenSubtle = AppPalette.greenSubtle;
  static const Color surfaceGreenMuted = AppPalette.greenMuted;
  static const Color surfaceErrorSubtle = AppPalette.errorSubtle;
  static const Color surfaceWarningSubtle = AppPalette.warningSubtle;
  static const Color surfaceSuccessSubtle = AppPalette.successSubtle;
  static const Color surfaceInfoSubtle = AppPalette.infoSubtle;
  static const Color surfaceCleaningSubtle = AppPalette.cleaningSubtle;

  // --------------------------------------------------------------------- Acciones
  /// Fondo del botón primario. Verde 700 (AA 5.01:1 con blanco).
  static const Color actionPrimary = AppPalette.green700;
  static const Color actionPrimaryHover = Color(0xFF357F5C);
  static const Color actionPrimaryPressed = AppPalette.green800;
  static const Color onActionPrimary = Color(0xFFFFFFFF);
  /// Primario deshabilitado. `onActionPrimaryDisabled` da 3.14:1 (legible
  /// sin competir con el control habilitado).
  static const Color actionPrimaryDisabled = Color(0xFFC7DCCF);
  static const Color onActionPrimaryDisabled = Color(0xFF6B7A70);

  /// CTA de alto peso (espresso). AA 13.37:1 con blanco.
  static const Color actionEspresso = AppPalette.espresso;
  static const Color actionEspressoHover = Color(0xFF4A382C);
  static const Color actionEspressoPressed = Color(0xFF2A1F18);

  static const Color actionDanger = AppPalette.errorDark;
  static const Color actionDangerHover = Color(0xFF9E1F19);
  static const Color actionDangerPressed = Color(0xFF7F1812);

  // Estados deshabilitados. Cada par (fondo, texto) tiene >= 3:1 para que un
  // control deshabilitado siga siendo legible sin competir con el habilitado.
  static const Color actionPrimaryDisabledText = AppPalette.textOnDisabled;
  static const Color actionDangerDisabled = Color(0xFFEFDCD8);
  static const Color actionDangerDisabledText = Color(0xFF6B4A44);
  static const Color actionEspressoDisabled = Color(0xFFDED2C5);
  static const Color actionEspressoDisabledText = AppPalette.ink;

  // ---------------------------------------------------------------------- Marca
  static const Color brand = AppPalette.sage;
  static const Color brandLight = AppPalette.sageLight;
  static const Color brandDark = AppPalette.sageDark;

  // ------------------------------------------------------------------- Bordes/foco
  static const Color borderSubtle = AppPalette.borderSubtle;
  static const Color borderDefault = AppPalette.borderDefault;
  static const Color borderInput = AppPalette.borderInput;
  static const Color borderStrong = AppPalette.borderStrong;
  static const Color divider = AppPalette.borderSubtle;
  static const Color focusRing = AppPalette.focusRing;
  static const Color focusRingSurface = Color(0x3377C79B);

  // ------------------------------------------------------------------------- Hero
  static const Color heroPanel = AppPalette.espresso;
  static const Color heroOverlay = AppPalette.espresso70;

  // ---------------------------------------------------------------------- Estados
  static const Color stateError = AppPalette.errorSoft;
  static const Color stateErrorStrong = AppPalette.errorDark;
  static const Color textError = AppPalette.errorText;
  static const Color stateWarning = AppPalette.warningSoft;
  static const Color stateWarningStrong = AppPalette.warningDark;
  static const Color textWarning = AppPalette.warningText;
  static const Color stateSuccess = AppPalette.success;
  static const Color textSuccess = AppPalette.green950;
  static const Color stateInfo = AppPalette.info;
  static const Color textInfo = AppPalette.info;
  static const Color stateCleaning = AppPalette.cleaning;
  static const Color textCleaning = Color(0xFF4A3A6B);
  static const Color stateNeutral = Color(0xFF8A8078);
  static const Color textNeutral = Color(0xFF5B5147);
  static const Color surfaceNeutralSubtle = AppPalette.surfaceSunken;

  // ------------------------------------------------------------------- Overlays
  /// Scrim de modales (Material 3 usa ~32% de negro; aquí se aclara el tono).
  static const Color scrim = Color(0x593B2C23);
}

/// Colores de estado de sillas, reservas y alquileres.
///
/// Se usan junto a `StatusBadge`, que siempre añade icono + texto para no
/// comunicar información solo por color.
abstract final class AppStateColors {
  // ChairStatus
  static const Color availableDot = Color(0xFF2E7D32);
  static const Color availableSurface = AppPalette.successSubtle;
  static const Color availableText = Color(0xFF1F5A3E);

  static const Color occupiedDot = Color(0xFFC0851F);
  static const Color occupiedSurface = AppPalette.warningSubtle;
  static const Color occupiedText = AppPalette.warningText;

  static const Color reservedDot = Color(0xFF2B4C8C);
  static const Color reservedSurface = AppPalette.infoSubtle;
  static const Color reservedText = AppPalette.info;

  static const Color blockedDot = Color(0xFFC0392B);
  static const Color blockedSurface = AppPalette.errorSubtle;
  static const Color blockedText = AppPalette.errorText;

  static const Color maintenanceDot = Color(0xFF8A8078);
  static const Color maintenanceSurface = AppPalette.surfaceSunken;
  static const Color maintenanceText = Color(0xFF5B5147);

  static const Color cleaningDot = Color(0xFF5F3E8E);
  static const Color cleaningSurface = AppPalette.cleaningSubtle;
  static const Color cleaningText = Color(0xFF4A3A6B);

  // OrderStatus
  static const Color orderPendingDot = Color(0xFFC0851F);
  static const Color orderPendingSurface = AppPalette.warningSubtle;
  static const Color orderPendingText = AppPalette.warningText;

  static const Color orderProgressDot = Color(0xFF2B4C8C);
  static const Color orderProgressSurface = AppPalette.infoSubtle;
  static const Color orderProgressText = AppPalette.info;

  static const Color orderReadyDot = Color(0xFF1F5A3E);
  static const Color orderReadySurface = AppPalette.successSubtle;
  static const Color orderReadyText = Color(0xFF1F5A3E);

  static const Color orderClosedDot = Color(0xFF8A8078);
  static const Color orderClosedSurface = AppPalette.surfaceSunken;
  static const Color orderClosedText = Color(0xFF5B5147);

  static const Color orderCancelledDot = Color(0xFFC0392B);
  static const Color orderCancelledSurface = AppPalette.errorSubtle;
  static const Color orderCancelledText = AppPalette.errorText;
}

/// Paleta categórica de gráficos (fl_chart).
///
/// El orden importa: el índice 0 es el color principal de la serie.
abstract final class AppChartColors {
  static const List<Color> categorical = <Color>[
    AppPalette.sage,
    AppPalette.sageDark,
    AppPalette.inkStrong,
    AppPalette.warningSoft,
    AppPalette.info,
    AppPalette.cleaning,
    Color(0xFFC98A2B),
    Color(0xFF7C6A5C),
  ];

  static const Color seriesPrimary = AppPalette.sage;

  /// Alternativa con 3.26:1 sobre blanco: para líneas finas, leyenda y
  /// cualquier trazo que sea el único indicador del dato.
  static const Color seriesAlt = AppPalette.sageDark;
  static const Color seriesSecondary = AppPalette.inkStrong;
  static const Color axisLabel = AppPalette.textMuted;
  static const Color gridLine = AppPalette.borderSubtle;
  static const Color gridLineStrong = AppPalette.borderStrong;
  static const Color positive = AppPalette.green700;
  static const Color negative = AppPalette.errorDark;
}
