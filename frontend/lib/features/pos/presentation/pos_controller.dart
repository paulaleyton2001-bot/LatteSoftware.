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
  /// POR QUÉ SUBE A `DINE_IN` Y NO A `CHAIR_RENTAL`
  /// Elegir una silla («mesa 4», «ponga el de la terraza») es pedir una mesa, no
  /// contratar un alquiler: un alquiler se cobra por tiempo y el cajero tiene que
  /// elegirlo explícitamente en el selector de tipo. Si tocar una silla
  ///.convirtiera el pedido en `CHAIR_RENTAL`, el cajero acabaría con un alquiler
  /// que no pidió, y sin un cliente al que cobre el tiempo. La subida a `DINE_IN`
  /// es, por tanto, correcta.
  ///
  /// Lo que SÍ estaba roto no es esta línea, sino que a la silla no se llegaba:
  /// `PosCheckoutPanel` montaba `PosChairPicker` sin `onPicked`, y `onSelect:
  /// null` convierte el plano entero en SOLO LECTURA. El método conserva además
  /// la reserva si se vuelve a tocar la misma silla, porque no hay razón para
  /// tirar el alquiler que el cajero ya tenía montado.
  void assignChair({required int chairId, required String chairLabel}) {
    if (state.chairId == chairId) return;
    PosDraft next = state.copyWith(chairId: chairId, chairLabel: chairLabel);
    if (state.type == PosOrderType.takeaway) {
      next = next.copyWith(type: PosOrderType.dineIn);
    }
    // Cambiar de silla invalida la reserva: la reserva pertenece a UNA silla, y
    // `POST /orders` devuelve `422` («La silla no corresponde a la reserva») si
    // se mezclan. Dejar la vieja puesta produciría justo ese error.
    // El aviso de «alquiler abierto» pertenece a la silla anterior: dejarlo
    // puesto haría creer al cajero que ESTE pedido ya tiene alquiler. Se limpia
    // porque `posWalkInProvider` es global a la pantalla del mostrador. La
    // comparación va ANTES de asignar `state`, que ya vale `next` después.
    if (state.chairId != chairId) {
      ref.read(posWalkInProvider.notifier).acknowledge();
    }
    next = next.copyWith(clearReservation: true, clearRental: true);
    state = next;
  }

  /// Quita la silla asignada.
  void clearChair() => state = state.copyWith(
        clearChair: true,
        clearRental: true,
        clearReservation: true,
      );

  /// Asocia la reserva (obligatoria en `CHAIR_RENTAL`).
  ///
  /// Antes esto era CÓDIGO MUERTO: nadie lo llamaba, así que
  /// `PosDraft.needsReservation` era siempre `true` en un alquiler, el botón de
  /// cobrar quedaba permanentemente deshabilitado y el cajero no tenía forma de
  /// desbloquear la venta. Lo llama ahora el selector de reservas del panel.
  void attachReservation(int reservationId) => state = state.copyWith(
        reservationId: reservationId,
        // La reserva elegida es la de la silla actual: si no lo fuera, el backend
        // la rechaza con «La silla no corresponde a la reserva».
        clearRental: state.rentalId != null,
      );

  /// Suelta la reserva y el alquiler sin tocar la silla.
  ///
  /// Se usa cuando la reserva elegida no sirve: el cajero la selecciono pero el
  /// alquiler no arrancó, y dejarla puesta habilitaría el cobro de un pedido que
  /// el servidor crearía por cero.
  void clearReservation() => state =
      state.copyWith(clearReservation: true, clearRental: true);

  /// Guarda el alquiler ya arrancado (`POST /rentals`).
  ///
  /// Se manda en `POST /orders` como `rentalId`: así el servidor enlaza el pedido
  /// con el alquiler activo y calcula sobre él el importe.
  void attachRental(int rentalId) => state = state.copyWith(rentalId: rentalId);

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

/// Reservas próximas de UNA silla, para que el cajero elija una con un toque.
///
/// `autoDispose` a propósito: cambiar de silla en el plano invalida la petición
/// anterior, y el mostrador no necesita acordarse de las reservas de una silla
/// que ya no está seleccionada. El error de red NO se limpia solo: el cajero
/// puede querer reintentar, y sin red el `AsyncError` es lo que le dice por qué
/// no hay lista.
final AutoDisposeFutureProviderFamily<List<PosReservation>, int>
    posChairReservationsProvider =
    AutoDisposeFutureProviderFamily<List<PosReservation>, int>(
  (AutoDisposeFutureProviderRef<List<PosReservation>> ref, int chairId) async {
    // Ventana de 12 h: suficiente para «el cliente reservó para ahora mismo» y
    // corta, para no traer el historial de una silla que lleva meses reservada.
    final DateTime now = DateTime.now();
    final Result<List<PosReservation>> result =
        await ref.watch(posRepositoryProvider).chairReservations(
              chairId: chairId,
              from: now,
              to: now.add(const Duration(hours: 12)),
            );
    return switch (result) {
      Success<List<PosReservation>>(:final List<PosReservation> value) => value,
      FailureResult<List<PosReservation>>(:final Failure failure) => throw failure,
    };
  },
  name: 'posChairReservations',
);

