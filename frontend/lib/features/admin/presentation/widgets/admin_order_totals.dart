// Líneas y totales de un pedido. MÓDULO `features/admin/presentation/widgets`.
//
// LOS PRECIOS SON SNAPSHOTS
// `nameSnapshot`, `unitPriceMinor` y `lineTotalMinor` son los valores con los que
// se cobró. Si el producto cambió de precio después, esta pantalla sigue
// enseñando lo que se cobró (BR-PRICE-004). Por eso NO se lee el catálogo actual
// para "corregir" el nombre: se mostraría un nombre que el cliente nunca vio.
//
// LA PROPINA VA FUERA DEL TOTAL
// `tipMinor` no entra en `totalMinor` (BR-MONEY-009): es un cobro adicional. Por
// eso se pinta debajo de la línea de totales y con la coletilla "(fuera del
// total)", no como una línea más del desglose.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/admin_catalog.dart';
import '../../domain/entities/admin_order_detail.dart';

/// Líneas del pedido con sus snapshots.
class AdminOrderLines extends StatelessWidget {
  const AdminOrderLines({required this.items});

  final List<AdminOrderLine> items;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text('Líneas', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          for (final AdminOrderLine line in items)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  SizedBox(
                    width: 40,
                    child: Text(
                      _qty(line.quantity),
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
                        if (line.notes != null)
                          Text(
                            line.notes!,
                            style: AppTextStyles.captionSmall
                                .copyWith(color: context.tokens.textSecondary),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  PriceDisplay(currentMinor: line.lineTotalMinor),
                ],
              ),
            ),
        ],
      ),
    );
  }

  static String _qty(double value) => value == value.roundToDouble()
      ? '${value.toInt()}×'
      : '${value.toStringAsFixed(1)}×';
}

/// Totales del pedido, con la propina aparte.
class AdminOrderTotals extends StatelessWidget {
  const AdminOrderTotals({required this.detail});

  final AdminOrderDetail detail;

  @override
  Widget build(BuildContext context) {
    final AdminOrder order = detail.order;
    final AppTokens t = context.tokens;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text('Totales', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          // El DESGLOSE viene del detalle (`totals`); los importes de cabecera
          // (total, pagado, saldo) vienen del resumen del pedido. No se mezclan:
          // el listado no trae `totals` y el detalle sí.
          _row(t, 'Subtotal', detail.subtotalMinor),
          if (detail.discountMinor > 0)
            _row(t, 'Descuentos', detail.discountMinor, negative: true),
          _row(t, 'Impuestos', detail.taxMinor),
          if (detail.serviceFeeMinor > 0)
            _row(t, 'Cargo por servicio', detail.serviceFeeMinor),
          const Divider(height: AppSpacing.lg),
          _row(t, 'Total', order.totalMinor, emphasized: true),
          _row(t, 'Pagado', order.paidMinor),
          if (order.balanceMinor > 0)
            _row(t, 'Saldo', order.balanceMinor, warning: true),
          // La propina NO entra en `totalMinor` (BR-MONEY-009): por eso va fuera
          // del bloque de totales, no como una línea más.
          if (detail.tipMinor > 0) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: <Widget>[
                Icon(Icons.volunteer_activism_outlined,
                    size: 16, color: t.textSecondary),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    'Propina (fuera del total)',
                    style: AppTextStyles.captionMedium
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                ),
                PriceDisplay(currentMinor: detail.tipMinor),
              ],
            ),
          ],
          for (final AdminAppliedDiscount discount in detail.discounts)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: Row(
                children: <Widget>[
                  Icon(Icons.sell_outlined, size: 16, color: t.textInfo),
                  const SizedBox(width: AppSpacing.xs),
                  Expanded(
                    child: Text(
                      'Cupón ${discount.code}',
                      style:
                          AppTextStyles.captionMedium.copyWith(color: t.textInfo),
                    ),
                  ),
                  PriceDisplay(currentMinor: discount.amountMinor),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _row(
    AppTokens tokens,
    String label,
    int minor, {
    bool emphasized = false,
    bool negative = false,
    bool warning = false,
  }) {
    // Los tokens se reciben como parámetro: este es un método sin `build`
    // alrededor, así que no hay ningún `context` al que leerle el tema.
    //
    // Además se corrige el color: un importe NEGATIVO es un descuento (dinero
    // que sale de la caja), no una ganancia. Se pintaba en `textSuccess`
    // (verde) por un `negative ? textSuccess : ...` invertido de sentido: el
    // admin leía "descuento" en verde de "positivo".
    final Color color = warning
        ? tokens.textWarning
        : (negative ? tokens.textPrimary : tokens.textPrimary);
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.xs),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              label,
              style: (emphasized
                      ? AppTextStyles.titleSmall
                      : AppTextStyles.bodySmall)
                  .copyWith(color: color),
            ),
          ),
          PriceDisplay(
            currentMinor: minor,
            variant: emphasized ? PriceVariant.large : PriceVariant.normal,
          ),
        ],
      ),
    );
  }
}

