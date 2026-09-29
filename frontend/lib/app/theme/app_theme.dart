// `ThemeData` completo de "Latte Coffee".
//
// Un solo lugar donde se cablea el tema: `app/app.dart` → `MaterialApp.router`
// con `theme: AppTheme.light` y `darkTheme: AppTheme.dark`.
//
// POR QUÉ HAY DOS CONSTRUCTORES Y NO UNO CON `Brightness`
// El tema anterior era `_build(Brightness.dark)`: el MISMO constructor con
// `ColorScheme.fromSeed` para los dos modos. Eso funciona para los roles que se
// enumeran a mano, pero `fromSeed` decide SOLO los que nadie enumera — y en
// Material 3 son precisamente los que usa la app en todas partes: chips,
// badges de estado, `NavigationBar.indicatorColor`, hojas inferiores, menús
// contextuales, `FloatingActionButton`. Con superficies oscuras esos roles salían
// verdes y naranjas claros sobre crema y la app se veía "invertida".
//
// Aquí los dos modos son DOS FUNCIONES. Cada una declara su [ColorScheme] y su
// [AppTokens] completos, y ninguna llama a `fromSeed`. Añadir un rol nuevo es
// añadirlo en las dos tablas: si se olvida uno, el error es visible al
// compilar (el constructor es `required`), no un píxel raro en pantalla.
//
// LOS ROLES DEL ESQUEMA Y LOS TOKENS NO SE DUPLICAN CON VALORES DISTINTOS
// `ColorScheme` cubre lo que Material resuelve solo (para que los widgets de
// Material salgan bien sin tocar nada) y `AppTokens` cubre lo que la app pinta
// con sus propios widgets. Los dos se construyen a partir de la MISMA variable
// `t`, así que no pueden divergir.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_borders.dart';
import 'app_radii.dart';
import 'app_spacing.dart';
import 'app_tokens.dart';
import 'app_typography.dart';

abstract final class AppTheme {
  /// Tema claro. Es el tema de referencia del producto.
  static final ThemeData light = _light();

  /// Tema oscuro: marrón espresso profundo, acento salvia claro.
  static final ThemeData dark = _dark();

  /// Tema según la preferencia del sistema.
  ///
  /// Devuelve la INSTANCIA compartida (`light`/`dark`) en lugar de reconstruir
  /// el `ThemeData`: `Theme.of(context)` compara por identidad, y devolver la
  /// misma instancia evita que cada lectura dispare un `==` profundo sobre ~40
  /// colores y reinicie la comparación de `AnimatedTheme`.
  static ThemeData of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? dark : light;

  // ==================================================================== Claro
  static ThemeData _light() {
    final AppTokens t = AppTokens.light();

    return _base(
      t: t,
      brightness: Brightness.light,
      scheme: ColorScheme(
        brightness: Brightness.light,
        primary: t.accent,
        onPrimary: t.onAccent,
        primaryContainer: t.accentContainer,
        onPrimaryContainer: t.onAccentContainer,
        secondary: t.brandDark,
        onSecondary: Colors.white,
        secondaryContainer: t.surfaceGreenMuted,
        onSecondaryContainer: t.onAccentContainer,
        tertiary: t.stateWarning,
        onTertiary: t.textPrimary,
        error: t.stateErrorStrong,
        onError: t.onActionDanger,
        errorContainer: t.surfaceErrorSubtle,
        onErrorContainer: t.textError,
        surface: t.surface,
        onSurface: t.textPrimary,
        surfaceContainerLowest: t.background,
        surfaceContainerLow: t.surfaceMuted,
        surfaceContainer: t.surfaceSunken,
        surfaceContainerHigh: t.surfaceMuted,
        surfaceContainerHighest: t.surfaceMuted,
        onSurfaceVariant: t.textSecondary,
        outline: t.borderStrong,
        outlineVariant: t.borderDefault,
        shadow: t.shadow,
        scrim: t.scrim,
        inverseSurface: t.heroPanel,
        onInverseSurface: t.onAccentContainer,
        inversePrimary: t.brand,
      ),
    );
  }

