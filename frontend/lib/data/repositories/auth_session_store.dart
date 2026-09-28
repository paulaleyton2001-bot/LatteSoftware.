// Persistencia de la sesión: convierte entre `AuthSession` (dominio) y
// `StoredSession` (almacenamiento seguro).
//
// Existe como colaborador para que el repositorio no mezcle "qué endpoint
// llamo" con "cómo y dónde guardo el token". Centraliza la regla que más se
// olvida: el refresh token es de UN SOLO USO, así que una rotación siempre
// reescribe los TRES valores juntos; escribir solo el access dejaría un refresh
// ya revocado guardado y el siguiente 401 perdería la sesión entera.

import '../../core/storage/token_storage.dart';
import '../../core/storage/user_cache_codec.dart';
import '../../domain/entities/auth_session.dart';
import '../../domain/entities/user.dart';

/// Puente sesión de dominio ↔ almacenamiento seguro.
class AuthSessionStore {
  const AuthSessionStore(this._storage);

  final TokenStorage _storage;

  /// Sesión guardada, o `null` si no hay nada.
  Future<StoredSession?> read() => _storage.read();

  /// Actor cacheado de la sesión guardada, o `null` si no es utilizable.
  ///
  /// Solo es una optimización de arranque: si devuelve `null`, la app pide
  /// `GET /auth/me` y sigue funcionando.
  User? cachedUser(StoredSession? stored) => UserCacheCodec.decode(
        stored?.userJson,
      );

  /// Construye la entidad de sesión desde lo guardado y un actor conocido.
  static AuthSession fromStorage(StoredSession stored, User user) => AuthSession(
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        expiresAt: stored.expiresAt,
        user: user,
      );

  /// Guarda tokens + actor.
  Future<void> save(AuthSession session) => _storage.save(StoredSession(
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        userJson: UserCacheCodec.encode(session.user),
      ));

  /// Guarda solo el actor (tras `GET /auth/me` o `PATCH /auth/me`).
  ///
  /// La caché es opcional: si falla, la sesión sigue viva en red.
  Future<void> saveUser(User user) async {
    if (UserCacheCodec.encode(user) == null) return;
    try {
      await _storage.saveUser(user.toJson());
    } on Object {
      return;
    }
  }

  /// Borra la sesión. Nunca lanza.
  Future<void> clear() => _storage.clear();
}
