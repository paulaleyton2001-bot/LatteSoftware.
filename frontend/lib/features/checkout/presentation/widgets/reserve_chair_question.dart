// La pregunta que el cliente pidió hacer explícita: «¿Quieres reservar una
// silla?».
//
// POR QUÉ ES UNA TARJETA Y NO UN `Switch`
// Un switch con etiqueta sí/no obliga a deducir lapolaridad y a leer el estado
// para saber qué va a pasar. Aquí la decisión tiene DOS consecuencias distintas
// (se aparta una silla y se cobra por hora, o no se aparta nada), así que se
// pintan dos botones grandes con lo que pasa en cada caso.
//
// EN `CHAIR_RENTAL` NO SE MUESTRA
// Si el tipo ya es "reservar silla", preguntar "¿quieres reservar una silla?" es
// una redundancia. El backend además lo exige (`RENTAL_REQUIRES_CHAIR_AND_
// RESERVATION`), así que un "no" aquí produciría un error. La tarjeta se oculta y
// el flujo va directo al mapa.
//
// EL "NO" NO ES UN CALLEJÓN SIN SALIDA
// Con "no" en `DINE_IN` se continúa sin silla: `POST /orders` acepta `chairId`
// opcional en `DINE_IN` (API.md §7.12). Es lo que el cliente pidió: la pregunta
// informa, no bloquea.



import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../checkout_controller.dart';
import '../checkout_state.dart';

/// Pregunta «¿Quieres reservar una silla?» con sus dos respuestas.
class ReserveChairQuestion extends ConsumerWidget {
  const ReserveChairQuestion({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CheckoutState state = ref.watch(checkoutProvider);
    if (!state.mustAskAboutChair) return const SizedBox.shrink();
    if (state.type == 'CHAIR_RENTAL') return const SizedBox.shrink();

    final CheckoutController controller = ref.read(checkoutProvider.notifier);
    final bool? answer = state.reserveChair;

    return Semantics(
      container: true,
      header: true,
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(
              AppStrings.reserveChairQuestion,
              style: AppTextStyles.titleLarge,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Puedes continuar sin silla si prefieres',
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
            const SizedBox(height: AppSpacing.lg),
            _ChoiceRow(
              icon: Icons.event_seat_rounded,
              title: 'Sí, quiero una silla',
              description: 'La apartamos para ti y pagas el alquiler por hora al '
                  'finalizar.',
              selected: answer == true,
              onTap: () => controller.answerChairQuestion(reserve: true),
            ),
            const SizedBox(height: AppSpacing.sm),
            _ChoiceRow(
              icon: Icons.table_restaurant_rounded,
              title: 'No, sin silla',
              description: 'Registramos el pedido y eliges mesa al llegar, si hay '
                  'sitio libre.',
              selected: answer == false,
              onTap: () => controller.answerChairQuestion(reserve: false),
            ),
          ],
        ),
      ),
    );
  }
}

/// Una de las dos respuestas posibles.
class _ChoiceRow extends StatelessWidget {
  const _ChoiceRow({
    required this.icon,
    required this.title,
    required this.description,
    required this.selected,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String description;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: '$title. $description',
      excludeSemantics: true,
      child: AppCard(
        onTap: onTap,
        variant: selected ? AppCardVariant.elevated : AppCardVariant.outlined,
        padding: const EdgeInsets.all(AppSpacing.md),
        color: selected ? context.tokens.surfaceGreenSubtle : null,
        child: Row(
          children: <Widget>[
            Icon(
              icon,
              size: 24,
              color: selected
                  ? context.tokens.actionPrimary
                  : context.tokens.textSecondary,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(title, style: AppTextStyles.titleMedium),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    description,
                    style: AppTextStyles.captionMedium
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            if (selected)
              Icon(
                Icons.check_circle_rounded,
                size: 20,
                color: context.tokens.actionPrimary,
              ),
          ],
        ),
      ),
    );
  }
}
