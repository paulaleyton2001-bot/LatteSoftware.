// Presentación de precios.
//
// ÚNICO widget autorizado a pintar dinero. Recibe SIEMPRE centavos (el
// `int` que manda la API en `*Minor`) y delega el texto en
// `core/utils/currency_formatter.dart`. Nadie escribe `price / 100` a mano.
//
// Variantes:
//   - [PriceVariant.normal]      — precio vigente (`$5.000`).
//   - [PriceVariant.large]       — detalle de producto y total del checkout.
//                                  Cambia el TAMAÑO, no el formato: sigue siendo
//                                  `$5.500`, sin decimales.
//   - [PriceVariant.promo]       — precio original tachado + precio promo con
//                                  badge de ahorro. `originalMinor` es el valor
//                                  tachado; `currentMinor` el vigente.
//   - `PriceVariant.costPerUnit` — "por hora" de las sillas (`$8.000 / hora`).
//
// BR-PRICE-008: el precio mostrado aquí es una previsualización; el total
// definitivo siempre lo devuelve el servidor tras `POST /orders`.
import 'package:flutter/material.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
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
  ///
  /// SIEMPRE sin decimales, también en [PriceVariant.large]: el contrato de
  /// presentación (`docs/DESIGN-TOKENS.md` §9.1) es `$5.500`, y los precios de
  /// Colombia no llevan centavos. El formato con decimales existe para el recibo
  /// (`CurrencyFormatter.formatMinor(..., withDecimals: true)`), no para un
  /// precio que se ve mientras se elige. Antes `large` salía `$5.500,00` y la
  /// misma cifra se pintaba de dos formas según la pantalla.
  String get _current => CurrencyFormatter.formatMinor(currentMinor);

  @override
  Widget build(BuildContext context) {
    final AppTokens t = context.tokens;
    return switch (variant) {
      PriceVariant.normal || PriceVariant.costPerUnit =>
        _single(AppTextStyles.price, t),
      PriceVariant.large => _single(AppTextStyles.priceLarge, t),
      PriceVariant.promo => _promo(t),
    };
  }

  /// Precio único con sufijo de unidad opcional.
  Widget _single(TextStyle style, AppTokens t) {
    final textStyle = style.copyWith(color: t.textPrimary);
    return Semantics(
      label: semanticLabel ?? 'Precio: $_current${unitLabel != null ? ' por $unitLabel' : ''}',
      excludeSemantics: true,
      child: unitLabel == null
          ? Text(_current, style: textStyle)
          : Text(
              '$_current / $unitLabel',
              style: textStyle.copyWith(color: t.textSecondary),
            ),
    );
  }

  /// Precio tachado + precio vigente + badge de ahorro.
  Widget _promo(AppTokens t) {
    final int? original = originalMinor;
    // Sin precio original, o sin ahorro real, se degrada al precio simple: es
    // mejor un precio limpio que un tachado que no significa nada.
    if (original == null || original - currentMinor <= 0) {
      return _single(AppTextStyles.price, t);
    }
    final int saved = original - currentMinor;

    return Semantics(
      label: semanticLabel ??
          'Precio con promoción: $_current, antes ${CurrencyFormatter.formatMinor(original)}, ahorras ${CurrencyFormatter.formatMinor(saved)}',
      excludeSemantics: true,
      // `Wrap` y no `Row`: precio tachado + precio vigente + badge "Ahorra" no
      // caben en el ancho de una card de 2 columnas y una `Row` se salía por la
      // derecha ("RIGHT OVERFLOWED BY 23 PIXELS"). Con `Wrap` el badge baja a su
      // línea y la card crece lo justo: el alto lo absorbe la imagen de
      // [ProductCard], que cede espacio, y la retícula lo mide con
      // [ProductCard.pricePromo].
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.xxs,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          Text(
            CurrencyFormatter.formatMinor(original),
            style: AppTextStyles.bodyMedium.copyWith(
              color: t.textMuted,
              decoration: TextDecoration.lineThrough,
              decorationColor: t.textMuted,
            ),
          ),
          Text(
            _current,
            style: AppTextStyles.price.copyWith(color: t.textPrimary),
          ),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.sm,
              vertical: 2,
            ),
            decoration: BoxDecoration(
              color: t.surfaceSuccessSubtle,
              borderRadius: BorderRadius.circular(AppRadii.sm),
            ),
            child: Text(
              'Ahorra ${CurrencyFormatter.formatMinor(saved)}',
              style: AppTextStyles.captionSmall
                  .copyWith(color: t.textSuccess, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}
