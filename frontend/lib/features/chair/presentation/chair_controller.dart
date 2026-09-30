// Estado de la pestaña «Silla»: alquiler en curso, mapa y panel de acción.
// Módulo `features/chair/presentation`.
//
// QUÉ MUESTRA
//   1. El alquiler/reserva ACTIVA con temporizador en vivo, o un mensaje claro.
//   2. El mapa del local, para ver qué hay libre.
//   3. Al tocar una silla, un PANEL con su estado, su precio y las acciones que el
//      rol actual puede hacer sobre ella (reservar, alquilar sin cita, cambiar su
//      estado).
//
// DE DÓNDE SALE CADA COSA
//   - El alquiler: `GET /rentals` (`rentals:read` es parcial para `CUSTOMER`, así
//     que el service devuelve los suyos). El reloj del temporizador es
//     `clockProvider` de `shared/widgets/rental_countdown.dart`, compartido con el
//     detalle del pedido.
//   - El mapa: `venueMapProvider` (`core/customer`), el MISMO provider que usa el
//     checkout. Que sea el mismo garantiza que el precio y el estado que se ven al
//     elegir son los mismos que se ven en la pestaña: si fueran dos, la persona
//     vería una silla libre aquí y ocupada al reservarla.
//   - El panel: `GET /chairs/:id` (ocupación sin datos del ocupante) y, solo para
//     personal con `rentals:read:any`, `GET /rentals/chair/:id/active`.
//
// NO SE IMPORTA NADA DE `features/orders` NI DE `features/checkout`
// El tipo `Rental` vive en `features/orders/domain` porque lo produce
// `GET /rentals`, que es un endpoint de pedidos... y eso SÍ sería una importación
// entre features. Para no romper la regla, el alquiler se pide con el datasource
// de ESTA feature (`ChairRemoteDataSource`), que habla con `GET /rentals` y
// traduce la misma respuesta al mismo modelo. El modelo, al ser de dominio y no
// de pantalla, se reutiliza desde `features/orders/domain/entities`: las
// ENTIDADES se comparten, las FEATURES no.

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/customer/chair_map.dart';
import '../../../core/customer/venue_providers.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
// `currentUserProvider` es de la feature de auth: el repositorio de alquileres
// necesita el id del cliente para pedir SUS alquileres, no los de cualquiera. Es la
// misma excepción que hace `admin_users_page.dart`, y sin ella `myRentals()`
// pediría los alquileres de un id 0 que no existe.
import '../../auth/presentation/auth_controller.dart';
import '../../orders/domain/entities/rental.dart';
import '../data/datasources/remote/chair_booking_datasource.dart';
import '../data/datasources/remote/chair_remote_datasource.dart';
import '../data/repositories/rental_repository_impl.dart';
import '../domain/entities/chair_booking.dart';
import '../domain/entities/chair_capabilities.dart';
import '../domain/repositories/rental_repository.dart';

/// Mapa de sillas. El MISMO provider que el checkout.
final FutureProvider<ChairMap> chairTabMapProvider = venueMapProvider;

/// Versión SOBRENOMBRADA de [chairCapabilitiesProvider], para poder sustituirla en
/// un test.
///
/// `chairCapabilitiesProvider` se deriva de `currentUserProvider`, que viene de la
/// feature de auth y arrastra la sesión entera. Un test del panel necesita poder
/// decir «este usuario es un CUSTOMER» sin montar una sesión entera, y sin esta
/// indirección habría que levantar [currentUserProvider] y todo lo que cuelga de
/// él. El provider público sigue siendo el mismo objeto: esto es un alias, no una
/// copia, así que invalidar uno invalida el otro.
final Provider<ChairCapabilities> chairCapabilitiesOverride =
    chairCapabilitiesProvider;

/// Capacidades del actor actual sobre el módulo de sillas.
///
/// Se resuelve UNA vez desde `User.permissions` (la lista de claves que devuelve
/// `GET /auth/me`) y no desde el rol: la matriz de RBAC vive en el backend y
/// duplicarla aquí es justo lo que `docs/DESIGN.md` §9 prohíbe.
final Provider<ChairCapabilities> chairCapabilitiesProvider =
    Provider<ChairCapabilities>(
  (Ref ref) => ChairCapabilities.fromPermissions(
    ref.watch(currentUserProvider)?.permissions ?? const <String>[],
  ),
  name: 'chairCapabilities',
);

