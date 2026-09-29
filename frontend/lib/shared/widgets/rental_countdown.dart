// Temporizador de silla, en vivo.
//
// POR QUÉ UN `Stream` DE UN SEGUNDO Y NO UN `Timer` EN EL WIDGET
// El tiempo restante del alquiler es estado de NEGOCIO: lo usan la home, el
// detalle del pedido y la tarjeta del mapa. Si el `Timer.periodic` viviera en un
// `StatefulWidget`, habría que duplicarlo en cada pantalla y, peor, seguiría
// corriendo mientras la pantalla no está visible (un temporizador de 1 Hz por
// pestaña abierta es desgaste de batería sin información para el usuario).
//
// `StreamProvider` resuelve las dos cosas: una sola fuente de reloj para toda la
// app, y `autoDispose` (el `StreamProvider` de Riverpod es `autoDispose` por
// defecto) cancela el `Timer` en cuanto no queda ningún oyente.
//
// ACCESIBILIDAD
// - `Semantics(liveRegion: true)`: el cambio de segundo NO se anuncia (sería
//   inaudible); lo que se anuncia es el minuto cerrado y el estado (normal /
//   quedan menos de 5 min / se pasó el tiempo), que es lo accionable.
// - `AppTextStyles.timerLarge` / `timerMedium` llevan
//   `FontFeature.tabularFigures()`: sin eso los dígitos "bailan" en cada tick y el
//   número parece más ancho cada vez que cambia (docs/DESIGN-TOKENS §2.3).
// - `prefers-reduced-motion` no afecta aquí: no hay animación, solo texto.



import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../app/theme/app_spacing.dart';
import '../../app/theme/app_tokens.dart';
import '../../app/theme/app_typography.dart';
import '../../core/utils/date_formatter.dart';

/// Reloj de un segundo, compartido por todas las pantallas.
///
/// Se emite un valor INMEDIATAMENTE y luego uno por segundo, para que el primer
/// frame no espere un segundo entero mostrando "sin datos".
final StreamProvider<DateTime> clockProvider = StreamProvider<DateTime>(
  (Ref ref) async* {
    yield DateTime.now();
    yield* Stream<DateTime>.periodic(
      const Duration(seconds: 1),
      (int _) => DateTime.now(),
    );
  },
  name: 'clock',
);

/// Temporizador de silla.
///
/// [endAt] es el final de la ventana reservada. Cuando se pasa, el alquiler sigue
/// cobrándose a precio congelado (BR-RENTAL-003/004), así que el temporizador pasa
/// a mostrar el excedente en positivo, en vez de un negativo que parece un error.
class RentalCountdown extends ConsumerWidget {
  const RentalCountdown({
    required this.endAt,
    this.large = false,
    this.showIcon = true,
    super.key,
  });

  final DateTime endAt;

  /// `true` = cifra grande (detalle de pedido), `false` = compacta (cards).
  final bool large;

  final bool showIcon;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DateTime now = ref.watch(clockProvider).valueOrNull ?? DateTime.now();
    final Duration remaining = endAt.difference(now.toUtc());
    final bool overtime = remaining.isNegative;
    final Duration shown = remaining.abs();

    final Color color = overtime
        ? context.tokens.textError
        : (shown.inMinutes <= 5 ? context.tokens.textWarning : context.tokens.textPrimary);

    final TextStyle style = (large
            ? AppTextStyles.timerLarge
            : AppTextStyles.timerMedium)
        .copyWith(color: color);

    return Semantics(
      liveRegion: true,
      label: _spokenLabel(overtime, shown),
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (showIcon) ...<Widget>[
            Icon(
              overtime ? Icons.running_with_errors_rounded : Icons.timer_rounded,
              size: large ? 24 : 16,
              color: color,
            ),
            SizedBox(width: large ? AppSpacing.sm : AppSpacing.xs),
          ],
          Text(DateFormatter.countdown(shown), style: style),
        ],
      ),
    );
  }

  /// Lo que se anuncia: el minuto cerrado, no el segundo. Anunciar cada segundo
  /// sería inaudible; anunciar el umbral que importa ("quedan 5 minutos") es lo
  /// que permite reaccionar.
  static String _spokenLabel(bool overtime, Duration shown) {
    if (overtime) {
      return 'El tiempo terminó. Llevas ${shown.inMinutes} minutos extra.';
    }
    if (shown.inMinutes <= 5) {
      return 'Quedan ${shown.inMinutes} minutos de silla.';
    }
    return 'Silla reservada, quedan ${shown.inMinutes} minutos.';
  }
}

/// Variante compacta dentro de una card: etiqueta + cifra.
class RentalCountdownTile extends ConsumerWidget {
  const RentalCountdownTile({required this.endAt, required this.label, super.key});

  final DateTime endAt;
  final String label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text(
          label,
          style: AppTextStyles.labelMedium
              .copyWith(color: context.tokens.textSecondary),
        ),
        const SizedBox(height: AppSpacing.xs),
        RentalCountdown(endAt: endAt),
      ],
    );
  }
}
