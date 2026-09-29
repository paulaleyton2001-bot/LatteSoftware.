// Tarjeta de un usuario del equipo. MÓDULO `features/admin/presentation/widgets`.
//
// EL ESTADO TIENE TRES BOTONES, NO UN DESPLEGABLE CON SEIS ESTADOS
// Activar, inactivar y bloquear. Bloquear EXIGE motivo y revoca todas las sesiones.
// Son tres acciones con tres consecuencias distintas; un desplegable las escondería
// detrás de un nombre y alguien desactivaría a un compañero en lugar de bloquear a
// un ladrón.
//
// NADIE SE CAMBIA A SÍ MISMO
// `PATCH /users/:id/status` responde `422 SELF_DEACTIVATION_FORBIDDEN` si el actor
// se desactiva a sí mismo. La UI lo oculta (`isSelf`) para que el intento ni se
// pueda hacer: un error previsible es una opción, no un botón que produce un error.
//
// EL ÚLTIMO PROPIETARIO ESTÁ PROTEGIDO EN EL BACKEND
// Quitar el rol `OWNER` al último `OWNER` da `422 LAST_OWNER_PROTECTED`. La UI no
// puede saberlo de antemano, así que el mensaje del backend se muestra tal cual en
// vez de deshabilitar el botón a ciegas.

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
import '../../domain/entities/admin_accounts.dart';
import '../admin_users_controller.dart';

/// Tarjeta de un usuario con su estado y sus acciones.
class AdminUserCard extends ConsumerWidget {
  const AdminUserCard({required this.user, required this.isSelf});

  final AdminUser user;
  final bool isSelf;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> busy = ref.watch(adminUserProvider(user.id));
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
                  user.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleSmall,
                ),
              ),
              AdminUserStatusTag(user: user),
            ],
          ),
          Text(
            user.email,
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.xs,
            runSpacing: AppSpacing.xs,
            children: <Widget>[
              for (final String role in user.roles)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.sm,
                    vertical: AppSpacing.xxs,
                  ),
                  decoration: BoxDecoration(
                    color: context.tokens.surfaceMuted,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(role, style: AppTextStyles.labelSmall),
                ),
              if (user.lastLoginAt != null)
                Text(
                  'Último acceso ${DateFormatter.relative(user.lastLoginAt!)}',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
            ],
          ),
          if (!isSelf) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: <Widget>[
                if (user.isActive)
                  AppButton(
                    label: 'Inactivar',
                    variant: AppButtonVariant.secondary,
                    size: AppButtonSize.small,
                    isLoading: busy.isLoading,
                    onPressed: enabled
                        ? () => ref
                            .read(adminUserProvider(user.id).notifier)
                            .setStatus('INACTIVE')
                        : null,
                    tooltip: 'Le revoca todas las sesiones',
                  )
                else
                  AppButton(
                    label: 'Reactivar',
                    variant: AppButtonVariant.primary,
                    size: AppButtonSize.small,
                    isLoading: busy.isLoading,
                    onPressed: enabled
                        ? () => ref
                            .read(adminUserProvider(user.id).notifier)
                            .setStatus('ACTIVE')
                        : null,
                  ),
                const SizedBox(width: AppSpacing.sm),
                if (!user.isActive)
                  AppButton(
                    label: 'Bloquear',
                    icon: Icons.block_rounded,
                    variant: AppButtonVariant.danger,
                    size: AppButtonSize.small,
                    isLoading: busy.isLoading,
                    onPressed: enabled
                        ? () => _block(context, ref)
                        : null,
                  ),
              ],
            ),
          ] else ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Es tu cuenta: no puedes cambiarte el estado a ti mismo.',
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textTertiary),
            ),
          ],
        ],
      ),
    );
  }

  /// Bloquear exige motivo (`reason` es obligatorio para `BLOCKED`) y confirmación.
  Future<void> _block(BuildContext context, WidgetRef ref) async {
    final TextEditingController reason = TextEditingController();
    final String? text = await showDialog<String>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: const Text('Bloquear usuario'),
        content: AppTextField(
          controller: reason,
          label: 'Motivo del bloqueo',
          hint: 'Robo, conflicto laboral, acceso compartido…',
          maxLines: 2,
          maxLength: 500,
          autofocus: true,
          helperText: 'Le revoca TODAS las sesiones inmediatamente.',
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
      title: '¿Bloquear a ${user.displayName}?',
      message: 'No podrá entrar hasta que alguien lo reactive.',
      confirmLabel: 'Bloquear',
      action: DialogAction.cancel,
      icon: Icons.block_rounded,
    );
    if (action != DialogAction.confirm) return;
    await ref
        .read(adminUserProvider(user.id).notifier)
        .setStatus('BLOCKED', reason: text.trim());
  }
}

/// Distintivo de estado de la cuenta. Texto + color.
class AdminUserStatusTag extends StatelessWidget {
  const AdminUserStatusTag({required this.user});

  final AdminUser user;

  @override
  Widget build(BuildContext context) {
    final String label = switch (user.status) {
          'ACTIVE' => 'Activo',
          'INACTIVE' => 'Inactivo',
          'BLOCKED' => 'Bloqueado',
          _ => user.status,
        };
    final Color color = switch (user.status) {
      'ACTIVE' => context.tokens.textSuccess,
      'INACTIVE' => context.tokens.textTertiary,
      _ => context.tokens.textError,
    };
    return Semantics(
      label: 'Estado de la cuenta: $label',
      excludeSemantics: true,
      child: Text(label, style: AppTextStyles.labelMedium.copyWith(color: color)),
    );
  }
}
