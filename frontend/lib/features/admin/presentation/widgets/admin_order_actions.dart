// Acciones de estado de un pedido. MÓDULO `features/admin/presentation/widgets`.
//
// SEPARADAS DEL DETALLE POR TAMAÑO Y POR RIESGO
// Cancelar un pedido libera stock y puede disparar un reembolso: es la única
// acción destructiva de la pantalla y necesita su propio `ConfirmDialog` y su
// campo de motivo. Mezclada con el detalle, el archivo grewía hasta 550 líneas y
// la parte peligrosa quedaba enterrada entre líneas de importes.
//
// EL MOTIVO ES OBLIGATORIO
// `POST /orders/:id/status` responde `400` si el destino es `CANCELLED` o
// `REFUNDED` y no viene `reason` (API.md §7.12). Pedirlo en el diálogo evita el
// ida y vuelta fallido.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../domain/entities/admin_order_detail.dart';
import '../admin_orders_controller.dart';

/// Acciones de estado del pedido.
class AdminOrderStatusActions extends ConsumerWidget {
  const AdminOrderStatusActions({required this.detail, required this.orderId});

  final AdminOrderDetail detail;
  final int orderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> busy = ref.watch(adminOrderStatusProvider(orderId));
    final String? next = nextOrderStatus(detail.order.status);
    final bool closed = detail.order.status == 'CANCELLED' ||
        detail.order.status == 'COMPLETED' ||
        detail.order.status == 'REFUNDED';

    if (closed) {
      return AppCard(
        child: Row(
          children: <Widget>[
            Icon(Icons.lock_outline_rounded,
                size: 20, color: context.tokens.stateNeutral),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Text(
                'Este pedido está cerrado y no admite más cambios de estado.',
                style: AppTextStyles.bodySmall
                    .copyWith(color: context.tokens.textSecondary),
              ),
            ),
          ],
        ),
      );
    }

    return Row(
      children: <Widget>[
        if (next != null)
          Expanded(
            child: AppButton(
              label: 'Pasar a ${kAdminOrderStatusLabels[next]}',
              icon: Icons.arrow_forward_rounded,
              variant: AppButtonVariant.primary,
              isFullWidth: true,
              isLoading: busy.isLoading,
              onPressed: busy.isLoading
                  ? null
                  : () => ref
                      .read(adminOrderStatusProvider(orderId).notifier)
                      .change(next),
            ),
          ),
        const SizedBox(width: AppSpacing.sm),
        AppButton(
          label: 'Cancelar pedido',
          icon: Icons.cancel_outlined,
          variant: AppButtonVariant.danger,
          isLoading: busy.isLoading,
          onPressed: busy.isLoading
              ? null
              : () => _confirmCancel(context, ref),
        ),
      ],
    );
  }

  /// Cancelar exige motivo: el backend responde `400` sin él.
  Future<void> _confirmCancel(BuildContext context, WidgetRef ref) async {
    final TextEditingController reason = TextEditingController();
    final String? text = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Cancelar el pedido'),
        content: AppTextField(
          controller: reason,
          label: 'Motivo de la cancelación',
          hint: 'Cliente se retiró, producto agotado…',
          maxLines: 3,
          maxLength: 300,
          autofocus: true,
          helperText: 'El motivo queda en el historial del pedido.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Volver'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(reason.text),
            child: const Text('Cancelar pedido'),
          ),
        ],
      ),
    );
    reason.dispose();
    // `context.mounted` y no `ref.mounted`: `ref` es el `WidgetRef` del
    // `ConsumerWidget` y lo que se desmonta es el widget. Se comprueba DESPUÉS de
    // cerrar el diálogo porque `showDialog` es lo que puede tumbar la pantalla.
    if (text == null || text.trim().isEmpty || !context.mounted) return;

    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Cancelar ${detail.order.orderNumber}?',
      message: 'Se libera el stock reservado. Si el pedido tiene pagos '
          'aprobados, el backend lo reembolsará.',
      confirmLabel: 'Sí, cancelar',
      action: DialogAction.cancel,
      icon: Icons.cancel_outlined,
    );
    if (action != DialogAction.confirm) return;
    await ref
        .read(adminOrderStatusProvider(orderId).notifier)
        .change('CANCELLED', reason: text.trim());
  }
}
