// Entidad del local: nombre, zona horaria, horario de apertura y estado actual.
//
// POR QUÉ EL ESTADO SE CALCULA AQUÍ Y NO VIENE DEL SERVIDOR
// `docs/API.md` (contrato CONGELADO, §7.4) NO tiene `GET /business/status`. Lo que
// hay es `GET /business` (configuración, con `timezone` y
// `maxReservationMinutes`) y `GET /business/hours` (7 filas con `opensAt`,
// `closesAt` e `isClosed`). "Abrir ahora" es comparar la hora local del negocio
// con la franja del día de la semana, y eso son cuatro líneas.
//
// `closesAt <= opensAt` significa que el local cierra de madrugada (el propio
// backend lo acepta: "si `closesAt <= opensAt`, el local cierra de madrugada
// (válido)"), así que la comparación del rango tiene que tratar ese caso y no
// decir "cerrado" a las 23:00 de un local que abre a las 18:00.


import 'package:flutter/foundation.dart';
import '../../../../core/utils/date_formatter.dart';

/// Horario de un día de la semana.
@immutable
class BusinessHours {
  const BusinessHours({
    required this.dayOfWeek,
    required this.opensAt,
    required this.closesAt,
    this.isClosed = false,
  });

  /// 0 = domingo … 6 = sábado (convención del backend, `API.md` §7.4).
  final int dayOfWeek;

  /// `"HH:MM"` en la zona horaria del negocio.
  final String opensAt;

  /// `"HH:MM"`. Puede ser MENOR que [opensAt] si el local cierra de madrugada.
  final String closesAt;

  final bool isClosed;

  /// Minutos desde medianoche de la apertura. `null` si el formato no se puede
  /// leer, en cuyo caso la franja se trata como "no disponible".
  int? get opensMinutes => _minutesOfDay(opensAt);

  int? get closesMinutes => _minutesOfDay(closesAt);

  /// `true` si el local está abierto a los [minutes] minutos desde medianoche.
  ///
  /// Cierra de madrugada (`closesMinutes <= opensMinutes`) se resuelve como
  /// "abierto desde la apertura hasta el final del día Y desde medianoche hasta el
  /// cierre".
  bool isOpenAt(int minutes) {
    if (isClosed) return false;
    final int? open = opensMinutes;
    final int? close = closesMinutes;
    if (open == null || close == null) return false;
    if (close > open) return minutes >= open && minutes < close;
    return minutes >= open || minutes < close;
  }

  /// Franja legible `08:00 – 18:00`, o "Cerrado".
  String get label => isClosed ? 'Cerrado' : '$opensAt – $closesAt';

  static int? _minutesOfDay(String hhmm) {
    final List<String> parts = hhmm.split(':');
    if (parts.length != 2) return null;
    final int? h = int.tryParse(parts[0]);
    final int? m = int.tryParse(parts[1]);
    if (h == null || m == null) return null;
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }
}

/// Estado del local para la pantalla de inicio.
@immutable
class BusinessStatus {
  const BusinessStatus({
    required this.name,
    required this.hours,
    this.timezone,
    this.city,
    this.address,
    this.chairDefaultPriceMinor = 0,
    this.maxReservationMinutes = 1440,
    this.orderPrefix = 'ORD',
    this.currencySymbol = r'$',
  });

  final String name;

  /// `businesses.timezone` (IANA). Se inyecta en `DateFormatter.timeZoneOverride`.
  final String? timezone;

  final String? city;

  final String? address;

  /// `businesses.currency_symbol` (`GET /business`). Se inyecta en
  /// `CurrencyFormatter.setSymbol`: el símbolo del dinero lo decide el local, no
  /// una constante del código. El valor por defecto es el del contrato.
  final String currencySymbol;

  /// Precio por hora por defecto de las sillas (`chairDefaultPriceMinor`).
  final int chairDefaultPriceMinor;

  /// `maxReservationMinutes` (1-1440): el tope de duración de una reserva.
  final int maxReservationMinutes;

  /// Prefijo de los números de pedido (`ORD-000123`).
  final String orderPrefix;

  /// 7 filas indexadas por `dayOfWeek` (0 = domingo). Una fila vacía por día sin
  /// dato, para que el índice nunca se salga.
  final List<BusinessHours> hours;

  /// `true` si el local está abierto en este momento.
  ///
  /// [now] se pasa para poder probarlo; por defecto usa el reloj del sistema, ya
  /// convertido por `DateFormatter.toLocal` a la zona del negocio.
  bool isOpenNow([DateTime? now]) {
    final BusinessHours? today = hoursFor(now);
    if (today == null) return false;
    final DateTime local = DateFormatter.toLocal(now ?? DateTime.now());
    return today.isOpenAt(local.hour * 60 + local.minute);
  }

