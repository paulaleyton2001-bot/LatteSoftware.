// Pantalla de registro (alta de cuenta de cliente).
//
// El backend asigna el rol `CUSTOMER` y `isStaff = false` a quien se registra
// aquí (API.md §7.1). Los permisos de empleado se dan desde administración, no
// desde un formulario público: por eso esta pantalla NO tiene selector de rol.
//
// Estados: los mismos del login, con `AsyncStateBuilder` como orquestador y
// `FormErrorBanner` para el error de envío (no se borra lo escrito).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/routes.dart';
import '../../../core/utils/validators.dart';
import '../../../domain/entities/auth_credentials.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import 'auth_controller.dart';
import 'auth_form_controller.dart';
import 'auth_state.dart';
import 'register_form.dart';
import 'widgets/auth_footer_link.dart';
import 'widgets/auth_scaffold.dart';

/// Pantalla de alta de cuenta.
class RegisterPage extends ConsumerStatefulWidget {
  const RegisterPage({super.key});

  @override
  ConsumerState<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends ConsumerState<RegisterPage> {
  /// Orden fijo, el mismo que espera `RegisterForm.controllers`.
  final List<TextEditingController> _controllers = <TextEditingController>[
    TextEditingController(), // nombre
    TextEditingController(), // correo
    TextEditingController(), // teléfono
    TextEditingController(), // contraseña
    TextEditingController(), // confirmar contraseña
  ];

  final List<FocusNode> _focusNodes = <FocusNode>[
    FocusNode(),
    FocusNode(),
    FocusNode(),
    FocusNode(),
    FocusNode(),
  ];

  /// Errores de validación en cliente, por campo. El backend se pinta encima.
  final Map<String, String> _errors = <String, String>{};

  @override
  void initState() {
    super.initState();
    // Limpia el resultado del intento anterior al volver desde el login o desde
    // "¿olvidaste tu contraseña?".
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) ref.read(authFormProvider.notifier).reset();
    });
  }

  @override
  void dispose() {
    for (final TextEditingController controller in _controllers) {
      controller.dispose();
    }
    for (final FocusNode node in _focusNodes) {
      node.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    final String fullName = _controllers[0].text.trim();
    final String email = _controllers[1].text.trim();
    final String phone = _controllers[2].text.trim();
    final String password = _controllers[3].text;
    final String confirm = _controllers[4].text;

    final Map<String, String> errors = <String, String>{
      if (Validators.minLength(fullName, min: 2, field: 'El nombre') case
          final String nameError)
        RegisterField.fullName: nameError,
      if (Validators.email(email) case final String emailError)
        RegisterField.email: emailError,
      if (Validators.phoneE164(phone) case final String phoneError)
        RegisterField.phone: phoneError,
      if (Validators.password(password) case final String passwordError)
        RegisterField.password: passwordError,
      // La coincidencia se valida SOLO en cliente: `POST /auth/register` no
      // recibe `confirmPassword` (API.md §7.1).
      if (Validators.passwordConfirmation(confirm, password)
          case final String confirmError)
        RegisterField.confirmPassword: confirmError,
    };

    setState(() {
      _errors
        ..clear()
        ..addAll(errors);
    });
    if (errors.isNotEmpty) {
      _focusNodes[_indexOfFirstError(errors)].requestFocus();
      return;
    }

    FocusScope.of(context).unfocus();
    await ref.read(authFormProvider.notifier).submitRegister(
          RegisterRequest(
            email: email,
            password: password,
            fullName: fullName,
            phone: phone,
          ),
        );
    // El destino lo decide el `redirect` global: al publicarse la sesión, el
    // router lleva a `/home` (o al `?redirect=` de la petición original).
  }

  /// Índice del primer campo con error, para moverle el foco.
  int _indexOfFirstError(Map<String, String> errors) {
    const List<String> order = <String>[
      RegisterField.fullName,
      RegisterField.email,
      RegisterField.phone,
      RegisterField.password,
      RegisterField.confirmPassword,
    ];
    for (int i = 0; i < order.length; i++) {
      if (errors.containsKey(order[i])) return i;
    }
    return 0;
  }

  /// Limpia el error en cliente del campo editado, y solo reconstruye si había.
  void _onChanged(String field) {
    if (_errors.remove(field) == null) return;
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AuthState> session = ref.watch(authSessionAsyncProvider);

    return AuthScaffold(
      title: 'Crear cuenta',
      subtitle: 'Regístrate para pedir, reservar y registrarte en una mesa.',
      showBackButton: true,
      onBack: () => context.goNamed(RouteNames.login),
      footer: AuthFooterLink(
        question: '¿Ya tienes cuenta?',
        actionLabel: 'Iniciar sesión',
        icon: Icons.login_rounded,
        onTap: () => context.goNamed(RouteNames.login),
      ),
      child: AsyncStateBuilder<AuthState>(
        value: session,
        loadingMessage: 'Preparando el formulario…',
        onRetry: () => ref.read(authControllerProvider.notifier).retryBootstrap(),
        builder: (BuildContext context, AuthState state) => RegisterForm(
          controllers: _controllers,
          focusNodes: _focusNodes,
          errors: _errors,
          onChanged: _onChanged,
          onSubmit: _submit,
        ),
      ),
    );
  }
}
