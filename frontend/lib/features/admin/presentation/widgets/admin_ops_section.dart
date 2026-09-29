// Bloque de reservas, sillas e inventario de la configuración.
// MÓDULO `features/admin/presentation/widgets`.
//
// SEPARADO POR UNA REGLA DE NEGOCIO
// Estos tres campos cambian lo que el backend ACEPTA, no lo que se ve:
// `maxReservationMinutes` limita la duración de una reserva (BR-RES-*),
// `chairDefaultPriceMinor` es el precio por hora por defecto de una silla nueva
// (no altera los alquileres ya abiertos, BR-PRICE-010) y `allowNegativeStock`
// decide si un ajuste puede dejar el saldo en negativo. Están juntos porque se
// editan juntos, pero lejísimos de los datos fiscales.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import './admin_form_row.dart';

/// Bloque de reservas, sillas e inventario.
class AdminOpsSection extends StatelessWidget {
  const AdminOpsSection({
    required this.maxReservation,
    required this.chairPrice,
    required this.lowStock,
    required this.allowNegativeStock,
    required this.enabled,
    required this.onAllowNegativeStockChanged,
    super.key,
  });

  final TextEditingController maxReservation;
  final TextEditingController chairPrice;
  final TextEditingController lowStock;
  final bool allowNegativeStock;
  final bool enabled;
  final ValueChanged<bool> onAllowNegativeStockChanged;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const Divider(height: AppSpacing.xl),
        const Text('Reservas e inventario', style: AppTextStyles.titleMedium),
        const SizedBox(height: AppSpacing.md),
        AdminFormRow(
          children: <Widget>[
            AppTextField(
              controller: maxReservation,
              label: 'Duración máxima (minutos)',
              helperText: 'Tope de una reserva. El backend rechaza más con '
                  '`MAX_DURATION_EXCEEDED`.',
              textInputType: TextInputType.number,
              enabled: enabled,
            ),
            AppTextField(
              controller: chairPrice,
              label: 'Precio de silla por hora',
              helperText: 'En pesos. Se envía en centavos.',
              textInputType: TextInputType.number,
              enabled: enabled,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.md),
        AppTextField(
          controller: lowStock,
          label: 'Alerta de stock bajo',
          helperText: 'Unidades por debajo de las cuales se avisa.',
          textInputType: TextInputType.number,
          enabled: enabled,
        ),
        const SizedBox(height: AppSpacing.sm),
        SwitchListTile.adaptive(
          value: allowNegativeStock,
          // El switch avisa al PADRÓN con `onAllowNegativeStockChanged`, no con
          // `setState`: este widget es inmutable y quien guarda el borrador es el
          // formulario de Ajustes, que es el único que sabe si hay algo sin
          // guardar que se pueda perder.
          onChanged: enabled ? onAllowNegativeStockChanged : null,
          title: const Text('Permitir stock negativo'),
          subtitle: const Text('Solo si aceptas descuadres en el almacén.'),
          contentPadding: EdgeInsets.zero,
        ),
      ],
    );
  }
}
