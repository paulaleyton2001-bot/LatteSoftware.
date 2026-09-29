// Fila de etiqueta + valor de los paneles de detalle.
// MÓDULO `features/admin/presentation/widgets`.
//
// El ancho FIJO de la etiqueta (148 dp) es lo que hace que los valores queden
// alineados en vertical: con etiquetas de ancho variable, cada fila se desalinea
// y la columna de valores parece un río.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';

/// Fila de etiqueta + valor, para los paneles de detalle.
class AdminDetailRow extends StatelessWidget {
  const AdminDetailRow({
    required this.label,
    required this.value,
    this.isLast = false,
    super.key,
  });

  final String label;
  final String value;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: isLast ? 0 : AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          SizedBox(
            width: 148,
            child: Text(
              label,
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: AppTextStyles.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}

/// Botón de acción de cabecera. `AppButton` con tooltip, para que el icono solo
/// siga teniendo nombre.
class AdminHeaderAction extends StatelessWidget {
  const AdminHeaderAction({
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.isLoading = false,
    super.key,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return AppButton(
      label: '',
      icon: isLoading ? null : icon,
      variant: AppButtonVariant.secondary,
      size: AppButtonSize.medium,
      isLoading: isLoading,
      onPressed: isLoading ? null : onPressed,
      tooltip: tooltip,
      semanticLabel: tooltip,
    );
  }
}
