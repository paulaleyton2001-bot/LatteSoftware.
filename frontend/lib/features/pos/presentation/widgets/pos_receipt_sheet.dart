// Comprobante de venta del mostrador. MÓDULO `pos/presentation/widgets`.
//
// Se muestra en un `showModalBottomSheet` justo después de cobrar, con el CAMBIO
// que calculó el servidor. Es la pantalla que el cajero mira mientras da el
// vuelto: por eso el cambio va en `priceLarge` y no en una línea más.
//
// POR QUÉ UN SHEET Y NO UN DIÁLOGO
// El comprobante es una RECAPITULACIÓN que se consulta y se cierra, no una
// decisión: un `AlertDialog` con dos botones dejaría de lado la mitad de la
// pantalla. El `Sheet` se puede arrastrar para cerrar con el pulgar.
//
// EL DINERO VIENE DEL SERVIDOR
// `totalMinor` es lo que se imputó, `changeDueMinor` lo que calculó `POST
// /payments` y `balanceMinor` lo que queda. El cliente no recalcula nada: si el
// cajero entregó 50.000 para un saldo de 18.000, se imputan 18.000 y se devuelven
// 32.000, y ese 32.000 es el número que sale del servidor.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/price_display.dart';

/// Resumen de la venta recién cobrada.
class PosReceiptSheet extends StatelessWidget {
  const PosReceiptSheet({
    required this.orderNumber,
    required this.totalMinor,
    required this.changeDueMinor,
    required this.balanceMinor,
    required this.formatMoney,
    this.onPrint,
    super.key,
  });

  final String orderNumber;

  /// Imputado al pedido, en centavos.
  final int totalMinor;

  /// Cambio a entregar, en centavos. Lo calcula el servidor.
  final int changeDueMinor;

  /// Saldo que queda. `0` = pedido pagado.
  final int balanceMinor;

  /// Función de formato de dinero. Se inyecta para que este widget no dependa de
  /// `core/utils` y siga siendo un presentador tonto.
  final String Function(int minor) formatMoney;

  /// Acción opcional de reimpresión (la conecta el tablero de pedidos).
  final VoidCallback? onPrint;

  @override
  Widget build(BuildContext context) {
    final bool hasChange = changeDueMinor > 0;
    final bool paid = balanceMinor <= 0;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.sm,
          AppSpacing.lg,
          AppSpacing.xl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Semantics(
              header: true,
              child: Text('Cobro registrado', style: AppTextStyles.headlineSmall),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Pedido $orderNumber',
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
            const SizedBox(height: AppSpacing.lg),
            _AmountRow(label: 'Imputado al pedido', minor: totalMinor),
            if (hasChange) ...<Widget>[
              const SizedBox(height: AppSpacing.sm),
              _ChangeBlock(changeMinor: changeDueMinor),
            ],
            const SizedBox(height: AppSpacing.md),
            Row(
              children: <Widget>[
                Icon(Icons.check_circle_rounded,
                    size: 20, color: context.tokens.textSuccess),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    paid ? 'Pedido pagado' : 'Quedan ${formatMoney(balanceMinor)}',
                    style: AppTextStyles.titleSmall.copyWith(
                      color: paid ? context.tokens.textSuccess : context.tokens.textWarning,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Continuar vendiendo',
              icon: Icons.point_of_sale_rounded,
              variant: AppButtonVariant.espresso,
              size: AppButtonSize.large,
              isFullWidth: true,
              onPressed: () => Navigator.of(context).pop(),
            ),
            if (onPrint != null) ...<Widget>[
              const SizedBox(height: AppSpacing.sm),
              AppButton(
                label: 'Reimprimir comprobante',
                icon: Icons.print_outlined,
                variant: AppButtonVariant.secondary,
                size: AppButtonSize.medium,
                isFullWidth: true,
                onPressed: onPrint,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Fila etiqueta + importe del comprobante.
class _AmountRow extends StatelessWidget {
  const _AmountRow({required this.label, required this.minor});

  final String label;
  final int minor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Expanded(
          child: Text(
            label,
            style: AppTextStyles.bodyMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
        ),
        PriceDisplay(currentMinor: minor, variant: PriceVariant.large),
      ],
    );
  }
}

/// Bloque del cambio, destacado porque es el número que hay que mirar.
class _ChangeBlock extends StatelessWidget {
  const _ChangeBlock({required this.changeMinor});

  final int changeMinor;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      label: 'Cambio a entregar',
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: context.tokens.surfaceSuccessSubtle,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Cambio a entregar',
              style: AppTextStyles.titleSmall
                  .copyWith(color: context.tokens.textSuccess),
            ),
            const SizedBox(height: AppSpacing.xs),
            PriceDisplay(
              currentMinor: changeMinor,
              variant: PriceVariant.large,
              semanticLabel: 'Cambio a entregar',
            ),
          ],
        ),
      ),
    );
  }
}
