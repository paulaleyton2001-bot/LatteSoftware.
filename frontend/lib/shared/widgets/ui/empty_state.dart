// Estado vacío de una lista o pantalla.
//
// Regla: NINGUNA pantalla escribe su propio "no hay nada". Todas usan este
// widget, para que el usuario siempre reciba título, mensaje y una salida.
// La ilustración es [CustomPaint]: cero assets, cero red, escala a cualquier
// tamaño.
//
// ```dart
// EmptyState(icon: Icons.local_cafe_rounded, title: 'Aún no hay productos',
//   message: 'Crea tu primer producto para que aparezca en el menú.',
//   actionLabel: 'Crear producto',
//   onAction: () => context.push('/admin/products/new'));
// ```

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_spacing.dart';

/// Pantalla de "no hay nada" con ilustración vectorial propia (sin imágenes).
class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.title,
    required this.message,
    this.icon = Icons.inbox_rounded,
    this.actionLabel,
    this.onAction,
    this.compact = false,
    super.key,
  });

  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  /// `true` = versión de 96 dp para dentro de una card, no de pantalla.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            _EmptyIllustration(icon: icon, compact: compact),
            SizedBox(height: compact ? AppSpacing.md : AppSpacing.lg),
            Text(
              title,
              textAlign: TextAlign.center,
              style: (compact ? text.titleMedium : text.headlineSmall),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              message,
              textAlign: TextAlign.center,
              style: text.bodyMedium?.copyWith(color: AppColors.textSecondary),
            ),
            if (actionLabel != null && onAction != null) ...<Widget>[
              const SizedBox(height: AppSpacing.lg),
              FilledButton.icon(
                onPressed: onAction,
                icon: const Icon(Icons.add_rounded, size: 18),
                label: Text(actionLabel!),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.actionPrimary,
                  foregroundColor: AppColors.onActionPrimary,
                  minimumSize: const Size(0, AppTapTarget.buttonMedium),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Ilustración por defecto: copa/vaso abstracto con gradiente verde→crema
/// dibujado en [CustomPaint]. Evita depender de assets e ilusiones de red.
class _EmptyIllustration extends StatelessWidget {
  const _EmptyIllustration({required this.icon, required this.compact});

  final IconData icon;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final size = compact ? 72 : 128;
    return Semantics(
      image: true,
      label: 'Ilustración de estado vacío',
      child: CustomPaint(
        size: Size.square(size),
        painter: _EmptyIllustrationPainter(icon: icon),
        child: SizedBox.square(
          dimension: size,
          child: Icon(
            icon,
            size: size * 0.34,
            color: AppColors.brandDark,
          ),
        ),
      ),
    );
  }
}

class _EmptyIllustrationPainter extends CustomPainter {
  _EmptyIllustrationPainter({required this.icon});

  final IconData icon;

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final radius = size.width * 0.18;
    final halo = Paint()
      ..shader = const LinearGradient(
        begin: Alignment.topLeft,
        end: Alignment.bottomRight,
        colors: <Color>[AppColors.surfaceGreenSubtle, AppColors.surfaceMuted],
      ).createShader(rect);
    canvas.drawRRect(
      RRect.fromRectAndRadius(rect.deflate(size.width * 0.02), Radius.circular(radius)),
      halo,
    );

    // Arcos concéntricos: textura suave sin peso visual.
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 0.012
      ..color = AppColors.brand.withOpacity(0.35);
    final center = rect.center;
    for (int i = 1; i <= 3; i++) {
      canvas.drawCircle(center, size.width * 0.12 * i, stroke);
    }
  }

  @override
  bool shouldRepaint(_EmptyIllustrationPainter oldDelegate) =>
      oldDelegate.icon != icon;
}

