# core/config

Configuración leída en tiempo de compilación.

- `app_config.dart`: `API_BASE_URL` vía `--dart-define`, paginación, timeouts.

Regla: nada aquí lee `BuildContext` ni importa de `features/`.
