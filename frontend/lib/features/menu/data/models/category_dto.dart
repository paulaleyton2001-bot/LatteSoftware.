// DTO de la categoría del menú. Módulo `features/menu/data`.
//
// Separado del DTO de producto porque las dos cosas se piden por endpoints
// distintos (`GET /categories` y `GET /products`) y se cachean por separado: mezclarlas
// obligaría a un archivo de 300 líneas con dos entidades que no se usan juntas.
//
// REFLEJA EL JSON, NO EL DOMINIO
// `icon` es un `string` corto del vocabulario del negocio, no un `IconData`: un
// ícono desconocido del backend no debe romper la fila de chips.

import '../../../../data/models/json_reader.dart';
import '../../domain/entities/menu_category.dart';

/// `GET /api/v1/categories`.
class MenuCategoryDto {
  const MenuCategoryDto({
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
  final String? icon;
  final int sortOrder;
  final bool isActive;
  final int productCount;
  final int activeProductCount;

  static MenuCategoryDto? fromJson(Object? json) {
    // `JsonReader.map` devuelve `null` si no es un objeto; `orEmpty` lo traduce
    // a mapa vacío, que el `isEmpty` de abajo ya convierte en `null`.
    final Map<String, dynamic> map = JsonReader.orEmpty(json);
    if (map.isEmpty) return null;
    final int? id = JsonReader.integer(map['id']);
    final String? name = JsonReader.string(map['name']);
    if (id == null || name == null) return null;

    return MenuCategoryDto(
      id: id,
      name: name,
      slug: JsonReader.string(map['slug']),
      description: JsonReader.string(map['description']),
      imageUrl: JsonReader.string(map['imageUrl']),
      icon: JsonReader.string(map['icon']),
      sortOrder: JsonReader.integerOr(map['sortOrder'], 0),
      isActive: JsonReader.boolean(map['isActive'], fallback: true),
      productCount: JsonReader.integerOr(map['productCount'], 0),
      activeProductCount: JsonReader.integerOr(map['activeProductCount'], 0),
    );
  }

  MenuCategory toEntity() => MenuCategory(
        id: id,
        name: name,
        slug: slug,
        description: description,
        imageUrl: imageUrl,
        icon: icon,
        sortOrder: sortOrder,
        isActive: isActive,
        productCount: productCount,
        activeProductCount: activeProductCount,
      );
}
