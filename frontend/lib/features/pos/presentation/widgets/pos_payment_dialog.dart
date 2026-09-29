// Diálogo de cobro manual del mostrador. MÓDULO `pos/presentation/widgets`.
//
// POR QUÉ NO HAY PASARELA
// Este producto cobra en el local. El cajero recibe el dinero (efectivo) o pasa
// la tarjeta por el datáfono del propio negocio, y ANOTA lo que pasó:
//   - Efectivo: cuánto recibió. El backend calcula el cambio y lo devuelve en
//     `changeDueMinor`; aquí se calcula solo como PREVISUALIZACIÓN mientras
//     escribe, y el número que se le da al cliente es el del servidor.
//   - Tarjeta: el total EXACTO y la referencia de aprobación que el cajero copia
//     del ticket del datáfono. Sin ella no hay vínculo entre el cobro físico y el
//     registro, y la conciliación del cierre de caja es imposible.
//
// NUNCA se pide el número de tarjeta, el CVV ni la fecha: no hay integración y
// no se guardan datos de tarjeta en ningún sitio (BR-SEC-006).
//
// IDEMPOTENCIA
// El diálogo pide la clave al controlador al ABRIRSE y la conserva mientras siga
// abierto. Confirmar dos veces, o reintentar tras un fallo de red, viajan con la
// MISMA `Idempotency-Key`: el backend responde `200` con `meta.idempotent = true`
// y el mismo cuerpo, en vez de cobrar dos veces.
//
// EL CAMBIO SE CALCULA EN VIVO
// El campo "monto recibido" tiene botones de importe exacto y de.atajos ($5.000,
// $10.000, $20.000, $50.000), porque en una cafetería de volumen casi todos los
// pagos son.redondos y teclear el número entero es la parte lenta.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/pos_charge.dart';
import '../pos_charge_controller.dart';
import './pos_card_total_row.dart';
import './pos_change_row.dart';
import './pos_charge_error.dart';
import './pos_payment_fields.dart';
import './pos_quick_amounts.dart';

/// Diálogo de cobro. Devuelve `true` si el servidor aceptó el pago.
///
/// El [orderId] es el pedido ya CREADO (`POST /orders`): el cobro se registra
/// contra una orden real, nunca contra un borrador local.
class PosPaymentDialog extends ConsumerStatefulWidget {
  const PosPaymentDialog({
    required this.orderId,
    required this.orderNumber,
    required this.balanceMinor,
    super.key,
  });

  final int orderId;
  final String orderNumber;

  /// Saldo pendiente en centavos, tal como lo devolvió `POST /orders`.
  final int balanceMinor;

  /// Abre el diálogo. `null` si el cajero cancela (`Esc` o botón).
  static Future<bool?> show(
    BuildContext context, {
    required int orderId,
    required String orderNumber,
    required int balanceMinor,
  }) {
    return showDialog<bool>(
      context: context,
      // `barrierDismissible: false`: un cobro a medio escribir no se cierra por
      // un toque fuera. `Esc` sí cierra, y `onKeyEvent` lo gestiona.
      barrierDismissible: false,
      builder: (BuildContext context) => PosPaymentDialog(
        orderId: orderId,
        orderNumber: orderNumber,
        balanceMinor: balanceMinor,
      ),
    );
  }

  @override
  ConsumerState<PosPaymentDialog> createState() => _PosPaymentDialogState();
}

class _PosPaymentDialogState extends ConsumerState<PosPaymentDialog> {
  PosPaymentMethod _method = PosPaymentMethod.cash;
  final TextEditingController _received = TextEditingController();
  final TextEditingController _reference = TextEditingController();
  String? _referenceError;

  @override
  void initState() {
    super.initState();
    // El importe por defecto es el saldo EXACTO: lo más frecuente es que el
    // cliente pague justo, y prellenar evita teclear.
    _received.text = CurrencyFormatter.formatNumberMinor(widget.balanceMinor);
    // La clave se genera al abrir el diálogo y sobrevive a los reintentos del
    // mismo cobro (ver `PosChargeController.ensureIdempotencyKey`).
    ref.read(posChargeProvider.notifier).ensureIdempotencyKey();
  }

