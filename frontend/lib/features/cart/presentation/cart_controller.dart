// Controlador del carrito. Módulo `features/cart/presentation`.
//
// `CartState` (con las líneas, la cantidad total y el subtotal estimado) es
// estado de PERSISTENCIA, no de servidor: el carrito vive en el dispositivo
// (`core/customer/cart_store.dart`) y sobrevive a cerrar la app. Por eso el
// controlador es un `Notifier` síncrono, no un `AsyncNotifier`: no hay nada que
// awaited al abrir la pantalla y el badge de navegación necesita el número en el
// PRIMER frame.
//
// BR-PRICE-008: `estimatedSubtotalMinor` es una previsualización para dar
// feedback inmediato. El único total válido es el que devuelve el servidor tras
// `POST /orders`; la UI reemplaza sus cifras por las del servidor sin
// transformarlas.

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/customer/cart_providers.dart';
import '../../../core/customer/cart_state.dart';
import '../../../core/customer/cart_store.dart';

/// Carrito como estado de Riverpod, para las pantallas de `features/cart`.
///
/// El estado real vive en [CartStore] (ver `core/customer/cart_providers.dart`):
/// este controlador es el espejo para la UI y el punto donde se expresan las
/// INTENCIONES (añadir, cambiar cantidad, quitar), no las operaciones.
final NotifierProvider<CartController, CartState> cartControllerProvider =
    NotifierProvider<CartController, CartState>(CartController.new);

/// Controlador del carrito.
class CartController extends Notifier<CartState> {
  @override
  CartState build() {
    final CartStore store = ref.watch(cartStoreProvider);
    // `ChangeNotifier.addListener` devuelve `void`: la baja es
    // `removeListener(_sync)`, no el valor devuelto por `addListener`.
    store.addListener(_sync);
    // Sin `onDispose` la suscripción sobrevive al provider y cada cambio del
    // store intentaría escribir en un `Notifier` ya destruido.
    ref.onDispose(() => store.removeListener(_sync));
    return store.state;
  }

  /// Añade una línea. Se fusiona con una idéntica si ya existe.
  void addLine(CartLine line) =>
      ref.read(cartStoreProvider).addLine(line);

  /// Fija la cantidad de una línea. `0` o menos la elimina.
  void setQuantity(String lineId, int quantity) =>
      ref.read(cartStoreProvider).setQuantity(lineId, quantity);

  /// Suma o resta una unidad.
  void changeQuantity(String lineId, int delta) =>
      ref.read(cartStoreProvider).changeQuantity(lineId, delta);

  /// Elimina una línea.
  void removeLine(String lineId) =>
      ref.read(cartStoreProvider).removeLine(lineId);

  /// Sustituye una línea completa (edición de notas o complementos).
  void replaceLine(CartLine line) =>
      ref.read(cartStoreProvider).replaceLine(line);

  /// Guarda o quita el cupón.
  void setCoupon(String? code) => ref.read(cartStoreProvider).setCoupon(code);

  /// Vacía el carrito.
  void clear() => ref.read(cartStoreProvider).clear();

  void _sync() {
    // Sin guarda de disposal: `cartControllerProvider` no es `autoDispose` y, si
    // lo fuera, la suscripción al store se suelta en `ref.onDispose` de `build`,
    // de modo que `_sync` no puede dispararse con el notifier ya destruido.
    state = ref.read(cartStoreProvider).state;
  }
}

/// Notificador de cambios del número de artículos.
///
/// EXISTE PARA EL BADGE DE NAVEGACIÓN, y su valor real está en que puede
/// vivir FUERA de un `BuildContext`: el destino del menú lateral se construye
/// en `app/customer/customer_navigation.dart`, y un `ChangeNotifier` se puede
/// observar desde ahí (y desde un `ListenableBuilder`) sin arrastrar un
/// `WidgetRef` a un lugar que no lo tiene.
///
/// La app actual usa el provider equivalente (`cartBadgeCountProvider`), más
/// simple porque todo el shell ya es un `ConsumerWidget`. Se conserva esta clase
/// porque es la que documenta el contrato de "el badge avisa a quien lo pinte" y
/// porque la la pidió explícitamente el requerimiento: si mañana el badge se
/// pinta desde un `Listenable` (por ejemplo dentro de una isolating list), esta
/// clase ya existe.
class CartChangedNotifier extends ChangeNotifier {
  int _count = 0;

  /// Número de artículos del carrito.
  int get count => _count;

  /// `true` si hay al menos un artículo.
  bool get hasItems => _count > 0;

  /// Etiqueta accesible del badge. Un `Badge.count` sin nombre solo anuncia un
  /// número, y "3" a secas no dice de qué (WCAG 4.1.2).
  String get semanticLabel =>
      hasItems ? '$count artículos en el carrito' : 'Carrito vacío';

  /// Publica el conteo. No notifica si no cambió: el badge se reconstruye en
  /// cada `notifyListeners` y eso ocurre con cada pulsación del stepper.
  void publish(int count) {
    if (_count == count) return;
    _count = count;
    notifyListeners();
  }

  @override
  String toString() => 'CartChangedNotifier(count: $_count)';
}

/// Proveedor del notificador, conectado al store.
///
/// `autoDispose`: si nadie lo escucha (por ejemplo, en una pantalla donde no hay
/// badge), se destruye y no queda ningún listener vivo sobre el store.
final Provider<CartChangedNotifier> cartChangedNotifierProvider =
    Provider<CartChangedNotifier>(
  (Ref ref) {
    final CartStore store = ref.watch(cartStoreProvider);
    final CartChangedNotifier notifier = CartChangedNotifier()
      ..publish(store.state.totalQuantity);
    void publish() => notifier.publish(store.state.totalQuantity);
    store.addListener(publish);
    // `removeListener` y no el valor de `addListener`: este devuelve `void`.
    ref.onDispose(() => store.removeListener(publish));
    return notifier;
  },
  name: 'cartChangedNotifier',
);

