// Estado del último "añadido al pedido". Módulo

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// `features/product_detail/presentation`.
//
// ES SÍNCRONO PORQUE EL CARRITO ES LOCAL
// No hay red detrás de "añadir al carrito": el carrito vive en
// `core/customer/cart_store.dart`. Por eso esto no es un `AsyncValue` sino un estado
// simple con la marca de tiempo del último alta, que la ficha usa para mostrar la
// confirmación y reiniciar la cantidad.
//
// POR QUÉ EXISTE, SI EL CARRITO YA AVISA SOLO
// El `CartStore` notifica a quien lo escuche, pero la ficha necesita responder a una
// cosa concreta: "acabas de añadir, aquí tienes la confirmación y el acceso al
// carrito". Publicar el instante del alta permite que el `SnackBar` aparezca una vez
// y solo una, y no en cada reconstrucción del árbol.


/// Resultado de añadir una línea al carrito.
@immutable
class AddToCartStatus {
  const AddToCartStatus({this.lastAddedAt, this.lastAddedName});

  /// Instante del último alta (`null` = ninguna).
  final DateTime? lastAddedAt;

  /// Nombre del producto añadido, para el mensaje.
  final String? lastAddedName;

  /// `true` si hubo un alta.
  bool get hasJustAdded => lastAddedAt != null;
}

/// Provider del estado de altas del carrito.
final NotifierProvider<AddToCartStatusController, AddToCartStatus>
    addToCartStatusProvider =
    NotifierProvider<AddToCartStatusController, AddToCartStatus>(
  AddToCartStatusController.new,
);

/// Publica altas en el carrito para que la UI pueda confirmarlas.
class AddToCartStatusController extends Notifier<AddToCartStatus> {
  @override
  AddToCartStatus build() => const AddToCartStatus();

  void register(String productName) => state = AddToCartStatus(
        lastAddedAt: DateTime.now(),
        lastAddedName: productName,
      );

  void clear() => state = const AddToCartStatus();
}
