// Tile de KPI del dashboard.
//
// Patrón de la referencia: label pequeño gris arriba, número grande en marrón
// espresso abajo y delta opcional con flecha + color.
//
// ```dart
// KpiTile(label: 'Ventas de hoy', value: r'$1.284.000', delta: 12.4,
//   icon: Icons.point_of_sale_rounded);
// ```
//
// REGLA: el `value` llega YA formateado (centavos → texto). Este widget no
// sabe de dinero: si el KPI es un porcentaje o un conteo, se pasa como texto.


import 'package:flutter/material.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import './app_card.dart';

/// Métrica destacada del dashboard o de un panel de admin.
class KpiTile extends StatelessWidget {
  const KpiTile({
    required this.label,
    required this.value,
    this.delta,
    this.deltaLabel,
    this.icon,
    this.accent,
    this.onTap,
    this.compact = false,
    super.key,
  });

  /// Label superior ("Ventas de hoy", "Sillas disponibles").
  final String label;

  /// Valor ya formateado (`'$1.284.000'`, `'12'`, `'38%'`).
  final String value;

  /// Variación porcentual respecto al período anterior.
  final double? delta;

  /// Texto del delta por defecto: `+12,4%`.
  final String? deltaLabel;

  final IconData? icon;

  /// Color de acento (ícono y borde superior de la card).
  ///
  /// `null` = el acento del modo activo (`actionPrimary`). NO se puede poner
  /// `context.tokens.actionPrimary` como valor por defecto de un parámetro: los
  /// valores por defecto se evalúan en tiempo de compilación, fuera de todo
  /// `BuildContext`. Se resuelve en el `build`.
  final Color? accent;

  final VoidCallback? onTap;

  /// `true` = versión sin ícono, para hileras estrechas (móvil).
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final Color accentColor = accent ?? context.tokens.actionPrimary;
    return AppCard(
      onTap: onTap,
      padding: const EdgeInsets.all(AppSpacing.lg),
      semanticLabel: '$label: $value',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              if (icon != null && !compact) ...<Widget>[
                Container(
                  padding: const EdgeInsets.all(AppSpacing.sm),
                  decoration: BoxDecoration(
                    color: accentColor.withOpacity(0.10),
                    borderRadius: BorderRadius.circular(AppSpacing.sm),
                  ),
                  child: Icon(icon, size: 18, color: accentColor),
                ),
                const SizedBox(width: AppSpacing.sm),
              ],
              Expanded(
                child: Text(
                  label,
                  style: AppTextStyles.labelMedium
                      .copyWith(color: context.tokens.textSecondary),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: AppTextStyles.displaySmall.copyWith(
                color: context.tokens.textPrimary,
              ),
              maxLines: 1,
            ),
          ),
          if (delta != null || deltaLabel != null) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            _DeltaChip(delta: delta, label: deltaLabel),
          ],
        ],
      ),
    );
  }
}

/// Delta positivo/negativo: flecha + color + texto (nunca solo color).
class _DeltaChip extends StatelessWidget {
  const _DeltaChip({required this.delta, required this.label});

  final double? delta;
  final String? label;

  @override
  Widget build(BuildContext context) {
    final positive = (delta ?? 0) >= 0;
    final color = positive ? context.tokens.textSuccess : context.tokens.textError;
    final text = label ??
        '${positive ? '+' : ''}${delta!.toStringAsFixed(1).replaceAll('.', ',')}%';

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Icon(
          positive ? Icons.trending_up_rounded : Icons.trending_down_rounded,
          size: 16,
          color: color,
        ),
        const SizedBox(width: AppSpacing.xs),
        Flexible(
          child: Text(
            text,
            style: AppTextStyles.captionMedium.copyWith(
              color: color,
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}
