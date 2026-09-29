// Fila de cambio del diálogo de cobro. MÓDULO `pos/presentation/widgets`.
//
// Es una PREVISUALIZACIÓN con `liveRegion`: el cajero lee el cambio mientras
// escribe el importe recibido, y para eso necesita que el lector de pantalla lo
// anuncie sin tener que volver a recorrer el campo.
//
// El número DEFINITIVO lo devuelve el servidor en `changeDueMinor` tras
// `POST /payments` (API.md §7.13): este cálculo no sustituye a ese.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/constants/app_strings.dart';

/// Cambio calculado en vivo a partir de lo que el cajero escribió.
///
/// Es una PREVISUALIZACIÓN: el número definitivo lo devuelve el servidor en
/// `changeDueMinor` tras `POST /payments` (API.md §7.13). Si el cajero escribe
/// menos que el saldo, se avisa en vez de mostrar un cambio negativo.
class PosChangeRow extends StatelessWidget {
  const PosChangeRow({required this.receivedMinor, required this.balanceMinor});

  final int? receivedMinor;
  final int balanceMinor;

  @override
  Widget build(BuildContext context) {
    final int? received = receivedMinor;
    if (received == null) return const SizedBox.shrink();
    final int change = received - balanceMinor;
    final bool enough = change >= 0;

    return Semantics(
      liveRegion: true,
      label: enough
          ? 'Cambio a entregar ${CurrencyFormatter.formatMinor(change)}'
          : 'Faltan ${CurrencyFormatter.formatMinor(-change)} para cubrir el total',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: enough
              ? context.tokens.surfaceSuccessSubtle
              : context.tokens.surfaceWarningSubtle,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: <Widget>[
            Icon(
              enough ? Icons.check_circle_outline_rounded : Icons.info_outline_rounded,
              size: 20,
              color: enough ? context.tokens.textSuccess : context.tokens.textWarning,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                enough ? AppStrings.paymentChangeLabel : 'Falta por recibir',
                style: AppTextStyles.titleSmall.copyWith(
                  color: enough ? context.tokens.textSuccess : context.tokens.textWarning,
                ),
              ),
            ),
            Text(
              CurrencyFormatter.formatMinor(change.abs()),
              style: AppTextStyles.priceLarge.copyWith(
                color: enough ? context.tokens.textSuccess : context.tokens.textWarning,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
