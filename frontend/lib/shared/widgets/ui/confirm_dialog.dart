// Diálogo de confirmación.
//
// Única forma de pedir confirmación en la app. Se llama con `showDialog` y se
// resuelve con un [DialogAction], nunca con un `bool`, para que cada sitio
// acepte explícitamente una decisión.
//
// El foco entra al diálogo, queda atrapado dentro mientras está abierto
// (Material lo hace) y se restaura al widget que lo abrió al cerrarse.
//
// Uso típico:
// ```dart
// final DialogAction action = await ConfirmDialog.show(
//   context,
//   title: '¿Cancelar el pedido ORD-1042?',
//   message: 'El pedido se marcará como cancelado. Si ya se cobró, se '
//       'generará un reembolso automático.',
//   action: DialogAction.cancel,
// );
// if (action == DialogAction.confirm && context.mounted) {
//   await ref.read(orderProvider.notifier).cancel(order.id);
// }
// ```

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';

/// Decisión devuelta por [ConfirmDialog].
enum DialogAction {
  /// El usuario confirmó (botón destructivo o principal).
  confirm,

  /// El usuario canceló o cerró el diálogo.
  cancel,
}

/// Diálogo de confirmación, destructivo por defecto.
///
/// `showDialog` + este widget es el camino correcto: gestiona el foco y la
/// trampa de foco, a diferencia de un bottom sheet, que además se puede
/// arrastrar o cerrar por error. Las acciones destructivas exigen atención.
class ConfirmDialog extends StatelessWidget {
  const ConfirmDialog({
    required this.title,
    required this.message,
    this.action = DialogAction.cancel,
    this.confirmLabel = 'Confirmar',
    this.cancelLabel = 'Cancelar',
    this.icon = Icons.help_outline_rounded,
    super.key,
  });

  /// Abre el diálogo y devuelve la decisión del usuario.
  static Future<DialogAction> show(
    BuildContext context, {
    required String title,
    required String message,
    DialogAction action = DialogAction.cancel,
    String confirmLabel = 'Confirmar',
    String cancelLabel = 'Cancelar',
    IconData icon = Icons.help_outline_rounded,
  }) async {
    final DialogAction? result = await showDialog<DialogAction>(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext context) => ConfirmDialog(
        title: title,
        message: message,
        action: action,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        icon: icon,
      ),
    );
    return result ?? DialogAction.cancel;
  }

  final String title;
  final String message;

  /// Acción de la confirmación: `cancel` = destructiva (rojo), `confirm`
  /// = inocua (verde).
  final DialogAction action;

  final String confirmLabel;
  final String cancelLabel;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final destructive = action == DialogAction.cancel;
    final accent =
        destructive ? AppColors.actionDanger : AppColors.actionPrimary;

    return AlertDialog(
      icon: Icon(icon, color: accent, size: 28),
      title: Text(title, textAlign: TextAlign.center),
      content: Text(
        message,
        textAlign: TextAlign.center,
        style: text.bodyMedium?.copyWith(color: AppColors.textSecondary),
      ),
      actionsPadding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        0,
        AppSpacing.lg,
        AppSpacing.lg,
      ),
      actions: <Widget>[
        Row(
          children: <Widget>[
            Expanded(
              child: TextButton(
                onPressed: () => Navigator.of(context).pop(DialogAction.cancel),
                style: TextButton.styleFrom(
                  minimumSize: const Size(0, AppTapTarget.buttonMedium),
                  foregroundColor: AppColors.textSecondary,
                ),
                child: Text(cancelLabel),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: FilledButton(
                onPressed: () => Navigator.of(context).pop(DialogAction.confirm),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, AppTapTarget.buttonMedium),
                  backgroundColor: accent,
                  foregroundColor: AppColors.onActionPrimary,
                  textStyle: AppTextStyles.labelLarge,
                ),
                child: Text(confirmLabel),
              ),
            ),
          ],
        ),
      ],
    );
  }
}
