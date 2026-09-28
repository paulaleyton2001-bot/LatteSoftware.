// Controlador de sesión: única fuente de verdad del estado de autenticación.
//
// RESPONSABILIDADES: (1) bootstrap — restaurar tokens y validarlos con
// `GET /auth/me`; (2) adoptar sesiones nuevas; (3) cerrar sesión y limpiar la
// caché de negocio.
//
// REGLA DE ORO DEL ARRANQUE: un fallo de RED durante el bootstrap NUNCA borra la
// sesión local. El POS arranca en redes de cafetería, y si `GET /auth/me` falla
// por no hay internet el estado es `AuthStateError` (con reintento) y los tokens
// siguen guardados. Solo un `401` real significa "sesión muerta" y sí limpia.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../core/storage/token_storage.dart';
import '../../../domain/entities/auth_result.dart';
import '../../../domain/entities/auth_session.dart';
import '../../../domain/entities/user.dart';
import '../../../domain/repositories/auth_repository.dart';
import 'auth_state.dart';
import 'session_mapper.dart';

/// Provider del estado de sesión. NO es autoDispose a propósito: la sesión
/// sobrevive a la navegación entre pantallas y al cierre de sesión, que es
/// justamente lo que hay que conservar para que el estado sea observable.
final NotifierProvider<AuthController, AuthState> authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);

/// Usuario de la sesión actual (`null` si no hay sesión).
final Provider<User?> currentUserProvider = Provider<User?>(
  (Ref ref) => ref.watch(authControllerProvider).user,
  name: 'currentUser',
);

/// Vista `AsyncValue` del estado, para que las pantallas usen
/// `AsyncStateBuilder` (loading / sin conexión / no autorizado / error) en vez
/// de montar su propio spinner.
final Provider<AsyncValue<AuthState>> authSessionAsyncProvider =
    Provider<AsyncValue<AuthState>>(
  (Ref ref) => ref.watch(authControllerProvider).asAsync,
  name: 'authSessionAsync',
);

/// Controlador de sesión.
class AuthController extends Notifier<AuthState> {
  void Function()? _unsubscribeSessionLost;
  bool _disposed = false;

  @override
  AuthState build() {
    ref.onDispose(() {
      _disposed = true;
      _unsubscribeSessionLost?.call();
      _unsubscribeSessionLost = null;
    });
    _unsubscribeSessionLost =
        ref.read(sessionEventsProvider).subscribe(_onSessionLost);
    unawaited(_bootstrap());
    return const AuthStateUnknown();
  }

  // ---------------------------------------------------------------- Bootstrap
  /// Restaura la sesión guardada y la valida contra el backend.
  Future<void> _bootstrap() async {
    final StoredSession? stored = await ref.read(tokenStorageProvider).read();
    if (_disposed) return;

    if (stored == null) {
      _set(const AuthStateUnauthenticated());
      return;
    }

    // Hay tokens. El perfil cacheado permite pintar de inmediato, pero la
    // autoridad sigue siendo `GET /auth/me`.
    final User? cached = SessionMapper.cachedUser(stored);
    if (cached != null) {
      _set(AuthStateAuthenticated(SessionMapper.fromStorage(stored, cached)));
    }

    final Result<User> profile = await ref.read(authRepositoryProvider).me();
    if (_disposed) return;
    _set(switch (profile) {
      Success<User>(:final User user) =>
        AuthStateAuthenticated(SessionMapper.fromStorage(stored, user)),
      FailureResult<User>(:final Failure failure) => _stateAfterFailure(failure),
    });
  }

  /// Reintenta el arranque tras un [AuthStateError] (botón "Reintentar").
  Future<void> retryBootstrap() async {
    if (_disposed) return;
    _set(const AuthStateUnknown());
    await _bootstrap();
  }

  // ----------------------------------------------------------- Sesión nueva
  /// Adopta una sesión recién creada (login o registro).
  void adopt(AuthSession session) => _set(AuthStateAuthenticated(session));

  /// Publica el fallo conservando el estado anterior: credenciales incorrectas
  /// deben dejar visible el formulario.
  void reportFailure(Failure failure) {
    final AuthStateAuthenticated? current = _authenticated;
    if (current != null) {
      _set(AuthStateAuthenticated(current.session));
      return;
    }
    _set(AuthStateUnauthenticated(failure: failure));
  }

  /// Actualiza el perfil en memoria tras `PATCH /auth/me`.
  void updateUser(User user) {
    final AuthStateAuthenticated? current = _authenticated;
    if (current == null) return;
    _set(AuthStateAuthenticated(current.session.copyWith(user: user)));
  }

  /// `POST /auth/logout`. Termina SIEMPRE en [AuthStateUnauthenticated].
  Future<Result<AuthResult>> logout() async {
    final AuthState previous = state;
    _set(AuthStateLoading(previous, message: 'Cerrando sesión…'));
    final Result<AuthResult> result = await ref.read(authRepositoryProvider).logout();
    if (_disposed) return result;

    // La caché se limpia siempre: en un dispositivo compartido no puede quedar
    // el negocio del usuario anterior visible.
    await ref.read(preferencesStorageProvider).clearBusinessCache();
    _set(const AuthStateUnauthenticated());
    return result;
  }

  /// Renovación forzada del token ("Reconectar ahora").
  Future<Result<AuthSession>> refreshNow() async {
    final AuthStateAuthenticated? current = _authenticated;
    if (current == null) {
      return const FailureResult<AuthSession>(UnauthorizedFailure());
    }
    _set(AuthStateAuthenticated(current.session, isRefreshing: true));
    final Result<AuthSession> result = await ref.read(authRepositoryProvider).refresh();
    if (_disposed) return result;
    _set(switch (result) {
      Success<AuthSession>(:final AuthSession value) => AuthStateAuthenticated(value),
      FailureResult<AuthSession>(:final Failure failure) => _stateAfterFailure(failure),
    });
    return result;
  }

  // ----------------------------------------------------------------- Privados
  /// Traduce el resultado de validar la sesión al estado de la UI.
  AuthState _stateAfterFailure(Failure failure) {
    if (failure.requiresAuth) {
      // 401: sesión muerta. Se limpia y se vuelve al login.
      unawaited(ref.read(tokenStorageProvider).clear());
      return AuthStateUnauthenticated(failure: failure);
    }
    // Fallo transitorio (red, 5xx): se conserva lo que había para no obligar a
    // iniciar sesión en mitad de un turno.
    return AuthStateError(failure, previous: state);
  }

  /// La red avisó de que la sesión se perdió (refresh fallido tras un 401).
  void _onSessionLost() {
    if (_disposed) return;
    unawaited(ref.read(preferencesStorageProvider).clearBusinessCache());
    _set(const AuthStateUnauthenticated(
      failure: UnauthorizedFailure(
        message: 'Tu sesión expiró. Inicia sesión nuevamente.',
      ),
    ));
  }

  AuthStateAuthenticated? get _authenticated {
    final AuthState current = state;
    return current is AuthStateAuthenticated ? current : null;
  }

  void _set(AuthState next) {
    if (_disposed) return;
    state = next;
  }
}
