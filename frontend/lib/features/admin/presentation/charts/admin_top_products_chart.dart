// Gráfico horizontal de productos más vendidos.
// MÓDULO `features/admin/presentation/charts`.
//
// BARRA HORIZONTAL Y NO VERTICAL
// Porque los NOMBRES son largos ("Latte largo con leche de avena"): en el eje X se
// rotan, se leen peor y se comen el ancho del gráfico en letras. Con la barra
// horizontal el nombre va a la izquierda, en horizontal, y se lee de un vistazo.

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../admin_dashboard_series.dart';
import './chart_helpers.dart';

/// Barras horizontales de productos más vendidos.
///
/// Se elige barra horizontal y no vertical porque los NOMBRES son largos
/// ("LatteLngi con leche de avena") y en el eje X no caben: se rotan, se leen
/// peor y ocupan el ancho del gráfico en letras.
class AdminTopProductsChart extends StatelessWidget {
  const AdminTopProductsChart({required this.products, super.key});

  final List<TopProduct> products;

  @override
  Widget build(BuildContext context) {
    if (products.isEmpty) return const NoChartData();
    final double maxQuantity = products.fold<double>(
      0,
      (double acc, TopProduct p) => p.quantity > acc ? p.quantity : acc,
    );

    return Semantics(
      label: 'Productos más vendidos por cantidad',
      excludeSemantics: true,
      child: SizedBox(
        height: (products.length * 44 + 24).toDouble(),
        child: BarChart(
          // `BarChartData` de fl_chart 0.68 fija `minX: 0, maxX: 1` (los grupos
          // se colocan por índice) y solo deja abrir `maxY`. Como aquí la barra
          // CRECE hacia la derecha, el techo se aplica a `maxY` de la misma
          // manera: sin él, la barra más larga se sale del área de dibujo.
          BarChartData(
            maxY: maxQuantity <= 0 ? 1 : maxQuantity * 1.1,
            barTouchData: BarTouchData(
              touchTooltipData: BarTouchTooltipData(
                getTooltipItem: (BarChartGroupData group, int groupIndex,
                        BarChartRodData rod, int rodIndex) {
                  // `groupIndex` ES el índice del producto: `BarChartGroupData`
                  // no tiene campo `y` en esta versión, y leerlo devolvía `dynamic`.
                  final TopProduct product = products[groupIndex];
                  return BarTooltipItem(
                    '${product.name}\n',
                    AppTextStyles.labelMedium,
                    children: <TextSpan>[
                      TextSpan(
                        text: '${product.quantity.toStringAsFixed(0)} unidades',
                        style: TextStyle(
                          color: context.tokens.textPrimary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      TextSpan(
                        text: '\n${CurrencyFormatter.formatMinor(product.totalMinor)}',
                        style:  TextStyle(color: context.tokens.textSecondary),
                      ),
                    ],
                  );
                },
              ),
            ),
            titlesData: FlTitlesData(
              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 140,
                  getTitlesWidget: (double value, TitleMeta meta) {
                    final int index = value.round();
                    if (index < 0 || index >= products.length) {
                      return const SizedBox.shrink();
                    }
                    return Padding(
                      padding: const EdgeInsets.only(right: AppSpacing.sm),
                      child: Text(
                        products[index].name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        textAlign: TextAlign.right,
                        style: AppTextStyles.captionSmall
                            .copyWith(color: context.tokens.textSecondary),
                      ),
                    );
                  },
                ),
              ),
              bottomTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
            ),
            gridData: FlGridData(
              show: true,
              drawVerticalLine: true,
              horizontalInterval: 1,
              getDrawingVerticalLine: (double value) => FlLine(
                color: context.tokens.borderSubtle,
                strokeWidth: 1,
              ),
              getDrawingHorizontalLine: (double value) => FlLine(
                color: context.tokens.borderSubtle,
                strokeWidth: 1,
              ),
            ),
            borderData: FlBorderData(show: false),
            barGroups: <BarChartGroupData>[
              for (int i = 0; i < products.length; i++)
                BarChartGroupData(
                  // `x` es la posición en el eje; el largo de la barra va en
                  // `toY` del rod, que es el valor que `BarChartData` escala con
                  // `maxY`. `toX` no existe en esta versión de fl_chart.
                  x: i,
                  barRods: <BarChartRodData>[
                    BarChartRodData(
                      toY: products[i].quantity,
                      width: 14,
                      borderRadius: const BorderRadius.horizontal(
                        right: Radius.circular(4),
                      ),
                      color: AppChartColors.seriesPrimary,
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}
