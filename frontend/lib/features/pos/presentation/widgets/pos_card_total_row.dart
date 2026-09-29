// Fila del total en modo tarjeta. MÓDULO `pos/presentation/widgets`.
//
// En tarjeta NO hay cambio: el datáfono ya cobró el total exacto y lo que se
// registra es ese mismo importe, con la referencia que el cajero anotó. La fila
// lo dice explícitamente para que nadie espere un cambio que no existe.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/price_display.dart';

/// Fila del total en tarjeta, donde no hay cambio: se cobra el saldo exacto.
class PosCardTotalRow extends StatelessWidget {
  const PosCardTotalRow({required this.balanceMinor});

  final int balanceMinor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Icon(Icons.credit_card_rounded,
            size: 20, color: context.tokens.textSecondary),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Text(
            'Se cobra el total exacto en el datáfono',
            style: AppTextStyles.bodySmall
                .copyWith(color: context.tokens.textSecondary),
          ),
        ),
        PriceDisplay(currentMinor: balanceMinor, variant: PriceVariant.large),
      ],
    );
  }
}
