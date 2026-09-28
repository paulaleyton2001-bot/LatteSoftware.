// Pantalla de inicio de sesión.
//
// ESTADOS (todos pasan por `AsyncStateBuilder`, ninguno con spinner propio):
//   arranque   → `AppSpinner` ("Restaurando tu sesión…")
//   sin red    → `OfflineState` con reintento
//   fallo      → `ErrorState` con reintento
//   listo      → `LoginForm` (el envío y su error los gestiona el formulario)
//   enviado    → el botón pasa a `isLoading`, el formulario sigue visible
//
// DECISIÓN DE UX QUE IMPONE EL DESIGN SYSTEM
// Al enviar, un `ErrorState` a pantalla completa BORRARÍA lo que el usuario
// escribió. Por eso el error de envío va en banner en línea (`FormErrorBanner`)
// y el de arranque —que sí puede ocupar la pantalla— lo resuelve
// `AsyncStateBuilder`. Los dos casos usan el mismo vocabulario visual.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/routes.dart';
import '../../../core/utils/validators.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import 'auth_controller.dart';
import 'auth_form_controller.dart';
import 'auth_state.dart';
import 'login_form.dart';
import 'widgets/auth_footer_link.dart';
import 'widgets/auth_scaffold.dart';

/// Pantalla de inicio de sesión.
class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final FocusNode _emailFocus = FocusNode();
  final FocusNode _passwordFocus = FocusNode();

  String? _emailError;
  String? _passwordError;

  @override
  void initState() {
    super.initState();
    // Si se vuelve desde "¿olvvidaste tu contraseña?", el error del intento
    // anterior no debe seguir en pantalla. En el primer montaje el estado ya
    // es `idle` y el reset no notifica nada (los `AsyncValue` comparan por valor).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(authFormProvider.notifier).reset();
    });
  }

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _emailFocus.dispose();
    _passwordFocus.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    // La validación en cliente es COMODIDAD, no seguridad: la verdad es el
    // `400 VALIDATION_ERROR` del backend, y se pinta aunque el cliente pase.
    final String? emailError = Validators.email(_email.text);
    final String? passwordError = Validators.required(
      _password.text,
      field: 'La contraseña',
    );
    setState(() {
      _emailError = emailError;
      _passwordError = passwordError;
    });
    if (emailError != null) {
      _emailFocus.requestFocus();
      return;
    }
    if (passwordError != null) {
      _passwordFocus.requestFocus();
      return;
    }

    FocusScope.of(context).unfocus();
    await ref
        .read(authFormProvider.notifier)
        .submitLogin(email: _email.text, password: _password.text);
    if (!mounted) return;
    _goToRequestedDestination();
  }

  /// Vuelve a donde el usuario quería llegar (`/login?redirect=/menu`).
  ///
  /// Si no hay destino, el `redirect` global de `app/router.dart` lleva a
  /// `/home` en cuanto el estado pasa a `AuthStateAuthenticated`.
  void _goToRequestedDestination() {
    final String? target =
        GoRouterState.of(context).uri.queryParameters[AppRoutes.redirectParam];
    if (target != null && target.isNotEmpty) {
      context.go(target);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AuthState> session = ref.watch(authSessionAsyncProvider);

    return AuthScaffold(
      title: 'Iniciar sesión',
      subtitle: 'Entra para ver tus pedidos, reservas y alquileres de sillas.',
      footer: AuthFooterLink(
        question: '¿Aún no tienes cuenta?',
        actionLabel: 'Crear cuenta',
        icon: Icons.person_add_alt_rounded,
        onTap: () => context.goNamed(RouteNames.register),
      ),
      child: AsyncStateBuilder<AuthState>(
        value: session,
        loadingMessage: 'Restaurando tu sesión…',
        onRetry: () => ref.read(authControllerProvider.notifier).retryBootstrap(),
        builder: (BuildContext context, AuthState state) => LoginForm(
          email: _email,
          password: _password,
          emailFocus: _emailFocus,
          passwordFocus: _passwordFocus,
          emailError: _emailError,
          passwordError: _passwordError,
          onEmailChanged: _clearEmailError,
          onPasswordChanged: _clearPasswordError,
          onEmailSubmitted: (_) => _passwordFocus.requestFocus(),
          onSubmit: _submit,
        ),
      ),
    );
  }

  void _clearEmailError() {
    if (_emailError == null) return;
    setState(() => _emailError = null);
  }

  void _clearPasswordError() {
    if (_passwordError == null) return;
    setState(() => _passwordError = null);
  }
}
