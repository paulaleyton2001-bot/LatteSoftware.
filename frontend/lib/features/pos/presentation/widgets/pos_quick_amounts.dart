// Botones de importe rápido y cambio del diálogo de cobro.
//
// MÓDULO `pos/presentation/widgets`. Los importes que se ofrecen son los
// billetes y monedas que hay en la caja de una cafetería: casi todos los pagos
// son redondos, y teclear el número entero es la parte lenta del cobro.
//
// EL CAMBIO ES UNA PREVISUALIZACIÓN
// El número definitivo lo devuelve el servidor en `changeDueMinor` tras
// `POST /payments` (API.md §7.13). Aquí solo se ayuda al cajero a ver lo que va
// a devolver mientras escribe, y por eso avisa si el importe recibido no cubre
// el saldo en vez de mostrar un cambio negativo.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/constants/app_strings.dart';

/// Botones de importe rápido. `$5.000 / $10.000 / $20.000 / $50.000`, que son
/// los billetes y monedas que hay en la caja.
class PosQuickAmounts extends StatelessWidget {
  const PosQuickAmounts({
    required this.balanceMinor,
    required this.enabled,
    required this.onPick,
  });

  final int balanceMinor;
  final bool enabled;
  final ValueChanged<int> onPick;

  /// Billetes y monedas habituales, EN CENTAVOS (no hay `double` en dinero).
  static const List<int> _notes = <int>[500000, 1000000, 2000000, 5000000];

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: <Widget>[
        _AmountButton(
          label: AppStrings.paymentExactAmount,
          minor: balanceMinor,
          enabled: enabled,
          onTap: () => onPick(balanceMinor),
        ),
        for (final int note in _notes)
          if (note > balanceMinor)
            _AmountButton(
              label: CurrencyFormatter.formatMinor(note),
              minor: note,
              enabled: enabled,
              onTap: () => onPick(note),
            ),
      ],
    );
  }
}

/// Botón de importe.
class _AmountButton extends StatelessWidget {
  const _AmountButton({
    required this.label,
    required this.minor,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final int minor;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Cobrar $label',
      excludeSemantics: true,
      child: OutlinedButton(
        onPressed: enabled ? onTap : null,
        // 44 dp: es un control táctil del mostrador, no un botón de texto.
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(88, AppTapTarget.min),
        ),
        child: Text(label, style: AppTextStyles.labelLarge),
      ),
    );
  }
}
