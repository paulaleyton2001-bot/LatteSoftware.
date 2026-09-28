// Sesión tal y como se guarda en el almacenamiento seguro.
//
// Es un tipo de PERSISTENCIA, no de dominio: por eso duplica los tokens en vez
// de exponerlos en getters de una entidad. Mantenerlo separado de
// `TokenStorage` (que habla con el plugin) y de `AuthSession` (que vive en
// `domain/`) deja claro cuál de los tres toca el disco.

/// Tokens + perfil mínimo tal como se escriben en disco.
class StoredSession {
  const StoredSession({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
    this.userJson,
  });

  /// JWT HS256. Caduca a los 15 min.
  final String accessToken;

  /// Valor opaco rotativo, TTL 30 días, de UN SOLO USO.
  final String refreshToken;

  /// Expiración del access token, en UTC.
  final DateTime expiresAt;

  /// Actor cacheado serializado (`User.toJson`), o `null`.
  ///
  /// NO es un secreto: son los mismos datos que expone `GET /auth/me` y solo
  /// evitan un spinner en el arranque. Aun así viaja al almacén seguro para que
  /// el perfil no quede en claro junto al resto del dispositivo.
  final String? userJson;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'expiresAt': expiresAt.toIso8601String(),
        'userJson': userJson,
      };

  /// `null` si la entrada está incompleta o corrupta (se descarta al leer).
  static StoredSession? fromJson(Map<String, dynamic> json) {
    final Object? access = json['accessToken'];
    final Object? refresh = json['refreshToken'];
    final Object? expires = json['expiresAt'];
    if (access is! String || refresh is! String || expires is! String) {
      return null;
    }
    final DateTime? expiresAt = DateTime.tryParse(expires);
    if (expiresAt == null) return null;
    final Object? user = json['userJson'];
    return StoredSession(
      accessToken: access,
      refreshToken: refresh,
      expiresAt: expiresAt.toUtc(),
      userJson: user is String ? user : null,
    );
  }

  /// Deliberadamente SIN tokens: esto acaba en logs.
  @override
  String toString() => 'StoredSession(expiresAt: $expiresAt, hasUser: $userJson)';
}
