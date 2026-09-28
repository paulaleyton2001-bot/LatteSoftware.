// Presentación de precios.
//
// ÚNICO widget autorizado a pintar dinero. Recibe SIEMPRE centavos (el
// `int` que manda la API en `*Minor`) y delega el texto en
// `core/utils/currency_formatter.dart`. Nadie escribe `price / 100` a mano.
//
// Variantes:
//   - [PriceVariant.normal]      — precio vigente (`$5.000`).
//   - [PriceVariant.large]       — detalle de producto y total del checkout.
//   - [PriceVariant.promo]       — precio original tachado + precio promo con
//                                  badge de ahorro. `originalMinor` es el valor
//                                  tachado; `currentMinor` el vigente.
//   - `PriceVariant.costPerUnit` — "por hora" de las sillas (`$8.000 / hora`).
//
// BR-PRICE-008: el precio mostrado aquí es una previsualización; el total
// definitivo siempre lo devuelve el servidor tras `POST /orders`.

import 'package:flutter/material.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/utils/currency_formatter.dart';

/// Forma de presentar el precio.
enum PriceVariant {
  /// Precio vigente, tamaño de card.
  normal,

  /// Precio destacado (detalle de producto, resumen del checkout).
  large,

  /// Precio original tachado + precio vigente con badge de ahorro.
  promo,

  /// Precio por unidad de tiempo de las sillas.
  costPerUnit,
}

/// Widget de precio. Inmutable, sin estado.
class PriceDisplay extends StatelessWidget {
  const PriceDisplay({
    required this.currentMinor,
    this.originalMinor,
    this.variant = PriceVariant.normal,
    this.unitLabel,
    this.semanticLabel,
    super.key,
  }) : assert(
          originalMinor == null || originalMinor >= currentMinor,
          'originalMinor debe ser >= currentMinor: es el precio antes del promo.',
        );

  /// Valor en centavos (API `*Minor`).
  final int currentMinor;

  /// Precio original en centavos. `null` = sin promoción.
  final int? originalMinor;

  final PriceVariant variant;

  /// Sufijo de unidad ("hora", "kg"). Solo con `PriceVariant.costPerUnit`.
  final String? unitLabel;

  /// Lectura completa para lectores de pantalla.
  final String? semanticLabel;

  /// Texto del precio vigente.
  String get _current =>
      CurrencyFormatter.formatMinor(currentMinor, withDecimals: variant == PriceVariant.large);

  @override
  Widget build(BuildContext context) => switch (variant) {
        PriceVariant.normal || PriceVariant.costPerUnit =>
          _single(AppTextStyles.price),
        PriceVariant.large => _single(AppTextStyles.priceLarge),
        PriceVariant.promo => _promo(),
      };

  /// Precio único con sufijo de unidad opcional.
  Widget _single(TextStyle style) {
    final textStyle = style.copyWith(color: AppColors.textPrimary);
    return Semantics(
      label: semanticLabel ?? 'Precio: $_current${unitLabel != null ? ' por $unitLabel' : ''}',
      excludeSemantics: true,
      child: unitLabel == null
          ? Text(_current, style: textStyle)
          : Text(
              '$_current / $unitLabel',
              style: textStyle.copyWith(color: AppColors.textSecondary),
            ),
    );
  }

  /// Precio tachado + precio vigente + badge de ahorro.
  Widget _promo(BuildContext context) {
    final int? original = originalMinor;
    if (original == null) return _single(context, AppTextStyles.price);
    final saved = original - currentMinor;
    if (saved <= 0) return _single(context, AppTextStyles.price);

    return Semantics(
      label: semanticLabel ??
          'Precio con promoción: $_current, antes ${CurrencyFormatter.formatMinor(original)}, ahorras ${CurrencyFormatter.formatMinor(saved)}',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Text(
            CurrencyFormatter.formatMinor(original),
            style: AppTextStyles.bodyMedium.copyWith(
              color: AppColors.textMuted,
              decoration: TextDecoration.lineThrough,
              decorationColor: AppColors.textMuted,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            _current,
            style: AppTextStyles.price.copyWith(color: AppColors.textPrimary),
          ),
          const SizedBox(width: AppSpacing.sm),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: 2,
            ),
            decoration: BoxDecoration(
              color: AppColors.surfaceSuccessSubtle,
              borderRadius: BorderRadius.circular(AppRadii.sm),
            ),
            child: Text(
              'Ahorra ${CurrencyFormatter.formatMinor(saved)}',
              style: AppTextStyles.captionSmall
                  .copyWith(color: AppColors.textSuccess, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
