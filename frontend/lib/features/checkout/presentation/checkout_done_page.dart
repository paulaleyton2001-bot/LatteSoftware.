// Pantalla de confirmación del checkout.
//
// POR QUÉ ES UNA RUTA PROPIA
// Se llega con un `pushReplacement` desde el checkout y, si alguien recarga la
// página o vuelve atrás, la pantalla tiene que ser capaz de explicar que no hay
// ningún pedido confirmado en vez de quedarse en blanco. De ahí el `EmptyState`
// con salida al menú.
//
// QUÉ MUESTRA Y EN QUÉ ORDEN
//   1. Confirmación visual + el tipo de pedido.
//   2. Número de pedido (copiable) y estado.
//   3. Importes DEL SERVIDOR, sin transformar (BR-PRICE-008).
//   4. Aviso de pago en el local.
//   5. Qué hacer ahora.
//   6. Salidas: «Ver mis pedidos» (principal) y «Seguir mirando el menú».


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/breakpoints.dart';
import '../../../app/routes.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/empty_state.dart';
import '../domain/entities/chair_quote.dart';
import './checkout_controller.dart';
import './widgets/order_confirmation_cards.dart';
import './widgets/order_confirmation_next_steps.dart';

/// Confirmación del pedido registrado.
class CheckoutDonePage extends ConsumerWidget {
  const CheckoutDonePage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final PlacedOrder? order = ref.watch(checkoutProvider).placedOrder;

    if (order == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Pedido registrado')),
        body: SafeArea(
          child: EmptyState(
            icon: Icons.receipt_long_outlined,
            title: 'No hay ningún pedido confirmado',
            message: 'Vuelve al menú para registrar uno nuevo.',
            actionLabel: 'Ver el menú',
            onAction: () => context.go(AppRoutes.menu),
          ),
        ),
      );
    }

    final double padding = context.breakpoint.screenPadding;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: EdgeInsets.fromLTRB(
            padding,
            AppSpacing.xl,
            padding,
            AppSpacing.xxl,
          ),
          children: <Widget>[
            _SuccessHeader(order: order),
            const SizedBox(height: AppSpacing.xl),
            OrderConfirmationCard(order: order),
            const SizedBox(height: AppSpacing.lg),
            OrderConfirmationTotals(order: order),
            const SizedBox(height: AppSpacing.lg),
            const OrderConfirmationPayNotice(),
            const SizedBox(height: AppSpacing.lg),
            OrderConfirmationNextSteps(order: order),
            const SizedBox(height: AppSpacing.xl),
            AppButton(
              label: 'Ver mis pedidos',
              icon: Icons.receipt_long_rounded,
              size: AppButtonSize.large,
              isFullWidth: true,
              variant: AppButtonVariant.espresso,
              onPressed: () => context.go(AppRoutes.orders),
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton(
              label: 'Seguir mirando el menú',
              variant: AppButtonVariant.ghost,
              size: AppButtonSize.medium,
              isFullWidth: true,
              onPressed: () => context.go(AppRoutes.menu),
            ),
          ],
        ),
      ),
    );
  }
}

/// Cabecera de éxito: check + título + qué hacer con el pedido.
class _SuccessHeader extends StatelessWidget {
  const _SuccessHeader({required this.order});

  final PlacedOrder order;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Semantics(
        header: true,
        label: 'Pedido registrado con éxito',
        child: Column(
          children: <Widget>[
            Container(
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: context.tokens.surfaceSuccessSubtle,
                shape: BoxShape.circle,
              ),
              child: Icon(
                Icons.check_circle_rounded,
                size: 40,
                color: context.tokens.textSuccess,
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(
              AppStrings.orderConfirmedTitle,
              style: AppTextStyles.headlineMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              _orderTypeLabel(order.type),
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  static String _orderTypeLabel(String type) => switch (type) {
        'TAKEAWAY' => 'Para llevar. Te avisamos cuando esté listo.',
        'DINE_IN' => 'Te esperamos en el local.',
        'CHAIR_RENTAL' => 'Tu silla te espera en el local.',
        _ => 'Tu pedido está registrado.',
      };
}
