// Implementación de `AdminSpacesRepository` e `AdminInventoryRepository`.
//
// Ver `admin_repository_impl.dart` para el criterio: sin lanzar, con `Result<T>` y
// sin traducir los errores de negocio (el mensaje del backend ya es el que hay que
// ver).

import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/admin_inventory.dart';
import '../../domain/entities/admin_inventory_item.dart';
import '../../domain/entities/admin_rentals.dart';
import '../../domain/entities/admin_spaces.dart';
import '../../domain/repositories/admin_inventory_repository.dart';
import '../../domain/repositories/admin_spaces_repository.dart';
import '../datasources/remote/admin_chairs_datasource.dart';
import '../datasources/remote/admin_inventory_datasource.dart';
import '../datasources/remote/admin_rentals_datasource.dart';
import '../datasources/remote/admin_zones_datasource.dart';

/// Repositorio de sillas, zonas, reservas y alquileres.
class AdminSpacesRepositoryImpl implements AdminSpacesRepository {
  const AdminSpacesRepositoryImpl(
    this._chairs,
    this._zones,
    this._rentals,
  );

  final AdminChairsDataSource _chairs;
  final AdminZonesDataSource _zones;
  final AdminRentalsDataSource _rentals;

  @override
  Future<Result<List<AdminChair>>> chairs({
    required int locationId,
    int? zoneId,
    String? status,
    String? query,
  }) =>
      _guard(() => _chairs.chairs(
            locationId: locationId,
            zoneId: zoneId,
            status: status,
            query: query,
          ));

  @override
  Future<Result<Object>> chairMap(int locationId) =>
      _guard(() => _chairs.chairMap(locationId));

  @override
  Future<Result<void>> createChair(Map<String, dynamic> body) =>
      _guard(() => _chairs.createChair(body));

  @override
  Future<Result<void>> updateChair(int chairId, Map<String, dynamic> body) =>
      _guard(() => _chairs.updateChair(chairId, body));

  @override
  Future<Result<void>> setChairStatus(
    int chairId,
    String status, {
    String? reason,
  }) =>
      _guard(() => _chairs.setChairStatus(chairId, status, reason: reason));

  @override
  Future<Result<void>> deleteChair(int chairId, String reason) =>
      _guard(() => _chairs.deleteChair(chairId, reason));

  @override
  Future<Result<List<Map<String, dynamic>>>> chairHistory(int chairId) =>
      _guard(() => _chairs.chairHistory(chairId));

  @override
  Future<Result<List<AdminZone>>> zones({required int locationId}) =>
      _guard(() => _zones.zones(locationId: locationId));

  @override
  Future<Result<void>> createZone(Map<String, dynamic> body) =>
      _guard(() => _zones.createZone(body));

  @override
  Future<Result<void>> updateZone(int zoneId, Map<String, dynamic> body) =>
      _guard(() => _zones.updateZone(zoneId, body));

  @override
  Future<Result<void>> deleteZone(int zoneId) =>
      _guard(() => _zones.deleteZone(zoneId));

  @override
  Future<Result<List<Map<String, dynamic>>>> locations() =>
      _guard(_zones.locations);

  @override
  Future<Result<List<AdminReservation>>> reservations({
    DateTime? from,
    DateTime? to,
    String? status,
    int? chairId,
    String? code,
  }) =>
      _guard(() => _rentals.reservations(
            from: from,
            to: to,
            status: status,
            chairId: chairId,
            code: code,
          ));

  @override
  Future<Result<void>> confirmReservation(int reservationId) =>
      _guard(() => _rentals.confirmReservation(reservationId));

  @override
  Future<Result<void>> checkInReservation(int reservationId, {String? notes}) =>
      _guard(() => _rentals.checkInReservation(reservationId, notes: notes));

  @override
  Future<Result<void>> extendReservation(int reservationId, DateTime newEndAt) =>
      _guard(() => _rentals.extendReservation(reservationId, newEndAt));

  @override
  Future<Result<void>> cancelReservation(int reservationId, String reason) =>
      _guard(() => _rentals.cancelReservation(reservationId, reason));

  @override
  Future<Result<List<AdminRental>>> activeRentals({int? locationId}) =>
      _guard(() => _rentals.activeRentals(locationId: locationId));

  @override
  Future<Result<List<AdminRental>>> rentals({
    String? status,
    int? chairId,
    DateTime? from,
    DateTime? to,
  }) =>
      _guard(() => _rentals.rentals(
            status: status,
            chairId: chairId,
            from: from,
            to: to,
          ));

  @override
  Future<Result<void>> extendRental(int rentalId, int additionalMinutes) =>
      _guard(() => _rentals.extendRental(
            rentalId,
            additionalMinutes: additionalMinutes,
          ));

  @override
  Future<Result<Map<String, dynamic>>> completeRental(
    int rentalId, {
    String? notes,
  }) =>
      _guard(() => _rentals.completeRental(rentalId, notes: notes));

  @override
  Future<Result<Map<String, dynamic>>> createRental({
    required int chairId,
    required int plannedMinutes,
    int? customerId,
    String? notes,
  }) =>
      _guard(() => _rentals.createRental(
            chairId: chairId,
            plannedMinutes: plannedMinutes,
            customerId: customerId,
            notes: notes,
          ));
}

/// Repositorio de inventario.
class AdminInventoryRepositoryImpl implements AdminInventoryRepository {
  const AdminInventoryRepositoryImpl(this._remote);

  final AdminInventoryDataSource _remote;

  @override
  Future<Result<List<AdminInventoryItem>>> items({
    String? query,
    bool? isLowStock,
    String? supplier,
  }) =>
      _guard(() => _remote.inventoryItems(
            query: query,
            isLowStock: isLowStock,
            supplier: supplier,
          ));

  @override
  Future<Result<List<AdminInventoryMovement>>> movements({
    int? itemId,
    String? type,
    DateTime? from,
    DateTime? to,
  }) =>
      _guard(() => _remote.inventoryMovements(
            itemId: itemId,
            type: type,
            from: from,
            to: to,
          ));

  @override
  Future<Result<List<Map<String, dynamic>>>> alerts() =>
      _guard(_remote.inventoryAlerts);

  @override
  Future<Result<List<AdminSupplier>>> suppliers() =>
      _guard(_remote.inventorySuppliers);

  @override
  Future<Result<void>> adjust({
    required int itemId,
    int? newQuantity,
    double? deltaQuantity,
    required String reason,
    int? unitCostMinor,
  }) =>
      _guard(() => _remote.adjustInventory(
            itemId: itemId,
            newQuantity: newQuantity,
            deltaQuantity: deltaQuantity,
            reason: reason,
            unitCostMinor: unitCostMinor,
          ));

  @override
  Future<Result<void>> createItem(Map<String, dynamic> body) =>
      _guard(() => _remote.createInventoryItem(body));
}

/// Envuelve cualquier excepción en un `FailureResult<T>`.
Future<Result<T>> _guard<T>(Future<T> Function() action) async {
  try {
    return Success<T>(await action());
  } on Object catch (error) {
    return FailureResult<T>(ApiException.toFailure(error));
  }
}
