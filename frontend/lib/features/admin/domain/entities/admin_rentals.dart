// Alquiler de silla: en curso o cerrado.
//
// MÓDULO `features/admin/domain/entities`. Se separa de `admin_spaces.dart` porque
// el alquiler tiene su propia pantalla (viva, con temporizador y botón de
// extender) y porque su modelo de temporizador no cabe en el archivo de zonas y
// sillas.
//
// EL TEMPORIZADOR LO CALCULA EL SERVIDOR
// `GET /rentals/active` devuelve `elapsedMinutes`, `remainingMinutes` y
// `overtimeMinutes` YA calculados. La app los muestra y los refresca con un
// `Timer` de un segundo, pero NO los recalcula: el mínimo de 30 minutos, el
// redondeo al alza y el cobro del exceso son reglas del servidor (BR-RENTAL-003/004)
// y recalcular en cliente haría que la cifra de la pantalla no cuadrara con la
// del cobro.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

/// Alquiler en curso o cerrado.
@immutable
class AdminRental {
  const AdminRental({
    required this.id,
    required this.code,
    required this.status,
    this.chairId,
    this.chairCode,
    this.customerName,
    this.startAt,
    this.endAt,
    this.plannedMinutes = 0,
    this.billedMinutes = 0,
    this.pricePerHourMinor = 0,
    this.subtotalMinor = 0,
    this.extensionsMinor = 0,
    this.extraMinutesMinor = 0,
    this.totalMinor = 0,
    this.elapsedMinutes,
    this.remainingMinutes,
    this.overtimeMinutes,
  });

  final int id;
  final String code;
  final String status;
  final int? chairId;
  final String? chairCode;
  final String? customerName;
  final DateTime? startAt;
  final DateTime? endAt;
  final int plannedMinutes;
  final int billedMinutes;
  final int pricePerHourMinor;
  final int subtotalMinor;
  final int extensionsMinor;
  final int extraMinutesMinor;
  final int totalMinor;

  /// Los trae `GET /rentals/active` ya calculados por el servidor.
  final int? elapsedMinutes;
  final int? remainingMinutes;
  final int? overtimeMinutes;

  /// `true` si está en curso y por tanto muestra temporizador y botón de extender.
  bool get isRunning => status == 'ACTIVE' || status == 'EXTENDED';

  /// `true` si ya pasó del final previsto (el temporizador va en rojo).
  bool get isOvertime => (overtimeMinutes ?? 0) > 0;

  static AdminRental? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminRental(
      id: id,
      code: JsonReader.stringOr(json['code'], '#$id'),
      status: JsonReader.stringOr(json['status'], 'ACTIVE'),
      chairId: JsonReader.integer(json['chairId']),
      chairCode: JsonReader.string(json['chairCode']),
      customerName: JsonReader.string(json['customerName']),
      startAt: JsonReader.dateTime(json['startAt']),
      endAt: JsonReader.dateTime(json['endAt']),
      plannedMinutes: JsonReader.integerOr(json['plannedMinutes'], 0),
      billedMinutes: JsonReader.integerOr(json['billedMinutes'], 0),
      pricePerHourMinor: JsonReader.integerOr(json['pricePerHourMinor'], 0),
      subtotalMinor: JsonReader.integerOr(json['subtotalMinor'], 0),
      extensionsMinor: JsonReader.integerOr(json['extensionsMinor'], 0),
      extraMinutesMinor: JsonReader.integerOr(json['extraMinutesMinor'], 0),
      totalMinor: JsonReader.integerOr(json['totalMinor'], 0),
      elapsedMinutes: JsonReader.integer(json['elapsedMinutes']),
      remainingMinutes: JsonReader.integer(json['remainingMinutes']),
      overtimeMinutes: JsonReader.integer(json['overtimeMinutes']),
    );
  }

  @override
  String toString() => 'AdminRental($code, $status)';
}
