// Estado "sin conexión".
//
// Es un estado aparte del error genérico porque la acción correcta es
// distinta: no hay nada que "reintentar con otros datos", solo avisar y esperar
// a que vuelva la red. También ofrece "Reintentar ahora" que reintenta la
// lectura de red.
//
// Uso típico:
// ```dart
// OfflineState(onRetry: () => ref.invalidate(productsProvider));
// ```

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';

/// Pantalla de "estás sin conexión".
class OfflineState extends StatelessWidget {
  const OfflineState({
    this.onRetry,
    this.title = 'Estás sin conexión',
    this.message =
        'Revisa tu red. Los datos que ya cargamos siguen disponibles y se '
        'actualizarán solos cuando vuelvas.',
    this.pendingCount,
    super.key,
  });

  /// Reintenta la lectura. `null` = sin botón.
  final Future<void> Function()? onRetry;

  final String title;
  final String message;

  /// Número de operaciones en cola (pedido sin confirmar). Si es > 0 se
  /// muestra el aviso de que quedan pendientes: es información crítica para
  /// que el usuario no repita el pago.
  final int? pendingCount;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Container(
                padding: const EdgeInsets.all(AppSpacing.lg),
                decoration: BoxDecoration(
                  color: AppColors.surfaceWarningSubtle,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.wifi_off_rounded,
                  size: 34,
                  color: AppColors.textWarning,
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              Text(title, textAlign: TextAlign.center, style: text.titleLarge),
              const SizedBox(height: AppSpacing.sm),
              Text(
                message,
                textAlign: TextAlign.center,
                style: text.bodyMedium?.copyWith(color: AppColors.textSecondary),
              ),
              if (pendingCount != null && pendingCount! > 0) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                _PendingNotice(count: pendingCount!),
              ],
              if (onRetry != null) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                FilledButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh_rounded, size: 18),
                  label: const Text('Reintentar ahora'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.actionPrimary,
                    foregroundColor: AppColors.onActionPrimary,
                    minimumSize: const Size(0, 48),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Aviso de operaciones pendientes sin conexión (pedido sin confirmar).
class _PendingNotice extends StatelessWidget {
  const _PendingNotice({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final plural = count == 1 ? '1 operación pendiente' : '$count operaciones pendientes';
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.surfaceWarningSubtle,
        borderRadius: BorderRadius.circular(AppRadii.md),
        border: Border.all(color: AppColors.stateWarning),
      ),
      child: Row(
        children: <Widget>[
          const Icon(Icons.pending_actions_rounded,
              size: 20, color: AppColors.textWarning),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              '$plural. Se enviarán solas cuando vuelva la red; no repitas la '
              'operación manualmente.',
              style: AppTextStyles.captionMedium
                  .copyWith(color: AppColors.textWarning),
            ),
          ),
        ],
      ),
    );
  }
}
