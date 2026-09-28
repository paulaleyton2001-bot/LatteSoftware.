// Campo de texto del sistema de diseño: login, registro, admin, filtros,
// búsqueda, notas de pedido y selectores (`suffix` para el desplegable).
//
// El estilo (bordes, foco verde de 2 dp, padding, tipografía del error) NO se
// declara aquí: viene de `AppTheme.inputDecorationTheme`. Este widget solo
// aporta semántica y los estados que la UI necesita (password, contador,
// error del backend).

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_typography.dart';

/// Input con label, hint, iconos, error, contador y toggle de contraseña.
class AppTextField extends StatefulWidget {
  const AppTextField({
    super.key,
    this.controller,
    this.label,
    this.hint,
    this.helperText,
    this.errorText,
    this.prefixIcon,
    this.suffix,
    this.obscureToggle = false,
    this.textInputType,
    this.textInputAction = TextInputAction.next,
    this.keyboardAppearance,
    this.maxLines = 1,
    this.minLines,
    this.maxLength,
    this.enabled = true,
    this.readOnly = false,
    this.autofocus = false,
    this.textCapitalization = TextCapitalization.none,
    this.inputFormatters,
    this.onChanged,
    this.onSubmitted,
    this.onTap,
    this.focusNode,
    this.autovalidateMode,
    this.semanticLabel,
  }) : assert(
          maxLines == null || maxLines > 0,
          'Para un campo de una línea usa maxLines: 1 (por defecto).',
        );

  final TextEditingController? controller;

  /// Label flotante. `null` = solo placeholder.
  final String? label;
  final String? hint;
  /// Ayuda bajo el campo (se oculta si hay [errorText]) y error (rojo, que
  /// tiene prioridad). Ambos vienen del backend (`ValidationFailure`).
  final String? helperText;
  final String? errorText;
  final IconData? prefixIcon;
  /// Widget a la derecha (sufijo de moneda, botón de dropdown…).
  final Widget? suffix;
  /// `true` para contraseñas: muestra el botón ojo y alterna la ofuscación.
  final bool obscureToggle;

  final TextInputType? textInputType;
  final TextInputAction textInputAction;
  final Brightness? keyboardAppearance;
  /// `1` (por defecto) o `null` para multilínea.
  final int? maxLines;
  final int? minLines;
  final int? maxLength;
  final bool enabled;
  final bool readOnly;
  final bool autofocus;
  final TextCapitalization textCapitalization;
  final List<TextInputFormatter>? inputFormatters;
  final ValueChanged<String>? onChanged;
  final ValueChanged<String>? onSubmitted;
  final VoidCallback? onTap;
  final FocusNode? focusNode;
  /// Validación automática de Flutter (se combina con el mensaje del backend).
  final AutovalidateMode? autovalidateMode;
  /// Etiqueta accesible cuando el label visible no basta.
  final String? semanticLabel;

  @override
  State<AppTextField> createState() => _AppTextFieldState();
}

class _AppTextFieldState extends State<AppTextField> {
  /// Solo se usa con `obscureToggle`. El resto del widget es sin estado.
  bool _obscured = true;

  @override
  Widget build(BuildContext context) {
    final error = widget.errorText?.trim() ?? '';
    final hasError = error.isNotEmpty;

    return Semantics(
      textField: true,
      label: widget.semanticLabel,
      child: TextField(
        controller: widget.controller,
        focusNode: widget.focusNode,
        enabled: widget.enabled,
        readOnly: widget.readOnly,
        autofocus: widget.autofocus,
        obscureText: widget.obscureToggle && _obscured,
        keyboardType: widget.textInputType,
        textInputAction: widget.textInputAction,
        keyboardAppearance: widget.keyboardAppearance,
        maxLines: widget.obscureToggle ? 1 : widget.maxLines,
        minLines: widget.minLines,
        maxLength: widget.maxLength,
        textCapitalization: widget.textCapitalization,
        inputFormatters: widget.inputFormatters,
        onChanged: widget.onChanged,
        onSubmitted: widget.onSubmitted,
        onTap: widget.onTap,
        autovalidateMode: widget.autovalidateMode,
        style: AppTextStyles.bodyLarge,
        cursorColor: AppColors.actionPrimary,
        decoration: InputDecoration(
          labelText: widget.label,
          hintText: widget.hint,
          helperText: hasError ? null : widget.helperText,
          helperMaxLines: 2,
          errorText: hasError ? error : null,
          prefixIcon:
              widget.prefixIcon == null ? null : Icon(widget.prefixIcon, size: 20),
          suffixIcon: _buildSuffix(),
        ),
      ),
    );
  }

  /// Sufijo: widget del caller o botón ojo (con `Semantics` propio, para que el
  /// lector anuncie "mostrar contraseña" y no "icono").
  Widget? _buildSuffix() {
    if (widget.suffix != null) return widget.suffix;
    if (!widget.obscureToggle) return null;
    final label = _obscured ? 'Mostrar contraseña' : 'Ocultar contraseña';
    return Semantics(
      button: true,
      label: label,
      child: IconButton(
        onPressed: widget.enabled ? () => setState(() => _obscured = !_obscured) : null,
        icon: Icon(
          _obscured ? Icons.visibility_outlined : Icons.visibility_off_outlined,
          size: 20,
        ),
        tooltip: label,
      ),
    );
  }
}
