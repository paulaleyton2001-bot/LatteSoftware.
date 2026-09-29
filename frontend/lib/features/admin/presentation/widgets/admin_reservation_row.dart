// Fila de reserva. MÓDULO `features/admin/presentation/widgets`.
//
// LAS CUATRO ACCIONES, SEGÚN EL ESTADO
// `PENDING` → confirmar · `PENDING`/`CONFIRMED` → check-in · `CONFIRMED`/`PENDING` →
// extender · cualquiera no cerrada → cancelar. El estado DECIDE las acciones, y las
// que no aplican ni se pintan: un botón que el backend va a rechazar es peor que un
// botón que no existe.
//
// CANCELAR ES DESTRUCTIVO Y LLEVA MOTIVO
// `POST /reservations/:id/cancel` exige `reason`. Sin motivo no hay histórico útil
// para un cliente que reclama.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/admin_spaces.dart';
import '../admin_reservations_controller.dart';

/// Fila de una reserva con sus acciones.
class AdminReservationRow extends ConsumerWidget {
  const AdminReservationRow({required this.reservation, super.key});

  final AdminReservation reservation;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> busy =
        ref.watch(adminReservationProvider(reservation.id));
    final bool enabled = !busy.isLoading;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  '${reservation.code} · ${reservation.chairCode ?? 'sin silla'}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleSmall,
                ),
              ),
              StatusBadge.reservation(reservation.status, compact: true),
              const SizedBox(width: AppSpacing.sm),
              PriceDisplay(currentMinor: reservation.rentalTotalMinor),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            <String>[
              if (reservation.startAt != null)
                DateFormatter.dateTime(reservation.startAt!),
              if (reservation.endAt != null)
                '→ ${DateFormatter.time(reservation.endAt!)}',
              if (reservation.durationMinutes > 0)
                '${reservation.durationMinutes} min',
              if (reservation.customerName != null) reservation.customerName!,
            ].join(' · '),
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: <Widget>[
              if (reservation.canConfirm)
                AppButton(
                  label: 'Confirmar',
                  icon: Icons.check_rounded,
                  variant: AppButtonVariant.primary,
                  size: AppButtonSize.small,
                  isLoading: busy.isLoading,
                  onPressed: enabled
                      ? () => ref
                          .read(adminReservationProvider(reservation.id).notifier)
                          .confirm()
                      : null,
                ),
              if (reservation.canCheckIn)
                AppButton(
                  label: 'Check-in',
                  icon: Icons.login_rounded,
                  variant: AppButtonVariant.secondary,
                  size: AppButtonSize.small,
                  isLoading: busy.isLoading,
                  onPressed: enabled
                      ? () => ref
                          .read(adminReservationProvider(reservation.id).notifier)
                          .checkIn()
                      : null,
                  tooltip: 'Activa la reserva y abre el alquiler',
                ),
              if (reservation.canExtend)
                AppButton(
                  label: 'Extender',
                  icon: Icons.more_time_rounded,
                  variant: AppButtonVariant.secondary,
                  size: AppButtonSize.small,
                  isLoading: busy.isLoading,
                  onPressed: enabled
                      ? () => _extend(context, ref)
                      : null,
                ),
              if (reservation.canCancel)
                AppButton(
                  label: 'Cancelar',
                  icon: Icons.close_rounded,
                  variant: AppButtonVariant.danger,
                  size: AppButtonSize.small,
                  isLoading: busy.isLoading,
                  onPressed: enabled
                      ? () => _cancel(context, ref)
                      : null,
                ),
            ],
          ),
        ],
      ),
    );
  }

  /// Extiende una hora. El valor es una constante y no un input porque la pantalla
  /// es de gestión, no de caja: si hay que ser preciso, se hace desde el detalle.
  Future<void> _extend(BuildContext context, WidgetRef ref) async {
    final DateTime? base = reservation.endAt;
    if (base == null) return;
    await ref
        .read(adminReservationProvider(reservation.id).notifier)
        .extend(base.add(const Duration(hours: 1)));
  }

  /// Cancelación con motivo obligatorio y confirmación destructiva.
  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final TextEditingController reason = TextEditingController();
    final String? text = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Cancelar la reserva'),
        content: AppTextField(
          controller: reason,
          label: 'Motivo',
          hint: 'El cliente no viene, cambio de planes…',
          maxLines: 3,
          maxLength: 500,
          autofocus: true,
          helperText: 'Obligatorio. Queda en el histórico de la reserva.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Volver'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(reason.text),
            child: const Text('Continuar'),
          ),
        ],
      ),
    );
    reason.dispose();
    if (text == null || text.trim().isEmpty || !context.mounted) return;

    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Cancelar ${reservation.code}?',
      message: 'La silla se libera y el cliente recibe el aviso.',
      confirmLabel: 'Sí, cancelar',
      action: DialogAction.cancel,
    );
    if (action != DialogAction.confirm) return;
    await ref
        .read(adminReservationProvider(reservation.id).notifier)
        .cancel(text.trim());
  }
}
