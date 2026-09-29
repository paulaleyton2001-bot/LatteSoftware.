// Tokens SEMÁNTICOS del sistema de diseño "Latte Coffee".
//
// ESTE ARCHIVO ES LA ÚNICA FUENTE DE VERDAD DEL COLOR POR MODO.
//
// QUÉ CAMBIA RESPECTO A LA INVERSIÓN MECÁNICA ANTERIOR
// Antes `AppTheme.dark` llamaba al mismo constructor que `light` con
// `Brightness.dark`, y `ColorScheme.fromSeed` rellenaba los roles que nadie
// enumeraba (chips, badges, segmentados, bottomsheet, estados de silla). Con
// superficies oscuras esos roles se recalculaban a verdes y naranjas claros
// sobre crema, y los componentes que usaban color fijo quedaban con crema sobre
// marrón. Aquí NO hay `fromSeed` decidiendo nada: los dos modos son DOS TABLAS
// EXPLÍCITAS, y cada par texto/fondo se verificó con la fórmula de WCAG 2.1
// (la tabla de razones está en `docs/DESIGN-TOKENS.md` §1.4).
//
// CÓMO SE CONSUME
// ```dart
// final AppTokens t = context.tokens;
// Container(color: t.surface, child: Text('Hola', style: TextStyle(color: t.textPrimary)));
// ```
// `AppTokens` es un [ThemeExtension]: viaja con el `ThemeData`, así que un
// widgetDeep-link o un subárbol con su propio `Theme` sigue recibiendo los
// tokens correctos. No hay estado global ni variables mutables.
//
// LOS ESTADOS DE SILLA Y PEDIDO
// `AppStateColors` desapareció: sus 30 tokens viven aquí como
// `availableSurface`/`availableText`/`availableDot`, etc. El catálogo visual de
// estados (`status_badge_visuals.dart`) guarda la CLAVE del estado y resuelve
// los tres colores aquí, en vez de congelar tres `Color` constantes que solo
// servían para el modo claro.

import 'package:flutter/material.dart';

import 'app_colors.dart';

/// Tokens semánticos resueltos para un modo concreto (claro u oscuro).
///
/// Inmutable y comparable: dos instancias con los mismos valores son
/// equivalentes, que es lo que necesita [lerp] para interpolar.
@immutable
class AppTokens extends ThemeExtension<AppTokens> {
  const AppTokens({
    // ---------------------------------------------------------- Superficies
    required this.background,
    required this.surface,
    required this.surfaceMuted,
    required this.surfaceSunken,

    // ----------------------------------------------------------------- Texto
    required this.textPrimary,
    required this.textStrong,
    required this.textSecondary,
    required this.textTertiary,
    required this.textMuted,
    required this.textDisabled,
    required this.textOnDark,

    // ---------------------------------------------------- Superficies de color
    required this.accentContainer,
    required this.onAccentContainer,
    required this.surfaceGreenSubtle,
    required this.surfaceGreenMuted,
    required this.surfaceErrorSubtle,
    required this.surfaceWarningSubtle,
    required this.surfaceSuccessSubtle,
    required this.surfaceInfoSubtle,
    required this.surfaceCleaningSubtle,
    required this.surfaceNeutralSubtle,

    // ---------------------------------------------------------------- Acciones
    required this.accent,
    required this.onAccent,
    required this.actionPrimary,
    required this.onActionPrimary,
    required this.actionPrimaryDisabled,
    required this.actionPrimaryDisabledText,
    required this.actionEspresso,
    required this.onActionEspresso,
    required this.actionEspressoDisabled,
    required this.actionEspressoDisabledText,
    required this.actionDanger,
    required this.onActionDanger,
    required this.actionDangerDisabled,
    required this.actionDangerDisabledText,

    // ------------------------------------------------------------------ Marca
    required this.brand,
    required this.brandLight,
    required this.brandDark,

    // ------------------------------------------------------- Bordes y overlays
    required this.borderSubtle,
    required this.borderDefault,
    required this.borderInput,
    required this.borderStrong,
    required this.focusRing,
    required this.focusRingSurface,
    required this.scrim,
    required this.shadow,

    // ------------------------------------------------------------------- Hero
    required this.heroPanel,
    required this.heroTitle,
    required this.heroSubtitle,

    // ------------------------------------------------ Estados genéricos + texto
    required this.stateError,
    required this.stateErrorStrong,
    required this.textError,
    required this.stateWarning,
    required this.stateWarningStrong,
    required this.textWarning,
    required this.stateSuccess,
    required this.textSuccess,
    required this.stateInfo,
    required this.textInfo,
    required this.stateCleaning,
    required this.textCleaning,
    required this.stateNeutral,
    required this.textNeutral,

    // ------------------------------------------------- Estados de silla (6 × 3)
    required this.availableDot,
    required this.availableSurface,
    required this.availableText,
    required this.occupiedDot,
    required this.occupiedSurface,
    required this.occupiedText,
    required this.reservedDot,
    required this.reservedSurface,
    required this.reservedText,
    required this.blockedDot,
    required this.blockedSurface,
    required this.blockedText,
    required this.maintenanceDot,
    required this.maintenanceSurface,
    required this.maintenanceText,
    required this.cleaningDot,
    required this.cleaningSurface,
    required this.cleaningText,

    // ---------------------------------------------- Estados de pedido (5 × 3)
    required this.orderPendingDot,
    required this.orderPendingSurface,
    required this.orderPendingText,
    required this.orderProgressDot,
    required this.orderProgressSurface,
    required this.orderProgressText,
    required this.orderReadyDot,
    required this.orderReadySurface,
    required this.orderReadyText,
    required this.orderClosedDot,
    required this.orderClosedSurface,
    required this.orderClosedText,
    required this.orderCancelledDot,
    required this.orderCancelledSurface,
    required this.orderCancelledText,
  });

