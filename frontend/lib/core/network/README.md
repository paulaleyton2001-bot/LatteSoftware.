# core/network  (fase siguiente)

Cliente HTTP sobre `dio`.

Pendiente:
- `dio_client.dart`: instancia con `baseUrl` de `AppConfig`, timeouts, retry con
  backoff para 5xx y errores de red, `CancelToken` por request.
- `auth_interceptor.ts` → `auth_interceptor.dart`: inyecta `Bearer`, refresca el
  token UNA sola vez ante 401 (lock compartido) y no reintenta endpoints de auth.
- `connectivity.dart`: expone `OfflineFailure` cuando no hay red.
- `api_endpoints.dart`: rutas de `docs/API.md` §7 como constantes.

`ErrorMapper.fromResponse` ya está listo para ser invocado desde aquí.
