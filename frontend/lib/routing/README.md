# routing

Pertenencias del enrutado. Las rutas están declaradas en
`app/router.dart` (con placeholders); aquí irá lo que depende de la sesión:

- `route_names.dart`: nombres constantes de ruta (re-exportados de app/router.dart
  mientras no haya redirección).
- `guards.dart`: `redirect` por sesión y permiso (`GET /auth/me.permissions`,
  BR-RBAC-005) e intercepción de 401.
- `stateful_shell.dart`: shell de rutas indexadas para que la sidebar de admin
  conserve el estado de cada pestaña.
