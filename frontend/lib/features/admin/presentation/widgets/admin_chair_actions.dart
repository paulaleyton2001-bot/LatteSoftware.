// Acciones de estado de una silla. MÓDULO `features/admin/presentation/widgets`.
//
// CUATRO BOTONES, NO UN DESPLEGABLE CON SEIS ESTADOS
// `PATCH /chairs/:id/status` acepta `AVAILABLE | BLOCKED | MAINTENANCE |
// CLEANING`. `OCCUPIED` y `RESERVED` los pone el flujo de alquileres y mandarlos da
// `422 INVALID_CHAIR_STATUS_TRANSITION` (BR-CHAIR-003). Un `DropdownButton` con los
// seis estados sería una lista de errores previsibles; cuatro botones que SOLO
// ofrecen lo válido hace que el error sea imposible de cometer.
//
// MOTIVO OBLIGATORIO PARA BLOQUEAR Y MANTENIMIENTO
// El backend lo exige (`reason` req. si `status = BLOCKED` o `MAINTENANCE`) y
// responde `400` sin él. Por eso esas dos acciones abren un diálogo con el campo de
// motivo, en vez de llamar directamente.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../domain/entities/admin_spaces.dart';
import '../admin_spaces_controller.dart';

/// Fila de acciones de una silla.
class AdminChairActions extends ConsumerWidget {
  const AdminChairActions({required this.chair, required this.isBusy, super.key});

  final AdminChair chair;
  final bool isBusy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String status = chair.status;
    final bool blocked = status == 'BLOCKED';
    final bool inMaintenance = status == 'MAINTENANCE';

    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: <Widget>[
        if (blocked)
          AppButton(
            label: 'Desbloquear',
            icon: Icons.lock_open_rounded,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.small,
            isLoading: isBusy,
            onPressed: isBusy
                ? null
                : () => _run(context, ref, 'AVAILABLE', destructive: false),
          )
        else
          AppButton(
            label: 'Bloquear',
            icon: Icons.block_rounded,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.small,
            isLoading: isBusy,
            onPressed: isBusy
                ? null
                : () => _askReason(context, ref, 'BLOCKED'),
          ),
        if (inMaintenance)
          AppButton(
            label: 'Cerrar mantenimiento',
            icon: Icons.build_circle_outlined,
            variant: AppButtonVariant.primary,
            size: AppButtonSize.small,
            isLoading: isBusy,
            onPressed: isBusy
                ? null
                : () => _run(context, ref, 'CLEANING', destructive: false),
          )
        else
          AppButton(
            label: 'Mantenimiento',
            icon: Icons.build_outlined,
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.small,
            isLoading: isBusy,
            onPressed: isBusy
                ? null
                : () => _askReason(context, ref, 'MAINTENANCE'),
          ),
      ],
    );
  }

  /// Cambio directo (no necesita motivo).
  Future<void> _run(
    BuildContext context,
    WidgetRef ref,
    String status, {
    required bool destructive,
  }) async {
    if (destructive) {
      final DialogAction action = await ConfirmDialog.show(
        context,
        title: '¿Cambiar el estado de ${chair.cellLabel}?',
        message: 'La silla pasará a "$status" y dejará de estar disponible.',
        confirmLabel: 'Cambiar',
        action: DialogAction.cancel,
      );
      if (action != DialogAction.confirm || !context.mounted) return;
    }
    await ref
        .read(adminChairStatusProvider(chair.id).notifier)
        .setStatus(status);
  }

  /// Cambio que exige motivo.
  Future<void> _askReason(
    BuildContext context,
    WidgetRef ref,
    String status,
  ) async {
    final TextEditingController reason = TextEditingController();
    final String? text = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(status == 'BLOCKED' ? 'Bloquear silla' : 'Enviar a mantenimiento'),
        content: AppTextField(
          controller: reason,
          label: 'Motivo',
          hint: status == 'BLOCKED'
              ? 'Reparación, evento, cierre de zona…'
              : 'La silla está dañada…',
          maxLines: 3,
          maxLength: 300,
          autofocus: true,
          helperText: 'El motivo es obligatorio y queda en el historial.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Volver'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(reason.text),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    reason.dispose();
    if (text == null || text.trim().isEmpty || !context.mounted) return;
    await ref
        .read(adminChairStatusProvider(chair.id).notifier)
        .setStatus(status, reason: text.trim());
  }
}
