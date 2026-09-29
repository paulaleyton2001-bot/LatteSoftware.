// Alta y edición de un producto. MÓDULO `features/admin/presentation/widgets`.
//
// EL PRECIO SE ESCRIBE EN PESOS Y SE MANDA EN CENTAVOS
// `basePriceMinor` es un entero de centavos, y escribir «4500» pensando en pesos
// es el error más caro de esta pantalla: no se ve hasta que un cliente paga con
// 45.000. Aquí el campo se rotula con la unidad real y se convierte al enviar,
// con el separador de miles para que 4500 se lea como 4.500.
//
// EL PATCH NO LLEVA SKU NI DISPONIBILIDAD
// `updateProductBodySchema` rechaza `sku` (inmutable en v1) y `isAvailable`, que
// tiene su propio endpoint. Mandarlos produce un 400 que no dice qué campo sobra,
// así que el formulario de EDICIÓN los omite en vez de mandarlos vacíos.
//
// LAS VARIANTES Y LOS COMPLEMENTOS NO SE EDITAN AQUÍ
// Son sub-recursos con su propio ciclo (`POST /products/:id/variants`). Meterlos
// en este formulario lo haría un editor de dos pantallas en una, y `variants` en
// el `POST` es solo para el alta: en un `PATCH` no se puede reemplazar el
// conjunto. Se editan desde la ficha del producto.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../domain/entities/admin_products.dart';

/// Datos del formulario de producto, ya en las unidades de la API.
class AdminProductDraft {
  const AdminProductDraft({required this.body, required this.name});

  final Map<String, dynamic> body;
  final String name;
}

/// Formulario de alta/edición de un producto.
class AdminProductFormDialog extends StatefulWidget {
  const AdminProductFormDialog({
    required this.categories,
    this.product,
    super.key,
  });

  /// Catálogo para el desplegable de categoría.
  final List<AdminCategory> categories;

  /// `null` = alta.
  final AdminProduct? product;

  static Future<AdminProductDraft?> show(
    BuildContext context, {
    required List<AdminCategory> categories,
    AdminProduct? product,
  }) =>
      showDialog<AdminProductDraft>(
        context: context,
        builder: (BuildContext dialogContext) => AdminProductFormDialog(
          categories: categories,
          product: product,
        ),
      );

  @override
  State<AdminProductFormDialog> createState() => _AdminProductFormDialogState();
}

class _AdminProductFormDialogState extends State<AdminProductFormDialog> {
  late final TextEditingController _name =
      TextEditingController(text: widget.product?.name ?? '');
  late final TextEditingController _sku =
      TextEditingController(text: widget.product?.sku ?? '');
  late final TextEditingController _shortDescription =
      TextEditingController(text: widget.product?.shortDescription ?? '');
  late final TextEditingController _price = TextEditingController(
    text: widget.product == null
        ? ''
        : (widget.product!.basePriceMinor / 100).toStringAsFixed(2),
  );
  late final TextEditingController _promoPrice = TextEditingController(
    text: widget.product?.promoPriceMinor == null
        ? ''
        : (widget.product!.promoPriceMinor! / 100).toStringAsFixed(2),
  );
  late final TextEditingController _imageUrl =
      TextEditingController(text: widget.product?.imageUrl ?? '');
  late final TextEditingController _preparation = TextEditingController(
    text: (widget.product?.preparationMinutes ?? 0).toString(),
  );

  late int? _categoryId = widget.product?.categoryId;
  late bool _trackStock = widget.product?.trackStock ?? false;
  late bool _isFeatured = widget.product?.isFeatured ?? false;
  final Map<String, String> _errors = <String, String>{};

  bool get _isEdit => widget.product != null;

  @override
  void dispose() {
    _name.dispose();
    _sku.dispose();
    _shortDescription.dispose();
    _price.dispose();
    _promoPrice.dispose();
    _imageUrl.dispose();
    _preparation.dispose();
    super.dispose();
  }

  /// Convierte lo escrito a centavos. `null` si no se puede.
  int? _moneyToMinor(TextEditingController controller) {
    final String text = controller.text.trim().replaceAll('.', '').replaceAll(',', '.');
    // Se quitan los puntos de miles ANTES de interpretar la coma como decimal:
    // «4.500,50» son 450050 centavos, no 45,005.
    final double? raw = double.tryParse(text);
    if (raw == null || raw < 0) return null;
    return (raw * 100).round();
  }

