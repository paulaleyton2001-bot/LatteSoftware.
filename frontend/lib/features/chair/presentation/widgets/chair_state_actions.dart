// Acciones de ESTADO de una silla para el personal.
// Módulo `features/chair/presentation/widgets`.
//
// CUATRO BOTONES, NO UN DESPLEGABLE CON SEIS ESTADOS
// `PATCH /chairs/:id/status` acepta `AVAILABLE | BLOCKED | MAINTENANCE | CLEANING`.
// `OCCUPIED` y `RESERVED` los pone el flujo de alquileres y mandarlos da
// `422 INVALID_CHAIR_STATUS_TRANSITION` (BR-CHAIR-003). Un desplegable con los seis
// estados sería una lista de errores previsibles; cuatro botones que SOLO ofrecen lo
// válido hace que el error sea imposible de cometer. Es el mismo criterio que sigue
// `features/admin/presentation/widgets/admin_chair_actions.dart`, y se repite aquí
// porque son dos superficies distintas (el panel de administración y la pestaña
// «Silla» del móvil) con permisos distintos: el panel del admin no se monta para
// personal sin `users:read`.
//
// SOLO SE PINTA SI HAY PERMISO
// El widget se incluye desde `ChairActionPanel` únicamente cuando
// `ChairCapabilities.canChangeChairStatus` es `true`, así que aquí no hace falta
// volver a comprobarlo. Aun así el botón va con `onPressed: null` mientras se envía:
// un segundo toque duplicaría la llamada.
//
// MOTIVO OBLIGATORIO PARA BLOQUEAR Y MANTENIMIENTO
// El backend lo exige (`reason` requerido si el destino es `BLOCKED` o
// `MAINTENANCE`) y responde `400` sin él. Esas dos acciones abren un diálogo con el
// campo, y el diálogo no se cierra con un motivo vacío.
//
// EL 422 CON RESERVAS ACTIVAS SE EXPLICA, NO SE ESCONDE
// Bloquear una silla que tiene una reserva confirmada da
// `422 CHAIR_HAS_ACTIVE_BOOKING` («La silla tiene reservas activas: cancélelas o
// reasígnalas primero»). Es una situación normal —una reserva de mañana— y la
// respuesta tiene que decir qué hacer, no «algo salió mal».

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/app_spacing.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/error/failures.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../chair_action_controller.dart';
import '../chair_controller.dart';

/// Fila de acciones de estado de una silla.
class ChairStateActions extends ConsumerWidget {
  const ChairStateActions({required this.chair, super.key});

