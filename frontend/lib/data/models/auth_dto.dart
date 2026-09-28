// DTOs de autenticación (API.md §7.1).
//
// Tres formas distintas de respuesta conviven en el mismo recurso:
//   - `AuthSessionDto`  → `POST /auth/login` y `POST /auth/register` (trae `user`)
//   - `RefreshResultDto`→ `POST /auth/refresh` (NO trae `user`: solo tokens)
//   - `AuthDeviceSessionDto` → `GET /auth/sessions` (fila del dispositivo)
//
// No se unifican porque la rotación de refresh no puede perder al usuario: si
// `refresh` devolviera el `user`, una respuesta incompleta dejaría la sesión sin
// actor. El perfil se conserva desde el almacenamiento local y se refresca con
// `GET /auth/me`.

import '../../domain/entities/auth_result.dart';
import '../../domain/entities/auth_session.dart';
import '../../domain/entities/user.dart';
import 'json_reader.dart';
import 'user_dto.dart';

/// `data` de `POST /auth/login` y `POST /auth/register`.
class AuthSessionDto {
  const AuthSessionDto({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
    this.user,
    this.tokenType = 'Bearer',
    this.sessionId,
  });

  final String accessToken;
  final String refreshToken;

  /// Expiración ABSOLUTA, calculada a partir de `expiresIn` en el momento de
  /// la respuesta. Se guarda así para que renovar de forma proactiva no dependa
  /// de que el reloj del servidor y el del cliente coincidan al segundo.
  final DateTime expiresAt;

  /// `null` si el backend no lo envió: la sesión sigue siendo válida, pero la
  /// app tendrá que pedir `GET /auth/me` para conocer al actor.
  final User? user;

  final String tokenType;
  final int? sessionId;

  /// `null` si faltan los tokens: sin `accessToken` no hay sesión.
  static AuthSessionDto? fromJson(Object? json, {DateTime Function()? clock}) {
    final Map<String, dynamic> map = JsonReader.map(json);
    if (map.isEmpty) return null;
    final String? access = JsonReader.string(map['accessToken']);
    final String? refresh = JsonReader.string(map['refreshToken']);
    if (access == null || refresh == null) return null;

    final int ttl = JsonReader.integerOr(map['expiresIn'], 900);
    final DateTime now = clock?.call() ?? DateTime.now().toUtc();

    return AuthSessionDto(
      accessToken: access,
      refreshToken: refresh,
      expiresAt: now.add(Duration(seconds: ttl)),
      user: UserDto.fromJson(map['user'])?.toEntity(),
      tokenType: JsonReader.stringOr(map['tokenType'], 'Bearer'),
      sessionId: JsonReader.integer(map['sessionId']),
    );
  }

  /// Entidad de dominio. `null` si el DTO no trajo `user`.
  AuthSession? toEntity() {
    final User? actor = user;
    if (actor == null) return null;
    return AuthSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiresAt,
      user: actor,
    );
  }
}

/// `data` de `POST /auth/refresh` (rotación).
class RefreshResultDto {
  const RefreshResultDto({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
    this.tokenType = 'Bearer',
    this.sessionId,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;
  final String tokenType;
  final int? sessionId;

  static RefreshResultDto? fromJson(Object? json, {DateTime Function()? clock}) {
    final Map<String, dynamic> map = JsonReader.map(json);
    if (map.isEmpty) return null;
    final String? access = JsonReader.string(map['accessToken']);
    final String? refresh = JsonReader.string(map['refreshToken']);
    if (access == null || refresh == null) return null;

    final int ttl = JsonReader.integerOr(map['expiresIn'], 900);
    final DateTime now = clock?.call() ?? DateTime.now().toUtc();

    return RefreshResultDto(
      accessToken: access,
      refreshToken: refresh,
      expiresAt: now.add(Duration(seconds: ttl)),
      tokenType: JsonReader.stringOr(map['tokenType'], 'Bearer'),
      sessionId: JsonReader.integer(map['sessionId']),
    );
  }

  /// Aplica la rotación sobre la sesión previa, conservando el actor.
  AuthSession applyTo(AuthSession previous) => previous.withTokens(
        accessToken: accessToken,
        refreshToken: refreshToken,
        expiresAt: expiresAt,
      );
}

/// Fila de `GET /auth/sessions`.
class AuthDeviceSessionDto {
  const AuthDeviceSessionDto({
    required this.id,
    required this.isCurrent,
    this.deviceInfo,
    this.ipAddress,
    this.createdAt,
    this.expiresAt,
  });

  final int id;
  final bool isCurrent;
  final String? deviceInfo;
  final String? ipAddress;
  final DateTime? createdAt;
  final DateTime? expiresAt;

  /// `null` si no trae `id` (obligatorio para revocar).
  static AuthDeviceSessionDto? fromJson(Object? json) {
    final Map<String, dynamic> map = JsonReader.map(json);
    if (map.isEmpty) return null;
    final int? id = JsonReader.integer(map['id']);
    if (id == null) return null;

    return AuthDeviceSessionDto(
      id: id,
      isCurrent: JsonReader.boolean(map['isCurrent']),
      deviceInfo: JsonReader.string(map['deviceInfo']),
      ipAddress: JsonReader.string(map['ipAddress']),
      createdAt: JsonReader.dateTime(map['createdAt']),
      expiresAt: JsonReader.dateTime(map['expiresAt']),
    );
  }

  AuthDeviceSession toEntity() => AuthDeviceSession(
        id: id,
        isCurrent: isCurrent,
        deviceInfo: deviceInfo,
        ipAddress: ipAddress,
        createdAt: createdAt,
        expiresAt: expiresAt,
      );
}
