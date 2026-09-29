// Tarjeta de un pedido en la lista.
//
// QUÉ MUESTRA Y POR QUÉ ESOS CAMPOS
// - Número de pedido: es lo que se dice en el mostrador.
// - Estado: `StatusBadge.order` (texto + ícono + color, nunca solo color).
// - Fecha y hora: `DateFormatter.weekdayDateTime` ("lun 28 sep · 14:35"), el
//   formato que el design system fija para listas de pedidos.
// - Tipo y silla: "para llevar" / "consumir aquí" / "alquiler", porque un pedido
//   con alquiler de silla se gestiona distinto.
// - Total: `PriceDisplay` con los centavos del servidor.
//
// Si queda saldo (y en la app del cliente SIEMPRE queda hasta que alguien cobra en
// el mostrador) se dice explícitamente, para que nadie espere una pantalla de pago.



import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../app/routes.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/order_summary.dart';

/// Card de un pedido.
class OrderCard extends StatelessWidget {
  const OrderCard({required this.order, super.key});

  final OrderSummary order;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: () => context.push(AppRoutes.orderDetailFor(order.id)),
      semanticLabel: _spokenSummary(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  order.orderNumber,
                  style: AppTextStyles.titleMedium,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              StatusBadge.order(order.status, compact: true),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            order.placedAt == null
                ? 'Sin fecha'
                : DateFormatter.weekdayDateTime(order.placedAt!),
            style: AppTextStyles.captionMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: AppSpacing.xs,
            children: <Widget>[
              _Meta(icon: Icons.local_cafe_rounded, text: order.typeLabel),
              if (order.chairCode != null)
                _Meta(
                  icon: Icons.event_seat_rounded,
                  text: 'Silla ${order.chairCode}',
                ),
              if (order.itemCount > 0)
                _Meta(
                  icon: Icons.shopping_bag_outlined,
                  text: '${order.itemCount} '
                      '${order.itemCount == 1 ? 'producto' : 'productos'}',
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Divider(color: context.tokens.borderSubtle, height: 1),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: order.balanceMinor > 0
                    ? Text(
                        'Pendiente de pagar en el local: '
                        '${CurrencyFormatter.formatMinor(order.balanceMinor)}',
                        style: AppTextStyles.captionMedium
                            .copyWith(color: context.tokens.textWarning),
                      )
                    : Text(
                        'Pagado',
                        style: AppTextStyles.captionMedium
                            .copyWith(color: context.tokens.textSuccess),
                      ),
              ),
              const SizedBox(width: AppSpacing.sm),
              PriceDisplay(currentMinor: order.totalMinor),
              const SizedBox(width: AppSpacing.xxs),
              Icon(
                Icons.chevron_right_rounded,
                size: 18,
                color: context.tokens.textTertiary,
              ),
            ],
          ),
        ],
      ),
    );
  }

  /// Frase completa para el lector de pantalla, con todos los datos de la fila.
  String _spokenSummary() => 'Pedido ${order.orderNumber}, estado '
      '${order.status}, ${order.typeLabel}'
      '${order.chairCode == null ? '' : ', silla ${order.chairCode}'}, total '
      '${CurrencyFormatter.formatMinor(order.totalMinor)}';
}

/// Metadato con ícono + texto.
class _Meta extends StatelessWidget {
  const _Meta({required this.icon, required this.text});

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
          style: AppTextStyles.captionSmall
              .copyWith(color: context.tokens.textSecondary),
        ),
      ],
    );
  }
}
