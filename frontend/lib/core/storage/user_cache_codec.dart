// Codec del perfil cacheado en almacenamiento local.
//
// `dart:convert` y el parseo de un perfil persistido son un problema de
// PERSISTENCIA, no de la entidad: por eso viven aquí y no en
// `domain/entities/user.dart`. Así la entidad se queda con comportamiento de
// dominio (`==`, `copyWith`, permisos) y la capa de presentación puede leer la
// caché sin importar `data/` (los DTO de red), que está prohibido.
//
// El JSON que se produce es el mismo de `GET /auth/me` (API.md §6.3), pero el
// codec de red (`data/models/user_dto.dart`) es OTRO: son fuentes distintas y no
// comparten código a propósito.

import 'dart:convert';

import '../../domain/entities/user.dart';

/// Lectura/escritura del perfil cacheado.
abstract final class UserCacheCodec {
  const UserCacheCodec._();

  /// Serializa [user] a JSON. `null` si falla la codificación.
  static String? encode(User user) {
    try {
      return jsonEncode(user.toJson());
    } on FormatException {
      return null;
    }
  }

  /// Deserializa un perfil. `null` si el JSON está corrupto, no es un objeto o
  /// le faltan `id`/`email`: sin esos dos campos no hay actor identificable y no
  /// se puede confiar en la caché.
  static User? decode(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return null;
      final Object? id = decoded['id'];
      final Object? email = decoded['email'];
      if (id is! int || email is! String) return null;
      return User(
        id: id,
        email: email,
        fullName: _text(decoded['fullName']),
        phone: _text(decoded['phone']),
        photoUrl: _text(decoded['photoUrl']),
        status: _text(decoded['status']) ?? 'ACTIVE',
        roles: _textList(decoded['roles']),
        permissions: _textList(decoded['permissions']),
        isStaff: decoded['isStaff'] == true,
      );
    } on FormatException {
      return null;
    }
  }

  static String? _text(Object? value) =>
      value is String && value.isNotEmpty ? value : null;

  static List<String> _textList(Object? value) => value is List
      ? value.whereType<String>().toList(growable: false)
      : const <String>[];
}
