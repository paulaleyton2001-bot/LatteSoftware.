// Anillo de progreso reutilizable.
//
// Uso: % de ocupación de una silla, avance del cobro, cuota diaria del KPI.
// Se dibuja en [CustomPaint] para que el grosor y el `strokeCap` sean
// consistentes entre plataformas (diferencia real en web vs móvil).
//
// Uso típico:
// ```dart
// AppProgressRing(progress: rental.utilizationRate, size: 96);
// ```

import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';



/// Anillo decorativo reutilizable (spinners, progress circular del POS).
class AppProgressRing extends StatelessWidget {
  const AppProgressRing({required this.progress, this.size = 64, super.key});

  /// 0..1. Se recorta a ese rango.
  final double progress;
  final double size;

  @override
  Widget build(BuildContext context) {
    // `math.max`/`math.min` sobre `double` devuelven `num`: se fija el tipo a
    // `double` porque de ahí salen tanto el `CustomPainter` como el porcentaje.
    final double value = math.max(0, math.min(1, progress)).toDouble();
    final AppTokens t = context.tokens;
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        // El painter recibe COLORES, no un contexto: un `CustomPainter` se
        // ejecuta fuera de la fase de build, así que no puede leer
        // `Theme.of(context)`. Además [shouldRepaint] compara los colores para
        // repintar al cambiar de modo sin reconstruir el árbol.
        painter: _RingPainter(
          value: value,
          track: t.surfaceSunken,
          bar: t.brand,
        ),
        child: Center(
          child: Text(
            '${(value * 100).round()}%',
            style: AppTextStyles.labelMedium
                .copyWith(color: t.textPrimary),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({
    required this.value,
    required this.track,
    required this.bar,
  });

  final double value;

  /// Color de la pista (el arco de fondo).
  final Color track;

  /// Color del arco de progreso.
  final Color bar;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final stroke = size.width * 0.09;
    final trackPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = track;
    final barPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = stroke
      ..color = bar;
    canvas.drawArc(rect.deflate(stroke / 2), 0, 6.28318, false, trackPaint);
    canvas.drawArc(
        rect.deflate(stroke / 2), -1.5708, 6.28318 * value, false, barPaint);
  }

  @override
  bool shouldRepaint(_RingPainter oldDelegate) =>
      oldDelegate.value != value ||
      oldDelegate.track != track ||
      oldDelegate.bar != bar;
}
