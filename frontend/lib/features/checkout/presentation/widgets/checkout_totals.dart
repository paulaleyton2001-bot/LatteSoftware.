// Totales del checkout: productos, cupón, alquiler y total ESTIMADO.
//
// ESTE ARCHIVO NO CALCULA PRECIOS, LOS ORDENA
// Las cifras llegan ya calculadas: los productos del carrito (previsualización
// del cliente), el descuento que validó `POST /discounts/validate` y el alquiler
// que devolvió `GET /reservations/quote` con impuestos incluidos. Aquí solo se
// suman en `int` (nada de `double` para dinero, docs/DESIGN-TOKENS §9.1) y se
// les pone etiqueta.
//
// POR QUÉ LA ETIQUETA "ESTIMADO" ES OBLIGATORIA
// El total DEFINITIVO es el que devuelve `POST /orders` y se muestra sin
// transformar en la confirmación (BR-PRICE-008). Un total calculado en el cliente
// que luego no coincide es una reclamación: por eso la fila se llama "Total
// estimado" y dice de quién es la última palabra.


import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/price_display.dart';

/// Totales: productos, cupón, alquiler y total estimado.
class CheckoutTotals extends StatelessWidget {
  const CheckoutTotals({
    required this.productsMinor,
    required this.discountMinor,
    required this.rentalMinor,
    required this.isRental,
  });

  /// Suma de las líneas del carrito, en centavos.
  final int productsMinor;

  /// Descuento validado por el servidor, en centavos (`0` si no hay cupón).
  final int discountMinor;

  /// Alquiler o reserva de silla con impuestos, en centavos.
  final int rentalMinor;

  /// `true` si el pedido es un alquiler en vez de una reserva.
  final bool isRental;

  @override
  Widget build(BuildContext context) {
    final int estimate = productsMinor - discountMinor + rentalMinor;

    return Column(
      children: <Widget>[
        CheckoutTotalRow(
          label: 'Productos',
          value: CurrencyFormatter.formatMinor(productsMinor),
        ),
        if (discountMinor > 0)
          CheckoutTotalRow(
            label: 'Cupón',
            value: '−${CurrencyFormatter.formatMinor(discountMinor)}',
            color: context.tokens.textSuccess,
          ),
        if (rentalMinor > 0)
          CheckoutTotalRow(
            label: isRental ? 'Alquiler de silla' : 'Silla reservada',
            value: CurrencyFormatter.formatMinor(rentalMinor),
          ),
        const SizedBox(height: AppSpacing.sm),
        Divider(color: context.tokens.borderSubtle, height: 1),
        const SizedBox(height: AppSpacing.sm),
        Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Total estimado', style: AppTextStyles.titleMedium),
                  const SizedBox(height: AppSpacing.xxs),
                  Text(
                    'El importe final lo calcula el local al confirmar.',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                ],
              ),
            ),
            PriceDisplay(
              currentMinor: estimate,
              variant: PriceVariant.large,
              semanticLabel: 'Total estimado: '
                  '${CurrencyFormatter.formatMinor(estimate, withDecimals: true)}',
            ),
          ],
        ),
      ],
    );
  }
}

/// Fila etiqueta/valor del resumen.
class CheckoutTotalRow extends StatelessWidget {
  const CheckoutTotalRow({required this.label, required this.value, this.color});

  final String label;
  final String value;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              label,
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          Text(
            value,
            style: AppTextStyles.price
                .copyWith(color: color ?? context.tokens.textPrimary),
          ),
        ],
      ),
    );
  }
}
