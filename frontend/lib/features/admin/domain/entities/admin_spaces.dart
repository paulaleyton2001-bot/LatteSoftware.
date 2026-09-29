// Entidades operativas del panel: sillas, zonas, reservas, alquileres,
// inventario, pagos, descuentos, clientes y usuarios.
//
// Ver `admin_catalog.dart` para el criterio de agrupación: un archivo por dominio
// de negocio, no por pantalla, porque el mismo tipo aparece en varias subpantallas.
//
// LOS PORCENTAJES VIENEN EN BASIS POINTS
// `chairOccupancyRate`, `utilizationBp`, `utilizationPercent` llegan como
// ENTEROS en centésimas (o ya en porcentaje con 2 decimales, según el reporte).
// Aquí se conservan TAL CUAL; dividirlos es responsabilidad de la vista
// (`admin_dashboard_view.dart`), que es donde se documenta la conversión para que
// nadie asuma 0-100.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

/// Zona del local.
@immutable
class AdminZone {
  const AdminZone({
    required this.id,
    required this.name,
    this.code,
    this.colorHex,
    this.locationId,
    this.capacity = 0,
    this.chairCount = 0,
    this.availableCount = 0,
    this.isActive = true,
    this.sortOrder = 0,
  });

  final int id;
  final String name;
  final String? code;

  /// Color elegido por el negocio. NO se pinta (la app no puede garantizar
  /// contraste AA con un color arbitrario encima de texto).
  final String? colorHex;

  final int? locationId;

  /// Derivado de las sillas: `PATCH /zones/:id` lo ignora con warning.
  final int capacity;

  final int chairCount;
  final int availableCount;
  final bool isActive;
  final int sortOrder;

  static AdminZone? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminZone(
      id: id,
      name: JsonReader.stringOr(json['name'], 'Zona $id'),
      code: JsonReader.string(json['code']),
      colorHex: JsonReader.string(json['colorHex']),
      locationId: JsonReader.integer(json['locationId']),
      capacity: JsonReader.integerOr(json['capacity'], 0),
      chairCount: JsonReader.integerOr(json['chairCount'], 0),
      availableCount: JsonReader.integerOr(json['availableCount'], 0),
      isActive: JsonReader.boolean(json['isActive'], fallback: true),
      sortOrder: JsonReader.integerOr(json['sortOrder'], 0),
    );
  }

  @override
  String toString() => 'AdminZone($id, $name)';
}

/// Silla de gestión (`Chair` de API.md §6.3).
@immutable
class AdminChair {
  const AdminChair({
    required this.id,
    required this.code,
    required this.status,
    this.zoneId,
    this.zoneName,
    this.name,
    this.numberLabel,
    this.kind = 'CHAIR',
    this.capacity = 1,
    this.pricePerHourMinor = 0,
    this.gridX = 0,
    this.gridY = 0,
    this.mapWidth = 1,
    this.mapHeight = 1,
    this.rotationDeg = 0,
    this.features = const <String>[],
    this.notes,
    this.isBookable = true,
    this.isActive = true,
    this.statusChangedAt,
  });

  final int id;
  final String code;
  final String status;
  final int? zoneId;
  final String? zoneName;
  final String? name;
  final String? numberLabel;
  final String kind;
  final int capacity;

  /// Centavos por hora. El servidor lo CONGELA al abrir el alquiler, así que
  /// cambiarlo no altera lo ya alquilado (BR-PRICE-010).
  final int pricePerHourMinor;

  final int gridX;
  final int gridY;
  final int mapWidth;
  final int mapHeight;
  final int rotationDeg;
  final List<String> features;
  final String? notes;
  final bool isBookable;
  final bool isActive;
  final DateTime? statusChangedAt;

  /// Etiqueta visible: la del negocio si existe, si no el código.
  String get cellLabel {
    final String? label = numberLabel?.trim();
    if (label != null && label.isNotEmpty) return label;
    final String? chairName = name?.trim();
    if (chairName != null && chairName.isNotEmpty) return chairName;
    return code;
  }

