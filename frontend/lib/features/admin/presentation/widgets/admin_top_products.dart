// Productos más vendidos del dashboard. MÓDULO `features/admin/presentation/widgets`.
//
// BARRA + NÚMERO, NUNCA SOLO COLOR
// Cada fila lleva el nombre, las unidades y el importe. El color de la barra es un
// refuerzo, no el portador de la información.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/empty_state.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../admin_dashboard_series.dart';

/// Tarjeta con el top de productos, con barra de proporción por cantidad.
class AdminTopProductsCard extends StatelessWidget {
  const AdminTopProductsCard({required this.products, this.showChart = false, super.key});

  final List<TopProduct> products;

  /// `true` desde Reportes, donde cabe el gráfico de barras horizontales.
  final bool showChart;

  @override
  Widget build(BuildContext context) {
    if (products.isEmpty) {
      return const AppCard(
        child: EmptyState(
          icon: Icons.local_cafe_outlined,
          title: 'Sin ventas registradas',
          message: 'Cuando haya pedidos, aquí verás qué se está pidiendo más.',
          compact: true,
        ),
      );
    }
    final double maxQuantity = products.fold<double>(
      0,
      (double acc, TopProduct p) => p.quantity > acc ? p.quantity : acc,
    );

    return AppCard(
      child: Column(
        children: <Widget>[
          for (final TopProduct product in products)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.md),
              child: _ProductRow(product: product, maxQuantity: maxQuantity),
            ),
        ],
      ),
    );
  }
}

/// Fila de un producto con su barra de proporción.
class _ProductRow extends StatelessWidget {
  const _ProductRow({required this.product, required this.maxQuantity});

  final TopProduct product;
  final double maxQuantity;

  @override
  Widget build(BuildContext context) {
    final double fraction =
        maxQuantity <= 0 ? 0 : (product.quantity / maxQuantity).clamp(0.0, 1.0);

    return Semantics(
      label: '${product.name}, ${product.quantity.toStringAsFixed(0)} unidades',
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  product.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleSmall,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                '${product.quantity.toStringAsFixed(0)} uds',
                style: AppTextStyles.labelMedium
                    .copyWith(color: context.tokens.textSecondary),
              ),
              const SizedBox(width: AppSpacing.md),
              PriceDisplay(currentMinor: product.totalMinor),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          ClipRRect(
            borderRadius: BorderRadius.circular(AppRadii.sm),
            child: LinearProgressIndicator(
              value: fraction,
              minHeight: 6,
              backgroundColor: context.tokens.surfaceSunken,
              valueColor:  AlwaysStoppedAnimation<Color>(context.tokens.brand),
            ),
          ),
        ],
      ),
    );
  }
}
