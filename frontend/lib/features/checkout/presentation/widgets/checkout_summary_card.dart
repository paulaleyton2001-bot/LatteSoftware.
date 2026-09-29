// Resumen del checkout: productos + alquiler + totales + aviso de pago.
//
// DE DÓNDE SALE CADA CIFRA
//   productos  → el carrito (previsualización del cliente)
//   alquiler   → `GET /reservations/quote` (el servidor, ya con impuestos)
//   TOTAL      → la suma de las dos, marcada como ESTIMADA
//
// El total DEFINITIVO es el que devuelve `POST /orders` y se muestra, sin
// transformar, en la pantalla de confirmación (BR-PRICE-008). Aquí la etiqueta
// "estimado" es obligatoria: sin ella, un total calculado en el cliente que luego
// no coincide es una reclamación.
//
// LOS IMPUESTOS Y EL CARGO NO SE CALCULAN AQUÍ
// Sus tasas están en `businesses` (`taxRateBp`, `serviceFeeBp`, `taxInclusive`) y
// el cliente no las conoce. Inventarlas daría un total que nunca coincide con el
// cobro. El alquiler sí trae impuestos del servidor, y por eso esa línea sí es
// real.


import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../checkout_state.dart';
import './checkout_totals.dart';
import './pay_at_store_banner.dart';

/// Resumen del pedido antes de confirmar.
class CheckoutSummaryCard extends StatelessWidget {
  const CheckoutSummaryCard({
    required this.cart,
    required this.state,
    this.discountMinor = 0,
    super.key,
  });

  final CartState cart;

  /// Estado del checkout (tipo, franja, cotización). Se tipa con la clase y no con
  /// `dynamic` para que el compilador verifique los nombres de los campos.
  final CheckoutState state;

  /// Descuento validado del cupón, en centavos. `0` si no hay cupón o no aplica.
  final int discountMinor;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Resumen', style: AppTextStyles.titleLarge),
          const SizedBox(height: AppSpacing.md),
          _TypeRow(type: state.type),
          if (state.startAt != null && state.endAt != null) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            _WindowRow(
              startAt: state.startAt!,
              endAt: state.endAt!,
              chairCode: state.chairId == null
                  ? null
                  : (state.quote?.chairCode ?? 'la elegida'),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          const Divider(height: 1),
          const SizedBox(height: AppSpacing.md),
          for (final CartLine line in cart.lines)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: _LineRow(line: line),
            ),
          if (cart.isEmpty)
            Text(
              'No hay productos en el pedido.',
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
          const SizedBox(height: AppSpacing.md),
          CheckoutTotals(
            productsMinor: cart.estimatedSubtotalMinor,
            discountMinor: discountMinor,
            rentalMinor: state.quote?.totalMinor ?? 0,
            isRental: state.isRental,
          ),
          const SizedBox(height: AppSpacing.md),
          const PayAtStoreBanner(),
        ],
      ),
    );
  }
}

/// Tipo de pedido con su etiqueta en texto.
class _TypeRow extends StatelessWidget {
  const _TypeRow({required this.type});

  final String type;

  @override
  Widget build(BuildContext context) {
    final String label = switch (type) {
      'TAKEAWAY' => 'Para llevar',
      'DINE_IN' => 'Consumir aquí',
      'CHAIR_RENTAL' => 'Alquiler de silla',
      _ => type,
    };
    return Row(
      children: <Widget>[
        const Icon(Icons.local_cafe_rounded, size: 18),
        const SizedBox(width: AppSpacing.sm),
        Text(label, style: AppTextStyles.titleSmall),
      ],
    );
  }
}

/// Franja horaria de la reserva.
class _WindowRow extends StatelessWidget {
  const _WindowRow({
    required this.startAt,
    required this.endAt,
    required this.chairCode,
  });

  final DateTime startAt;
  final DateTime endAt;
  final String? chairCode;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const Icon(Icons.schedule_rounded, size: 18),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Text(
            '${DateFormatter.dateTime(startAt)} – ${DateFormatter.time(endAt)}'
            '${chairCode == null ? '' : '\nSilla $chairCode'}',
            style: AppTextStyles.bodySmall,
          ),
        ),
      ],
    );
  }
}

/// Una línea de producto del carrito.
class _LineRow extends StatelessWidget {
  const _LineRow({required this.line});

  final CartLine line;

  @override
  Widget build(BuildContext context) {
    final String name = line.variantName.isEmpty
        ? line.productName
        : '${line.productName} · ${line.variantName}';
    return Semantics(
      label: '${line.quantity} × $name',
      excludeSemantics: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 28,
            child: Text(
              '${line.quantity}×',
              style: AppTextStyles.labelMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          Expanded(
            child: Text(
              name,
              style: AppTextStyles.bodyMedium,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            CurrencyFormatter.formatMinor(line.lineTotalMinor),
            style: AppTextStyles.price,
          ),
        ],
      ),
    );
  }
}
