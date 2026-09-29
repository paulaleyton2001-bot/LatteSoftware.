// Providers del carrito. MÓDULO `core/customer`.
//
// `cartStoreProvider` es el punto de inyección del store (usa
// `PreferencesStorage`, que `main.dart` ya resuelve). `cartBadgeCountProvider`
// proyecta el número de artículos a un `int` para el badge de navegación: así el
// shell solo reconstruye la barra inferior cuando el número cambia de verdad, no
// cada vez que se edita una nota.


import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../di/providers.dart';
import './cart_state.dart';
import './cart_store.dart';

/// Carrito del cliente. Vive mientras viva el contenedor de providers.
final Provider<CartStore> cartStoreProvider = Provider<CartStore>(
  (Ref ref) => CartStore(ref.watch(preferencesStorageProvider)),
  name: 'cartStore',
);

/// Número de artículos del carrito, como `int` reactivo.
///
/// Se implementa con un `Notifier` que se suscribe al store y publica solo el
/// conteo: `AdaptiveScaffold` recibe una lista de `AppDestination` con
/// `badgeCount`, así que comparar por `int` evita reconstruir 5 destinos por cada
/// pulsación del stepper.
final NotifierProvider<CartBadgeCount, int> cartBadgeCountProvider =
    NotifierProvider<CartBadgeCount, int>(CartBadgeCount.new);

/// Proyecta [CartState.totalQuantity] a un provider observable.
class CartBadgeCount extends Notifier<int> {
  /// `true` cuando el provider ya se destruyó. Evita escribir en `state`
  /// desde una notificación del store que llega tarde.
  bool _disposed = false;

  /// Store al que se está suscrito. Evita duplicar el listener si `build` se
  /// vuelve a ejecutar con el mismo store.
  CartStore? _subscribed;

  @override
  int build() {
    final CartStore store = ref.watch(cartStoreProvider);
    if (!identical(_subscribed, store)) {
      _subscribed?.removeListener(_onChanged);
      store.addListener(_onChanged);
      _subscribed = store;
    }
    // Quitar el listener en `onDispose` evita la fuga de la suscripción cuando
    // el contenedor de providers se destruye.
    ref.onDispose(() {
      _disposed = true;
      _subscribed?.removeListener(_onChanged);
      _subscribed = null;
    });
    return store.state.totalQuantity;
  }

  void _onChanged() {
    if (_disposed) return;
    state = ref.read(cartStoreProvider).state.totalQuantity;
  }
}

/// Listas del carrito, para las pantallas que solo necesitan leer.
final Provider<List<CartLine>> cartLinesProvider = Provider<List<CartLine>>(
  (Ref ref) => ref.watch(cartStoreProvider).state.lines,
  name: 'cartLines',
);
