// Implementación de `RentalRepository`. Módulo `features/chair/data`.
//
// NINGÚN MÉTODO LANZA: todo va en `Result<T>`, con `ApiException` como única
// puerta de entrada de fallos de red. `ArgumentError` de la capa de datos SÍ se
// deja escapar (es un fallo de programación del llamador, no del servidor) y por eso
// se recoge aparte para poder devolverlo como `Failure` en vez de reventar.
//
// LA SESIÓN ENTRA POR EL CONSTRUCTOR, NO POR CADA LLAMADA
// `_customerId` y `_canSeeOccupantIdentity` son parte del contexto de la instancia
// porque no cambian durante la sesión. Pasarlos en cada método los haría
// forgetting-prone justo en el método donde más importan (el que borra datos de
// otro cliente).

import 'dart:math' as math;

import '../../../../core/customer/chair_map.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../../orders/domain/entities/rental.dart';
import '../../domain/entities/chair_booking.dart';
import '../../domain/repositories/rental_repository.dart';
import '../datasources/remote/chair_booking_datasource.dart';
import '../datasources/remote/chair_remote_datasource.dart';

/// Repositorio de alquileres y reservas de la pestaña «Silla».
class RentalRepositoryImpl implements RentalRepository {
  const RentalRepositoryImpl(
    this._bookings,
    this._rentals,
    this._customerId, {
    bool canSeeOccupantIdentity = false,
  }) : _canSeeOccupantIdentity = canSeeOccupantIdentity;

  /// Reservas, cotizaciones, alquileres y estado de la silla.
  final ChairBookingDataSource _bookings;

  /// `GET /rentals` del actor. Vive en su propio datasource porque la respuesta es
  /// la entidad `Rental` que también consume `features/orders`.
  final ChairRemoteDataSource _rentals;

  /// `id` del actor. `0` = sin sesión: no se sale a la red.
  final int _customerId;

  /// `rentals:read:any`. Con `false`, [activeRentalByChair] borra la identidad del
  /// ocupante aunque el servidor la mande.
  final bool _canSeeOccupantIdentity;

  @override
  Future<Result<List<Rental>>> myRentals() async {
    if (_customerId <= 0) {
      return const Success<List<Rental>>(<Rental>[]);
    }
    return _guard(_rentals.myRentals);
  }

  @override
  Future<Result<ChairOccupancy>> chairOccupancy({
    required int chairId,
    required int currentUserId,
    required List<int> myActiveChairIds,
  }) =>
      _guard(() => _bookings.chairOccupancy(
            chairId: chairId,
            currentUserId: currentUserId,
            myActiveChairIds: myActiveChairIds,
          ));

  @override
  Future<Result<ChairRental?>> activeRentalByChair(int chairId) => _guard(
        () => _bookings.activeRentalByChair(
          chairId,
          currentUserId: _customerId,
          includeOccupantIdentity: _canSeeOccupantIdentity,
        ),
      );

  @override
  Future<Result<ChairBookingQuote>> quote({
    required int chairId,
    required ChairBookingSlot slot,
  }) =>
      _guard(() => _bookings.quote(chairId: chairId, slot: slot));

  @override
  Future<Result<ChairBooking>> createReservation({
    required int chairId,
    required ChairBookingSlot slot,
    String? notes,
  }) =>
      _guard(() => _bookings.createReservation(
            chairId: chairId,
            slot: slot,
            notes: notes,
          ));

  @override
  Future<Result<ChairBooking>> confirmReservation(int reservationId) =>
      _guard(() => _bookings.confirmReservation(reservationId));

  @override
  Future<Result<ChairBooking>> cancelReservation(
    int reservationId, {
    required String reason,
  }) =>
      _guard(() => _bookings.cancelReservation(reservationId, reason: reason));

  @override
  Future<Result<ChairRental>> openWalkInRental({
    required int chairId,
    required int plannedMinutes,
    int? customerId,
  }) =>
      _guard(() => _bookings.openWalkInRental(
            chairId: chairId,
            plannedMinutes: plannedMinutes,
            idempotencyKey: newIdempotencyKey(),
            // Sin `customerId` el servidor asigna el del actor cuando es
            // `CUSTOMER`, y `null` cuando es personal (un walk-in de mostrador
            // puede no tener cliente detrás). Solo se manda si el controlador
            // lo ha pedido explícitamente.
            customerId: customerId,
          ));

  @override
  Future<Result<ChairRental>> extendRental({
    required int rentalId,
    required int additionalMinutes,
  }) =>
      _guard(() => _bookings.extendRental(
            rentalId: rentalId,
            additionalMinutes: additionalMinutes,
          ));

  @override
  Future<Result<ChairRental>> completeRental(int rentalId) =>
      _guard(() => _bookings.completeRental(rentalId));

  @override
  Future<Result<ChairInfo>> setChairStatus({
    required int chairId,
    required String status,
    String? reason,
  }) =>
      _guard(() => _bookings.setChairStatus(
            chairId: chairId,
            status: status,
            reason: reason,
          ));

  /// Envuelve la llamada y traduce CUALQUIER excepción a `Failure`.
  ///
  /// `ArgumentError` se traduce a [ValidationFailure] en vez de propagarse: aunque
  /// es un fallo de programación, romper la pantalla con una excepción roja por
  /// mandar `BLOCKED` sin motivo no le aporta nada a quien está delante del móvil.
  Future<Result<T>> _guard<T>(Future<T> Function() action) async {
    try {
      return Success<T>(await action());
    } on ArgumentError catch (error) {
      return FailureResult<T>(
        ValidationFailure(
          message: error.message?.toString() ?? 'Datos no válidos.',
          fieldErrors: <FieldError>[
            FieldError(
              path: error.name?.toString() ?? 'body',
              message: error.message?.toString() ?? 'Valor no válido.',
            ),
          ],
        ),
      );
    } on Object catch (error) {
      return FailureResult<T>(ApiException.toFailure(error));
    }
  }
}

/// Fuente aleatoria de las claves de idempotencia.
///
/// Una sola instancia: `Random.secure()` se instancia UNA vez y se reutiliza.
/// Crear uno por clave es un desperdicio y, en algunos plataformas, una lectura
/// del pool de entropía por llamada.
final math.Random _secureRandom = math.Random.secure();

/// Clave de idempotencia para `POST /rentals`.
///
/// El backend NO la exige hoy (verificado con `curl`: `201` sin la cabecera, y
/// `docs/API.md` §1 dice que `POST /payments` es el único que la exige), pero se
/// manda igualmente: si algún día el walk-in pasa a ser idempotente, el cliente ya
/// lo estará usando y no habrá que tocar la capa de red.
///
/// v4 con `dart:math`: no se usa `uuid` porque el proyecto no depende de él y
/// añadir una dependencia por una cabecera está excluido por las reglas del trabajo.
/// La fuente aleatoria de `Random.secure()` es criptográficamente válida, que es lo
/// que exige el contrato (`Idempotency-Key` = UUID v4).
String newIdempotencyKey() {
  final List<int> bytes = List<int>.generate(
    16,
    (int _) => _secureRandom.nextInt(256),
    growable: false,
  );
  // La versión (4) y la variante (RFC 4122) son FIJOS: sin ellos no es un v4 y un
  // validador estricto lo rechazaría.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  final String hex = bytes
      .map((int byte) => byte.toRadixString(16).padLeft(2, '0'))
      .join();
  return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
      '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
}