  // ==================================================================== Claro
  /// Tokens del modo claro. Es el tema de referencia del producto.
  ///
  /// Superficies crema/blanco y texto espresso. Es la paleta que ya se había
  /// calibrado contra AA; lo único que se ajusta aquí son tres tonos que se
  /// acercaban al límite y ahora superan 4.5:1 en TODAS las superficies
  /// (verificado con la fórmula de luminancia relativa de WCAG 2.1):
  ///   - `textTertiary` #7A7069 (4.37:1 en `surfaceMuted`) → #726861 (4.91:1)
  ///   - `textMuted`   #8A8078 (3.49:1 en `surfaceMuted`) → #6F665E (5.08:1)
  ///   - el resto de pares ya estaba por encima de 4.5:1.
  factory AppTokens.light() => const AppTokens(
        // ---------------------------------------------------------- Superficies
        background: AppPalette.background,
        surface: AppPalette.surface,
        surfaceMuted: AppPalette.surfaceMuted,
        surfaceSunken: AppPalette.surfaceSunken,

        // ----------------------------------------------------------------- Texto
        textPrimary: AppPalette.ink,
        textStrong: AppPalette.inkStrong,
        textSecondary: AppPalette.textSecondary,
        textTertiary: AppPalette.textTertiaryAa,
        textMuted: AppPalette.textMutedAa,
        textDisabled: AppPalette.textDisabled,
        textOnDark: AppPalette.cream,

        // ---------------------------------------------------- Superficies de color
        accentContainer: AppPalette.greenSubtle,
        onAccentContainer: AppPalette.green950,
        surfaceGreenSubtle: AppPalette.greenSubtle,
        surfaceGreenMuted: AppPalette.greenMuted,
        surfaceErrorSubtle: AppPalette.errorSubtle,
        surfaceWarningSubtle: AppPalette.warningSubtle,
        surfaceSuccessSubtle: AppPalette.successSubtle,
        surfaceInfoSubtle: AppPalette.infoSubtle,
        surfaceCleaningSubtle: AppPalette.cleaningSubtle,
        surfaceNeutralSubtle: AppPalette.surfaceSunken,

        // ---------------------------------------------------------------- Acciones
        accent: AppPalette.green700,
        onAccent: Colors.white,
        actionPrimary: AppPalette.green700,
        onActionPrimary: Colors.white,
        actionPrimaryDisabled: AppPalette.greenDisabledSurface,
        actionPrimaryDisabledText: AppPalette.textOnDisabled,
        actionEspresso: AppPalette.espresso,
        onActionEspresso: AppPalette.cream,
        actionEspressoDisabled: AppPalette.espressoDisabledSurface,
        actionEspressoDisabledText: AppPalette.ink,
        actionDanger: AppPalette.errorDark,
        onActionDanger: Colors.white,
        actionDangerDisabled: AppPalette.errorDisabledSurface,
        actionDangerDisabledText: AppPalette.errorDisabledText,

        // ------------------------------------------------------------------ Marca
        brand: AppPalette.sage,
        brandLight: AppPalette.sageLight,
        brandDark: AppPalette.sageDark,

        // ------------------------------------------------------- Bordes y overlays
        borderSubtle: AppPalette.borderSubtle,
        borderDefault: AppPalette.borderDefault,
        borderInput: AppPalette.borderInput,
        borderStrong: AppPalette.borderStrong,
        focusRing: AppPalette.green700,
        focusRingSurface: AppPalette.focusRingSurface,
        scrim: AppPalette.scrim,
        shadow: AppPalette.ink,

        // ------------------------------------------------------------------- Hero
        heroPanel: AppPalette.espresso,
        heroTitle: AppPalette.cream,
        heroSubtitle: AppPalette.creamMuted,

        // ------------------------------------------------ Estados genéricos + texto
        stateError: AppPalette.errorSoft,
        stateErrorStrong: AppPalette.errorDark,
        textError: AppPalette.errorText,
        stateWarning: AppPalette.warningSoft,
        stateWarningStrong: AppPalette.warningDark,
        textWarning: AppPalette.warningText,
        stateSuccess: AppPalette.success,
        textSuccess: AppPalette.green950,
        stateInfo: AppPalette.info,
        textInfo: AppPalette.info,
        stateCleaning: AppPalette.cleaning,
        textCleaning: AppPalette.cleaningText,
        stateNeutral: AppPalette.neutral,
        textNeutral: AppPalette.neutralText,

        // ------------------------------------------------- Estados de silla
        availableDot: AppPalette.availableDot,
        availableSurface: AppPalette.successSubtle,
        availableText: AppPalette.green950,
        occupiedDot: AppPalette.occupiedDot,
        occupiedSurface: AppPalette.warningSubtle,
        occupiedText: AppPalette.warningText,
        reservedDot: AppPalette.reservedDot,
        reservedSurface: AppPalette.infoSubtle,
        reservedText: AppPalette.info,
        blockedDot: AppPalette.blockedDot,
        blockedSurface: AppPalette.errorSubtle,
        blockedText: AppPalette.errorText,
        maintenanceDot: AppPalette.maintenanceDot,
        maintenanceSurface: AppPalette.surfaceSunken,
        maintenanceText: AppPalette.neutralText,
        cleaningDot: AppPalette.cleaning,
        cleaningSurface: AppPalette.cleaningSubtle,
        cleaningText: AppPalette.cleaningText,

        // ---------------------------------------------- Estados de pedido
        orderPendingDot: AppPalette.occupiedDot,
        orderPendingSurface: AppPalette.warningSubtle,
        orderPendingText: AppPalette.warningText,
        orderProgressDot: AppPalette.info,
        orderProgressSurface: AppPalette.infoSubtle,
        orderProgressText: AppPalette.info,
        orderReadyDot: AppPalette.green950,
        orderReadySurface: AppPalette.successSubtle,
        orderReadyText: AppPalette.green950,
        orderClosedDot: AppPalette.neutral,
        orderClosedSurface: AppPalette.surfaceSunken,
        orderClosedText: AppPalette.neutralText,
        orderCancelledDot: AppPalette.blockedDot,
        orderCancelledSurface: AppPalette.errorSubtle,
        orderCancelledText: AppPalette.errorText,
      );

