// Catálogo de fallos de la aplicación: mensaje en español + identificador
// estable del backend (`docs/API.md` §4) para elegir la pantalla.
//
// Es la jerarquía `sealed`, así que ningún `switch` sobre `Failure` puede quedar
// sin cubrir un caso nuevo. Por eso NO se parte en varios archivos: los miembros
// de una clase sellada viven en la misma library. [FieldError], que no participa
// en la jerarquía, sí se extrajo a `field_error.dart` y se reexporta aquí.

import 'package:flutter/foundation.dart';

import 'field_error.dart';

export 'field_error.dart' show FieldError;

/// Jerarquía sellada de fallos.
@immutable
sealed class Failure {
  const Failure({
    required this.message,
    this.code,
    this.fieldErrors = const <FieldError>[],
    this.requestId,
  });

  /// Mensaje en español listo para mostrar.
  final String message;

  /// Identificador estable del backend. Para `400`/`409`/`422` es
  /// `error.details.code` (`EMAIL_TAKEN`, `PRODUCT_UNAVAILABLE`…), más
  /// informativo que el `error.code` genérico del status.
  final String? code;

  /// Errores de validación por campo, para pintar bajo cada input.
  final List<FieldError> fieldErrors;

  /// `requestId` del envoltorio de respuesta. Se muestra en soporte.
  final String? requestId;

  bool get isRetryable => switch (this) {
        NetworkFailure() ||
        ServerFailure() ||
        OfflineFailure() ||
        RateLimitFailure() =>
          true,
        UnauthorizedFailure() ||
        ForbiddenFailure() ||
        NotFoundFailure() ||
        ValidationFailure() ||
        ConflictFailure() ||
        BusinessRuleFailure() ||
        PaymentFailure() ||
        UnknownFailure() =>
          false,
      };

  /// `true` si el error obliga a re-autenticarse (expira el redirect).
  bool get requiresAuth => this is UnauthorizedFailure;

  @override
  String toString() => '$runtimeType($code): $message';
}

/// Sin red, host sin respuesta o timeout de conexión agotado.
final class NetworkFailure extends Failure {
  const NetworkFailure({
    super.message = 'No pudimos conectar con el servidor. Revisa tu conexión.',
    super.code = 'NETWORK_ERROR',
    super.fieldErrors,
    super.requestId,
  });
}

/// `5xx` del servidor. Reintentable con backoff.
final class ServerFailure extends Failure {
  const ServerFailure({
    super.message = 'El servidor tuvo un problema. Inténtalo de nuevo.',
    super.code = 'INTERNAL_ERROR',
    super.fieldErrors,
    super.requestId,
  });
}

/// `401`: token ausente, expirado o revocado → redirigir a login.
final class UnauthorizedFailure extends Failure {
  const UnauthorizedFailure({
    super.message = 'Tu sesión expiró. Inicia sesión nuevamente.',
    super.code = 'AUTHENTICATION_ERROR',
    super.fieldErrors,
    super.requestId,
  });
}

/// `403`: autenticado sin permiso. No reintentar; ocultar la acción.
final class ForbiddenFailure extends Failure {
  const ForbiddenFailure({
    super.message = 'No tienes permisos para realizar esta acción.',
    super.code = 'AUTHORIZATION_ERROR',
    super.fieldErrors,
    super.requestId,
  });
}

/// `404`: inexistente o fuera del `businessId` del token.
final class NotFoundFailure extends Failure {
  const NotFoundFailure({
    super.message = 'No encontramos lo que buscabas.',
    super.code = 'NOT_FOUND_ERROR',
    super.fieldErrors,
    super.requestId,
  });
}

/// `400` de esquema: corregir campos. Trae [Failure.fieldErrors].
final class ValidationFailure extends Failure {
  const ValidationFailure({
    required super.message,
    super.code = 'VALIDATION_ERROR',
    super.fieldErrors,
    super.requestId,
  });

  /// Error de [path], o `null` si el backend no lo mencionó.
  FieldError? errorFor(String path) {
    for (final FieldError error in fieldErrors) {
      if (error.path == path) return error;
    }
    return null;
  }
}

/// `409`: conflicto de estado (silla ocupada, transición inválida, duplicado).
final class ConflictFailure extends Failure {
  const ConflictFailure({
    super.message = 'Este recurso cambió mientras lo editabas. Actualiza e '
        'inténtalo de nuevo.',
    super.code = 'CONFLICT_ERROR',
    super.fieldErrors,
    super.requestId,
  });
}

/// `422` de regla de negocio (`PRODUCT_UNAVAILABLE`, `CHAIR_OCCUPIED`…).
final class BusinessRuleFailure extends Failure {
  const BusinessRuleFailure({
    required super.message,
    super.code = 'BUSINESS_RULE_ERROR',
    super.fieldErrors,
    super.requestId,
  });
}

/// `402 PAYMENT_ERROR`: rechazo del proveedor o fondos insuficientes. NO es
/// reintentable a ciegas (repetir un cobro puede duplicar el cargo), así que la
/// UI pide cambiar de método de pago (API.md §4).
final class PaymentFailure extends Failure {
  const PaymentFailure({
    super.message = 'El pago no fue aprobado. Intenta con otro método de pago.',
    super.code = 'PAYMENT_ERROR',
    super.fieldErrors,
    super.requestId,
    this.provider,
  });

  /// `details.provider` (`STRIPE`, `WOMPI`...), nunca su mensaje crudo.
  final String? provider;
}

/// `429 RATE_LIMIT_ERROR`: reintentable, pero solo tras `Retry-After` (§4).
final class RateLimitFailure extends Failure {
  const RateLimitFailure({
    super.message = 'Demasiados intentos. Espera un momento y vuelve a probar.',
    super.code = 'RATE_LIMIT_ERROR',
    super.fieldErrors,
    super.requestId,
    this.retryAfterSeconds,
  });

  /// Segundos que el servidor sugiere esperar (cabecera `Retry-After`).
  final int? retryAfterSeconds;
}

/// Sin conexión según la sonda de `core/network/connectivity.dart`.
final class OfflineFailure extends Failure {
  const OfflineFailure({
    super.message = 'Estás sin conexión. Revisa los datos cuando vuelvas a la red.',
    super.code = 'OFFLINE',
  });
}

/// Cualquier otro caso (bug de cliente, excepción no clasificada). En debug
/// lleva [details] para el reporte de soporte; en release no se muestra.
final class UnknownFailure extends Failure {
  const UnknownFailure({
    super.message = 'Ocurrió un error inesperado. Inténtalo de nuevo.',
    super.code = 'UNKNOWN',
    super.requestId,
    this.details,
  });

  /// Traza técnica. Solo visible en modo debug (`ErrorState.showDetails`).
  final String? details;
}
