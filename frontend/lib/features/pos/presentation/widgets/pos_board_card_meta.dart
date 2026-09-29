// Chips de metadato de la tarjeta del tablero.
// MÓDULO `pos/presentation/widgets`.
//
// Ícono + texto en 14 px, con `maxLines: 1` y elipsis. Sin `maxLines` un nombre
// largo de cliente rompe la fila de `Wrap` y empuja el resto de chips fuera de la
// tarjeta.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';

/// Metadato pequeño con ícono.
class PosBoardMetaChip extends StatelessWidget {
  const PosBoardMetaChip({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(icon, size: 14, color: context.tokens.textTertiary),
        const SizedBox(width: AppSpacing.xxs),
        Text(
          text,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppTextStyles.captionSmall
              .copyWith(color: context.tokens.textTertiary),
        ),
      ],
    );
  }
}