  // ==================================================================== Oscuro
  /// Tokens del modo oscuro: **marrón espresso profundo**, no gris neutro.
  ///
  /// Razón de cada decisión (todas medidas con la fórmula de WCAG 2.1; el
  /// denominador entre paréntesis es la superficie contra la que se midió, la
  /// MÁS exigente: `surfaceSunken` = #141009):
  ///
  /// | token        | valor    | ratio sobre `surface` | ratio sobre `surfaceSunken` |
  /// |--------------|----------|-----------------------|-----------------------------|
  /// | textPrimary  | #F7F1E8  | 15.17:1               | 16.88:1                     |
  /// | textSecondary| #CFC1B1  |  9.67:1               | 10.76:1                     |
  /// | textTertiary | #B5A695  |  7.18:1               |  7.79:1                     |
  /// | textMuted    | #9A8979  |  5.05:1               |  5.62:1                     |
  /// | textDisabled | #7A6A5D  |  3.28:1 (exento 1.4.3)|  3.50:1                     |
  /// | textSuccess  | #7FCBA0  |  8.88:1               |  9.64:1                     |
  /// | textError    | #F2A9A2  |  8.90:1               |  9.66:1                     |
  /// | textWarning  | #E9BC81  |  9.71:1               | 10.54:1                     |
  /// | textInfo     | #9DBBE8  |  8.68:1               |  9.42:1                     |
  /// | textCleaning | #BCA3E2  |  7.69:1               |  8.34:1                     |
  ///
  /// Y sobre su propio contenedor diluido (el caso de los badges, donde el
  /// texto se apoya en `*Container` y no en la superficie):
  /// éxito 6.78:1 · error 7.88:1 · warning 7.79:1 · info 7.37:1 · limpieza
  /// 6.71:1 · neutro 6.64:1 · acento 8.68:1. Todos >= 4.5:1.
  ///
  /// El acento INVIERTE su relación con el texto: en claro es verde 700 con
  /// blanco encima (5.01:1); en oscuro es salvia 300 con casi negro encima
  /// (#0E1A14, 9.42:1). Un botón verde claro con texto blanco habría dado
  /// 1.9:1.
  factory AppTokens.dark() => const AppTokens(
        // ---------------------------------------------------------- Superficies
        background: AppPalette.espresso950,
        surface: AppPalette.espresso900,
        surfaceMuted: AppPalette.espresso800,
        surfaceSunken: AppPalette.espressoBlack,

        // ----------------------------------------------------------------- Texto
        textPrimary: AppPalette.cream,
        textStrong: AppPalette.creamStrong,
        textSecondary: AppPalette.creamSecondary,
        textTertiary: AppPalette.creamTertiary,
        textMuted: AppPalette.creamMutedDark,
        textDisabled: AppPalette.creamDisabled,
        textOnDark: AppPalette.espresso950,

        // ---------------------------------------------------- Superficies de color
        accentContainer: AppPalette.espressoAccentSurface,
        onAccentContainer: AppPalette.creamAccent,
        surfaceGreenSubtle: AppPalette.espressoAccentSurface,
        surfaceGreenMuted: AppPalette.espressoAccentSurface,
        surfaceErrorSubtle: AppPalette.espressoErrorSurface,
        surfaceWarningSubtle: AppPalette.espressoWarningSurface,
        surfaceSuccessSubtle: AppPalette.espressoSuccessSurface,
        surfaceInfoSubtle: AppPalette.espressoInfoSurface,
        surfaceCleaningSubtle: AppPalette.espressoCleaningSurface,
        surfaceNeutralSubtle: AppPalette.espresso800,

        // ---------------------------------------------------------------- Acciones
        accent: AppPalette.sageLight,
        onAccent: AppPalette.espressoInk,
        actionPrimary: AppPalette.sageLight,
        onActionPrimary: AppPalette.espressoInk,
        actionPrimaryDisabled: AppPalette.espressoPrimaryDisabled,
        actionPrimaryDisabledText: AppPalette.creamAccentDisabled,
        actionEspresso: AppPalette.creamStrong,
        onActionEspresso: AppPalette.espressoBlack,
        actionEspressoDisabled: AppPalette.espressoDisabledSurfaceDark,
        actionEspressoDisabledText: AppPalette.creamSecondary,
        actionDanger: AppPalette.errorSoftDark,
        onActionDanger: AppPalette.espressoBlack,
        actionDangerDisabled: AppPalette.espressoErrorDisabled,
        actionDangerDisabledText: AppPalette.errorSoftDark,

        // ------------------------------------------------------------------ Marca
        brand: AppPalette.sage,
        brandLight: AppPalette.sageLight,
        brandDark: AppPalette.sageDarkLg,

        // ------------------------------------------------------- Bordes y overlays
        borderSubtle: AppPalette.espressoBorderSubtle,
        borderDefault: AppPalette.espressoBorder,
        borderInput: AppPalette.espressoBorderInput,
        borderStrong: AppPalette.creamMutedStrong,
        focusRing: AppPalette.sageLight,
        focusRingSurface: AppPalette.focusRingSurfaceDark,
        scrim: AppPalette.scrimDark,
        shadow: Colors.black,

        // ------------------------------------------------------------------- Hero
        heroPanel: AppPalette.espresso850,
        heroTitle: AppPalette.cream,
        heroSubtitle: AppPalette.creamSecondary,

        // ------------------------------------------------ Estados genéricos + texto
        stateError: AppPalette.errorSoftDark,
        stateErrorStrong: AppPalette.errorDark,
        textError: AppPalette.errorSoftDark,
        stateWarning: AppPalette.warningSoftDark,
        stateWarningStrong: AppPalette.warningDark,
        textWarning: AppPalette.warningSoftDark,
        stateSuccess: AppPalette.sageLight,
        textSuccess: AppPalette.sageLight,
        stateInfo: AppPalette.infoSoftDark,
        textInfo: AppPalette.infoSoftDark,
        stateCleaning: AppPalette.cleaningSoftDark,
        textCleaning: AppPalette.cleaningSoftDark,
        stateNeutral: AppPalette.creamMutedDark,
        textNeutral: AppPalette.creamSecondary,

        // ------------------------------------------------- Estados de silla
        availableDot: AppPalette.sageLight,
        availableSurface: AppPalette.espressoSuccessSurface,
        availableText: AppPalette.sageLight,
        occupiedDot: AppPalette.warningSoftDark,
        occupiedSurface: AppPalette.espressoWarningSurface,
        occupiedText: AppPalette.warningSoftDark,
        reservedDot: AppPalette.infoSoftDark,
        reservedSurface: AppPalette.espressoInfoSurface,
        reservedText: AppPalette.infoSoftDark,
        blockedDot: AppPalette.errorSoftDark,
        blockedSurface: AppPalette.espressoErrorSurface,
        blockedText: AppPalette.errorSoftDark,
        maintenanceDot: AppPalette.creamMutedDark,
        maintenanceSurface: AppPalette.espresso800,
        maintenanceText: AppPalette.creamSecondary,
        cleaningDot: AppPalette.cleaningSoftDark,
        cleaningSurface: AppPalette.espressoCleaningSurface,
        cleaningText: AppPalette.cleaningSoftDark,

        // ---------------------------------------------- Estados de pedido
        orderPendingDot: AppPalette.warningSoftDark,
        orderPendingSurface: AppPalette.espressoWarningSurface,
        orderPendingText: AppPalette.warningSoftDark,
        orderProgressDot: AppPalette.infoSoftDark,
        orderProgressSurface: AppPalette.espressoInfoSurface,
        orderProgressText: AppPalette.infoSoftDark,
        orderReadyDot: AppPalette.sageLight,
        orderReadySurface: AppPalette.espressoSuccessSurface,
        orderReadyText: AppPalette.sageLight,
        orderClosedDot: AppPalette.creamMutedDark,
        orderClosedSurface: AppPalette.espresso800,
        orderClosedText: AppPalette.creamSecondary,
        orderCancelledDot: AppPalette.errorSoftDark,
        orderCancelledSurface: AppPalette.espressoErrorSurface,
        orderCancelledText: AppPalette.errorSoftDark,
      );

