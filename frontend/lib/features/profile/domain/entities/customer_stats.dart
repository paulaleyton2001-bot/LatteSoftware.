// Entidades del perfil del cliente. Módulo `features/profile/domain`.

import 'package:flutter/foundation.dart';
//
// REUTILIZA `domain/entities/user.dart`
// El actor ya existe y ya viene de `GET /auth/me` con `roles[]` y
// `permissions[]` (BR-RBAC-005). Duplicarlo aquí sería tener dos representaciones
// del mismo usuario que se desincronizan en el primer `PATCH /auth/me`.
//
// LO QUE SÍ ES NUEVO
//   - `CustomerStats`: los agregados de `GET /customers/me`
//     (`{ totalOrders, totalSpentMinor, activeReservations, activeRentals }`).
//   - `NotificationPreferences`: `GET/PUT /notifications/preferences`.
//   - `CustomerReservation`: vista plana de `GET /customers/:id/reservations`.
//
// `User` está en `domain/entities/`, que es la capa COMPARTIDA: las entidades se
// reutilizan entre features; lo que no se comparte son las features.


/// Estadísticas del cliente (`GET /customers/me`, API.md §7.3).
@immutable
class CustomerStats {
  const CustomerStats({
    this.totalOrders = 0,
    this.totalSpentMinor = 0,
    this.activeReservations = 0,
    this.activeRentals = 0,
  });

  final int totalOrders;

  /// Gasto acumulado en centavos. `null` cuando el backend no lo trae.
  final int totalSpentMinor;
  final int activeReservations;
  final int activeRentals;

  factory CustomerStats.fromJson(Map<String, dynamic> json) => CustomerStats(
        totalOrders: _int(json['totalOrders']) ?? 0,
        totalSpentMinor: _int(json['totalSpentMinor']) ?? 0,
        activeReservations: _int(json['activeReservations']) ?? 0,
        activeRentals: _int(json['activeRentals']) ?? 0,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CustomerStats &&
          other.totalOrders == totalOrders &&
          other.totalSpentMinor == totalSpentMinor;

  @override
  int get hashCode => Object.hash(totalOrders, totalSpentMinor);

  @override
  String toString() => 'CustomerStats($totalOrders pedidos)';
}

/// Preferencias de notificación (`GET/PUT /notifications/preferences`).
///
/// `inApp` NO es opcional para la app: el backend lo exige
/// (`422 IN_APP_REQUIRED`, es el canal persistente del historial). Por eso el
/// widget de este canal se pinta FIJO y no se puede apagar; el resto sí se
/// enciende y apaga.
@immutable
class NotificationPreferences {
  const NotificationPreferences({
    this.inApp = true,
    this.push = false,
    this.email = false,
    this.sms = false,
    this.whatsapp = false,
    this.quietHoursFrom,
    this.quietHoursTo,
  });

  final bool inApp;
  final bool push;
  final bool email;
  final bool sms;
  final bool whatsapp;

  /// Hora local de inicio del silencio, `"HH:MM"` (`null` = sin horario de
  /// silencio).
  final String? quietHoursFrom;

  final String? quietHoursTo;

  /// `true` si hay horario de silencio configurado (ambos extremos van juntos:
  /// `400 QUIET_HOURS_INCOMPLETE` si se manda solo uno).
  bool get hasQuietHours => quietHoursFrom != null && quietHoursTo != null;

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) =>
      NotificationPreferences(
        inApp: _bool(json['inApp'], fallback: true),
        push: _bool(json['push']),
        email: _bool(json['email']),
        sms: _bool(json['sms']),
        whatsapp: _bool(json['whatsapp']),
        quietHoursFrom: _str(json['quietHoursFrom']),
        quietHoursTo: _str(json['quietHoursTo']),
      );

  /// Cuerpo de `PUT /notifications/preferences`.
  ///
  /// Solo se envían los campos que han CAMBIADO: el endpoint acepta el objeto
  /// completo, pero mandar menos es menos superficie para que un campo mal
  /// leído se escriba por error.
  Map<String, dynamic> toJson({bool? inApp, bool? push, bool? email, bool? sms, bool? whatsapp}) =>
      <String, dynamic>{
        'inApp': inApp ?? this.inApp,
        'push': push ?? this.push,
        'email': email ?? this.email,
        'sms': sms ?? this.sms,
        'whatsapp': whatsapp ?? this.whatsapp,
        'quietHoursFrom': quietHoursFrom,
        'quietHoursTo': quietHoursTo,
      };

  NotificationPreferences copyWith({
    bool? inApp,
    bool? push,
    bool? email,
    bool? sms,
    bool? whatsapp,
    String? quietHoursFrom,
    String? quietHoursTo,
  }) =>
      NotificationPreferences(
        inApp: inApp ?? this.inApp,
        push: push ?? this.push,
        email: email ?? this.email,
        sms: sms ?? this.sms,
        whatsapp: whatsapp ?? this.whatsapp,
        quietHoursFrom: quietHoursFrom ?? this.quietHoursFrom,
        quietHoursTo: quietHoursTo ?? this.quietHoursTo,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is NotificationPreferences &&
          other.inApp == inApp &&
          other.push == push &&
          other.email == email &&
          other.sms == sms &&
          other.whatsapp == whatsapp &&
          other.quietHoursFrom == quietHoursFrom &&
          other.quietHoursTo == quietHoursTo;

  @override
  int get hashCode => Object.hash(
        inApp,
        push,
        email,
        sms,
        whatsapp,
        quietHoursFrom,
        quietHoursTo,
      );

  @override
  String toString() => 'NotificationPreferences(push: $push, email: $email)';
}

/// Reserva del cliente, en vista plana (`GET /customers/:id/reservations`).
@immutable
class CustomerReservation {
  const CustomerReservation({
    required this.id,
    required this.status,
    this.code,
    this.chairCode,
    this.startAt,
    this.endAt,
    this.durationMinutes = 0,
    this.rentalTotalMinor = 0,
  });

  final int id;
  final String? code;

  /// `ReservationStatus`.
  final String status;

  final String? chairCode;
  final DateTime? startAt;
  final DateTime? endAt;
  final int durationMinutes;
  final int rentalTotalMinor;

  bool get isUpcoming => status == 'PENDING' || status == 'CONFIRMED';
  bool get isLive => status == 'ACTIVE';

  factory CustomerReservation.fromJson(Map<String, dynamic> json) =>
      CustomerReservation(
        id: _int(json['id']) ?? 0,
        code: _str(json['code']),
        status: _str(json['status']) ?? 'PENDING',
        chairCode: _str(json['chairCode']),
        startAt: _date(json['startAt']),
        endAt: _date(json['endAt']),
        durationMinutes: _int(json['durationMinutes']) ?? 0,
        rentalTotalMinor: _int(json['rentalTotalMinor']) ?? 0,
      );

  @override
  String toString() => 'CustomerReservation($code, $status)';
}

// ---------------------------------------------------------------- Lectores
int? _int(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

bool _bool(Object? value, {bool fallback = false}) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) return value.toLowerCase() == 'true';
  return fallback;
}

String? _str(Object? value) =>
    value is String && value.trim().isNotEmpty ? value : null;

DateTime? _date(Object? value) {
  final String? raw = _str(value);
  if (raw == null) return null;
  return DateTime.tryParse(raw)?.toUtc();
}
