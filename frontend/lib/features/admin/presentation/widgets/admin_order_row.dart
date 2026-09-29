// Fila de pedido en la tabla del panel. MÓDULO `features/admin/presentation/widgets`.
//
// UNA FILA = LO NECESARIO PARA DECIDIR
// Número, cliente o silla, estado, importe y si está cobrado. Todo lo demás
// (líneas, pagos, notas) está en el detalle. En una tabla con 100 filas, meter un
// campo más obliga a PredictiveText y deja de leerse.
//
// CADA COSA CON TRES CANALES
// El estado lleva `StatusBadge` (texto + ícono + color), el saldo lleva icono +
// palabra, y el importe lleva el símbolo de la moneda. Nada se comunica solo con
// el color (WCAG 1.4.1).

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/admin_catalog.dart';

/// Fila de pedido. `onTap` abre el detalle.
class AdminOrderRow extends StatelessWidget {
  const AdminOrderRow({required this.order, required this.onTap, super.key});

  final AdminOrder order;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final String? who = order.customerName ?? order.chairCode;
    final String semantic =
        'Pedido ${order.orderNumber}, estado ${_statusLabel(order.status)}, '
        'total ${CurrencyFormatter.formatMinor(order.totalMinor)}'
        '${order.hasBalance ? ', sin cobrar' : ''}';

    return Semantics(
      button: true,
      label: semantic,
      excludeSemantics: true,
      child: AppCard(
        variant: AppCardVariant.outlined,
        padding: const EdgeInsets.all(AppSpacing.md),
        onTap: onTap,
        semanticLabel: semantic,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    order.orderNumber,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.titleSmall,
                  ),
                ),
                StatusBadge.order(order.status, compact: true),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Row(
              children: <Widget>[
                if (who != null) ...<Widget>[
                  Icon(
                    order.customerName != null
                        ? Icons.person_outline_rounded
                        : Icons.event_seat_outlined,
                    size: 14,
                    color: context.tokens.textTertiary,
                  ),
                  const SizedBox(width: AppSpacing.xxs),
                  Flexible(
                    child: Text(
                      who,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.captionMedium
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.md),
                ],
                if (order.createdAt != null) ...<Widget>[
                  Icon(Icons.schedule_rounded,
                      size: 14, color: context.tokens.textTertiary),
                  const SizedBox(width: AppSpacing.xxs),
                  Text(
                    DateFormatter.dateTime(order.createdAt!),
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
                ],
                const Spacer(),
                PriceDisplay(currentMinor: order.totalMinor),
              ],
            ),
            if (order.hasBalance) ...<Widget>[
              const SizedBox(height: AppSpacing.sm),
              _UnpaidTag(balanceMinor: order.balanceMinor),
            ],
          ],
        ),
      ),
    );
  }

  /// Estado en palabras, para el `Semantics` (el visible lo pone el badge).
  static String _statusLabel(String status) =>
      const <String, String>{
        'PENDING': 'pendiente',
        'CONFIRMED': 'confirmado',
        'PREPARING': 'en preparación',
        'READY': 'listo',
        'COMPLETED': 'completado',
        'CANCELLED': 'cancelado',
        'REFUNDED': 'reembolsado',
      }[status] ??
      status.toLowerCase();
}

/// Etiqueta de pedido sin cobrar.
class _UnpaidTag extends StatelessWidget {
  const _UnpaidTag({required this.balanceMinor});

  final int balanceMinor;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Sin cobrar, quedan ${CurrencyFormatter.formatMinor(balanceMinor)}',
      excludeSemantics: true,
      child: Row(
        children: <Widget>[
          Icon(Icons.error_outline_rounded,
              size: 16, color: context.tokens.textWarning),
          const SizedBox(width: AppSpacing.xxs),
          Text(
            'Sin cobrar',
            style: AppTextStyles.labelMedium
                .copyWith(color: context.tokens.textWarning),
          ),
          const SizedBox(width: AppSpacing.xs),
          PriceDisplay(currentMinor: balanceMinor),
        ],
      ),
    );
  }
}


