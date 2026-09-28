// Botón del sistema de diseño: la acción de la app, sin excepciones.
//
// Variantes: `primary` (verde), `secondary` (outline), `danger` (rojo),
// `ghost` (solo texto), `espresso` (CTA del checkout).
// Tamaños: small/medium/large. Estados: `isLoading`, `onPressed == null`.
// La tabla de colores por variante vive en `app_button_style.dart`.

import 'package:flutter/material.dart';

import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';
import 'app_button_style.dart';

/// Variante visual del botón.
enum AppButtonVariant {
  /// Verde sólido, texto blanco. Acción principal de una pantalla.
  primary,

  /// Outline verde sobre crema. Acción secundaria.
  secondary,

  /// Rojo sólido. Acción destructiva (eliminar, cancelar, reembolsar).
  danger,

  /// Sin fondo, solo texto. Acción terciaria ("Ver todo", "Omitir").
  ghost,

  /// Marrón espresso sólido. CTA de alto peso (pie del checkout).
  espresso,
}

/// Tamaño del botón: altura, tipografía del label y padding horizontal.
enum AppButtonSize {
  /// 40 dp — acciones terciarias en cards y tablas.
  small(40, AppTextStyles.labelMedium, AppSpacing.md),
  /// 48 dp — valor por defecto de la app.
  medium(48, AppTextStyles.labelLarge, AppSpacing.lg),
  /// 56 dp — CTA de pantalla completa.
  large(56, AppTextStyles.labelLarge, AppSpacing.xl);

  const AppButtonSize(this.height, this.textStyle, this.horizontalPadding);

  /// Altura en dp.
  final double height;
  /// Estilo tipográfico del label.
  final TextStyle textStyle;
  /// Padding horizontal.
  final double horizontalPadding;
}

/// Botón tipado del sistema. Inmutable y sin estado propio.
class AppButton extends StatelessWidget {
  /// Crea un botón. `variant` define la intención; `isLoading` muestra spinner y
  /// bloquea la pulsación (por eso el assert del constructor).
  const AppButton({
    required this.label,
    required this.onPressed,
    this.variant = AppButtonVariant.primary,
    this.size = AppButtonSize.medium,
    this.icon,
    this.trailingIcon,
    this.isLoading = false,
    this.isFullWidth = false,
    this.tooltip,
    this.semanticLabel,
    super.key,
  }) : assert(
          !(isLoading && onPressed != null),
          'Botón en carga: pasa onPressed: null mientras isLoading sea true.',
        );

  /// Texto del botón. Vacío + icono = botón de icono (target mínimo 44 dp).
  final String label;

  /// Callback. `null` deshabilita (además de `isLoading`).
  final VoidCallback? onPressed;

  final AppButtonVariant variant;
  final AppButtonSize size;
  final IconData? icon;
  final IconData? trailingIcon;
  final bool isLoading;
  /// `true` ocupa todo el ancho disponible.
  final bool isFullWidth;
  /// Texto emergente para describir la acción.
  final String? tooltip;
  /// Etiqueta para lectores de pantalla si el texto visible no basta.
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !isLoading;
    final brightness = Theme.of(context).brightness;
    final foreground = enabled
        ? AppButtonStyle.foregroundOf(variant, brightness)
        : AppButtonStyle.disabledForegroundOf(variant);
    final style = AppButtonStyle.buttonStyle(
      variant: variant,
      size: size,
      brightness: brightness,
      enabled: enabled,
    );
    final child = AppButtonStyle.label(
      text: label,
      size: size,
      icon: icon,
      trailingIcon: trailingIcon,
      isLoading: isLoading,
      foreground: foreground,
    );

    final VoidCallback? callback = enabled ? onPressed : null;
    final button = switch (variant) {
      AppButtonVariant.primary ||
      AppButtonVariant.danger ||
      AppButtonVariant.espresso =>
        ElevatedButton(
          style: style,
          onPressed: callback,
          child: child,
        ),
      AppButtonVariant.secondary => OutlinedButton(
          style: style,
          onPressed: callback,
          child: child,
        ),
      AppButtonVariant.ghost => TextButton(
          style: style,
          onPressed: callback,
          child: child,
        ),
    };

    final sized = isFullWidth
        ? SizedBox(width: double.infinity, child: button)
        : button;

    return Semantics(
      button: true,
      enabled: enabled,
      // Un botón de solo ícono necesita `semanticLabel`; con texto visible no.
      label: semanticLabel ?? (label.isEmpty ? null : label),
      child: tooltip == null ? sized : Tooltip(message: tooltip!, child: sized),
    );
  }
}
