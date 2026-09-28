// `ThemeData` completo de "Latte Coffee".
//
// Un solo lugar donde se cablea el tema: `main.dart` → `MaterialApp.router`
// con `theme: AppTheme.light` y `darkTheme: AppTheme.dark`.
//
// Estrategia de color: `ColorScheme.fromSeed` con la salvia de marca y luego
// `copyWith` para fijar los roles a los tokens verificados de [AppColors].
// `fromSeed` garantiza coherencia tonal de los roles que no enumeramos; el
// `copyWith` garantiza que los roles críticos respetan los contrastes del doc.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'app_colors.dart';
import 'app_radii.dart';
import 'app_shadows.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

abstract final class AppTheme {
  /// Tema claro. Es el tema de referencia del producto.
  static ThemeData get light => _build(Brightness.light);

  /// Tema oscuro. Placeholder coherente (no improvisado): misma familia
  /// cromática, superficies espresso invertidas y acentos salvia claros.
  static ThemeData get dark => _build(Brightness.dark);

  /// Tema según la preferencia del sistema.
  static ThemeData of(BuildContext context) =>
      Theme.of(context).brightness == Brightness.dark ? dark : light;

  // ------------------------------------------------------------------ Builder
  static ThemeData _build(Brightness brightness) {
    final isDark = brightness == Brightness.dark;

    // --- Superficies del modo oscuro: marrones muy oscuros, no gris neutro.
    final scaffoldBg = isDark ? AppPalette.ink : AppPalette.background;
    final cardBg = isDark ? const Color(0xFF4A382C) : AppPalette.surface;
    final mutedBg = isDark ? const Color(0xFF584438) : AppPalette.surfaceMuted;
    final borderColor =
        isDark ? const Color(0xFF6B584A) : AppPalette.borderSubtle;
    final borderStrongColor =
        isDark ? const Color(0xFF9C8B7C) : AppPalette.borderStrong;
    final inputBorderColor =
        isDark ? const Color(0xFF7C6A5C) : AppPalette.borderInput;
    final primaryText =
        isDark ? const Color(0xFFF5EFE6) : AppPalette.ink;
    final secondaryText =
        isDark ? const Color(0xFFC9BCAE) : AppPalette.textSecondary;

    final scheme = ColorScheme.fromSeed(
      seedColor: AppPalette.sage,
      brightness: brightness,
    ).copyWith(
      primary: isDark ? AppPalette.sageLight : AppPalette.green700,
      onPrimary: isDark ? AppPalette.ink : AppPalette.surface,
      primaryContainer: isDark ? AppPalette.greenMuted : AppPalette.greenSubtle,
      onPrimaryContainer: isDark ? AppPalette.ink : AppPalette.green950,
      secondary: AppPalette.sageDark,
      onSecondary: AppPalette.surface,
      secondaryContainer: isDark ? AppPalette.greenMuted : AppPalette.greenSubtle,
      onSecondaryContainer: AppPalette.green950,
      tertiary: AppPalette.warningSoft,
      onTertiary: AppPalette.ink,
      error: AppPalette.errorDark,
      onError: AppPalette.surface,
      errorContainer: AppPalette.errorSubtle,
      onErrorContainer: AppPalette.errorText,
      surface: cardBg,
      onSurface: primaryText,
      surfaceContainerLowest: scaffoldBg,
      surfaceContainerLow: mutedBg,
      surfaceContainer: isDark ? const Color(0xFF403027) : AppPalette.surfaceSunken,
      surfaceContainerHigh: mutedBg,
      surfaceContainerHighest: mutedBg,
      onSurfaceVariant: secondaryText,
      outline: borderStrongColor,
      outlineVariant: borderColor,
      shadow: AppPalette.ink,
      scrim: AppColors.scrim,
      inverseSurface: AppPalette.ink,
      onInverseSurface: AppColors.textOnDark,
    );

    final textTheme = buildAppTextTheme(
      Typography.material2021(platform: TargetPlatform.android).black.apply(
        bodyColor: primaryText,
        displayColor: primaryText,
      ),
    );

    final darkTextTheme = textTheme.apply(
      bodyColor: primaryText,
      displayColor: primaryText,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: scaffoldBg,
      canvasColor: cardBg,
      textTheme: isDark ? darkTextTheme : textTheme,
      fontFamily: null, // Sans-serif del sistema (sin dependencia de red).
      visualDensity: VisualDensity.standard,
      materialTapTargetSize: MaterialTapTargetSize.padded, // target >= 48dp
      splashFactory: InkSparkle.splashFactory,

      // ------------------------------------------------------------------ AppBar
      appBarTheme: AppBarTheme(
        backgroundColor: scaffoldBg,
        foregroundColor: primaryText,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: AppTextStyles.headlineSmall.copyWith(color: primaryText),
        iconTheme: IconThemeData(color: primaryText, size: 24),
        actionsIconTheme: IconThemeData(color: primaryText, size: 24),
        systemOverlayStyle: isDark
            ? SystemUiOverlayStyle.light
            : SystemUiOverlayStyle.dark,
      ),

      // ------------------------------------------------------------------- Card
      cardTheme: CardTheme(
        color: cardBg,
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
          background: scheme.primary,
          foreground: scheme.onPrimary,
          disabledBackground: isDark
              ? const Color(0xFF3E5A4C)
              : AppColors.actionPrimaryDisabled,
          disabledForeground: isDark
              ? const Color(0xFFAFC0B6)
              : AppPalette.textOnDisabled,
          border: null,
          elevation: 0,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: _buttonStyle(
          background: Colors.transparent,
          foreground: isDark ? AppPalette.sageLight : AppPalette.green700,
          disabledBackground: Colors.transparent,
          disabledForeground: AppPalette.textDisabled,
          border: BorderSide(
            color: isDark ? AppPalette.sageLight : AppPalette.borderInput,
            width: AppBorders.width,
          ),
          elevation: 0,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: _buttonStyle(
          background: Colors.transparent,
          foreground: isDark ? AppPalette.sageLight : AppPalette.green700,
          disabledBackground: Colors.transparent,
          disabledForeground: AppPalette.textDisabled,
          border: null,
          elevation: 0,
        ),
      ),

      // ------------------------------------------------------------------ Input
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isDark ? mutedBg : AppPalette.surface,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        hintStyle: AppTextStyles.bodyMedium.copyWith(color: AppPalette.textMuted),
        labelStyle: AppTextStyles.titleSmall.copyWith(color: secondaryText),
        floatingLabelStyle: AppTextStyles.titleSmall.copyWith(color: scheme.primary),
        helperStyle: AppTextStyles.captionMedium.copyWith(color: secondaryText),
        // `errorText` se sobreescribe por AppTextField con el token de error.
        errorStyle: AppTextStyles.captionMedium
            .copyWith(color: isDark ? AppPalette.errorSoft : AppPalette.errorText),
        errorMaxLines: 2,
        prefixIconColor: secondaryText,
        suffixIconColor: secondaryText,
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: BorderSide(color: inputBorderColor, width: 1),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: const BorderSide(color: AppPalette.focusRing, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: const BorderSide(color: AppPalette.errorDark, width: 1),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: const BorderSide(color: AppPalette.errorDark, width: 2),
        ),
        disabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
          borderSide: BorderSide(color: borderColor, width: 1),
        ),
        focusedBorderWidth: 2,
      ),

      // ------------------------------------------------------------------- Chip
      chipTheme: ChipThemeData(
        backgroundColor: isDark ? mutedBg : AppPalette.surfaceMuted,
        selectedColor: AppPalette.greenSubtle,
        disabledColor: borderColor,
        labelStyle: AppTextStyles.labelLarge.copyWith(color: secondaryText),
        secondaryLabelStyle:
            AppTextStyles.labelLarge.copyWith(color: AppPalette.green950),
        side: const BorderSide(color: AppPalette.borderDefault, width: 1),
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.sm,
        ),
      ),

