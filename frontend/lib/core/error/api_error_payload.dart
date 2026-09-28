// Lectura del envoltorio de error de la API (`docs/API.md` §3.2).
//
// Vive aparte de `error_mapper.dart` porque es la parte que CONOCE la forma del
// JSON de error, y esa es una responsabilidad distinta de la que decide qué
// clase de `Failure` corresponde a cada status.
//
// `error.details` tiene tres formas (API.md §3.2):
//   1. array de `{ path, message, code }` → validación de esquema.
//   2. objeto con datos útiles para la UI (`{ conflictingReservationCode }`).
//   3. array de objetos por ítem afectado (`{ productId, code, message }`).
// Solo la primera produce `FieldError`; las otras dos se conservan como mapa
// para que el repositorio pueda leer claves concretas (`details.provider`).

import 'field_error.dart';

/// Datos extraídos de `{ success, error, meta }` cuando la petición falló.
typedef ApiErrorPayload = ({
  String code,
  String? detailCode,
  String message,
  String? requestId,
  List<FieldError> fieldErrors,
  Map<String, dynamic>? details,
});

/// Desenvuelve y normaliza el cuerpo de error. Nunca lanza.
abstract final class ApiErrorPayloadReader {
  const ApiErrorPayloadReader._();

  /// Lee [body] y devuelve el payload. `null`/no-JSON → valores por defecto.
  static ApiErrorPayload read(
    Map<String, dynamic>? body, {
    String? fallbackRequestId,
  }) {
    if (body == null) {
      return (
        code: 'UNKNOWN',
        detailCode: null,
        message: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
        requestId: fallbackRequestId,
        fieldErrors: const <FieldError>[],
        details: null,
      );
    }

    final Map<String, dynamic> error = asMap(body['error']) ?? const <String, dynamic>{};
    final Map<String, dynamic>? details = asMap(error['details']);

    return (
      code: asString(error['code']) ?? 'UNKNOWN',
      // `error.details.code` distingue variantes del mismo `error.code`
      // (`INVALID_CREDENTIALS` vs `TOKEN_EXPIRED` dentro de
      // `AUTHENTICATION_ERROR`), y es el identificador estable de las reglas.
      detailCode: asString(details?['code']),
      message: asString(error['message']) ??
          'Ocurrió un error inesperado. Inténtalo de nuevo.',
      // API.md §3.2: `requestId` está en `meta` en éxito y en la RAÍZ en error.
      requestId: asString(asMap(body['meta'])?['requestId']) ??
          asString(body['requestId']) ??
          fallbackRequestId,
      fieldErrors: parseFieldErrors(error['details']),
      details: details,
    );
  }

  /// `error.details` cuando es un array de `{ path, message, code }`.
  static List<FieldError> parseFieldErrors(Object? details) {
    if (details is! List) return const <FieldError>[];
    final List<FieldError> errors = <FieldError>[];
    for (final Object? entry in details) {
      if (entry is Map<String, dynamic> && entry['path'] is String) {
        errors.add(FieldError(
          path: entry['path'] as String,
          message: asString(entry['message']) ?? 'Valor inválido',
          code: asString(entry['code']),
        ));
      }
    }
    return errors;
  }

  /// Extrae el cuerpo como mapa cuando la respuesta llegó parseada.
  ///
  /// Nunca lanza: un cuerpo binario, texto plano o `null` producen `null` y el
  /// mapper cae en el mensaje genérico del tipo de fallo.
  static Map<String, dynamic>? bodyOf(Object? data) => asMap(data);

  /// Lectores tolerantes usados también por otras capas.
  static Map<String, dynamic>? asMap(Object? value) =>
      value is Map<String, dynamic> ? value : null;

  static String? asString(Object? value) =>
      value is String && value.isNotEmpty ? value : null;

  static int? asInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value);
    return null;
  }
}
