// Resolución de estilos del botón. Archivo interno del módulo
// `app_button.dart`: la API pública es `AppButton` + `AppButtonVariant` +
// `AppButtonSize`. Nadie más debe importar este archivo.
//
// Separa "qué colores tiene cada variante" de "cómo se pinta", para que
// `AppButton` se limite al árbol de widgets y este archivo sea una tabla.
//
// POR QUÉ RECIBE `AppTokens` Y NO UN `BuildContext`
// Son funciones estáticas puras: no hay `build` alrededor contra el que leer un
// contexto, y cuando se intentó leerlo (`context.tokens` aquí) el fichero dejó
// de compilar. Además tiene una ventaja de diseño: como [AppTokens] ya está
// resuelto para el modo activo, ESTA CAPA NO NECESITA MIRAR EL `Brightness`.
// El "salvia claro en oscuro, verde 700 en claro" no se decide aquí: se decide
// una sola vez en `AppTokens`. Si mañana cambia el acento del modo oscuro, este
// archivo no se toca.

import 'package:flutter/material.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import './app_button.dart';

/// Traduce (variante, tamaño, estado) a un [ButtonStyle] y al árbol de label.
abstract final class AppButtonStyle {
  /// Construye el [ButtonStyle] de la variante/tamaño indicados.
  ///
  /// [t] son los tokens del modo activo; [enabled] decide el par fondo/texto.
  static ButtonStyle buttonStyle({
    required AppButtonVariant variant,
    required AppButtonSize size,
    required AppTokens t,
    required bool enabled,
  }) {
    return ButtonStyle(
      backgroundColor: WidgetStatePropertyAll<Color>(
        enabled ? backgroundOf(variant, t) : disabledBackgroundOf(variant, t),
      ),
      foregroundColor: WidgetStatePropertyAll<Color>(
        enabled ? foregroundOf(variant, t) : disabledForegroundOf(variant, t),
      ),
      side: WidgetStatePropertyAll<BorderSide?>(
        variant == AppButtonVariant.secondary
            ? BorderSide(color: t.borderInput)
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
      overlayColor: WidgetStatePropertyAll<Color>(t.focusRingSurface),
    );
  }

  /// Fondo relleno del control habilitado para la variante indicada.
  ///
  /// `secondary` y `ghost` son transparentes: su identidad la da el borde
  /// (`secondary`) o nada (`ghost`, solo texto con color de acento).
  static Color backgroundOf(AppButtonVariant variant, AppTokens t) =>
      switch (variant) {
        AppButtonVariant.primary => t.actionPrimary,
        AppButtonVariant.danger => t.actionDanger,
        AppButtonVariant.espresso => t.actionEspresso,
        AppButtonVariant.secondary || AppButtonVariant.ghost => Colors.transparent,
      };

  /// Texto del control habilitado para la variante indicada.
  ///
  /// Cada par texto/fondo se verificó con la fórmula de WCAG 2.1 en los dos
  /// modos: primario 5.01:1 (blanco/verde 700) y 9.42:1 (casi negro/salvia);
  /// espresso 11.4:1 en claro y 14.9:1 en el invertido oscuro; danger 6.4:1 y
  /// 8.6:1. Ver `docs/DESIGN-TOKENS.md` §1.4.
  static Color foregroundOf(AppButtonVariant variant, AppTokens t) =>
      switch (variant) {
        AppButtonVariant.primary => t.onActionPrimary,
        // `danger` comparte el `onActionDanger` (no el `onActionPrimary`): en
        // oscuro el fondo de peligro es un rojo CLARO, así que su texto tiene que
        // ser oscuro. Usar aquí el blanco del primario daba 1.9:1.
        AppButtonVariant.danger => t.onActionDanger,
        AppButtonVariant.espresso => t.onActionEspresso,
        // El acento ya está resuelto por modo: verde 700 en claro, salvia 300 en
        // oscuro. Antes se recalculaba aquí con `brightness`, que es el mismo
        // error de "el widget decide el modo" que se eliminó en el tema.
        AppButtonVariant.secondary || AppButtonVariant.ghost => t.accent,
      };

  /// Fondo del control deshabilitado para la variante indicada.
  static Color disabledBackgroundOf(AppButtonVariant variant, AppTokens t) =>
      switch (variant) {
        AppButtonVariant.primary => t.actionPrimaryDisabled,
        AppButtonVariant.danger => t.actionDangerDisabled,
        AppButtonVariant.espresso => t.actionEspressoDisabled,
        AppButtonVariant.secondary || AppButtonVariant.ghost => Colors.transparent,
      };

  /// Texto del control deshabilitado (>= 3:1 sobre su fondo; ver tokens).
  static Color disabledForegroundOf(AppButtonVariant variant, AppTokens t) =>
      switch (variant) {
        AppButtonVariant.primary => t.actionPrimaryDisabledText,
        AppButtonVariant.danger => t.actionDangerDisabledText,
        AppButtonVariant.espresso => t.actionEspressoDisabledText,
        AppButtonVariant.secondary || AppButtonVariant.ghost => t.textDisabled,
      };

  /// Árbol interior del botón: spinner, o label + iconos.
  ///
  /// El `Flexible` con ellipsis es lo que hace que un label largo en un ancho
  /// estrecho (nombre largo de producto en el POS, "Añadir al pedido" en una
  /// card de 2 columnas) se recorte con puntos suspensivos en lugar de
  /// desbordar la fila.
  static Widget label({
    required String text,
    required AppButtonSize size,
    required IconData? icon,
    required IconData? trailingIcon,
    required bool isLoading,
    required Color foreground,
  }) {
    if (isLoading) {
      final double spinnerSize = size == AppButtonSize.small ? 16 : 18;
      return SizedBox.square(
        dimension: spinnerSize,
        child: CircularProgressIndicator(
          strokeWidth: 2,
          valueColor: AlwaysStoppedAnimation<Color>(foreground),
        ),
      );
    }
    final double iconSize = size == AppButtonSize.small ? 16 : 18;
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