  // =================================================================== Oscuro
  static ThemeData _dark() {
    final AppTokens t = AppTokens.dark();

    return _base(
      t: t,
      brightness: Brightness.dark,
      scheme: ColorScheme(
        brightness: Brightness.dark,
        primary: t.accent,
        onPrimary: t.onAccent,
        primaryContainer: t.accentContainer,
        onPrimaryContainer: t.onAccentContainer,
        secondary: t.brandDark,
        onSecondary: t.textOnDark,
        secondaryContainer: t.surfaceGreenMuted,
        onSecondaryContainer: t.onAccentContainer,
        tertiary: t.stateWarning,
        onTertiary: t.textPrimary,
        error: t.stateErrorStrong,
        onError: t.onActionDanger,
        errorContainer: t.surfaceErrorSubtle,
        onErrorContainer: t.textError,
        surface: t.surface,
        onSurface: t.textPrimary,
        // El fondo (`espresso950`) y la superficie (`espresso900`) se separan por
        // 2 escalones de la rampa, no por 1: en un fondo casi negro un card
        // medio tono más claro delata el borde del `Scaffold`.
        surfaceContainerLowest: t.background,
        surfaceContainerLow: t.surfaceMuted,
        surfaceContainer: t.surfaceSunken,
        surfaceContainerHigh: t.surfaceMuted,
        surfaceContainerHighest: t.surfaceMuted,
        onSurfaceVariant: t.textSecondary,
        outline: t.borderStrong,
        outlineVariant: t.borderDefault,
        shadow: t.shadow,
        scrim: t.scrim,
        inverseSurface: t.surfaceGreenSubtle,
        onInverseSurface: t.onAccentContainer,
        inversePrimary: t.brandDark,
      ),
    );
  }

