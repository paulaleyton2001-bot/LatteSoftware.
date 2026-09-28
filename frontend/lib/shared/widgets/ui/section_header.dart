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

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_spacing.dart';
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
    this.level = _SectionLevel.section,
    super.key,
  });

  final String title;

  /// Texto auxiliar bajo el título (conteo, descripción corta).
  final String? subtitle;

  /// Texto del enlace de acción. Sin `onAction` no se muestra.
  final String? actionLabel;

  final VoidCallback? onAction;

  final EdgeInsetsGeometry padding;

  /// `page` usa `headlineSmall` (título de pantalla), `section` usa
  /// `titleLarge` (título dentro de un scroll).
  final _SectionLevel level;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final showAction = actionLabel != null && onAction != null;

    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  title,
                  style: level == _SectionLevel.page
                      ? text.headlineSmall
                      : text.titleLarge,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                if (subtitle != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    subtitle!,
                    style: AppTextStyles.captionMedium
                        .copyWith(color: AppColors.textSecondary),
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
                foregroundColor: AppColors.actionPrimary,
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
    );
  }
}

/// Jerarquía del título. Privado: la API pública usa el named `SectionHeader`.
enum _SectionLevel {
  /// Título dentro de una pantalla con scroll.
  section,

  /// Título principal de una pantalla.
  page,
}
