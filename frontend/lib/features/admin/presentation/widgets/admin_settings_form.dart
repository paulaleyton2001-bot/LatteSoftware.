// Formulario de datos del negocio. MÓDULO `features/admin/presentation/widgets`.
//
// LOS PORCENTAJES SE ESCRIBEN EN %, SE ENVIAN EN BASIS POINTS
// `taxRateBp` = 1900 es 19 %. Un campo que muestra "1900" para un impuesto del
// 19 % haría que alguien escribiera "19" y el backend lo entendiera como el
// 0,19 %: el cobro de todas las ventas siguientes saldría mal. Aquí se escribe y se
// ve en porcentaje, y la conversión vive en `percentToBasisPoints`.
//
// LA MONEDA SE MUESTRA, NO SE CAMBIA A SU ANTOJO
// `PATCH /business` responde `409 CURRENCY_CHANGE_BLOCKED` si hay pedidos ya
// creados. El campo se pinta igual (es información), pero el backend manda y el
// mensaje se muestra sin retocar.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../domain/entities/admin_business.dart';
import '../admin_settings_controller.dart';
import './admin_form_row.dart';
import './admin_ops_section.dart';
import './admin_tax_section.dart';
import './admin_tips_editor.dart';

/// Formulario de datos del negocio.
class AdminBusinessForm extends ConsumerStatefulWidget {
  const AdminBusinessForm({required this.business, super.key});

  final AdminBusiness business;

  @override
  ConsumerState<AdminBusinessForm> createState() => _AdminBusinessFormState();
}

class _AdminBusinessFormState extends ConsumerState<AdminBusinessForm> {
  late final Map<String, TextEditingController> _fields;
  bool _taxInclusive = false;
  bool _tipEnabled = false;