  // ================================================================= Común
  /// Bloque común a los dos modos: todo lo que NO es un color, más los colores
  /// que se derivan de `t` (que ya viene resuelto para el modo).
  static ThemeData _base({
    required AppTokens t,
    required Brightness brightness,
    required ColorScheme scheme,
  }) {
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      // El tema ES la fuente de los tokens: se registra la extensión para que
      // `context.tokens` funcione en cualquier subárbol, incluidos los que
      // inyectan su propio `Theme`.
      extensions: <ThemeExtension<dynamic>>[t],
      scaffoldBackgroundColor: t.background,
      canvasColor: t.surface,
      // `Typography.material2021().white` en oscuro y `.black` en claro: la
      // base de Material trae el `TextTheme` con la luminancia correcta de cada
      // modo, y `buildAppTextTheme` sustituye todos los tamaños por la escala de
      // la marca. Antes se usaba SIEMPRE `.black` y luego se aplicaba un color
      // encima, lo que dejaba los estilos derivados (los de `onSurfaceVariant`
      // que usa Material por su cuenta) con el contraste de la tinta equivocada.
      //
      // `apply(bodyColor:, displayColor:)` se aplica AL TextTheme (no al
      // `Typography`, que no tiene ese método) y DESPUÉS de la sustitución de
      // estilos: así ningún rol del esquema arrastra la tinta del otro modo.
      textTheme: buildAppTextTheme(
        _baseTextTheme(brightness).apply(
          bodyColor: t.textPrimary,
          displayColor: t.textPrimary,
        ),
      ),
      primaryTextTheme: buildAppTextTheme(
        _baseTextTheme(brightness).apply(
          bodyColor: t.textPrimary,
          displayColor: t.textPrimary,
        ),
      ),
      fontFamily: null, // Sans-serif del sistema: sin dependencia de red.
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded, // target >= 48 dp
      splashFactory: InkSparkle.splashFactory,

      // ------------------------------------------------------------------ AppBar
      appBarTheme: AppBarTheme(
        backgroundColor: t.background,
        foregroundColor: t.textPrimary,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: AppTextStyles.headlineSmall.copyWith(color: t.textPrimary),
        iconTheme: IconThemeData(color: t.textPrimary, size: 24),
        actionsIconTheme: IconThemeData(color: t.textPrimary, size: 24),
        // Los iconos de la barra de estado deben invertirse con el tema: sin
        // esto el reloj y la batería salían blancos sobre crema.
        systemOverlayStyle: brightness == Brightness.dark
            ? SystemUiOverlayStyle.light
            : SystemUiOverlayStyle.dark,
      ),

      // ------------------------------------------------------------------- Card
      cardTheme: CardTheme(
        color: t.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.lg),
        ),
      ),

      // ---------------------------------------------------------------- Buttons
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: _buttonStyle(
          background: t.actionPrimary,
          foreground: t.onActionPrimary,
          disabledBackground: t.actionPrimaryDisabled,
          disabledForeground: t.actionPrimaryDisabledText,
          border: null,
          overlay: t.focusRingSurface,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: _buttonStyle(
          background: Colors.transparent,
          foreground: t.accent,
          disabledBackground: Colors.transparent,
          disabledForeground: t.textDisabled,
          border: BorderSide(color: t.accent, width: AppBorders.width),
          overlay: t.focusRingSurface,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: _buttonStyle(
          background: Colors.transparent,
          foreground: t.accent,
          disabledBackground: Colors.transparent,
          disabledForeground: t.textDisabled,
          border: null,
          overlay: t.focusRingSurface,
        ),
      ),

      // ------------------------------------------------------------------ Input
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: t.surfaceMuted,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        hintStyle: AppTextStyles.bodyMedium.copyWith(color: t.textMuted),
        labelStyle: AppTextStyles.titleSmall.copyWith(color: t.textSecondary),
        floatingLabelStyle: AppTextStyles.titleSmall.copyWith(color: t.accent),
        helperStyle: AppTextStyles.captionMedium.copyWith(color: t.textSecondary),
        // `errorText` lo sobreescribe `AppTextField` con el token de error.
        errorStyle: AppTextStyles.captionMedium.copyWith(color: t.textError),
        errorMaxLines: 2,
        prefixIconColor: t.textSecondary,
        suffixIconColor: t.textSecondary,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: BorderSide(color: t.borderInput, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: BorderSide(color: t.focusRing, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: BorderSide(color: t.textError, width: 1),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: BorderSide(color: t.textError, width: 2),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: BorderSide(color: t.borderDefault, width: 1),
        ),
      ),

      // ------------------------------------------------------------------- Chip
      // `chipTheme` es el ÚNICO lugar donde se decide cómo se ve un chip sin
      // que la feature lo repinta: `CategoryChip` y `CategoryChipRow` leen estos
      // mismos roles a través de `AppTokens`.
      chipTheme: ChipThemeData(
        backgroundColor: t.surfaceMuted,
        selectedColor: t.accentContainer,
        disabledColor: t.surfaceSunken,
        labelStyle: AppTextStyles.labelLarge.copyWith(color: t.textSecondary),
        secondaryLabelStyle:
            AppTextStyles.labelLarge.copyWith(color: t.onAccentContainer),
        side: BorderSide(color: t.borderDefault, width: 1),
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
      ),

      // --------------------------------------------------------- Navegación
      // El indicador de la barra inferior usa `accentContainer`/`onAccentContainer`
      // del modo, no un verde fijo: con un relleno crema claro sobre fondo
      // marrón, la pestaña activa era un manchurrón y el texto de la activa y el
      // de las inactivas quedaban con el mismo tono.
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: t.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: t.accentContainer,
        elevation: 0,
        height: 68,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith<IconThemeData>(
          (Set<WidgetState> states) => IconThemeData(
            size: 24,
            color: states.contains(WidgetState.selected)
                ? t.onAccentContainer
                : t.textSecondary,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith<TextStyle>(
          (Set<WidgetState> states) => AppTextStyles.labelSmall.copyWith(
            fontSize: 11,
            letterSpacing: 0.1,
            color: states.contains(WidgetState.selected)
                ? t.onAccentContainer
                : t.textSecondary,
          ),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: t.surface,
        indicatorColor: t.accentContainer,
        selectedIconTheme: IconThemeData(color: t.onAccentContainer, size: 24),
        unselectedIconTheme: IconThemeData(color: t.textSecondary, size: 24),
        selectedLabelTextStyle:
            AppTextStyles.labelMedium.copyWith(color: t.onAccentContainer),
        unselectedLabelTextStyle:
            AppTextStyles.labelMedium.copyWith(color: t.textSecondary),
        useIndicator: true,
      ),

      // ----------------------------------------------------------------- Dialog
      dialogTheme: DialogTheme(
        backgroundColor: t.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        titleTextStyle: AppTextStyles.headlineSmall.copyWith(color: t.textPrimary),
        contentTextStyle: AppTextStyles.bodyMedium.copyWith(color: t.textSecondary),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.xl),
        ),
      ),

      // ----------------------------------------------------------------- Sheets
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: t.surface,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: t.surface,
        elevation: 0,
        showDragHandle: true,
        dragHandleColor: t.borderStrong,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.xxl)),
        ),
      ),

      // --------------------------------------------------------- Menú contextual
      popupMenuTheme: PopupMenuThemeData(
        color: t.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 2,
        textStyle: AppTextStyles.bodyMedium.copyWith(color: t.textPrimary),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          side: BorderSide(color: t.borderDefault, width: 1),
        ),
      ),
      menuTheme: MenuThemeData(
        style: MenuStyle(
          backgroundColor: WidgetStatePropertyAll<Color>(t.surface),
          shadowColor: WidgetStatePropertyAll<Color>(Colors.transparent),
          // `MenuStyle` (Flutter 3.24) NO admite `foregroundColor` ni
          // `textStyle`: solo fondo, sombra, tamaño, forma y densidad. El texto de
          // los ítems lo pone el `DefaultTextStyle` que hereda del `TextTheme` del
          // tema, que ya está construido sobre `t.textPrimary` del modo activo.
          elevation: const WidgetStatePropertyAll<double>(2),
          visualDensity: VisualDensity.compact,
          shape: WidgetStatePropertyAll<OutlinedBorder>(
            RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppRadii.md),
              side: BorderSide(color: t.borderDefault, width: 1),
            ),
          ),
        ),
      ),

      // -------------------------------------------------------- Tabla (admin)
      dataTableTheme: DataTableThemeData(
        headingRowColor: WidgetStatePropertyAll<Color?>(t.surfaceMuted),
        dataRowMinHeight: 56,
        dataRowMaxHeight: 72,
        headingRowHeight: 48,
        headingTextStyle:
            AppTextStyles.labelSmall.copyWith(color: t.textSecondary),
        dataTextStyle: AppTextStyles.bodyMedium.copyWith(color: t.textPrimary),
        dividerThickness: AppBorders.width,
        columnSpacing: AppSpacing.xl,
        horizontalMargin: AppSpacing.lg,
      ),

      // -------------------------------------------------------------- Divider
      dividerTheme: DividerThemeData(
        color: t.borderSubtle,
        thickness: 1,
        space: 1,
      ),

      // -------------------------------------------------------------- Feedback
      // El snackbar es un aviso temporal sobre CUALQUIER fondo, así que se
      // invierte respecto al tema: crema sobre espresso en claro, casi negro
      // sobre crema en oscuro. En ambos casos el par supera 11:1.
      snackBarTheme: SnackBarThemeData(
        backgroundColor: t.heroPanel,
        contentTextStyle:
            AppTextStyles.bodyMedium.copyWith(color: t.textOnDark),
        actionTextColor: t.brandLight,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        insetPadding: const EdgeInsets.all(AppSpacing.lg),
      ),
      tooltipTheme: TooltipThemeData(
        waitDuration: const Duration(milliseconds: 500),
        textStyle: AppTextStyles.captionMedium.copyWith(color: t.textOnDark),
        decoration: BoxDecoration(
          color: t.heroPanel,
          borderRadius: BorderRadius.circular(AppRadii.sm),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: t.accent,
        linearTrackColor: t.surfaceSunken,
        circularTrackColor: t.surfaceSunken,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith<Color?>((Set<WidgetState> states) =>
            states.contains(WidgetState.selected) ? t.onAccent : t.textSecondary),
        trackColor: WidgetStateProperty.resolveWith<Color?>((Set<WidgetState> states) =>
            states.contains(WidgetState.selected) ? t.accent : t.surfaceSunken),
        trackOutlineColor: WidgetStatePropertyAll<Color?>(t.borderDefault),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color?>((Set<WidgetState> states) =>
            states.contains(WidgetState.selected) ? t.accent : null),
        checkColor: WidgetStatePropertyAll<Color>(t.onAccent),
        side: BorderSide(color: t.borderStrong, width: 1.5),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color?>((Set<WidgetState> states) =>
            states.contains(WidgetState.selected) ? t.accent : t.borderStrong),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: t.actionPrimary,
        foregroundColor: t.onActionPrimary,
        elevation: 2,
        focusElevation: 4,
        hoverElevation: 3,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.lg),
        ),
      ),

      // -------------------------------------------------------------- Listas
      listTileTheme: ListTileThemeData(
        iconColor: t.textSecondary,
        selectedTileColor: t.accentContainer,
        selectedColor: t.onAccentContainer,
        titleTextStyle: AppTextStyles.titleMedium.copyWith(color: t.textPrimary),
        subtitleTextStyle: AppTextStyles.bodySmall.copyWith(color: t.textSecondary),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        minVerticalPadding: AppSpacing.md,
      ),
      expansionTileTheme: ExpansionTileThemeData(
        iconColor: t.textSecondary,
        collapsedIconColor: t.textSecondary,
        textColor: t.textPrimary,
        collapsedTextColor: t.textPrimary,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
      ),

      // ------------------------------------------------------------- Moviles
      pageTransitionsTheme: const PageTransitionsTheme(
        builders: <TargetPlatform, PageTransitionsBuilder>{
          TargetPlatform.android: FadeUpwardsPageTransitionsBuilder(),
          TargetPlatform.iOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.linux: FadeUpwardsPageTransitionsBuilder(),
          TargetPlatform.macOS: CupertinoPageTransitionsBuilder(),
          TargetPlatform.windows: FadeUpwardsPageTransitionsBuilder(),
        },
      ),
    );
  }

  /// `TextTheme` de Material del modo, como punto de partida de la escala.
  ///
  /// Material separa el texto claro del oscuro en DOS campos ([Typography.black]
  /// y [Typography.white]). Elegir el del modo es lo que evita que un widget de
  /// Material que use `bodyMedium`/`labelLarge` directamente se painted con la
  /// tinta del modo contrario —el error que dejaba texto crema sobre crema en la
  /// barra inferior y en los `ListTile`.
  static TextTheme _baseTextTheme(Brightness brightness) {
    final Typography typography =
        Typography.material2021(platform: TargetPlatform.android);
    return brightness == Brightness.dark ? typography.white : typography.black;
  }

  /// Estilo base común a las tres familias de botón del tema.
  ///
  /// Alturas por `AppTapTarget`; radio pill; label `AppTextStyles.labelLarge`.
  static ButtonStyle _buttonStyle({
    required Color background,
    required Color foreground,
    required Color disabledBackground,
    required Color disabledForeground,
    required BorderSide? border,
    required Color overlay,
  }) {
    return ButtonStyle(
      backgroundColor: WidgetStateProperty.resolveWith<Color?>(
        (Set<WidgetState> states) =>
            states.contains(WidgetState.disabled) ? disabledBackground : background,
      ),
      foregroundColor: WidgetStateProperty.resolveWith<Color?>(
        (Set<WidgetState> states) =>
            states.contains(WidgetState.disabled) ? disabledForeground : foreground,
      ),
      overlayColor: WidgetStateProperty.resolveWith<Color?>(
        (Set<WidgetState> states) =>
            states.contains(WidgetState.pressed) ? overlay : null,
      ),
      side: border == null
          ? const WidgetStatePropertyAll<BorderSide?>(AppBorders.none)
          : WidgetStatePropertyAll<BorderSide?>(border),
      elevation: const WidgetStatePropertyAll<double>(0),
      minimumSize: const WidgetStatePropertyAll<Size>(Size(0, AppTapTarget.min)),
      padding: const WidgetStatePropertyAll<EdgeInsetsGeometry>(
        EdgeInsets.symmetric(horizontal: AppSpacing.xl),
      ),
      shape: const WidgetStatePropertyAll<OutlinedBorder>(StadiumBorder()),
      textStyle: const WidgetStatePropertyAll<TextStyle>(AppTextStyles.labelLarge),
      tapTargetSize: MaterialTapTargetSize.padded,
    );
  }
}