  void _submit() {
    setState(_errors.clear);
    final String name = _name.text.trim();
    final int? price = _moneyToMinor(_price);

    if (name.isEmpty) _errors['name'] = 'El nombre es obligatorio.';
    if (!_isEdit && _sku.text.trim().isEmpty) {
      _errors['sku'] = 'El SKU es obligatorio en el alta.';
    }
    if (price == null) _errors['price'] = 'Escribe el precio.';
    if (price != null && price == 0) {
      _errors['price'] = 'Un producto no puede costar cero.';
    }

    final int? promo = _promoPrice.text.trim().isEmpty
        ? null
        : _moneyToMinor(_promoPrice);
    if (_promoPrice.text.trim().isNotEmpty && promo == null) {
      _errors['promoPrice'] = 'Escribe el importe promocional.';
    }
    if (promo != null && price != null && promo >= price) {
      // No lo rechaza el backend, pero un precio promocional mayor que el base
      // es un cupón disfrazado que después nadie sabe explicar.
      _errors['promoPrice'] = 'El precio promocional debe ser menor que el base.';
    }

    final String imageUrl = _imageUrl.text.trim();
    if (imageUrl.isNotEmpty && !_isHttpUrl(imageUrl)) {
      _errors['imageUrl'] = 'Empieza por http:// o https://';
    }
    final int preparation = int.tryParse(_preparation.text.trim()) ?? 0;
    if (preparation < 0) _errors['preparation'] = 'No puede ser negativo.';

    if (_errors.isNotEmpty) {
      setState(() {});
      return;
    }

    final Map<String, dynamic> body = <String, dynamic>{
      'name': name,
      'basePriceMinor': price,
      'preparationMinutes': preparation,
      'taxRateBp': widget.product?.taxRateBp ?? 0,
      'categoryId': _categoryId,
      if (_shortDescription.text.trim().isNotEmpty)
        'shortDescription': _shortDescription.text.trim(),
      if (imageUrl.isNotEmpty) 'imageUrl': imageUrl,
      if (promo != null) 'promoPriceMinor': promo,
      // `sku` es inmutable en v1: solo viaja en el alta. Mandarlo en un `PATCH`
      // es un 400 (`updateProductBodySchema` es `.strict()`).
      if (!_isEdit) ...<String, dynamic>{
        'sku': _sku.text.trim(),
        'trackStock': _trackStock,
        'isFeatured': _isFeatured,
      },
    };
    Navigator.of(context).pop(AdminProductDraft(body: body, name: name));
  }

  /// `imageUrlOptional` del backend acepta `http(s)` y quizá vacío; la validación
  /// mínima la hace la propia URL para no duplicar su expresión regular.
  static bool _isHttpUrl(String value) {
    final Uri? uri = Uri.tryParse(value);
    return uri != null &&
        uri.hasScheme &&
        (uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.host.isNotEmpty;
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(_isEdit ? 'Editar ${widget.product!.name}' : 'Nuevo producto'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              AppTextField(
                controller: _name,
                label: 'Nombre',
                maxLength: 150,
                autofocus: !_isEdit,
                errorText: _errors['name'],
              ),
              if (!_isEdit) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                AppTextField(
                  controller: _sku,
                  label: 'SKU',
                  maxLength: 50,
                  textCapitalization: TextCapitalization.characters,
                  helperText: 'No se puede cambiar después.',
                  errorText: _errors['sku'],
                ),
              ],
              const SizedBox(height: AppSpacing.md),
              DropdownButtonFormField<int?>(
                value: _categoryId,
                decoration: const InputDecoration(labelText: 'Categoría'),
                items: <DropdownMenuItem<int?>>[
                  const DropdownMenuItem<int?>(
                      value: null, child: Text('Sin categoría')),
                  for (final AdminCategory category in widget.categories)
                    DropdownMenuItem<int?>(
                      value: category.id,
                      child: Text(category.name),
                    ),
                ],
                onChanged: (int? value) => setState(() => _categoryId = value),
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _price,
                label: 'Precio base',
                textInputType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                helperText: 'En pesos. Se guarda en centavos.',
                errorText: _errors['price'],
                suffix: Text(
                  CurrencyFormatter.split(0).$1,
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _promoPrice,
                label: 'Precio promocional (opcional)',
                textInputType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                ],
                errorText: _errors['promoPrice'],
                suffix: Text(
                  CurrencyFormatter.split(0).$1,
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _shortDescription,
                label: 'Descripción corta (opcional)',
                maxLength: 200,
                errorText: _errors['shortDescription'],
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _imageUrl,
                label: 'URL de la imagen (opcional)',
                textInputType: TextInputType.url,
                maxLength: 500,
                errorText: _errors['imageUrl'],
              ),
              const SizedBox(height: AppSpacing.md),
              AppTextField(
                controller: _preparation,
                label: 'Minutos de preparación',
                textInputType: TextInputType.number,
                inputFormatters: <TextInputFormatter>[
                  FilteringTextInputFormatter.digitsOnly,
                ],
                errorText: _errors['preparation'],
              ),
              if (!_isEdit) ...<Widget>[
                const SizedBox(height: AppSpacing.sm),
                SwitchListTile.adaptive(
                  value: _trackStock,
                  onChanged: (bool value) => setState(() => _trackStock = value),
                  title: const Text('Controlar inventario'),
                  subtitle: Text(
                    'Descuenta stock al vender y avisa cuando queda poco.',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                  contentPadding: EdgeInsets.zero,
                ),
                SwitchListTile.adaptive(
                  value: _isFeatured,
                  onChanged: (bool value) => setState(() => _isFeatured = value),
                  title: const Text('Destacado'),
                  subtitle: Text(
                    'Aparece primero en el menú del cliente.',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                  contentPadding: EdgeInsets.zero,
                ),
              ],
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
