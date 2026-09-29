// Alertas de stock bajo del dashboard. MÓDULO `features/admin/presentation/widgets`.
//
// `GET /inventory/alerts` trae `severity`: `OUT` (agotado), `NEGATIVE` (por debajo
// de cero) o `LOW` (bajo el mínimo). La severidad se pinta con `StatusBadge` y con
// TEXTO, porque "amarillo y rojo" no le dice a nadie qué tiene que reponer hoy.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../data/models/json_reader.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/empty_state.dart';

/// Tarjeta de alertas de inventario.
class AdminInventoryAlertsCard extends StatelessWidget {
  const AdminInventoryAlertsCard({required this.alerts, super.key});

  /// Filas de `GET /inventory/alerts`.
  final List<Map<String, dynamic>> alerts;

  @override
  Widget build(BuildContext context) {
    if (alerts.isEmpty) {
      return const AppCard(
        child: EmptyState(
          icon: Icons.check_circle_outline_rounded,
          title: 'Todo en stock',
          message: 'Ningún insumo está por debajo del mínimo.',
          compact: true,
        ),
      );
    }

    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: <Widget>[
          for (int i = 0; i < alerts.length && i < 10; i++) ...<Widget>[
            if (i > 0) const Divider(height: 1),
            _AlertRow(alert: alerts[i]),
          ],
        ],
      ),
    );
  }
}

/// Fila de una alerta.
class _AlertRow extends StatelessWidget {
  const _AlertRow({required this.alert});

  final Map<String, dynamic> alert;

  @override
  Widget build(BuildContext context) {
    final String name = JsonReader.stringOr(alert['name'], 'Ítem');
    final String unit = JsonReader.stringOr(alert['unit'], 'UND');
    final double current = JsonReader.integerOr(alert['currentStock'], 0).toDouble();
    final double deficit = JsonReader.integerOr(alert['deficitQuantity'], 0).toDouble();
    final String severity = JsonReader.stringOr(alert['severity'], 'LOW');
    final bool isOut = severity == 'OUT' || severity == 'NEGATIVE';

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: <Widget>[
          Icon(
            isOut ? Icons.error_outline_rounded : Icons.warning_amber_rounded,
            size: 20,
            color: isOut ? context.tokens.textError : context.tokens.textWarning,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleSmall,
                ),
                Text(
                  isOut
                      ? 'Agotado'
                      : 'Faltan ${_qty(deficit)} $unit para el mínimo',
                  style: AppTextStyles.captionMedium.copyWith(
                    color: isOut ? context.tokens.textError : context.tokens.textWarning,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text('${_qty(current)} $unit', style: AppTextStyles.labelLarge),
        ],
      ),
    );
  }

  /// Cantidad legible: entera sin decimales, fraccional con uno.
  static String _qty(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(1);
}
