// Gráficos del panel con `fl_chart`.
//
// POR QUÉ UN MÓDULO PROPIO
// `fl_chart` tiene una API larga y verbosa, y los tres gráficos del panel
// comparten la misma gramilla visual: ejes sin línea de base pesada, sin grid
// densa, colores de `AppChartColors` y etiquetas solo cuando caben
// (docs/DESIGN-TOKENS §1.3). Repetir esa configuración en cada pantalla es como
// los gráficos acaban siendo distintos entre sí.
//
// REGLAS DE LOS GRÁFICOS QUE SIGUEN
//   - El dinero sePINTA en compacto (`$1,2 M`). Un eje de $1.284.000 ocupa media
//     tarjeta y obliga al lector a contar ceros.
//   - El porcentaje se pinta con coma decimal (es-CO).
//   - Una sola serie por gráfico: con dos, el color deja de identificar y hay que
//     añadir leyenda (docs/DESIGN-TOKENS §1.3).

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import '../../../../app/theme/app_colors.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../admin_dashboard_series.dart';
import './chart_helpers.dart';

/// Barras de ventas por hora (`GET /reports/sales-by-hour`).
///
/// El backend devuelve las 24 horas siempre, incluidas las que están a cero, para
/// que el gráfico no tenga huecos. Se aprovechan tal cual: quitar las horas vacías
/// haría que dos días distintos parecieran el mismo gráfico.
class AdminSalesByHourChart extends StatelessWidget {
  const AdminSalesByHourChart({required this.points, super.key});

  final List<HourPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) return const NoChartData();

    final double maxTotal = points.fold<double>(
      0,
      (double acc, HourPoint p) => p.totalMinor > acc ? p.totalMinor.toDouble() : acc,
    );

    return Semantics(
      label: 'Ventas por hora. Máximo '
          '${CurrencyFormatter.formatCompactMinor(maxTotal.round())}',
      excludeSemantics: true,
      child: SizedBox(
        height: 220,
        child: BarChart(
          BarChartData(
            maxY: maxTotal <= 0 ? 1 : maxTotal * 1.15,
            barTouchData: BarTouchData(
              touchTooltipData: BarTouchTooltipData(
                getTooltipItem: (BarChartGroupData group, int groupIndex,
                        BarChartRodData rod, int rodIndex) {
                  final HourPoint point = points[group.x];
                  return BarTooltipItem(
                    '${point.label}\n',
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
                  reservedSize: 44,
                  // 4 marcas en el eje de dinero: menos se lee peor y más es ruido.
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
                  // Una etiqueta cada 3 horas: 24 rótulos no caben en 500 dp.
                  getTitlesWidget: (double value, TitleMeta meta) {
                    final int hour = value.round();
                    if (hour % 3 != 0) return const SizedBox.shrink();
                    return Padding(
                      padding: const EdgeInsets.only(top: AppSpacing.xs),
                      child: Text(
                        '${hour.toString().padLeft(2, '0')}',
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
                      // Se pincha el ancho a ~8 dp: con 24 barras en poco ancho, una
                      // barra "gorda" se toca con la de al lado.
                      toY: points[i].totalMinor.toDouble(),
                      width: 8,
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
