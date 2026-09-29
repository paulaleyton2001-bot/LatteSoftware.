// Cola de operaciones pendientes para el POS (pagos, cierres, estados).
//
// DISEÑO
// ------
// Cuando el POS pierde la red en mitad de una operación, el usuario NO puede
// perderla ni repetirla a ciegas: cobrar dos veces es peor que tardar. La
// operación se serializa aquí, con un `id` estable, y se reintenta al volver la
// conexión. `OfflineState(pendingCount: n)` ya existe en el design system para
// avisar de esto.
//
// La cola es genérica a propósito: guarda método, ruta y cuerpo opaco, así que
// sirve para cualquier endpoint sin que este archivo conozca pagos ni pedidos.
// Quién ejecuta esas operaciones es `SyncEngine` (`sync_engine.dart`), que hoy
// es un no-op explícito: la sincronización llega en una fase posterior.
//
// PERSISTENCIA
// ------------
// El almacén es inyectable (`QueuePersistence`). La implementación por defecto
// usa el almacén clave/valor, que en móvil es un archivo y en web es
// `localStorage`: disco en ambos casos, y suficiente para el volumen de esta
// cola. Si más adelante hace falta un archivo propio (por volumen o escritura
// atómica), se implementa `QueuePersistence` y se inyecta en `core/di`; la API
// pública de `OfflineQueue` no cambia.
//
// El contenido NO es sensible (son cuerpos de negocio ya destinados al
// backend), pero nunca se loguea en claro.
import './key_value_store.dart';


/// Una operación pendiente de enviar.
class PendingOperation {
  const PendingOperation({
    required this.id,
    required this.method,
    required this.path,
    required this.createdAt,
    this.body,
    this.attempts = 0,
    this.lastError,
    this.lastAttemptAt,
  });

  /// Identificador estable de la operación (UUID del cliente). Se envía como
  /// `Idempotency-Key`, para que un reintento tras un tiempo de espera ambiguo
  /// NO duplique el cobro.
  final String id;

  /// Método HTTP en mayúsculas (`GET`, `POST`, `PATCH`, `DELETE`).
  final String method;

  /// Ruta relativa al `baseUrl` (p. ej. `/orders`).
  final String path;

  /// Cuerpo JSON de la petición, o `null` si no lleva.
  final Map<String, dynamic>? body;

  /// Cuándo se encoló. Permite descartar operaciones caducadas.
  final DateTime createdAt;

  /// Veces que se intentó enviar. `0` = nunca intentada.
  final int attempts;

  /// Último error, ya en texto apto para mostrar ("Sin conexión").
  final String? lastError;

  /// Cuándo se intentó por última vez.
  final DateTime? lastAttemptAt;

  PendingOperation copyWith({
    int? attempts,
    String? lastError,
    DateTime? lastAttemptAt,
  }) {
    return PendingOperation(
      id: id,
      method: method,
      path: path,
      body: body,
      createdAt: createdAt,
      attempts: attempts ?? this.attempts,
      lastError: lastError ?? this.lastError,
      lastAttemptAt: lastAttemptAt ?? this.lastAttemptAt,
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'method': method,
        'path': path,
        'body': body,
        'createdAt': createdAt.toIso8601String(),
        'attempts': attempts,
        'lastError': lastError,
        'lastAttemptAt': lastAttemptAt?.toIso8601String(),
      };

  /// `null` si la entrada está incompleta o corrupta (se descarta al leer).
  static PendingOperation? fromJson(Map<String, dynamic> json) {
    final Object? id = json['id'];
    final Object? method = json['method'];
    final Object? path = json['path'];
    final Object? createdAt = json['createdAt'];
    if (id is! String ||
        method is! String ||
        path is! String ||
        createdAt is! String) {
      return null;
    }
    final DateTime? created = DateTime.tryParse(createdAt);
    if (created == null) return null;
    final Object? body = json['body'];
    final Object? attempts = json['attempts'];
    final Object? lastError = json['lastError'];
    final Object? lastAttemptAt = json['lastAttemptAt'];
    return PendingOperation(
      id: id,
      method: method.toUpperCase(),
      path: path,
      body: body is Map<String, dynamic> ? body : null,
      createdAt: created.toUtc(),
      attempts: attempts is int ? attempts : 0,
      lastError: lastError is String ? lastError : null,
      lastAttemptAt:
          lastAttemptAt is String ? DateTime.tryParse(lastAttemptAt) : null,
    );
  }

  @override
  String toString() =>
      'PendingOperation($method $path, id: $id, attempts: $attempts)';
}

/// Lector/escritor de la cola. Inyectable para poder cambiar de backend.
abstract interface class QueuePersistence {
  /// Devuelve la cola serializada, o `null` si no hay nada guardado.
  Future<String?> read();

  /// Guarda la cola serializada.
  Future<void> write(String payload);
}

/// Implementación por defecto sobre el almacén clave/valor (disco en móvil,
/// `localStorage` en web).
class PreferencesQueuePersistence implements QueuePersistence {
  const PreferencesQueuePersistence(this._store);

  static const String _key = 'lc.offline.queue';

  final KeyValueStore _store;

  @override
  Future<String?> read() async => _store.getString(_key);

  @override
  Future<void> write(String payload) => _store.setString(_key, payload);
}
