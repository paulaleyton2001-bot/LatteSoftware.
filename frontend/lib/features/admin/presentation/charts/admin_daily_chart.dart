// Gráfico de ventas por día. MÓDULO `features/admin/presentation/charts`.
//
// Se separa del de horas porque comparten la GRILLA (mismos ejes, mismo color, misma
// herramienta) pero no los DATOS: uno son 24 horas fijas y el otro una lista
// variable de días. Mezclarlos daba un archivo de 430 líneas con dos mitades que
// solo se tocan al leer.
//
// Ver `admin_sales_charts.dart` para las reglas visuales comunes.

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../admin_dashboard_series.dart';
import './chart_helpers.dart';

/// Barras de ventas por día (`GET /reports/sales-by-day`).
class AdminSalesByDayChart extends StatelessWidget {
  const AdminSalesByDayChart({required this.points, super.key});

  final List<DailyPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return const NoChartData();
    final double maxTotal = points.fold<double>(
      0,
      (double acc, DailyPoint p) => p.totalMinor > acc ? p.totalMinor.toDouble() : acc,
    );

    return Semantics(
      label: 'Ventas por día. Máximo '
          '${CurrencyFormatter.formatCompactMinor(maxTotal.round())}',
      excludeSemantics: true,
      child: SizedBox(
        height: 240,
        child: BarChart(
          BarChartData(
            maxY: maxTotal <= 0 ? 1 : maxTotal * 1.15,
            barTouchData: BarTouchData(
              touchTooltipData: BarTouchTooltipData(
                getTooltipItem: (BarChartGroupData group, int groupIndex,
                        BarChartRodData rod, int rodIndex) {
                  final DailyPoint point = points[group.x];
                  return BarTooltipItem(
                    '${point.date}\n',
                    AppTextStyles.labelMedium,
                    children: <TextSpan>[
                      TextSpan(
                        text: CurrencyFormatter.formatMinor(point.totalMinor),
                        style: TextStyle(
                          color: context.tokens.textPrimary,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      TextSpan(
                        text: '\n${point.orders} pedidos',
                        style:  TextStyle(color: context.tokens.textSecondary),
                      ),
                    ],
                  );
                },
              ),
            ),
            titlesData: FlTitlesData(
              leftTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 48,
                  interval: niceInterval(maxTotal, 4),
                  getTitlesWidget: (double value, TitleMeta meta) => Text(
                    CurrencyFormatter.formatCompactMinor(value.round()),
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
                ),
              ),
              rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
              bottomTitles: AxisTitles(
                sideTitles: SideTitles(
                  showTitles: true,
                  reservedSize: 28,
                  getTitlesWidget: (double value, TitleMeta meta) {
                    // Con 30 días no caben 30 rótulos: uno de cada cinco.
                    final int step = points.length > 12 ? 5 : 1;
                    final int index = value.round();
                    if (index % step != 0) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.xs),
                      child: Text(
                        points[index].dayLabel,
                        style: AppTextStyles.captionSmall
                            .copyWith(color: context.tokens.textTertiary),
                      ),
                    );
                  },
                ),
              ),
            ),
            gridData: FlGridData(
              show: true,
              drawVerticalLine: false,
              horizontalInterval: niceInterval(maxTotal, 4),
              getDrawingHorizontalLine: (double value) => FlLine(
                color: context.tokens.borderSubtle,
                strokeWidth: 1,
              ),
            ),
            borderData: FlBorderData(show: false),
            barGroups: <BarChartGroupData>[
              for (int i = 0; i < points.length; i++)
                BarChartGroupData(
                  x: i,
                  barRods: <BarChartRodData>[
                    BarChartRodData(
                      toY: points[i].totalMinor.toDouble(),
                      width: points.length > 15 ? 10 : 18,
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(4),
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
