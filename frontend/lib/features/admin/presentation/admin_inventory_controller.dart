// Estado de la pantalla de Inventario del panel.
//
// EL AJUSTE ES LA ÚNICA VÍA PARA CAMBIAR UN SALDO
// `PATCH /inventory/items/:id` RECHAZA `currentStock` con `422
// FIELD_NOT_EDITABLE` (BR-INV-005). El saldo solo cambia por
// `POST /inventory/items/:id/adjust`, que escribe un movimiento `ADJUSTMENT` con
// `balance_after`. Por eso aquí no hay un `setStock`: no existiría en el backend.
//
// EXACTAMENTE UNO DE LOS DOS CAMPOS
// El endpoint acepta `newQuantity` (saldo final) o `deltaQuantity` (variación),
// NUNCA los dos. El controlador por eso construye el cuerpo con una condición
// excluyente en vez de "si viene, lo mando".
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/admin_inventory.dart';
import '../domain/entities/admin_inventory_item.dart';
import './admin_providers.dart';

/// Búsqueda de ítems.
final StateProvider<String> adminInventorySearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Filtro "solo stock bajo". `null` = todos.
final StateProvider<bool?> adminLowStockOnlyProvider =
    StateProvider<bool?>((Ref ref) => null);

/// Proveedor seleccionado. `null` = todos.
final StateProvider<String?> adminInventorySupplierProvider =
    StateProvider<String?>((Ref ref) => null);

/// Listado de ítems con los filtros de stock bajo y proveedor.
final FutureProvider<List<AdminInventoryItem>> adminInventoryProvider =
    FutureProvider<List<AdminInventoryItem>>(
  (Ref ref) async {
    final Result<List<AdminInventoryItem>> result =
        await ref.watch(adminInventoryRepositoryProvider).items(
              isLowStock: ref.watch(adminLowStockOnlyProvider),
              supplier: ref.watch(adminInventorySupplierProvider),
            );
    return switch (result) {
      Success<List<AdminInventoryItem>>(:final List<AdminInventoryItem> value) =>
        value,
      FailureResult<List<AdminInventoryItem>>(:final Failure failure) =>
        throw failure,
    };
  },
  name: 'adminInventory',
);

/// Ítems tras la búsqueda en memoria.
final Provider<List<AdminInventoryItem>> adminVisibleInventoryProvider =
    Provider<List<AdminInventoryItem>>((Ref ref) {
  final List<AdminInventoryItem> all = ref
          .watch(adminInventoryProvider)
          .valueOrNull ??
      const <AdminInventoryItem>[];
  final String needle =
      ref.watch(adminInventorySearchProvider).trim().toLowerCase();
  if (needle.isEmpty) return all;
  return <AdminInventoryItem>[
    for (final AdminInventoryItem item in all)
      if ('${item.name} ${item.sku ?? ''} ${item.supplier ?? ''}'
          .toLowerCase()
          .contains(needle))
        item,
  ];
}, name: 'adminVisibleInventory');

/// Totales de inventario, en centavos y en unidades.
class AdminInventoryTotals {
  const AdminInventoryTotals({
    this.valueMinor = 0,
    this.lowStockCount = 0,
    this.outOfStockCount = 0,
    this.itemCount = 0,
  });

  final int valueMinor;
  final int lowStockCount;
  final int outOfStockCount;
  final int itemCount;

  static AdminInventoryTotals of(List<AdminInventoryItem> items) {
    int value = 0;
    int low = 0;
    int out = 0;
    for (final AdminInventoryItem item in items) {
      value += item.valueMinor;
      if (item.isOutOfStock) {
        out += 1;
      } else if (item.isLowStock) {
        low += 1;
      }
    }
    return AdminInventoryTotals(
      valueMinor: value,
      lowStockCount: low,
      outOfStockCount: out,
      itemCount: items.length,
    );
  }
}

final Provider<AdminInventoryTotals> adminInventoryTotalsProvider =
    Provider<AdminInventoryTotals>((Ref ref) {
  return AdminInventoryTotals.of(
    ref.watch(adminVisibleInventoryProvider),
  );
}, name: 'adminInventoryTotals');

/// Movimientos recientes.
final FutureProvider<List<AdminInventoryMovement>> adminInventoryMovementsProvider =
    FutureProvider<List<AdminInventoryMovement>>(
  (Ref ref) async {
    final Result<List<AdminInventoryMovement>> result =
        await ref.watch(adminInventoryRepositoryProvider).movements();
    return switch (result) {
      Success<List<AdminInventoryMovement>>(
        :final List<AdminInventoryMovement> value,
      ) =>
        value,
      FailureResult<List<AdminInventoryMovement>>(:final Failure failure) =>
        throw failure,
    };
  },
  name: 'adminInventoryMovements',
);

/// Proveedores derivados por el backend.
final FutureProvider<List<AdminSupplier>> adminSuppliersProvider =
    FutureProvider<List<AdminSupplier>>(
  (Ref ref) async {
    final Result<List<AdminSupplier>> result =
        await ref.watch(adminInventoryRepositoryProvider).suppliers();
    return switch (result) {
      Success<List<AdminSupplier>>(:final List<AdminSupplier> value) => value,
      FailureResult<List<AdminSupplier>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminSuppliers',
);

/// Ajuste de stock de un ítem.
final AsyncNotifierProviderFamily<AdminAdjustController, void, int>
    adminAdjustProvider =
    AsyncNotifierProvider.family<AdminAdjustController, void, int>(
  AdminAdjustController.new,
);

/// Controla el ajuste de stock.
class AdminAdjustController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// `POST /inventory/items/:id/adjust` con SALDO FINAL.
  Future<bool> setTo(int newQuantity, {required String reason, int? unitCostMinor}) =>
      _run(() => ref.read(adminInventoryRepositoryProvider).adjust(
            itemId: arg,
            newQuantity: newQuantity,
            reason: reason,
            unitCostMinor: unitCostMinor,
          ));

  /// `POST /inventory/items/:id/adjust` con VARIACIÓN (positiva o negativa).
  Future<bool> changeBy(
    double delta, {
    required String reason,
    int? unitCostMinor,
  }) =>
      _run(() => ref.read(adminInventoryRepositoryProvider).adjust(
            itemId: arg,
            deltaQuantity: delta,
            reason: reason,
            unitCostMinor: unitCostMinor,
          ));

  Future<bool> _run(Future<Result<void>> Function() action) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await action();
    // Sin guarda de disposal: `adminAdjustProvider` no es `autoDispose`, así que
    // el notifier sobrevive a cualquier `await` y escribir `state` es seguro.
    switch (result) {
      case Success<void>():
        ref.invalidate(adminInventoryProvider);
        ref.invalidate(adminInventoryMovementsProvider);
        ref.invalidate(adminSuppliersProvider);
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  void acknowledge() => state = const AsyncData<void>(null);
}
