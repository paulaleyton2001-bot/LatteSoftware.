// Reintento con backoff exponencial para peticiones IDEMPOTENTES.
//
// POR QUÉ SOLO `GET` (y `HEAD`)
// ------------------------------
// API.md §1: "los demás `POST` no son idempotentes". Reintentar un
// `POST /payments` a ciegas puede cobrar dos veces. El POS cobra con tarjeta, así
// que la red se reintenta solo cuando repetir la operación no cambia el mundo.
//
// CUÁNDO REINTENTA
//   - Fallo de transporte (`connectionError`, `receiveTimeout`): el servidor
//     probablemente no llegó a procesar nada.
//   - `5xx` y `429`: transitorio por definición (API.md §4). En `429` se espera
//     el `Retry-After` que publica el servidor.
//
// CUÁNDO NO
//   - `4xx` del cliente: la petición está mal, repetirla da el mismo error.
//   - Ya se agotaron los reintentos de ESTA petición.

import 'package:dio/dio.dart';

import '../config/app_config.dart';

/// Interceptor de reintento exponencial. Máximo `AppConfig.maxRetries` intentos.
class RetryInterceptor extends Interceptor {
  RetryInterceptor({Dio? dio, this.maxRetries = AppConfig.maxRetries})
      : _dio = dio;

  final Dio? _dio;

  /// Intentos extra después del primero (2 = hasta 3 travelled en total).
  final int maxRetries;

  static const String _kRetries = 'retry_attempts';

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final RequestOptions request = err.requestOptions;
    final Dio? client = _dio;
    if (client == null ||
        !_isIdempotent(request.method) ||
        !_isRetryable(err)) {
      handler.next(err);
      return;
    }

    final int attempts = (request.extra[_kRetries] as int?) ?? 0;
    if (attempts >= maxRetries) {
      handler.next(err);
      return;
    }
    request.extra[_kRetries] = attempts + 1;

    await Future<void>.delayed(_delayFor(attempts, err));
    try {
      final Response<dynamic> response = await client.fetch<dynamic>(request);
      handler.resolve(response);
    } on DioException catch (retryError) {
      handler.next(retryError);
    } on Object {
      handler.next(err);
    }
  }

  /// Backoff: `retryBaseDelay * 2^intento`, con un mínimo de 500 ms para que la
  /// primera espera no sea imperceptible y un máximo de 8 s.
  Duration _delayFor(int attempt, DioException error) {
    final int? retryAfter = _retryAfterSeconds(error);
    if (retryAfter != null) return Duration(seconds: retryAfter);

    final int millis = AppConfig.retryBaseDelay.inMilliseconds * (1 << attempt);
    return Duration(milliseconds: millis.clamp(500, 8000));
  }

  /// Segundos de la cabecera `Retry-After`, si el servidor la envió.
  static int? _retryAfterSeconds(DioException error) {
    final Object? raw = error.response?.headers.value('retry-after');
    if (raw is int) return raw;
    if (raw is String) return int.tryParse(raw);
    return null;
  }

  /// Solo métodos que se pueden repetir sin efectos secundarios.
  static bool _isIdempotent(String method) {
    const String safe = 'GET';
    const String head = 'HEAD';
    return method == safe || method == head;
  }

  static bool _isRetryable(DioException error) {
    if (error.response == null) {
      return error.type == DioExceptionType.connectionError ||
          error.type == DioExceptionType.receiveTimeout ||
          error.type == DioExceptionType.connectionTimeout;
    }
    final int status = error.response!.statusCode ?? 0;
    return status >= 500 || status == 429;
  }
}
