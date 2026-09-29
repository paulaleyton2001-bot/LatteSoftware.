// Diálogo de ajuste de stock. MÓDULO `features/admin/presentation/widgets`.
//
// DOS MODOS, UNA PANTALLA
// `+ / −` por VARIACIÓN (lo normal en almacén) y "fijar saldo" por `newQuantity`.
// El endpoint acepta EXACTAMENTE UNO de los dos campos y responde `400` si Least uno
// de los dos. El selector de modo existe para que el cuerpo nunca lleve ambos.
//
// EL MOTIVO ES OBLIGATORIO Y ES LO QUE DA VALOR AL AJUSTE
// `POST /inventory/items/:id/adjust` lo exige. Sin él, dentro de tres meses
// nadie sabe por qué el café subió de 4 kg a 40.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../domain/entities/admin_inventory_item.dart';
import '../admin_inventory_controller.dart';

/// Abre el diálogo de ajuste de [item].
Future<void> showAdminInventoryAdjustDialog(
  BuildContext context,
  WidgetRef ref,
  AdminInventoryItem item,
) =>
    showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) =>
          AdminInventoryAdjustDialog(item: item),
    );

/// Diálogo de ajuste de stock.
class AdminInventoryAdjustDialog extends ConsumerStatefulWidget {
  const AdminInventoryAdjustDialog({required this.item, super.key});

  final AdminInventoryItem item;

  @override
  ConsumerState<AdminInventoryAdjustDialog> createState() =>
      _AdminInventoryAdjustDialogState();
}

class _AdminInventoryAdjustDialogState
    extends ConsumerState<AdminInventoryAdjustDialog> {
  final TextEditingController _quantity = TextEditingController();
  final TextEditingController _reason = TextEditingController();
  bool _setAbsolute = false;
  String? _quantityError;
  String? _reasonError;

  @override
  void initState() {
    super.initState();
    _quantity.text =
        CurrencyFormatter.formatNumberMinor(widget.item.currentStock.round());
  }

  @override
  void dispose() {
    _quantity.dispose();
    _reason.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> busy =
        ref.watch(adminAdjustProvider(widget.item.id));

    return AlertDialog(
      title: const Text('Ajustar stock'),
      content: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                '${widget.item.name} · saldo actual '
                '${_qty(widget.item.currentStock)} ${widget.item.unit}',
                style: AppTextStyles.bodySmall,
              ),
              const SizedBox(height: AppSpacing.md),
              SegmentedButton<bool>(
                segments: const <ButtonSegment<bool>>[
                  ButtonSegment<bool>(
                    value: false,
                    label: Text('Sumar o restar'),
                    icon: Icon(Icons.exposure_plus_1_rounded),
                  ),
                  ButtonSegment<bool>(
                    value: true,
                    label: Text('Fijar saldo'),
                    icon: Icon(Icons.filter_center_focus_rounded),
                  ),
                ],
                selected: <bool>{_setAbsolute},
                onSelectionChanged: (Set<bool> value) =>
                    setState(() => _setAbsolute = value.first),
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _quantity,
                label: _setAbsolute ? 'Saldo final' : 'Variación',
                helperText: _setAbsolute
                    ? 'El saldo quedará exactamente en este número.'
                    : 'Usa un signo negativo para restar: -5',
                errorText: _quantityError,
                prefixIcon: Icons.numbers_rounded,
                textInputType: const TextInputType.numberWithOptions(
                  decimal: true,
                  signed: true,
                ),
                enabled: !busy.isLoading,
                autofocus: true,
                onChanged: (_) {
                  if (_quantityError == null) return;
                  setState(() => _quantityError = null);
                },
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _reason,
                label: 'Motivo del ajuste',
                hint: 'Conteo de inventario, rotura, corrección…',
                helperText: 'Obligatorio. Queda en el histórico de movimientos.',
                errorText: _reasonError,
                maxLines: 2,
                maxLength: 300,
                enabled: !busy.isLoading,
                onChanged: (_) {
                  if (_reasonError == null) return;
                  setState(() => _reasonError = null);
                },
              ),
              if (busy.error != null) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                Text(
                  busy.error is Failure
                      ? (busy.error! as Failure).message
                      : 'No se pudo registrar el ajuste.',
                  style: AppTextStyles.bodySmall
                      .copyWith(color: Theme.of(context).colorScheme.error),
                ),
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
          child: Text(busy.isLoading ? 'Guardando…' : 'Ajustar'),
        ),
      ],
    );
  }

  /// Valida y envía el modo que corresponda. Nunca los dos campos a la vez.
  Future<void> _submit() async {
    final double? raw = _parse(_quantity.text);
    final String reason = _reason.text.trim();
    if (raw == null) {
      setState(() => _quantityError = 'Escribe un número válido.');
      return;
    }
    if (reason.length < 2) {
      setState(() => _reasonError = 'El motivo es obligatorio.');
      return;
    }
    if (!_setAbsolute && raw == 0) {
      setState(() => _quantityError = 'Una variación de cero no hace nada.');
      return;
    }

    final controller =
        ref.read(adminAdjustProvider(widget.item.id).notifier);
    final bool ok = _setAbsolute
        ? await controller.setTo(raw.round(), reason: reason)
        : await controller.changeBy(raw, reason: reason);
    if (!mounted) return;
    if (ok) {
      Navigator.of(context).pop();
    } else {
      controller.acknowledge();
    }
  }

  /// Acepta coma o punto como separador decimal y un `−` (U+2212) como signo.
  static double? _parse(String raw) {
    final String cleaned = raw
        .replaceAll('−', '-')
        .replaceAll(' ', '')
        .replaceAll('.', '')
        .replaceAll(',', '.');
    if (cleaned.isEmpty) return null;
    return double.tryParse(cleaned);
  }

  static String _qty(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);
}
