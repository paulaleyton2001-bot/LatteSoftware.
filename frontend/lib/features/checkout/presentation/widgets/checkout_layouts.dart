// Layouts del checkout: una columna en móvil/tablet, dos en desktop/wide.
//
// POR QUÉ DOS ARCHIVOS Y NO UN `if` EN EL BUILD
// El árbol de cada layout es largo (pasos + resumen) y metido en `build` se
// perdía de vista qué cambia entre móvil y escritorio. Separados, cada uno se lee
// entero y el `build` de la pantalla se reduce a "elijo layout".
//
// EL RESUMEN SOLO APARECE AL REVISAR
// En los dos layouts la tarjeta de totales se pinta únicamente en
// `CheckoutStep.review`: antes de eso el cliente todavía está eligiendo y los
// importes le distraerían.


import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/responsive/breakpoints.dart';
import '../../../../core/customer/cart_state.dart';
import '../checkout_state.dart';
import './checkout_blocks.dart';
import './checkout_quote_block.dart';
import './checkout_summary_card.dart';
import './order_type_selector.dart';
import './reserve_chair_question.dart';

/// Layout de una columna (móvil y tablet).
class CheckoutNarrowLayout extends StatelessWidget {
  const CheckoutNarrowLayout({
    required this.cart,
    required this.state,
    required this.discountMinor,
  });

  final CartState cart;
  final CheckoutState state;

  /// Descuento ya validado por el servidor (`POST /discounts/validate`).
  final int discountMinor;

  @override
  Widget build(BuildContext context) {
    final double padding = context.breakpoint.screenPadding;
    return ListView(
      padding: EdgeInsets.fromLTRB(
        padding,
        AppSpacing.lg,
        padding,
        AppSpacing.xxl,
      ),
      children: <Widget>[
        const OrderTypeSelector(),
        const SizedBox(height: AppSpacing.lg),
        const ReserveChairQuestion(),
        if (state.needsChair) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          const CheckoutChairPicker(),
          const SizedBox(height: AppSpacing.lg),
          const CheckoutDurationBlock(),
        ],
        if (state.step == CheckoutStep.review) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          CheckoutSummaryCard(
            cart: cart,
            state: state,
            discountMinor: discountMinor,
          ),
        ],
      ],
    );
  }
}

/// Layout de dos columnas (desktop y wide): pasos | resumen fijo.
class CheckoutWideLayout extends StatelessWidget {
  const CheckoutWideLayout({
    required this.cart,
    required this.state,
    required this.discountMinor,
  });

  final CartState cart;
  final CheckoutState state;

  /// Descuento ya validado por el servidor (`POST /discounts/validate`).
  final int discountMinor;

  @override
  Widget build(BuildContext context) {
    final double padding = context.breakpoint.screenPadding;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Expanded(
          flex: 3,
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              padding,
              AppSpacing.lg,
              padding,
              AppSpacing.xxl,
            ),
            children: <Widget>[
              const OrderTypeSelector(),
              const SizedBox(height: AppSpacing.lg),
              const ReserveChairQuestion(),
              if (state.needsChair) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                const CheckoutChairPicker(),
                const SizedBox(height: AppSpacing.lg),
                const CheckoutDurationBlock(),
              ],
            ],
          ),
        ),
        VerticalDivider(
          width: 1,
          color: Theme.of(context).colorScheme.outlineVariant,
        ),
        SizedBox(
          width: 380,
          child: ListView(
            padding: EdgeInsets.fromLTRB(
              padding,
              AppSpacing.lg,
              padding,
              AppSpacing.xxl,
            ),
            children: <Widget>[
              CheckoutSummaryCard(
                cart: cart,
                state: state,
                discountMinor: discountMinor,
              ),
              const SizedBox(height: AppSpacing.md),
              CheckoutQuoteBlock(state: state),
            ],
          ),
        ),
      ],
    );
  }
}
