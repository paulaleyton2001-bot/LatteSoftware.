// Estado de la pestaña «Silla».
//
// QUÉ MUESTRA
//   1. Mi alquiler/reserva ACTIVA con temporizador en vivo, o un mensaje claro de
//      que no tengo ninguna.
//   2. El mapa del local, para ver qué hay libre.
//
// DE DÓNDE SALE CADA COSA
//   - El alquiler: `GET /rentals` (`rentals:read` es parcial para `CUSTOMER`, así
//     que devuelve los suyos). El reloj del temporizador es
//     `clockProvider` de `shared/widgets/rental_countdown.dart`, compartido con el
//     detalle del pedido.
//   - El mapa: `venueMapProvider` (`core/customer`), el MISMO provider que usa el
//     checkout. Que sea el mismo garantiza que el precio y el estado que se ven al
//     elegir son los mismos que se ven en la pestaña: si fueran dos, la persona
//     vería una silla libre aquí y ocupada al reservarla.
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
import '../data/datasources/remote/chair_remote_datasource.dart';
import '../data/repositories/rental_repository_impl.dart';
import '../domain/repositories/rental_repository.dart';

/// Mapa de sillas. El MISMO provider que el checkout.
final FutureProvider<ChairMap> chairTabMapProvider = venueMapProvider;

/// Repositorio de alquileres de la pestaña «Silla».
final Provider<RentalRepository> rentalRepositoryProvider =
    Provider<RentalRepository>(
  (Ref ref) => RentalRepositoryImpl(
    ChairRemoteDataSource(ref.watch(apiClientProvider)),
    ref.watch(currentUserProvider)?.id ?? 0,
  ),
  name: 'rentalRepository',
);

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

/// El alquiler VIVO del cliente (o reserva en curso), si tiene uno.
///
/// `ACTIVE` y `EXTENDED` cuentan: los dos significan "estoy pagando por esta
/// silla ahora mismo" (`RentalStatus`, API.md §6.2). Los ya cerrados no se
/// muestran aquí: viven en «Mis pedidos».
final Provider<Rental?> activeRentalProvider = Provider<Rental?>(
  (Ref ref) {
    final List<Rental> rentals =
        ref.watch(myRentalsProvider).valueOrNull ?? const <Rental>[];
    for (final Rental rental in rentals) {
      if (rental.isLive) return rental;
    }
    return null;
  },
  name: 'activeRental',
);

/// Invalida el mapa (tras un `409` de silla ocupada, para que quien mira vea el
/// estado nuevo sin tirar de la pantalla).
void refreshChairMap(WidgetRef ref) => ref.invalidate(venueMapProvider);

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
