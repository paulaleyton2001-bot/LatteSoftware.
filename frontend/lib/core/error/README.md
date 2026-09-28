# core/error

Normalización de errores. Este es el ÚNICO lugar donde se conocen los códigos
HTTP y `error.code` de `docs/API.md` §4.

- `failures.dart`: `sealed class Failure` con mensaje en español para UI.
- `error_mapper.dart`: respuesta HTTP / excepción de dio → `Failure`.

`domain/` y `data/` lanzan/producen `Failure`; `shared/widgets/ui` las pinta.
