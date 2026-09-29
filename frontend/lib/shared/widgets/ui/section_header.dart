// Cabecera de sección: título, subtítulo y enlace "ver todo".
//
// Cubre el patrón repetido en menú ("Bebidas" + "Ver todo"), en perfil
// ("Pedidos recientes") y en admin ("Productos" → "Gestionar").
//
// Uso típico:
// ```dart
// SectionHeader(
//   title: 'Bebidas calientes',
//   subtitle: '12 productos',
//   actionLabel: 'Ver todo',
//   onAction: () => context.push('/menu?category=hot'),
// );
// ```
//
// ─────────────────────────────────────────────────────────────────────────────
// LA JERARQUÍA VERTICAL: TÍTULO → SUBTÍTULO → CONTENIDO
// ─────────────────────────────────────────────────────────────────────────────
// El síntoma era «"Destacados" y "Los favoritos de la casa" casi pegados, y el
// subtítulo tocando la primera tarjeta». Venía de dos decisiones que están AQUÍ,
// no en la pantalla:
//
//   · `titleSubtitleGap` era `AppSpacing.xxs` (2 dp). Entre una línea de 22 dp y
//     una de 14 dp, 2 dp es "no hay separación": se leen como un solo párrafo.
//   · El `padding` de la cabecera terminaba en 0 en las pantallas que la usan
//     seguida de contenido, así que el subtítulo se quedaba pegado a lo que
//     venía después.
//
// Los dos son ahora PARÁMETROS con valor por defecto sensato, y el de abajo
// ([bottomSpacing]) se aplica dentro del widget para que ninguna pantalla pueda
// olvidarlo. La escala es la de `AppSpacing` y mantiene la relación de la
// jerarquía: 4 dp dentro del bloque título/subtítulo, 12 dp hacia el contenido.

import 'package:flutter/material.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';

/// Título de sección con acción opcional.
class SectionHeader extends StatelessWidget {
  const SectionHeader({
    required this.title,
    this.subtitle,
    this.actionLabel,
    this.onAction,
    this.padding = const EdgeInsets.fromLTRB(
      AppSpacing.lg,
      AppSpacing.lg,
      AppSpacing.sm,
      AppSpacing.sm,
    ),
    this.titleSubtitleGap = AppSpacing.xs,
    this.bottomSpacing = AppSpacing.md,
    this.level = SectionLevel.section,
    super.key,
  });

  final String title;

  /// Texto auxiliar bajo el título (conteo, descripción corta).
  final String? subtitle;

  /// Texto del enlace de acción. Sin `onAction` no se muestra.
  final String? actionLabel;

  final VoidCallback? onAction;

  final EdgeInsetsGeometry padding;

  /// Separación entre el título y su subtítulo. `AppSpacing.xs` (4 dp) es el
  /// mínimo que ya se lee como dos líneas; baja de ahí se funden.
  final double titleSubtitleGap;

  /// Separación entre la cabecera y el contenido que va debajo.
  ///
  /// Vive DENTRO del widget y no en el `padding` del caller a propósito: es la
  /// separación que se olvidó poner y la que hace que el subtítulo choque con la
  /// primera fila. Ponerla aquí hace que todas las pantallas que usan
  /// `SectionHeader` la hereden sin poder olvidarla.
  final double bottomSpacing;

  /// `page` usa `headlineSmall` (título de pantalla), `section` usa
  /// `titleLarge` (título dentro de un scroll).
  final SectionLevel level;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final showAction = actionLabel != null && onAction != null;

    return Padding(
      padding: padding,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      title,
                      style: level == SectionLevel.page
                          ? text.headlineSmall
                          : text.titleLarge,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitle != null) ...<Widget>[
                      SizedBox(height: titleSubtitleGap),
                      Text(
                        subtitle!,
                        style: AppTextStyles.captionMedium
                            .copyWith(color: context.tokens.textSecondary),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ],
                ),
              ),
              if (showAction)
                TextButton(
                  onPressed: onAction,
                  // Target táctil: el botón mide 40 de alto, pero el área
                  // pulsable se expande a 44 dp con el padding del tema.
                  style: TextButton.styleFrom(
                    foregroundColor: context.tokens.actionPrimary,
                    textStyle: AppTextStyles.labelLarge,
                    minimumSize: const Size(0, AppTapTarget.buttonMedium),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(actionLabel!),
                      const SizedBox(width: AppSpacing.xxs),
                      const Icon(Icons.chevron_right_rounded, size: 18),
                    ],
                  ),
                ),
            ],
          ),
          if (bottomSpacing > 0) SizedBox(height: bottomSpacing),
        ],
      ),
    );
  }
}

/// Jerarquía del título. La API pública usa el named `SectionHeader`.
enum SectionLevel {
  /// Título dentro de una pantalla con scroll.
  section,

  /// Título principal de una pantalla.
  page,
}