  @override
  void dispose() {
    _received.dispose();
    _reference.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // `posChargeProvider` es un `NotifierProvider<..., PosChargeState>`: el estado
    // ES el de la clase, sin `AsyncValue` ni `valueOrNull` de por medio. El cobro
    // se modela con sus propios estados (`PosChargeIdle`, `PosChargeInFlight`, ...)
    // precisamente para que el diálogo pueda distinguir "sin empezar" de "en curso".
    final PosChargeState current = ref.watch(posChargeProvider);
    final bool busy = current.isBusy;

    return AlertDialog(
      title: const Text('Cobrar'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _OrderLine(
                orderNumber: widget.orderNumber,
                balanceMinor: widget.balanceMinor,
              ),
              const SizedBox(height: AppSpacing.lg),
              PosPaymentMethodSelector(
                selected: _method,
                enabled: !busy,
                onChanged: (PosPaymentMethod value) =>
                    setState(() => _method = value),
              ),
              const SizedBox(height: AppSpacing.lg),
              if (_method.allowsOverpayment) ...<Widget>[
                AppTextField(
                  controller: _received,
                  label: AppStrings.paymentReceivedLabel,
                  helperText: 'Importe en pesos. El cambio se calcula solo.',
                  prefixIcon: Icons.payments_outlined,
                  textInputType: const TextInputType.numberWithOptions(decimal: true),
                  enabled: !busy,
                  onChanged: (_) => setState(() {}),
                ),
                const SizedBox(height: AppSpacing.sm),
                PosQuickAmounts(
                  balanceMinor: widget.balanceMinor,
                  enabled: !busy,
                  onPick: (int minor) => setState(() {
                    _received.text = CurrencyFormatter.formatNumberMinor(minor);
                  }),
                ),
                const SizedBox(height: AppSpacing.lg),
                PosChangeRow(
                  receivedMinor: CurrencyFormatter.parseMinor(_received.text),
                  balanceMinor: widget.balanceMinor,
                ),
              ] else ...<Widget>[
                AppTextField(
                  controller: _reference,
                  label: AppStrings.paymentReferenceLabel,
                  helperText: AppStrings.paymentReferenceHelp,
                  errorText: _referenceError,
                  prefixIcon: Icons.receipt_long_outlined,
                  maxLength: 100,
                  enabled: !busy,
                  autofocus: true,
                  onChanged: (String value) {
                    if (_referenceError == null) return;
                    setState(() => _referenceError = null);
                  },
                ),
                const SizedBox(height: AppSpacing.md),
                PosCardTotalRow(balanceMinor: widget.balanceMinor),
              ],
              if (current.failure != null) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                PosChargeError(failure: current.failure!),
              ],
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: busy ? null : () => Navigator.of(context).pop(false),
          child: Text('Cancelar (${AppStrings.shortcutClose})'),
        ),
        FilledButton.icon(
          onPressed: busy ? null : _submit,
          icon: busy
              ? const SizedBox.square(
                  dimension: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.check_rounded, size: 18),
          label: Text(
            busy ? 'Registrando…' : AppStrings.paymentConfirm,
          ),
        ),
      ],
    );
  }

  /// Valida y envía. Un fallo NO cierra el diálogo: el cajero necesita ver por qué
  /// y poder reintentar con la misma clave.
  Future<void> _submit() async {
    if (_method.requiresReference && _reference.text.trim().isEmpty) {
      setState(() => _referenceError = 'Anota la referencia del datáfono.');
      return;
    }
    final int amountMinor = _method.allowsOverpayment
        ? (CurrencyFormatter.parseMinor(_received.text) ?? widget.balanceMinor)
        : widget.balanceMinor;

    final PosChargeRequest request = PosChargeRequest(
      method: _method,
      amountMinor: amountMinor,
      referenceNumber: _method.requiresReference ? _reference.text.trim() : null,
    );

    final bool ok = await ref.read(posChargeProvider.notifier).charge(
          orderId: widget.orderId,
          request: request,
        );
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop(true);
    }
  }
}

/// Fila de pedido y saldo dentro del diálogo.
class _OrderLine extends StatelessWidget {
  const _OrderLine({required this.orderNumber, required this.balanceMinor});

  final String orderNumber;
  final int balanceMinor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                'Pedido $orderNumber',
                style: AppTextStyles.titleSmall,
              ),
              Text(
                'Total a cobrar',
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textSecondary),
              ),
            ],
          ),
        ),
        PriceDisplay(currentMinor: balanceMinor, variant: PriceVariant.large),
      ],
    );
  }
}

