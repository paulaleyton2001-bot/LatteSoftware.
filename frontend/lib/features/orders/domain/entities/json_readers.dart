// Lectores tolerantes de JSON para las entidades de pedidos.
//
// VIVEN AQUÍ Y NO EN `data/models/json_reader.dart` POR UNA RAZÓN DE CAPA
// `domain/` no puede importar de `data/`: las entidades se construyen en la capa de
// presentación a partir de mapas que ya llegan desenvueltos del datasource, y
// necesitan leer `id` y `amountMinor` sin depender de la capa de datos.
//
// Son las MISMAS reglas que `data/models/json_reader.dart` (aceptan `int`, `num` y
// `String` numérica; un id ilegible devuelve `null`, nunca `0`). Duplicar 25 líneas
// es preferible a invertir la dependencia entre capas: si mañana el lector
// cambia, el cambio se hace en los dos sitios a la vista, no escondido detrás de
// un import que cruza la arquitectura.

/// `int`, aceptando `num` y `String` numérica. `null` si no es convertible.
int? readInt(Object? value) {
  if (value is int) return value;
  if (value is num) return value.toInt();
  if (value is String) return int.tryParse(value);
  return null;
}

/// `double`, aceptando `num` y `String` numérica.
double? readNum(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}

/// `String` no vacío, o `null` (el `''` del backend se trata como ausente).
String? readString(Object? value) {
  if (value is String && value.trim().isNotEmpty) return value;
  return null;
}

/// `String` con valor por defecto.
String readStringOr(Object? value, String fallback) => readString(value) ?? fallback;

/// Fecha ISO-8601 normalizada a UTC, o `null` (API.md §1).
DateTime? readDate(Object? value) {
  final String? raw = readString(value);
  if (raw == null) return null;
  return DateTime.tryParse(raw)?.toUtc();
}

/// `bool` que acepta `true`/`false` y también `1`/`0` (columnas SQLite).
bool readBool(Object? value, {bool fallback = false}) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) return value.toLowerCase() == 'true';
  return fallback;
}
