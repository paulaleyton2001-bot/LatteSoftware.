// Llamadas HTTP de usuarios del equipo. MÓDULO `features/admin/data`.
//
// Verifica contra `backend/src/modules/users/users.routes.ts`.
//
// LOS ROLES VIENEN DEL BACKEND, NO DE UNA LISTA LOCAL
// `GET /auth/me` y `GET /users/:id` devuelven `roles[]` y la unión COMPLETA de
// `permissions[]` (BR-RBAC-005). La app NO mantiene una matriz rol × permiso:
// duplicarla es justo el error que la norma prohíbe, y se quedaría vieja en
// cuanto el backend añadiera un rol. Los ids de rol (`roleId`) NO vienen en la
// lista de usuarios: para asignar uno hay que leerlos de `GET /meta/roles`, que
// es PÚBLICA.
//
// EL ÚLTIMO PROPIETARIO ESTÁ PROTEGIDO
// Quitar el rol `OWNER` al último `OWNER` da `422 LAST_OWNER_PROTECTED`. La UI no
// puede saberlo de antemano, así que el mensaje del backend se muestra tal cual
// en vez de deshabilitar el botón a ciegas.

import 'package:dio/dio.dart';
import '../../../../../core/network/api_client.dart';
import '../../../../../core/network/api_endpoints.dart';
import '../../../domain/entities/admin_accounts.dart';

/// Datasource de usuarios del equipo.
class AdminUsersDataSource {
  const AdminUsersDataSource(this._dio);

  final Dio _dio;

  /// `GET /users` — listado del equipo con roles y permisos.
  Future<List<AdminUser>> users({
    String? query,
    String? role,
    String? status,
    bool? isStaff,
    int pageSize = 100,
  }) async {
    final Response<dynamic> response = await _dio.get<dynamic>(
      ApiEndpoints.users,
      queryParameters: <String, dynamic>{
        'pageSize': pageSize,
        // Sin `sort`: el defecto de `GET /users` ya es `createdAt desc`
        // (ver `core/network/README.md`, "Orden de listados").
        'order': 'desc',
        if (query != null && query.trim().length >= 2) 'q': query.trim(),
        if (role != null && role.isNotEmpty) 'role': role,
        if (status != null && status.isNotEmpty) 'status': status,
        if (isStaff != null) 'isStaff': isStaff,
      },
    );
    return _map(unwrapList(response.data), AdminUser.tryParse);
  }

  /// `GET /users/:id` — ficha con la unión completa de permisos.
  Future<AdminUser?> user(int userId) async {
    final Response<dynamic> response =
        await _dio.get<dynamic>(ApiEndpoints.userById(userId));
    return AdminUser.tryParse(unwrapData(response.data));
  }

  /// `POST /users` — alta de usuario del equipo.
  ///
  /// El backend exige `roles` con al menos un elemento (`createUserBodySchema`),
  /// y el esquema es `.strict()`: mandar claves de más es un 400, no un aviso.
  ///
  /// Si se omite `password`, el backend genera una temporal y la devuelve UNA vez
  /// en `meta.temporaryPassword`; por eso el retorno la incluye, en vez de dejar
  /// que la pantalla vuelva a leer la respuesta HTTP que ya no tiene.
  Future<AdminUserCreated> createUser(Map<String, dynamic> body) async {
    final Response<dynamic> response =
        await _dio.post<dynamic>(ApiEndpoints.users, data: body);
    final Map<String, dynamic> envelope = unwrapData(response.data);
    final AdminUser? user = AdminUser.tryParse(envelope);
    final Object? meta = response.data is Map<String, dynamic>
        ? (response.data as Map<String, dynamic>)['meta']
        : null;
    final Object? password =
        meta is Map<String, dynamic> ? meta['temporaryPassword'] : null;
    return AdminUserCreated(
      user: user ?? const AdminUser(id: 0, email: ''),
      temporaryPassword:
          password is String && password.isNotEmpty ? password : null,
    );
  }

  /// `PATCH /users/:id` — edición de nombre, teléfono, foto o email.
  ///
  /// NO se puede cambiar la contraseña aquí: hay `POST /users/:id/reset-password`.
  Future<void> updateUser(int userId, Map<String, dynamic> body) async {
    await _dio.patch<dynamic>(ApiEndpoints.userById(userId), data: body);
  }

  /// `PATCH /users/:id/status` — activar, inactivar o bloquear.
  ///
  /// `reason` es obligatorio si el destino es `BLOCKED`. Pasar a `BLOCKED` o
  /// `INACTIVE` revoca TODAS las sesiones del usuario.
  Future<void> setUserStatus(
    int userId,
    String status, {
    String? reason,
  }) async {
    await _dio.patch<dynamic>(
      ApiEndpoints.userStatus(userId),
      data: <String, dynamic>{
        'status': status,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
    );
  }

  /// `POST /users/:id/roles` — asigna un rol.
  ///
  /// El body lleva `roleId` (el ID del rol, no el nombre). Revoca los refresh
  /// tokens para que el cambio surta efecto en el siguiente refresh.
  Future<void> assignRole(int userId, int roleId) async {
    await _dio.post<dynamic>(
      ApiEndpoints.userRoles(userId),
      data: <String, dynamic>{'roleId': roleId},
    );
  }

  /// `DELETE /users/:id/roles/:roleId` — quita un rol.
  Future<void> removeRole(int userId, int roleId) async {
    await _dio.delete<dynamic>(ApiEndpoints.userRole(userId, roleId));
  }

  /// `POST /users/:id/reset-password` — reset administrativo.
  ///
  /// Con `sendEmail: false` el backend devuelve la contraseña temporal en `meta`,
  /// una sola vez. Se devuelve el `meta` entero y no solo la contraseña porque el
  /// diálogo necesita también `temporaryPasswordExpiresIn` para decir en alto el
  /// tiempo que le queda.
  Future<Map<String, dynamic>> resetPassword(int userId, {bool sendEmail = true}) async {
    final Response<dynamic> response = await _dio.post<dynamic>(
      ApiEndpoints.userResetPassword(userId),
      data: <String, dynamic>{'sendEmail': sendEmail},
    );
    return _metaOf(response.data);
  }

  /// `meta` del sobre de éxito, o un mapa vacío si el backend no lo manda.
  ///
  /// El sobre es `{ success, data, meta }` (`shared/http/response.ts`), y `meta`
  /// puede no traer lo que se busca. Por eso devuelve `Map<String, dynamic>` y no
  /// `dynamic`: quien lee decide qué clave falta.
  static Map<String, dynamic> _metaOf(Object? responseData) {
    if (responseData is! Map<String, dynamic>) return <String, dynamic>{};
    final Object? meta = responseData['meta'];
    return meta is Map<String, dynamic> ? meta : <String, dynamic>{};
  }

  static List<T> _map<T>(
    List<Map<String, dynamic>> rows,
    T? Function(Map<String, dynamic> row) parse,
  ) {
    final List<T> out = <T>[];
    for (final Map<String, dynamic> row in rows) {
      final T? item = parse(row);
      if (item != null) out.add(item);
    }
    return out;
  }
}
