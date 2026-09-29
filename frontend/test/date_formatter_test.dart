// Regresión de `DateFormatter` y, sobre todo, de la INICIALIZACIÓN de locale.
//
// POR QUÉ ESTE ARCHIVO EXISTE
// `DateFormatter` construye sus `DateFormat` en `static final`. Dart inicializa
// los `static` de forma perezosa, en el PRIMER uso, así que el primer formateo
// de la app ocurre ya con la pantalla montada. Si `main()` no hubiera llamado a
// `initializeDateFormatting(AppConfig.locale)` antes de `runApp`, ese primer
// uso lanzaría:
//
//     LocaleDataException: Locale data has not been initialized,
//     call initializeDateFormatting(<locale>).
//
// y la Home se caería nada más entrar tras el login. Estos tests fijan el
// contrato de salida (es-CO, 24 h) y obligan a que la suite inicialice los datos
// de locale igual que lo hace `main()`.

import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'package:latte_coffee/core/config/app_config.dart';
import 'package:latte_coffee/core/utils/date_formatter.dart';

void main() {
  setUpAll(() async {
    // MISMO paso que `main()`: sin esto, cualquier `DateFormat` revienta.
    await initializeDateFormatting(AppConfig.locale);
  });

  group('DateFormatter', () {
    test('la fecha sale en dd/MM/yyyy', () {
      expect(DateFormatter.date(DateTime(2026, 9, 28)), '28/09/2026');
    });

    test('la hora sale en 24 h con dos dígitos', () {
      expect(DateFormatter.time(DateTime(2026, 9, 28, 14, 5)), '14:05');
      expect(DateFormatter.timeSeconds(DateTime(2026, 9, 28, 14, 5, 7)), '14:05:07');
    });

    test('fecha y hora juntas', () {
      expect(
        DateFormatter.dateTime(DateTime(2026, 9, 28, 14, 35)),
        '28/09/2026 14:35',
      );
    });

    test('la fecha larga escribe el mes en español', () {
      expect(
        DateFormatter.dateLong(DateTime(2026, 9, 28)),
        '28 de septiembre de 2026',
      );
    });

    test('un rango une las dos marcas sin repetir la fecha', () {
      expect(
        DateFormatter.range(DateTime(2026, 9, 28, 14, 35), DateTime(2026, 9, 28, 16, 45)),
        '28/09/2026 14:35 – 16:45',
      );
    });

    test('el countdown de silla rellena con ceros a la izquierda', () {
      expect(
        DateFormatter.countdown(const Duration(hours: 2, minutes: 24, seconds: 41)),
        '02:24:41',
      );
      expect(DateFormatter.countdown(const Duration(minutes: 58, seconds: 6)), '58:06');
    });

    test('las duraciones se leen en español', () {
      expect(DateFormatter.duration(const Duration(hours: 1, minutes: 24)), '1h 24m');
      expect(DateFormatter.duration(const Duration(minutes: 45)), '45m');
      expect(DateFormatter.durationLong(const Duration(hours: 2, minutes: 5)), '2 h 05 min');
      expect(DateFormatter.durationLong(const Duration(days: 1, hours: 3)), '1 día 3 h');
    });
  });
}
