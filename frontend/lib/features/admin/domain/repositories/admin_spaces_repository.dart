// Contrato de datos de espacios, reservas y alquileres. Capa de dominio.
//
// Ver `admin_repository.dart` para el criterio: interfaces por DOMINIO, todas con
// `Result<T>` y sin lanzar.

import '../../../../core/result/result.dart';
import '../entities/admin_rentals.dart';
import '../entities/admin_spaces.dart';

/// Datos de espacios, reservas, alquileres e inventario.
abstract interface class AdminSpacesRepository {
  /// `GET /chairs`.
  Future<Result<List<AdminChair>>> chairs({
    required int locationId,
    int? zoneId,
    String? status,
    String? query,
  });

  /// `GET /chairs/map`.
  Future<Result<Object>> chairMap(int locationId);

  /// `POST /chairs`.
  Future<Result<void>> createChair(Map<String, dynamic> body);

  /// `PATCH /chairs/:id` (sin `status` ni `code`).
  Future<Result<void>> updateChair(int chairId, Map<String, dynamic> body);

  /// `PATCH /chairs/:id/status` (solo estados manuales).
  Future<Result<void>> setChairStatus(
    int chairId,
    String status, {
    String? reason,
  });

  /// `DELETE /chairs/:id`. [reason] es obligatorio.
  Future<Result<void>> deleteChair(int chairId, String reason);

  /// `GET /chairs/:id/history`.
  Future<Result<List<Map<String, dynamic>>>> chairHistory(int chairId);

  /// `GET /zones`.
  Future<Result<List<AdminZone>>> zones({required int locationId});

  /// `POST /zones`.
  Future<Result<void>> createZone(Map<String, dynamic> body);

  /// `PATCH /zones/:id`.
  Future<Result<void>> updateZone(int zoneId, Map<String, dynamic> body);

  /// `DELETE /zones/:id`.
  Future<Result<void>> deleteZone(int zoneId);

  /// `GET /locations` — sedes activas.
  Future<Result<List<Map<String, dynamic>>>> locations();

  /// `GET /reservations`.
  Future<Result<List<AdminReservation>>> reservations({
    DateTime? from,
    DateTime? to,
    String? status,
    int? chairId,
    String? code,
  });

  /// `POST /reservations/:id/confirm`.
  Future<Result<void>> confirmReservation(int reservationId);

  /// `POST /reservations/:id/check-in`.
  Future<Result<void>> checkInReservation(int reservationId, {String? notes});

  /// `POST /reservations/:id/extend`.
  Future<Result<void>> extendReservation(int reservationId, DateTime newEndAt);

  /// `POST /reservations/:id/cancel`.
  Future<Result<void>> cancelReservation(int reservationId, String reason);

  /// `GET /rentals/active` — los que llevan temporizador.
  Future<Result<List<AdminRental>>> activeRentals({int? locationId});

  /// `GET /rentals`.
  Future<Result<List<AdminRental>>> rentals({
    String? status,
    int? chairId,
    DateTime? from,
    DateTime? to,
  });

  /// `POST /rentals/:id/extend`.
  Future<Result<void>> extendRental(int rentalId, int additionalMinutes);

  /// `POST /rentals/:id/complete` — cierra y calcula el cobro.
  Future<Result<Map<String, dynamic>>> completeRental(
    int rentalId, {
    String? notes,
  });

  /// `POST /rentals` — alquiler walk-in.
  Future<Result<Map<String, dynamic>>> createRental({
    required int chairId,
    required int plannedMinutes,
    int? customerId,
    String? notes,
  });
}
