// Estados de carga de primer nivel.
//
// Regla del proyecto: NINGUNA pantalla escribe su propio spinner. Para listas
// y grids se prefiere [ShimmerList] (skeleton con las medidas reales del
// contenido) porque un spinner que se reemplaza por contenido genera CLS, uno
// de los Core Web Vitals. El shimmer en sí vive en `shimmer.dart`.

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';
import 'shimmer.dart';

/// Spinner centrado con mensaje opcional.
class AppSpinner extends StatelessWidget {
  const AppSpinner({this.message, this.size = 28, super.key});

  final String? message;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          SizedBox.square(
            dimension: size,
            child: const CircularProgressIndicator(
              strokeWidth: 2.5,
              valueColor: AlwaysStoppedAnimation<Color>(AppColors.actionPrimary),
            ),
          ),
          if (message != null) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            Text(
              message!,
              textAlign: TextAlign.center,
              style: AppTextStyles.bodyMedium
                  .copyWith(color: AppColors.textSecondary),
            ),
          ],
        ],
      ),
    );
  }
}

/// Lista skeleton para la primera carga (mismo alto que las cards reales para
/// no provocar CLS — Cumulative Layout Shift).
class ShimmerList extends StatelessWidget {
  const ShimmerList({this.itemCount = 6, this.itemHeight = 72, super.key});

  final int itemCount;
  final double itemHeight;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.lg),
      itemCount: itemCount,
      separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.md),
      itemBuilder: (_, __) => Row(
        children: <Widget>[
          ShimmerBox(width: itemHeight, height: itemHeight, borderRadius: 12),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                ShimmerBox(width: itemHeight * 2.4, height: 14),
                const SizedBox(height: AppSpacing.sm),
                ShimmerBox(width: itemHeight * 1.6, height: 12),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
