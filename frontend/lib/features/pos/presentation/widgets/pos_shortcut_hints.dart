// Fila de atajos del mostrador. MÓDULO `pos/presentation/widgets`.
//
// LOS ATAJOS SE VEN O NO EXISTEN
// Un atajo invisible es un atajo que nadie descubre: el cajero nuevo no sabe que
// `F1` lo lleva al buscador. Por eso van rotos a la vista, al lado del control que
// aceleran, y no en un diálogo de ayuda.
//
// LA TECLA PARECE UNA TECLA
// Fondo hundido, borde y texto en versalitas: sin eso, "F1 buscar" se lee como una
// frase y no como un atajo. Se usa `AppTextStyles.labelSmall` (MAYÚSCULAS por
// definición en la escala) en vez de un `fontFamily` monoespaciado, que la norma de
// tipografía no admite.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/constants/app_strings.dart';

/// Fila de atajos visibles. Es un requisito del producto: si el atajo no se ve,
/// no existe.
class PosShortcutHintRow extends StatelessWidget {
  const PosShortcutHintRow();

  @override
  Widget build(BuildContext context) {
    const List<(String, String)> hints = <(String, String)>[
      (AppStrings.shortcutSearch, 'buscar'),
      (AppStrings.shortcutCharge, 'cobrar'),
      (AppStrings.shortcutNewOrder, 'nuevo'),
      (AppStrings.shortcutCancel, 'cerrar'),
    ];
    final String spoken = hints
        .map(((String, String) h) => '${h.$1} ${h.$2}')
        .join(', ');
    return Semantics(
      label: 'Atajos de teclado: $spoken',
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
        child: Wrap(
          alignment: WrapAlignment.center,
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.xs,
          children: <Widget>[
            for (final (String, String) hint in hints)
              PosKeyCap(shortcut: hint.$1, action: hint.$2),
          ],
        ),
      ),
    );
  }
}

/// Tecla + acción. La tecla se ve monoespaciada para que se lea como tecla.
class PosKeyCap extends StatelessWidget {
  const PosKeyCap({required this.shortcut, required this.action});

  /// Texto de la tecla. NO se llama `key` porque `Widget` ya tiene un miembro
  /// `key`, y un campo con ese nombre lo ocultaría.
  final String shortcut;

  final String action;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.sm,
            vertical: AppSpacing.xxs,
          ),
          decoration: BoxDecoration(
            color: context.tokens.surfaceSunken,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: context.tokens.borderDefault),
          ),
          child: Text(
            shortcut,
            style: AppTextStyles.labelSmall
                .copyWith(color: context.tokens.textStrong),
          ),
        ),
        const SizedBox(width: AppSpacing.xs),
        Text(
          action,
          style: AppTextStyles.captionSmall
              .copyWith(color: context.tokens.textSecondary),
        ),
      ],
    );
  }
}
