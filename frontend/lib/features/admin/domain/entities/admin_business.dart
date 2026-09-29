// Configuración del negocio: `Business`, horarios y festivos.
//
// MÓDULO `features/admin/domain/entities`. Se separa de `admin_accounts.dart`
// porque la configuración del negocio es un tema propio (la pantalla de
// Ajustes) y porque `AdminBusiness` + `AdminBusinessHour` + `AdminHoliday` ya
// llenaban medio archivo.
//
// LOS PORCENTAJES SON BASIS POINTS
// `taxRateBp` y `serviceFeeBp` son ENTEROS en centésimas: 1900 = 19 %.
// `AdminBusiness.taxPercent` los divide por 100 SOLO para pintar. El cuerpo de
// `PATCH /business` manda el entero original.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

/// Configuración del negocio (`Business` de API.md §6.3).
@immutable
class AdminBusiness {
  const AdminBusiness({
    required this.id,
    required this.name,
    this.legalName,
    this.logoUrl,
    this.taxId,
    this.email,
    this.phone,
    this.addressLine1,
    this.addressLine2,
    this.city,
    this.country,
    this.currencyCode = 'COP',
    this.currencySymbol = r'$',
    this.locale = 'es_CO',
    this.timezone = 'America/Bogota',
    this.taxRateBp = 0,
    this.taxInclusive = false,
    this.serviceFeeBp = 0,
    this.tipEnabled = false,
    this.defaultTipsBp = const <int>[],
    this.maxReservationMinutes = 120,
    this.chairDefaultPriceMinor = 0,
    this.allowNegativeStock = false,
    this.lowStockAlertThreshold = 0,
    this.orderPrefix = 'ORD',
  });

  final int id;
  final String name;
  final String? legalName;
  final String? logoUrl;
  final String? taxId;
  final String? email;
  final String? phone;
  final String? addressLine1;
  final String? addressLine2;
  final String? city;
  final String? country;
  final String currencyCode;
  final String currencySymbol;
  final String locale;
  final String timezone;

  /// Basis points: 1900 = 19 %.
  final int taxRateBp;

  final bool taxInclusive;

  /// Basis points del cargo por servicio.
  final int serviceFeeBp;

  final bool tipEnabled;

  /// Propinas por defecto, EN BASIS POINTS.
  final List<int> defaultTipsBp;

  final int maxReservationMinutes;

  /// Precio por hora por defecto de una silla, en centavos.
  final int chairDefaultPriceMinor;

  final bool allowNegativeStock;
  final int lowStockAlertThreshold;
  final String orderPrefix;

  /// Tasa de impuesto como porcentaje (0-100). Solo para PINTAR.
  double get taxPercent => taxRateBp / 100;

  static AdminBusiness tryParse(Map<String, dynamic> json) {
    // `defaultTipsBp` llega como lista de NÚMEROS en basis points, no de cadenas:
    // `JsonReader.stringList` se quedaría con cero elementos siempre. Se leen con
    // `JsonReader.integer`, que además tolera el `"1000"` de un proxy que
    // serializa todo como texto.
    final Object? rawTips = json['defaultTipsBp'];
    final List<int> tips = <int>[
      if (rawTips is List)
        for (final Object? raw in rawTips)
          if (JsonReader.integer(raw) case final int parsed) parsed,
    ];
    return AdminBusiness(
      id: JsonReader.integerOr(json['id'], 0),
      name: JsonReader.stringOr(json['name'], 'Latte Coffee'),
      legalName: JsonReader.string(json['legalName']),
      logoUrl: JsonReader.string(json['logoUrl']),
      taxId: JsonReader.string(json['taxId']),
      email: JsonReader.string(json['email']),
      phone: JsonReader.string(json['phone']),
      addressLine1: JsonReader.string(json['addressLine1']),
      addressLine2: JsonReader.string(json['addressLine2']),
      city: JsonReader.string(json['city']),
      country: JsonReader.string(json['country']),
      currencyCode: JsonReader.stringOr(json['currencyCode'], 'COP'),
      currencySymbol: JsonReader.stringOr(json['currencySymbol'], r'$'),
      locale: JsonReader.stringOr(json['locale'], 'es_CO'),
      timezone: JsonReader.stringOr(json['timezone'], 'America/Bogota'),
      taxRateBp: JsonReader.integerOr(json['taxRateBp'], 0),
      taxInclusive: JsonReader.boolean(json['taxInclusive']),
      serviceFeeBp: JsonReader.integerOr(json['serviceFeeBp'], 0),
      tipEnabled: JsonReader.boolean(json['tipEnabled']),
      defaultTipsBp: List<int>.unmodifiable(tips),
      maxReservationMinutes: JsonReader.integerOr(json['maxReservationMinutes'], 120),
      chairDefaultPriceMinor:
          JsonReader.integerOr(json['chairDefaultPriceMinor'], 0),
      allowNegativeStock: JsonReader.boolean(json['allowNegativeStock']),
      lowStockAlertThreshold: JsonReader.integerOr(json['lowStockAlertThreshold'], 0),
      orderPrefix: JsonReader.stringOr(json['orderPrefix'], 'ORD'),
    );
  }

