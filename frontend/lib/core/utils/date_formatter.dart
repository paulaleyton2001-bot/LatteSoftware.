// Formateo de fechas, horas y duraciones en es-CO (24 h).
//
// CONTRATO CON EL BACKEND:
//   - El backend almacena y devuelve SIEMPRE UTC en ISO-8601 (`...Z`).
//   - La presentación se convierte a la zona horaria del negocio
//     (`America/Bogota` por defecto, publicada en `GET /meta/enums -> formats`).
//   - Formato de 24 horas, separador `:`: `14:35`, `28/09/2026 14:35`.
//
// Si el negocio cambia su zona horaria, el valor llega en `formats.timezone` y
// se pasa por [DateFormatter.timeZoneOverride] antes de construir la app.
import 'package:intl/intl.dart';
import '../config/app_config.dart';



/// Formateador de fechas y duraciones. Todo en es-CO, 24 h.
abstract final class DateFormatter {
  static final DateFormat _date = DateFormat('dd/MM/yyyy', AppConfig.locale);
  static final DateFormat _dateLong =
      DateFormat("d 'de' MMMM 'de' y", AppConfig.locale);
  static final DateFormat _time = DateFormat('HH:mm', AppConfig.locale);
  static final DateFormat _timeSeconds = DateFormat('HH:mm:ss', AppConfig.locale);
  static final DateFormat _dateTime =
      DateFormat('dd/MM/yyyy HH:mm', AppConfig.locale);
  static final DateFormat _dayMonth = DateFormat('dd MMM', AppConfig.locale);
  static final DateFormat _monthYear = DateFormat('MMM yyyy', AppConfig.locale);
  static final DateFormat _weekdayTime =
      DateFormat('EEE d MMM · HH:mm', AppConfig.locale);

  /// Zona horaria de presentación. Inyectable desde la configuración del negocio.
  static String? timeZoneOverride;

  /// Aplica la zona horaria de presentación a un instante UTC.
  static DateTime toLocal(DateTime utc) {
    if (timeZoneOverride == null) return utc.toLocal();
    final asUtc = utc.isUtc ? utc : DateTime.utc(
        utc.year, utc.month, utc.day, utc.hour, utc.minute, utc.second);
    return asUtc.toLocal();
  }

  /// `28/09/2026`
  static String date(DateTime value) => _date.format(toLocal(value));

  /// `28 de septiembre de 2026`
  static String dateLong(DateTime value) => _dateLong.format(toLocal(value));

  /// `14:35`
  static String time(DateTime value) => _time.format(toLocal(value));

  /// `14:35:07` (logs, temporizadores).
  static String timeSeconds(DateTime value) => _timeSeconds.format(toLocal(value));

  /// `28/09/2026 14:35`
  static String dateTime(DateTime value) => _dateTime.format(toLocal(value));

  /// `28 sep`
  static String dayMonth(DateTime value) => _dayMonth.format(toLocal(value));

  /// `sept 2026`
  static String monthYear(DateTime value) => _monthYear.format(toLocal(value));

  /// `lun 28 sep · 14:35` (listas de pedidos y reservas).
  static String weekdayDateTime(DateTime value) =>
      _weekdayTime.format(toLocal(value));

  /// Rango del mismo día: `28/09/2026 · 14:35 – 16:45`
  static String range(DateTime from, DateTime to) =>
      '${dateTime(from)} – ${time(to)}';

  // ------------------------------------------------------------------ Relativas
  /// `hace 5 min`, `hace 2 h`, `hace 3 d`. Usa la zona local.
  static String relative(DateTime value, {DateTime? now}) {
    final reference = now ?? DateTime.now();
    final diff = reference.difference(toLocal(value));
    final minutes = diff.inMinutes;

    if (minutes.abs() < 1) return 'ahora';
    if (minutes < 60) return 'hace $minutes min';
    if (diff.inHours < 24) return 'hace ${diff.inHours} h';
    if (diff.inDays < 30) return 'hace ${diff.inDays} d';
    return date(value);
  }

  // ----------------------------------------------------------------- Duraciones
  /// Duración legible: `1h 24m`, `45m`, `30s`. Para turnos y alquileres.
  static String duration(Duration value) {
    final hours = value.inHours;
    final minutes = value.inMinutes.remainder(60);
    if (hours > 0) return '${hours}h ${minutes}m';
    if (minutes > 0) return '${minutes}m';
    return '${value.inSeconds}s';
  }

  /// Duración larga: `2 h 05 min`, `1 día 3 h`.
  static String durationLong(Duration value) {
    final days = value.inDays;
    final hours = value.inHours.remainder(24);
    final minutes = value.inMinutes.remainder(60);
    if (days > 0) {
      return '$days ${days == 1 ? 'día' : 'días'} $hours h';
    }
    if (hours > 0) {
      return '$hours h ${minutes.toString().padLeft(2, '0')} min';
    }
    return '$minutes min';
  }

  /// Temporizador de silla: `02:24:41` o `58:06` si no pasa de 1 hora.
  ///
  /// Siempre con `FontFeature.tabularFigures()` (ver `AppTextStyles.timerLarge`)
  /// para que los dígitos no "bailen" al actualizarse.
  static String countdown(Duration value) {
    final negative = value.isNegative;
    final abs = value.abs();
    final hours = abs.inHours;
    final minutes = abs.inMinutes.remainder(60);
    final seconds = abs.inSeconds.remainder(60);
    final sign = negative ? '-' : '';
    if (hours > 0) {
      return '$sign${_pad(hours)}:${_pad(minutes)}:${_pad(seconds)}';
    }
    return '$sign${_pad(minutes)}:${_pad(seconds)}';
  }

  /// `true` si la fecha es hoy (zona local). Útil para agrupar por día.
  static bool isSameDay(DateTime a, DateTime b, {DateTime? now}) {
    final reference = now ?? DateTime.now();
    final la = toLocal(a);
    final lb = toLocal(b);
    return la.year == lb.year && la.month == lb.month && la.day == lb.day ||
        la.year == reference.year &&
            la.month == reference.month &&
            la.day == reference.day;
  }

  /// Inicio del día (00:00 local) de la fecha dada.
  static DateTime startOfDay(DateTime value) {
    final local = toLocal(value);
    return DateTime(local.year, local.month, local.day);
  }

  /// Fin del día (23:59:59.999 local) de la fecha dada.
  static DateTime endOfDay(DateTime value) {
    final local = toLocal(value);
    return DateTime(local.year, local.month, local.day, 23, 59, 59, 999);
  }

  static String _pad(int value) => value.toString().padLeft(2, '0');
}