/// Datasource de reservas, alquileres y estado de silla.
final Provider<ChairBookingDataSource> chairBookingDataSourceProvider =
    Provider<ChairBookingDataSource>(
  (Ref ref) => ChairBookingDataSource(ref.watch(apiClientProvider)),
  name: 'chairBookingDataSource',
);

/// Repositorio de alquileres de la pestaña «Silla».
final Provider<RentalRepository> rentalRepositoryProvider =
    Provider<RentalRepository>(
  (Ref ref) {
    final int customerId = ref.watch(currentUserProvider)?.id ?? 0;
    return RentalRepositoryImpl(
      ref.watch(chairBookingDataSourceProvider),
      ChairRemoteDataSource(ref.watch(apiClientProvider)),
      customerId,
      // Solo el personal con `rentals:read:any` puede saber quién ocupa una silla
      // ajena. Para el resto, la capa de datos borra el nombre aunque llegue.
      canSeeOccupantIdentity: ref.watch(chairCapabilitiesProvider).canSeeOccupantIdentity,
    );
  },
  name: 'rentalRepository',
);

/// Alias de [rentalRepositoryProvider] para poder sustituirlo en un test.
///
/// El panel solo necesita «qué silla hay en esta pantalla»; que la fila real venga
/// de la red es irrelevante para comprobar que se pinta el precio o que un botón
/// queda apagado. Sin esta indirección el test tendría que montar un cliente HTTP
/// entero, y el fallo quepillarían no sería el que se quiere comprobar.
final Provider<RentalRepository> rentalRepositoryOverride =
    rentalRepositoryProvider;

/// Mis alquileres (los del cliente autenticado).
final FutureProvider<List<Rental>> myRentalsProvider = FutureProvider<List<Rental>>(
  (Ref ref) async {
    final Result<List<Rental>> result =
        await ref.watch(rentalRepositoryProvider).myRentals();
    return switch (result) {
      Success<List<Rental>>(:final List<Rental> value) => value,
      FailureResult<List<Rental>>(:final Failure failure) => throw failure,
    };
  },
  name: 'myRentals',
);

/// El alquiler VIVO DEL ACTOR (o reserva en curso), si tiene uno.
///
/// `ACTIVE` y `EXTENDED` cuentan: los dos significan "estoy pagando por esta
/// silla ahora mismo" (`RentalStatus`, API.md §6.2). Los ya cerrados no se
/// muestran aquí: viven en «Mis pedidos».
///
/// EL FILTRO POR DUEÑO NO ES OPCIONAL
/// `GET /rentals` está acotado al actor solo para un `CUSTOMER`. Para un rol con
/// `rentals:read:any` devuelve los alquileres de todo el local, y sin este filtro
/// la tarjeta «Tu silla» le enseñaba al primero de la lista —que era la silla de
/// otra persona—. Con `customerId` en la entidad, `belongsTo` lo resuelve: un
/// walk-in sin cliente (`customerId = null`) no es de nadie, tampoco del `ADMIN` que
/// lo está mirando.
final Provider<Rental?> activeRentalProvider = Provider<Rental?>(
  (Ref ref) {
    final int userId = ref.watch(currentUserProvider)?.id ?? 0;
    final List<Rental> rentals =
        ref.watch(myRentalsProvider).valueOrNull ?? const <Rental>[];
    for (final Rental rental in rentals) {
      if (rental.isLive && rental.belongsTo(userId)) return rental;
    }
    return null;
  },
  name: 'activeRental',
);

/// Ids de las sillas que el actor tiene alquiladas AHORA MISMO.
///
/// Es la lista con la que se responde "¿esta silla ocupada es la mía?" sin llamar
/// a `GET /rentals/chair/:id/active`. Ese endpoint no está acotado al actor y
/// filtra el nombre de cualquier cliente, así que para un `CUSTOMER` la única
/// fuente válida son sus propios alquileres.
final Provider<List<int>> myActiveChairIdsProvider = Provider<List<int>>(
  (Ref ref) {
    final int userId = ref.watch(currentUserProvider)?.id ?? 0;
    final List<Rental> rentals =
        ref.watch(myRentalsProvider).valueOrNull ?? const <Rental>[];
    return <int>[
      for (final Rental rental in rentals)
        if (rental.isLive &&
            rental.chairId != null &&
            rental.belongsTo(userId))
          rental.chairId!,
    ];
  },
  name: 'myActiveChairIds',
);

