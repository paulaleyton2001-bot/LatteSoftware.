// Detalle de un pedido en el panel.
//
// QUÉ MUESTRA Y QUÉ NO
// Las LÍNEAS con su snapshot de precio (lo que se cobró, no lo que vale hoy), los
// pagos con su referencia de aprobación, los reembolsos con su motivo, los
// descuentos que el servidor aplicó y el comprobante para reimprimir. No muestra
// edición: un pedido confirmado no se edita (`409 ORDER_IMMUTABLE`), y ofrecer un
// formulario que el backend va a rechazar es peor que no ofrecerlo.
//
// EL CAMBIO DE ESTADO ES UNA ACCIÓN EXPLÍCITA
// Cancelar exige `reason` (el backend responde `400` sin él) y pasa por
// `ConfirmDialog` destructivo. Los demás avances son de un toque, como en el POS.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/price_display.dart';
import '../../../shared/widgets/ui/status_badge.dart';
import '../domain/entities/admin_order_detail.dart';
import './admin_orders_controller.dart';
import './widgets/admin_detail_row.dart';
import './widgets/admin_order_actions.dart';
import './widgets/admin_order_payments.dart';
import './widgets/admin_order_totals.dart';

/// Abre el detalle del pedido [orderId].
Future<void> openAdminOrderDetail(BuildContext context, int orderId) =>
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (BuildContext context) => AdminOrderDetailPage(orderId: orderId),
      ),
    );

/// Pantalla de detalle de un pedido.
class AdminOrderDetailPage extends ConsumerWidget {
  const AdminOrderDetailPage({required this.orderId, super.key});

  final int orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AdminOrderDetail> detail =
        ref.watch(adminOrderDetailProvider(orderId));

    return Scaffold(
      appBar: AppBar(title: const Text('Detalle del pedido')),
      body: SafeArea(
        child: AsyncStateBuilder<AdminOrderDetail>(
          value: detail,
          loadingMessage: 'Cargando el pedido…',
          onRetry: () async =>
              ref.invalidate(adminOrderDetailProvider(orderId)),
          builder: (BuildContext context, AdminOrderDetail data) =>
              _DetailBody(detail: data, orderId: orderId),
        ),
      ),
    );
  }
}

/// Cuerpo del detalle.
class _DetailBody extends ConsumerWidget {
  const _DetailBody({required this.detail, required this.orderId});

  final AdminOrderDetail detail;
  final int orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.lg, padding, AppSpacing.xxl),
      children: <Widget>[
        _Header(detail: detail),
        const SizedBox(height: AppSpacing.lg),
        AdminOrderStatusActions(detail: detail, orderId: orderId),
        const SizedBox(height: AppSpacing.lg),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              const Text('Datos', style: AppTextStyles.titleMedium),
              const SizedBox(height: AppSpacing.md),
              AdminDetailRow(label: 'Número', value: detail.order.orderNumber),
              AdminDetailRow(label: 'Tipo', value: _typeLabel(detail.order.type)),
              AdminDetailRow(label: 'Canal', value: detail.order.channel),
              if (detail.customerName != null)
                AdminDetailRow(label: 'Cliente', value: detail.customerName!),
              if (detail.chairCode != null)
                AdminDetailRow(label: 'Silla', value: detail.chairCode!),
              if (detail.reservationCode != null)
                AdminDetailRow(
                  label: 'Reserva',
                  value: detail.reservationCode!,
                ),
              if (detail.rentalCode != null)
                AdminDetailRow(label: 'Alquiler', value: detail.rentalCode!),
              if (detail.order.createdAt != null)
                AdminDetailRow(
                  label: 'Creado',
                  value: DateFormatter.dateTime(detail.order.createdAt!),
                ),
              if (detail.customerNotes != null)
                AdminDetailRow(
                  label: 'Nota del cliente',
                  value: detail.customerNotes!,
                ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        AdminOrderLines(items: detail.items),
        const SizedBox(height: AppSpacing.lg),
        AdminOrderTotals(detail: detail),
        if (detail.payments.isNotEmpty) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          AdminOrderPayments(payments: detail.payments),
        ],
        if (detail.refunds.isNotEmpty) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          AdminOrderRefunds(refunds: detail.refunds),
        ],
      ],
    );
  }

  static String _typeLabel(String type) => switch (type) {
        'TAKEAWAY' => 'Para llevar',
        'DINE_IN' => 'En el local',
        'CHAIR_RENTAL' => 'Alquiler de silla',
        _ => type,
      };
}

/// Cabecera: número, estado y total.
class _Header extends StatelessWidget {
  const _Header({required this.detail});

  final AdminOrderDetail detail;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Semantics(
                  header: true,
                  child: Text(
                    detail.order.orderNumber,
                    style: AppTextStyles.headlineSmall,
                  ),
                ),
                const SizedBox(height: AppSpacing.xs),
                StatusBadge.order(detail.order.status),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Text(
                'Total',
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textSecondary),
              ),
              PriceDisplay(
                currentMinor: detail.order.totalMinor,
                variant: PriceVariant.large,
              ),
            ],
          ),
        ],
      ),
    );
  }
}
