// Historial de pagos del cliente (`GET /customers/:id/payments`).
//
// POR QUÉ "PAGOS EN EL LOCAL" Y NO UN HISTÓRICO DE TARJETA
// La app del cliente NO tiene pasarela de pagos y nunca pide un número de
// tarjeta. El pago ocurre en el mostrador, en efectivo o con tarjeta, y lo
// registra el personal. Esta pantalla es el HISTORICAL de esos pagos, con su
// método y su estado.
//
// CERO DATOS SENSIBLES
// La API garantiza que `Payment` no expone datos de tarjeta
// (`metadata` nunca sale, BR-SEC-006), así que aquí solo hay número de pago,
// método, importe, fecha y estado. Mostrar más sería inventar.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/utils/currency_formatter.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/price_display.dart';
import '../../../shared/widgets/ui/status_badge.dart';
// `paymentsProvider` es de la feature de orders: el histórico de pagos lo pide
// `GET /payments`, que es la misma ruta que usa el detalle del pedido. Es la
// excepción cruzada que ya se usa en `home_page.dart` y `chair_controller.dart`.
import '../../orders/domain/entities/payment_record.dart';
import '../../orders/presentation/orders_controller.dart';

/// Historial de pagos.
class PaymentsHistoryPage extends ConsumerWidget {
  const PaymentsHistoryPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<PaymentRecord>> payments =
        ref.watch(paymentsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Pagos en el local')),
      body: SafeArea(
        child: AsyncStateBuilder<List<PaymentRecord>>(
          value: payments,
          loadingMessage: 'Cargando tu historial…',
          onRetry: () async => ref.invalidate(paymentsProvider),
          isEmpty: (List<PaymentRecord> data) => data.isEmpty,
          emptyIcon: Icons.payments_rounded,
          emptyTitle: 'Todavía no hay pagos',
          emptyMessage: 'Aquí verás los pagos que hagas en el mostrador, en '
              'efectivo o con tarjeta.',
          builder: (BuildContext context, List<PaymentRecord> data) => ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: <Widget>[
              const _Header(),
              const SizedBox(height: AppSpacing.lg),
              for (final PaymentRecord payment in data)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.md),
                  child: _PaymentCard(payment: payment),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Explicación de por qué no hay pagos en la app.
class _Header extends StatelessWidget {
  const _Header();

  @override
  Widget build(BuildContext context) {
    return AppCard(
      color: context.tokens.surfaceGreenSubtle,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
           Icon(Icons.storefront_rounded, size: 20, color: context.tokens.textSuccess),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Aquí no guardamos tarjetas. Pagas en el local, en efectivo o con '
              'tarjeta, y aquí queda el registro.',
              style: AppTextStyles.bodySmall.copyWith(color: context.tokens.textSuccess),
            ),
          ),
        ],
      ),
    );
  }
}

/// Tarjeta de un pago.
class _PaymentCard extends StatelessWidget {
  const _PaymentCard({required this.payment});

  final PaymentRecord payment;

  @override
  Widget build(BuildContext context) {
    final DateTime? when = payment.approvedAt ?? payment.createdAt;

    return AppCard(
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(payment.methodLabel, style: AppTextStyles.titleSmall),
                const SizedBox(height: AppSpacing.xxs),
                if (when != null)
                  Text(
                    DateFormatter.dateTime(when),
                    style: AppTextStyles.captionMedium
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                if (payment.orderNumber != null)
                  Text(
                    'Pedido ${payment.orderNumber}',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
                const SizedBox(height: AppSpacing.sm),
                StatusBadge.payment(payment.status, compact: true),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              PriceDisplay(currentMinor: payment.amountMinor),
              if (payment.refundedMinor > 0) ...<Widget>[
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  'Reembolsado ${CurrencyFormatter.formatMinor(payment.refundedMinor)}',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textError),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
