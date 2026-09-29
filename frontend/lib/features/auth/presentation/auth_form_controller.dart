// Controlador del envío de formularios de autenticación.
//
// SEPARACIÓN DE RESPONSABILIDADES
// -------------------------------
// `AuthController` es el dueño del ESTADO DE SESIÓN; este controlador es el
// dueño del ESTADO DE ENVÍO. La razón es de UX: si el login publicara su propio
// estado de carga en `AuthState`, la pantalla de login desaparecería (o
// parpadearía a pantalla completa) mientras espera al servidor y el usuario
// perdería lo que llevaba escrito.
//
// Aquí el `AsyncValue<AuthResult>` significa:
//   loading  → el botón se pone en carga, el formulario sigue visible
//   error    → banner inline con el mensaje del `Failure`
//   data     → mensaje de confirmación (o el router ya redirigió)
//
// El estado de sesión se actualiza llamando a `AuthController` (`adopt` /
// `reportFailure`), de modo que sigue habiendo una sola verdad.



import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../domain/entities/auth_credentials.dart';
import '../../../domain/entities/auth_result.dart';
import '../../../domain/entities/auth_session.dart';
import './auth_controller.dart';

/// Estado de envío del formulario de autenticación activo.
final AsyncNotifierProvider<AuthFormController, AuthResult> authFormProvider =
    AsyncNotifierProvider<AuthFormController, AuthResult>(AuthFormController.new);

/// Controlador de envío del formulario de autenticación.
class AuthFormController extends AsyncNotifier<AuthResult> {
  @override
  FutureOr<AuthResult> build() => const AuthResult.idle();

  /// `POST /auth/login`.
  Future<void> submitLogin({
    required String email,
    required String password,
  }) async {
    state = const AsyncLoading<AuthResult>();
    final Result<AuthSession> result = await ref
        .read(authRepositoryProvider)
        .login(LoginRequest(email: email.trim(), password: password));
    _settleSession(result);
  }

  /// `POST /auth/register`. El usuario nuevo entra con sesión ya iniciada.
  Future<void> submitRegister(RegisterRequest request) async {
    state = const AsyncLoading<AuthResult>();
    final Result<AuthSession> result =
        await ref.read(authRepositoryProvider).register(request);
    _settleSession(result);
  }

  /// `POST /auth/forgot-password`. Siempre `200`: el mensaje es genérico a
  /// propósito, el backend no revela si el correo está registrado.
  Future<void> submitForgotPassword(String email) async {
    state = const AsyncLoading<AuthResult>();
    final Result<AuthResult> result = await ref
        .read(authRepositoryProvider)
        .forgotPassword(ForgotPasswordRequest(email: email.trim()));
    _settlePlain(result);
  }

  /// `POST /auth/reset-password`. En éxito, el backend revoca todas las
  /// sesiones, así que la sesión local ya quedó borrada y toca volver al login.
  Future<void> submitResetPassword({
    required String token,
    required String password,
    required String confirmPassword,
  }) async {
    state = const AsyncLoading<AuthResult>();
    final Result<AuthResult> result =
        await ref.read(authRepositoryProvider).resetPassword(
              ResetPasswordRequest(
                token: token,
                password: password,
                confirmPassword: confirmPassword,
              ),
            );
    _settlePlain(result);
  }

  /// Limpia el estado del formulario (al salir de la pantalla).
  void reset() => state = AsyncData<AuthResult>(const AuthResult.idle());

  // ----------------------------------------------------------------- Privados
  /// Login/registro: publica la sesión o el fallo en `AuthController`.
  void _settleSession(Result<AuthSession> result) {
    switch (result) {
      case Success<AuthSession>(:final AuthSession value):
        state = const AsyncData<AuthResult>(AuthResult.idle());
        ref.read(authControllerProvider.notifier).adopt(value);
      case FailureResult<AuthSession>(:final Failure failure):
        state = AsyncError<AuthResult>(failure, StackTrace.current);
        ref.read(authControllerProvider.notifier).reportFailure(failure);
    }
  }

  /// Operaciones sin sesión (`forgot`, `reset`): solo estado de envío.
  void _settlePlain(Result<AuthResult> result) {
    state = switch (result) {
      Success<AuthResult>(:final AuthResult value) => AsyncData<AuthResult>(value),
      FailureResult<AuthResult>(:final Failure failure) =>
        AsyncError<AuthResult>(failure, StackTrace.current),
    };
  }
}

/// Errores de validación por campo aplanados a `{ campo: mensaje }`.
///
/// `ValidationFailure.fieldErrors` trae `{ path, message }` del backend; esta
/// función lo aplana para que `AppTextField.errorText` no conozca la API. La
/// clave pública es la que espera el formulario (`email`, `password`, ...).
Map<String, String> fieldErrorsOf(Failure failure) {
  if (failure is! ValidationFailure) return const <String, String>{};
  final Map<String, String> result = <String, String>{};
  for (final FieldError error in failure.fieldErrors) {
    result[error.path] = error.message;
  }
  return result;
}
