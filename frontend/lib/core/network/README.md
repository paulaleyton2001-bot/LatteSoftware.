# core/network

Cliente HTTP sobre `dio` (`api_client.dart`) e interceptores.

## Orden de listados: por qué casi ningún datasource manda `sort`

`docs/API.md` §5.1 documenta el parámetro `sort` en **camelCase**
(`sortOrder`, `createdAt`, `startAt`, `currentStock`…), que es como viaja
`camelCase` en el resto de la query. El backend, sin embargo, compara ese valor
contra la **allowlist de columnas de su base de datos**, que está en
`snake_case` (`sort_order`, `created_at`, `start_at`, `current_stock`…), y solo
compara con `toLowerCase()`
(`backend/src/shared/http/pagination.ts::parseSort`):

```ts
const match = allowedColumns.find((column) => column.toLowerCase() === requested.toLowerCase());
```

`sortOrder`.toLowerCase() es `sortorder` y no casa con `sort_order`, así que
toda petición que mande el valor del contrato recibe:

```json
{ "code": "VALIDATION_ERROR",
  "details": [{ "path": "sort", "code": "INVALID_SORT_FIELD",
                "message": "No se permite ordenar por \"sortOrder\"" }] }
```

**Es una desviación del backend respecto a su propio contrato** (la única
excepción es `GET /chairs/:id/history`, cuya allowlist sí está en camelCase) y
no se corrige aquí: los listados de la app devolvían `400` y, con ellos, el
menú entero.

Solución aplicada en el cliente: **no mandar `sort` cuando solo se repite la
columna por defecto del endpoint**. `parseSort` usa `defaultColumn` cuando no
llega `sort` y aplica encima el `order` recibido, así que quitar el parámetro
conserva EXACTAMENTE el orden pedido y, a la vez, es válido tanto contra el
backend actual como contra uno que empiece a aceptar el camelCase del
contrato (mandar `sort_order` hoy, en cambio, dejaría de funcionar el día que
el backend se arreglara).

Dónde sí se manda `sort` es donde el valor no se parece al default o donde el
backend lo acepta tal cual (`name`, `code`, y el `startAt` del historial de una
silla).

Cuando el backend acepte el camelCase de `docs/API.md`, estos datasource pueden
volver a declarar el orden explícitamente; no hace falta ningún otro cambio.