      // --------------------------------------------------------- Navegación
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: cardBg,
        surfaceTintColor: Colors.transparent,
        indicatorColor: AppPalette.greenSubtle,
        elevation: 0,
        height: 68,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        iconTheme: WidgetStateProperty.resolveWith<IconThemeData>(
          (states) => IconThemeData(
            size: 24,
            color: states.contains(WidgetState.selected)
                ? (isDark ? AppPalette.sageLight : AppPalette.green700)
                : secondaryText,
          ),
        ),
        labelTextStyle: WidgetStateProperty.resolveWith<TextStyle>(
          (states) => AppTextStyles.labelSmall.copyWith(
            fontSize: 11,
            letterSpacing: 0.1,
            color: states.contains(WidgetState.selected)
                ? (isDark ? AppPalette.sageLight : AppPalette.green700)
                : AppPalette.textSecondary,
          ),
        ),
      ),
      navigationRailTheme: NavigationRailThemeData(
        backgroundColor: cardBg,
        indicatorColor: AppPalette.greenSubtle,
        selectedIconTheme: IconThemeData(
          color: isDark ? AppPalette.ink : AppPalette.green700,
          size: 24,
        ),
        unselectedIconTheme: IconThemeData(color: secondaryText, size: 24),
        selectedLabelTextStyle:
            AppTextStyles.labelMedium.copyWith(color: AppPalette.green950),
        unselectedLabelTextStyle:
            AppTextStyles.labelMedium.copyWith(color: secondaryText),
        useIndicator: true,
      ),

      // ----------------------------------------------------------------- Dialog
      dialogTheme: DialogTheme(
        backgroundColor: cardBg,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        titleTextStyle: AppTextStyles.headlineSmall.copyWith(color: primaryText),
        contentTextStyle: AppTextStyles.bodyMedium.copyWith(color: secondaryText),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.xl),
        ),
      ),

      // ----------------------------------------------------------------- Sheets
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: cardBg,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: cardBg,
        elevation: 0,
        showDragHandle: true,
        dragHandleColor: borderStrongColor,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadii.xxl)),
        ),
      ),

      // -------------------------------------------------------- Tabla (admin)
      dataTableTheme: DataTableThemeData(
        headingRowColor: WidgetStatePropertyAll<Color?>(AppPalette.surfaceMuted),
        dataRowMinHeight: 56,
        dataRowMaxHeight: 72,
        headingRowHeight: 48,
        headingTextStyle:
            AppTextStyles.labelSmall.copyWith(color: AppPalette.textSecondary),
        dataTextStyle: AppTextStyles.bodyMedium.copyWith(color: primaryText),
        dividerThickness: AppBorders.width,
        dividerColor: borderColor,
        columnSpacing: AppSpacing.xl,
        horizontalMargin: AppSpacing.lg,
        checkboxTheme: CheckboxThemeData(
          fillColor: WidgetStateProperty.resolveWith<Color?>((states) =>
              states.contains(WidgetState.selected)
                  ? scheme.primary
                  : Colors.transparent),
          checkColor: const WidgetStatePropertyAll<Color>(AppPalette.surface),
          side: BorderSide(color: borderStrongColor, width: 1.5),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppRadii.sm),
          ),
        ),
      ),

      // -------------------------------------------------------------- Divider
      dividerTheme: DividerThemeData(
        color: borderColor,
        thickness: 1,
        space: 1,
      ),

      // -------------------------------------------------------------- Feedback
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppPalette.ink,
        contentTextStyle: AppTextStyles.bodyMedium
            .copyWith(color: AppColors.textOnDark),
        actionTextColor: AppPalette.sageLight,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        insetPadding: const EdgeInsets.all(AppSpacing.lg),
      ),
      tooltipTheme: TooltipThemeData(
        waitDuration: const Duration(milliseconds: 500),
        textStyle: AppTextStyles.captionMedium
            .copyWith(color: AppColors.textOnDark),
        decoration: BoxDecoration(
          color: AppPalette.ink,
          borderRadius: BorderRadius.circular(AppRadii.sm),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: isDark ? AppPalette.sageLight : AppPalette.green700,
        linearTrackColor: AppPalette.surfaceSunken,
        circularTrackColor: AppPalette.surfaceSunken,
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith<Color?>((states) =>
            states.contains(WidgetState.selected)
                ? AppPalette.surface
                : AppPalette.textSecondary),
        trackColor: WidgetStateProperty.resolveWith<Color?>((states) =>
            states.contains(WidgetState.selected)
                ? scheme.primary
                : AppPalette.surfaceSunken),
        trackOutlineColor: WidgetStatePropertyAll<Color?>(borderColor),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith<Color?>((states) =>
            states.contains(WidgetState.selected) ? scheme.primary : null),
        checkColor: const WidgetStatePropertyAll<Color>(AppPalette.surface),
        side: BorderSide(color: borderStrongColor, width: 1.5),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: scheme.primary,
        foregroundColor: scheme.onPrimary,
        elevation: 2,
        focusElevation: 4,
        hoverElevation: 3,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.lg),
        ),
      ),

      // -------------------------------------------------------------- Listas
      listTileTheme: ListTileThemeData(
        iconColor: secondaryText,
        titleTextStyle: AppTextStyles.titleMedium.copyWith(color: primaryText),
        subtitleTextStyle: AppTextStyles.bodySmall.copyWith(color: secondaryText),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppRadii.md),
        ),
        minVerticalPadding: AppSpacing.md,
      ),
      expansionTileTheme: ExpansionTileThemeData(
        iconColor: secondaryText,
        collapsedIconColor: secondaryText,
        textColor: primaryText,
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

  /// Estilo base común a las tres familias de botón del tema.
  ///
  /// Alturas por `AppTapTarget`; radio pill; label `AppTextStyles.labelLarge`.
  static ButtonStyle _buttonStyle({
    required Color background,
    required Color foreground,
    required Color disabledBackground,
    required Color disabledForeground,
    required BorderSide? border,
    required double elevation,
  }) {
    return ButtonStyle(
      backgroundColor: WidgetStateProperty.resolveWith<Color?>(
        (states) => states.contains(WidgetState.disabled)
            ? disabledBackground
            : background,
      ),
      foregroundColor: WidgetStateProperty.resolveWith<Color?>(
        (states) => states.contains(WidgetState.disabled)
            ? disabledForeground
            : foreground,
      ),
      overlayColor: WidgetStateProperty.resolveWith<Color?>(
        (states) => states.contains(WidgetState.pressed)
            ? const Color(0x1F000000)
            : null,
      ),
      side: border == null
          ? WidgetStatePropertyAll<BorderSide?>(AppBorders.none)
          : WidgetStatePropertyAll<BorderSide?>(border),
      elevation: WidgetStatePropertyAll<double>(elevation),
      minimumSize: const WidgetStatePropertyAll<Size>(Size(0, AppTapTarget.min)),
      padding: const WidgetStatePropertyAll<EdgeInsetsGeometry>(
        EdgeInsets.symmetric(horizontal: AppSpacing.xl),
      ),
      shape: WidgetStatePropertyAll<OutlinedBorder>(const StadiumBorder()),
      textStyle: const WidgetStatePropertyAll<TextStyle>(AppTextStyles.labelLarge),
      tapTargetSize: MaterialTapTargetSize.padded,
    );
  }
}
