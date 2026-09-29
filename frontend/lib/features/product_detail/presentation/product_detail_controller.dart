// Estado de la ficha de producto.
//
// El producto se pide por id (`GET /products/:id`), no por slug: la API resuelve
// por id y no tiene endpoint por slug (API.md §7.11). Por eso la ruta de cliente
// es `/producto/:productId`.
//
// LA SELECCIÓN (variante, complementos, cantidad, notas) ES ESTADO LOCAL
// Es la parte de la pantalla donde el usuario está decidiendo, y cada cambio
// tiene que verse al instante para que el total se mueva. Por eso vive en un
// `Notifier` de Riverpod, no en `setState`: el cálculo del total vive en
// [ProductSelectionState.totalMinor] y el pie lo lee, así que si estuviera en el
// widget habría que duplicarlo o pasarlo por parámetro.



import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/customer/cart_providers.dart';
import '../../../core/customer/cart_state.dart';
import '../../../core/customer/cart_store.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
// `menuRepositoryProvider` es el punto de inyección de la feature de menu: la
// ficha del producto lee de ahí y no pide el catálogo otra vez.
import '../../menu/domain/entities/menu_product.dart';
import '../../menu/presentation/menu_controller.dart';
import '../data/repositories/product_detail_repository_impl.dart';
import '../domain/repositories/product_detail_repository.dart';
import './product_selection_state.dart';

/// Repositorio de la ficha de producto. Punto de inyección de la feature.
///
/// Reutiliza [MenuRepository] como dependencia: la lectura es exactamente
/// `GET /products/:id`, y duplicar un datasource para la misma ruta sería tener
/// dos fuentes de verdad para el mismo endpoint.
final Provider<ProductDetailRepository> productDetailRepositoryProvider =
    Provider<ProductDetailRepository>(
  (Ref ref) => ProductDetailRepositoryImpl(ref.watch(menuRepositoryProvider)),
  name: 'productDetailRepository',
);

/// Producto de la ficha.
final FutureProviderFamily<MenuProduct, int> productDetailProvider =
    FutureProvider.family<MenuProduct, int>(
  (Ref ref, int productId) async {
    final Result<MenuProduct> result =
        await ref.watch(productDetailRepositoryProvider).product(productId);
    return switch (result) {
      Success<MenuProduct>(:final MenuProduct value) => value,
      FailureResult<MenuProduct>(:final Failure failure) => throw failure,
    };
  },
  name: 'productDetail',
);

/// Selección en curso de la ficha. Se reinicia al cambiar de producto.
final NotifierProviderFamily<ProductSelectionController, ProductSelectionState,
    MenuProduct> productSelectionProvider =
    NotifierProvider.family<ProductSelectionController, ProductSelectionState,
        MenuProduct>(ProductSelectionController.new);

/// Controlador de la selección de la ficha.
class ProductSelectionController
    extends FamilyNotifier<ProductSelectionState, MenuProduct> {
  @override
  ProductSelectionState build(MenuProduct arg) {
    // Se arranca con la variante por defecto marcada: es lo que el backend
    // considera correcto, así que la app no puede proponer otra.
    final ProductVariant? variant = arg.defaultVariant;
    return ProductSelectionState(variantId: variant?.id);
  }

  void selectVariant(int variantId) =>
      state = state.copyWith(variantId: variantId);

  /// Activa o desactiva un complemento.
  ///
  /// Respeta [ProductAddon.isMultiple] y [ProductAddon.maxSelect]: un complemento
  /// simple alterna entre 0 y 1; uno múltiple suma 1 hasta su tope. Devolver un
  /// `bool` (si se pudo) permite que la UI avise cuando un tope se ha alcanzado.
  bool toggleAddon(ProductAddon addon) {
    final int current = state.addons[addon.id] ?? 0;
    if (current > 0) {
      state = state.copyWith(addons: _without(addon.id));
      return true;
    }
    if (!addon.isMultiple) {
      state = state.copyWith(addons: <int, int>{...state.addons, addon.id: 1});
      return true;
    }
    final int limit = addon.selectableMax;
    if (current + 1 > limit) return false;
    state = state.copyWith(addons: <int, int>{...state.addons, addon.id: current + 1});
    return true;
  }

  /// Fija las unidades de un complemento múltiple (stepper propio).
  void setAddonQuantity(ProductAddon addon, int quantity) {
    final int limit = addon.selectableMax;
    final int next = quantity.clamp(0, limit);
    state = state.copyWith(
      addons: next == 0 ? _without(addon.id) : <int, int>{...state.addons, addon.id: next},
    );
  }

  void setQuantity(int quantity) =>
      state = state.copyWith(quantity: quantity.clamp(1, kCartMaxLineQuantity));

  void setNotes(String notes) => state = state.copyWith(notes: notes);

  /// Construye la línea del carrito con la selección actual.
  ///
  /// Se guarda un SNAPSHOT de nombre y precio (como hacen los `order_items` del
  /// servidor) para que la línea del carrito se pueda pintar sin volver a la red.
  CartLine toCartLine(CartStore store, MenuProduct product) {
    final ProductVariant? variant = state.variantIn(product);
    return CartLine(
      id: store.nextLineId(),
      productId: product.id,
      productName: product.name,
      productImageUrl: product.imageUrl,
      unitPriceMinor: state.unitPriceMinor(product),
      variantId: variant?.id,
      variantName: variant?.name ?? '',
      addons: state.addonSelections(product),
      quantity: state.quantity,
      notes: state.notes.trim(),
      preparationMinutes: product.preparationMinutes,
    );
  }

  /// Añade la selección actual al carrito.
  ///
  /// El `CartStore` vive en `core/customer` (y no como provider de esta feature)
  /// porque el carrito lo comparten el menú, la ficha, el checkout y el badge de
  /// navegación, y las features no se importan entre sí.
  ///
  /// NO se manda ningún importe al backend: la línea solo lleva ids y cantidad.
  void addToCart(MenuProduct product) {
    final CartStore store = ref.read(cartStoreProvider);
    store.addLine(toCartLine(store, product));
  }

  Map<int, int> _without(int addonId) {
    final Map<int, int> next = <int, int>{...state.addons};
    next.remove(addonId);
    return next;
  }
}
