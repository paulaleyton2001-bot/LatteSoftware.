// Estado del mostrador: catálogo, búsqueda, borrador del pedido y cobro.
//
// TODAS LAS MUTACIONES VIVEN AQUÍ, NO EN `setState`
// El pedido en curso lo mutan tres zonas a la vez (la rejilla de productos, la
// lista de líneas y el panel de cobro). Con `setState` habría tres copias
// desincronizadas y el cobro cobraría de una versión y la pantalla pintaría otra.
// Las acciones del carrito están en `pos_cart_controller.dart`; este archivo
// declara el ESTADO.
//
// EL CARRITO ES EL DEL CLIENTE, Y ES A PROPÓSITO
// `core/customer/cart_store.dart` ya resuelve lo difícil: fusionar líneas
// equivalentes, persistir a disco para que un corte de luz no borre el pedido,
// y avisar al badge de navegación. El POS lo REUTILIZA en vez de mantener un
// segundo carrito: dos carritos significa que el cliente ve un pedido en el móvil
// y el cajero ve otro en el mostrador, y solo uno está pagado.
//
// La diferencia del POS es el `PosDraft`: tipo de pedido, silla, reserva y
// notas, que son datos de la caja y no del cliente.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../data/datasources/remote/pos_remote_datasource.dart';
import '../data/repositories/pos_repository_impl.dart';
import '../domain/entities/pos_catalog_item.dart';
import '../domain/entities/pos_draft.dart';
import '../domain/entities/pos_order_type.dart';
import '../domain/repositories/pos_repository.dart';
import '../domain/repositories/pos_repository_models.dart';

// La pantalla del mostrador ya importa este archivo (es el estado que pinta), así
// que el catálogo y sus categorías se re-exportan desde aquí en vez de obligar a
// cada widget a conocer la ruta al repositorio.
export '../domain/repositories/pos_repository_models.dart'
    show PosCatalog, PosCatalogCategory;

/// Datasource del mostrador. Punto de inyección de la feature.
final Provider<PosRepository> posRepositoryProvider = Provider<PosRepository>(
  (Ref ref) => PosRepositoryImpl(PosRemoteDataSource(ref.watch(apiClientProvider))),
  name: 'posRepository',
);

/// Catálogo del mostrador (`GET /products?fields=basic`): productos y, en la misma
/// respuesta, el índice de categorías con su nombre.
final FutureProvider<PosCatalog> posCatalogProvider =
    FutureProvider<PosCatalog>(
  (Ref ref) async {
    final Result<PosCatalog> result =
        await ref.watch(posRepositoryProvider).catalog();
    return switch (result) {
      Success<PosCatalog>(:final PosCatalog value) => value,
      FailureResult<PosCatalog>(:final Failure failure) => throw failure,
    };
  },
  name: 'posCatalog',
);

// --------------------------------------------------------------------- Búsqueda

/// Texto del buscador. `StateProvider` porque es un valor de PANTALLA, no de
/// negocio: no se persiste, no lo lee nadie más y no necesita un `Notifier`.
final StateProvider<String> posSearchProvider =
    StateProvider<String>((Ref ref) => '');

/// Categoría activa. `null` = todas.
final StateProvider<int?> posCategoryProvider =
    StateProvider<int?>((Ref ref) => null);

/// Filtro de disponibilidad: `null` = todos, `true` = solo disponibles,
/// `false` = solo agotados. Agotados NO se ocultan: el cajero necesita ver que
/// algo se acabó para ofrecer otra cosa.
final StateProvider<bool?> posOnlyAvailableProvider =
    StateProvider<bool?>((Ref ref) => null);

/// Categorías del catálogo para los botones de filtro.
///
/// Se toman de `meta.categories` de la MISMA respuesta que el catálogo
/// (`docs/API.md` §7.11) y no de un `GET /categories` aparte: el backend ya las
/// publica en la proyección ligera que existe para el POS, así que pedirla otra
/// vez sería gastar una petición para mostrar lo mismo. Además el conteo es el
/// del servidor, no un recountado en cliente que se desincroniza del catálogo.
final Provider<List<PosCatalogCategory>> posCategoriesProvider =
    Provider<List<PosCatalogCategory>>((Ref ref) {
  final PosCatalog? catalog = ref.watch(posCatalogProvider).valueOrNull;
  if (catalog == null) return const <PosCatalogCategory>[];
  return catalog.categories;
}, name: 'posCategories');

/// Productos ya filtrados por búsqueda, categoría y disponibilidad.
///
/// El filtrado es EN MEMORIA a propósito: el catálogo cabe en una página
/// (`pageSize: 100`, el máximo del endpoint) y filtrar en cliente hace que
/// escribir en el buscador sea instantáneo. Mandar `q=` al servidor en cada
/// tecla convertiría el mostrador en un cliente lento.
final Provider<List<PosCatalogItem>> posVisibleCatalogProvider =
    Provider<List<PosCatalogItem>>((Ref ref) {
  final List<PosCatalogItem> all =
      ref.watch(posCatalogProvider).valueOrNull?.items ?? const <PosCatalogItem>[];
  final String needle = ref.watch(posSearchProvider).trim().toLowerCase();
  final int? categoryId = ref.watch(posCategoryProvider);
  final bool? onlyAvailable = ref.watch(posOnlyAvailableProvider);

  return <PosCatalogItem>[
    for (final PosCatalogItem item in all)
      if (categoryId == null || item.categoryId == categoryId)
        if (onlyAvailable == null || item.isAvailable == onlyAvailable)
          if (needle.isEmpty || item.searchHaystack.contains(needle))
            item,
  ];
}, name: 'posVisibleCatalog');

