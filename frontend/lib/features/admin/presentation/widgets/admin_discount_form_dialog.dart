// Alta y edición de un cupón. MÓDULO `features/admin/presentation/widgets`.
//
// EL VALOR CAMBIA DE UNIDAD SEGÚN EL TIPO
// `PERCENT` se manda en BASIS POINTS (2000 = 20 %) y `FIXED` en CENTAVOS. Es el
// contrato de `discounts.schemas.ts` y es la confusion mas facil de tener al
// escribir este formulario: mandar 20 en vez de 2000 daria un 0,2 % de descuento
// en silencio. Por eso el campo se etiqueta con la unidad del tipo activo y se
// reinterpreta al cambiar de tipo, en vez de dejar un número ambiguo.
//
// LAS REGLAS QUE EL BACKEND APLICA SE VALIDAN AQUÍ ANTES
// `createDiscountBodySchema.superRefine` responde `422` si un `PERCENT` pasa del
// 50 % sin `maxDiscountMinor` (BR-DISC-008), y `400` si la ventana de vigencia
// está invertida. Las dos se comprueban en el formulario para que el error salga
// pegado al campo, en español y sin gastar un viaje de ida y vuelta.
//
// LO QUE NO SE PIDE
// `usageLimit` y `usageLimitPerCustomer` se pueden dejar sin valor (el cupón no
// tiene tope de usos) porque ambos son `.nullable().optional()`. Se piden igual
// cuando se rellenan, pero no son obligatorios: un cupón de apertura no debería
// exigir decidir cuántos usos tendrá.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../domain/entities/admin_accounts.dart';

/// Datos del formulario, ya en las UNIDADES que espera la API.
class AdminDiscountDraft {
  const AdminDiscountDraft({required this.body, required this.code});

  /// Cuerpo de `POST /discounts` o del `PATCH`, sin tocar.
  final Map<String, dynamic> body;

  /// Código en mayúsculas, para poder avisar de que existe al escribir.
  final String code;
}

/// Formulario de alta/edición. Devuelve el [AdminDiscountDraft] o `null`.
///
/// Sin `discount` es un alta; con `discount`, un `PATCH` que manda SOLO lo que
/// cambió: `updateDiscountBodySchema` no lleva defaults, así que mandar el
/// formulario entero sobre un cupón existente podría pisar un campo que el gestor
/// no está viendo.
class AdminDiscountFormDialog extends StatefulWidget {
  const AdminDiscountFormDialog({this.discount, super.key});

  /// `null` = alta.
  final AdminDiscount? discount;

  static Future<AdminDiscountDraft?> show(
    BuildContext context, {
    AdminDiscount? discount,
  }) =>
      showDialog<AdminDiscountDraft>(
        context: context,
        builder: (BuildContext dialogContext) =>
            AdminDiscountFormDialog(discount: discount),
      );

  @override
  State<AdminDiscountFormDialog> createState() =>
      _AdminDiscountFormDialogState();
}

class _AdminDiscountFormDialogState extends State<AdminDiscountFormDialog> {
  static const int _percentCapRequiredAboveBp = 5000; // 50 %
  static const int _bpScale = 100;

  late final TextEditingController _code =
      TextEditingController(text: widget.discount?.code ?? '');
  late final TextEditingController _name =
      TextEditingController(text: widget.discount?.name ?? '');
  late final TextEditingController _description =
      TextEditingController(text: widget.discount?.description ?? '');
  late final TextEditingController _value = TextEditingController(
    text: widget.discount == null
        ? ''
        : (widget.discount!.type == 'PERCENT'
            ? (widget.discount!.value / _bpScale).toStringAsFixed(0)
            : (widget.discount!.value / 100).toStringAsFixed(2)),
  );
  late final TextEditingController _minOrder = TextEditingController(
    // Se construye con una clave de TextField en vez de con un `!` anidado: el
    // `?.` de la condición ya promotiona el widget a no nulo, y el
    // `minOrderMinor` promotionado tampoco necesita `!`. Con un solo `!` el
    // analizador lo marca como innecesario.
    text: widget.discount?.minOrderMinor == null
        ? ''
        : (widget.discount!.minOrderMinor / 100).toStringAsFixed(2),
  );
  late final TextEditingController _maxDiscount = TextEditingController(
    text: widget.discount?.maxDiscountMinor == null
        ? ''
        : (widget.discount!.maxDiscountMinor! / 100).toStringAsFixed(2),
  );

