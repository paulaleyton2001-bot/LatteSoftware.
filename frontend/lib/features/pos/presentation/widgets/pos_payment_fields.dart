// Controles del diálogo de cobro: método, importe y cambio.
//
// MÓDULO `pos/presentation/widgets`. Se separan del diálogo porque son widgets
// sin estado y porque el diálogo tiene que caber por debajo de las 200 líneas
// (norma del proyecto).
//
// EL CAMBIO ES UNA PREVISUALIZACIÓN
// El número definitivo lo devuelve el servidor en `changeDueMinor` tras
// `POST /payments` (API.md §7.13). Aquí solo se ayuda al cajero a ver lo que va
// a devolver mientras escribe.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../domain/entities/pos_charge.dart';

/// Selector de método de pago. `CASH` y `CARD`, que es lo que el local acepta.
class PosPaymentMethodSelector extends StatelessWidget {
  const PosPaymentMethodSelector({
    required this.selected,
    required this.enabled,
    required this.onChanged,
  });

  final PosPaymentMethod selected;
  final bool enabled;
  final ValueChanged<PosPaymentMethod> onChanged;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      label: 'Método de pago',
      child: Row(
        children: <Widget>[
          for (final PosPaymentMethod method in PosPaymentMethod.values)
            Expanded(
              child: Padding(
                padding: EdgeInsets.only(
                  right: method == PosPaymentMethod.cash ? AppSpacing.sm : 0,
                ),
                child: PosPaymentMethodTile(
                  method: method,
                  selected: method == selected,
                  enabled: enabled,
                  onTap: () => onChanged(method),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Tarjeta de método de pago: texto + ícono + borde de 2 dp al elegir.
class PosPaymentMethodTile extends StatelessWidget {
  const PosPaymentMethodTile({
    required this.method,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final PosPaymentMethod method;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final IconData icon = method == PosPaymentMethod.cash
        ? Icons.payments_rounded
        : Icons.credit_card_rounded;
    return Semantics(
      button: true,
      selected: selected,
      label: method.label,
      excludeSemantics: true,
      child: Material(
        color: selected ? context.tokens.surfaceGreenSubtle : context.tokens.surface,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            constraints: const BoxConstraints(minHeight: 56),
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              // Borde de 2 dp: la selección se distingue por forma, no solo por
              // el color de fondo.
              border: Border.all(
                color: selected ? context.tokens.actionPrimary : context.tokens.borderDefault,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Icon(icon, size: 20, color: context.tokens.textPrimary),
                const SizedBox(width: AppSpacing.sm),
                Flexible(
                  child: Text(
                    method.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.labelLarge
                        .copyWith(color: context.tokens.textPrimary),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
