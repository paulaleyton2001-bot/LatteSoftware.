// Entidad de usuario (`User` de `docs/API.md` §6.3).

import 'package:flutter/foundation.dart';
//
// DECISIÓN: `roles` y `permissions` son `List<String>`, no enums. `GET /auth/me`
// devuelve la unión COMPLETA de claves de permisos (BR-RBAC-005) y el backend
// puede agregar roles: con un enum, un rol nuevo rompería el parseo y dejaría al
// usuario sin sesión. La app compara CLAVES de permiso, no hace switch por rol.
//
// `AuthSession` (tokens + actor) vive en `auth_session.dart`; los DTO de red, en
// `data/models/user_dto.dart`; el JSON de la caché local, en
// `core/storage/user_cache_codec.dart`.


/// Actor autenticado. Inmutable y comparable por valor.
@immutable
class User {
  const User({
    required this.id,
    required this.email,
    this.fullName,
    this.phone,
    this.photoUrl,
    this.status = 'ACTIVE',
    this.roles = const <String>[],
    this.permissions = const <String>[],
    this.isStaff = false,
    this.emailVerifiedAt,
    this.lastLoginAt,
  });

  /// `id` de `users.id` (entero, nunca string: API.md §1).
  final int id;

  /// Correo, ya normalizado a minúsculas por el backend.
  final String email;

  /// Nombre completo. `null` si el usuario aún no lo completó.
  final String? fullName;

  /// Teléfono E.164 (`+573001234567`).
  final String? phone;

  /// Foto de perfil (URL http/https).
  final String? photoUrl;

  /// `UserStatus`: `ACTIVE`, `INACTIVE` o `BLOCKED` (API.md §6.2).
  final String status;

  /// Roles asignados (`CUSTOMER`, `CASHIER`, `MANAGER`, `ADMIN`, `OWNER`).
  final List<String> roles;

  /// Unión de permisos de todos sus roles (BR-RBAC-005). La UI filtra
  /// navegación con esta lista, nunca con una matriz de roles duplicada.
  final List<String> permissions;

  /// `true` si es empleado del negocio (caja, salón, administración).
  final bool isStaff;

  final DateTime? emailVerifiedAt;
  final DateTime? lastLoginAt;

  /// `true` si la cuenta está activa. `BLOCKED`/`INACTIVE` no pueden operar:
  /// el backend responde `403` y la app debe cerrar sesión.
  bool get isActive => status == 'ACTIVE';

  /// `true` si tiene el permiso [permission] exacto.
  bool hasPermission(String permission) => permissions.contains(permission);


  /// `true` si tiene alguno de [anyOf].
  bool hasAnyPermission(Iterable<String> anyOf) {
    for (final String permission in anyOf) {
      if (permissions.contains(permission)) return true;
    }
    return false;
  }

  /// `true` si tiene el rol [role] (insensible a mayúsculas).
  bool hasRole(String role) =>
      roles.any((String item) => item.toUpperCase() == role.toUpperCase());

  /// Nombre a mostrar: el completo, o el correo si no hay nombre.
  String get displayName {
    final String? name = fullName?.trim();
    if (name == null || name.isEmpty) return email;
    return name;
  }

  /// Iniciales para el monograma del perfil (máx. 2). Usa `runes`, no
  /// `substring`, para no partir un emoji en dos code units inválidas.
  String get initials {
    final List<String> parts = displayName
        .trim()
        .split(RegExp(r'\s+'))
        .where((String part) => part.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return _firstLetter(parts.first);
    return (_firstLetter(parts.first) + _firstLetter(parts.last))
        .toUpperCase();
  }

  /// Copia; `null` conserva el valor actual.
  User copyWith({
    String? fullName,
    String? phone,
    String? photoUrl,
    String? status,
    List<String>? roles,
    List<String>? permissions,
    bool? isStaff,
    DateTime? emailVerifiedAt,
    DateTime? lastLoginAt,
  }) {
    return User(
      id: id,
      email: email,
      fullName: fullName ?? this.fullName,
      phone: phone ?? this.phone,
      photoUrl: photoUrl ?? this.photoUrl,
      status: status ?? this.status,
      roles: roles ?? this.roles,
      permissions: permissions ?? this.permissions,
      isStaff: isStaff ?? this.isStaff,
      emailVerifiedAt: emailVerifiedAt ?? this.emailVerifiedAt,
      lastLoginAt: lastLoginAt ?? this.lastLoginAt,
    );
  }

  /// Serialización MÍNIMA para la caché local (sin secretos: son datos que ya
  /// expone `GET /auth/me`). El JSON se lee/escribe en
  /// `core/storage/user_cache_codec.dart`.
  Map<String, dynamic> toJson() => <String, dynamic>{
        'id': id,
        'email': email,
        'fullName': fullName,
        'phone': phone,
        'photoUrl': photoUrl,
        'status': status,
        'roles': roles,
        'permissions': permissions,
        'isStaff': isStaff,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is User &&
          other.id == id &&
          other.email == email &&
          other.fullName == fullName &&
          other.phone == phone &&
          other.photoUrl == photoUrl &&
          other.status == status &&
          other.isStaff == isStaff &&
          _sameList(other.roles, roles) &&
          _sameList(other.permissions, permissions);

  @override
  int get hashCode => Object.hash(id, email, fullName, phone, photoUrl, status,
      isStaff, Object.hashAll(roles), Object.hashAll(permissions));

  @override
  String toString() => 'User($id, $email, roles: $roles)';
}

String _firstLetter(String value) =>
    value.isEmpty ? '' : String.fromCharCode(value.runes.first);

bool _sameList(List<String> a, List<String> b) {
  if (identical(a, b)) return true;
  if (a.length != b.length) return false;
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
