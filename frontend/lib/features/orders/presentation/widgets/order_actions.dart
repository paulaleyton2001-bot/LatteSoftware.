// Acciones del pedido: ver el comprobante y qué hacer si hay que cancelar.
//
// CANCELAR SE EXPLICA, NO SE OFRECE COMO BOTÓN
// Un `CUSTOMER` sí tiene `orders:cancel` para su propio pedido, pero cancelar
// aquí dejaría el pago y la silla a medias: el pago lo revertiría el mostrador y
// la silla la liberaría el personal. Se explica en un diálogo en vez de ofrecer
// un botón que promete una cancelación que no se puede completar desde el
// cliente.
//
// EL COMPROBANTE NO ES UNA LLAMADA
// Se pinta como diálogo con el desglose que YA trae el detalle: no hace falta otra
// llamada para dar la información que importa, y `GET /orders/:id/receipt` está
// pensado para el mostrador.


import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/order_detail.dart';
import '../../domain/entities/order_item.dart';
import './order_blocks.dart';

/// Acciones del pedido: ver el comprobante y qué hacer si hay que cancelar.
///
/// CANCELAR SE EXPLICA, NO SE OFRECE COMO BOTÓN
/// Un `CUSTOMER` sí tiene `orders:cancel` para su propio pedido, pero cancelar
/// aquí dejaría el pago y la silla a medias: el pago lo revertiría el mostrador y
/// la silla la liberaría el personal. Se explica en un diálogo en vez de ofrecer
/// un botón que promete una cancelación que no se puede completar desde el
/// cliente.
class OrderActions extends StatelessWidget {
  const OrderActions({required this.order, super.key});

  final OrderDetail order;

  @override
  Widget build(BuildContext context) {
    final bool canCancel = !order.summary.isClosed &&
        !order.summary.isCancelled &&
        order.items.isNotEmpty;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AppButton(
          label: 'Ver comprobante',
          icon: Icons.receipt_long_rounded,
          variant: AppButtonVariant.secondary,
          isFullWidth: true,
          onPressed: () => _showReceipt(context),
        ),
        if (canCancel) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          AppButton(
            label: 'Cancelar pedido',
            icon: Icons.cancel_outlined,
            variant: AppButtonVariant.danger,
            isFullWidth: true,
            onPressed: () => _explainCancel(context),
          ),
        ],
      ],
    );
  }

  /// El comprobante se pinta como diálogo con el desglose que YA trae el
  /// detalle: no hace falta otra llamada para dar la información que importa, y
  /// `GET /orders/:id/receipt` está pensado para el mostrador.
  void _showReceipt(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        title: Text('Comprobante ${order.summary.orderNumber}'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              for (final OrderItem item in order.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                  child: Text(
                    '${item.quantity} × ${item.displayName} · '
                    '${CurrencyFormatter.formatMinor(item.lineTotalMinor)}',
                    style: AppTextStyles.bodySmall,
                  ),
                ),
              const SizedBox(height: AppSpacing.md),
              OrderTotalRow(label: 'Subtotal', value: order.subtotalMinor),
              if (order.discountMinor > 0)
                OrderTotalRow(
                  label: 'Descuento',
                  value: -order.discountMinor,
                  color: context.tokens.textSuccess,
                ),
              if (order.taxMinor > 0)
                OrderTotalRow(label: 'Impuestos', value: order.taxMinor),
              if (order.serviceFeeMinor > 0)
                OrderTotalRow(label: 'Cargo por servicio', value: order.serviceFeeMinor),
              const SizedBox(height: AppSpacing.sm),
              Row(
                children: <Widget>[
                  Expanded(child: Text('Total', style: AppTextStyles.titleSmall)),
                  PriceDisplay(
                    currentMinor: order.summary.totalMinor,
                    variant: PriceVariant.large,
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                'Se paga en el local, en efectivo o con tarjeta.',
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textSecondary),
              ),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            style: TextButton.styleFrom(minimumSize: const Size(0, 44)),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    );
  }

  void _explainCancel(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (BuildContext context) => AlertDialog(
        icon: const Icon(Icons.storefront_rounded),
        title: const Text('Cancela en el mostrador'),
        content: const Text(
          'Dile al personal el número del pedido y lo cancelan junto con el pago '
          'y la silla, en un solo paso. Así no queda nada a medias.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            style: TextButton.styleFrom(minimumSize: const Size(0, 44)),
            child: const Text('Entendido'),
          ),
        ],
      ),
    );
  }
}
