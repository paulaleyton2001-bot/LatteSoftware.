// Contrato de alquileres y reservas de la pestaña «Silla».
// Módulo `features/chair/domain/repositories`.
//
// QUÉ CAMBIA RESPECTO A LA VERSIÓN ANTERIOR
// Antes este archivo declaraba SOLO `myRentals()` y su cabecera explicaba por qué
// («la app del cliente no abre alquileres ni los extiende sin permiso»). Eso era
// cierto, pero la conclusión que se había sacado era equivocada: de «el cliente no
// puede abrir alquileres» no se sigue «el cliente no puede RESERVAR». La reserva
// (`reservations:create`) sí la tiene, y es el camino que le corresponde.
//
// LA MATRIZ REAL, VERIFICADA CON PETICIONES (2026-09-29)
// Ver `chair_capabilities.dart` para el detalle con las respuestas `403` textuales.
// Resumen de lo que este repositorio DEJA LLAMAR y lo que NO:
//
//   CUSTOMER   GET /chairs/map            sí
//              GET /chairs/:id            sí
//              GET /rentals               sí (solo los suyos, lo fuerza el service)
//              GET /reservations/quote    sí
//              POST /reservations         sí   ← camino del cliente
//              POST /rentals              NO   403 rentals:create
//              POST /rentals/:id/extend   NO   403 rentals:extend
//              POST /rentals/:id/complete NO   403 rentals:complete
//              PATCH /chairs/:id/status   NO   403 chairs:status:update
//
//   ADMIN      las nueve, sí.
//
// POR QUÉ LOS MÉTODOS DE ESCRITURA ESTÁN AQUÍ Y NO OCULTOS EN LA PANTALLA
// Que el método exista no significa que se pueda llamar: la comprobación del permiso
// la hace la INTERFAZ con `ChairCapabilities` (para poder explicar el motivo antes
// de que la persona pulse) y la hace el BACKEND de verdad (por si alguien llama al
// endpoint a mano). Los dos sitios, por razones distintas.

import '../../../../core/customer/chair_map.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/chair_booking.dart';
import '../../../orders/domain/entities/rental.dart';

/// Lecturas y escrituras del alquiler de sillas.
abstract interface class RentalRepository {
  /// `GET /rentals` — los alquileres del cliente autenticado, en una ventana de
  /// ±7 días alrededor de ahora.
  Future<Result<List<Rental>>> myRentals();

  /// `GET /chairs/:id` — la silla con su alquiler y su reserva en curso.
  ///
  /// Es la fuente de verdad del panel: trae las HORAS sin traer datos de la
  /// persona que ocupa la silla. [currentUserId] y [myActiveChairIds] se usan solo
  /// para responder "¿esta silla es la mía?", cruzando con los alquileres que el
  /// propio actor ya tiene cargados.
  Future<Result<ChairOccupancy>> chairOccupancy({
    required int chairId,
    required int currentUserId,
    required List<int> myActiveChairIds,
  });

  /// `GET /rentals/chair/:chairId/active` — el alquiler vivo de la silla, o `null`.
  ///
  /// SOLO para personal con `rentals:read:any`: el endpoint no está acotado al
  /// actor y devuelve el `customerId`/`customerName` de cualquiera. La
  /// implementación borra esos dos campos si el repositorio se construyó sin ese
  /// permiso, de modo que ni siquiera la capa de datos puede filtrarlos por
  /// accidente. Un cliente NO debe llamarlo (ver la nota de privacidad en
  /// `ChairOccupancy`).
  Future<Result<ChairRental?>> activeRentalByChair(int chairId);

  /// `GET /reservations/quote` — precio de una franja. No crea nada.
  Future<Result<ChairBookingQuote>> quote({
    required int chairId,
    required ChairBookingSlot slot,
  });

  /// `POST /reservations` — reserva para una franja concreta.
  ///
  /// `createOrder: false`: la reserva va sola, sin pedido. Un pedido solo nace
  /// cuando alguien consume algo (checkout) o cuando sala hace el check-in.
  ///
  /// DEVUELVE `PENDING`, Y ESO NO APARTA LA SILLA. Verificado con `curl`: tras el
  /// `POST`, `GET /chairs/:id` sigue devolviendo `status: "AVAILABLE"`. Hay que
  /// llamar a [confirmReservation] para que la silla pase a `RESERVED`.
  Future<Result<ChairBooking>> createReservation({
    required int chairId,
    required ChairBookingSlot slot,
    String? notes,
  });

  /// `POST /reservations/:id/confirm` — `PENDING -> CONFIRMED`, y la silla a
  /// `RESERVED`. Exige `reservations:update`, que el `CUSTOMER` sí tiene.
  Future<Result<ChairBooking>> confirmReservation(int reservationId);

  /// `POST /reservations/:id/cancel` — libera la silla. Exige `reservations:cancel`
  /// y `reason` (obligatorio en el backend).
  Future<Result<ChairBooking>> cancelReservation(
    int reservationId, {
    required String reason,
  });

  /// `POST /rentals` — alquiler sin cita. Exige `rentals:create`.
  Future<Result<ChairRental>> openWalkInRental({
    required int chairId,
    required int plannedMinutes,
    int? customerId,
  });

  /// `POST /rentals/:id/extend` — amplía el alquiler. Exige `rentals:extend`.
  Future<Result<ChairRental>> extendRental({
    required int rentalId,
    required int additionalMinutes,
  });

  /// `POST /rentals/:id/complete` — cierra el alquiler. Exige `rentals:complete`.
  Future<Result<ChairRental>> completeRental(int rentalId);

  /// `PATCH /chairs/:id/status` — cambio manual de estado.
  /// Exige `chairs:status:update` y `reason` si el destino es `BLOCKED` o
  /// `MAINTENANCE` (el backend responde `400` sin él).
  Future<Result<ChairInfo>> setChairStatus({
    required int chairId,
    required String status,
    String? reason,
  });
}