  /// Propinas sugeridas, en PORCENTAJES. Se guardan como `defaultTipsBp`, que es
  /// basis points en TEXTO (`"1500"`): el backend lo persiste como CSV y su
  /// esquema exige `string[]`, así que mandar `[1500]` sería un 400.
  ///
  /// Se edita en porcentaje y no en basis points porque "15 %" es lo que el
  /// dueño del negocio entiende; "1500 bp" es una unidad de desarrollo.
  late List<String> _tips = <String>[];
  bool _allowNegativeStock = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final AdminBusiness b = widget.business;
    _fields = <String, TextEditingController>{
      'name': TextEditingController(text: b.name),
      'legalName': TextEditingController(text: b.legalName ?? ''),
      'taxId': TextEditingController(text: b.taxId ?? ''),
      'email': TextEditingController(text: b.email ?? ''),
      'phone': TextEditingController(text: b.phone ?? ''),
      'addressLine1': TextEditingController(text: b.addressLine1 ?? ''),
      'city': TextEditingController(text: b.city ?? ''),
      'taxRate': TextEditingController(
        text: basisPointsToPercent(b.taxRateBp).toStringAsFixed(2),
      ),
      'serviceFee': TextEditingController(
        text: basisPointsToPercent(b.serviceFeeBp).toStringAsFixed(2),
      ),
      'maxReservation': TextEditingController(text: '${b.maxReservationMinutes}'),
      'chairPrice': TextEditingController(
        text: (b.chairDefaultPriceMinor / 100).toStringAsFixed(0),
      ),
      'lowStock': TextEditingController(text: '${b.lowStockAlertThreshold}'),
      'orderPrefix': TextEditingController(text: b.orderPrefix),
    };
    _taxInclusive = b.taxInclusive;
    _tipEnabled = b.tipEnabled;
    _tips = <String>[
      for (final int bp in b.defaultTipsBp)
        if (bp > 0) (bp / 100).toStringAsFixed(bp % 100 == 0 ? 0 : 2),
    ];
    _allowNegativeStock = b.allowNegativeStock;
  }

  @override
  void dispose() {
    for (final TextEditingController controller in _fields.values) {
      controller.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> busy = ref.watch(adminSettingsProvider);
    final AdminBusiness b = widget.business;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          const Text('Datos del negocio', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          AppTextField(
            controller: _fields['name'],
            label: 'Nombre comercial',
            maxLength: 150,
            enabled: !busy.isLoading,
          ),
          const SizedBox(height: AppSpacing.md),
          AdminFormRow(
            children: <Widget>[
              AppTextField(
                controller: _fields['legalName'],
                label: 'Razón social',
                maxLength: 150,
                enabled: !busy.isLoading,
              ),
              AppTextField(
                controller: _fields['taxId'],
                label: 'NIT',
                enabled: !busy.isLoading,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          AdminFormRow(
            children: <Widget>[
              AppTextField(
                controller: _fields['email'],
                label: 'Correo de contacto',
                textInputType: TextInputType.emailAddress,
                enabled: !busy.isLoading,
              ),
              AppTextField(
                controller: _fields['phone'],
                label: 'Teléfono',
                enabled: !busy.isLoading,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          AppTextField(
            controller: _fields['addressLine1'],
            label: 'Dirección',
            maxLength: 200,
            enabled: !busy.isLoading,
          ),
          const SizedBox(height: AppSpacing.md),
          AdminFormRow(
            children: <Widget>[
              AppTextField(
                controller: _fields['city'],
                label: 'Ciudad',
                maxLength: 100,
                enabled: !busy.isLoading,
              ),
              AppTextField(
                controller: _fields['orderPrefix'],
                label: 'Prefijo de pedido',
                helperText: '2-8 caracteres. Hoy: ${b.orderPrefix}',
                maxLength: 8,
                enabled: !busy.isLoading,
              ),
            ],
          ),
          AdminOpsSection(
            maxReservation: _fields['maxReservation']!,
            chairPrice: _fields['chairPrice']!,
            lowStock: _fields['lowStock']!,
            allowNegativeStock: _allowNegativeStock,
            enabled: !busy.isLoading,
            onAllowNegativeStockChanged: (bool value) =>
                setState(() => _allowNegativeStock = value),
          ),
          AdminTaxSection(
            taxRate: _fields['taxRate']!,
            serviceFee: _fields['serviceFee']!,
            taxInclusive: _taxInclusive,
            tipEnabled: _tipEnabled,
            enabled: !busy.isLoading,
            onTaxInclusiveChanged: (bool value) =>
                setState(() => _taxInclusive = value),
            onTipEnabledChanged: (bool value) =>
                setState(() => _tipEnabled = value),
          ),
          if (_tipEnabled) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            AdminTipsEditor(
              tips: _tips,
              onChanged: (List<String> value) => setState(() => _tips = value),
            ),
          ],
          if (_error != null || busy.error != null) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            Text(
              _error ??
                  (busy.error is Failure
                      ? (busy.error! as Failure).message
                      : 'No se pudo guardar.'),
              style: AppTextStyles.bodySmall
                  .copyWith(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          AppButton(
            label: 'Guardar cambios',
            icon: Icons.save_outlined,
            variant: AppButtonVariant.primary,
            isFullWidth: true,
            isLoading: busy.isLoading,
            onPressed: busy.isLoading ? null : _save,
          ),
        ],
      ),
    );
  }

  /// Manda SOLO los campos que cambiaron: un `PATCH` con todo reescribiría campos
  /// que el usuario no tocó, y con `currencyCode` entre ellos eso sería un `409`.
  Future<void> _save() async {
    setState(() => _error = null);
    final double? tax = _percent(_fields['taxRate']!.text);
    final double? fee = _percent(_fields['serviceFee']!.text);
    if (tax == null || fee == null) {
      setState(() => _error = 'Los porcentajes deben ser números.');
      return;
    }

    final Map<String, dynamic> body = <String, dynamic>{
      'name': _fields['name']!.text.trim(),
      'taxRateBp': percentToBasisPoints(tax),
      'serviceFeeBp': percentToBasisPoints(fee),
      'taxInclusive': _taxInclusive,
      'tipEnabled': _tipEnabled,
      // Solo si hay propinas: `defaultTipsBp` exige `.min(1)` cuando viaja, así
      // que mandar una lista vacía al apagar el interruptor sería un 400 en vez
      // de un simple "no mandes el campo".
      if (_tipEnabled && _tips.isNotEmpty)
        'defaultTipsBp': <String>[
          for (final String tip in _tips)
            if (percentToBasisPoints(double.tryParse(tip.replaceAll(',', '.')) ?? 0) > 0)
              percentToBasisPoints(double.tryParse(tip.replaceAll(',', '.'))!).toString(),
        ],
      'allowNegativeStock': _allowNegativeStock,
      'maxReservationMinutes':
          int.tryParse(_fields['maxReservation']!.text.trim()) ?? 120,
      'lowStockAlertThreshold':
          int.tryParse(_fields['lowStock']!.text.trim()) ?? 0,
      'orderPrefix': _fields['orderPrefix']!.text.trim().toUpperCase(),
      'chairDefaultPriceMinor':
          (int.tryParse(_fields['chairPrice']!.text.trim()) ?? 0) * 100,
      if (_fields['legalName']!.text.trim().isNotEmpty)
        'legalName': _fields['legalName']!.text.trim(),
      if (_fields['taxId']!.text.trim().isNotEmpty)
        'taxId': _fields['taxId']!.text.trim(),
      if (_fields['email']!.text.trim().isNotEmpty)
        'email': _fields['email']!.text.trim(),
      if (_fields['phone']!.text.trim().isNotEmpty)
        'phone': _fields['phone']!.text.trim(),
      if (_fields['addressLine1']!.text.trim().isNotEmpty)
        'addressLine1': _fields['addressLine1']!.text.trim(),
      if (_fields['city']!.text.trim().isNotEmpty)
        'city': _fields['city']!.text.trim(),
    };

    final bool ok =
        await ref.read(adminSettingsProvider.notifier).saveBusiness(body);
    if (!ok && mounted) {
      ref.read(adminSettingsProvider.notifier).acknowledge();
    }
  }

  /// Porcentaje escrito, aceptando coma o punto.
  static double? _percent(String raw) {
    final String cleaned = raw.trim().replaceAll(',', '.');
    return double.tryParse(cleaned);
  }
}
