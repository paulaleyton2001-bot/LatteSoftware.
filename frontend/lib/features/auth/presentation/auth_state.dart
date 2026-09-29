// Estados de sesión. Jerarquía sellada: los `switch` son exhaustivos.
//
// Los CINCO estados que la UI necesita cubrir (API.md §2):
//
//   AuthStateUnknown          arrancando: aún no sabemos si hay sesión
//   AuthStateLoading          login/registro/logout en curso
//   AuthStateUnauthenticated  no hay sesión utilizable
//   AuthStateAuthenticated    sesión activa
//   AuthStateError            la sesión local existe, pero no se pudo validar
//
// `Loading` y `Error` son variantes DE VERDAD (y no estados de `AsyncValue`)
// porque la app necesita distinguir "arrancando" de "operando sobre una sesión
// existente": durante un arranque sin red NO se puede borrar la sesión local ni
// dejar al cajero con un token que el servidor ya no acepta.
//
// `Loading` y `Error` conservan el estado previo y un mensaje porque las
// pantallas los usan para mantener lo que ya está en pantalla (el formulario, el
// perfil) en vez de sustituirlo por un spinner a pantalla completa.



import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../domain/entities/auth_session.dart';
import '../../../domain/entities/user.dart';

/// Estado de la sesión, exhaustivo y sellado.
@immutable
sealed class AuthState {
  const AuthState();

  /// `true` si hay una sesión utilizable.
  bool get isAuthenticated => this is AuthStateAuthenticated;

  /// `true` mientras se decide si hay sesión (primera carga de la app).
  bool get isResolving => this is AuthStateUnknown;
}

/// La app arrancó y todavía no ha podido decidir si hay sesión.
final class AuthStateUnknown extends AuthState {
  const AuthStateUnknown();
}

/// Operación de autenticación en curso.
final class AuthStateLoading extends AuthState {
  const AuthStateLoading(this.previous, {this.message});

  /// Estado sobre el que se está operando, para que la UI pueda mantenerlo.
  final AuthState previous;

  /// Texto del progreso ("Cerrando sesión…"), opcional.
  final String? message;
}

/// No hay sesión utilizable. [failure] explica por qué, si se sabe
/// (credenciales incorrectas, cuenta bloqueada, sesión expirada…).
final class AuthStateUnauthenticated extends AuthState {
  const AuthStateUnauthenticated({this.failure});

  final Failure? failure;
}

/// Sesión activa.
final class AuthStateAuthenticated extends AuthState {
  const AuthStateAuthenticated(this.session, {this.isRefreshing = false});

  final AuthSession session;

  /// `true` mientras se rota el token: los datos siguen siendo válidos y la UI
  /// no debe bloquearse.
  final bool isRefreshing;
}

/// El arranque no pudo completarse y la app no sabe si hay sesión válida.
///
/// Se diferencia de [AuthStateUnauthenticated] a propósito: aquí se CONSERVA la
/// sesión local y se ofrece reintentar. Confundir los dos casos empuja al
/// usuario a hacer login de nuevo porque el POS perdió Wi-Fi un segundo.
final class AuthStateError extends AuthState {
  const AuthStateError(this.failure, {this.previous});

  final Failure failure;

  /// Estado previo, al que se puede volver si el reintento funciona.
  final AuthState? previous;
}

/// Lecturas derivadas del estado. Centralizadas para que ninguna pantalla tenga
/// que hacer el `switch` a mano.
extension AuthStateView on AuthState {
  /// Sesión activa, o `null`.
  AuthSession? get session => switch (this) {
        AuthStateAuthenticated(:final AuthSession session) => session,
        _ => null,
      };

  /// Actor autenticado, o `null`.
  User? get user => session?.user;

  /// Fallo asociado al estado, si lo hay.
  ///
  /// En un patrón de objeto, `(:final T nombre)` busca el GETTER `nombre` en la
  /// clase, no declara una variable libre. Por eso los dos `switch` nombran el
  /// campo real (`failure`) en vez de usar una abreviatura.
  Failure? get failure => switch (this) {
        AuthStateUnauthenticated(failure: final Failure? reason) => reason,
        AuthStateError(failure: final Failure reason) => reason,
        _ => null,
      };

  /// Proyección a `AsyncValue` para que `AsyncStateBuilder` sea el orquestador
  /// de la pantalla: así loading, sin conexión, no autorizado y error se
  /// resuelven con los widgets del design system en lugar de a mano.
  AsyncValue<AuthState> get asAsync => switch (this) {
        AuthStateUnknown() || AuthStateLoading() => const AsyncLoading<AuthState>(),
        AuthStateError(failure: final Failure reason) =>
          AsyncError<AuthState>(reason, StackTrace.current),
        AuthStateUnauthenticated() || AuthStateAuthenticated() => AsyncData<AuthState>(this),
      };
}