/// `true` si hay algún filtro activo (para mostrar el botón de limpiar).
final Provider<bool> posHasActiveFilterProvider = Provider<bool>((Ref ref) {
  return ref.watch(posSearchProvider).trim().isNotEmpty ||
      ref.watch(posCategoryProvider) != null ||
      ref.watch(posOnlyAvailableProvider) != null;
}, name: 'posHasActiveFilter');

// ------------------------------------------------------------------- Borrador

/// Borrador del pedido en curso (tipo, silla, reserva, notas).
final NotifierProvider<PosDraftController, PosDraft> posDraftProvider =
    NotifierProvider<PosDraftController, PosDraft>(PosDraftController.new);

/// Mutaciones del borrador. Un `Notifier` porque el estado es inmutable y todas
/// las operaciones son `copyWith`.
class PosDraftController extends Notifier<PosDraft> {
  @override
  PosDraft build() => PosDraft.empty;

  /// Cambia el tipo de pedido.
  ///
  /// Al dejar de ser `CHAIR_RENTAL` se SUELTA la silla y la reserva: si no, un
  /// cambio a "para llevar" dejaría un pedido con `chairId` que el backend
  /// rechaza con warning en `TAKEAWAY` (API.md §7.12).
  void setType(PosOrderType type) {
    if (state.type == type) return;
    state = type.requiresChair
        ? state.copyWith(type: type)
        : state.copyWith(
            type: type,
            clearChair: true,
            clearReservation: true,
            clearRental: true,
          );
  }

  /// Asigna una silla al pedido.
  ///
  /// Cambiar de `TAKEAWAY` a `DINE_IN` o `CHAIR_RENTAL` al elegir la silla es lo
  /// natural para el cajero ("mesa 4" → pide la silla), así que el selector la
  /// asigna y sube el tipo si hace falta.
  void assignChair({required int chairId, required String chairLabel}) {
    PosDraft next = state.copyWith(chairId: chairId, chairLabel: chairLabel);
    if (state.type == PosOrderType.takeaway) {
      next = next.copyWith(type: PosOrderType.dineIn);
    }
    state = next;
  }

  /// Quita la silla asignada.
  void clearChair() => state = state.copyWith(clearChair: true, clearRental: true);

  /// Asocia la reserva (obligatoria en `CHAIR_RENTAL`).
  void attachReservation(int reservationId) =>
      state = state.copyWith(reservationId: reservationId);

  /// Guarda la etiqueta de mesa/barra.
  void setTableLabel(String value) =>
      state = state.copyWith(tableLabel: value.trim());

  /// Guarda las notas internas del pedido (máx. 500 en la API).
  void setNotes(String value) => state = state.copyWith(notes: value.trim());

  /// Guarda el cupón. NO lo valida aquí: el descuento lo aplica el servidor
  /// (BR-DISC-001) y la validación real es `POST /discounts/validate`.
  void setCoupon(String? code) {
    final String? normalized =
        (code == null || code.trim().isEmpty) ? null : code.trim().toUpperCase();
    state = state.copyWith(clearCoupon: normalized == null, couponCode: normalized);
  }

  /// Vacia el borrador (botón "nuevo pedido", atajo `F2`).
  void reset() => state = PosDraft.empty;
}

// ------------------------------------------------------- Alquiler sin reserva

/// Apertura de un alquiler WALK-IN (`POST /rentals` sin reserva previa).
///
/// Un `AsyncNotifier` y no un `Notifier` porque la llamada es de red y el cajero
/// necesita un "cargando" en el botón mientras el backend crea el alquiler y su
/// pedido. El estado guardado es el `PosOrderResult` que devuelve la API, para
/// que quien abre el diálogo pueda enseñar el número del pedido nuevo.
final AsyncNotifierProvider<PosWalkInController, PosOrderResult?>
    posWalkInProvider =
    AsyncNotifierProvider<PosWalkInController, PosOrderResult?>(
  PosWalkInController.new,
);

/// Controla la apertura de un alquiler sin reserva.
class PosWalkInController extends AsyncNotifier<PosOrderResult?> {
  @override
  FutureOr<PosOrderResult?> build() => null;

  /// `POST /rentals` con `chairId` y `plannedMinutes`, SIN `reservationId`.
  ///
  /// Devuelve `null` si el backend lo rechazó; el mensaje queda en [state] para
  /// que la pantalla lo muestre junto al botón, sin cerrar el panel de cobro.
  Future<PosOrderResult?> open({
    required int chairId,
    required int plannedMinutes,
  }) async {
    if (state.isLoading) return null;
    state = const AsyncLoading<PosOrderResult?>();
    final Result<PosOrderResult> result = await ref
        .read(posRepositoryProvider)
        .createWalkInRental(chairId: chairId, plannedMinutes: plannedMinutes);
    // Sin guarda de disposal: `posWalkInProvider` no es `autoDispose` y el botón
    // que lo dispara sigue montado mientras corre la llamada.
    switch (result) {
      case Success<PosOrderResult>(:final PosOrderResult value):
        // El borrador ya no vale: el pedido lo ha creado el backend con sus
        // propios totales, que son los que valen (BR-PRICE-008).
        ref.read(posDraftProvider.notifier).reset();
        state = AsyncData<PosOrderResult?>(value);
        return value;
      case FailureResult<PosOrderResult>(:final Failure failure):
        state = AsyncError<PosOrderResult?>(failure, StackTrace.current);
        return null;
    }
  }

  /// Limpia el error tras mostrarlo, para que el botón vuelva a estar disponible.
  void acknowledge() => state = const AsyncData<PosOrderResult?>(null);
}
