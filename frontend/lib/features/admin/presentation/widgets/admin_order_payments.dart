// Pagos y reembolsos de un pedido. MÓDULO `features/admin/presentation/widgets`.
//
// LA REFERENCIA DEL DATÁFONO SE MUESTRA SIEMPRE
// Es el único vínculo entre el cobro físico y el registro del sistema. En un
// cierre de caja es lo que permite conciliar, así que va visible en el detalle y
// no escondida tras un desplegable.
//
// No hay pasarela: `provider` es `CASH_REGISTRY` y `providerReference` es el
// número que el cajero copió del ticket del datáfono.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/admin_order_detail.dart';

/// Pagos del pedido, con la referencia del datáfono cuando la hay.
class AdminOrderPayments extends StatelessWidget {
  const AdminOrderPayments({required this.payments});

  final List<AdminOrderPayment> payments;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text('Pagos', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          for (final AdminOrderPayment payment in payments)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Row(
                children: <Widget>[
                  Icon(
                    payment.method == 'CASH'
                        ? Icons.payments_rounded
                        : Icons.credit_card_rounded,
                    size: 18,
                    color: context.tokens.textSecondary,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          payment.paymentNumber ?? 'Pago #${payment.id}',
                          style: AppTextStyles.bodyMedium,
                        ),
                        if (payment.providerReference != null)
                          Text(
                            'Ref. ${payment.providerReference}',
                            style: AppTextStyles.captionSmall
                                .copyWith(color: context.tokens.textSecondary),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  StatusBadge.payment(payment.status, compact: true),
                  const SizedBox(width: AppSpacing.sm),
                  PriceDisplay(currentMinor: payment.amountMinor),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Reembolsos aplicados.
class AdminOrderRefunds extends StatelessWidget {
  const AdminOrderRefunds({required this.refunds});

  final List<AdminOrderRefund> refunds;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text('Reembolsos', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          for (final AdminOrderRefund refund in refunds)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Row(
                children: <Widget>[
                  Icon(Icons.undo_rounded,
                      size: 18, color: context.tokens.textError),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      refund.reason ?? 'Sin motivo indicado',
                      style: AppTextStyles.bodySmall
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                  ),
                  Text(
                    '−${CurrencyFormatter.formatMinor(refund.amountMinor)}',
                    style: AppTextStyles.titleSmall
                        .copyWith(color: context.tokens.textError),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