/// Apertura de un alquiler para un cliente SIN reserva previa.
///
/// QUÉ HACE Y POR QUÉ SON TRES LLAMADAS
/// El camino corto (`POST /rentals` y ya) no llega a ninguna parte: se comprobó
/// contra el backend y `POST /rentals` abre el alquiler pero NO crea el pedido
/// —a diferencia de lo que dice `docs/API.md` §7.9—, así que el alquiler
/// quedaría abierto, la silla `OCCUPIED` y sin nada que cobrar. Y además
/// `POST /orders` con `type = CHAIR_RENTAL` exige `reservationId`
/// (`422 RENTAL_REQUIRES_CHAIR_AND_RESERVATION` sin él), con lo que un alquiler
/// sin reserva es, por construcción, incobrable.
///
/// La secuencia que sí funciona, verificada de extremo a extremo, es:
///   1. `POST /reservations` con la ventana elegida (queda `PENDING`),
///   2. `POST /reservations/:id/confirm` (`POST /rentals` la exige `CONFIRMED`:
///      `422 RESERVATION_NOT_ACTIVE` si no),
///   3. `POST /rentals` con esa reserva → alquiler `ACTIVE`, silla `OCCUPIED`,
///   4. el `POST /orders` lo hace después el flujo de cobro normal.
///
/// NADA SE COBRA EN ESTE PUNTO y el borrador NO se resetea: lo que se guarda en
/// [PosDraft] son los ids que el cobro necesita, y sigue con su silla para que
/// el cajero vea lo que ha montado. El pedido se crea y se cobra en un solo paso
/// después, que es donde el servidor calcula el importe.
final AsyncNotifierProvider<PosWalkInController, PosWalkInResult?>
    posWalkInProvider =
    AsyncNotifierProvider<PosWalkInController, PosWalkInResult?>(
  PosWalkInController.new,
);

/// Lo que deja abierto un alquiler walk-in: qué reserva se creó y qué alquiler.
class PosWalkInResult {
  const PosWalkInResult({
    required this.chairId,
    required this.reservationId,
    required this.reservationCode,
    required this.rentalId,
    required this.rentalCode,
    required this.plannedMinutes,
  });

  /// Silla sobre la que se abrió. Se guarda para que el aviso verde solo
  /// aparezca si el alquiler sigue siendo el de la silla elegida: al cambiar de
  /// silla, un alquiler abierto en la anterior no dice nada del pedido actual.
  final int chairId;

  final int reservationId;
  final String reservationCode;
  final int rentalId;
  final String rentalCode;
  final int plannedMinutes;

  /// "RES-900016 · RENT-900015" — lo que el cajero ve al terminar.
  String get summary => '$reservationCode · $rentalCode';
}

/// Controla la apertura de un alquiler sin reserva.
class PosWalkInController extends AsyncNotifier<PosWalkInResult?> {
  @override
  FutureOr<PosWalkInResult?> build() => null;

