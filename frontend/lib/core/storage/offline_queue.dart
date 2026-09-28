// Cola FIFO de operaciones pendientes, persistente en disco.
//
// La forma de la operación y el almacén están en `pending_operation.dart`; quién
// las ejecuta, en `sync_engine.dart`. Este archivo solo ordena y persiste, sin
// saber nada de pagos ni de red.
//
// Uso típico desde el POS:
// ```dart
// await ref.read(offlineQueueProvider).enqueue(
//   PendingOperation(
//     id: idempotencyKey,
//     method: 'POST',
//     path: ApiEndpoints.payments,
//     body: <String, dynamic>{'orderId': 42, 'amountMinor': 500000},
//     createdAt: DateTime.now().toUtc(),
//   ),
// );
// ```

import 'dart:async';
import 'dart:convert';

import 'pending_operation.dart';

/// Cola de operaciones pendientes. Sin conocimiento del dominio.
class OfflineQueue {
  OfflineQueue(this._persistence, {this.maxOperations = 100});

  final QueuePersistence _persistence;

  /// Tope de operaciones guardadas. Protege de que una app abierta semanas sin
  /// red crezca la cola sin límite; al superarlo se descarta lo más antiguo.
  final int maxOperations;

  final List<PendingOperation> _items = <PendingOperation>[];
  bool _loaded = false;

  /// Operaciones en cola, de la más antigua a la más nueva.
  List<PendingOperation> get items =>
      List<PendingOperation>.unmodifiable(_items);

  /// Número de operaciones pendientes.
  int get count => _items.length;

  /// `true` si la cola está vacía.
  bool get isEmpty => _items.isEmpty;

  /// Añade una operación al final de la cola y persiste.
  Future<void> enqueue(PendingOperation operation) async {
    await _ensureLoaded();
    _items.add(operation);
    if (_items.length > maxOperations) {
      _items.removeRange(0, _items.length - maxOperations);
    }
    await _persist();
  }

  /// La operación más antigua sin quitarla, o `null` si la cola está vacía.
  Future<PendingOperation?> peek() async {
    await _ensureLoaded();
    return _items.isEmpty ? null : _items.first;
  }

  /// Quita la operación con [id] y persiste. `true` si se quitó.
  Future<bool> remove(String id) async {
    await _ensureLoaded();
    final int before = _items.length;
    _items.removeWhere((PendingOperation item) => item.id == id);
    if (_items.length == before) return false;
    await _persist();
    return true;
  }

  /// Vacia la cola (cierre de sesión del POS o descarte manual).
  Future<void> clear() async {
    _items.clear();
    _loaded = true;
    await _persist();
  }

  // ----------------------------------------------------------------- Privados
  /// Carga perezosa del archivo. Las entradas corruptas se descartan en lugar
  /// de romper el arranque del POS.
  Future<void> _ensureLoaded() async {
    if (_loaded) return;
    _loaded = true;
    try {
      final String? raw = await _persistence.read();
      if (raw == null || raw.isEmpty) return;
      final Object? decoded = jsonDecode(raw);
      if (decoded is! List) return;
      for (final Object? entry in decoded) {
        if (entry is! Map<String, dynamic>) continue;
        final PendingOperation? operation = PendingOperation.fromJson(entry);
        if (operation != null) _items.add(operation);
      }
    } on Object {
      _items.clear();
    }
  }

  /// Si el disco falla, la operación sigue en memoria: es preferible a romper
  /// el cobro en curso. No se propaga porque la UI no puede resolverlo.
  Future<void> _persist() async {
    try {
      await _persistence.write(
        jsonEncode(_items.map((PendingOperation op) => op.toJson()).toList()),
      );
    } on Object {
      return;
    }
  }
}
