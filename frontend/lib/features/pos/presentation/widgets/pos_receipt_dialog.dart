// Comprobante de un pedido para reimprimir. MÓDULO `pos/presentation/widgets`.
//
// `GET /orders/:id/receipt` construye el comprobante SOLO con snapshots
// (BR-ORDER-018): lo que se ve hoy es lo que se cobró, aunque el producto ya haya
// cambiado de precio o de nombre. Por eso la reimpresión puede hacerse días
// después sin que el número se mueva.
//
// ES UN DIÁLOGO, NO UNA PANTALLA
// Reimprimir es una acción de un toque dentro del tablero: si fuera una
// pantalla completa, el cajero tendría que volver atrás y perder el sitio del
// que estaba mirando. El diálogo atrapa el foco, se cierra con `Esc` y no
// admite toque fuera (es una acción de caja).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/repositories/pos_repository_models.dart';
import '../pos_orders_controller.dart';

/// Diálogo con el comprobante de [orderId].
class PosReceiptDialog extends ConsumerWidget {
  const PosReceiptDialog({required this.orderId, super.key});

  final int orderId;

  /// Abre el diálogo de reimpresión del pedido [orderId].
  static Future<void> show(BuildContext context, int orderId) => showDialog<void>(
        context: context,
        builder: (BuildContext dialogContext) =>
            PosReceiptDialog(orderId: orderId),
      );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PosReceipt> receipt = ref.watch(posReceiptProvider(orderId));

    return Dialog(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460, maxHeight: 640),
        child: Padding(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: AsyncStateBuilder<PosReceipt>(
            value: receipt,
            loadingMessage: 'Cargando el comprobante…',
            onRetry: () async => ref.invalidate(posReceiptProvider(orderId)),
            builder: (BuildContext context, PosReceipt data) =>
                _ReceiptBody(receipt: data),
          ),
        ),
      ),
    );
  }
}

/// Cuerpo del comprobante.
class _ReceiptBody extends StatelessWidget {
  const _ReceiptBody({required this.receipt});

  final PosReceipt receipt;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: Semantics(
                header: true,
                child: Text(
                  receipt.businessName,
                  style: AppTextStyles.titleLarge,
                ),
              ),
            ),
            IconButton(
              onPressed: () => Navigator.of(context).pop(),
              icon: const Icon(Icons.close_rounded),
              // El `tooltip` de `IconButton` ya da la etiqueta al lector de
              // pantalla; `IconButton` no admite `semanticLabel`.
              tooltip: 'Cerrar el comprobante',
              constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            ),
          ],
        ),
        if (receipt.businessAddress.isNotEmpty)
          Text(
            receipt.businessAddress,
            style: AppTextStyles.captionMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
        const Divider(height: AppSpacing.lg),
        Row(
          children: <Widget>[
            Text(receipt.orderNumber, style: AppTextStyles.titleSmall),
            const SizedBox(width: AppSpacing.sm),
            if (receipt.status != null)
              StatusBadge.order(receipt.status!, compact: true),
            const Spacer(),
            if (receipt.placedAt != null)
              Text(
                DateFormatter.dateTime(receipt.placedAt!),
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textTertiary),
              ),
          ],
        ),
        if (receipt.customerName != null || receipt.chairCode != null) ...<Widget>[
          const SizedBox(height: AppSpacing.xs),
          Text(
            <String>[
              if (receipt.customerName != null) receipt.customerName!,
              if (receipt.chairCode != null) 'Silla ${receipt.chairCode}',
            ].join(' · '),
            style: AppTextStyles.bodySmall
                .copyWith(color: context.tokens.textSecondary),
          ),
        ],
        const Divider(height: AppSpacing.lg),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            children: <Widget>[
              for (final PosReceiptLine line in receipt.items)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      SizedBox(
                        width: 36,
                        child: Text(
                          _quantity(line.quantity),
                          style: AppTextStyles.titleSmall,
                        ),
                      ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Text(
                              line.variantName == null
                                  ? line.name
                                  : '${line.name} · ${line.variantName}',
                              style: AppTextStyles.bodyMedium,
                            ),
                            if (line.notes != null && line.notes!.isNotEmpty)
                              Text(
                                line.notes!,
                                style: AppTextStyles.captionSmall.copyWith(
                                  color: context.tokens.textSecondary,
                                ),
                              ),
                          ],
                        ),
                      ),
                      const SizedBox(width: AppSpacing.sm),
                      PriceDisplay(currentMinor: line.lineTotalMinor),
                    ],
                  ),
                ),
              const Divider(height: AppSpacing.lg),
              if (receipt.discountMinor > 0)
                _TotalRow(
                  label: 'Descuentos',
                  minor: receipt.discountMinor,
                  negative: true,
                ),
              if (receipt.taxMinor > 0)
                _TotalRow(label: 'Impuestos', minor: receipt.taxMinor),
              _TotalRow(
                label: 'Total',
                minor: receipt.totalMinor,
                emphasized: true,
              ),
              _TotalRow(label: 'Pagado', minor: receipt.paidMinor),
              if (receipt.balanceMinor > 0)
                _TotalRow(
                  label: 'Saldo pendiente',
                  minor: receipt.balanceMinor,
                  warning: true,
                ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        AppButton(
          label: 'Cerrar',
          variant: AppButtonVariant.secondary,
          size: AppButtonSize.medium,
          isFullWidth: true,
          onPressed: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }

  /// Cantidad legible: entera sin decimales, fraccional con uno.
  static String _quantity(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);
}

/// Fila de total del comprobante.
class _TotalRow extends StatelessWidget {
  const _TotalRow({
    required this.label,
    required this.minor,
    this.emphasized = false,
    this.negative = false,
    this.warning = false,
  });

  final String label;
  final int minor;
  final bool emphasized;
  final bool negative;
  final bool warning;

  @override
  Widget build(BuildContext context) {
    final Color color = warning
        ? context.tokens.textWarning
        : (negative ? context.tokens.textSuccess : context.tokens.textPrimary);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.xs),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              label,
              style: emphasized
                  ? AppTextStyles.titleSmall.copyWith(color: color)
                  : AppTextStyles.bodySmall.copyWith(color: color),
            ),
          ),
          if (negative)
            Text('−', style: AppTextStyles.bodySmall.copyWith(color: color)),
          PriceDisplay(
            currentMinor: minor,
            variant: emphasized ? PriceVariant.large : PriceVariant.normal,
          ),
        ],
      ),
    );
  }
}
