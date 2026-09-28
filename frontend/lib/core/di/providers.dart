// Grafo de dependencias de la app (Riverpod, sin `get_it` y sin codegen).
//
// Por qué providers y no un service locator: en Flutter el grafo ya ES un árbol
// de widgets con ciclo de vida; un provider se crea una vez, se invalida cuando
// cambian sus dependencias y desaparece con el contenedor. Un `get_it` global
// obliga a reiniciar la app para cambiar una implementación.
//
// ORDEN DE DEPENDENCIAS (cada uno depende solo de los de arriba):
//
//   keyValueStore ─→ preferencesStorage ─→ queuePersistence ─→ offlineQueue
//        │
//        └─→ tokenStorage ─→ apiClient (Dio) ─→ authRemoteDataSource
//                                                    │
//                                                    ▼
//                                            authRepository
//
// NOTA DE ARQUITECTURA: el `authControllerProvider` NO vive aquí, sino en
// `features/auth/presentation/auth_controller.dart`. `core/` no importa de
// `features/` (DESIGN.md §2.3); el provider de la feature se apoya en los de
// este archivo, nunca al revés. Lo que sí viaja hacia arriba es el bus de
// eventos de sesión, para que la red pueda avisar "la sesión se perdió" sin
// conocer la feature.

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/datasources/remote/auth_remote_datasource.dart';
import '../../data/repositories/auth_repository_impl.dart';
import '../../data/repositories/auth_session_store.dart';
import '../../domain/repositories/auth_repository.dart';
import '../config/app_config.dart';
import '../network/api_client.dart';
import '../network/auth_interceptor.dart';
import '../network/connectivity.dart';
import '../storage/key_value_store.dart';
import '../storage/offline_queue.dart';
import '../storage/preferences_storage.dart';
import '../storage/token_storage.dart';

/// Almacén clave/valor de la app.
///
/// `main.dart` lo SOBREESCRIBE con la implementación real
/// (`SharedPreferencesStore`) o con `InMemoryKeyValueStore` si el
/// `SharedPreferences` no responde. Que sea una interfaz y no la clase concreta
/// es lo que permite esa degradación: sin ella, un fallo del plugin dejaría la
/// app sin arrancar.
final Provider<KeyValueStore> keyValueStoreProvider = Provider<KeyValueStore>(
  (Ref ref) => InMemoryKeyValueStore(),
  name: 'keyValueStore',
);

/// Caché de negocio no sensible (negocio activo, flags, último filtro).
final Provider<PreferencesStorage> preferencesStorageProvider =
    Provider<PreferencesStorage>(
  (Ref ref) => PreferencesStorage(ref.watch(keyValueStoreProvider)),
  name: 'preferencesStorage',
);

/// Tokens de sesión en almacenamiento seguro (Keychain / Keystore / WebCrypto).
final Provider<TokenStorage> tokenStorageProvider = Provider<TokenStorage>(
  (Ref ref) => TokenStorage(),
  name: 'tokenStorage',
);

/// Sonda de conectividad. Sin estado: cada llamada hace su propio `lookup`.
final Provider<Connectivity> connectivityProvider = Provider<Connectivity>(
  (Ref ref) => const Connectivity(),
  name: 'connectivity',
);

/// Almacén de la cola offline. Inyectable: hoy `SharedPreferences`, mañana un
/// archivo propio sin tocar `OfflineQueue`.
final Provider<QueuePersistence> queuePersistenceProvider =
    Provider<QueuePersistence>(
  (Ref ref) => PreferencesQueuePersistence(ref.watch(keyValueStoreProvider)),
  name: 'queuePersistence',
);

/// Cola de operaciones pendientes del POS.
final Provider<OfflineQueue> offlineQueueProvider = Provider<OfflineQueue>(
  (Ref ref) => OfflineQueue(ref.watch(queuePersistenceProvider)),
  name: 'offlineQueue',
);

/// Cliente HTTP. Se invalida solo si cambia el almacenamiento, nunca por estado
/// de pantalla: recrear el `Dio` perdería el refresh en vuelo.
final Provider<Dio> apiClientProvider = Provider<Dio>(
  (Ref ref) {
    // El tipo se declara explícito para dejar a la vista el contrato del
    // callback: la capa de red avisa "la sesión se perdió" y la feature decide.
    final SessionLostCallback onSessionLost = () => _notifySessionLost(ref);
    return createApiClient(
      tokenStorage: ref.watch(tokenStorageProvider),
      onSessionLost: onSessionLost,
    );
  },
  name: 'apiClient',
);

/// Base URL efectiva, para diagnóstico en la pantalla de error.
final Provider<String> apiBaseUrlProvider = Provider<String>(
  (Ref ref) => AppConfig.apiBaseUrl,
  name: 'apiBaseUrl',
);

/// Datasource remoto de autenticación.
final Provider<AuthRemoteDataSource> authRemoteDataSourceProvider =
    Provider<AuthRemoteDataSource>(
  (Ref ref) => AuthRemoteDataSource(ref.watch(apiClientProvider)),
  name: 'authRemoteDataSource',
);

/// Repositorio de autenticación (la UI solo conoce esta interfaz).
final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>(
  (Ref ref) => AuthRepositoryImpl(
    ref.watch(authRemoteDataSourceProvider),
    ref.watch(tokenStorageProvider),
    ref.watch(authSessionStoreProvider),
  ),
  name: 'authRepository',
);

/// Puente entre la sesión de dominio y el almacenamiento seguro.
final Provider<AuthSessionStore> authSessionStoreProvider =
    Provider<AuthSessionStore>(
  (Ref ref) => AuthSessionStore(ref.watch(tokenStorageProvider)),
  name: 'authSessionStore',
);

/// Bus de eventos de sesión. Minúsculo a propósito: el ESTADO de la sesión vive
/// en `AuthState`; esto solo transporta el efecto "la sesión se perdió", que la
/// capa de red no debe conocer en detalle.
final Provider<SessionEvents> sessionEventsProvider = Provider<SessionEvents>(
  (Ref ref) {
    final SessionEvents events = SessionEvents();
    ref.onDispose(events.dispose);
    return events;
  },
  name: 'sessionEvents',
);

/// Bus de eventos de sesión.
class SessionEvents {
  final List<void Function()> _listeners = <void Function()>[];

  /// Registra un listener. Devuelve la función para quitarlo.
  void Function() subscribe(void Function() listener) {
    _listeners.add(listener);
    return () => _listeners.remove(listener);
  }

  /// Notifica a todos. El fallo de un listener no impide avisar a los demás:
  /// un error de UI no puede dejar la sesión colgada.
  void emitSessionLost() {
    for (final void Function() listener in List<void Function()>.of(_listeners)) {
      try {
        listener();
      } on Object {
        continue;
      }
    }
  }

  void dispose() => _listeners.clear();
}

void _notifySessionLost(Ref ref) {
  try {
    ref.read(sessionEventsProvider).emitSessionLost();
  } on Object {
    // Sin bus disponible (el contenedor ya se liberó): la app se está cerrando.
  }
}
