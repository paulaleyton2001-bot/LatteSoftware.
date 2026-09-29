// Cuerpo de la pantalla "¿olvidaste tu contraseña?".
//
// Va aparte de la página por tamaño y por responsabilidad: aquí viven los campos
// y la confirmación de envío; en `forgot_password_page.dart` viven el marco, la
// navegación y el `AsyncStateBuilder`.
//
// CONTRATO CRÍTICO (API.md §7.1)
// `POST /auth/forgot-password` responde `200` exista o no la cuenta. Ni la
// pantalla ni el repositorio pueden decir "ese correo no está registrado":
// sería un enumerador de correos válidos. Los dos casos muestran el mismo texto.


import 'package:flutter/material.dart';
import '../../../app/theme/app_radii.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/error/failures.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/app_text_field.dart';
import '../../../shared/widgets/ui/form_error_banner.dart';
import './auth_form_controller.dart';

/// Formulario de un solo campo.
class ForgotPasswordForm extends StatelessWidget {
  const ForgotPasswordForm({
    required this.email,
    required this.emailFocus,
    required this.emailError,
    required this.failure,
    required this.busy,
    required this.onChanged,
    required this.onSubmit,
    super.key,
  });

  final TextEditingController email;
  final FocusNode emailFocus;
  final String? emailError;
  final Failure? failure;
  final bool busy;
  final VoidCallback onChanged;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    final Failure? error = failure;
    final Map<String, String> serverErrors =
        error == null ? const <String, String>{} : fieldErrorsOf(error);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // Banner en línea: un ErrorState a pantalla completa borraría el correo
        // que el usuario acaba de escribir.
        if (error != null) ...<Widget>[
          FormErrorBanner(
            failure: error,
            onRetry: error.isRetryable ? onSubmit : null,
          ),
          const SizedBox(height: AppSpacing.lg),
        ],
        AppTextField(
          controller: email,
          focusNode: emailFocus,
          label: 'Correo electrónico',
          hint: 'tucorreo@ejemplo.com',
          prefixIcon: Icons.mail_outline_rounded,
          keyboardAppearance: Brightness.light,
          textInputType: TextInputType.emailAddress,
          textInputAction: TextInputAction.done,
          enabled: !busy,
          errorText: emailError ?? serverErrors['email'],
          onChanged: (_) => onChanged(),
          onSubmitted: (_) => onSubmit(),
          semanticLabel: 'Correo electrónico',
        ),
        const SizedBox(height: AppSpacing.xl),
        AppButton(
          label: 'Enviar enlace',
          icon: Icons.mark_email_read_outlined,
          size: AppButtonSize.large,
          isFullWidth: true,
          isLoading: busy,
          onPressed: busy ? null : onSubmit,
          tooltip: 'Enviar el enlace de restablecimiento',
        ),
      ],
    );
  }
}

/// Confirmación de envío. Texto idéntico exista o no la cuenta.
class SentConfirmation extends StatelessWidget {
  const SentConfirmation({required this.email, required this.onResend, super.key});

  final String email;
  final VoidCallback onResend;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Container(
            padding: const EdgeInsets.all(AppSpacing.lg),
            decoration: BoxDecoration(
              color: context.tokens.surfaceSuccessSubtle,
              borderRadius: BorderRadius.circular(AppRadii.md),
              border: Border.all(color: context.tokens.stateSuccess),
            ),
            child: Column(
              children: <Widget>[
                Icon(
                  Icons.mark_email_read_outlined,
                  size: 32,
                  color: context.tokens.textSuccess,
                ),
                const SizedBox(height: AppSpacing.md),
                Text(
                  'Revisa tu correo',
                  style:
                      AppTextStyles.titleMedium.copyWith(color: context.tokens.textSuccess),
                ),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  'Si $email tiene una cuenta, le enviamos un enlace para '
                  'restablecer la contraseña. El enlace vence en 30 minutos.',
                  textAlign: TextAlign.center,
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textSuccess),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          AppButton(
            label: 'Reenviar enlace',
            variant: AppButtonVariant.secondary,
            size: AppButtonSize.large,
            isFullWidth: true,
            icon: Icons.refresh_rounded,
            onPressed: onResend,
            tooltip: 'Volver a enviar el enlace de restablecimiento',
          ),
        ],
      ),
    );
  }
}