  // =========================================================== Superficies
  /// Fondo de la aplicación (detrás de las cards).
  final Color background;

  /// Superficie principal: cards, diálogos, hojas, barra de navegación.
  final Color surface;

  /// Superficie alternativa: chips inactivos, filas de tabla, hitos.
  final Color surfaceMuted;

  /// Superficie hundida: skeletons, cabeceras de tabla, campos deshabilitados.
  final Color surfaceSunken;

  // ================================================================= Texto
  /// Texto principal: títulos, cifras, contenido.
  final Color textPrimary;

  /// Texto de mucho peso (KPI, precio destacado). Un escalón sobre
  /// [textPrimary] para jerarquía sin cambiar de tamaño.
  final Color textStrong;

  /// Texto secundario: subtítulos, descripciones, metadatos.
  final Color textSecondary;

  /// Texto terciario: timestamps, pies de bloque.
  final Color textTertiary;

  /// Texto atenuado NO esencial (numerales decorativos). >= 4.5:1 igualmente.
  final Color textMuted;

  /// Texto e iconos deshabilitados. WCAG 1.4.3 exime a los deshabilitados, pero
  /// se mantiene >= 3:1 para que un control apagado siga siendo legible.
  final Color textDisabled;

  /// Texto sobre una superficie oscura fija (hero, snackbar).
  final Color textOnDark;

