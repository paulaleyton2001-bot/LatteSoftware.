// Lectura tolerante de JSON.
//
// REGLA: un DTO nunca revienta porque falte un campo. El backend puede cambiar
// (o un proxy puede recortar) y la app debe seguir mostrando lo que sí llegó.
// Estos helpers devuelven un valor por defecto sensato y, cuando el tipo no
// encaja, `null`: es la diferencia entre "el usuario ve una lista sin su foto" y
// "la app revienta al abrir".
//
// No se usa `json_serializable`: el build no puede ejecutarse en esta máquina y
// el código generado no se regeneraría. Los `fromJson` son escritos a mano.

/// Lectores tolerantes de un `Map<String, dynamic>` vindo de la API.
abstract final class JsonReader {
  const JsonReader._();

  /// `String` no vacío, o `null` (acepta `''` como ausente).
  static String? string(Object? value) {
    if (value is String && value.trim().isNotEmpty) return value;
    return null;
  }

  /// `String` con valor por defecto (para campos que la UI siempre necesita).
  static String stringOr(Object? value, String fallback) =>
      string(value) ?? fallback;

  /// `int`, aceptando `num` y `String` numérica (algunos proxies devuelven
  /// `"42"`); `null` si no es convertible.
  static int? integer(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }

  /// `int` con valor por defecto. `ids` y `*Minor` NUNCA usan esto: un id que no
  /// se puede leer es un dato inválido, no un cero.
  static int integerOr(Object? value, int fallback) => integer(value) ?? fallback;

  /// `bool` que acepta `true`/`false` y también `1`/`0` (columnas SQLite).
  static bool boolean(Object? value, {bool fallback = false}) {
    if (value is bool) return value;
    if (value is num) return value != 0;
    if (value is String) return value.toLowerCase() == 'true';
    return fallback;
  }

  /// Lista de `String`, ignorando elementos que no sean texto.
  static List<String> stringList(Object? value) {
    if (value is! List) return const <String>[];
    return value.whereType<String>().toList(growable: false);
  }

  /// Lista de mapas, ignorando elementos que no lo sean.
  static List<Map<String, dynamic>> mapList(Object? value) {
    if (value is! List) return const <Map<String, dynamic>>[];
    return value.whereType<Map<String, dynamic>>().toList(growable: false);
  }

  /// Mapa, o `null` si no es un objeto.
  static Map<String, dynamic>? map(Object? value) =>
      value is Map<String, dynamic> ? value : null;

  /// Fecha ISO-8601 en UTC, o `null`. Acepta el offset y lo normaliza a UTC
  /// (API.md §1), que es como se almacena.
  static DateTime? dateTime(Object? value) {
    final String? raw = string(value);
    if (raw == null) return null;
    final DateTime? parsed = DateTime.tryParse(raw);
    return parsed?.toUtc();
  }

  /// Devuelve [value] si es un mapa, si no un mapa vacío. Evita `!` en el
  /// llamador cuando el backend envió `null` en `data`.
  static Map<String, dynamic> orEmpty(Object? value) =>
      value is Map<String, dynamic> ? value : const <String, dynamic>{};
}
