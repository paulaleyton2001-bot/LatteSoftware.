// Fila de un canal de notificación (icono + texto + switch).
// Módulo `features/profile/presentation/widgets`.
//
// `inApp` SE PINTA FIJO Y DESHABILITADO
// El backend responde `422 IN_APP_REQUIRED`: es el canal persistente del historial
// de avisos. Un switch que se puede apagar y luego devuelve un error del servidor
// es una trampa; aquí el canal de la app se ve apagable pero lleva la razón escrita
// al lado ("siempre activo: es donde queda el historial"), que es la diferencia
// entre una restricción entendida y una que parece un fallo.
//
// ACCESIBILIDAD
// `Semantics(toggled:, label:, value:)` con `excludeSemantics: true`: el lector
// anuncia "Correo electrónico, activado", no "notificaciones, interruptor".



import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';

/// Fila de un canal de notificación.
class NotificationChannelSwitch extends StatelessWidget {
  const NotificationChannelSwitch({
    required this.icon,
    required this.title,
    required this.description,
    required this.value,
    this.onChanged,
    this.enabled = true,
    super.key,
  });

  final IconData icon;
  final String title;
  final String description;
  final bool value;
  final ValueChanged<bool>? onChanged;

  /// `false` para un canal que la API no permite cambiar.
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final bool active = enabled && onChanged != null;
    return Semantics(
      toggled: value,
      label: title,
      value: value ? 'Activado' : 'Desactivado',
      excludeSemantics: true,
      child: Row(
        children: <Widget>[
          Icon(
            icon,
            size: 20,
            color: value ? context.tokens.actionPrimary : context.tokens.textTertiary,
          ),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(title, style: AppTextStyles.bodyLarge),
                Text(
                  description,
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          // Un switch deshabilitado sin explicación confunde: la razón está en el
          // subtítulo de la fila.
          Switch(value: value, onChanged: active ? onChanged : null),
        ],
      ),
    );
  }
}
