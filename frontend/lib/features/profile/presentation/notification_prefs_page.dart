// Preferencias de notificación (`GET/PUT /notifications/preferences`).
//
// `inApp` NO SE PUEDE APAGAR
// El backend responde `422 IN_APP_REQUIRED`: es el canal persistente del
// historial de avisos. Pintar un switch que se puede apagar y luego recibir un
// error del servidor es una trampa; aquí el canal de la app se muestra FIJO y
// desactivado, con la razón escrita al lado.
//
// LOS HORARIOS DE SILENCIO VIENEN O VIENEN
// `quietHoursFrom` y `quietHoursTo` son un par (CHECK en BD, `400
// QUIET_HOURS_INCOMPLETE` si se manda uno solo). Se editan con un par de campos
// y se guardan o se limpian JUNTOS, nunca uno a medias.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/error/failures.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/app_text_field.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/form_error_banner.dart';
import '../domain/entities/customer_stats.dart';
import './profile_controller.dart';
import './widgets/notification_channel_switch.dart';

/// Pantalla de preferencias de notificación.
class NotificationPrefsPage extends ConsumerStatefulWidget {
  const NotificationPrefsPage({super.key});

  @override
  ConsumerState<NotificationPrefsPage> createState() =>
      _NotificationPrefsPageState();
}

class _NotificationPrefsPageState extends ConsumerState<NotificationPrefsPage> {
  final TextEditingController _quietFrom = TextEditingController();
  final TextEditingController _quietTo = TextEditingController();
  bool _hydrated = false;

  @override
  void dispose() {
    _quietFrom.dispose();
    _quietTo.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<NotificationPreferences> value =
        ref.watch(notificationPrefsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Notificaciones')),
      body: SafeArea(
        child: AsyncStateBuilder<NotificationPreferences>(
          value: value,
          loadingMessage: 'Cargando tus preferencias…',
          onRetry: () async => ref.invalidate(notificationPrefsProvider),
          builder: (BuildContext context, NotificationPreferences prefs) {
            if (!_hydrated) {
              _hydrated = true;
              _quietFrom.text = prefs.quietHoursFrom ?? '';
              _quietTo.text = prefs.quietHoursTo ?? '';
            }
            final Object? error = value.error;
            return ListView(
              padding: const EdgeInsets.all(AppSpacing.lg),
              children: <Widget>[
                if (error is Failure) ...<Widget>[
                  FormErrorBanner(
                    failure: error,
                    onRetry: error.isRetryable
                        ? () => ref.invalidate(notificationPrefsProvider)
                        : null,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],
                Text('Canales', style: AppTextStyles.titleMedium),
                const SizedBox(height: AppSpacing.md),
                AppCard(
                  child: Column(
                    children: <Widget>[
                      NotificationChannelSwitch(
                        icon: Icons.notifications_rounded,
                        title: 'Dentro de la app',
                        description: 'Avisos de pedidos y reservas. Siempre '
                            'activo: es donde queda el historial.',
                        value: true,
                        enabled: false,
                      ),
                      const Divider(height: AppSpacing.lg),
                      NotificationChannelSwitch(
                        icon: Icons.smartphone_rounded,
                        title: 'Notificaciones del móvil',
                        description: 'Solo si tu navegador o sistema lo permite.',
                        value: prefs.push,
                        onChanged: (bool next) => ref
                            .read(notificationPrefsProvider.notifier)
                            .toggle(
                              push: next,
                              email: null,
                              sms: null,
                              whatsapp: null,
                            ),
                      ),
                      const Divider(height: AppSpacing.lg),
                      NotificationChannelSwitch(
                        icon: Icons.mail_outline_rounded,
                        title: 'Correo electrónico',
                        description: 'Te escribimos a ${'tu correo'}.',
                        value: prefs.email,
                        onChanged: (bool next) => ref
                            .read(notificationPrefsProvider.notifier)
                            .toggle(
                              push: null,
                              email: next,
                              sms: null,
                              whatsapp: null,
                            ),
                      ),
                      const Divider(height: AppSpacing.lg),
                      NotificationChannelSwitch(
                        icon: Icons.sms_rounded,
                        title: 'SMS',
                        description: 'Avisos urgentes de tu silla.',
                        value: prefs.sms,
                        onChanged: (bool next) => ref
                            .read(notificationPrefsProvider.notifier)
                            .toggle(
                              push: null,
                              email: null,
                              sms: next,
                              whatsapp: null,
                            ),
                      ),
                      const Divider(height: AppSpacing.lg),
                      NotificationChannelSwitch(
                        icon: Icons.chat_rounded,
                        title: 'WhatsApp',
                        description: 'Solo si guardaste tu número.',
                        value: prefs.whatsapp,
                        onChanged: (bool next) => ref
                            .read(notificationPrefsProvider.notifier)
                            .toggle(
                              push: null,
                              email: null,
                              sms: null,
                              whatsapp: next,
                            ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                Text('Horario de silencio', style: AppTextStyles.titleMedium),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  'No te enviamos nada entre esas dos horas. Déjalo vacío si '
                  'prefieres avisos a cualquier hora.',
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
                const SizedBox(height: AppSpacing.md),
                AppCard(
                  child: Column(
                    children: <Widget>[
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: AppTextField(
                              controller: _quietFrom,
                              label: 'Desde',
                              hint: '22:00',
                              prefixIcon: Icons.bedtime_outlined,
                              textInputAction: TextInputAction.next,
                              semanticLabel: 'Hora de inicio del silencio',
                            ),
                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: AppTextField(
                              controller: _quietTo,
                              label: 'Hasta',
                              hint: '07:00',
                              prefixIcon: Icons.wb_sunny_outlined,
                              textInputAction: TextInputAction.done,
                              semanticLabel: 'Hora de fin del silencio',
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: AppSpacing.md),
                      AppButton(
                        label: 'Guardar horario',
                        icon: Icons.alarm_rounded,
                        variant: AppButtonVariant.secondary,
                        isFullWidth: true,
                        onPressed: value.isLoading ? null : _saveQuietHours,
                      ),
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  /// Valida el formato `HH:MM` antes de enviar: el backend responde `400
  /// INVALID_TIME_FORMAT` y un error de red por un typo de dos dígitos es
  /// innecesario.
  Future<void> _saveQuietHours() async {
    final NotificationPreferences? current =
        ref.read(notificationPrefsProvider).valueOrNull;
    if (current == null) return;

    final String from = _quietFrom.text.trim();
    final String to = _quietTo.text.trim();
    final bool bothEmpty = from.isEmpty && to.isEmpty;
    final bool bothFilled = _isHhMm(from) && _isHhMm(to);

    if (!bothEmpty && !bothFilled) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Escribe las dos horas en formato 24 h, por ejemplo 22:00.'),
        ),
      );
      return;
    }
    // El `toggle` del controlador es para canales; el horario se guarda con su
    // propio camino reusing la misma escritura del repositorio.
    final bool ok = await ref.read(notificationPrefsProvider.notifier).setQuietHours(
          bothEmpty ? null : from,
          bothEmpty ? null : to,
        );
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(ok
            ? 'Horario de silencio guardado.'
            : 'No pudimos guardar el horario. Inténtalo de nuevo.'),
      ),
    );
  }

  /// `HH:MM` en 24 h, con rango válido.
  static bool _isHhMm(String value) {
    final RegExp pattern = RegExp(r'^([01]?\d|2[0-3]):([0-5]\d)$');
    return pattern.hasMatch(value);
  }
}
