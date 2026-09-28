// Resolución de estilos del botón. Archivo interno del módulo
// `app_button.dart`: la API pública es `AppButton` + `AppButtonVariant` +
// `AppButtonSize`. Nadie más debe importar este archivo.
//
// Separa "qué colores tiene cada variante" de "cómo se pinta", para que
// `AppButton` se limite al árbol de widgets y este archivo sea una tabla.

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import 'app_button.dart';

/// Traduce (variante, tamaño, estado) a un [ButtonStyle] y al árbol de label.
abstract final class AppButtonStyle {
  /// Construye el [ButtonStyle] de la variante/tamaño indicados.
  static ButtonStyle buttonStyle({
    required AppButtonVariant variant,
    required AppButtonSize size,
    required Brightness brightness,
    required bool enabled,
  }) {
    final dark = brightness == Brightness.dark;
    final accent = dark ? AppColors.brandLight : AppColors.actionPrimary;
    final background = switch (variant) {
      AppButtonVariant.primary => AppColors.actionPrimary,
      AppButtonVariant.secondary => Colors.transparent,
      AppButtonVariant.danger => AppColors.actionDanger,
      AppButtonVariant.ghost => Colors.transparent,
      AppButtonVariant.espresso => AppColors.actionEspresso,
    };
    final foreground = switch (variant) {
      AppButtonVariant.primary || AppButtonVariant.danger =>
        AppColors.onActionPrimary,
      AppButtonVariant.espresso => AppColors.textOnDark,
      AppButtonVariant.secondary || AppButtonVariant.ghost => accent,
    };
    final disabledBackground = disabledBackgroundOf(variant);
    final disabledForeground = disabledForegroundOf(variant);

    return ButtonStyle(
      backgroundColor: WidgetStatePropertyAll<Color>(
        enabled ? background : disabledBackground,
      ),
      foregroundColor: WidgetStatePropertyAll<Color>(
        enabled ? foreground : disabledForeground,
      ),
      side: WidgetStatePropertyAll<BorderSide?>(
        variant == AppButtonVariant.secondary
            ? const BorderSide(color: AppColors.borderInput)
            : BorderSide.none,
      ),
      minimumSize: WidgetStatePropertyAll<Size>(Size(0, size.height)),
      padding: WidgetStatePropertyAll<EdgeInsetsGeometry>(
        EdgeInsets.symmetric(horizontal: size.horizontalPadding),
      ),
      shape: const WidgetStatePropertyAll<OutlinedBorder>(StadiumBorder()),
      textStyle: WidgetStatePropertyAll<TextStyle>(size.textStyle),
      tapTargetSize: MaterialTapTargetSize.padded,
      elevation: const WidgetStatePropertyAll<double>(0),
      overlayColor: WidgetStatePropertyAll<Color>(AppColors.focusRingSurface),
    );
  }

  /// Texto del control habilitado para la variante indicada.
  ///
  /// Vive aquí (y no en `app_colors.dart`) porque depende de `brightness`:
  /// en modo oscuro el outline usa el salvia claro.
  static Color foregroundOf(AppButtonVariant variant, Brightness brightness) {
    final accent =
        brightness == Brightness.dark ? AppColors.brandLight : AppColors.actionPrimary;
    return switch (variant) {
      AppButtonVariant.primary => AppColors.onActionPrimary,
      AppButtonVariant.danger => AppColors.onActionPrimary,
      AppButtonVariant.espresso => AppColors.textOnDark,
      AppButtonVariant.secondary || AppButtonVariant.ghost => accent,
    };
  }

  /// Fondo del control deshabilitado para la variante indicada.
  static Color disabledBackgroundOf(AppButtonVariant variant) =>
      switch (variant) {
        AppButtonVariant.primary => AppColors.actionPrimaryDisabled,
        AppButtonVariant.danger => AppColors.actionDangerDisabled,
        AppButtonVariant.espresso => AppColors.actionEspressoDisabled,
        AppButtonVariant.secondary || AppButtonVariant.ghost =>
          Colors.transparent,
      };

  /// Texto del control deshabilitado (>= 3:1 sobre su fondo; ver tokens).
  static Color disabledForegroundOf(AppButtonVariant variant) =>
      switch (variant) {
        AppButtonVariant.primary => AppColors.actionPrimaryDisabledText,
        AppButtonVariant.danger => AppColors.actionDangerDisabledText,
        AppButtonVariant.espresso => AppColors.actionEspressoDisabledText,
        AppButtonVariant.secondary || AppButtonVariant.ghost =>
          AppColors.textDisabled,
      };

  /// Árbol interior del botón: spinner, o label + iconos.
  static Widget label({
    required String text,
    required AppButtonSize size,
    required IconData? icon,
    required IconData? trailingIcon,
    required bool isLoading,
    required Color foreground,
  }) {
    if (isLoading) {
      return SizedBox.square(
        dimension: size == AppButtonSize.small ? 16 : 18,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          valueColor: AlwaysStoppedAnimation<Color>(foreground),
        ),
      );
    }
    final iconSize = size == AppButtonSize.small ? 16 : 18;
    return Row(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: <Widget>[
        if (icon != null) ...<Widget>[
          Icon(icon, size: iconSize),
          const SizedBox(width: AppSpacing.sm),
        ],
        Flexible(
          child: Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            textAlign: TextAlign.center,
          ),
        ),
        if (trailingIcon != null) ...<Widget>[
          const SizedBox(width: AppSpacing.sm),
          Icon(trailingIcon, size: iconSize),
        ],
      ],
    );
  }

  /// `true` si la variante lleva fondo relleno (elige el widget base).
  static bool isFilled(AppButtonVariant variant) => switch (variant) {
        AppButtonVariant.primary ||
        AppButtonVariant.danger ||
        AppButtonVariant.espresso =>
          true,
        AppButtonVariant.secondary || AppButtonVariant.ghost => false,
      };

  /// Radio del contenido cuando se usa fuera de [StadiumBorder] (icon-button).
  static BorderRadius get radius => BorderRadius.circular(AppRadii.pill);
}
