// Bloques de productos, importes, pagos y acciones del pedido.
// Módulo `features/orders/presentation/widgets`.
//
// Van aparte del `order_detail_page.dart` por tamaño y porque son piezas
// reutilizables: el diálogo del comprobante usa las mismas filas de total que la
// tarjeta de importes, y duplicarlas haría que un cambio de formato se aplicara a
// un sitio y no al otro.
//
// LOS IMPORTES SON DEL SERVIDOR
// `subtotalMinor`, `discountMinor`, `taxMinor`, `serviceFeeMinor` y
// `totalMinor` llegan calculados de `GET /orders/:id` (BR-ORDER-014). Aquí solo se
// formatean; no se recalcula nada, ni aunque "sea fácil".


import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../domain/entities/order_detail.dart';
import '../../domain/entities/order_item.dart';

/// Lista de productos del pedido, con sus extras y sus notas.
class OrderItemsCard extends StatelessWidget {
  const OrderItemsCard({required this.order, super.key});

  final OrderDetail order;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Productos', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          for (final OrderItem item in order.items)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: _ItemRow(item: item),
            ),
          if (order.items.isEmpty)
            Text(
              'Este pedido no tiene productos (es solo alquiler de silla).',
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
        ],
      ),
    );
  }
}

/// Una línea de producto.
class _ItemRow extends StatelessWidget {
  const _ItemRow({required this.item});

  final OrderItem item;

  @override
  Widget build(BuildContext context) {
    final String extras = item.addons
        .map(
          (OrderItemAddon a) =>
              '${a.quantity > 1 ? '${a.quantity} × ' : ''}${a.name}',
        )
        .join(' · ');

    return Semantics(
      label: '${item.quantity} × ${item.displayName}, '
          '${CurrencyFormatter.formatMinor(item.lineTotalMinor)}',
      excludeSemantics: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 32,
            child: Text(
              '${item.quantity}×',
              style: AppTextStyles.labelMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(item.displayName, style: AppTextStyles.bodyMedium),
                if (extras.isNotEmpty)
                  Text(
                    extras,
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                if (item.notes != null && item.notes!.isNotEmpty)
                  Text(
                    '“${item.notes}”',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            CurrencyFormatter.formatMinor(item.lineTotalMinor),
            style: AppTextStyles.price,
          ),
        ],
      ),
    );
  }
}
