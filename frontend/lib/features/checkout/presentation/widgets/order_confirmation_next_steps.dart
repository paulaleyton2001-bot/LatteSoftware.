// Después de confirmar: cómo se paga y qué hacer ahora.
//
// POR QUÉ ESTO NO ESTÁ EN LA TARJETA DE CONFIRMACIÓN
// La tarjeta de arriba responde "¿qué pedí y cuánto cuesta?". Esto responde "¿y
// ahora qué?": que NO hay pasarela de pagos, que el cobro es en el local, y qué
// pasos siguen según el tipo de pedido. Son dos preguntas distintas y mezclarlas
// obligaba a un archivo de 280 líneas para guardar dos ideas de 20.


import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../domain/entities/chair_quote.dart';

/// Aviso de pago en el local, destacado.
class OrderConfirmationPayNotice extends StatelessWidget {
  const OrderConfirmationPayNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      color: context.tokens.surfaceGreenSubtle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.storefront_rounded,
                size: 20,
                color: context.tokens.textSuccess,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  'Pagas en el local',
                  style: AppTextStyles.titleSmall
                      .copyWith(color: context.tokens.textSuccess),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            'Enséñale este número en la barra. Puedes pagar en efectivo o con '
            'tarjeta, sin añadir nada más en la app.',
            style: AppTextStyles.bodySmall
                .copyWith(color: context.tokens.textSuccess),
          ),
        ],
      ),
    );
  }
}

/// Qué hacer ahora, en pasos.
class OrderConfirmationNextSteps extends StatelessWidget {
  const OrderConfirmationNextSteps({required this.order, super.key});

  final PlacedOrder order;

  @override
  Widget build(BuildContext context) {
    final List<String> steps = <String>[
      if (order.type == 'TAKEAWAY')
        'Te avisamos en la app cuando tu pedido esté listo.'
      else
        'Te esperamos en el local.',
      'Pagas al llegar, en efectivo o con tarjeta.',
      if (order.type == 'CHAIR_RENTAL')
        'Si te quedas más tiempo, puedes extender la silla desde el pedido.',
    ];

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('¿Y ahora?', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          for (final String step in steps)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(
                    Icons.check_rounded,
                    size: 16,
                    color: context.tokens.textSuccess,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(child: Text(step, style: AppTextStyles.bodySmall)),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