  // =============================================== Superficies de color
  /// Relleno del indicador seleccionado (píldora de la barra inferior).
  final Color accentContainer;

  /// Texto e ícono sobre [accentContainer].
  final Color onAccentContainer;

  /// Superficie éxito/acento diluida.
  final Color surfaceGreenSubtle;

  /// Superficie éxito/acento algo más marcada.
  final Color surfaceGreenMuted;

  final Color surfaceErrorSubtle;
  final Color surfaceWarningSubtle;
  final Color surfaceSuccessSubtle;
  final Color surfaceInfoSubtle;
  final Color surfaceCleaningSubtle;
  final Color surfaceNeutralSubtle;

  // ============================================================== Acciones
  /// Color de acento de marca resolvedo para el modo (verde 700 / salvia 300).
  final Color accent;

  /// Texto sobre [accent].
  final Color onAccent;

  final Color actionPrimary;
  final Color onActionPrimary;
  final Color actionPrimaryDisabled;
  final Color actionPrimaryDisabledText;

  /// CTA de alto peso. En claro es espresso con crema; en oscuro se invierte a
  /// crema con casi negro, porque un espresso sobre un fondo espresso no se ve.
  final Color actionEspresso;

  final Color onActionEspresso;
  final Color actionEspressoDisabled;
  final Color actionEspressoDisabledText;

