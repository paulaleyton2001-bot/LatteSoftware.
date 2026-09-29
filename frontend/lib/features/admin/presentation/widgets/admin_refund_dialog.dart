// Diálogo de reembolso. MÓDULO `features/admin/presentation/widgets`.
//
// POR QUÉ ES UN DIÁLOGO DESTRUCTIVO
// Reembolsar mueve dinero hacia atrás y no se puede deshacer desde la app. Por eso
// el flujo es: formulario → `ConfirmDialog` destructivo → llamada. El formulario
// pide importe y motivo; la confirmación recuerda el importe y que el saldo restante
// NO se puede volver a reembolsar.
//
// EL IMPORTE SE PRECARGA CON EL SALDO
// `amountMinor - refundedMinor` es el máximo que acepta el backend (BR-PAY-006).
// Precargarlo hace que el reembolso TOTAL sea un toque (que es el 90 % de los
// casos) sin dejar que el usuario escriba un número que va a ser rechazado.
//
// NO HAY PASARELA
// Este reembolso REGISTRA lo que se devolvió en el mostrador. No llama a nadie: no
// hay pasarela en este producto, y por eso el motivo es obligatorio y queda en el
// histórico (`order_status_history`).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/admin_payments.dart';
import '../admin_payments_controller.dart';

/// Abre el diálogo de reembolso de [payment].
Future<void> showAdminRefundDialog(
  BuildContext context,
  WidgetRef ref,
  AdminPayment payment,
) =>
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) =>
          AdminRefundDialog(payment: payment),
    );

/// Diálogo de reembolso total o parcial.
class AdminRefundDialog extends ConsumerStatefulWidget {
  const AdminRefundDialog({required this.payment, super.key});

  final AdminPayment payment;

  @override
  ConsumerState<AdminRefundDialog> createState() => _AdminRefundDialogState();
}

class _AdminRefundDialogState extends ConsumerState<AdminRefundDialog> {
  late final TextEditingController _amount;
  late final TextEditingController _reason;
  String? _amountError;
  String? _reasonError;

  @override
  void initState() {
    super.initState();
    // Precargado con el saldo reembolsable: es el caso mayoritario y evita teclear.
    _amount = TextEditingController(
      text: CurrencyFormatter.formatNumberMinor(widget.payment.refundableMinor),
    );
    _reason = TextEditingController();
  }

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> busy =
        ref.watch(adminRefundProvider(widget.payment.id));
    final int max = widget.payment.refundableMinor;

    return AlertDialog(
      title: const Text('Reembolsar pago'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      'Cobrado: ${CurrencyFormatter.formatMinor(widget.payment.amountMinor)}',
                      style: AppTextStyles.bodySmall
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                  ),
                  PriceDisplay(currentMinor: max),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _amount,
                label: 'Importe a devolver',
                helperText: 'Máximo: ${CurrencyFormatter.formatMinor(max)}',
                errorText: _amountError,
                prefixIcon: Icons.undo_rounded,
                textInputType: const TextInputType.numberWithOptions(decimal: true),
                enabled: !busy.isLoading,
                autofocus: true,
                onChanged: (_) {
                  if (_amountError == null) return;
                  setState(() => _amountError = null);
                },
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _reason,
                label: 'Motivo del reembolso',
                hint: 'Producto no entregado, cobro duplicado…',
                helperText: 'Queda en el histórico del pedido. Es obligatorio.',
                errorText: _reasonError,
                maxLines: 3,
                maxLength: 300,
                enabled: !busy.isLoading,
                onChanged: (_) {
                  if (_reasonError == null) return;
                  setState(() => _reasonError = null);
                },
              ),
              if (busy.error != null) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                _RefundErrorNotice(message: _messageOf(busy.error)),
              ],
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: busy.isLoading ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: busy.isLoading ? null : _submit,
          child: Text(busy.isLoading ? 'Reembolsando…' : 'Continuar'),
        ),
      ],
    );
  }

  /// Valida, pide confirmación y llama a `POST /payments/:id/refund`.
  Future<void> _submit() async {
    final int? amount = CurrencyFormatter.parseMinor(_amount.text);
    final String reason = _reason.text.trim();

    if (amount == null || amount <= 0) {
      setState(() => _amountError = 'Escribe un importe mayor que cero.');
      return;
    }
    if (amount > widget.payment.refundableMinor) {
      setState(() => _amountError =
          'El máximo es ${CurrencyFormatter.formatMinor(widget.payment.refundableMinor)}.');
      return;
    }
    if (reason.length < 2) {
      setState(() => _reasonError = 'El motivo es obligatorio.');
      return;
    }

    final bool isTotal = amount == widget.payment.refundableMinor;
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: isTotal ? '¿Reembolsar todo?' : '¿Reembolsar ${CurrencyFormatter.formatMinor(amount)}?',
      message: isTotal
          ? 'El pago quedará como reembolsado. Lo que ya se devolvió no se puede '
              'volver a reembolsar.'
          : 'Quedarán ${CurrencyFormatter.formatMinor(widget.payment.refundableMinor - amount)} '
              'sin reembolsar de este pago.',
      confirmLabel: 'Reembolsar',
      action: DialogAction.cancel,
      icon: Icons.undo_rounded,
    );
    if (action != DialogAction.confirm || !mounted) return;

    final bool ok = await ref
        .read(adminRefundProvider(widget.payment.id).notifier)
        .refund(amountMinor: amount, reason: reason);
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
    } else {
      ref.read(adminRefundProvider(widget.payment.id).notifier).acknowledge();
    }
  }

  /// Mensaje del fallo ya traducido por `ErrorMapper` (`core/error/failures.dart`).
  ///
  /// El error del provider es `Object` porque puede ser cualquier excepción; el
  /// `is Failure` lo estrecha y, si no lo es, se muestra un mensaje genérico en vez
  /// de imprimir `[object Object]` en pantalla.
  static String _messageOf(Object? error) => error is Failure
      ? error.message
      : 'No se pudo registrar el reembolso. Inténtalo de nuevo.';
}

/// Aviso de error dentro del diálogo de reembolso.
///
/// Texto + ícono, nunca solo color (WCAG 1.4.1). Es un `Column` y no el
/// `PosInlineNotice` del POS porque aquel usa `AppSpacing` de ese módulo y este
/// diálogo ya tiene su propio marco: dos widgets casi idénticos con tres líneas
/// de diferencia se unifican cuando aparece el tercero, no antes.
class _RefundErrorNotice extends StatelessWidget {
  const _RefundErrorNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.tokens.surfaceErrorSubtle,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(Icons.error_outline_rounded,
                size: 20, color: context.tokens.textError),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                message,
                style: AppTextStyles.bodySmall
                    .copyWith(color: context.tokens.textError),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
