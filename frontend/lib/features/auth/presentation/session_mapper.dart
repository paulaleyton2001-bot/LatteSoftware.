// Puente entre lo que hay en el almacenamiento y lo que la UI necesita.
//
// Aísla el parseo del perfil cacheado para que el controlador de sesión no mezcle
// gestión de estado con serialización. Centraliza una regla fácil de incumplir:
// un perfil cacheado NUNCA sustituye a `GET /auth/me` como autoridad; solo evita
// el spinner mientras llega la respuesta.

import '../../../core/storage/stored_session.dart';
import '../../../core/storage/user_cache_codec.dart';
import '../../../domain/entities/auth_session.dart';
import '../../../domain/entities/user.dart';

/// Lectura del perfil cacheado y construcción de la entidad de sesión.
abstract final class SessionMapper {
  const SessionMapper._();

  /// Actor cacheado de [stored], o `null` si no hay, está corrupto o no trae
  /// `id`/`email` (sin los dos no hay actor identificable).
  static User? cachedUser(StoredSession? stored) =>
      UserCacheCodec.decode(stored?.userJson);

  /// Entidad de sesión a partir de lo guardado y un actor conocido.
  static AuthSession fromStorage(StoredSession stored, User user) => AuthSession(
        accessToken: stored.accessToken,
        refreshToken: stored.refreshToken,
        expiresAt: stored.expiresAt,
        user: user,
      );
}
