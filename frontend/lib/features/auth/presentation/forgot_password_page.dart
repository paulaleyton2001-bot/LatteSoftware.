// Pantalla "¿olvidaste tu contraseña?".
//
// Estados: `AsyncStateBuilder` como orquestador (arranque, sin red, fallo) y,
// una vez lista, el formulario o la confirmación de envío según el estado de
// `authFormProvider`. El error de envío va en banner EN LÍNEA
// (`FormErrorBanner`), porque un `ErrorState` a pantalla completa borraría el
// correo recién escrito.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/routes.dart';
import '../../../core/error/failures.dart';
import '../../../core/utils/validators.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import 'auth_controller.dart';
import 'auth_form_controller.dart';
import 'auth_state.dart';
import 'forgot_password_form.dart';
import 'widgets/auth_footer_link.dart';
import 'widgets/auth_scaffold.dart';

/// Solicitud del enlace de restablecimiento.
class ForgotPasswordPage extends ConsumerStatefulWidget {
  const ForgotPasswordPage({super.key});

  @override
  ConsumerState<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends ConsumerState<ForgotPasswordPage> {
  final TextEditingController _email = TextEditingController();
  final FocusNode _emailFocus = FocusNode();
  String? _emailError;

  @override
  void initState() {
    super.initState();
    // Al volver del enlace de restablecimiento no debe quedar la confirmación
    // del envío anterior.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(authFormProvider.notifier).reset();
    });
  }

  @override
  void dispose() {
    _email.dispose();
    _emailFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String? error = Validators.email(_email.text);
    setState(() => _emailError = error);
    if (error != null) {
      _emailFocus.requestFocus();
      return;
    }
    FocusScope.of(context).unfocus();
    await ref.read(authFormProvider.notifier).submitForgotPassword(_email.text);
  }

  void _clearError() {
    if (_emailError == null) return;
    setState(() => _emailError = null);
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AuthState> session = ref.watch(authSessionAsyncProvider);
    final submission = ref.watch(authFormProvider);
    final Object? error = submission.error;
    final Failure? failure = error is Failure ? error : null;
    final bool sent =
        submission.hasValue && submission.valueOrNull?.isSuccess == true;

    return AuthScaffold(
      title: 'Recuperar contraseña',
      subtitle: 'Escribe tu correo y te enviamos un enlace para crear una '
          'contraseña nueva.',
      showBackButton: true,
      onBack: () => context.goNamed(RouteNames.login),
      footer: AuthFooterLink(
        question: '¿Recordaste tu contraseña?',
        actionLabel: 'Volver a iniciar sesión',
        icon: Icons.login_rounded,
        onTap: () => context.goNamed(RouteNames.login),
      ),
      child: AsyncStateBuilder<AuthState>(
        value: session,
        loadingMessage: 'Comprobando tu sesión…',
        onRetry: () => ref.read(authControllerProvider.notifier).retryBootstrap(),
        builder: (BuildContext context, AuthState state) => sent
            ? SentConfirmation(email: _email.text.trim(), onResend: _submit)
            : ForgotPasswordForm(
                email: _email,
                emailFocus: _emailFocus,
                emailError: _emailError,
                failure: failure,
                busy: submission.isLoading,
                onChanged: _clearError,
                onSubmit: _submit,
              ),
      ),
    );
  }
}
