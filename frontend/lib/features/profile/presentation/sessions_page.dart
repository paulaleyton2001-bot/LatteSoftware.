// Sesiones activas del cliente (`GET /auth/sessions` + `DELETE /auth/sessions/:id`).
//
// POR QUÉ PUEDE IMPORTARLE A ALGUIEN
// El access token vive 15 minutos, pero el REFRESH dura 30 días. Si alguien toma
// prestado el teléfono, puede pedir pedidos durante un mes sin volver a
// autenticarse. Poder ver y revocar sesiones es la diferencia entre "me han
// pedido café" y "me han vaciado la cuenta".
//
// LA SESIÓN ACTUAL NO SE PUEDE REVOCAR DESDE AQUÍ
// El backend responde `422` si se intenta revocar la propia sesión
// (API.md §7.1): la forma correcta es `POST /auth/logout`. Por eso la fila
// actual se pinta marcada y SIN botón, con una explicación, en vez de ofrecer una
// acción que va a fallar.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../domain/entities/auth_result.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/confirm_dialog.dart';
import './profile_controller.dart';

/// Pantalla de sesiones activas.
class SessionsPage extends ConsumerWidget {
  const SessionsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<AuthDeviceSession>> sessions = ref.watch(
      deviceSessionsProvider,
    );
    final ProfileAction action = ref.watch(profileActionProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Sesiones activas')),
      body: SafeArea(
        child: AsyncStateBuilder<List<AuthDeviceSession>>(
          value: sessions,
          loadingMessage: 'Buscando tus sesiones…',
          onRetry: () async => ref.invalidate(deviceSessionsProvider),
          isEmpty: (List<AuthDeviceSession> data) => data.isEmpty,
          emptyIcon: Icons.devices_other_rounded,
          emptyTitle: 'No hay sesiones abiertas',
          emptyMessage: 'Cuando inicies sesión en un dispositivo, aparecerá aquí '
              'para que puedas cerrarla cuando quieras.',
          builder: (BuildContext context, List<AuthDeviceSession> data) => ListView(
            padding: const EdgeInsets.all(AppSpacing.lg),
            children: <Widget>[
              if (action.failure != null) ...<Widget>[
                _Banner(failure: action.failure!),
                const SizedBox(height: AppSpacing.md),
              ],
              for (final AuthDeviceSession session in data)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.md),
                  child: _SessionCard(session: session),
                ),
              const SizedBox(height: AppSpacing.md),
              _Note(
                text: 'Cerrar una sesión no borra tus pedidos ni tus reservas: '
                    'solo impide entrar desde ese dispositivo.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Tarjeta de una sesión.
class _SessionCard extends ConsumerWidget {
  const _SessionCard({required this.session});

  final AuthDeviceSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AppCard(
      color: session.isCurrent ? context.tokens.surfaceGreenSubtle : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                _iconFor(session),
                size: 20,
                color: session.isCurrent
                    ? context.tokens.actionPrimary
                    : context.tokens.textSecondary,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  _titleOf(session),
                  style: AppTextStyles.titleSmall,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (session.isCurrent)
                Text(
                  'Esta',
                  style: AppTextStyles.labelMedium
                      .copyWith(color: context.tokens.textSuccess),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          if (session.createdAt != null)
            Text(
              'Abierta el ${DateFormatter.dateTime(session.createdAt!)}',
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          if (session.ipAddress != null)
            Text(
              session.ipAddress!,
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textTertiary),
            ),
          if (!session.isCurrent) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            AppButton(
              label: 'Cerrar esta sesión',
              icon: Icons.logout_rounded,
              variant: AppButtonVariant.danger,
              size: AppButtonSize.small,
              onPressed: () => _revoke(context, ref),
              semanticLabel: 'Cerrar la sesión de ${_titleOf(session)}',
            ),
          ],
        ],
      ),
    );
  }

  Future<void> _revoke(BuildContext context, WidgetRef ref) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Cerrar esta sesión?',
      message: 'Ese dispositivo tendrá que volver a iniciar sesión. Tus pedidos '
          'y reservas no se ven afectados.',
      action: DialogAction.cancel,
      confirmLabel: 'Cerrar sesión',
      icon: Icons.logout_rounded,
    );
    if (action != DialogAction.confirm || !context.mounted) return;

    await ref.read(profileActionProvider.notifier).run(() async {
      final Result<AuthResult> result =
          await ref.read(authRepositoryProvider).revokeSession(session.id);
      return switch (result) {
        Success<AuthResult>(:final AuthResult value) => Success<String>(value.message),
        // El callback declara `Future<Result<String>>`: el fallo también tiene que
        // ir envuelto, o la rama devuelve `Object` y no compila.
        FailureResult<AuthResult>(:final Failure failure) =>
          FailureResult<String>(failure),
      };
    });
    if (!context.mounted) return;
    ref.invalidate(deviceSessionsProvider);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Sesión cerrada.')),
    );
    ref.read(profileActionProvider.notifier).reset();
  }

  /// `deviceInfo` es texto libre que manda el cliente; se acota a los primeros
  /// caracteres y, si no dice nada útil, se cae a "Este dispositivo".
  static String _titleOf(AuthDeviceSession session) {
    final String? info = session.deviceInfo?.trim();
    if (info == null || info.isEmpty) return 'Este dispositivo';
    return info.length <= 40 ? info : '${info.substring(0, 39)}…';
  }

  static IconData _iconFor(AuthDeviceSession session) {
    final String info = (session.deviceInfo ?? '').toLowerCase();
    if (info.contains('android') || info.contains('mobile')) {
      return Icons.smartphone_rounded;
    }
    if (info.contains('windows')) return Icons.desktop_windows_rounded;
    if (info.contains('mac') || info.contains('ios')) {
      return Icons.laptop_mac_rounded;
    }
    if (info.contains('web') || info.contains('chrome')) {
      return Icons.public_rounded;
    }
    return Icons.devices_rounded;
  }
}

/// Banner de error de la acción.
class _Banner extends StatelessWidget {
  const _Banner({required this.failure});

  final Failure failure;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: context.tokens.surfaceErrorSubtle,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
           Icon(Icons.error_outline_rounded, size: 18, color: context.tokens.textError),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              failure.message,
              style: AppTextStyles.bodySmall.copyWith(color: context.tokens.textError),
            ),
          ),
        ],
      ),
    );
  }
}

/// Nota informativa.
class _Note extends StatelessWidget {
  const _Note({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: AppTextStyles.captionMedium
          .copyWith(color: context.tokens.textSecondary),
      textAlign: TextAlign.center,
    );
  }
}
