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
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_tokens.dart';
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
    final AppTokens t = context.tokens;
    final content = CustomPaint(
      // El painter recibe COLORES, no un contexto: `paint()` corre fuera de la
      // fase de build y no puede leer `Theme.of`. Además `shouldRepaint`
      // compara los colores, así el mosaico se repinta al cambiar de modo sin
      // reconstruir el árbol entero.
      painter: _PlaceholderPainter(
        from: t.surfaceGreenSubtle,
        to: t.surfaceMuted,
        blob: t.brand.withOpacity(0.14),
      ),
      child: Center(
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Padding(
            padding: const EdgeInsets.all(8),
            child: Text(
              _initials,
              style: AppTextStyles.titleLarge.copyWith(
                color: t.brandDark,
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
  const _PlaceholderPainter({
    required this.from,
    required this.to,
    required this.blob,
  });

  /// Color superior del degradado (superficie de acento diluida).
  final Color from;

  /// Color inferior del degradado (superficie alternativa).
  final Color to;

  /// Color de los círculos decorativos, ya con su opacidad.
  final Color blob;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final gradient = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: <Color>[from, to],
      ).createShader(rect);
    canvas.drawRect(rect, gradient);

    final blobPaint = Paint()..color = blob;
    canvas.drawCircle(
      Offset(size.width * 0.82, size.height * 0.18),
      size.shortestSide * 0.28,
      blobPaint,
    );
    canvas.drawCircle(
      Offset(size.width * 0.12, size.height * 0.88),
      size.shortestSide * 0.20,
      blobPaint,
    );
  }

  @override
  bool shouldRepaint(_PlaceholderPainter oldDelegate) =>
      oldDelegate.from != from ||
      oldDelegate.to != to ||
      oldDelegate.blob != blob;
}
