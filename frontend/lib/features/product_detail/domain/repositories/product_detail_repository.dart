// Contrato de la ficha de producto. Módulo `features/product_detail/domain`.
//
// Es una interfaz mínima a propósito: la única lectura que necesita la feature es
// `GET /products/:id`, y esa ruta ya la implementa
// `features/menu/domain/repositories/menu_repository.dart`. Declarar aquí una
// interfaz con un método y delegar en aquella evita dos datasources para el mismo
// endpoint (dos fuentes de verdad para lo mismo es un bug esperando).


import '../../../../core/result/result.dart';
import '../../../menu/domain/entities/menu_product.dart';

/// Lectura de la ficha de producto.
abstract interface class ProductDetailRepository {
  /// `GET /products/:id` con `variants[]`, `addons[]` e `ingredients[]`.
  Future<Result<MenuProduct>> product(int productId);
}
