// DTO del recurso `User` (API.md §6.3).
//
// Refleja el JSON de la red, no el dominio: por eso `status` viaja como `String`
// y no como enum (un `UserStatus` nuevo del backend no debe romper el parseo) y
// por eso `photoUrl` es `String?`. La conversión a entidad vive en [toEntity].
//
// El perfil cacheado en disco usa otro codec
// (`core/storage/user_cache_codec.dart`): son dos fuentes de datos distintas y
// no deben compartir código.

import '../../domain/entities/user.dart';
import 'json_reader.dart';

/// DTO de `User`.
class UserDto {
  const UserDto({
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

  final int id;
  final String email;
  final String? fullName;
  final String? phone;
  final String? photoUrl;
  final String status;
  final List<String> roles;
  final List<String> permissions;
  final bool isStaff;
  final DateTime? emailVerifiedAt;
  final DateTime? lastLoginAt;

  /// `null` si el JSON no trae `id` (obligatorio) o `email` (obligatorio): sin
  /// ellos no hay un actor identificable.
  static UserDto? fromJson(Object? json) {
    final Map<String, dynamic> map = JsonReader.map(json);
    if (map.isEmpty) return null;
    final int? id = JsonReader.integer(map['id']);
    final String? email = JsonReader.string(map['email']);
    if (id == null || email == null) return null;

    return UserDto(
      id: id,
      email: email,
      fullName: JsonReader.string(map['fullName']),
      phone: JsonReader.string(map['phone']),
      photoUrl: JsonReader.string(map['photoUrl']),
      status: JsonReader.stringOr(map['status'], 'ACTIVE'),
      roles: JsonReader.stringList(map['roles']),
      permissions: JsonReader.stringList(map['permissions']),
      isStaff: JsonReader.boolean(map['isStaff']),
      emailVerifiedAt: JsonReader.dateTime(map['emailVerifiedAt']),
      lastLoginAt: JsonReader.dateTime(map['lastLoginAt']),
    );
  }

  /// Entidad de dominio. `status` se pasa a mayúsculas para que la comparación
  /// con `'ACTIVE'` no dependa de cómo lo escriba el servidor.
  User toEntity() => User(
        id: id,
        email: email,
        fullName: fullName,
        phone: phone,
        photoUrl: photoUrl,
        status: status.toUpperCase(),
        roles: roles,
        permissions: permissions,
        isStaff: isStaff,
        emailVerifiedAt: emailVerifiedAt,
        lastLoginAt: lastLoginAt,
      );
}