  static AdminChair? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminChair(
      id: id,
      code: JsonReader.stringOr(json['code'], 'S$id'),
      status: JsonReader.stringOr(json['status'], 'AVAILABLE'),
      zoneId: JsonReader.integer(json['zoneId']),
      zoneName: JsonReader.string(json['zoneName']),
      name: JsonReader.string(json['name']),
      numberLabel: JsonReader.string(json['numberLabel']),
      kind: JsonReader.stringOr(json['kind'], 'CHAIR'),
      capacity: JsonReader.integerOr(json['capacity'], 1),
      pricePerHourMinor: JsonReader.integerOr(json['pricePerHourMinor'], 0),
      gridX: JsonReader.integerOr(json['gridX'], 0),
      gridY: JsonReader.integerOr(json['gridY'], 0),
      mapWidth: JsonReader.integerOr(json['mapWidth'], 1),
      mapHeight: JsonReader.integerOr(json['mapHeight'], 1),
      rotationDeg: JsonReader.integerOr(json['rotationDeg'], 0),
      features: JsonReader.stringList(json['features']),
      notes: JsonReader.string(json['notes']),
      isBookable: JsonReader.boolean(json['isBookable'], fallback: true),
      isActive: JsonReader.boolean(json['isActive'], fallback: true),
      statusChangedAt: JsonReader.dateTime(json['statusChangedAt']),
    );
  }

  @override
  String toString() => 'AdminChair($code, $status)';
}

/// Reserva del local.
@immutable
class AdminReservation {
  const AdminReservation({
    required this.id,
    required this.code,
    required this.status,
    this.chairId,
    this.chairCode,
    this.zoneName,
    this.customerId,
    this.customerName,
    this.startAt,
    this.endAt,
    this.durationMinutes = 0,
    this.pricePerHourMinor = 0,
    this.rentalTotalMinor = 0,
    this.checkedInAt,
    this.notes,
    this.source,
  });

  final int id;
  final String code;
  final String status;
  final int? chairId;
  final String? chairCode;
  final String? zoneName;
  final int? customerId;
  final String? customerName;
  final DateTime? startAt;
  final DateTime? endAt;
  final int durationMinutes;
  final int pricePerHourMinor;
  final int rentalTotalMinor;
  final DateTime? checkedInAt;
  final String? notes;
  final String? source;

  /// `true` si la reserva se puede confirmar (todavía `PENDING`).
  bool get canConfirm => status == 'PENDING';

  /// `true` si se puede hacer check-in (`PENDING` o `CONFIRMED`).
  bool get canCheckIn => status == 'PENDING' || status == 'CONFIRMED';

  /// `true` si se puede extender (no está `ACTIVE`: ahí va `POST /rentals/:id/extend`).
  bool get canExtend => status == 'CONFIRMED' || status == 'PENDING';

  /// `true` si se puede cancelar (no está cerrada).
  bool get canCancel => status != 'COMPLETED' &&
      status != 'CANCELLED' &&
      status != 'EXPIRED';

  static AdminReservation? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminReservation(
      id: id,
      code: JsonReader.stringOr(json['code'], '#$id'),
      status: JsonReader.stringOr(json['status'], 'PENDING'),
      chairId: JsonReader.integer(json['chairId']),
      chairCode: JsonReader.string(json['chairCode']),
      zoneName: JsonReader.string(json['zoneName']),
      customerId: JsonReader.integer(json['customerId']),
      customerName: JsonReader.string(json['customerName']),
      startAt: JsonReader.dateTime(json['startAt']),
      endAt: JsonReader.dateTime(json['endAt']),
      durationMinutes: JsonReader.integerOr(json['durationMinutes'], 0),
      pricePerHourMinor: JsonReader.integerOr(json['pricePerHourMinor'], 0),
      rentalTotalMinor: JsonReader.integerOr(json['rentalTotalMinor'], 0),
      checkedInAt: JsonReader.dateTime(json['checkedInAt']),
      notes: JsonReader.string(json['notes']),
      source: JsonReader.string(json['source']),
    );
  }

  @override
  String toString() => 'AdminReservation($code, $status)';
}
