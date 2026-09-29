// Leyenda del mapa de sillas. Módulo `features/checkout/presentation/widgets`.
//
// POR QUÉ ES OBLIGATORIA Y POR QUÉ ES UN ARCHIVO APARTE
// Sin leyenda, el color de una celda no significa nada para quien no conoce el
// vocabulario, y la regla de "nunca solo color" se cumpliría DENTRO de la celda pero
// no en la lectura de conjunto. Además, la usan el checkout y la pestaña «Silla», y
// es idéntica en las dos.
//
// LOS ESTADOS QUE SE PINTAN SON SIEMPRE LOS MISMOS
// Aunque el mapa no tenga sillas en un estado, la leyenda lo muestra con su
// nombre y sin número. Si la leyenda apareciera y desapareciera al refrescar, quien
// la estuviera leyendo perdería la referencia justo cuando acaba de cambiar algo.
//
// EL COLOR LO PONE EL CATÁLOGO, NO ESTE ARCHIVO
// `forChair(status)` es el ÚNICO lugar de la app que traduce `ChairStatus` a
// color + ícono + texto (docs/DESIGN-TOKENS §6.1).

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/chair_map.dart';
// `forChair` es una función TOP-LEVEL del resolver, no un método de
// `StatusBadge`, y el `show` de `status_badge.dart` no la reexporta.
import '../../../../shared/widgets/ui/status_badge_resolver.dart';
import '../../../../shared/widgets/ui/status_badge_visuals.dart';



/// Leyenda del mapa. Es OBLIGATORIA: sin ella, el color de la celda no tiene
/// significado para quien no conoce el vocabulario, y el requisito de "nunca
/// solo color" se cumple dentro de la celda pero no en la lectura de conjunto.
class ChairMapLegend extends StatelessWidget {
  const ChairMapLegend({required this.map, super.key});

  final ChairMap map;

  /// Estados que se pintan siempre, en el orden del design system, aunque el
  /// mapa no tenga sillas en ese estado: así la leyenda no "aparece y desaparece"
  /// al refrescar.
  static const List<String> _order = <String>[
    'AVAILABLE',
    'OCCUPIED',
    'RESERVED',
    'CLEANING',
    'MAINTENANCE',
    'BLOCKED',
  ];

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'Leyenda del mapa de sillas',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Leyenda',
            style: AppTextStyles.labelMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: AppSpacing.xs,
            children: <Widget>[
              for (final String status in _order)
                _LegendItem(
                  status: status,
                  count: map.countsByStatus[status],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Entrada de la leyenda: muestra + texto + (conteo si lo hay).
class _LegendItem extends StatelessWidget {
  const _LegendItem({required this.status, this.count});

  final String status;
  final int? count;

  @override
  Widget build(BuildContext context) {
    final AppStatusVisual visual = forChair(status);
    // Colores resueltos contra el tema activo: el catálogo solo guarda la clave.
    final StatusColors colors = statusColorsOf(context, visual.palette);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Container(
          width: 14,
          height: 14,
          decoration: BoxDecoration(
            color: colors.surface,
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: context.tokens.borderSubtle),
          ),
          child: Icon(visual.icon, size: 10, color: colors.text),
        ),
        const SizedBox(width: AppSpacing.xs),
        Text(
          count == null ? visual.label : '${visual.label} ($count)',
          style: AppTextStyles.captionMedium
              .copyWith(color: context.tokens.textSecondary),
        ),
      ],
    );
  }
}

