// Marca de la app: monograma redondeado verde + nombre.
//
// Reutilizada por la sidebar de escritorio, el login y el pie del POS. Al ser
// un solo componente, el logo se ve igual en toda la app.
//
// Uso típico:
// ```dart
// BrandMark(label: 'Latte Coffee');
// BrandMark(size: 48);            // solo monograma
// ```

import 'package:flutter/material.dart';

import '../../app/theme/app_colors.dart';
import '../../app/theme/app_radii.dart';
import '../../app/theme/app_typography.dart';

/// Monograma + nombre de la marca.
class BrandMark extends StatelessWidget {
  const BrandMark({this.size = 40, this.label, this.letter = 'L', super.key});

  /// Alto/lado del monograma.
  final double size;

  /// Nombre de la marca. `null` = solo el monograma.
  final String? label;

  /// Inicial del monograma.
  final String letter;

  @override
  Widget build(BuildContext context) {
    final mark = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: AppColors.brand,
        borderRadius: BorderRadius.circular(AppRadii.md),
      ),
      child: Text(
        letter,
        style: AppTextStyles.titleLarge.copyWith(
          color: AppColors.actionEspresso,
          fontWeight: FontWeight.w800,
        ),
      ),
    );

    if (label == null) {
      return Semantics(label: 'Latte Coffee', image: true, child: mark);
    }
    return Semantics(
      label: 'Latte Coffee',
      header: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          mark,
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              label!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppTextStyles.titleLarge,
            ),
          ),
        ],
      ),
    );
  }
}
