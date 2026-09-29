// Error de validación de un campo concreto.

import 'package:flutter/foundation.dart';
//
// Vive aparte de `failures.dart` para que el catálogo de fallos (que es `sealed`
// y por tanto no se puede partir en libraries distintas) no crezca con una clase
// que no participa en la jerarquía. Se reexporta desde `failures.dart`, así que
// quien importa el catálogo sigue viendo [FieldError].


/// Una fila de `error.details` de la API: `{ path, message, code }`.
///
/// API.md §3.2 admite tres formas de `details` (array de campos, objeto, array
/// de objetos); solo esta produce un `FieldError`.
@immutable
final class FieldError {
  const FieldError({required this.path, required this.message, this.code});

  /// Ruta del campo en el body/query (`email`, `items.0.quantity`).
  final String path;

  /// Mensaje en español provisto por el backend, apto para pintarse bajo el
  /// input sin reescribirlo.
  final String message;

  /// Código de la validación (`INVALID_FORMAT`, `REQUIRED`, ...).
  final String? code;

  @override
  String toString() => 'FieldError($path: $message)';
}
