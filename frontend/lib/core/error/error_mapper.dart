// Traducción de la respuesta de error del backend a un `Failure` de la app.
//
// ÚNICO punto donde se conocen los códigos HTTP de `docs/API.md` §4.
// `core/network/api_exception.dart` y cualquier repositorio llaman a
// `fromResponse` (respuesta HTTP) o a `fromDioException` (excepción de dio).
// La LECTURA del envoltorio `{ success, error, meta }` vive en
// `api_error_payload.dart`: aquí solo se decide qué fallo corresponde a cada
// status.
//
// Los `error.message` del backend están en español y son aptos para el usuario
// final (API.md §3.2), así que se conservan; el vocabulario de la app se aplica
// en los mensajes por defecto de `failures.dart` y, en auth, en
// `data/repositories/auth_failure_localizer.dart`.

import 'package:dio/dio.dart';

import 'api_error_payload.dart';
import 'failures.dart';

/// Mapper de errores HTTP a dominio. Sin estado.
abstract final class ErrorMapper {
  /// Construye el [Failure] correspondiente a una respuesta HTTP fallida.
  static Failure fromResponse({
    required int statusCode,
    required Map<String, dynamic>? body,
    String? requestId,
    Object? cause,
  }) {
    final ApiErrorPayload payload =
        ApiErrorPayloadReader.read(body, fallbackRequestId: requestId);

    return switch (statusCode) {
      // Para 400/409/422 el discriminador útil es `error.details.code`
      // (`EMAIL_TAKEN`, `INVALID_RESET_TOKEN`, `PASSWORD_TOO_WEAK`, ...), no el
      // `error.code` genérico, que es el mismo en todo el status. Se guarda el
      // más específico para que la UI pueda ramificar por él sin adivinar.
      400 => ValidationFailure(
          message: payload.message,
          code: payload.detailCode ?? payload.code,
          fieldErrors: payload.fieldErrors,
          requestId: payload.requestId,
        ),
      401 => UnauthorizedFailure(
          message: payload.message,
          code: payload.code,
          requestId: payload.requestId,
        ),
      402 => PaymentFailure(
          message: payload.message,
          code: payload.code,
          requestId: payload.requestId,
          provider: ApiErrorPayloadReader.asString(payload.details?['provider']),
        ),
      403 => ForbiddenFailure(
          message: payload.message,
          code: payload.code,
          requestId: payload.requestId,
        ),
      404 => NotFoundFailure(
          message: payload.message,
          code: payload.code,
          requestId: payload.requestId,
        ),
      409 => ConflictFailure(
          message: payload.message,
          code: payload.detailCode ?? payload.code,
          fieldErrors: payload.fieldErrors,
          requestId: payload.requestId,
        ),
      422 => BusinessRuleFailure(
          message: payload.message,
          code: payload.detailCode ?? payload.code,
          fieldErrors: payload.fieldErrors,
          requestId: payload.requestId,
        ),
      429 => RateLimitFailure(
          message: payload.message,
          code: payload.code,
          requestId: payload.requestId,
        ),
      >= 500 && < 600 => ServerFailure(
          message: payload.message,
          code: payload.code,
          requestId: payload.requestId,
        ),
      _ => UnknownFailure(
          message: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
          code: payload.code,
          requestId: payload.requestId,
          details: cause?.toString(),
        ),
    };
  }

  /// Traduce una excepción de `dio` a un [Failure].
  ///
  /// Con respuesta HTTP gana el código estable del servidor; sin respuesta es
  /// un fallo de transporte y se clasifica por tipo.
  static Failure fromDioException(DioException error) {
    final int? statusCode = error.response?.statusCode;
    if (statusCode == null) return _fromTransport(error);

    final Failure failure = fromResponse(
      statusCode: statusCode,
      body: ApiErrorPayloadReader.bodyOf(error.response?.data),
      requestId: ApiErrorPayloadReader.asString(
        error.response?.headers.value('x-request-id'),
      ),
      cause: error,
    );

    // 429 publica `Retry-After` en segundos (API.md §4) y la UI lo necesita
    // para no ofrecer "reintentar ya" antes de tiempo.
    if (failure is RateLimitFailure) {
      return RateLimitFailure(
        message: failure.message,
        code: failure.code,
        fieldErrors: failure.fieldErrors,
        requestId: failure.requestId,
        retryAfterSeconds: ApiErrorPayloadReader.asInt(
          error.response?.headers.value('retry-after'),
        ),
      );
    }
    return failure;
  }

  /// Traduce una excepción que no es de `dio` (bug de cliente, plugin, etc.).
  static Failure fromException(Object error, {String? requestId}) {
    final String raw = error.toString();
    final bool offline = raw.contains('SocketException') ||
        raw.contains('Failed host lookup') ||
        raw.contains('Connection refused') ||
        raw.contains('Network is unreachable');
    if (offline) return const OfflineFailure();

    final bool timeout = raw.contains('TimeoutException') ||
        (raw.contains('DioException') && raw.contains('timeout'));
    if (timeout) {
      return NetworkFailure(
        message: 'El servidor tardó demasiado en responder. Inténtalo de nuevo.',
        code: 'TIMEOUT',
        requestId: requestId,
      );
    }
    return NetworkFailure(requestId: requestId);
  }

  /// `true` si vale la pena reintentar automáticamente.
  static bool isRetryable(Failure failure) => failure.isRetryable;

  /// Fallo de transporte: no hubo respuesta HTTP.
  static Failure _fromTransport(DioException error) => switch (error.type) {
        DioExceptionType.connectionError ||
        DioExceptionType.unknown ||
        DioExceptionType.cancel =>
          const OfflineFailure(),
        DioExceptionType.connectionTimeout ||
        DioExceptionType.sendTimeout ||
        DioExceptionType.receiveTimeout =>
          const NetworkFailure(
            message: 'El servidor tardó demasiado en responder. Inténtalo de nuevo.',
            code: 'TIMEOUT',
          ),
        DioExceptionType.badCertificate || DioExceptionType.badResponse =>
          NetworkFailure(
            requestId:
                ApiErrorPayloadReader.asString(error.response?.headers.value('x-request-id')),
          ),
      };
}
