// Campos del formulario de inicio de sesión.
//
// Va en su propio archivo (y no dentro de `login_page.dart`) por dos motivos:
// el archivo se mantiene por debajo del límite de tamaño, y la validación en
// línea y el banner de error dejan de estar mezclados con la navegación.
//
// El formulario NO navega ni habla con el repositorio: recibe controllers, foco
// y callbacks. El estado de envío llega por `authFormProvider`.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/routes.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../core/error/failures.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_text_field.dart';
import '../../../shared/widgets/ui/form_error_banner.dart';
import 'auth_form_controller.dart';

/// Formulario de login. `ConsumerWidget` puro: sin estado propio.
class LoginForm extends ConsumerWidget {
  const LoginForm({
    required this.email,
    required this.password,
    required this.emailFocus,
    required this.passwordFocus,
    this.emailError,
    this.passwordError,
    required this.onEmailChanged,
    required this.onPasswordChanged,
    required this.onEmailSubmitted,
    required this.onSubmit,
    super.key,
  });

  final TextEditingController email;
  final TextEditingController password;
  final FocusNode emailFocus;
  final FocusNode passwordFocus;

  /// Errores de validación en cliente (feedback inmediato). El backend tiene
  /// prioridad si también trae error para el mismo campo.
  final String? emailError;
  final String? passwordError;

  final VoidCallback onEmailChanged;
  final VoidCallback onPasswordChanged;
  final ValueChanged<String> onEmailSubmitted;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final submission = ref.watch(authFormProvider);
    final Object? error = submission.error;
    final Failure? failure = error is Failure ? error : null;
    final Map<String, String> serverErrors =
        failure == null ? const <String, String>{} : fieldErrorsOf(failure);
    final bool busy = submission.isLoading;

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
          controller: email,
          focusNode: emailFocus,
          label: 'Correo electrónico',
          hint: 'tucorreo@ejemplo.com',
          helperText: 'Es el correo con el que te registraste.',
          prefixIcon: Icons.mail_outline_rounded,
          keyboardAppearance: Brightness.light,
          textInputType: TextInputType.emailAddress,
          textInputAction: TextInputAction.next,
          enabled: !busy,
          errorText: emailError ?? serverErrors['email'],
          onChanged: (_) => onEmailChanged(),
          onSubmitted: onEmailSubmitted,
          semanticLabel: 'Correo electrónico',
        ),
        const SizedBox(height: AppSpacing.lg),
        AppTextField(
          controller: password,
          focusNode: passwordFocus,
          label: 'Contraseña',
          prefixIcon: Icons.lock_outline_rounded,
          obscureToggle: true,
          keyboardAppearance: Brightness.light,
          textInputAction: TextInputAction.done,
          enabled: !busy,
          errorText: passwordError ?? serverErrors['password'],
          onChanged: (_) => onPasswordChanged(),
          onSubmitted: (_) => onSubmit(),
          semanticLabel: 'Contraseña',
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed:
                busy ? null : () => context.goNamed(RouteNames.forgotPassword),
            style: TextButton.styleFrom(minimumSize: const Size(0, 44)),
            child: const Text('¿Olvidaste tu contraseña?'),
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        AppButton(
          label: 'Iniciar sesión',
          icon: Icons.login_rounded,
          size: AppButtonSize.large,
          isFullWidth: true,
          isLoading: busy,
          // El assert de AppButton exige `onPressed: null` mientras carga.
          onPressed: busy ? null : onSubmit,
          tooltip: 'Iniciar sesión con tu cuenta',
        ),
      ],
    );
  }
}
