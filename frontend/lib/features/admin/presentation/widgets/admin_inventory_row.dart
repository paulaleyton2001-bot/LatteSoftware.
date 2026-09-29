// Fila de ítem de inventario. MÓDULO `features/admin/presentation/widgets`.
//
// EL ESTADO SE DICE CON PALABRAS
// `isLowStock` lo CALCULA el backend (usa `minStock` o, si es 0, el umbral del
// negocio). La app lo muestra con la palabra y el color, y NO lo recalcula: si el
// negocio cambia `lowStockAlertThreshold`, el backend es la autoridad.
//
// EL VALORIZADO ES UNA MULTIPLICACIÓN, NO UN CAMPO
// `currentStock * costMinor` redondeado a entero. El backend lo manda en
// `reports/inventory`; aquí se calcula solo para pintar la fila, y se redondea
// igual (`round`) para no discrepar por un peso.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/admin_inventory_item.dart';
import '../admin_inventory_controller.dart';
import './admin_inventory_adjust_dialog.dart';

/// Fila de ítem con su ajuste de stock.
class AdminInventoryRow extends ConsumerWidget {
  const AdminInventoryRow({required this.item, super.key});

  final AdminInventoryItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> busy = ref.watch(adminAdjustProvider(item.id));
    final bool enabled = !busy.isLoading;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  item.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleSmall,
                ),
              ),
              _StockPill(item: item),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: AppSpacing.xs,
            children: <Widget>[
              Text(
                'SKU ${item.sku ?? '—'}',
                style: AppTextStyles.captionSmall
                    .copyWith(color: context.tokens.textTertiary),
              ),
              if (item.supplier != null)
                Text(
                  item.supplier!,
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              if (item.locationStorage != null)
                Text(
                  item.locationStorage!,
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '${_qty(item.currentStock)} / ${_qty(item.minStock)} ${item.unit}',
                  style: AppTextStyles.bodyMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ),
              PriceDisplay(currentMinor: item.valueMinor),
              const SizedBox(width: AppSpacing.sm),
              AppButton(
                label: 'Ajustar',
                icon: Icons.tune_rounded,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.small,
                isLoading: busy.isLoading,
                onPressed: enabled
                    ? () => showAdminInventoryAdjustDialog(context, ref, item)
                    : null,
                tooltip: 'Ajusta el saldo con un motivo obligatorio',
              ),
            ],
          ),
        ],
      ),
    );
  }

  static String _qty(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);
}

/// Distintivo de stock: la palabra que corresponde, con su color.
class _StockPill extends StatelessWidget {
  const _StockPill({required this.item});

  final AdminInventoryItem item;

  @override
  Widget build(BuildContext context) {
    final bool out = item.isOutOfStock;
    final bool low = item.isLowStock && !out;
    final String label = out ? 'Agotado' : (low ? 'Stock bajo' : 'En stock');
    final Color color = out
        ? context.tokens.textError
        : (low ? context.tokens.textWarning : context.tokens.textSuccess);
    final IconData icon = out
        ? Icons.error_outline_rounded
        : (low ? Icons.warning_amber_rounded : Icons.check_circle_rounded);

    return Semantics(
      label: label,
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 16, color: color),
          const SizedBox(width: AppSpacing.xxs),
          Text(label, style: AppTextStyles.labelMedium.copyWith(color: color)),
        ],
      ),
    );
  }
}


