// Bloque de impuestos y cobro de la configuración. MÓDULO `.../widgets`.
//
// SEPARADO POR EL CONVESTO DE UNIDAD
// `taxRateBp` y `serviceFeeBp` son basis points. El usuario escribe 19; la app
// envía 1900. Esa conversión vive en `percentToBasisPoints`
// (`admin_settings_controller.dart`), y este widget solo decide qué se escribe y
// qué se avisa. Mezclado con el resto del formulario, la conversión quedaba
// escondida entre veinte campos de texto.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import './admin_form_row.dart';

/// Bloque de impuestos, propinas y cobro.
///
/// Recibe los controllers del formulario padre: los widgets de esta pantalla son
/// sin estado y el estado del formulario (qué se ha escrito) vive en uno solo, para
/// que el botón de guardar tenga TODO lo que necesita sin tener que subir por el
/// árbol.
class AdminTaxSection extends StatelessWidget {
  const AdminTaxSection({
    required this.taxRate,
    required this.serviceFee,
    required this.taxInclusive,
    required this.tipEnabled,
    required this.enabled,
    required this.onTaxInclusiveChanged,
    required this.onTipEnabledChanged,
    super.key,
  });

  final TextEditingController taxRate;
  final TextEditingController serviceFee;
  final bool taxInclusive;
  final bool tipEnabled;
  final bool enabled;
  final ValueChanged<bool> onTaxInclusiveChanged;
  final ValueChanged<bool> onTipEnabledChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Divider(height: AppSpacing.xl),
        const Text('Impuestos y cobro', style: AppTextStyles.titleMedium),
        const SizedBox(height: AppSpacing.md),
        AdminFormRow(
          children: <Widget>[
            AppTextField(
              controller: taxRate,
              label: 'Impuesto (%)',
              helperText: 'Se envía en basis points: 19 % = 1900.',
              textInputType:
                  const TextInputType.numberWithOptions(decimal: true),
              enabled: enabled,
            ),
            AppTextField(
              controller: serviceFee,
              label: 'Cargo por servicio (%)',
              textInputType:
                  const TextInputType.numberWithOptions(decimal: true),
              enabled: enabled,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        // Los switches avisan al PADRÓN en vez de llamar a `setState`: este widget
        // es inmutable y el borrador (incluido lo que se ha escrito en los campos
        // de arriba) vive en el formulario, que es el único que puede decidir si
        // hay algo sin guardar.
        SwitchListTile.adaptive(
          value: taxInclusive,
          onChanged: enabled ? onTaxInclusiveChanged : null,
          title: const Text('El impuesto está incluido en el precio'),
          contentPadding: EdgeInsets.zero,
        ),
        SwitchListTile.adaptive(
          value: tipEnabled,
          onChanged: enabled ? onTipEnabledChanged : null,
          title: const Text('Permitir propinas'),
          contentPadding: EdgeInsets.zero,
        ),
      ],
    );
  }
}
