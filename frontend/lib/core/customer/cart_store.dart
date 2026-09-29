// Almacén del carrito: única fuente de verdad y ÚNICO que publica cambios.
//
// POR QUÉ UN STORE Y NO UN PROVIDER DIRECTO
// El carrito lo tocan cuatro features (ficha de producto, carrito, checkout y el
// badge de navegación) y ninguna importa a otra. Con un `Provider` cada una
// tendría su propia instancia o habría que exportar el provider de una feature
// desde otra: las dos opciones están mal. Un store en `core/` resuelve el
// problema sin duplicar el estado.
//
// `ChangeNotifier` viene de `package:flutter/foundation.dart`, que es la
// ÚNICA dependencia de Flutter que se permite en esta capa (y ni siquiera se usa
// ningún widget): lo que se necesita es `Listenable`, no el framework.
//
// PERSISTENCIA: cada mutación escribe en `PreferencesStorage` para que el
// carrito sobreviva a cerrar la app. La escritura es `fire-and-forget`: si el
// disco falla, la sesión en memoria sigue siendo válida y el usuario no pierde
// lo que acaba de elegir.



import 'dart:async';

import 'package:flutter/foundation.dart';

import '../storage/preferences_storage.dart';
import './cart_codec.dart';
import './cart_state.dart';

/// Carrito del cliente, con persistencia y aviso de cambios.
class CartStore extends ChangeNotifier {
  CartStore(this._preferences) {
    // La lectura del almacén clave/valor es síncrona (`SharedPreferences` ya está
    // en memoria), así que el carrito está disponible en el primer frame: abrir la
    // app nunca muestra un carrito vacío que "luego se llena".
    _state = CartCodec.decode(_preferences.cartJson);
  }

  final PreferencesStorage _preferences;

  CartState _state = const CartState.empty();

  /// Contador monótono para generar ids de línea únicos sin depender de un
  /// paquete de UUID (que no se puede añadir a `pubspec.yaml` en esta fase).
  int _sequence = 0;

  CartState get state => _state;

  /// Número de artículos. Es lo que pinta el badge de navegación.
  int get count => _state.totalQuantity;

  bool get isEmpty => _state.isEmpty;

  /// Añade una línea. Si ya existe una idéntica (misma variante, complementos y
  /// notas) suma la cantidad en vez de duplicar la fila.
  void addLine(CartLine line) {
    final int incoming = line.quantity < 1 ? 1 : line.quantity;
    final List<CartLine> next = List<CartLine>.of(_state.lines);
    final int index = next.indexWhere((CartLine item) => item.mergeKey == line.mergeKey);
    if (index >= 0) {
      final CartLine existing = next[index];
      next[index] = existing.copyWith(
        quantity: (existing.quantity + incoming).clamp(1, kCartMaxLineQuantity),
      );
    } else {
      next.add(line.copyWith(quantity: incoming.clamp(1, kCartMaxLineQuantity)));
    }
    _publish(CartState(lines: List<CartLine>.unmodifiable(next), couponCode: _state.couponCode));
  }

  /// Cambia la cantidad de una línea. Cantidad <= 0 la elimina.
  void setQuantity(String lineId, int quantity) {
    if (quantity <= 0) {
      removeLine(lineId);
      return;
    }
    final List<CartLine> next = <CartLine>[
      for (final CartLine line in _state.lines)
        if (line.id == lineId)
          line.copyWith(quantity: quantity.clamp(1, kCartMaxLineQuantity))
        else
          line,
    ];
    _publish(CartState(lines: List<CartLine>.unmodifiable(next), couponCode: _state.couponCode));
  }

  /// Incrementa en [delta] la cantidad de una línea.
  void changeQuantity(String lineId, int delta) {
    final CartLine? line = lineById(lineId);
    if (line == null) return;
    setQuantity(lineId, line.quantity + delta);
  }

  /// Elimina una línea.
  void removeLine(String lineId) {
    final List<CartLine> next = _state.lines
        .where((CartLine line) => line.id != lineId)
        .toList(growable: false);
    if (next.length == _state.lines.length) return;
    _publish(CartState(lines: List<CartLine>.unmodifiable(next), couponCode: _state.couponCode));
  }

  /// Sustituye una línea entera (edición de notas o complementos).
  void replaceLine(CartLine line) {
    final List<CartLine> next = <CartLine>[
      for (final CartLine item in _state.lines)
        if (item.id == line.id) line else item,
    ];
    _publish(CartState(lines: List<CartLine>.unmodifiable(next), couponCode: _state.couponCode));
  }

  /// Guarda (o quita, con `null`) el cupón escrito por el cliente.
  ///
  /// Guardarlo NO lo valida: la validación real es `POST /discounts/validate` y
  /// la aplicación final ocurre en `POST /orders` (BR-DISC-001).
  void setCoupon(String? code) {
    final String? normalized = (code == null || code.trim().isEmpty) ? null : code.trim().toUpperCase();
    if (normalized == _state.couponCode) return;
    _publish(CartState(lines: _state.lines, couponCode: normalized));
  }

  /// Vacía el carrito (tras confirmar el pedido o al cerrar sesión).
  void clear() => _publish(const CartState.empty());

  CartLine? lineById(String lineId) {
    for (final CartLine line in _state.lines) {
      if (line.id == lineId) return line;
    }
    return null;
  }

  /// Id de línea nuevo. `microsecondsSinceEpoch` + un contador local garantiza
  /// unicidad incluso si se añaden dos líneas en el mismo microsegundo.
  String nextLineId() {
    _sequence += 1;
    return 'l${DateTime.now().microsecondsSinceEpoch}-$_sequence';
  }

  /// Publica el estado y lo persiste. Único punto de escritura.
  void _publish(CartState next) {
    _state = next;
    // `discarded_futures` está activo en el linter: la escritura no se espera a
    // propósito (es una caché), y por eso queda explícito con `unawaited`.
    unawaited(_persist());
    notifyListeners();
  }

  Future<void> _persist() async {
    try {
      await _preferences.setCartJson(CartCodec.encode(_state));
    } on Object {
      // Disco lleno o plugin caído: el carrito sigue válido en memoria.
    }
  }
}
