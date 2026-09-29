// Entidades de clientes, descuentos, usuarios y configuración del negocio.
//
// Ver `admin_catalog.dart` para el criterio de agrupación.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

/// Ficha de cliente en el listado de administración.
@immutable
class AdminCustomer {
  const AdminCustomer({
    required this.id,
    required this.fullName,
    required this.email,
    this.phone,
    this.status = 'ACTIVE',
    this.totalOrders = 0,
    this.totalSpentMinor = 0,
    this.activeReservations = 0,
    this.activeRentals = 0,
    this.lastOrderAt,
    this.createdAt,
  });

  final int id;
  final String fullName;
  final String email;
  final String? phone;
  final String status;

  // El listado (`GET /customers`) agrega estos campos; el detalle
  // (`GET /customers/:id`) trae `stats` anidadas. Aquí van aplanados para que la
  // tabla y la ficha lean del mismo tipo.
  final int totalOrders;
  final int totalSpentMinor;
  final int activeReservations;
  final int activeRentals;
  final DateTime? lastOrderAt;
  final DateTime? createdAt;

  /// `true` si la cuenta se puede usar. Se DERIVA de [status] y no es un campo
  /// más: el cliente no mantiene una tabla de estados, y un `isActive` guardado
  /// aparte se quedaría viejo si el backend añadiera un estado nuevo.
  bool get isActive => status == 'ACTIVE';

  String get initials {
    final List<String> parts =
        fullName.trim().split(RegExp(r'\s+')).where((String p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1))
        .toUpperCase();
  }

  /// Parsea tanto el listado plano como el detalle con `stats` anidadas.
  static AdminCustomer? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    final Map<String, dynamic> stats = JsonReader.orEmpty(json['stats']);
    final Object? spent = json['totalSpentMinor'] ?? stats['totalSpentMinor'];
    return AdminCustomer(
      id: id,
      fullName: JsonReader.stringOr(json['fullName'], 'Sin nombre'),
      email: JsonReader.stringOr(json['email'], ''),
      phone: JsonReader.string(json['phone']),
      status: JsonReader.stringOr(json['status'], 'ACTIVE'),
      totalOrders: JsonReader.integerOr(
        json['totalOrders'] ?? stats['totalOrders'],
        0,
      ),
      totalSpentMinor: JsonReader.integerOr(spent, 0),
      activeReservations: JsonReader.integerOr(stats['activeReservations'], 0),
      activeRentals: JsonReader.integerOr(stats['activeRentals'], 0),
      lastOrderAt: JsonReader.dateTime(json['lastOrderAt'] ?? stats['lastOrderAt']),
      createdAt: JsonReader.dateTime(json['createdAt']),
    );
  }

  @override
  String toString() => 'AdminCustomer($id, $fullName)';
}

/// Cupón de descuento.
@immutable
class AdminDiscount {
  const AdminDiscount({
    required this.id,
    required this.code,
    required this.name,
    required this.type,
    required this.value,
    this.description,
    this.minOrderMinor = 0,
    this.maxDiscountMinor,
    this.appliesTo = 'ALL',
    this.usageLimit,
    this.usageLimitPerCustomer,
    this.usedCount = 0,
    this.startsAt,
    this.endsAt,
    this.isActive = true,
    this.isCurrentlyValid = false,
    this.stackable = false,
  });

  final int id;
  final String code;
  final String name;
  final String? description;

  /// `DiscountType`: `PERCENT` o `FIXED`.
  final String type;

  /// En `PERCENT` son BASIS POINTS (1000 = 10 %); en `FIXED`, centavos.
  ///
  /// OJO: la misma palabra `value` significa dos cosas según `type`. No se
  /// "normaliza" aquí: la conversión vive en la vista, donde se sabe el tipo.
  final int value;

  final int minOrderMinor;
  final int? maxDiscountMinor;
  final String appliesTo;
  final int? usageLimit;
  final int? usageLimitPerCustomer;
  final int usedCount;
  final DateTime? startsAt;
  final DateTime? endsAt;
  final bool isActive;

  /// Lo calcula el backend (vigencia + límites). La app lo muestra, no lo decide.
  final bool isCurrentlyValid;

  final bool stackable;

  /// `true` si es un porcentaje.
  bool get isPercent => type == 'PERCENT';

