# data

Implementaciones de `domain/repositories`.

- `models/`: DTO + `json_serializable`. Son el reflejo del JSON de la API y
  aportan los `fromJson`/`toJson`; no contienen reglas de negocio.
- `datasources/remote/`: llamadas a `dio` por endpoint.
- `datasources/local/`: caché en `shared_preferences` / disco.
- `repositories/`: implementaciones que traducen DTO → entidad y
  `DioException` → `Failure` (usando `core/error/error_mapper.dart`).