  final Color actionDanger;
  final Color onActionDanger;
  final Color actionDangerDisabled;
  final Color actionDangerDisabledText;

  // ================================================================= Marca
  final Color brand;
  final Color brandLight;
  final Color brandDark;

  // ==================================================== Bordes y overlays
  final Color borderSubtle;
  final Color borderDefault;
  final Color borderInput;

  /// Borde de control identificable SOLO por su borde (checkbox, radio).
  /// >= 3:1 en ambos modos (WCAG 1.4.11).
  final Color borderStrong;

  final Color focusRing;

  /// Halo translúcido del foco/ripple. Nunca acompaña solo a un color.
  final Color focusRingSurface;

  final Color scrim;
  final Color shadow;

  // ================================================================== Hero
  /// Panel marrón del hero (POS, banners).
  final Color heroPanel;

  final Color heroTitle;
  final Color heroSubtitle;

  // ============================================== Estados genéricos + texto
  final Color stateError;
  final Color stateErrorStrong;
  final Color textError;
  final Color stateWarning;
  final Color stateWarningStrong;
  final Color textWarning;
  final Color stateSuccess;
  final Color textSuccess;
  final Color stateInfo;
  final Color textInfo;
  final Color stateCleaning;
  final Color textCleaning;
  final Color stateNeutral;
  final Color textNeutral;

  // ================================================== Estados de silla
  final Color availableDot;
  final Color availableSurface;
  final Color availableText;
  final Color occupiedDot;
  final Color occupiedSurface;
  final Color occupiedText;
  final Color reservedDot;
  final Color reservedSurface;
  final Color reservedText;
  final Color blockedDot;
  final Color blockedSurface;
  final Color blockedText;
  final Color maintenanceDot;
  final Color maintenanceSurface;
  final Color maintenanceText;
  final Color cleaningDot;
  final Color cleaningSurface;
  final Color cleaningText;

  // ================================================== Estados de pedido
  final Color orderPendingDot;
  final Color orderPendingSurface;
  final Color orderPendingText;
  final Color orderProgressDot;
  final Color orderProgressSurface;
  final Color orderProgressText;
  final Color orderReadyDot;
  final Color orderReadySurface;
  final Color orderReadyText;
  final Color orderClosedDot;
  final Color orderClosedSurface;
  final Color orderClosedText;
  final Color orderCancelledDot;
  final Color orderCancelledSurface;
  final Color orderCancelledText;

  /// Copia con los mismos roles; [lerp] la usa durante las transiciones.
  @override
  AppTokens copyWith() => this;

  /// Tokens del `ThemeData` al que pertenece [context].
  ///
  /// Si el árbol se montó con un `ThemeData` sin la extensión (un test mínimo,
  /// un ejemplo), se devuelven los del modo que corresponde a su `brightness`
  /// en lugar de reventar: es la degradación elegante que se busca cuando
  /// falta un tema, no una excepción en medio de un `build`.
  static AppTokens of(BuildContext context) => Theme.of(context).tokens;