  final ChairInfo chair;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String status = chair.status;
    final AsyncValue<void> busy = ref.watch(chairStatusProvider(chair.id));
    final bool sending = busy.isLoading;
    final Object? error = busy.error;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Semantics(
          header: true,
          child: Text('Gestión de la silla', style: Theme.of(context).textTheme.titleSmall),
        ),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: <Widget>[
            // --- Volver a disponible ----------------------------------------
            if (status != 'AVAILABLE' && status != 'OCCUPIED' && status != 'RESERVED')
              AppButton(
                label: 'Liberar',
                icon: Icons.lock_open_rounded,
                variant: AppButtonVariant.primary,
                size: AppButtonSize.small,
                isLoading: sending,
                onPressed: sending ? null : () => _release(context, ref),
              ),
            if (status == 'BLOCKED')
              AppButton(
                label: 'Desbloquear',
                icon: Icons.lock_open_rounded,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.small,
                isLoading: sending,
                onPressed: sending ? null : () => _plain(context, ref, 'AVAILABLE'),
              ),
            if (status == 'MAINTENANCE')
              AppButton(
                label: 'Cerrar mantenimiento',
                icon: Icons.build_circle_outlined,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.small,
                isLoading: sending,
                onPressed: sending
                    ? null
                    : () => _plain(context, ref, 'CLEANING', confirm: true),
              ),
            // --- Sacar del servicio ----------------------------------------
            if (status == 'AVAILABLE' || status == 'CLEANING') ...<Widget>[
              AppButton(
                label: 'Bloquear',
                icon: Icons.block_rounded,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.small,
                isLoading: sending,
                onPressed: sending
                    ? null
                    : () => _withReason(context, ref, 'BLOCKED'),
              ),
              AppButton(
                label: 'Mantenimiento',
                icon: Icons.build_outlined,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.small,
                isLoading: sending,
                onPressed: sending
                    ? null
                    : () => _withReason(context, ref, 'MAINTENANCE'),
              ),
            ],
            // --- Sacar de limpieza -----------------------------------------
            if (status == 'CLEANING')
              AppButton(
                label: 'Marcar limpia',
                icon: Icons.auto_awesome_rounded,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.small,
                isLoading: sending,
                onPressed: sending ? null : () => _plain(context, ref, 'AVAILABLE'),
              ),
          ],
        ),
        if (error != null) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          FormErrorBanner(
            failure: error is Failure ? error : UnknownFailure(details: '$error'),
            title: _errorTitle(error),
            compact: true,
          ),
        ],
      ],
    );
  }

  /// Título del banner según el motivo. `422 CHAIR_HAS_ACTIVE_BOOKING` merece su
  /// propio texto porque es la causa más frecuente y la que más confunde.
  static String _errorTitle(Object error) {
    if (error is Failure && error.code == 'CHAIR_HAS_ACTIVE_BOOKING') {
      return 'La silla tiene reservas activas';
    }
    return 'No se pudo cambiar el estado';
  }

  /// Cambio sin motivo.
  Future<void> _plain(
    BuildContext context,
    WidgetRef ref,
    String status, {
    bool confirm = false,
  }) async {
    if (confirm) {
      final DialogAction action = await ConfirmDialog.show(
        context,
        title: '¿Cerrar el mantenimiento de ${chair.cellLabel}?',
        message: 'La silla pasará a "limpieza" y quedará fuera de servicio hasta '
            'que se marque como limpia.',
        confirmLabel: 'Cerrar',
        action: DialogAction.cancel,
        icon: Icons.build_circle_outlined,
      );
      if (action != DialogAction.confirm || !context.mounted) return;
    }
    await _run(context, ref, status);
  }

  /// `Liberar`: el atajo que hace falta después de cerrar un alquiler, porque
  /// `POST /rentals/:id/complete` deja la silla en `CLEANING`, no en `AVAILABLE`
  /// (verificado con `curl`: tras el `complete`, `GET /chairs/:id` →
  /// `status = "CLEANING"`).
  Future<void> _release(BuildContext context, WidgetRef ref) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Liberar ${chair.cellLabel}?',
      message: 'La silla vuelve a estar disponible y cualquiera podrá reservarla.',
      confirmLabel: 'Liberar',
      action: DialogAction.cancel,
      icon: Icons.lock_open_rounded,
    );
    if (action != DialogAction.confirm || !context.mounted) return;
    await _run(context, ref, 'AVAILABLE');
  }

  /// Cambio que exige motivo.
  Future<void> _withReason(BuildContext context, WidgetRef ref, String status) async {
    final TextEditingController reason = TextEditingController();
    final String? text = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(
          status == 'BLOCKED' ? 'Bloquear silla' : 'Enviar a mantenimiento',
        ),
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
            // `pop(null)` si está vacío: el controlador vuelve a comprobar que el
            // motivo no venga en blanco, y así el diálogo no "acepta" un motivo
            // que luego se pierde.
            onPressed: () => Navigator.of(dialogContext)
                .pop(reason.text.trim().isEmpty ? null : reason.text.trim()),
            child: const Text('Guardar'),
          ),
        ],
      ),
    );
    // El `TextEditingController` es de este método, no del widget: se libera aquí,
    // en los DOS caminos (confirmado y cancelado), o el diálogo que se abrió veinte
    // veces en un turno dejaría veinte controladores vivos.
    reason.dispose();
    if (text == null || !context.mounted) return;
    await _run(context, ref, status, reason: text);
  }

  Future<void> _run(
    BuildContext context,
    WidgetRef ref,
    String status, {
    String? reason,
  }) async {
    final ChairStatusResult result = await ref
        .read(chairStatusProvider(chair.id).notifier)
        .setStatus(status, reason: reason);
    if (!context.mounted) return;
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    if (result.isSuccess) {
      messenger
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(content: Text('${chair.cellLabel}: estado $status.')),
        );
      return;
    }
    // El `422 CHAIR_HAS_ACTIVE_BOOKING` ya sale con su banner arriba. Aquí solo se
    // avisa de los cambios de estado que exigen recargar el plano.
    if (result.outcome == ActionOutcome.conflict) {
      refreshChairMap(ref);
    }
  }
}
