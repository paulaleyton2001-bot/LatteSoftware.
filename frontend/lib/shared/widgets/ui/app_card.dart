// Card del sistema de diseño.
//
// Tres variantes que representan la intención, no el gusto:
//   - [AppCardVariant.elevated] — superficie que flota (sombra difusa).
//   - [AppCardVariant.outlined] — superficie delimitada por hairline (uso por
//     defecto en listas densas: menos ruido que N sombras).
//   - [AppCardVariant.flat] — sin borde ni sombra, solo grouping (dentro de otra
//     card, o celdas de una misma sección).
//
// Cuando hay `onTap` la card se vuelve un botón real: ripple, semántica de
// botón y target mínimo de 44 dp.


import 'package:flutter/material.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_shadows.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';

/// Intención visual de la card.
enum AppCardVariant {
  elevated,
  outlined,
  flat,
}

/// Card reutilizable. Inmutable y genérica (no conoce el dominio).
class AppCard extends StatelessWidget {
  const AppCard({
    required this.child,
    this.variant = AppCardVariant.outlined,
    this.padding = AppSpacing.cardPadding,
    this.margin,
    this.onTap,
    this.onLongPress,
    this.semanticLabel,
    this.width,
    this.height,
    this.color,
    this.borderRadius = AppRadii.lg,
    super.key,
  });

  final Widget child;
  final AppCardVariant variant;

  /// Padding interno. `EdgeInsets.zero` para cards de imagen a sangre.
  final EdgeInsetsGeometry padding;

  final EdgeInsetsGeometry? margin;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;

  /// Etiqueta para lectores de pantalla (obligatoria si el child es una imagen).
  final String? semanticLabel;

  final double? width;
  final double? height;

  /// Sobrescribe el color de superficie (p. ej. crema para filas agrupadas).
  final Color? color;
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    final surface = color ?? Theme.of(context).colorScheme.surface;
    final radius = BorderRadius.circular(borderRadius);

    final shadow = switch (variant) {
      AppCardVariant.elevated => AppShadows.level1,
      AppCardVariant.outlined || AppCardVariant.flat => AppShadows.none,
    };

    final Border? border = switch (variant) {
      AppCardVariant.outlined => Border.fromBorderSide(
          BorderSide(color: context.tokens.borderDefault, width: 1)),
      AppCardVariant.elevated || AppCardVariant.flat => null,
    };

    final content = DecoratedBox(
      decoration: BoxDecoration(
        color: surface,
        borderRadius: radius,
        boxShadow: shadow,
        border: border,
      ),
      child: ClipRRect(
        borderRadius: radius,
        child: Padding(padding: padding, child: child),
      ),
    );

    final box = onTap == null && onLongPress == null
        ? content
        : Material(
            type: MaterialType.transparency,
            child: InkWell(
              onTap: onTap,
              onLongPress: onLongPress,
              borderRadius: radius,
              splashColor: context.tokens.focusRingSurface,
              child: content,
            ),
          );

    final sized = SizedBox(width: width, height: height, child: box);

    return Semantics(
      button: onTap != null,
      label: semanticLabel,
      container: semanticLabel != null,
      child: Padding(padding: margin ?? EdgeInsets.zero, child: sized),
    );
  }
}
