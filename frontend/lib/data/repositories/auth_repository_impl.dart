// Implementación de `AuthRepository`.
//
// REGLA DE ORO: NINGÚN método lanza. Todo va en `Result<T>`: `DioException` →
// `ErrorMapper`, `FormatException` (2xx inservible) → `UnknownFailure`, resto →
// `UnknownFailure`. Esta capa centraliza tres efectos: persistir/borrar tokens
// (`AuthSessionStore`), traducir códigos de auth al vocabulario de la app y NO
// limpiar la sesión ante un error de red (sin red no sabemos si sigue viva, y
// borrarla cerraría el turno del POS sin motivo).

import '../../core/error/failures.dart';
import '../../core/network/api_exception.dart';
import '../../core/result/result.dart';
import '../../core/storage/token_storage.dart';
import '../../domain/entities/auth_credentials.dart';
import '../../domain/entities/auth_result.dart';
import '../../domain/entities/auth_session.dart';
import '../../domain/entities/user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/remote/auth_remote_datasource.dart';
import '../models/auth_dto.dart';
import '../models/user_dto.dart';
import 'auth_failure_localizer.dart';
import 'auth_session_store.dart';

/// Repositorio de autenticación sobre el datasource remoto.
class AuthRepositoryImpl implements AuthRepository {
  const AuthRepositoryImpl(this._remote, this._storage, this._sessions);

  final AuthRemoteDataSource _remote;
  final TokenStorage _storage;
  final AuthSessionStore _sessions;

  // ------------------------------------------------------------ Login / alta
  @override
  Future<Result<AuthSession>> login(LoginRequest request) =>
      _guard(() async => _persist(await _remote.login(request)));
  @override
  Future<Result<AuthSession>> register(RegisterRequest request) =>
      _guard(() async => _persist(await _remote.register(request)));

  /// Renovación explícita. El interceptor ya refresca solo; esto es para el
  /// renewing forzado y para tests.
  @override
  Future<Result<AuthSession>> refresh() => _guard(() async {
        final StoredSession? stored = await _sessions.read();
        if (stored == null) {
          return _fail(const UnauthorizedFailure(
            message: 'No hay sesión iniciada en este dispositivo.',
          ));
        }
        final RefreshResultDto rotated =
            await _remote.refresh(stored.refreshToken);
        // El refresh NO devuelve perfil (§7.1): sin actor no hay sesión.
        final User user =
            _sessions.cachedUser(stored) ?? (await _remote.me()).toEntity();
        final AuthSession session = rotated.applyTo(
          AuthSessionStore.fromStorage(stored, user),
        );
        await _sessions.save(session);
        return Success<AuthSession>(session);
      });
  @override
  Future<Result<AuthResult>> logout() => _guard(() async {
        try {
          await _remote.logout();
        } on Object {
          // Idempotente (§7.1): si falla la red, la sesión local se limpia
          // igual. Pidió salir, no "salir si hay red".
        }
        await _sessions.clear();
        return const Success<AuthResult>(AuthResult(message: 'Sesión cerrada.'));
      });

  @override
  Future<Result<AuthResult>> logoutAll({String? currentPassword}) =>
      _guard(() async {
        String message = 'Sesiones cerradas.';
        try {
          await _remote.logoutAll(currentPassword: currentPassword);
        } on Object {
          message = 'Sesiones cerradas en este dispositivo.';
        }
        await _sessions.clear();
        return Success<AuthResult>(AuthResult(message: message));
      });
  // ------------------------------------------------- Recuperación de clave
  @override
  Future<Result<AuthResult>> forgotPassword(ForgotPasswordRequest req) =>
      _guard(() async {
        await _remote.forgotPassword(req);
        // El backend responde 200 exista o no la cuenta: el mensaje NO revela si
        // el correo está registrado, ni aquí ni en ninguna otra parte.
        return const Success<AuthResult>(AuthResult(
          message: 'Si la cuenta existe, te enviamos el enlace por correo.',
        ));
      });
  @override
  Future<Result<AuthResult>> resetPassword(ResetPasswordRequest request) =>
      _guard(() async {
        // El reset revoca TODAS las sesiones, incluida la de este dispositivo.
        final int revoked = await _remote.resetPassword(request);
        await _sessions.clear();
        return Success<AuthResult>(AuthResult(
          message: revoked > 0
              ? 'Contraseña actualizada. Cerramos $revoked sesión'
                  '${revoked == 1 ? '' : 'es'} por seguridad.'
              : 'Contraseña actualizada. Vuelve a iniciar sesión.',
        ));
      });
  @override
  Future<Result<AuthResult>> changePassword(ChangePasswordRequest req) =>
      _guard(() async {
        final int revoked = await _remote.changePassword(req);
        return Success<AuthResult>(AuthResult(
          message: revoked > 0
              ? 'Contraseña actualizada. Cerramos las otras $revoked sesión'
                  '${revoked == 1 ? '' : 'es'}.'
              : 'Contraseña actualizada.',
        ));
      });

  // ----------------------------------------------------------------- Perfil
  @override
  Future<Result<User>> me() => _guard(() async {
        final User user = (await _remote.me()).toEntity();
        await _sessions.saveUser(user);
        return Success<User>(user);
      });

  @override
  Future<Result<User>> updateMe(UpdateProfileRequest request) => _guard(() async {
        final User user = (await _remote.updateMe(request)).toEntity();
        await _sessions.saveUser(user);
        return Success<User>(user);
      });

  // ------------------------------------------------------- Sesiones activas
  @override
  Future<Result<List<AuthDeviceSession>>> sessions() => _guard(() async {
        final List<AuthDeviceSession> list = (await _remote.sessions())
            .map((AuthDeviceSessionDto dto) => dto.toEntity())
            .toList(growable: false);
        return Success<List<AuthDeviceSession>>(list);
      });

  @override
  Future<Result<AuthResult>> revokeSession(int sessionId) => _guard(() async {
        await _remote.revokeSession(sessionId);
        return const Success<AuthResult>(AuthResult(message: 'Sesión revocada.'));
      });

  // ----------------------------------------------------------------- Privados
  /// Ejecuta [action]; cualquier excepción sale como `FailureResult`.
  Future<Result<T>> _guard<T>(Future<Result<T>> Function() action) async {
    try {
      return await action();
    } on Object catch (error) {
      return _fail(localizeAuthFailure(ApiException.toFailure(error)));
    }
  }

  Result<T> _fail<T>(Failure failure) => FailureResult<T>(failure);

  /// Guarda tokens + perfil y devuelve la entidad de sesión.
  ///
  /// `toEntity()` devuelve `null` si el DTO no trajo `user`: en ese caso hay
  /// tokens pero no actor, y una sesión sin actor no es una sesión.
  Future<Result<AuthSession>> _persist(AuthSessionDto dto) async {
    final AuthSession? session = dto.toEntity();
    if (session == null) {
      return _fail(const UnknownFailure(
        message: 'Iniciamos sesión, pero el servidor no devolvió tu perfil.',
      ));
    }
    await _sessions.save(session);
    return Success<AuthSession>(session);
  }
}
