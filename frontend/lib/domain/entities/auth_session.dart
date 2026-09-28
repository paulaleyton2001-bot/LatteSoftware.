// Sesión activa: tokens + el actor al que pertenecen.
//
// Es el resultado de `POST /auth/login`, `POST /auth/register` y
// `POST /auth/refresh` (API.md §7.1). Los tokens viven aquí y se persistan en
// `core/storage/token_storage.dart`; el actor (`User`) no es un secreto y se
// cachea para poder pintar la app sin esperar al round-trip de `GET /auth/me`.

import 'package:flutter/foundation.dart';

import 'user.dart';

/// Tokens de la sesión actual.
@immutable
class AuthSession {
  const AuthSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
    required this.user,
  });

  /// JWT HS256, TTL 900 s (API.md §2).
  final String accessToken;

  /// Valor opaco rotativo, TTL 30 días. El backend lo devuelve UNA sola vez y
  /// revoca el anterior en cada rotación.
  final String refreshToken;

  /// Expiración del access token en UTC. Permite renovar proactivamente
  /// (`AppConfig.tokenRefreshLeeway`) sin esperar un 401.
  final DateTime expiresAt;

  /// Actor al que pertenecen los tokens.
  final User user;

  /// `true` si al access token le queda menos de [leeway]: momento de renovar.
  bool expiresWithin(Duration leeway) =>
      DateTime.now().toUtc().isAfter(expiresAt.subtract(leeway));

  AuthSession copyWith({
    String? accessToken,
    String? refreshToken,
    DateTime? expiresAt,
    User? user,
  }) {
    return AuthSession(
      accessToken: accessToken ?? this.accessToken,
      refreshToken: refreshToken ?? this.refreshToken,
      expiresAt: expiresAt ?? this.expiresAt,
      user: user ?? this.user,
    );
  }

  /// Copia con tokens nuevos y el MISMO actor. Es la operación que hace la
  /// rotación de refresh: el backend no devuelve el perfil en ese endpoint.
  AuthSession withTokens({
    required String accessToken,
    required String refreshToken,
    required DateTime expiresAt,
  }) {
    return AuthSession(
      accessToken: accessToken,
      refreshToken: refreshToken,
      expiresAt: expiresAt,
      user: user,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthSession &&
          other.accessToken == accessToken &&
          other.refreshToken == refreshToken &&
          other.expiresAt == expiresAt &&
          other.user == user;

  @override
  int get hashCode => Object.hash(accessToken, refreshToken, expiresAt, user);

  /// Deliberadamente SIN tokens: un `toString` acaba en logs de error y en
  /// mensajes de aserción, y un token de 15 min en un log es una credencial.
  @override
  String toString() => 'AuthSession(user: $user, expiresAt: $expiresAt)';
}
