// Producto del catálogo de gestión (versión completa, no la del POS).
//
// MÓDULO `features/admin/domain/entities`. El POS usa `PosCatalogItem`, que es la
// proyección ligera (`?fields=basic`); aquí está la versión de GESTIÓN con
// descripción, impuestos, stock y recuentos de variantes y complementos.
//
// `sku` es INMUTABLE en v1 (API.md §7.11): para reutilizar un SKU hay que dar de
// baja el producto y crear otro. El formulario de edición lo muestra como solo
// lectura por eso, no por descuido.

import 'package:flutter/foundation.dart';

import '../../../../data/models/json_reader.dart';

/// Producto del catálogo de gestión (versión completa, no la del POS).
@immutable
class AdminProduct {
  const AdminProduct({
    required this.id,
    required this.sku,
    required this.name,
    required this.basePriceMinor,
    this.promoPriceMinor,
    this.imageUrl,
    this.categoryId,
    this.categoryName,
    this.shortDescription,
    this.taxRateBp,
    this.trackStock = false,
    this.isFeatured = false,
    this.isAvailable = true,
    this.isActive = true,
    this.preparationMinutes = 5,
    this.sortOrder = 0,
    this.stock,
    this.variantCount = 0,
    this.addonCount = 0,
  });

  final int id;
  final String sku;
  final String name;
  final String? shortDescription;
  final String? imageUrl;
  final int? categoryId;
  final String? categoryName;

  /// Centavos. El precio con promoción se resuelve en `effectivePriceMinor`.
  final int basePriceMinor;
  final int? promoPriceMinor;

  /// `taxRateBp`: basis points. `null` = hereda el del negocio.
  final int? taxRateBp;

  final bool trackStock;
  final bool isFeatured;

  /// Disponibilidad COMERCIAL (`isAvailable`): agotado o fuera de temporada.
  final bool isAvailable;

  /// Existencia en el catálogo (`isActive`). Son cosas distintas (BR-PRICE-006).
  final bool isActive;

  final int preparationMinutes;
  final int sortOrder;

  /// Stock actual, o `null` si el producto no lleva control de stock.
  final double? stock;

  final int variantCount;
  final int addonCount;

  int get effectivePriceMinor => promoPriceMinor ?? basePriceMinor;
  bool get hasPromo => promoPriceMinor != null && promoPriceMinor! < basePriceMinor;

  /// Parseo tolerante. `null` si no trae `id`.
  static AdminProduct? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    final Map<String, dynamic> stockMap = JsonReader.orEmpty(json['stock']);
    return AdminProduct(
      id: id,
      sku: JsonReader.stringOr(json['sku'], 'SKU-$id'),
      name: JsonReader.stringOr(json['name'], 'Sin nombre'),
      shortDescription: JsonReader.string(json['shortDescription']),
      imageUrl: JsonReader.string(json['imageUrl']),
      categoryId: JsonReader.integer(json['categoryId']),
      categoryName: JsonReader.string(
        JsonReader.orEmpty(json['category'])['name'],
      ),
      basePriceMinor: JsonReader.integerOr(json['basePriceMinor'], 0),
      promoPriceMinor: JsonReader.integer(json['promoPriceMinor']),
      taxRateBp: JsonReader.integer(json['taxRateBp']),
      trackStock: JsonReader.boolean(json['trackStock']),
      isFeatured: JsonReader.boolean(json['isFeatured']),
      isAvailable: JsonReader.boolean(json['isAvailable'], fallback: true),
      isActive: JsonReader.boolean(json['isActive'], fallback: true),
      preparationMinutes: JsonReader.integerOr(json['preparationMinutes'], 5),
      sortOrder: JsonReader.integerOr(json['sortOrder'], 0),
      stock: stockMap.isEmpty ? null : _toDouble(stockMap['currentStock']),
      variantCount: JsonReader.mapList(json['variants']).length,
      addonCount: JsonReader.mapList(json['addons']).length,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AdminProduct &&
          other.id == id &&
          other.basePriceMinor == basePriceMinor &&
          other.promoPriceMinor == promoPriceMinor &&
          other.isAvailable == isAvailable &&
          other.isActive == isActive;

  @override
  int get hashCode =>
      Object.hash(id, basePriceMinor, promoPriceMinor, isAvailable, isActive);

  @override
  String toString() => 'AdminProduct($sku, $name)';
}

/// Categoría del catálogo.
@immutable
class AdminCategory {
  const AdminCategory({
    required this.id,
    required this.name,
    this.slug,
    this.description,
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
  final String? icon;
  final int sortOrder;
  final bool isActive;
  final int productCount;
  final int activeProductCount;

  static AdminCategory? tryParse(Map<String, dynamic> json) {
    final int? id = JsonReader.integer(json['id']);
    if (id == null) return null;
    return AdminCategory(
      id: id,
      name: JsonReader.stringOr(json['name'], 'Categoría $id'),
      slug: JsonReader.string(json['slug']),
      description: JsonReader.string(json['description']),
      icon: JsonReader.string(json['icon']),
      sortOrder: JsonReader.integerOr(json['sortOrder'], 0),
      isActive: JsonReader.boolean(json['isActive'], fallback: true),
      productCount: JsonReader.integerOr(json['productCount'], 0),
      activeProductCount: JsonReader.integerOr(json['activeProductCount'], 0),
    );
  }

  @override
  String toString() => 'AdminCategory($id, $name)';
}

double? _toDouble(Object? value) {
  if (value is num) return value.toDouble();
  if (value is String) return double.tryParse(value);
  return null;
}
