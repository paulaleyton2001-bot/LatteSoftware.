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

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_typography.dart';

/// Anillo decorativo reutilizable (spinners, progress circular del POS).
class AppProgressRing extends StatelessWidget {
  const AppProgressRing({required this.progress, this.size = 64, super.key});

  /// 0..1. Se recorta a ese rango.
  final double progress;
  final double size;

  @override
  Widget build(BuildContext context) {
    final value = math.max(0, math.min(1, progress));
    return SizedBox.square(
      dimension: size,
      child: CustomPaint(
        painter: _RingPainter(value: value),
        child: Center(
          child: Text(
            '${(value * 100).round()}%',
            style: AppTextStyles.labelMedium
                .copyWith(color: AppColors.textPrimary),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.value});

  final double value;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final stroke = size.width * 0.09;
    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..color = AppColors.surfaceSunken;
    final bar = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = stroke
      ..color = AppColors.brand;
    canvas.drawArc(rect.deflate(stroke / 2), 0, 6.28318, false, track);
    canvas.drawArc(rect.deflate(stroke / 2), -1.5708, 6.28318 * value, false, bar);
  }

  @override
  bool shouldRepaint(_RingPainter oldDelegate) => oldDelegate.value != value;
}
