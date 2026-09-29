// Selector de DURACIÓN de la silla.
//
// OPCIONES FIJAS + PERSONALIZADO
// 30 min / 1 h / 2 h / 3 h / 4 h / otro. Las fijas cubren el 90 % de los casos
// (una o dos horas de trabajo con café) y el personalizado cubre el resto sin
// obligar a un desplegable con 1440 valores.
//
// CADA OPCIÓN MUESTRA SU PRECIO ESTIMADO EN CLIENTE
// Es una estimación por `precio/hora × horas`, y se rotula como estimada. El
// precio real lo da `GET /reservations/quote` y, al confirmar, `POST /orders`
// (BR-PRICE-008): si el negocio cobra un mínimo de 30 min o aplica tramos, la
// estimación puede no coincidir, y por eso el rótulo lo dice.
//
// ACCESIBILIDAD
// - `Semantics(button:, selected:)` y marca de check + texto, no solo color.
// - El campo "otro tiempo" tiene label visible, unidad explícita ("min") y un
//   `helperText` con el rango permitido, para que nadie adivine por qué su valor
//   se recortó.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../domain/entities/checkout_options.dart';
import '../checkout_controller.dart';
import '../checkout_state.dart';
import './custom_duration_field.dart';

/// Fila de duraciones.
class DurationSelector extends ConsumerWidget {
  const DurationSelector({required this.pricePerHourMinor, super.key});

  /// Precio por hora de la silla elegida, para la estimación. `0` = aún no hay
  /// cotización, y entonces no se enseña ninguna cifra.
  final int pricePerHourMinor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CheckoutState state = ref.watch(checkoutProvider);
    final CheckoutController controller = ref.read(checkoutProvider.notifier);

    return Semantics(
      container: true,
      header: true,
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text('¿Cuánto tiempo?', style: AppTextStyles.titleLarge),
            const SizedBox(height: AppSpacing.xs),
            Text(
              state.isRental
                  ? 'Alquilas la silla por ese tiempo. Si te quedas más, '
                      'puedes extenderla desde el pedido.'
                  : 'Reservamos la silla para ese rato.',
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
            const SizedBox(height: AppSpacing.lg),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: <Widget>[
                for (final DurationOption option in kDurationOptions)
                  _DurationChip(
                    option: option,
                    selected: _isSelected(state, option),
                    priceMinor: _estimate(option, state, pricePerHourMinor),
                    onTap: () => controller.selectDuration(option),
                  ),
              ],
            ),
            if (state.isCustomDuration) const CustomDurationField(),
            if (pricePerHourMinor > 0) ...<Widget>[
              const SizedBox(height: AppSpacing.md),
              Row(
                children: <Widget>[
                  Icon(
                    Icons.info_outline_rounded,
                    size: 16,
                    color: context.tokens.textSecondary,
                  ),
                  const SizedBox(width: AppSpacing.xs),
                  Expanded(
                    child: Text(
                      'Estimación sin impuestos. El importe exacto se calcula '
                      'con la cotización del local antes de confirmar.',
                      style: AppTextStyles.captionSmall
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  /// La opción está activa si es la fija elegida o la personalizada con la misma
  /// referencia.
  static bool _isSelected(CheckoutState state, DurationOption option) {
    if (option.custom) return state.isCustomDuration;
    return !state.isCustomDuration && state.durationMinutes == option.minutes;
  }

  /// `precio/hora × minutos` redondeados a la hora, con `int` (nada de `double`
  /// para dinero). `0` = sin precio conocido todavía.
  static int _estimate(
    DurationOption option,
    CheckoutState state,
    int pricePerHourMinor,
  ) {
    if (pricePerHourMinor <= 0) return 0;
    final int minutes = option.custom ? state.customMinutes : (option.minutes ?? 0);
    if (minutes <= 0) return 0;
    // Aproximación por exceso: mejor que el cliente vea un número alto y lo
    // surprise la factura, que al revés.
    final int hours = (minutes / 60).ceil();
    return pricePerHourMinor * hours;
  }
}

/// Chip de una duración.
class _DurationChip extends StatelessWidget {
  const _DurationChip({
    required this.option,
    required this.selected,
    required this.priceMinor,
    required this.onTap,
  });

  final DurationOption option;
  final bool selected;
  final int priceMinor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color accent =
        selected ? context.tokens.actionPrimary : context.tokens.textSecondary;

    return Semantics(
      button: true,
      selected: selected,
      label: priceMinor > 0
          ? '${option.label}, estimado ${CurrencyFormatter.formatMinor(priceMinor)}'
          : option.label,
      excludeSemantics: true,
      child: Material(
        color: selected
            ? Theme.of(context).colorScheme.primaryContainer
            : Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48, minWidth: 72),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.sm,
            ),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: selected
                    ? Theme.of(context).colorScheme.primary
                    : context.tokens.borderDefault,
                width: selected ? 2 : 1,
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (selected) ...<Widget>[
                      Icon(Icons.check_rounded, size: 16, color: accent),
                      const SizedBox(width: AppSpacing.xs),
                    ],
                    Text(option.label, style: AppTextStyles.labelLarge),
                  ],
                ),
                if (priceMinor > 0)
                  Text(
                    '~${CurrencyFormatter.formatNumberMinor(priceMinor)}',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textSecondary),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
