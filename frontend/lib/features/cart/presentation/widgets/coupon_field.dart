// Campo de cupón del carrito.
//
// `POST /discounts/validate` NO es un error cuando el cupón no vale: el backend
// devuelve `200` con `isValid: false` y un `reason` en español. Por eso el
// veredicto se pinta con color + ÍCONO + TEXTO (nunca solo color, WCAG 1.4.1) y
// no con un `ErrorState` a pantalla completa.
//
// El error de RED o de servidor sí va en `FormErrorBanner`, porque en ese caso el
// carrito no debe desaparecer bajo un mensaje de error.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_state.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../../domain/entities/coupon_quote.dart';
import '../cart_controller.dart';
import '../coupon_controller.dart';

/// Campo de cupón con botón de validación.
class CouponField extends ConsumerStatefulWidget {
  const CouponField({required this.cart, super.key});

  final CartState cart;

  @override
  ConsumerState<CouponField> createState() => _CouponFieldState();
}

class _CouponFieldState extends ConsumerState<CouponField> {
  final TextEditingController _controller = TextEditingController();
  bool _hasText = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    FocusScope.of(context).unfocus();
    final String code = _controller.text.trim();
    if (code.isEmpty) return;
    // Se guarda el código normalizado en el carrito: es lo que se enviará en
    // `POST /orders` como `couponCode` (el descuento real lo aplica el servidor).
    ref.read(cartControllerProvider.notifier).setCoupon(code);
    await ref.read(couponProvider.notifier).validate(code, widget.cart);
  }

  void _remove() {
    _controller.clear();
    setState(() => _hasText = false);
    ref.read(couponProvider.notifier).reset();
    ref.read(cartControllerProvider.notifier).setCoupon(null);
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<CouponQuote> quote = ref.watch(couponProvider);
    final bool busy = quote.isLoading;
    final String? applied = widget.cart.couponCode;
    final Failure? failure =
        quote.error is Failure ? quote.error! as Failure : null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AppTextField(
          controller: _controller,
          label: 'Cupón de descuento',
          hint: 'Si tienes un código, escríbelo aquí',
          helperText: 'Lo validamos antes de aplicar el descuento.',
          prefixIcon: Icons.sell_outlined,
          textCapitalization: TextCapitalization.characters,
          textInputAction: TextInputAction.done,
          enabled: !busy,
          onChanged: (String value) =>
              setState(() => _hasText = value.trim().isNotEmpty),
          onSubmitted: (_) => _apply(),
          semanticLabel: 'Código de cupón de descuento',
          suffix: !_hasText
              ? null
              : Semantics(
                  button: true,
                  label: 'Borrar el cupón escrito',
                  child: IconButton(
                    onPressed: _remove,
                    icon: const Icon(Icons.close_rounded, size: 20),
                    tooltip: 'Borrar el cupón',
                  ),
                ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: <Widget>[
            Expanded(
              child: AppButton(
                label: 'Aplicar cupón',
                icon: Icons.check_rounded,
                variant: AppButtonVariant.secondary,
                isLoading: busy,
                // El assert de `AppButton` exige `onPressed: null` en carga.
                onPressed: busy ? null : _apply,
              ),
            ),
            if (applied != null) ...<Widget>[
              const SizedBox(width: AppSpacing.sm),
              AppButton(
                label: 'Quitar',
                variant: AppButtonVariant.ghost,
                onPressed: busy ? null : _remove,
              ),
            ],
          ],
        ),
        if (failure != null) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          FormErrorBanner(
            failure: failure,
            compact: true,
            onRetry: failure.isRetryable ? _apply : null,
          ),
        ] else if (quote.hasValue && _hasText) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          CouponVerdict(quote: quote.requireValue),
        ],
      ],
    );
  }
}

/// Veredicto de la validación del cupón: texto + ícono + color.
class CouponVerdict extends StatelessWidget {
  const CouponVerdict({required this.quote, super.key});

  final CouponQuote quote;

  @override
  Widget build(BuildContext context) {
    final bool valid = quote.isValid;
    final Color surface =
        valid ? context.tokens.surfaceSuccessSubtle : context.tokens.surfaceWarningSubtle;
    final Color text = valid ? context.tokens.textSuccess : context.tokens.textWarning;

    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: surface,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              valid ? Icons.check_circle_rounded : Icons.info_rounded,
              size: 20,
              color: text,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    quote.describe(),
                    style: AppTextStyles.bodySmall.copyWith(color: text),
                  ),
                  if (valid && quote.discountMinor > 0) ...<Widget>[
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      'Te ahorras ${CurrencyFormatter.formatMinor(quote.discountMinor)}'
                      '${quote.cappedByMaxDiscount ? ' (tope del cupón alcanzado)' : ''}',
                      style: AppTextStyles.captionSmall.copyWith(
                        color: text,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
