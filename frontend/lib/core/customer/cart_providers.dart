// Providers del carrito. MÓDULO `core/customer`.
//
// `cartStoreProvider` es el punto de inyección del store (usa
// `PreferencesStorage`, que `main.dart` ya resuelve). `cartStateProvider` es el
// PUENTE entre ese store y Riverpod, y `cartBadgeCountProvider` proyecta el
// número de artículos a un `int` para el badge de navegación: así el shell solo
// reconstruye la barra inferior cuando el número cambia de verdad, no cada vez
// que se edita una nota.
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ ESTE ARCHIVO EXISTE, Y NO ES OPCIONAL
// ─────────────────────────────────────────────────────────────────────────────
// `CartStore` es un `ChangeNotifier`. Avisa con `notifyListeners()`, que es un
// canal PROPIO de `ChangeNotifier`, no el de Riverpod. Un `Provider` de Riverpod
// solo se invalida cuando cambia el VALOR de una de sus dependencias; si esa
// dependencia es la INSTANCIA del store, el valor es el mismo objeto para
// siempre y el provider se queda con el valor que calculó la primera vez.
//
// Ese fue el bloqueo del mostrador: `posLinesProvider` hacía
// `ref.watch(cartStoreProvider).state.lines`, depended de una instancia estable,
// y por eso devolvía para siempre la lista que había al abrir el POS. La rejilla
// escribía en el store (el badge del cliente subía y el carrito persistía a
// disco) pero el panel «Pedido» nunca se enteraba: el cajero no podía montar una
// venta, y el panel de cobro además leía las líneas VIEJAS.
//
// La regla que sale de aquí: NADIE deriva el estado de `CartStore` con un
// `Provider` pelado. Se deriva de `cartStateProvider`, que sí está suscrito al
// store, o se lee el store directamente para una ACCIÓN (`read` de una mutación).
// Este es el único puente, y por eso `features/pos` y `features/cart` pueden
// depender de `core/` sin importarse entre sí.


import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../di/providers.dart';
import './cart_state.dart';
import './cart_store.dart';

/// Carrito del cliente. Vive mientras viva el contenedor de providers.
final Provider<CartStore> cartStoreProvider = Provider<CartStore>(
  (Ref ref) => CartStore(ref.watch(preferencesStorageProvider)),
  name: 'cartStore',
);

/// Carrito COMPLETO como estado de Riverpod.
///
/// Es el puente: se suscribe al [CartStore] y publica cada [CartState] que el
/// store emita. Los providers de lectura (líneas, badge, los del POS) dependen de
/// ÉSTE, no del store.
///
/// No es `autoDispose`: la suscripción tiene que estar viva aunque en ese momento
/// no haya ninguna pantalla mirando el carrito. Si se autodestruyera, el primer
/// `ref.read` posterior a un alta (justo lo que hace el camino de cobro al leer
/// las líneas) volvería a recibir un valor viejo.
final NotifierProvider<CartStateNotifier, CartState> cartStateProvider =
    NotifierProvider<CartStateNotifier, CartState>(CartStateNotifier.new);

/// Suscriptor del [CartStore] que publica su estado en Riverpod.
class CartStateNotifier extends Notifier<CartState> {
  /// `true` cuando el provider ya se destruyó. Evita escribir en `state` desde
  /// una notificación del store que llega tarde.
  bool _disposed = false;

  /// Store al que se está suscrito. Evita duplicar el listener si `build` se
  /// vuelve a ejecutar con el mismo store.
  CartStore? _subscribed;

  @override
  CartState build() {
    final CartStore store = ref.watch(cartStoreProvider);
    if (!identical(_subscribed, store)) {
      _subscribed?.removeListener(_sync);
      store.addListener(_sync);
      _subscribed = store;
    }
    // Quitar el listener en `onDispose` evita la fuga de la suscripción cuando
    // el contenedor de providers se destruye.
    ref.onDispose(() {
      _disposed = true;
      _subscribed?.removeListener(_sync);
      _subscribed = null;
    });
    return store.state;
  }

  void _sync() {
    if (_disposed) return;
    state = ref.read(cartStoreProvider).state;
  }
}

/// Número de artículos del carrito, como `int` reactivo.
///
/// Se implementa con un `Notifier` que proyecta `totalQuantity` del puente: así
/// `AdaptiveScaffold` recibe una lista de `AppDestination` con `badgeCount`, y
/// comparar por `int` evita reconstruir 5 destinos por cada pulsación del
/// stepper.
final NotifierProvider<CartBadgeCount, int> cartBadgeCountProvider =
    NotifierProvider<CartBadgeCount, int>(CartBadgeCount.new);

/// Proyecta [CartState.totalQuantity] a un provider observable.
///
/// No se suscribe al store por su cuenta: depende de [cartStateProvider], que ya
/// está suscrito. Dos suscripciones al mismo `ChangeNotifier` harían el mismo
/// trabajo dos veces y podrían desincronizarse.
class CartBadgeCount extends Notifier<int> {
  @override
  int build() => ref.watch(cartStateProvider).totalQuantity;
}

/// Listas del carrito, para las pantallas que solo necesitan leer.
final Provider<List<CartLine>> cartLinesProvider = Provider<List<CartLine>>(
  (Ref ref) => ref.watch(cartStateProvider).lines,
  name: 'cartLines',
);
