// Implementación de `ProductDetailRepository` sobre el repositorio del menú.
//
// DELEGACIÓN, NO DUPLICACIÓN: la ruta, el parseo y el mapeo de errores ya existen
// en `features/menu`. Este archivo solo cumple el contrato propio de la feature
// para que `presentation/` no dependa del menú (las features no se importan
// entre sí). Añadir un método aquí que no esté en `MenuRepository` obligaría a
// tocar las dos capas; por eso la interfaz tiene un único método.

import '../../../../core/result/result.dart';
import '../../../menu/domain/entities/menu_product.dart';
import '../../../menu/domain/repositories/menu_repository.dart';
import '../../domain/repositories/product_detail_repository.dart';

/// Repositorio de la ficha de producto.
class ProductDetailRepositoryImpl implements ProductDetailRepository {
  const ProductDetailRepositoryImpl(this._menu);

  final MenuRepository _menu;

  @override
  Future<Result<MenuProduct>> product(int productId) =>
      _menu.product(productId);
}
