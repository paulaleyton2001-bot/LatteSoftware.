// Placeholder para imágenes de producto/rubro que no tienen foto.
//
// Se dibuja con [CustomPaint]: gradiente verde→crema de marca + iniciales del
// nombre. Motivos de la decisión:
//   - El 100% de los productos nuevos nacen sin imagen; un `Icon` genérico
//     hace que la retícula parezca rota.
//   - Sin assets: no hay binarios que mantener ni que_FAILAR al compilar.
//   - Un degradado con iniciales se lee como "producto real" y mantiene la
//     uniformidad visual de la grilla.
//
// Uso típico:
// ```dart
// CachedNetworkImage(
//   imageUrl: product.imageUrl ?? '',
//   placeholder: (_, __) => EmptyPlaceholderImage(name: product.name),
//   errorWidget: (_, __, ___) => EmptyPlaceholderImage(name: product.name),
// );
// ```

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_typography.dart';

/// Mosaico con la inicial del producto cuando no hay imagen.
class EmptyPlaceholderImage extends StatelessWidget {
  const EmptyPlaceholderImage({
    required this.name,
    this.borderRadius = AppRadii.md,
    this.size,
    super.key,
  });

  /// Nombre del producto/rubro: de aquí se extraen las iniciales.
  final String name;

  final double borderRadius;

  /// Tamaño fijo (si es `null`, ocupa todo el padre).
  final double? size;

  /// Iniciales: hasta 2 letras de las primeras palabras con contenido.
  String get _initials {
    final words = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((String word) => word.isNotEmpty)
        .toList();
    if (words.isEmpty) return '?';
    if (words.length == 1) {
      final word = words.first;
      return word.substring(0, word.length >= 2 ? 2 : 1).toUpperCase();
    }
    return '${words.first[0]}${words[1][0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final content = CustomPaint(
      painter: _PlaceholderPainter(initials: _initials),
      child: Center(
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Text(
              _initials,
              style: AppTextStyles.titleLarge.copyWith(
                color: AppColors.brandDark,
                fontWeight: FontWeight.w700,
                letterSpacing: 1,
              ),
            ),
          ),
        ),
      ),
    );

    final clipped = ClipRRect(
      borderRadius: BorderRadius.circular(borderRadius),
      child: content,
    );

    return ExcludeSemantics(
      child: size == null ? clipped : SizedBox.square(dimension: size!, child: clipped),
    );
  }
}

/// Gradiente de marca + ruido visual suave (círculos translúcidos).
class _PlaceholderPainter extends CustomPainter {
  const _PlaceholderPainter({required this.initials});

  final String initials;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final gradient = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: <Color>[AppColors.surfaceGreenSubtle, AppColors.surfaceMuted],
      ).createShader(rect);
    canvas.drawRect(rect, gradient);

    final blob = Paint()..color = AppColors.brand.withOpacity(0.14);
    canvas.drawCircle(
      Offset(size.width * 0.82, size.height * 0.18),
      size.shortestSide * 0.28,
      blob,
    );
    canvas.drawCircle(
      Offset(size.width * 0.12, size.height * 0.88),
      size.shortestSide * 0.20,
      blob,
    );
  }

  @override
  bool shouldRepaint(_PlaceholderPainter oldDelegate) =>
      oldDelegate.initials != initials;
}
