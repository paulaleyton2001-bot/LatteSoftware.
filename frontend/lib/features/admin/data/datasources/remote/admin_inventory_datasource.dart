// Llamadas HTTP de inventario. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/inventory/inventory.routes.ts`.
//
// EL SALDO SOLO CAMBIA CON AJUSTE
// `PATCH /inventory/items/:id` RECHAZA `currentStock` con `422
// FIELD_NOT_EDITABLE` (BR-INV-005). La única vía para cambiar el saldo es
// `POST /inventory/items/:id/adjust`, que escribe un movimiento `ADJUSTMENT` con
// `balance_after`. Por eso aquí no hay un método `updateStock` que acepte un
// saldo: no existiría en el backend.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_inventory.dart';
import '../../../domain/entities/admin_inventory_item.dart';

/// Datasource de inventario.
class AdminInventoryDataSource {
  const AdminInventoryDataSource(this._dio);

  final Dio _dio;

  // ------------------------------------------------------------------ Ítems
  /// `GET /inventory/items` — ítems con `isLowStock` calculado.
  Future<List<AdminInventoryItem>> inventoryItems({
    String? query,
    bool? isLowStock,
    String? supplier,
    int pageSize = 100,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.inventoryItems,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        'sort': 'name',
        'order': 'asc',
        'includeInactive': true,
        if (query != null && query.trim().length >= 2) 'q': query.trim(),
        if (isLowStock != null) 'isLowStock': isLowStock,
        if (supplier != null && supplier.isNotEmpty) 'supplier': supplier,
      },
    );
    return _map(unwrapList(response.data), AdminInventoryItem.tryParse);
  }

  /// `GET /inventory/movements` — movimientos (últimos 30 días por defecto).
  Future<List<AdminInventoryMovement>> inventoryMovements({
    int? itemId,
    String? type,
    DateTime? from,
    DateTime? to,
    int pageSize = 50,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.inventoryMovements,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        // Sin `sort`: el defecto de `GET /inventory/movements` ya es
        // `createdAt desc` (ver `core/network/README.md`, "Orden de listados").
        'order': 'desc',
        if (itemId != null) 'itemId': itemId,
        if (type != null && type.isNotEmpty) 'type': type,
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
      },
    );
    return _map(unwrapList(response.data), AdminInventoryMovement.tryParse);
  }

  /// `GET /inventory/alerts` — stock bajo.
  Future<List<Map<String, dynamic>>> inventoryAlerts({int pageSize = 50}) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.inventoryAlerts,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        // Sin `sort`: el defecto de `GET /inventory/alerts` ya es
        // `currentStock asc` (ver `core/network/README.md`, "Orden de listados").
        'order': 'asc',
      },
    );
    return unwrapList(response.data);
  }

  /// `GET /inventory/suppliers` — proveedores derivados de los ítems.
  Future<List<AdminSupplier>> inventorySuppliers() async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.inventorySuppliers);
    return _map(unwrapList(response.data), AdminSupplier.tryParse);
  }

  /// `POST /inventory/items/:id/adjust` — ajuste con rastro (BR-INV-005).
  ///
  /// Exactamente uno de `newQuantity` (saldo final) o `deltaQuantity` (variación).
  /// `reason` es obligatorio. `POST /inventory/items` NO sirve para esto.
  Future<void> adjustInventory({
    required int itemId,
    int? newQuantity,
    double? deltaQuantity,
    required String reason,
    int? unitCostMinor,
  }) async {
    await _dio.post<dynamic>(
      ApiEndpoints.inventoryItemAdjust(itemId),
      data: <String, dynamic>{
        if (newQuantity != null)
          'newQuantity': newQuantity
        else if (deltaQuantity != null)
          'deltaQuantity': deltaQuantity,
        'reason': reason,
        'referenceType': 'MANUAL',
        if (unitCostMinor != null) 'unitCostMinor': unitCostMinor,
      },
    );
    // La respuesta se ignora a propósito: el llamador invalida la lista para
    // releer el saldo, que es la autoridad (nunca se pinta el valor local).
  }

  /// `POST /inventory/items` — alta de ítem (producto o insumo, nunca ambos).
  Future<void> createInventoryItem(Map<String, dynamic> body) async {
    await _dio.post<dynamic>(ApiEndpoints.inventoryItems, data: body);
  }

  /// Filtra las filas que el parser no pudo leer, para que un campo mal formado
  /// no tire la tabla entera.
  static List<T> _map<T>(
    List<Map<String, dynamic>> rows,
    T? Function(Map<String, dynamic> row) parse,
  ) {
    final List<T> out = <T>[];
    for (final Map<String, dynamic> row in rows) {
      final T? item = parse(row);
      if (item != null) out.add(item);
    }
    return out;
  }
}
