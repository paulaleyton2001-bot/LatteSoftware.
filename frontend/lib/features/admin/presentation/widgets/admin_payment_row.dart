// Fila de pago en la tabla del panel. MÓDULO `features/admin/presentation/widgets`.
//
// LO QUE SE VE DE UN PAGO
// Método, estado, importe, pedido y —en tarjeta— la referencia de aprobación que
// anotó el cajero. La referencia es lo que hace conciliable el cierre de caja, así
// que no es un dato opcional de la fila.
//
// EL REEMBOLSO PARTE DEL SALDO REAL
// `amountMinor - refundedMinor`. El diálogo precarga ese importe como máximo, que
// es lo que evita el `422 REFUND_EXCEEDS_PAID`, y el botón solo aparece si el pago
// es reembolsable (`APPROVED` o `PARTIALLY_REFUNDED` con saldo pendiente).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/admin_payments.dart';
import '../admin_payments_controller.dart';
import './admin_refund_dialog.dart';

/// Fila de pago con su acción de reembolso.
class AdminPaymentRow extends ConsumerWidget {
  const AdminPaymentRow({required this.payment, super.key});

  final AdminPayment payment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String method =
        kAdminPaymentMethodLabels[payment.method] ?? payment.method;
    final String semantic =
        'Pago ${payment.paymentNumber ?? payment.id}, $method, '
        '${CurrencyFormatter.formatMinor(payment.amountMinor)}';

    return Semantics(
      container: true,
      label: semantic,
      child: AppCard(
        padding: const EdgeInsets.all(AppSpacing.md),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
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
                  child: Text(
                    payment.paymentNumber ??
                        (payment.orderNumber ?? 'Pago #${payment.id}'),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.titleSmall,
                  ),
                ),
                StatusBadge.payment(payment.status, compact: true),
                const SizedBox(width: AppSpacing.sm),
                PriceDisplay(currentMinor: payment.amountMinor),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Wrap(
              spacing: AppSpacing.md,
              runSpacing: AppSpacing.xs,
              children: <Widget>[
                Text(
                  method,
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
                if (payment.orderNumber != null)
                  Text(
                    'Pedido ${payment.orderNumber}',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
                if (payment.providerReference != null)
                  Text(
                    'Ref. ${payment.providerReference}',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textInfo),
                  ),
                if (payment.createdAt != null)
                  Text(
                    DateFormatter.dateTime(payment.createdAt!),
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
              ],
            ),
            if (payment.refundedMinor > 0) ...<Widget>[
              const SizedBox(height: AppSpacing.sm),
              _RefundedTag(amountMinor: payment.refundedMinor),
            ],
            if (payment.isRefundable) ...<Widget>[
              const SizedBox(height: AppSpacing.sm),
              AppButton(
                label: 'Reembolsar',
                icon: Icons.undo_rounded,
                variant: AppButtonVariant.danger,
                size: AppButtonSize.small,
                onPressed: () => showAdminRefundDialog(context, ref, payment),
                tooltip: 'Reembolsar total o parcialmente',
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Etiqueta de lo ya reembolsado.
class _RefundedTag extends StatelessWidget {
  const _RefundedTag({required this.amountMinor});

  final int amountMinor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
         Icon(Icons.history_rounded, size: 16, color: context.tokens.textError),
        const SizedBox(width: AppSpacing.xxs),
        Text(
          'Reembolsado',
          style: AppTextStyles.labelMedium
              .copyWith(color: context.tokens.textError),
        ),
        const SizedBox(width: AppSpacing.xs),
        PriceDisplay(currentMinor: amountMinor),
      ],
    );
  }
}
