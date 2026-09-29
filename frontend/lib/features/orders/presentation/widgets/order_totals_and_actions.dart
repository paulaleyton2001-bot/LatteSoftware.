// Totales, pagos y acciones del pedido. Módulo
// `features/orders/presentation/widgets`.
//
// SEPARADOS DE LAS LÍNEAS DE PRODUCTO
// Son tres bloques independientes: un desglose de importes, un historial de pagos y
// un conjunto de acciones. Cada uno tiene su propio estado y su propio vocabulario
// (dinero, métodos de pago, confirmación), y juntos en un archivo acababan
// mezclando "qué se cobra" con "qué se puede hacer".
//
// LOS IMPORTES SON DEL SERVIDOR
// `subtotalMinor`, `discountMinor`, `taxMinor`, `serviceFeeMinor` y `totalMinor`
// llegan calculados de `GET /orders/:id` (BR-ORDER-014). Aquí solo se formatean; no
// se recalcula nada, ni aunque "sea fácil".
//
// LA APP DEL CLIENTE NUNCA CREA PAGOS
// No hay pasarela. Esta tarjeta solo MUESTRA los que el personal registró en el
// mostrador, con su método y su estado, y recuerda el saldo que queda por pagar
// aquí.


import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/order_detail.dart';
import '../../domain/entities/payment_record.dart';
import './order_blocks.dart';

/// Totales del pedido, tal y como los devuelve el servidor.
class OrderTotalsCard extends StatelessWidget {
  const OrderTotalsCard({required this.order, super.key});

  final OrderDetail order;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Importes', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          OrderTotalRow(label: 'Subtotal', value: order.subtotalMinor),
          if (order.discountMinor > 0)
            OrderTotalRow(
              label: order.couponCode == null
                  ? 'Descuento'
                  : 'Cupón ${order.couponCode}',
              value: -order.discountMinor,
              color: context.tokens.textSuccess,
            ),
          if (order.taxMinor > 0)
            OrderTotalRow(label: 'Impuestos', value: order.taxMinor),
          if (order.serviceFeeMinor > 0)
            OrderTotalRow(label: 'Cargo por servicio', value: order.serviceFeeMinor),
          const SizedBox(height: AppSpacing.sm),
          Divider(color: context.tokens.borderSubtle, height: 1),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: <Widget>[
              Expanded(child: Text('Total', style: AppTextStyles.titleMedium)),
              PriceDisplay(
                currentMinor: order.summary.totalMinor,
                variant: PriceVariant.large,
                semanticLabel: 'Total del pedido: '
                    '${CurrencyFormatter.formatMinor(order.summary.totalMinor, withDecimals: true)}',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Pagos registrados en el mostrador.
///
/// La app del cliente NUNCA crea pagos: no hay pasarela. Esta tarjeta solo muestra
/// los que el personal registró, con su método y su estado, y recuerda el saldo que
/// queda por pagar aquí.
class OrderPaymentsCard extends StatelessWidget {
  const OrderPaymentsCard({required this.order, super.key});

  final OrderDetail order;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Icon(Icons.storefront_rounded, size: 18),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text('Pagado en el local', style: AppTextStyles.titleMedium),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          for (final PaymentRecord payment in order.payments)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Row(
                children: <Widget>[
                  StatusBadge.payment(payment.status, compact: true),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      '${payment.methodLabel}'
                      '${payment.approvedAt == null ? '' : ' · ${DateFormatter.date(payment.approvedAt!)}'}',
                      style: AppTextStyles.bodySmall,
                    ),
                  ),
                  PriceDisplay(
                    currentMinor: payment.amountMinor,
                    semanticLabel: '${payment.methodLabel}: '
                        '${CurrencyFormatter.formatMinor(payment.amountMinor)}',
                  ),
                ],
              ),
            ),
          if (order.balanceMinor > 0) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            OrderNote(
              icon: Icons.payments_rounded,
              text: 'Quedan ${CurrencyFormatter.formatMinor(order.balanceMinor)} '
                  'por pagar aquí, en efectivo o con tarjeta.',
            ),
          ],
        ],
      ),
    );
  }
}
