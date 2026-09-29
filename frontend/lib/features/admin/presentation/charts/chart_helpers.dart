// Piezas compartidas por los gráficos del panel.
//
// MÓDULO `features/admin/presentation/charts`. El estado sin datos vive aquí
// porque `fl_chart` con una lista vacía pinta un eje sin barras, que parece un
// gráfico roto; y el redondeo del eje, porque los tres gráficos lo necesitan y
// cada copia se queda vieja.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';

/// Estado sin datos de un gráfico. No es un error: `fl_chart` con una lista vacía
/// pinta un eje sin barras, que parece un gráfico roto.
class NoChartData extends StatelessWidget {
  const NoChartData();

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 160,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: context.tokens.surfaceMuted,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Text(
        'Sin datos en este periodo',
        style: AppTextStyles.bodySmall.copyWith(color: context.tokens.textTertiary),
      ),
    );
  }
}

/// Redondea el máximo del eje a un número "bonito" (1, 2, 5 × 10ⁿ).
///
/// Sin esto el eje sale con valores como 1.284.317, que no aportan nada y ocupan
/// cuatro cifras de ancho.
///
/// Es `pública` a propósito: la usan los tres gráficos, y un `_` la volvería
/// invisible desde [admin_daily_chart] aunque el archivo sea del mismo módulo.
double niceInterval(double max, int divisions) {
  if (max <= 0 || divisions <= 0) return 1;
  final double raw = max / divisions;
  final double magnitude = _magnitudeOf(raw);
  final double normalized = raw / magnitude;
  final double step = normalized <= 1
      ? 1
      : normalized <= 2
          ? 2
          : normalized <= 5
              ? 5
              : 10;
  return step * magnitude;
}

double _magnitudeOf(double value) {
  double magnitude = 1;
  while (value >= 10) {
    value /= 10;
    magnitude *= 10;
  }
  return magnitude;
}
