// Estado de la pantalla de Usuarios del panel.
//
// LA MATRIZ DE ROLES NO EXISTE EN EL CLIENTE
// `GET /auth/me` y `GET /users/:id` devuelven `roles[]` y la unión COMPLETA de
// `permissions[]` (BR-RBAC-005). La app NO mantiene una tabla rol × permiso:
// duplicarla es exactamente lo que la norma prohíbe, y se quedaría vieja en cuanto
// el backend añadiera un rol.
//
// LOS `roleId` VIENEN DE `/meta/roles`
// `POST /users/:id/roles` exige el ID del rol, y `GET /users/:id` devuelve los roles
// por NOMBRE. Sin `GET /meta/roles` no hay forma de asignar uno sin inventar los ids.
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../data/models/json_reader.dart';
import '../domain/entities/admin_accounts.dart';
import './admin_providers.dart';

/// Búsqueda por nombre o correo.
final StateProvider<String> adminUserSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Filtro por rol. `null` = todos.
final StateProvider<String?> adminUserRoleProvider =
    StateProvider<String?>((Ref ref) => null);

/// Filtro por estado. `null` = todos.
final StateProvider<String?> adminUserStatusProvider =
    StateProvider<String?>((Ref ref) => null);

/// Listado de usuarios.
final FutureProvider<List<AdminUser>> adminUsersProvider =
    FutureProvider<List<AdminUser>>(
  (Ref ref) async {
    final Result<List<AdminUser>> result =
        await ref.watch(adminDirectoryRepositoryProvider).users(
              role: ref.watch(adminUserRoleProvider),
              status: ref.watch(adminUserStatusProvider),
            );
    return switch (result) {
      Success<List<AdminUser>>(:final List<AdminUser> value) => value,
      FailureResult<List<AdminUser>>(:final Failure failure) => throw failure,
    };
  },
  name: 'adminUsers',
);

/// Usuarios tras la búsqueda en memoria.
final Provider<List<AdminUser>> adminVisibleUsersProvider =
    Provider<List<AdminUser>>((Ref ref) {
  final List<AdminUser> all =
      ref.watch(adminUsersProvider).valueOrNull ?? const <AdminUser>[];
  final String needle =
      ref.watch(adminUserSearchProvider).trim().toLowerCase();
  if (needle.isEmpty) return all;
  return <AdminUser>[
    for (final AdminUser user in all)
      if ('${user.displayName} ${user.email}'.toLowerCase().contains(needle))
        user,
  ];
}, name: 'adminVisibleUsers');

/// Un rol del catálogo (`GET /meta/roles`, PÚBLICA).
class AdminRole {
  const AdminRole({required this.id, required this.name, this.permissions = const <String>[], this.label});

  final int id;
  final String name;
  final List<String> permissions;
  final String? label;

  /// Nombre legible: el que trae el backend o el literal del enum.
  String get displayLabel => label ?? name;

  static AdminRole? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminRole(
      id: id,
      name: JsonReader.stringOr(json['name'], 'ROL $id'),
      label: JsonReader.string(json['label']),
      permissions: JsonReader.stringList(json['permissions']),
    );
  }
}

/// Roles del backend, con sus ids.
final FutureProvider<List<AdminRole>> adminRolesProvider =
    FutureProvider<List<AdminRole>>(
  (Ref ref) async {
    final Result<List<Map<String, dynamic>>> result =
        await ref.read(adminDirectoryRepositoryProvider).roles();
    return switch (result) {
      Success<List<Map<String, dynamic>>>(:final List<Map<String, dynamic>> value) =>
        <AdminRole>[
          for (final Map<String, dynamic> row in value)
            if (AdminRole.tryParse(row) case final AdminRole role) role,
        ],
      FailureResult<List<Map<String, dynamic>>>() => const <AdminRole>[],
    };
  },
  name: 'adminRoles',
);

/// Alta de usuario del equipo.
///
/// Su propio provider, separado de [adminUserProvider] (que acts sobre un id ya
/// existente) porque la entrada es el FORMULARIO, no un id: el resultado es el
/// usuario creado y, si el backend generó contraseña, la temporal. Perder esa
/// temporal es irreversible — hay que resetear — así que se entrega junto al alta
/// y la pantalla la muestra en el acto.
final AsyncNotifierProvider<AdminUserCreateController, AdminUserCreated?>
    adminUserCreateProvider =
    AsyncNotifierProvider<AdminUserCreateController, AdminUserCreated?>(
  AdminUserCreateController.new,
);

/// Estado del alta: `null` = sin intento; en carga = enviando; con error = fallo.
class AdminUserCreateController extends AsyncNotifier<AdminUserCreated?> {
  @override
  FutureOr<AdminUserCreated?> build() => null;

