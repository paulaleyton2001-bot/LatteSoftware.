# domain

Capa de dominio: entidades y contratos. Reglas (docs/DESIGN.md §3):

- Importa solo `package:` y `core/`. **Nunca** `data/`, `shared/widgets/` ni
  Flutter material para lógica de negocio.
- Las entidades son `freezed` (inmutables, `==` por valor, `copyWith`).
- El dinero es `int` en centavos (`*Minor`); el tiempo es `DateTime` UTC.
- No conoce Riverpod: expone interfaces (`abstract class XRepository`).
