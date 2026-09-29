// Contrato del catálogo de menú. Módulo `features/menu/domain`.
//
// POR QUÉ NO EXISTE UN `GET /menu`
// `docs/API.md` (contrato CONGELADO, §7) NO tiene ningún endpoint `/menu`: el
// catálogo se compone de `GET /categories` (§7.10) y `GET /products` (§7.11).
// Este repositorio los orchestra para que la pantalla del menú tenga una sola
// lectura y una sola caché, sin inventar una ruta que el backend no tiene.
//
// El filtrado por categoría y por texto se hace EN CLIENTE sobre el catálogo
// completo: es la única forma de que el buscador sea instantáneo y de que la app
// abra con el último menú conocido cuando no hay red.


import 'package:flutter/foundation.dart';
import '../../../../core/result/result.dart';
import '../entities/menu_category.dart';
import '../entities/menu_product.dart';

/// Catálogo de productos con su procedencia.
///
/// `isStale` NO es un detalle interno del repositorio: la UI lo necesita para
/// decir "mostramos el menú guardado, los precios pueden haber cambiado" en vez
/// de presentar datos viejos como si fueran de ahora. Un menú con precios viejos
/// sin aviso es peor que un menú vacío con aviso.
@immutable
class MenuCatalog {
  const MenuCatalog({required this.items, this.isStale = false});

  const MenuCatalog.empty() : items = const <MenuProduct>[], isStale = false;

  final List<MenuProduct> items;

  /// `true` si viene de la caché local porque el backend no respondió.
  final bool isStale;

  bool get isEmpty => items.isEmpty;

  int get length => items.length;
}

/// Lecturas del catálogo.
abstract interface class MenuRepository {
  /// `GET /categories?includeProductCount=true&sort=sortOrder&order=asc`.
  Future<Result<List<MenuCategory>>> categories();

  /// `GET /products` con `fields=basic` (la optimización que el propio
  /// `API.md` §7.11 recomienda para la pantalla de catálogo).
  ///
  /// Devuelve [MenuCatalog] y no una lista suelta porque, si la red falla, la
  /// implementación devuelve la caché con `isStale: true` en lugar de un error.
  Future<Result<MenuCatalog>> products();

  /// `GET /products/:id` — producto completo con `variants[]` y `addons[]`.
  Future<Result<MenuProduct>> product(int productId);
}
