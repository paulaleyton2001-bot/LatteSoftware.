// Resultado de una operación de la capa de datos.
//
// Objetivo: el manejo de errores sin excepciones. Los repositorios devuelven
// `Result<T>`; los providers Riverpod lo convierten en `AsyncValue<T>`; la UI
// nunca ve excepciones de red.
//
// Regla: una función que devuelve `Result<T>` NUNCA lanza.
import 'package:flutter/foundation.dart';
import '../error/failures.dart';



/// Unión exhaustiva del resultado de una operación.
@immutable
sealed class Result<T> {
  const Result();

  /// Discriminante para `switch` pattern.
  bool get isSuccess => this is Success<T>;

  /// Discriminante para `switch` pattern.
  bool get isFailure => this is FailureResult<T>;

  /// Valor si es éxito, `null` si falló.
  T? get valueOrNull => switch (this) {
        Success<T>(:final T value) => value,
        FailureResult<T>() => null,
      };

  /// Fallo si falló, `null` si tuvo éxito.
  Failure? get failureOrNull => switch (this) {
        Success<T>() => null,
        FailureResult<T>(:final Failure failure) => failure,
      };

  /// Transforma el valor de éxito dejando intacto el fallo.
  Result<R> map<R>(R Function(T value) transform) => switch (this) {
        Success<T>(:final T value) => Success<R>(transform(value)),
        FailureResult<T>(:final Failure failure) => FailureResult<R>(failure),
      };

  /// Encadena otra operación que también puede fallar.
  Result<R> flatMap<R>(Result<R> Function(T value) transform) => switch (this) {
        Success<T>(:final T value) => transform(value),
        FailureResult<T>(:final Failure failure) => FailureResult<R>(failure),
      };

  /// Valor de éxito o `fallback`.
  T getOrElse(T fallback) => valueOrNull ?? fallback;

  /// Lanza el fallo si la operación falló. Reservado para tests y para el
  /// límite de la capa (el widget raíz), nunca en medio de la UI.
  T getOrThrow() => switch (this) {
        Success<T>(:final T value) => value,
        FailureResult<T>(:final Failure failure) => throw failure,
      };
}

/// Operación exitosa.
@immutable
final class Success<T> extends Result<T> {
  const Success(this.value);

  final T value;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Success<T> &&
          runtimeType == other.runtimeType &&
          value == other.value;

  @override
  int get hashCode => Object.hash(runtimeType, value);

  @override
  String toString() => 'Success<$T>($value)';
}

/// Operación fallida. Envuelve una [Failure] ya normalizada.
@immutable
final class FailureResult<T> extends Result<T> {
  const FailureResult(this.failure);

  final Failure failure;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is FailureResult<T> &&
          runtimeType == other.runtimeType &&
          failure == other.failure;

  @override
  int get hashCode => Object.hash(runtimeType, failure);

  @override
  String toString() => 'FailureResult<$T>($failure)';
}
