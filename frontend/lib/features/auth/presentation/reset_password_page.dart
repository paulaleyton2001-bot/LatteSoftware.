// Pantalla de restablecimiento de contraseña.
//
// LLEGA POR ENLACE: `DESIGN.md` §11.8 construye el link como
// `<base>/reset-password?token=...`, así que el token viaja en query param y es
// de UN SOLO USO con 30 minutos de vida.
//
// ESTADOS: sin token → mensaje accionable (un formulario sin token siempre
// fallaría); arranque → `AsyncStateBuilder`; enviado → botón en carga con el
// formulario visible; error → `FormErrorBanner` en línea; éxito → confirmación
// con salida al login. Tras el reseteo el backend revoca TODAS las sesiones,
// incluida la de este dispositivo, así que el repositorio ya borró la sesión
// local: toca login.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/routes.dart';
import '../../../core/error/failures.dart';
import '../../../core/utils/validators.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/empty_state.dart';
import 'auth_controller.dart';
import 'auth_form_controller.dart';
import 'auth_state.dart';
import 'reset_password_form.dart';
import 'widgets/auth_footer_link.dart';
import 'widgets/auth_scaffold.dart';

/// Formulario para aplicar un token de restablecimiento.
class ResetPasswordPage extends ConsumerStatefulWidget {
  const ResetPasswordPage({this.token, super.key});

  /// Token del enlace. `null` = se leyó del query param y no vino.
  final String? token;

  @override
  ConsumerState<ResetPasswordPage> createState() => _ResetPasswordPageState();
}

class _ResetPasswordPageState extends ConsumerState<ResetPasswordPage> {
  final TextEditingController _password = TextEditingController();
  final TextEditingController _confirm = TextEditingController();
  final FocusNode _passwordFocus = FocusNode();
  final FocusNode _confirmFocus = FocusNode();
  final Map<String, String> _errors = <String, String>{};

  @override
  void dispose() {
    _password.dispose();
    _confirm.dispose();
    _passwordFocus.dispose();
    _confirmFocus.dispose();
    super.dispose();
  }

  /// Token del enlace: constructor > query param > `state.extra`. Se aceptan los
  /// tres porque el enlace puede venir de un correo (`?token=`) o de una
  /// redirección nativa (`extra`).
  String? get _token {
    final String? explicit = widget.token;
    if (explicit != null && explicit.isNotEmpty) return explicit;
    final GoRouterState state = GoRouterState.of(context);
    final String? fromQuery = state.uri.queryParameters['token'];
    if (fromQuery != null && fromQuery.isNotEmpty) return fromQuery;
    final Object? extra = state.extra;
    return extra is String && extra.isNotEmpty ? extra : null;
  }

  Future<void> _submit() async {
    final String password = _password.text;
    final Map<String, String> errors = <String, String>{
      if (Validators.password(password) case final String passwordError)
        ResetField.password: passwordError,
      if (Validators.passwordConfirmation(_confirm.text, password)
          case final String confirmError)
        ResetField.confirmPassword: confirmError,
    };
    setState(() {
      _errors
        ..clear()
        ..addAll(errors);
    });
    if (errors.containsKey(ResetField.password)) {
      _passwordFocus.requestFocus();
      return;
    }
    if (errors.containsKey(ResetField.confirmPassword)) {
      _confirmFocus.requestFocus();
      return;
    }

    FocusScope.of(context).unfocus();
    await ref.read(authFormProvider.notifier).submitResetPassword(
          token: _token ?? '',
          password: password,
          confirmPassword: _confirm.text,
        );
  }

  void _onChanged(String field) {
    if (_errors.remove(field) == null) return;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AuthState> session = ref.watch(authSessionAsyncProvider);
    final submission = ref.watch(authFormProvider);
    final Object? error = submission.error;
    final Failure? failure = error is Failure ? error : null;
    final bool done =
        submission.hasValue && submission.valueOrNull?.isSuccess == true;

    return AuthScaffold(
      title: 'Nueva contraseña',
      subtitle: 'Elige una contraseña nueva para tu cuenta de Latte Coffee.',
      showBrand: false,
      showBackButton: true,
      onBack: () => context.goNamed(RouteNames.login),
      footer: AuthFooterLink(
        question: '¿Te arrepentiste?',
        actionLabel: 'Volver a iniciar sesión',
        icon: Icons.login_rounded,
        onTap: () => context.goNamed(RouteNames.login),
      ),
      child: AsyncStateBuilder<AuthState>(
        value: session,
        loadingMessage: 'Comprobando tu sesión…',
        onRetry: () => ref.read(authControllerProvider.notifier).retryBootstrap(),
        builder: (BuildContext context, AuthState state) => _body(
          context: context,
          done: done,
          message: submission.valueOrNull?.message,
          failure: failure,
          busy: submission.isLoading,
        ),
      ),
    );
  }

  /// Los tres desenlaces: sin token, ya aplicado, o formulario.
  Widget _body({
    required BuildContext context,
    required bool done,
    required String? message,
    required Failure? failure,
    required bool busy,
  }) {
    if (_token == null) {
      return EmptyState(
        icon: Icons.link_off_rounded,
        title: 'El enlace no es válido',
        message: 'Este enlace de restablecimiento está incompleto. Pide uno '
            'nuevo desde la pantalla de inicio de sesión.',
        actionLabel: 'Pedir un enlace nuevo',
        onAction: () => context.goNamed(RouteNames.forgotPassword),
      );
    }
    if (done) {
      return EmptyState(
        icon: Icons.check_circle_rounded,
        title: 'Contraseña actualizada',
        message: message ?? 'Ya puedes iniciar sesión con tu contraseña nueva.',
        actionLabel: 'Iniciar sesión',
        onAction: () => context.goNamed(RouteNames.login),
      );
    }
    return ResetPasswordForm(
      password: _password,
      confirm: _confirm,
      passwordFocus: _passwordFocus,
      confirmFocus: _confirmFocus,
      errors: _errors,
      failure: failure,
      busy: busy,
      onChanged: _onChanged,
      onSubmit: _submit,
    );
  }
}
