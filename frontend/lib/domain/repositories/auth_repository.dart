// Contrato de autenticación. Es la frontera entre `features/auth` y la red.
//
// Todas las firmas devuelven `Future<Result<T>>` y NUNCA lanzan: el
// `DioException` se traduce a `Failure` dentro de la implementación
// (`data/repositories/auth_repository_impl.dart`). La UI no ve excepciones.

import '../../core/result/result.dart';
import '../entities/auth_credentials.dart';
import '../entities/auth_result.dart';
import '../entities/auth_session.dart';
import '../entities/user.dart';

/// Operaciones de `docs/API.md` §7.1 (`/api/v1/auth`).
abstract interface class AuthRepository {
  /// `POST /auth/register` — crea la cuenta y devuelve la sesión ya iniciada
  /// (el usuario nuevo recibe el rol `CUSTOMER`, API.md §7.1).
  Future<Result<AuthSession>> register(RegisterRequest request);

  /// `POST /auth/login`.
  Future<Result<AuthSession>> login(LoginRequest request);

  /// `POST /auth/refresh` — rotación explícita del refresh token.
  ///
  /// El interceptor de red ya refresca solo ante un `401` o de forma
  /// proactiva; este método existe para renewing forzado (pantalla de perfil,
  /// "reconectar ahora") y para tests. `null` si no hay sesión almacenada.
  Future<Result<AuthSession>> refresh();

  /// `POST /auth/logout` — revoca la sesión actual. Idempotente.
  Future<Result<AuthResult>> logout();

  /// `POST /auth/logout-all` — revoca todas las sesiones del usuario.
  ///
  /// [currentPassword] es opcional: el backend solo lo exige de verdad cuando
  /// hay más de una sesión.
  Future<Result<AuthResult>> logoutAll({String? currentPassword});

  /// `POST /auth/forgot-password`.
  ///
  /// Siempre `200`, exista o no la cuenta (API.md §7.1): el mensaje NO revela
  /// si el correo está registrado.
  Future<Result<AuthResult>> forgotPassword(ForgotPasswordRequest request);

  /// `POST /auth/reset-password`. El token es de un solo uso.
  Future<Result<AuthResult>> resetPassword(ResetPasswordRequest request);

  /// `POST /auth/change-password` — revoca todas las sesiones menos la actual
  /// (`keepCurrentSession`, default `true`).
  Future<Result<AuthResult>> changePassword(ChangePasswordRequest request);

  /// `GET /auth/me` — perfil con `roles[]` y `permissions[]` (BR-RBAC-005).
  Future<Result<User>> me();

  /// `PATCH /auth/me` — perfil propio. Requiere permiso `auth:profile:update`.
  Future<Result<User>> updateMe(UpdateProfileRequest request);

  /// `GET /auth/sessions` — sesiones activas del usuario.
  Future<Result<List<AuthDeviceSession>>> sessions();

  /// `DELETE /auth/sessions/:id` — revoca una sesión propia.
  ///
  /// No se puede revocar la sesión actual: devuelve `422` y hay que usar
  /// [logout] (API.md §7.1).
  Future<Result<AuthResult>> revokeSession(int sessionId);
}