  /// Horario del día de [now]. `null` si no hay dato para ese día.
  BusinessHours? hoursFor([DateTime? now]) {
    final DateTime local = DateFormatter.toLocal(now ?? DateTime.now());
    for (final BusinessHours row in hours) {
      if (row.dayOfWeek == local.weekday % 7) return row;
    }
    return null;
  }

  /// Texto de una línea para la tarjeta: "Abierto hasta las 18:00" o
  /// "Cerrado · abre mañana a las 08:00" cuando se puede saber.
  String headline([DateTime? now]) {
    final DateTime local = DateFormatter.toLocal(now ?? DateTime.now());
    final BusinessHours? today = hoursFor(local);
    if (today == null) return 'Horarios no disponibles';
    if (today.isClosed) return 'Hoy cerrado';
    if (isOpenNow(local)) {
      final int? close = today.closesMinutes;
      if (close == null) return 'Abierto ahora';
      return 'Abierto hasta las ${_hhmm(close)}';
    }
    // Cerrado: se busca el próximo día con apertura dentro de una semana.
    for (int offset = 1; offset <= 7; offset++) {
      final BusinessHours? next = hoursFor(local.add(Duration(days: offset)));
      if (next == null || next.isClosed) continue;
      return 'Cerrado · abre el ${_weekday(local.add(Duration(days: offset)))} '
          'a las ${next.opensAt}';
    }
    return 'Cerrado';
  }

  /// Aviso para la pantalla de inicio cuando el local está cerrado: seguir
  /// pidiendo está permitido (el local puede abrir más tarde), pero hay que
  /// decirlo en vez de dejar que alguien pida a las tres de la mañana esperando
  /// que le abran la puerta.
  String get takeawayNote => isOpenNow()
      ? 'Abrimos ahora. Te avisamos cuando esté listo.'
      : 'Ahora mismo estamos cerrados. ${headline()}.';

  /// Reconstruye el estado desde la caché local (`PreferencesStorage`).
  ///
  /// Devuelve `null` si el JSON no tiene lo mínimo (nombre), en vez de un objeto
  /// a medias que luego muestra un horario vacío.
  static BusinessStatus? fromCache(Map<String, dynamic> json) {
    final Object? name = json['name'];
    if (name is! String || name.isEmpty) return null;
    final List<BusinessHours> rows = <BusinessHours>[];
    final Object? rawHours = json['hours'];
    if (rawHours is List) {
      for (final Object? entry in rawHours) {
        if (entry is! Map<String, dynamic>) continue;
        final Object? day = entry['dayOfWeek'];
        final Object? opens = entry['opensAt'];
        final Object? closes = entry['closesAt'];
        if (day is! int || opens is! String || closes is! String) continue;
        rows.add(BusinessHours(
          dayOfWeek: day,
          opensAt: opens,
          closesAt: closes,
          isClosed: entry['isClosed'] is bool ? entry['isClosed']! as bool : false,
        ));
      }
    }
    return BusinessStatus(
      name: name,
      timezone: json['timezone'] is String ? json['timezone']! as String : null,
      city: json['city'] is String ? json['city']! as String : null,
      address: json['address'] is String ? json['address']! as String : null,
      currencySymbol: json['currencySymbol'] is String
          ? json['currencySymbol']! as String
          : r'$',
      chairDefaultPriceMinor:
          json['chairDefaultPriceMinor'] is int
              ? json['chairDefaultPriceMinor']! as int
              : 0,
      maxReservationMinutes:
          json['maxReservationMinutes'] is int
              ? json['maxReservationMinutes']! as int
              : 1440,
      orderPrefix: json['orderPrefix'] is String ? json['orderPrefix']! as String : 'ORD',
      hours: List<BusinessHours>.unmodifiable(rows),
    );
  }

  /// Tabla plana para `PreferencesStorage.cachedBusiness`. Incluye los horarios
  /// anidados porque sin ellos la app no puede saber si el local está abierto.
  Map<String, dynamic> toCacheJson() => <String, dynamic>{
        'name': name,
        'timezone': timezone,
        'city': city,
        'address': address,
        'currencySymbol': currencySymbol,
        'chairDefaultPriceMinor': chairDefaultPriceMinor,
        'maxReservationMinutes': maxReservationMinutes,
        'orderPrefix': orderPrefix,
        'hours': <Map<String, dynamic>>[
          for (final BusinessHours row in hours)
            <String, dynamic>{
              'dayOfWeek': row.dayOfWeek,
              'opensAt': row.opensAt,
              'closesAt': row.closesAt,
              'isClosed': row.isClosed,
            },
        ],
      };

  static String _hhmm(int minutes) =>
      '${(minutes ~/ 60).toString().padLeft(2, '0')}:'
      '${(minutes % 60).toString().padLeft(2, '0')}';

  static String _weekday(DateTime date) {
    const List<String> names = <String>[
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ];
    // Dart usa 1 = lunes … 7 = domingo; el backend usa 0 = domingo, así que
    // se invierte para nombrar el día.
    return names[(date.weekday - 1) % 7];
  }
}