  /// Abre el alquiler sobre [chairId] para [plannedMinutes] minutos.
  ///
  /// Devuelve `null` si algo falló; el motivo queda en [state] para que la
  /// pantalla lo muestre junto al botón, sin cerrar el panel de cobro. En ese
  /// caso NO queda nada a medias: si la reserva se creó pero el alquiler no
  /// arrancó, la reserva sigue `PENDING`, no ocupa la silla y no se ha cobrado
  /// nada — se puede volver a intentarlo.
  Future<PosWalkInResult?> open({
    required int chairId,
    required int plannedMinutes,
  }) async {
    if (state.isLoading) return null;
    state = const AsyncLoading<PosWalkInResult?>();
    final PosRepository repo = ref.read(posRepositoryProvider);
    final DateTime start = DateTime.now();
    final DateTime end = start.add(Duration(minutes: plannedMinutes));

    // 1. Reserva inmediata. Sin `customerId` a propósito: es un alquiler de
    //    mostrador, y el backend no obliga a cliente para reservas de personal.
    final Result<PosReservation> created = await repo.createReservation(
      chairId: chairId,
      startAt: start,
      endAt: end,
    );
    if (created case FailureResult<PosReservation>(:final Failure failure)) {
      return _fail(failure);
    }
    final PosReservation reservation = (created as Success<PosReservation>).value;

    // 2. Confirmar. `POST /rentals` solo acepta reservas `CONFIRMED`.
    final Result<PosReservation> confirmed = await repo.confirmReservation(reservation.id);
    if (confirmed case FailureResult<PosReservation>(:final Failure failure)) {
      return _fail(failure);
    }

    // 3. Arrancar el alquiler sobre esa reserva.
    final Result<PosRentalStart> started = await repo.startRental(
      chairId: chairId,
      plannedMinutes: plannedMinutes,
      reservationId: reservation.id,
    );
    if (started case FailureResult<PosRentalStart>(:final Failure failure)) {
      return _fail(failure);
    }
    final PosRentalStart rental = (started as Success<PosRentalStart>).value;

    // 4. Los ids van al borrador. NO se resetea: el cajero tiene que ver la
    //    silla y el tipo que ha elegido, y el siguiente paso es cobrar.
    ref.read(posDraftProvider.notifier)
      ..attachReservation(reservation.id)
      ..attachRental(rental.rentalId);

    final PosWalkInResult result = PosWalkInResult(
      chairId: chairId,
      reservationId: reservation.id,
      reservationCode: reservation.code,
      rentalId: rental.rentalId,
      rentalCode: rental.rentalCode,
      plannedMinutes: plannedMinutes,
    );
    state = AsyncData<PosWalkInResult?>(result);
    return result;
  }

  /// Arranca el alquiler de una reserva que YA existe, en vez de crearla.
  ///
  /// Es el camino del cliente que reservó por su cuenta y llega a la hora: el
  /// cajero toca su reserva en la lista y el alquiler se abre solo. Hace falta
  /// porque el importe del alquiler lo calcula el servidor a partir de un
  /// alquiler `ACTIVE`: sin este paso, `POST /orders` aceptaría el pedido pero lo
  /// crearía con `totalMinor = 0` y el cajero cobraría cero por una hora de silla.
  ///
  /// Si la reserva está `PENDING` se confirma antes, porque `POST /rentals`
  /// rechaza las que no están `CONFIRMED` (`422 RESERVATION_NOT_ACTIVE`).
  Future<PosWalkInResult?> startFromReservation({
    required int chairId,
    required PosReservation reservation,
  }) async {
    if (state.isLoading) return null;
    state = const AsyncLoading<PosWalkInResult?>();
    final PosRepository repo = ref.read(posRepositoryProvider);

    if (reservation.status != 'CONFIRMED') {
      final Result<PosReservation> confirmed =
          await repo.confirmReservation(reservation.id);
      if (confirmed case FailureResult<PosReservation>(:final Failure failure)) {
        return _fail(failure);
      }
    }

    // La duración la manda la propia reserva, no el cajero: es el tiempo que el
    // cliente compró. Se acota a 1440 min porque es el máximo de `POST /rentals`.
    final DateTime? from = reservation.startAt;
    final DateTime? to = reservation.endAt;
    final int minutes = (from == null || to == null)
        ? 60
        : to.difference(from).inMinutes.clamp(15, 1440);

    final Result<PosRentalStart> started = await repo.startRental(
      chairId: chairId,
      plannedMinutes: minutes,
      reservationId: reservation.id,
    );
    if (started case FailureResult<PosRentalStart>(:final Failure failure)) {
      return _fail(failure);
    }
    final PosRentalStart rental = (started as Success<PosRentalStart>).value;

    ref.read(posDraftProvider.notifier)
      ..attachReservation(reservation.id)
      ..attachRental(rental.rentalId);

    final PosWalkInResult result = PosWalkInResult(
      chairId: chairId,
      reservationId: reservation.id,
      reservationCode: reservation.code,
      rentalId: rental.rentalId,
      rentalCode: rental.rentalCode,
      plannedMinutes: minutes,
    );
    state = AsyncData<PosWalkInResult?>(result);
    return result;
  }

  /// Vuelve a `idle` tras mostrar el resultado, para que el botón quede limpio.
  void acknowledge() => state = const AsyncData<PosWalkInResult?>(null);

  PosWalkInResult? _fail(Failure failure) {
    state = AsyncError<PosWalkInResult?>(failure, StackTrace.current);
    return null;
  }
}
