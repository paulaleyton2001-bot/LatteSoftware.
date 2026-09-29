// Cotización de la silla tal y como la devuelve el servidor.
//
// ESTAS CIFRAS SON DEL BACKEND, NO CALCULADAS AQUÍ
// `GET /reservations/quote` ya devuelve impuestos y servicio (docs/DESIGN-TOKENS
// §9.1): el cliente no conoce `taxRateBp` ni `serviceFeeBp`, así que inventarlos
// daría un precio que nunca coincide con el cobro. Si la petición falla, el bloque
// lo dice y ofrece reintentar: nunca enseña un total inventado.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/chair_quote.dart';
import '../checkout_controller.dart';
import '../checkout_state.dart';

/// Cotización de la silla, tal y como la devuelve el servidor.
class CheckoutQuoteBlock extends ConsumerWidget {
  const CheckoutQuoteBlock({required this.state, super.key});

  final CheckoutState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ChairQuote? quote = state.quote;
    if (state.chairId == null) return const SizedBox.shrink();

    if (state.isQuoting && quote == null) {
      return const Padding(
        padding: EdgeInsets.all(AppSpacing.lg),
        child: Center(
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      );
    }
    if (state.quoteFailure != null) {
      return FormErrorBanner(
        failure: state.quoteFailure!,
        compact: true,
        onRetry: () => ref.read(checkoutProvider.notifier).refreshQuote(),
      );
    }
    if (quote == null) return const SizedBox.shrink();

    if (!quote.isAvailable) {
      return FormErrorBanner(
        failure: ConflictFailure(
          message: quote.unavailableReason ??
              'Esa silla no está libre en ese horario.',
          code: 'CHAIR_ALREADY_RESERVED',
        ),
        title: 'Elige otra silla',
        onRetry: () => ref.read(checkoutProvider.notifier).refreshQuote(),
      );
    }
    return CheckoutQuoteSummary(quote: quote);
  }
}

/// Resumen de la cotización, ya válida.
class CheckoutQuoteSummary extends StatelessWidget {
  const CheckoutQuoteSummary({required this.quote, super.key});

  final ChairQuote quote;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                Icons.sell_outlined,
                size: 18,
                color: context.tokens.textSuccess,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text('Precio de la silla', style: AppTextStyles.titleSmall),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          QuoteRow(label: 'Tarifa', value: quote.describe()),
          if (quote.minimumApplied)
            const QuoteRow(label: 'Mínimo', value: '30 min'),
          if (quote.discountMinor > 0)
            QuoteRow(
              label: 'Cupón aplicado',
              value: '−${CurrencyFormatter.formatMinor(quote.discountMinor)}',
            ),
          if (quote.taxMinor > 0)
            QuoteRow(
              label: 'Impuestos',
              value: CurrencyFormatter.formatMinor(quote.taxMinor),
            ),
          if (quote.serviceFeeMinor > 0)
            QuoteRow(
              label: 'Cargo por servicio',
              value: CurrencyFormatter.formatMinor(quote.serviceFeeMinor),
            ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: <Widget>[
              Expanded(
                child: Text('Total silla', style: AppTextStyles.titleSmall),
              ),
              PriceDisplay(
                currentMinor: quote.totalMinor,
                variant: PriceVariant.large,
                semanticLabel: 'Total de la silla: '
                    '${CurrencyFormatter.formatMinor(quote.totalMinor, withDecimals: true)}',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Fila etiqueta/valor de la cotización.
class QuoteRow extends StatelessWidget {
  const QuoteRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            child: Text(
              label,
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          Text(value, style: AppTextStyles.bodySmall),
        ],
      ),
    );
  }
}
