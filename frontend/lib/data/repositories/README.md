# data/repositories

Implementaciones de `domain/repositories`. Traducen:

1. `DioException` / respuesta de error → `Failure` (con `ErrorMapper`).
2. DTO → entidad de `domain/entities` (aplicando los `*Minor` como `int`).
3. `Result<T>` con el tipo de entidad del dominio.
