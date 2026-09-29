// Skeleton shimmer sin dependencias externas.
//
// Es un `ShaderMask` con gradiente lineal animado. Se implementa a mano (en
// vez de `shimmer` o `skeletonizer`) por tres razones: menos dependencias, sin
// `AnimationController` global compartido, y respeto directo de
// `prefers-reduced-motion` (si el sistema lo pide, el gradiente se congela).
//
// Uso típico:
// ```dart
// ShimmerBox(width: 120, height: 14);
// ShimmerList(itemCount: 6);
// ```
import 'package:flutter/material.dart';
import '../../../app/theme/app_tokens.dart';



/// Bloque skeleton con gradiente animado.
class ShimmerBox extends StatefulWidget {
  const ShimmerBox({
    this.width,
    this.height = 16,
    this.borderRadius = 8,
    super.key,
  });

  final double? width;
  final double height;
  final double borderRadius;

  @override
  State<ShimmerBox> createState() => _ShimmerBoxState();
}

class _ShimmerBoxState extends State<ShimmerBox>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final reduceMotion = MediaQuery.disableAnimationsOf(context);
    if (reduceMotion) {
      _controller.stop();
      _controller.value = 0.5;
    } else if (!_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (BuildContext context, Widget? child) {
        final t = _controller.value;
        return ShaderMask(
          blendMode: BlendMode.srcATop,
          shaderCallback: (Rect bounds) => LinearGradient(
            begin: Alignment(-1 - 2 * (1 - t), -1),
            end: Alignment(1 + 2 * t, 1),
            colors: <Color>[
              context.tokens.surfaceSunken,
              context.tokens.surfaceMuted,
              context.tokens.surfaceSunken,
            ],
          ).createShader(bounds),
          child: child,
        );
      },
      child: Container(
        width: widget.width,
        height: widget.height,
        decoration: BoxDecoration(
          color: context.tokens.surfaceSunken,
          borderRadius: BorderRadius.circular(widget.borderRadius),
        ),
      ),
    );
  }
}
