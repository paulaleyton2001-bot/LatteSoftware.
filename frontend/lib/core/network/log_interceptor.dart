// Log de red en modo DEBUG, con redacción de secretos.
//
// REGLA INNEGOCIABLE (API.md §11.6 y §13): nunca se escribe en el log
//   - la cabecera `Authorization`;
//   - los cuerpos de `/auth/login`, `/auth/register`, `/auth/change-password` y
//     `/auth/reset-password` (contienen credenciales);
//   - el cuerpo de NINGÚN 401 (puede traer detalles del token).
//
// Solo se registra en `kDebugMode`. En release el interceptor no existe, así que
// no hay ni siquiera coste de CPU.

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';


/// Cabeceras cuyo valor se sustituye por `<redacted>`.
const Set<String> _kSecretHeaders = <String>{
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
};

/// Claves de cuerpo cuyo valor se sustituye por `<redacted>`.
const Set<String> _kSecretFields = <String>{
  'password',
  'currentpassword',
  'newpassword',
  'confirmpassword',
  'refreshtoken',
  'accesstoken',
  'token',
  'cvv',
  'cardnumber',
  'pan',
};

/// Rutas cuyo cuerpo NUNCA se imprime, ni siquiera redactado.
const Set<String> _kNeverLogBody = <String>{
  '/auth/login',
  '/auth/register',
  '/auth/change-password',
  '/auth/reset-password',
  '/auth/refresh',
};

/// Sustituye por `[REDACTED]` todo valor sensible de headers y cuerpos.
class Redactor {
  const Redactor._();

  static const String mask = '[REDACTED]';

  /// Copia del mapa de cabeceras con los secretos enmascarados.
  static Map<String, Object?> headers(Map<String, Object?> source) {
    final Map<String, Object?> result = <String, Object?>{};
    for (final MapEntry<String, Object?> entry in source.entries) {
      result[entry.key] = _kSecretHeaders.contains(entry.key.toLowerCase())
          ? mask
          : entry.value;
    }
    return result;
  }

  /// Copia del JSON con los campos sensibles enmascarados (recursivo).
  ///
  /// Ante cualquier estructura inesperada devuelve `'<body no logueable>'` en
  /// lugar de lanzar: un log nunca rompe la petición.
  static Object? body(Object? data) {
    if (data == null) return null;
    if (data is Map<String, dynamic>) return _maskMap(data, 0);
    if (data is List) return '[lista de ${data.length} elementos]';
    if (data is String) return '<${data.length} caracteres>';
    return '<${data.runtimeType}>';
  }

  static Object? _maskMap(Map<String, dynamic> source, int depth) {
    if (depth > 4) return '<anidado>';
    final Map<String, Object?> result = <String, Object?>{};
    for (final MapEntry<String, dynamic> entry in source.entries) {
      final String key = entry.key.toLowerCase();
      if (_kSecretFields.contains(key)) {
        result[entry.key] = mask;
      } else if (entry.value is Map<String, dynamic>) {
        result[entry.key] = _maskMap(entry.value as Map<String, dynamic>, depth + 1);
      } else {
        result[entry.key] = entry.value;
      }
    }
    return result;
  }
}

/// Interceptor de log. Solo se añade a la cadena en modo debug.
class LogInterceptor extends Interceptor {
  const LogInterceptor();

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (kDebugMode) {
      final bool hideBody = _kNeverLogBody.contains(_pathOf(options));
      debugPrint(
        '→ ${options.method} ${options.uri}  '
        'headers=${Redactor.headers(options.headers)}  '
        'body=${hideBody ? '<omitido>' : Redactor.body(options.data)}',
      );
    }
    handler.next(options);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    if (kDebugMode) {
      final int? status = response.statusCode;
      if (status == 401) {
        // Nunca el cuerpo de un 401: puede incluir parte del token.
        debugPrint(
          '← $status ${response.requestOptions.method} '
          '${response.requestOptions.uri}  body=<omitido: 401>',
        );
      } else {
        debugPrint(
          '← $status ${response.requestOptions.method} '
          '${response.requestOptions.uri}  '
          'body=${Redactor.body(response.data)}',
        );
      }
    }
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    if (kDebugMode) {
      final int? status = err.response?.statusCode;
      if (status == 401) {
        debugPrint('✗ 401 ${err.requestOptions.method} '
            '${err.requestOptions.uri}  body=<omitido: 401>');
      } else {
        debugPrint(
          '✗ ${status ?? err.type.name} ${err.requestOptions.method} '
          '${err.requestOptions.uri}  '
          'body=${Redactor.body(err.response?.data)}',
        );
      }
    }
    handler.next(err);
  }

  /// Ruta sin query string, para comparar con la lista de "nunca loguear".
  static String _pathOf(RequestOptions options) =>
      options.uri.path.split('?').first;
}