  /// Interpolación lineal de los tres canales de cada color.
  ///
  /// Flutter la exige para animar el cambio de tema; sin ella, `ThemeData`
  /// lanza al interpolar. No se usa para calcular ningún color: los dos modos
  /// son tablas fijas ya verificadas contra contraste.
  @override
  AppTokens lerp(covariant AppTokens? other, double t) {
    if (other == null) return this;
    Color c(Color a, Color b) => Color.lerp(a, b, t) ?? a;
    return AppTokens(
      background: c(background, other.background),
      surface: c(surface, other.surface),
      surfaceMuted: c(surfaceMuted, other.surfaceMuted),
      surfaceSunken: c(surfaceSunken, other.surfaceSunken),
      textPrimary: c(textPrimary, other.textPrimary),
      textStrong: c(textStrong, other.textStrong),
      textSecondary: c(textSecondary, other.textSecondary),
      textTertiary: c(textTertiary, other.textTertiary),
      textMuted: c(textMuted, other.textMuted),
      textDisabled: c(textDisabled, other.textDisabled),
      textOnDark: c(textOnDark, other.textOnDark),
      accentContainer: c(accentContainer, other.accentContainer),
      onAccentContainer: c(onAccentContainer, other.onAccentContainer),
      surfaceGreenSubtle: c(surfaceGreenSubtle, other.surfaceGreenSubtle),
      surfaceGreenMuted: c(surfaceGreenMuted, other.surfaceGreenMuted),
      surfaceErrorSubtle: c(surfaceErrorSubtle, other.surfaceErrorSubtle),
      surfaceWarningSubtle: c(surfaceWarningSubtle, other.surfaceWarningSubtle),
      surfaceSuccessSubtle: c(surfaceSuccessSubtle, other.surfaceSuccessSubtle),
      surfaceInfoSubtle: c(surfaceInfoSubtle, other.surfaceInfoSubtle),
      surfaceCleaningSubtle: c(surfaceCleaningSubtle, other.surfaceCleaningSubtle),
      surfaceNeutralSubtle: c(surfaceNeutralSubtle, other.surfaceNeutralSubtle),
      accent: c(accent, other.accent),
      onAccent: c(onAccent, other.onAccent),
      actionPrimary: c(actionPrimary, other.actionPrimary),
      onActionPrimary: c(onActionPrimary, other.onActionPrimary),
      actionPrimaryDisabled: c(actionPrimaryDisabled, other.actionPrimaryDisabled),
      actionPrimaryDisabledText:
          c(actionPrimaryDisabledText, other.actionPrimaryDisabledText),
      actionEspresso: c(actionEspresso, other.actionEspresso),
      onActionEspresso: c(onActionEspresso, other.onActionEspresso),
      actionEspressoDisabled:
          c(actionEspressoDisabled, other.actionEspressoDisabled),
      actionEspressoDisabledText:
          c(actionEspressoDisabledText, other.actionEspressoDisabledText),
      actionDanger: c(actionDanger, other.actionDanger),
      onActionDanger: c(onActionDanger, other.onActionDanger),
      actionDangerDisabled: c(actionDangerDisabled, other.actionDangerDisabled),
      actionDangerDisabledText:
          c(actionDangerDisabledText, other.actionDangerDisabledText),
      brand: c(brand, other.brand),
      brandLight: c(brandLight, other.brandLight),
      brandDark: c(brandDark, other.brandDark),
      borderSubtle: c(borderSubtle, other.borderSubtle),
      borderDefault: c(borderDefault, other.borderDefault),
      borderInput: c(borderInput, other.borderInput),
      borderStrong: c(borderStrong, other.borderStrong),
      focusRing: c(focusRing, other.focusRing),
      focusRingSurface: c(focusRingSurface, other.focusRingSurface),
      scrim: c(scrim, other.scrim),
      shadow: c(shadow, other.shadow),
      heroPanel: c(heroPanel, other.heroPanel),
      heroTitle: c(heroTitle, other.heroTitle),
      heroSubtitle: c(heroSubtitle, other.heroSubtitle),
      stateError: c(stateError, other.stateError),
      stateErrorStrong: c(stateErrorStrong, other.stateErrorStrong),
      textError: c(textError, other.textError),
      stateWarning: c(stateWarning, other.stateWarning),
      stateWarningStrong: c(stateWarningStrong, other.stateWarningStrong),
      textWarning: c(textWarning, other.textWarning),
      stateSuccess: c(stateSuccess, other.stateSuccess),
      textSuccess: c(textSuccess, other.textSuccess),
      stateInfo: c(stateInfo, other.stateInfo),
      textInfo: c(textInfo, other.textInfo),
      stateCleaning: c(stateCleaning, other.stateCleaning),
      textCleaning: c(textCleaning, other.textCleaning),
      stateNeutral: c(stateNeutral, other.stateNeutral),
      textNeutral: c(textNeutral, other.textNeutral),
      availableDot: c(availableDot, other.availableDot),
      availableSurface: c(availableSurface, other.availableSurface),
      availableText: c(availableText, other.availableText),
      occupiedDot: c(occupiedDot, other.occupiedDot),
      occupiedSurface: c(occupiedSurface, other.occupiedSurface),
      occupiedText: c(occupiedText, other.occupiedText),
      reservedDot: c(reservedDot, other.reservedDot),
      reservedSurface: c(reservedSurface, other.reservedSurface),
      reservedText: c(reservedText, other.reservedText),
      blockedDot: c(blockedDot, other.blockedDot),
      blockedSurface: c(blockedSurface, other.blockedSurface),
      blockedText: c(blockedText, other.blockedText),
      maintenanceDot: c(maintenanceDot, other.maintenanceDot),
      maintenanceSurface: c(maintenanceSurface, other.maintenanceSurface),
      maintenanceText: c(maintenanceText, other.maintenanceText),
      cleaningDot: c(cleaningDot, other.cleaningDot),
      cleaningSurface: c(cleaningSurface, other.cleaningSurface),
      cleaningText: c(cleaningText, other.cleaningText),
      orderPendingDot: c(orderPendingDot, other.orderPendingDot),
      orderPendingSurface: c(orderPendingSurface, other.orderPendingSurface),
      orderPendingText: c(orderPendingText, other.orderPendingText),
      orderProgressDot: c(orderProgressDot, other.orderProgressDot),
      orderProgressSurface: c(orderProgressSurface, other.orderProgressSurface),
      orderProgressText: c(orderProgressText, other.orderProgressText),
      orderReadyDot: c(orderReadyDot, other.orderReadyDot),
      orderReadySurface: c(orderReadySurface, other.orderReadySurface),
      orderReadyText: c(orderReadyText, other.orderReadyText),
      orderClosedDot: c(orderClosedDot, other.orderClosedDot),
      orderClosedSurface: c(orderClosedSurface, other.orderClosedSurface),
      orderClosedText: c(orderClosedText, other.orderClosedText),
      orderCancelledDot: c(orderCancelledDot, other.orderCancelledDot),
      orderCancelledSurface: c(orderCancelledSurface, other.orderCancelledSurface),
      orderCancelledText: c(orderCancelledText, other.orderCancelledText),
    );
  }
}

/// Acceso corto a los tokens del tema desde un `BuildContext`.
///
/// `context.tokens.textPrimary` en vez de `Theme.of(context).extension<...>()`
/// porque aparece en cientos de sitios y la forma larga solo añade ruido.
extension AppTokensX on BuildContext {
  /// Tokens semánticos del modo activo.
  ///
  /// `Theme.of(context)` siempre trae la extensión porque la instalan
  /// [AppTokens.light] y [AppTokens.dark] vía `AppTheme`; ver [AppTokens.of]
  /// para el caso degradado sin tema.
  AppTokens get tokens => AppTokens.of(this);
}

/// Lectura explícita de los tokens, con valor por defecto seguro.
extension AppTokensOf on ThemeData {
  /// Tokens registrados en este `ThemeData`.
  ///
  /// Si un `ThemeData` se construyó sin la extensión (un test mínimo, un
  /// ejemplo), se devuelven los del modo que corresponde a su `brightness` en
  /// lugar de reventar: es la degradación elegante que se busca cuando falta
  /// un tema, no una excepción en medio de un `build`.
  AppTokens get tokens => extension<AppTokens>() ??
      (brightness == Brightness.dark ? AppTokens.dark() : AppTokens.light());
}
