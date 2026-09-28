# core/result

`Result<T>` sellado: `Success<T>` | `FailureResult<T>`.

Regla: una función que devuelve `Result<T>` nunca lanza. Los providers Riverpod
convierten `Result` en `AsyncValue` y `AsyncStateBuilder` lo renderiza.
