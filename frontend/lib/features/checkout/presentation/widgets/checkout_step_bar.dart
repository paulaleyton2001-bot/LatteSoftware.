// Indicador de pasos del checkout. Módulo `features/checkout/presentation/widgets`.
//
// POR QUÉ UN INDICADOR Y NO UNA BARRA FIJA
// Con los cuatro bloques en una sola página larga hay que hacer scroll para
// encontrar el botón de confirmar y no hay forma de volver atrás sin perder lo
// elegido. Un indicador de pasos hace las dos cosas: muestra dónde se está y
// permite saltar a cualquier paso YA COMPLETADO.
//
// UN PASO SOLO ES ALCANZABLE SI TIENE SENTIDO
//   - "Silla" solo si se respondió la pregunta de la silla.
//   - "Duración" solo si hay silla (si no hay silla no hay nada que duracion).
//   - "Resumen" solo si se puede revisar (`CheckoutState.canReview`).
// Un paso bloqueado se ve DESACTIVADO (opacidad 0.5) y no hace nada, en vez de
// dejar que se pulse y no pase nada.



import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../checkout_controller.dart';
import '../checkout_state.dart';

/// Fila de pasos, pulsable.
class CheckoutStepBar extends ConsumerWidget {
  const CheckoutStepBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CheckoutState state = ref.watch(checkoutProvider);
    final CheckoutController controller = ref.read(checkoutProvider.notifier);

    return Semantics(
      container: true,
      label: 'Paso ${CheckoutStep.values.indexOf(state.step) + 1} de 4: '
          '${state.stepLabel}',
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.lg,
          vertical: AppSpacing.sm,
        ),
        child: Row(
          children: <Widget>[
            for (final CheckoutStep step in CheckoutStep.values) ...<Widget>[
              _StepChip(
                step: step,
                current: state.step,
                enabled: _isEnabled(step, state),
                onTap: () => controller.goToStep(step),
              ),
              if (step != CheckoutStep.values.last)
                Padding(
                  padding: EdgeInsets.symmetric(horizontal: AppSpacing.xs),
                  child: Icon(
                    Icons.chevron_right_rounded,
                    size: 18,
                    color: context.tokens.textTertiary,
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  /// Un paso es alcanzable si ya se passou por él o si es el actual.
  static bool _isEnabled(CheckoutStep step, CheckoutState state) {
    switch (step) {
      case CheckoutStep.orderType:
        return true;
      case CheckoutStep.chair:
        return state.chairQuestionAnswered;
      case CheckoutStep.duration:
        return state.needsChair;
      case CheckoutStep.review:
        return state.canReview;
    }
  }
}

/// Chip de un paso.
class _StepChip extends StatelessWidget {
  const _StepChip({
    required this.step,
    required this.current,
    required this.enabled,
    required this.onTap,
  });

  final CheckoutStep step;
  final CheckoutStep current;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bool active = step == current;
    final Color foreground =
        active ? context.tokens.textSuccess : context.tokens.textSecondary;

    return Semantics(
      button: true,
      selected: active,
      enabled: enabled,
      label: _label(step),
      excludeSemantics: true,
      child: Opacity(
        opacity: enabled ? 1 : 0.5,
        child: Material(
          color: active
              ? context.tokens.surfaceGreenSubtle
              : Theme.of(context).colorScheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(999),
          child: InkWell(
            onTap: enabled ? onTap : null,
            borderRadius: BorderRadius.circular(999),
            child: Container(
              constraints: const BoxConstraints(minHeight: 44),
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.md,
                vertical: AppSpacing.sm,
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(999),
                border: Border.all(
                  color: active
                      ? context.tokens.actionPrimary
                      : context.tokens.borderSubtle,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (active) ...<Widget>[
                    Icon(
                      Icons.check_rounded,
                      size: 14,
                      color: context.tokens.actionPrimary,
                    ),
                    const SizedBox(width: AppSpacing.xs),
                  ],
                  Text(
                    _label(step),
                    style: AppTextStyles.labelLarge.copyWith(color: foreground),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  static String _label(CheckoutStep step) => switch (step) {
        CheckoutStep.orderType => 'Tipo',
        CheckoutStep.chair => 'Silla',
        CheckoutStep.duration => 'Duración',
        CheckoutStep.review => 'Resumen',
      };
}
