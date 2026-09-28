// Cuerpo de la pantalla de restablecimiento de contraseña.
//
// Aquí viven los dos campos y el envío. La página
// (`reset_password_page.dart`) resuelve el token del enlace, los estados de
// pantalla y la navegación.
//
// NOTA DE CONTRATO: `POST /auth/reset-password` SÍ recibe `confirmPassword`
// (API.md §7.1), a diferencia de `register`. Por eso el error del servidor para
// ese campo existe y se pinta; en el registro es solo validación de cliente.

import 'package:flutter/material.dart';

import '../../../app/theme/app_spacing.dart';
import '../../../core/error/failures.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_text_field.dart';
import '../../../shared/widgets/ui/form_error_banner.dart';
import 'auth_form_controller.dart';

/// Claves de campo del formulario de reseteo.
abstract final class ResetField {
  const ResetField._();
  static const String password = 'password';
  static const String confirmPassword = 'confirmPassword';
}

/// Los dos campos del formulario.
class ResetPasswordForm extends StatelessWidget {
  const ResetPasswordForm({
    required this.password,
    required this.confirm,
    required this.passwordFocus,
    required this.confirmFocus,
    required this.errors,
    required this.failure,
    required this.busy,
    required this.onChanged,
    required this.onSubmit,
    super.key,
  });

  final TextEditingController password;
  final TextEditingController confirm;
  final FocusNode passwordFocus;
  final FocusNode confirmFocus;
  final Map<String, String> errors;
  final Failure? failure;
  final bool busy;
  final void Function(String field) onChanged;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final Failure? error = failure;
    final Map<String, String> serverErrors =
        error == null ? const <String, String>{} : fieldErrorsOf(error);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (error != null) ...<Widget>[
          FormErrorBanner(
            failure: error,
            onRetry: error.isRetryable ? onSubmit : null,
          ),
          const SizedBox(height: AppSpacing.lg),
        ],
        AppTextField(
          controller: password,
          focusNode: passwordFocus,
          label: 'Contraseña nueva',
          helperText: 'Entre 8 y 72 caracteres, con una letra y un número.',
          prefixIcon: Icons.lock_outline_rounded,
          obscureToggle: true,
          keyboardAppearance: Brightness.light,
          textInputAction: TextInputAction.next,
          enabled: !busy,
          errorText:
              errors[ResetField.password] ?? serverErrors[ResetField.password],
          onChanged: (_) => onChanged(ResetField.password),
          onSubmitted: (_) => confirmFocus.requestFocus(),
          semanticLabel: 'Contraseña nueva',
        ),
        const SizedBox(height: AppSpacing.md),
        AppTextField(
          controller: confirm,
          focusNode: confirmFocus,
          label: 'Repite la contraseña',
          prefixIcon: Icons.lock_reset_rounded,
          obscureToggle: true,
          keyboardAppearance: Brightness.light,
          textInputAction: TextInputAction.done,
          enabled: !busy,
          errorText: errors[ResetField.confirmPassword] ??
              serverErrors[ResetField.confirmPassword],
          onChanged: (_) => onChanged(ResetField.confirmPassword),
          onSubmitted: (_) => onSubmit(),
          semanticLabel: 'Repite la contraseña',
        ),
        const SizedBox(height: AppSpacing.xl),
        AppButton(
          label: 'Guardar contraseña',
          icon: Icons.lock_reset_rounded,
          size: AppButtonSize.large,
          isFullWidth: true,
          isLoading: busy,
          onPressed: busy ? null : onSubmit,
          tooltip: 'Guardar tu contraseña nueva',
        ),
      ],
    );
  }
}