/// Invalida el mapa y los alquileres: se llama tras CUALQUIER acción que pueda
/// haber cambiado el estado de una silla (reservar, alquilar, extender, cerrar,
/// bloquear). Quien está mirando el plano en el local lo ve antes que nadie, y
/// recargar a mano para enterarse de lo que uno mismo acaba de hacer sería absurdo.
void refreshChairMap(WidgetRef ref) {
  ref.invalidate(venueMapProvider);
  ref.invalidate(myRentalsProvider);
}

/// `true` cuando la consulta de alquileres YA TERMINÓ con éxito y no hay ninguno
/// vivo. Es lo que permite pintar "no tienes ninguna silla" con seguridad: si la
/// consulta falló, `hasValue` es `false` y la pantalla muestra el error con
/// reintento en vez de un "no tienes ninguna" que sería mentira.
final Provider<bool> hasNoActiveRentalProvider = Provider<bool>(
  (Ref ref) {
    final AsyncValue<List<Rental>> rentals = ref.watch(myRentalsProvider);
    if (!rentals.hasValue) return false;
    return ref.watch(activeRentalProvider) == null;
  },
  name: 'hasNoActiveRental',
);

/// Detalle de la silla seleccionada, con lo que el rol actual puede hacer.
///
/// `autoDispose` a propósito: al cerrar el panel (o al tocar fuera del bottom
/// sheet) el provider desaparece y su estado se libera. Una familia sin
/// `autoDispose` guardaría un `AsyncValue` por cada silla que se ha abierto en la
/// sesión, que es una fuga de memoria disfrazada de caché.
///
/// LA IDENTIDAD DEL OCUPANTE SOLO SE PIDE PARA PERSONAL
/// [chairOccupancyProvider] llama a `GET /rentals/chair/:id/active` únicamente si
/// [ChairCapabilities.canSeeOccupantIdentity] está en el token. Ese endpoint NO
/// está acotado al actor (verificado: un `CUSTOMER` recibe el `customerName` de
/// quien ocupa cualquier silla), así que para un cliente la respuesta del panel se
/// queda sin nombre y el panel habla de "otra persona".
final AutoDisposeFutureProviderFamily<ChairOccupancy, int>
    chairOccupancyProvider =
    AutoDisposeFutureProvider.family<ChairOccupancy, int>(
  (Ref ref, int chairId) async {
    final int currentUserId = ref.watch(currentUserProvider)?.id ?? 0;
    final Result<ChairOccupancy> occupancy = await ref
        .watch(rentalRepositoryProvider)
        .chairOccupancy(
          chairId: chairId,
          currentUserId: currentUserId,
          myActiveChairIds: ref.watch(myActiveChairIdsProvider),
        );

    return switch (occupancy) {
      FailureResult<ChairOccupancy>(:final Failure failure) => throw failure,
      Success<ChairOccupancy>(:final ChairOccupancy value) =>
        await _withOccupant(ref, value, currentUserId: currentUserId),
    };
  },
  name: 'chairOccupancy',
);

/// Segunda pasada, solo para personal: añade la identidad de quien ocupa la silla.
///
/// Si la consulta extra falla, se devuelve la ocupación tal cual. Perder el nombre
/// de la persona es una molestia; perder el PANEL entero porque falló una consulta
/// opcional sería un fallo mucho peor.
Future<ChairOccupancy> _withOccupant(
  Ref ref,
  ChairOccupancy occupancy, {
  required int currentUserId,
}) async {
  final bool allowed = ref.watch(chairCapabilitiesProvider).canSeeOccupantIdentity;
  if (!allowed) return occupancy;
  final Result<ChairRental?> rental =
      await ref.read(rentalRepositoryProvider).activeRentalByChair(occupancy.chair.id);
  return switch (rental) {
    Success<ChairRental?>(:final ChairRental? value) => value == null
        ? occupancy
        : occupancy.withOccupant(
            value,
            allowed: true,
            currentUserId: currentUserId,
          ),
    FailureResult<ChairRental?>() => occupancy,
  };
}