  /// Porcentaje ya dividido (0-100). Solo válido si [isPercent].
  double get percent => isPercent ? value / 100 : 0;

  /// Usos que quedan, o `null` si es ilimitado.
  int? get remainingUses =>
      usageLimit == null ? null : (usageLimit! - usedCount).clamp(0, usageLimit!);

  static AdminDiscount? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminDiscount(
      id: id,
      code: JsonReader.stringOr(json['code'], '—'),
      name: JsonReader.stringOr(json['name'], 'Cupón $id'),
      description: JsonReader.string(json['description']),
      type: JsonReader.stringOr(json['type'], 'FIXED'),
      value: JsonReader.integerOr(json['value'], 0),
      minOrderMinor: JsonReader.integerOr(json['minOrderMinor'], 0),
      maxDiscountMinor: JsonReader.integer(json['maxDiscountMinor']),
      appliesTo: JsonReader.stringOr(json['appliesTo'], 'ALL'),
      usageLimit: JsonReader.integer(json['usageLimit']),
      usageLimitPerCustomer: JsonReader.integer(json['usageLimitPerCustomer']),
      usedCount: JsonReader.integerOr(json['usedCount'], 0),
      startsAt: JsonReader.dateTime(json['startsAt']),
      endsAt: JsonReader.dateTime(json['endsAt']),
      isActive: JsonReader.boolean(json['isActive'], fallback: true),
      isCurrentlyValid: JsonReader.boolean(json['isCurrentlyValid']),
      stackable: JsonReader.boolean(json['stackable']),
    );
  }

  @override
  String toString() => 'AdminDiscount($code)';
}

/// Usuario del equipo. `roles` y `permissions` vienen de `GET /auth/me` o
/// `GET /users/:id`, igual que en `domain/entities/user.dart`.
@immutable
class AdminUser {
  const AdminUser({
    required this.id,
    required this.email,
    this.fullName,
    this.phone,
    this.status = 'ACTIVE',
    this.roles = const <String>[],
    this.permissions = const <String>[],
    this.isStaff = false,
    this.lastLoginAt,
    this.createdAt,
  });

  final int id;
  final String email;
  final String? fullName;
  final String? phone;
  final String status;
  final List<String> roles;
  final List<String> permissions;
  final bool isStaff;
  final DateTime? lastLoginAt;
  final DateTime? createdAt;

  String get displayName {
    final String? name = fullName?.trim();
    if (name == null || name.isEmpty) return email;
    return name;
  }

  bool get isActive => status == 'ACTIVE';

  /// `true` si tiene el permiso [permission] exacto.
  bool hasPermission(String permission) => permissions.contains(permission);

  static AdminUser? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminUser(
      id: id,
      email: JsonReader.stringOr(json['email'], 'usuario $id'),
      fullName: JsonReader.string(json['fullName']),
      phone: JsonReader.string(json['phone']),
      status: JsonReader.stringOr(json['status'], 'ACTIVE'),
      roles: JsonReader.stringList(json['roles']),
      permissions: JsonReader.stringList(json['permissions']),
      isStaff: JsonReader.boolean(json['isStaff']),
      lastLoginAt: JsonReader.dateTime(json['lastLoginAt']),
      createdAt: JsonReader.dateTime(json['createdAt']),
    );
  }

  @override
  String toString() => 'AdminUser($id, $email)';
}

/// Resultado de `POST /users`: el usuario creado y, si el backend generó una
/// contraseña, la temporal.
///
/// `temporaryPassword` viene en `meta` y se devuelve UNA sola vez (API.md §7.2):
/// si la pantalla no la muestra en el momento, se pierde y hay que resetear. Por
/// eso viaja unida al usuario en el retorno, en lugar de que alguien tenga que
/// releer la respuesta HTTP.
class AdminUserCreated {
  const AdminUserCreated({required this.user, this.temporaryPassword});

  final AdminUser user;

  /// `null` si el admin envió contraseña propia.
  final String? temporaryPassword;

  /// `true` si hay que mostrar la temporal: solo hay una oportunidad.
  bool get hasTemporaryPassword =>
      temporaryPassword != null && temporaryPassword!.isNotEmpty;

  @override
  String toString() => 'AdminUserCreated(${user.id}, temporal: $hasTemporaryPassword)';
}
