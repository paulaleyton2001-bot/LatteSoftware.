// Campos del formulario de registro.
//
// Un archivo por formulario (el de login también lo tiene) para mantener el
// tamaño y separar la validación en línea del marco de navegación.
//
// El teléfono es OPCIONAL y en formato E.164 (`+573001234567`), que es lo que
// acepta `POST /auth/register` (API.md §7.1). El campo de confirmación de
// contraseña es solo cliente: el endpoint de registro no lo recibe.
//
// `errors` mezcla los errores en cliente (los pone la página) y los del backend
// (los pone `FormErrorBanner` vía `fieldErrorsOf`). El backend tiene prioridad
// cuando ambos apuntan al mismo campo.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/theme/app_spacing.dart';
import '../../../core/error/failures.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_text_field.dart';
import '../../../shared/widgets/ui/form_error_banner.dart';
import 'auth_form_controller.dart';

/// Claves de campo del formulario. Evitan literales sueltos que se desincronicen
/// entre la página (que escribe) y el formulario (que lee).
abstract final class RegisterField {
  const RegisterField._();
  static const String fullName = 'fullName';
  static const String email = 'email';
  static const String phone = 'phone';
  static const String password = 'password';
  static const String confirmPassword = 'confirmPassword';
}

/// Formulario de alta de cuenta.
class RegisterForm extends ConsumerWidget {
  const RegisterForm({
    required this.controllers,
    required this.focusNodes,
    required this.errors,
    required this.onChanged,
    required this.onSubmit,
    super.key,
  });

  /// `[fullName, email, phone, password, confirmPassword]`.
  final List<TextEditingController> controllers;

  /// Mismo orden que [controllers].
  final List<FocusNode> focusNodes;

  /// Errores por campo (cliente + servidor).
  final Map<String, String> errors;

  /// Aviso de que el usuario editó [field], para limpiar su error en cliente.
  final void Function(String field) onChanged;

  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final submission = ref.watch(authFormProvider);
    final Object? error = submission.error;
    final Failure? failure = error is Failure ? error : null;
    final Map<String, String> serverErrors =
        failure == null ? const <String, String>{} : fieldErrorsOf(failure);
    final bool busy = submission.isLoading;
    final List<FocusNode> focus = focusNodes;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // El error va EN LÍNEA: un ErrorState a pantalla completa borraría lo
        // que el usuario ya escribió.
        if (failure != null) ...<Widget>[
          FormErrorBanner(
            failure: failure,
            onRetry: failure.isRetryable ? onSubmit : null,
          ),
          const SizedBox(height: AppSpacing.lg),
        ],
        AppTextField(
          controller: controllers[0],
          focusNode: focus[0],
          label: 'Nombre completo',
          prefixIcon: Icons.badge_outlined,
          keyboardAppearance: Brightness.light,
          textCapitalization: TextCapitalization.words,
          textInputAction: TextInputAction.next,
          maxLength: 120,
          enabled: !busy,
          errorText: errors[RegisterField.fullName] ??
              serverErrors[RegisterField.fullName],
          onChanged: (_) => onChanged(RegisterField.fullName),
          onSubmitted: (_) => focus[1].requestFocus(),
          semanticLabel: 'Nombre completo',
        ),
        const SizedBox(height: AppSpacing.md),
        AppTextField(
          controller: controllers[1],
          focusNode: focus[1],
          label: 'Correo electrónico',
          hint: 'tucorreo@ejemplo.com',
          prefixIcon: Icons.mail_outline_rounded,
          keyboardAppearance: Brightness.light,
          textInputType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          maxLength: 254,
          enabled: !busy,
          errorText:
              errors[RegisterField.email] ?? serverErrors[RegisterField.email],
          onChanged: (_) => onChanged(RegisterField.email),
          onSubmitted: (_) => focus[2].requestFocus(),
          semanticLabel: 'Correo electrónico',
        ),
        const SizedBox(height: AppSpacing.md),
        AppTextField(
          controller: controllers[2],
          focusNode: focus[2],
          label: 'Teléfono (opcional)',
          hint: '+573001234567',
          helperText: 'Con prefijo del país, sin espacios.',
          prefixIcon: Icons.phone_outlined,
          keyboardAppearance: Brightness.light,
          textInputType: TextInputType.phone,
          textInputAction: TextInputAction.next,
          enabled: !busy,
          errorText: errors[RegisterField.phone] ?? serverErrors[RegisterField.phone],
          onChanged: (_) => onChanged(RegisterField.phone),
          onSubmitted: (_) => focus[3].requestFocus(),
          semanticLabel: 'Teléfono, opcional',
        ),
        const SizedBox(height: AppSpacing.md),
        AppTextField(
          controller: controllers[3],
          focusNode: focus[3],
          label: 'Contraseña',
          helperText: 'Entre 8 y 72 caracteres, con una letra y un número.',
          prefixIcon: Icons.lock_outline_rounded,
          obscureToggle: true,
          keyboardAppearance: Brightness.light,
          textInputAction: TextInputAction.next,
          enabled: !busy,
          errorText:
              errors[RegisterField.password] ?? serverErrors[RegisterField.password],
          onChanged: (_) => onChanged(RegisterField.password),
          onSubmitted: (_) => focus[4].requestFocus(),
          semanticLabel: 'Contraseña',
        ),
        const SizedBox(height: AppSpacing.md),
        AppTextField(
          controller: controllers[4],
          focusNode: focus[4],
          label: 'Repite la contraseña',
          prefixIcon: Icons.lock_reset_rounded,
          obscureToggle: true,
          keyboardAppearance: Brightness.light,
          textInputAction: TextInputAction.done,
          enabled: !busy,
          // Sin error del servidor: el backend no recibe `confirmPassword`.
          errorText: errors[RegisterField.confirmPassword],
          onChanged: (_) => onChanged(RegisterField.confirmPassword),
          onSubmitted: (_) => onSubmit(),
          semanticLabel: 'Repite la contraseña',
        ),
        const SizedBox(height: AppSpacing.lg),
        AppButton(
          label: 'Crear cuenta',
          icon: Icons.person_add_alt_rounded,
          size: AppButtonSize.large,
          isFullWidth: true,
          isLoading: busy,
          onPressed: busy ? null : onSubmit,
          tooltip: 'Crear tu cuenta en Latte Coffee',
        ),
      ],
    );
  }
}