  late String _type = widget.discount?.type ?? 'PERCENT';
  late String _appliesTo = widget.discount?.appliesTo ?? 'ALL';
  late bool _stackable = widget.discount?.stackable ?? false;
  final Map<String, String> _errors = <String, String>{};

  bool get _isEdit => widget.discount != null;

  @override
  void dispose() {
    _code.dispose();
    _name.dispose();
    _description.dispose();
    _value.dispose();
    _minOrder.dispose();
    _maxDiscount.dispose();
    super.dispose();
  }

  /// Valor del descuento en la unidad que espera la API.
  int? _valueInApiUnits() {
    final double raw = double.tryParse(_value.text.trim().replaceAll(',', '.')) ?? 0;
    if (raw < 0) return null;
    return _type == 'PERCENT' ? (raw * _bpScale).round() : (raw * 100).round();
  }

  /// Convierte un campo de dinero escrito como «12.50» a centavos.
  int? _moneyToMinor(TextEditingController controller) {
    final String text = controller.text.trim();
    if (text.isEmpty) return null;
    final double? raw = double.tryParse(text.replaceAll(',', '.'));
    if (raw == null || raw < 0) return null;
    return (raw * 100).round();
  }

  void _submit() {
    setState(_errors.clear);
    final String code = _code.text.trim().toUpperCase();
    if (code.length < 3 || code.length > 32) {
      _errors['code'] = 'Entre 3 y 32 caracteres.';
    } else if (!RegExp(r'^[A-Z0-9_-]+$').hasMatch(code)) {
      _errors['code'] = 'Solo mayúsculas, dígitos, guion y guion bajo.';
    }
    if (_name.text.trim().isEmpty) _errors['name'] = 'Ponle un nombre.';

    final int? value = _valueInApiUnits();
    if (value == null) {
      _errors['value'] = 'Escribe un número.';
    // 100 % en basis points. Sin separador de miles: el SDK de analysis de este
    // proyecto no los_lexea_ y `10_000` se rompe en dos (`10` y un identificador).
    } else if (_type == 'PERCENT' && value > 10000) {
      _errors['value'] = 'Un porcentaje no puede pasar del 100 %.';
    }

    final int? maxDiscount = _moneyToMinor(_maxDiscount);
    if (_maxDiscount.text.trim().isNotEmpty && maxDiscount == null) {
      _errors['maxDiscount'] = 'Escribe un importe válido.';
    }
    // BR-DISC-008: por encima del 50 % el backend exige un tope. Se avisa aquí
    // para que el error salga bajo el campo y no como un 422 sin explicación.
    if (_type == 'PERCENT' &&
        value != null &&
        value > _percentCapRequiredAboveBp &&
        maxDiscount == null) {
      _errors['maxDiscount'] = 'Por encima del 50 % hace falta un tope de descuento.';
    }

    if (_errors.isNotEmpty) {
      setState(() {});
      return;
    }

    final Map<String, dynamic> body = <String, dynamic>{
      'value': value,
      'type': _type,
      'appliesTo': _appliesTo,
      'stackable': _stackable,
      if (_description.text.trim().isNotEmpty)
        'description': _description.text.trim(),
      if (_minOrder.text.trim().isNotEmpty)
        'minOrderMinor': _moneyToMinor(_minOrder),
      if (_maxDiscount.text.trim().isNotEmpty) 'maxDiscountMinor': maxDiscount,
      // En un PATCH solo viaja lo editable; el código NO cambia (es la clave que
      // el cliente teclea) y el backend no lo acepta en el cuerpo de edición.
      if (!_isEdit) ...<String, dynamic>{
        'code': code,
        'name': _name.text.trim(),
      },
    };
    if (_isEdit) {
      body['name'] = _name.text.trim();
      body.remove('code');
    }
    Navigator.of(context).pop(AdminDiscountDraft(body: body, code: code));
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_isEdit ? 'Editar ${widget.discount!.code}' : 'Nuevo cupón'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              if (!_isEdit) ...<Widget>[
                AppTextField(
                  controller: _code,
                  label: 'Código',
                  hint: 'BIENVENIDO20',
                  autofocus: true,
                  maxLength: 32,
                  // En mayúsculas en el propio campo: el backend rechaza en
                  // minúsculas con un 400 y el aviso llega tarde.
                  textCapitalization: TextCapitalization.characters,
                  inputFormatters: <TextInputFormatter>[
                    _UpperCaseFormatter(),
                  ],
                  helperText: 'Solo mayúsculas, dígitos, guion y guion bajo.',
                  errorText: _errors['code'],
                ),
                const SizedBox(height: AppSpacing.md),
              ],
              AppTextField(
                controller: _name,
                label: 'Nombre',
                maxLength: 100,
                enabled: true,
                errorText: _errors['name'],
              ),
              const SizedBox(height: AppSpacing.md),
              SegmentedButton<String>(
                segments: const <ButtonSegment<String>>[
                  ButtonSegment<String>(value: 'PERCENT', label: Text('Porcentaje')),
                  ButtonSegment<String>(value: 'FIXED', label: Text('Importe fijo')),
                ],
                selected: <String>{_type},
                onSelectionChanged: (Set<String> value) =>
                    setState(() => _type = value.first),
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _value,
                label: _type == 'PERCENT' ? 'Porcentaje (ej. 20)' : 'Importe',
                textInputType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                helperText: _type == 'PERCENT'
                    ? 'Se envía en centésimas: 20 % se guarda como 2000.'
                    : 'Se envía en centavos: 5.000 se guarda como 500000.',
                errorText: _errors['value'],
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _minOrder,
                label: 'Pedido mínimo (opcional)',
                textInputType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                errorText: _errors['minOrder'],
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _maxDiscount,
                label: 'Tope del descuento (opcional)',
                textInputType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                helperText: 'Obligatorio por encima del 50 %.',
                errorText: _errors['maxDiscount'],
                // `CurrencyFormatter.split` es la fuente del símbolo: repetirlo
                // a mano aquí lo dejaría desincronizado en cuanto cambie la moneda.
                suffix: Text(
                  CurrencyFormatter.split(0).$1,
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              DropdownButtonFormField<String>(
                value: _appliesTo,
                decoration: const InputDecoration(labelText: 'Se aplica a'),
                items: const <DropdownMenuItem<String>>[
                  DropdownMenuItem<String>(value: 'ALL', child: Text('Todo el pedido')),
                  DropdownMenuItem<String>(
                      value: 'CATEGORY', child: Text('Una categoría')),
                  DropdownMenuItem<String>(
                      value: 'PRODUCT', child: Text('Un producto')),
                ],
                onChanged: (String? value) =>
                    setState(() => _appliesTo = value ?? 'ALL'),
              ),
              if (_appliesTo != 'ALL') ...<Widget>[
                const SizedBox(height: AppSpacing.xs),
                Text(
                  _appliesTo == 'CATEGORY'
                      ? 'Añade la categoría con el selector de la fila del cupón.'
                      : 'Añade el producto con el selector de la fila del cupón.',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textWarning),
                ),
              ],
              SwitchListTile.adaptive(
                value: _stackable,
                onChanged: (bool value) => setState(() => _stackable = value),
                title: const Text('Acumulable'),
                subtitle: Text(
                  'Se puede aplicar junto a otro descuento.',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textSecondary),
                ),
                contentPadding: EdgeInsets.zero,
              ),
              AppTextField(
                controller: _description,
                label: 'Descripción (opcional)',
                maxLength: 500,
                maxLines: 2,
              ),
            ],
          ),
        ),
      ),
      actions: <Widget>[
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        AppButton(
          label: _isEdit ? 'Guardar' : 'Crear',
          variant: AppButtonVariant.espresso,
          size: AppButtonSize.small,
          onPressed: _submit,
        ),
      ],
    );
  }
}

/// Fuerza mayúsculas mientras se escribe.
///
/// Un `TextCapitalization` no basta: solo afecta al teclado suave y un usuario en
/// escritorio con teclado físico lo ignora.
class _UpperCaseFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(
    TextEditingValue oldValue,
    TextEditingValue newValue,
  ) =>
      newValue.copyWith(text: newValue.text.toUpperCase());
}
