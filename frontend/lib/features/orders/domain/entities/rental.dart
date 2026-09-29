// Alquiler de silla. Módulo `features/orders/domain/entities`.
//
// VIVE APARTE DE `OrderSummary` POR UNA RAZÓN DE ALCANCE
// `Rental` lo consumen la home, la pestaña «Silla», el detalle del pedido y la
// extensión de tiempo. Si viviera dentro de `order_summary.dart`, cada uno de esos
// ficheros importaría un archivo con cinco entidades para usar una. Separarlo hace
// que la dependencia sea legible: "necesito un alquiler" → `rental.dart`.
//
// `status` es un `String` (`RentalStatus`, API.md §6.2) y no un enum: un valor nuevo
// del backend no debe romper el parseo, y el catálogo visual ya sabe_caer_ en
// "Desconocido" con un literal que no conoce.


import 'package:flutter/foundation.dart';
import './json_readers.dart';

/// Alquiler de silla (`Rental`, API.md §6.3).
@immutable
class Rental {
  const Rental({
    required this.id,
    required this.status,
    this.code,
    this.chairId,
    this.chairCode,
    this.reservationId,
    this.startAt,
    this.endAt,
    this.plannedMinutes = 0,
    this.billedMinutes = 0,
    this.pricePerHourMinor = 0,
    this.subtotalMinor = 0,
    this.extensionsMinor = 0,
    this.extraMinutesMinor = 0,
    this.totalMinor = 0,
  });

  final int id;
  final String? code;
  final int? chairId;
  final String? chairCode;
  final int? reservationId;

  /// `RentalStatus`: `ACTIVE`, `EXTENDED`, `COMPLETED` o `CANCELLED`.
  final String status;

  final DateTime? startAt;
  final DateTime? endAt;

  /// Minutos que el cliente pidió.
  final int plannedMinutes;

  /// Minutos reales facturados: `max(30, ceil(...))` (API.md §7.9).
  final int billedMinutes;

  /// Precio por hora CONGELADO al abrir el alquiler (BR-RENTAL-003): cambiar el
  /// precio de la silla después no altera este alquiler.
  final int pricePerHourMinor;

  final int subtotalMinor;
  final int extensionsMinor;
  final int extraMinutesMinor;
  final int totalMinor;

  /// `true` si el alquiler está cobrando AHORA.
  ///
  /// `ACTIVE` y `EXTENDED` cuentan los dos: para quien está sentado, "extendido"
  /// significa lo mismo que "activo" (sigue pagando por la silla). Distinguirlos
  /// aquí haría desaparecer de la home una silla que sí está en uso.
  bool get isLive => status == 'ACTIVE' || status == 'EXTENDED';

  /// Tiempo restante hasta [endAt].
  ///
  /// Negativo si ya se pasó: NO es un error, es excedente de tiempo, que se cobra
  /// al precio congelado (BR-RENTAL-003/004). Quien lo pinte debe mostrarlo en
  /// positivo, no como un fallo.
  ///
  /// Es un MÉTODO y no un getter porque [now] es inyectable: sin eso no hay forma
  /// de comprobar la regla de "el overtime se cuenta a partir del fin" sin esperar
  /// a que pasen las horas. Un getter no admite parámetros.
  Duration remainingAt([DateTime? now]) {
    final DateTime? end = endAt;
    if (end == null) return Duration.zero;
    return end.difference(now ?? DateTime.now().toUtc());
  }

  /// Tiempo ya consumido desde el inicio. Método por el mismo motivo que
  /// [remainingAt].
  Duration elapsedAt([DateTime? now]) {
    final DateTime? start = startAt;
    if (start == null) return Duration.zero;
    return (now ?? DateTime.now().toUtc()).difference(start);
  }

  /// `true` si el alquiler se puede extender: está vivo y el backend admite
  /// `additionalMinutes` de 5 a 1440 (API.md §7.9).
  bool get canExtend => isLive && endAt != null;

  factory Rental.fromJson(Map<String, dynamic> json) => Rental(
        id: readInt(json['id']) ?? 0,
        code: readString(json['code']),
        chairId: readInt(json['chairId']),
        chairCode: readString(json['chairCode']),
        reservationId: readInt(json['reservationId']),
        status: readString(json['status']) ?? 'ACTIVE',
        startAt: readDate(json['startAt']),
        endAt: readDate(json['endAt']),
        plannedMinutes: readInt(json['plannedMinutes']) ?? 0,
        billedMinutes: readInt(json['billedMinutes']) ?? 0,
        pricePerHourMinor: readInt(json['pricePerHourMinor']) ?? 0,
        subtotalMinor: readInt(json['subtotalMinor']) ?? 0,
        extensionsMinor: readInt(json['extensionsMinor']) ?? 0,
        extraMinutesMinor: readInt(json['extraMinutesMinor']) ?? 0,
        totalMinor: readInt(json['totalMinor']) ?? 0,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Rental &&
          other.id == id &&
          other.status == status &&
          other.endAt == endAt;

  @override
  int get hashCode => Object.hash(id, status, endAt);

  @override
  String toString() => 'Rental($id, $status, $chairCode)';
}
