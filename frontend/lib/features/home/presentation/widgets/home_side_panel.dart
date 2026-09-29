// Panel lateral y accesos de la pantalla de inicio, en escritorio.
// Módulo `features/home/presentation/widgets`.
//
// Va en su propio archivo porque son piezas que solo existen en `desktop`/`wide`:
// si vivieran en `home_blocks.dart`, el archivo de la home móvil arrastraría código
// que nunca se ve ahí.
//
// EL PANEL ES "QUÉ HACER DESPUÉS DE LEER LA HOME"
// El carrito, el precio de la silla y la llamada a reservar. Un pedido es
// claramente de dos pasos (elegir → pagar en el local), y la home es el sitio donde
// ese segundo paso tiene que quedar obvio: por eso el precio de la silla y el
// aviso de que reservar es OPCIONAL están en la tarjeta, no escondidos en el
// checkout.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../app/routes.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../orders/domain/entities/rental.dart';
import '../../domain/entities/business_status.dart';
import '../home_controller.dart';
import './home_content.dart';

/// Panel lateral de escritorio: qué pedir y el precio de la silla.
class HomeSidePanel extends ConsumerWidget {
  const HomeSidePanel({required this.active, super.key});

  final Rental? active;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final BusinessStatus? status = ref.watch(businessStatusProvider).valueOrNull ??
        ref.watch(cachedBusinessStatusProvider);

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: <Widget>[
        Text('Tu pedido', style: AppTextStyles.titleLarge),
        const SizedBox(height: AppSpacing.md),
        const HomeCartShortcut(),
        const SizedBox(height: AppSpacing.lg),
        if (status != null) ...<Widget>[
          Text('Alquiler de sillas', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.xs),
          if (status.chairDefaultPriceMinor > 0)
            PriceDisplay(
              currentMinor: status.chairDefaultPriceMinor,
              variant: PriceVariant.costPerUnit,
              unitLabel: 'hora',
              semanticLabel: 'Precio por hora de las sillas: '
                  '${CurrencyFormatter.formatMinor(status.chairDefaultPriceMinor)}',
            ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Hasta ${DateFormatter.durationLong(Duration(minutes: status.maxReservationMinutes))} '
            'por reserva.',
            style: AppTextStyles.captionMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
        ],
        AppButton(
          label: 'Reservar una silla',
          icon: Icons.event_seat_rounded,
          variant: AppButtonVariant.espresso,
          isFullWidth: true,
          onPressed: () => context.push(AppRoutes.checkout),
        ),
        const SizedBox(height: AppSpacing.sm),
        if (active == null)
          Text(
            'Reservar es opcional: puedes pedir para llevar o consumir en el '
            'mostrador sin silla.',
            style: AppTextStyles.captionMedium
                .copyWith(color: context.tokens.textSecondary),
          )
        else
          AppButton(
            label: 'Ver mi silla',
            variant: AppButtonVariant.secondary,
            isFullWidth: true,
            onPressed: () => context.go(AppRoutes.chairs),
          ),
      ],
    );
  }
}