  /// Envía el alta. Devuelve lo creado, o `null` si el backend lo rechazó.
  ///
  /// Los errores NO se relanzan: la pantalla los lee de [state] para mostrarlos
  /// junto al formulario, no en un `catch` que deja el diálogo a medio cerrar.
  Future<AdminUserCreated?> submit({
    required String fullName,
    required String email,
    required String password,
    required List<AdminRole> roles,
  }) async {
    if (state.isLoading) return null;
    if (roles.isEmpty) {
      // El backend lo rechaza con 400 igual; avisar aquí evita el viaje de ida
      // y vuelta y explica el motivo en el sitio donde se equivocó.
      state = AsyncError<AdminUserCreated?>(
        const BusinessRuleFailure(
          code: 'roles_requeridos',
          message: 'Elige al menos un rol: el backend no acepta un alta sin él.',
        ),
        StackTrace.current,
      );
      return null;
    }
    state = const AsyncLoading<AdminUserCreated?>();
    final Result<AdminUserCreated> result =
        await ref.read(adminDirectoryRepositoryProvider).createUser(
              <String, dynamic>{
                'email': email.trim(),
                'fullName': fullName.trim(),
                // El esquema es `.strict()`: solo se manda `password` si el
                // admin escribió una. Mandarla vacía es un 400, y mandarla
                // siempre sería una contraseña de un espacio.
                if (password.isNotEmpty) 'password': password,
                // `Role` es un enum de NOMBRES, no de ids: el alta lleva
                // `roles: ['CASHIER']`. Los ids son de `POST /users/:id/roles`.
                'roles': <String>[
                  for (final AdminRole role in roles) role.name,
                ],
              },
            );
    // Sin guarda de disposal: `adminUserCreateProvider` no es `autoDispose`, así
    // que el notifier sobrevive al alta.
    switch (result) {
      case Success<AdminUserCreated>(:final AdminUserCreated value):
        state = AsyncData<AdminUserCreated?>(value);
        // El listado y el catálogo de roles quedan desfasados tras el alta.
        ref.invalidate(adminUsersProvider);
        return value;
      case FailureResult<AdminUserCreated>(:final Failure failure):
        state = AsyncError<AdminUserCreated?>(failure, StackTrace.current);
        return null;
    }
  }

  /// Limpia el error para reabrir el formulario sin el mensaje de antes.
  void reset() => state = const AsyncData<AdminUserCreated?>(null);
}

/// Acciones sobre un usuario.
final AsyncNotifierProviderFamily<AdminUserController, void, int>
    adminUserProvider =
    AsyncNotifierProvider.family<AdminUserController, void, int>(
  AdminUserController.new,
);

/// Controla las acciones de un usuario del equipo.
class AdminUserController extends FamilyAsyncNotifier<void, int> {
  @override
  FutureOr<void> build(int arg) {}

  /// `PATCH /users/:id/status`. Pasar a `BLOCKED` o `INACTIVE` revoca TODAS sus
  /// sesiones de inmediato, así que la UI pide confirmación antes.
  Future<bool> setStatus(String status, {String? reason}) => _run(
        () => ref
            .read(adminDirectoryRepositoryProvider)
            .setUserStatus(arg, status, reason: reason),
      );

  /// `POST /users/:id/roles`. Revoca los refresh tokens para que el cambio surta
  /// efecto en el siguiente refresh.
  Future<bool> assignRole(int roleId) => _run(
        () => ref.read(adminDirectoryRepositoryProvider).assignRole(arg, roleId),
      );

  /// `DELETE /users/:id/roles/:roleId`. Da `422 LAST_OWNER_PROTECTED` si se quita el
  /// rol al último `OWNER`; el mensaje del backend se muestra tal cual.
  Future<bool> removeRole(int roleId) => _run(
        () => ref.read(adminDirectoryRepositoryProvider).removeRole(arg, roleId),
      );

  Future<bool> _run(Future<Result<void>> Function() action) async {
    if (state.isLoading) return false;
    state = const AsyncLoading<void>();
    final Result<void> result = await action();
    // Sin guarda de disposal: `adminUserProvider` no es `autoDispose`, así que el
    // notifier sobrevive a cualquier `await`.
    switch (result) {
      case Success<void>():
        ref.invalidate(adminUsersProvider);
        state = const AsyncData<void>(null);
        return true;
      case FailureResult<void>(:final Failure failure):
        state = AsyncError<void>(failure, StackTrace.current);
        return false;
    }
  }

  void acknowledge() => state = const AsyncData<void>(null);
}
