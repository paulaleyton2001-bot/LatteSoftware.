// Mutaciones del pedido en curso del mostrador. MÓDULO `pos`.
//
// POR QUÉ UN ARCHIVO APARTE
// `pos_controller.dart` declares el ESTADO (catálogo, borrador, filtros) y este
// declara las ACCIONES sobre el carrito. Separarlos mantiene cada archivo por
// debajo de las 200 líneas y deja claro que el carrito del POS es el del
// cliente, reutilizado, no un segundo.
//
// POR QUÉ `CartStore` Y NO `setState`
// El carrito lo mutan tres zonas a la vez (la rejilla, la lista de líneas y el
// panel de cobro) y tiene que SOBREVIVIR a un corte de luz a mitad de una cola:
// `CartStore` persiste en `PreferencesStorage` en cada mutación y avisa a los
// observadores. Un `setState` con una lista local perdería el pedido.
//
// EL REFOCUS DEL BUSCADOR
// Tras añadir un producto, el cajero sigue escribiendo el siguiente. Devolver el
// foco al buscador es lo que hace que un turno entero se teclee sin soltar el
// teclado. La pantalla registra el callback aquí porque la capa de estado no
// puede conocer un `FocusNode`.

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/customer/cart_providers.dart';
import '../../../core/customer/cart_state.dart';
import '../../../core/customer/cart_store.dart';
import '../domain/entities/pos_catalog_item.dart';

/// Líneas del pedido en curso.
///
/// Proyecta el carrito a un provider observable: la UI no ve el store (que es
/// `ChangeNotifier`), ve un `Provider` de valor. Así un cambio de cantidad
/// reconstruye solo el panel del pedido, no el catálogo entero.
///
/// Se deriva de `cartStateProvider` y NO de `cartStoreProvider` a propósito.
/// Depender de la INSTANCIA del store no vale: Riverpod solo invalida un
/// `Provider` cuando cambia el valor de una dependencia, y esa instancia es el
/// mismo objeto para siempre, así que el provider se quedaba con la lista que
/// había calculado al abrir el POS. De ahí el bug del cajero: la rejilla añadía
/// productos, el store los guardaba y el panel seguía en «Pedido vacío».
/// `cartStateProvider` sí está suscrito al store, así que sí propaga.
final Provider<List<CartLine>> posLinesProvider = Provider<List<CartLine>>(
  (Ref ref) => ref.watch(cartStateProvider).lines,
  name: 'posLines',
);

/// Subtotal PREVISUALIZADO en centavos (sin impuestos: los calcula el servidor).
final Provider<int> posSubtotalMinorProvider = Provider<int>(
  (Ref ref) => ref.watch(posLinesProvider)
      .fold<int>(0, (int acc, CartLine line) => acc + line.lineTotalMinor),
  name: 'posSubtotalMinor',
);

/// Minutos de preparación estimados del pedido.
///
/// Se apoya en [CartState.estimatedPreparationMinutes] y no en un `fold` propio a
/// propósito: la fórmula (minutos POR unidad × unidades) es del dominio, y
/// duplicarla aquí ya salió caro una vez. Sumando `preparationMinutes` una vez por
/// LÍNEA, dos espressos decían «3 min» en lugar de «6 min», que es el tiempo que
/// de verdad tarda la barra en hacerlos.
final Provider<int> posPreparationMinutesProvider = Provider<int>(
  (Ref ref) => ref.watch(cartStateProvider).estimatedPreparationMinutes,
  name: 'posPreparationMinutes',
);

/// Añade un producto del catálogo al pedido en curso. Un clic = una venta.
///
/// Un producto no disponible (`isAvailable = false`, agotado o fuera de
/// temporada) se ignora: sigue visible en la rejilla para que el cajero vea qué
/// se acabó, pero no entra en el pedido. El backend también lo rechazaría con
/// `422 PRODUCT_UNAVAILABLE`, y es mejor no gastarle la cuota.
///
/// [store] llega por parámetro en vez de leerse de un `Ref`: quien llama es la
/// REJILLA, que tiene un `WidgetRef`, y `WidgetRef` y `Ref` no son
/// intercambiables aunque los dos tengan `read`.
void posAddProduct(CartStore store, PosCatalogItem item) {
  if (!item.isSellable) return;
  store.addLine(CartLine(
    id: store.nextLineId(),
    productId: item.id,
    productName: item.name,
    productImageUrl: item.imageUrl,
    unitPriceMinor: item.effectivePriceMinor,
    quantity: 1,
    preparationMinutes: item.preparationMinutes,
  ));
  // Tras añadir, el foco vuelve al buscador: el cajero sigue escribiendo el
  // siguiente producto sin tocar el ratón.
  _refocusSearch?.call();
}


/// Callback opcional que devuelve el foco al buscador tras añadir.
///
/// Lo inyecta la pantalla del POS (que posee el `FocusNode`) para que la capa de
/// estado no dependa de widgets. Si nadie lo inyecta, `?.call()` no hace nada.
void Function()? _refocusSearch;

/// Registra el callback de refocus. Devuelve la función para restaurarlo.
void Function() registerPosSearchRefocus(void Function() refocus) {
  _refocusSearch = refocus;
  return () {
    if (identical(_refocusSearch, refocus)) _refocusSearch = null;
  };
}
