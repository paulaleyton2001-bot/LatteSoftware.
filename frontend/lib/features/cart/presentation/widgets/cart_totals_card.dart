// Resumen de importes del carrito.
//
// QUÉ SE MUESTRA Y QUÉ NO
// El subtotal SÍ se calcula en cliente (es una suma de precios que el usuario ya
// ve). El descuento, los impuestos y el cargo por servicio NO: sus tasas están
// en `businesses` (`taxRateBp`, `serviceFeeBp`, `taxInclusive`) y el cliente no
// las conoce, así que inventarlas daría un total que nunca coincide con el
// cobro. Se muestra una línea explícita de "impuestos y cargos" con el texto
// "los calcula el local" y el TOTAL se deja para el resumen del checkout, con las
// cifras que devuelve `POST /orders` (BR-PRICE-008).
//
// El aviso de pago en el local es requisito de producto: no hay pasarela.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';

/// Resumen de importes del carrito.
class CartTotalsCard extends StatelessWidget {
  const CartTotalsCard({
    required this.state,
    this.discountMinor = 0,
    this.couponLabel,
    super.key,
  });

  final CartState state;

  /// Descuento YA VALIDADO por `POST /discounts/validate`, en centavos. `0` si
  /// no hay cupón o el cupón no aplica.
  final int discountMinor;

  /// Texto del cupón aplicado, para la línea de descuento.
  final String? couponLabel;

  @override
  Widget build(BuildContext context) {
    final int subtotal = state.estimatedSubtotalMinor;
    final int afterDiscount = (subtotal - discountMinor).clamp(0, subtotal);
    final int items = state.totalQuantity;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          _Row(
            label: 'Subtotal ($items ${items == 1 ? 'artículo' : 'artículos'})',
            value: CurrencyFormatter.formatMinor(subtotal),
          ),
          if (discountMinor > 0)
            _Row(
              label: 'Descuento ${couponLabel ?? ''}'.trim(),
              value: '−${CurrencyFormatter.formatMinor(discountMinor)}',
              valueColor: context.tokens.textSuccess,
            ),
          const SizedBox(height: AppSpacing.sm),
          _Row(
            label: 'Impuestos y cargos',
            value: 'Se calculan en el local',
            muted: true,
          ),
          const SizedBox(height: AppSpacing.md),
          Divider(color: context.tokens.borderSubtle, height: 1),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Expanded(
                child: Text(
                  'Total estimado',
                  style: AppTextStyles.titleMedium
                      .copyWith(color: context.tokens.textPrimary),
                ),
              ),
              // `PriceDisplay.large` con los 2 decimales de comprobante: es la
              // cifra que el cliente va a ver en la caja.
              PriceDisplay(
                currentMinor: afterDiscount,
                variant: PriceVariant.large,
                semanticLabel:
                    'Total estimado, sin impuestos: ${CurrencyFormatter.formatMinor(afterDiscount, withDecimals: true)}',
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          const _PayAtStoreNotice(),
        ],
      ),
    );
  }
}

/// Fila etiqueta/valor del resumen.
class _Row extends StatelessWidget {
  const _Row({
    required this.label,
    required this.value,
    this.valueColor,
    this.muted = false,
  });

  final String label;
  final String value;
  final Color? valueColor;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final Color color = valueColor ??
        (muted ? context.tokens.textSecondary : context.tokens.textPrimary);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Text(
              label,
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          // EL VALOR SE PUEDE ENCOGER, Y ESTO NO ES UN DETALLE
          //
          // Aquí el valor es un `Text` rígido, con su ancho INTRÍNSICO. Casi
          // siempre es un importe («$11.000») y cabe de sobra, pero la fila
          // «Impuestos y cargos» lleva un valor de PROSA —«Se calculan en el
          // local»— y en un móvil estrecho (393 dp) la suma de etiqueta, hueco e
          // importe se pasaba 3.8 px: `A RenderFlex overflowed by 3.8 pixels on
          // the right`, con su franja amarilla y negra encima del resumen.
          //
          // Es un fallo que solo aparece por debajo de ~400 dp de ancho, así que
          // no se ve en el portátil ni en el móvil grande, y por eso es
          // precisamente el que aparece en el Xiaomi.
          //
          // Con `Flexible` el valor toma lo que le dejan y, si aun así no cabe,
          // envuelve en vez de desbordar. `Flexible` y no `Expanded` a propósito:
          // `Expanded` forzaría a la etiqueta a ceder la mitad del ancho y
          // partiría «Impuestos y cargos» en dos líneas innecesariamente.
          Flexible(
            child: Text(
              value,
              style: AppTextStyles.price
                  .copyWith(color: color, fontSize: muted ? 13 : null),
              textAlign: TextAlign.right,
            ),
          ),
        ],
      ),
    );
  }
}

/// Aviso de que el pago se hace en el local. `liveRegion` porque aparece en el
/// momento de pasar al carrito y es la información que evita el susto de buscar
/// una pasarela que no existe.
class _PayAtStoreNotice extends StatelessWidget {
  const _PayAtStoreNotice();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.tokens.surfaceGreenSubtle,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              Icons.storefront_rounded,
              size: 20,
              color: context.tokens.textSuccess,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                AppStrings.payAtStore,
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textSuccess),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