  @override
  String toString() => 'AdminBusiness($id, $name)';
}

/// Horario de apertura de un día (`dayOfWeek` 0 = domingo).
@immutable
class AdminBusinessHour {
  const AdminBusinessHour({
    required this.dayOfWeek,
    required this.opensAt,
    required this.closesAt,
    this.isClosed = false,
  });

  final int dayOfWeek;

  /// `HH:MM` en la zona del negocio (no ISO con segundos).
  final String opensAt;
  final String closesAt;
  final bool isClosed;

  /// Nombre del día, para la tabla de horarios.
  String get dayLabel => switch (dayOfWeek) {
        0 => 'Domingo',
        1 => 'Lunes',
        2 => 'Martes',
        3 => 'Miércoles',
        4 => 'Jueves',
        5 => 'Viernes',
        _ => 'Sábado',
      };

  /// `true` si cierra después de medianoche (el local hace cierre de madrugada).
  ///
  /// Son `HH:MM` de ancho fijo, así que el orden lexicográfico coincide con el
  /// cronológico: `22:00`.compareTo(`02:00`) > 0. `String` no tiene `<=`, de ahí
  /// el `compareTo`.
  bool get crossesMidnight =>
      !isClosed && closesAt.compareTo(opensAt) <= 0;

  /// Cuerpo de `PUT /business/hours`. Siempre los 7 días: el backend exige
  /// exactamente 7 objetos, sin repetidos (`INCOMPLETE_WEEK`).
  Map<String, dynamic> toBody() => <String, dynamic>{
        'dayOfWeek': dayOfWeek,
        'opensAt': isClosed ? '00:00' : opensAt,
        'closesAt': isClosed ? '00:00' : closesAt,
        'isClosed': isClosed,
      };

  static AdminBusinessHour tryParse(Map<String, dynamic> json) {
    return AdminBusinessHour(
      dayOfWeek: JsonReader.integerOr(json['dayOfWeek'], 0),
      opensAt: JsonReader.stringOr(json['opensAt'], '08:00'),
      closesAt: JsonReader.stringOr(json['closesAt'], '18:00'),
      isClosed: JsonReader.boolean(json['isClosed']),
    );
  }

  @override
  String toString() => 'AdminBusinessHour($dayOfWeek, $opensAt-$closesAt)';
}

/// Festivo del negocio.
@immutable
class AdminHoliday {
  const AdminHoliday({
    required this.id,
    required this.holidayDate,
    required this.name,
    this.isClosed = true,
  });

  final int id;

  /// `YYYY-MM-DD`, día en la zona del negocio.
  final String holidayDate;
  final String name;
  final bool isClosed;

  static AdminHoliday? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    final String? date = JsonReader.string(json['holidayDate']);
    if (id == null || date == null) return null;
    return AdminHoliday(
      id: id,
      holidayDate: date,
      name: JsonReader.stringOr(json['name'], date),
      isClosed: JsonReader.boolean(json['isClosed'], fallback: true),
    );
  }

  @override
  String toString() => 'AdminHoliday($holidayDate)';
}
