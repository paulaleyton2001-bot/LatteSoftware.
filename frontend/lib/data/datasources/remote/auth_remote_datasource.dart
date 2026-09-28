// Datasource remoto de autenticación: los 12 endpoints de `docs/API.md` §7.1.
//
// Este archivo es el ÚNICO que conoce rutas y cuerpos JSON. No conoce `Failure`,
// ni `Result`, ni entidades de dominio: devuelve DTOs y deja que la excepción de
// `dio` suba hasta `data/repositories/auth_repository_impl.dart`, que la mapea.
// Esa separación es lo que permite testear el mapeo sin red.
//
// `Dio` ya lanza `DioException` en cualquier `4xx`/`5xx`, así que aquí no hay
// try/catch: añadirlo escondería el código de error del backend.

import 'package:dio/dio.dart';

import '../../../core/network/api_client.dart';
import '../../../core/network/api_endpoints.dart';
import '../../../domain/entities/auth_credentials.dart';
import '../../models/auth_dto.dart';
import '../../models/json_reader.dart';
import '../../models/user_dto.dart';

/// Llamadas HTTP a `/api/v1/auth`.
class AuthRemoteDataSource {
  const AuthRemoteDataSource(this._dio);

  final Dio _dio;

  /// `POST /auth/register` → `201`.
  Future<AuthSessionDto> register(RegisterRequest request) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.authRegister,
      data: request.toJson(),
    );
    return _requireSession(response.data, ApiEndpoints.authRegister);
  }

  /// `POST /auth/login` → `200`.
  Future<AuthSessionDto> login(LoginRequest request) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.authLogin,
      data: request.toJson(),
    );
    return _requireSession(response.data, ApiEndpoints.authLogin);
  }

  /// `POST /auth/refresh` → `200` (rotación).
  Future<RefreshResultDto> refresh(String refreshToken) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.authRefresh,
      data: <String, dynamic>{'refreshToken': refreshToken},
    );
    final RefreshResultDto? dto = RefreshResultDto.fromJson(unwrapData(response.data));
    if (dto == null) {
      throw _malformed(ApiEndpoints.authRefresh);
    }
    return dto;
  }

  /// `POST /auth/logout` → `200` con `data: null` (idempotente).
  Future<void> logout() async {
    await _dio.post<dynamic>(ApiEndpoints.authLogout);
  }

  /// `POST /auth/logout-all` → `200` con `meta.revokedSessions`.
  Future<int> logoutAll({String? currentPassword}) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.authLogoutAll,
      data: <String, dynamic>{
        if (currentPassword != null && currentPassword.isNotEmpty)
          'currentPassword': currentPassword,
      },
    );
    return JsonReader.integerOr(_metaOf(response.data)['revokedSessions'], 0);
  }

  /// `POST /auth/forgot-password` → `200` siempre (no revela existencia).
  Future<void> forgotPassword(ForgotPasswordRequest request) async {
    await _dio.post<dynamic>(
      ApiEndpoints.authForgotPassword,
      data: request.toJson(),
    );
  }

  /// `POST /auth/reset-password` → `200` con `meta.sessionsRevoked`.
  Future<int> resetPassword(ResetPasswordRequest request) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.authResetPassword,
      data: request.toJson(),
    );
    return JsonReader.integerOr(_metaOf(response.data)['sessionsRevoked'], 0);
  }

  /// `POST /auth/change-password` → `200` con `meta.sessionsRevoked`.
  Future<int> changePassword(ChangePasswordRequest request) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.authChangePassword,
      data: request.toJson(),
    );
    return JsonReader.integerOr(_metaOf(response.data)['sessionsRevoked'], 0);
  }

  /// `GET /auth/me` → `User` con `roles[]` y `permissions[]`.
  Future<UserDto> me() async {
    final Response<dynamic> response = await _dio.get<dynamic>(ApiEndpoints.authMe);
    final UserDto? dto = UserDto.fromJson(unwrapData(response.data));
    if (dto == null) throw _malformed(ApiEndpoints.authMe);
    return dto;
  }

  /// `PATCH /auth/me` → `User`.
  Future<UserDto> updateMe(UpdateProfileRequest request) async {
    if (request.isEmpty) {
      // El backend usa zod `.strict()` y exige al menos un campo: evitamos el
      // viaje y damos un error legible en el idioma del dominio.
      throw const FormatException(
        'No hay cambios que enviar en el perfil.',
      );
    }
    final Response<dynamic> response = await _dio.patch<dynamic>(
      ApiEndpoints.authMe,
      data: request.toJson(),
    );
    final UserDto? dto = UserDto.fromJson(unwrapData(response.data));
    if (dto == null) throw _malformed('PATCH ${ApiEndpoints.authMe}');
    return dto;
  }

  /// `GET /auth/sessions` → lista de sesiones activas.
  Future<List<AuthDeviceSessionDto>> sessions() async {
    final Response<dynamic> response = await _dio.get<dynamic>(ApiEndpoints.authSessions);
    final List<AuthDeviceSessionDto> result = <AuthDeviceSessionDto>[];
    for (final Map<String, dynamic> row in unwrapList(response.data)) {
      final AuthDeviceSessionDto? dto = AuthDeviceSessionDto.fromJson(row);
      if (dto != null) result.add(dto);
    }
    return result;
  }

  /// `DELETE /auth/sessions/:id` → `200` (idempotente con `ALREADY_REVOKED`).
  Future<void> revokeSession(int sessionId) async {
    await _dio.delete<dynamic>(ApiEndpoints.authSessionById(sessionId));
  }

  // ----------------------------------------------------------------- Privados
  /// Desenvuelve `data` y exige que traiga tokens.
  AuthSessionDto _requireSession(Object? responseData, String path) {
    final AuthSessionDto? dto = AuthSessionDto.fromJson(unwrapData(responseData));
    if (dto == null) throw _malformed(path);
    return dto;
  }

  /// Bloque `meta` del envoltorio de respuesta (API.md §3.1).
  static Map<String, dynamic> _metaOf(Object? responseData) {
    final Map<String, dynamic> body = JsonReader.map(responseData) ??
        const <String, dynamic>{};
    return JsonReader.orEmpty(body['meta']);
  }

  /// Excepción para una respuesta `2xx` con cuerpo inservible. No es un
  /// `DioException`, así que el repositorio la mapea a `UnknownFailure`, que es
  /// exactamente lo que es: el servidor respondió algo que no entendemos.
  static FormatException _malformed(String path) =>
      FormatException('Respuesta inesperada del servidor en $path.');
}
