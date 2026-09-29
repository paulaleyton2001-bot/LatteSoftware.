// Contratos de datos del panel de administración. Capa de dominio.
//
// El panel tiene trece subpantallas y todas necesitan "algo del servidor, con
// filtros, y que no reviente si falla". Declarar un método por pantalla habría
// producido trece interfaces de un método; aquí hay interfaces POR DOMINIO, que
// es como está organizado el resto de la app.
//
// TODAS LAS FIRMAS DEVUELVEN `Result<T>` Y NUNCA LANZAN
// Una pantalla de administración que se cae a media carga pierde el trabajo de
// quien la está usando (un cambio de precio a medio aplicar, un reembolso sin
// confirmar). El fallo viaja como valor y la UI decide.

import '../../../../core/result/result.dart';
import '../entities/admin_catalog.dart';
import '../entities/admin_payments.dart';
import '../entities/admin_products.dart';

/// Datos de pedidos, pagos y reportes.
abstract interface class AdminOpsRepository {
  /// `GET /orders` con filtros de estado, tipo, texto y rango de fechas.
  Future<Result<List<AdminOrder>>> orders({
    String? status,
    String? type,
    String? query,
    DateTime? from,
    DateTime? to,
    bool? hasUnpaidBalance,
  });

  /// `GET /orders/:id` crudo: items, pagos, reembolsos y totales anidados.
  Future<Result<Map<String, dynamic>>> order(int orderId);

  /// `POST /orders/:id/status`. `reason` es obligatorio para cancelar o reembolsar.
  Future<Result<void>> setOrderStatus(
    int orderId,
    String toStatus, {
    String? reason,
    String? pin,
  });

  /// `GET /orders/:id/receipt` — comprobante para reimprimir.
  Future<Result<Map<String, dynamic>>> receipt(int orderId);

  /// `GET /orders/:id/history` — línea de tiempo de estados.
  Future<Result<List<Map<String, dynamic>>>> orderHistory(int orderId);

  /// `GET /payments` con filtros de método, estado, pedido y rango.
  Future<Result<List<AdminPayment>>> payments({
    String? method,
    String? status,
    int? orderId,
    DateTime? from,
    DateTime? to,
  });

  /// `POST /payments/:id/refund` — reembolso total o parcial.
  Future<Result<void>> refund({
    required int paymentId,
    required int amountMinor,
    required String reason,
  });

  /// `GET /reports/dashboard`.
  Future<Result<Map<String, dynamic>>> dashboard({
    String preset,
    int seriesDays,
  });

  /// `GET /reports/sales-by-hour`.
  Future<Result<List<Map<String, dynamic>>>> salesByHour({
    required String preset,
    DateTime? from,
    DateTime? to,
  });

  /// `GET /reports/sales-by-day`.
  Future<Result<List<Map<String, dynamic>>>> salesByDay({
    required String preset,
    DateTime? from,
    DateTime? to,
  });

  /// `GET /reports/top-products`.
  Future<Result<List<Map<String, dynamic>>>> topProducts({
    required String preset,
    String orderBy,
    int limit,
    DateTime? from,
    DateTime? to,
  });

  /// `GET /reports/chair-occupancy`.
  Future<Result<Map<String, dynamic>>> chairOccupancy({
    required String preset,
    int? zoneId,
    DateTime? from,
    DateTime? to,
  });

  /// `GET /reports/inventory`.
  Future<Result<Map<String, dynamic>>> inventoryReport(String preset);

  /// `GET /reports/sales`.
  Future<Result<List<Map<String, dynamic>>>> sales({
    required String preset,
    DateTime? from,
    DateTime? to,
    String groupBy,
  });

  /// `POST /reports/export` — CSV crudo (no pasa por el envoltorio JSON).
  Future<Result<String>> exportCsv({
    required String report,
    required String preset,
    DateTime? from,
    DateTime? to,
    List<String>? columns,
  });
}

/// Datos del catálogo de gestión.
abstract interface class AdminCatalogRepository {
  /// `GET /products` con búsqueda, categoría y filtro de disponibilidad.
  Future<Result<List<AdminProduct>>> products({
    String? query,
    int? categoryId,
    bool? available,
  });

  /// `GET /products/:id`.
  Future<Result<AdminProduct?>> product(int productId);

  /// `POST /products`.
  Future<Result<AdminProduct>> createProduct(Map<String, dynamic> body);

  /// `PATCH /products/:id` (sin `sku`, que es inmutable, ni `isAvailable`).
  Future<Result<AdminProduct>> updateProduct(
    int productId,
    Map<String, dynamic> body,
  );

  /// `PATCH /products/:id/availability`.
  Future<Result<void>> setAvailability(
    int productId,
    bool isAvailable, {
    String? reason,
  });

  /// `PATCH /products/:id/active`.
  Future<Result<void>> setActive(int productId, bool isActive, {String? reason});

  /// `POST /products/:id/duplicate`.
  Future<Result<AdminProduct>> duplicateProduct(
    int productId, {
    required String sku,
    String? name,
  });

  /// `DELETE /products/:id`.
  Future<Result<void>> deleteProduct(int productId, {String? reason});

  /// `GET /categories`.
  Future<Result<List<AdminCategory>>> categories();

  /// `POST /categories`.
  Future<Result<AdminCategory>> createCategory(Map<String, dynamic> body);

  /// `PATCH /categories/:id`.
  Future<Result<void>> updateCategory(int categoryId, Map<String, dynamic> body);

  /// `DELETE /categories/:id`. [confirmOrphan] es obligatorio con productos.
  Future<Result<void>> deleteCategory(int categoryId, {bool confirmOrphan});

  /// `GET /products/:id/variants`.
  Future<Result<List<Map<String, dynamic>>>> variants(int productId);

  /// `POST /products/:id/variants`.
  Future<Result<void>> createVariant(int productId, Map<String, dynamic> body);

  /// `PATCH /products/variants/:variantId`.
  Future<Result<void>> updateVariant(int variantId, Map<String, dynamic> body);

  /// `DELETE /products/variants/:variantId`.
  Future<Result<void>> deleteVariant(int variantId);

  /// `GET /products/:id/addons`.
  Future<Result<List<Map<String, dynamic>>>> addons(int productId);

  /// `POST /products/:id/addons`.
  Future<Result<void>> createAddon(int productId, Map<String, dynamic> body);

  /// `PATCH /products/addons/:addonId`.
  Future<Result<void>> updateAddon(int addonId, Map<String, dynamic> body);

  /// `DELETE /products/addons/:addonId`.
  Future<Result<void>> deleteAddon(int addonId);

  /// `GET /products/:id/ingredients` — receta con coste por unidad.
  Future<Result<List<Map<String, dynamic>>>> ingredients(int productId);

  /// `POST /products/:id/ingredients` — añade un insumo a la receta.
  Future<Result<void>> addIngredient(int productId, Map<String, dynamic> body);

  /// `DELETE /products/:id/ingredients/:ingredientId`.
  Future<Result<void>> removeIngredient(int productId, int ingredientId);
}
