// Contrato de datos de inventario. Capa de dominio.
//
// Ver `admin_repository.dart` para el criterio.

import '../../../../core/result/result.dart';
import '../entities/admin_inventory.dart';
import '../entities/admin_inventory_item.dart';

/// Datos de inventario.
abstract interface class AdminInventoryRepository {
  /// `GET /inventory/items`.
  Future<Result<List<AdminInventoryItem>>> items({
    String? query,
    bool? isLowStock,
    String? supplier,
  });

  /// `GET /inventory/movements`.
  Future<Result<List<AdminInventoryMovement>>> movements({
    int? itemId,
    String? type,
    DateTime? from,
    DateTime? to,
  });

  /// `GET /inventory/alerts`.
  Future<Result<List<Map<String, dynamic>>>> alerts();

  /// `GET /inventory/suppliers`.
  Future<Result<List<AdminSupplier>>> suppliers();

  /// `POST /inventory/items/:id/adjust` — el ÚNICO camino para cambiar el saldo.
  ///
  /// El saldo se cuenta en UNIDADES enteras, así que [newQuantity] es `int`; la
  /// variación ([deltaQuantity]) admite decimales porque el formulario de ajuste
  /// escribe el delta tal cual y el backend lo redondea. Exactamente uno de los
  /// dos, nunca ambos (`422 FIELD_NOT_EDITABLE` en el otro endpoint).
  Future<Result<void>> adjust({
    required int itemId,
    int? newQuantity,
    double? deltaQuantity,
    required String reason,
    int? unitCostMinor,
  });

  /// `POST /inventory/items`.
  Future<Result<void>> createItem(Map<String, dynamic> body);
}
