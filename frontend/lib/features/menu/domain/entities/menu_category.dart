// Categoría del menú (API.md §6.3 → tabla de `GET /api/v1/categories`).

import 'package:flutter/foundation.dart';
//
// entidad de dominio, no DTO: no sabe de JSON. El mapeo vive en
// `features/menu/data/models/catalog_dto.dart`.
//
// `icon` es un `string` corto del vocabulario del negocio (`freezed_annotation`
// no aplica aquí). La UI lo resuelve a un `IconData` con el catálogo de
// `features/menu/presentation/category_icon_resolver.dart`; un valor desconocido
// cae en un ícono genérico en vez de romper la fila de chips.


/// Categoría del menú.
@immutable
class MenuCategory {
  const MenuCategory({
    required this.id,
    required this.name,
    this.slug,
    this.description,
    this.imageUrl,
    this.icon,
    this.sortOrder = 0,
    this.isActive = true,
    this.productCount = 0,
    this.activeProductCount = 0,
  });

  final int id;
  final String name;
  final String? slug;
  final String? description;
  final String? imageUrl;

  /// Clave de ícono del negocio (`'coffee'`, `'food'`, ...), o `null`.
  final String? icon;

  final int sortOrder;
  final bool isActive;

  /// Productos totales de la categoría (`includeProductCount=true`).
  final int productCount;

  /// Productos activos y disponibles. Es el número que se muestra en el chip:
  /// un filtro con 0 productos no debe llevar a una pantalla vacía.
  final int activeProductCount;

  int get selectableCount => activeProductCount > 0 ? activeProductCount : productCount;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is MenuCategory &&
          other.id == id &&
          other.name == name &&
          other.sortOrder == sortOrder &&
          other.activeProductCount == activeProductCount;

  @override
  int get hashCode => Object.hash(id, name, sortOrder, activeProductCount);

  @override
  String toString() => 'MenuCategory($id, $name)';
}
