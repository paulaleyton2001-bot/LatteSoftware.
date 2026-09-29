// Implementación de `CheckoutRepository`. Módulo `features/checkout/data`.
//
// NINGÚN MÉTODO LANZA. Todo va en `Result<T>`.
//
// EL CHECKOUT ES UNA OPERACIÓN CON DOS LLAMADAS Y UN RIESGO REAL
// Se crea la reserva (si hay silla) y luego el pedido. Si el pedido falla DESPUÉS
// de haber creado la reserva, la persona ya tiene una reserva suelta. Eso no se
// puede deshacer desde el cliente (cancelar una reserva exige `POST
// /reservations/:id/cancel`, que es otra llamada y puede fallar también), así que
// el fallo se propaga con un mensaje que explica qué pasó y qué hacer, en vez de
// tragárselo y dejar a la persona con la duda de si le cogieron la silla.


import '../../../../core/customer/cart_state.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/result/result.dart';
import '../../domain/entities/chair_quote.dart';
import '../../domain/repositories/checkout_repository.dart';
import '../datasources/remote/checkout_remote_datasource.dart';

/// Repositorio del checkout sobre el datasource remoto.
class CheckoutRepositoryImpl implements CheckoutRepository {
  const CheckoutRepositoryImpl(this._remote);

  final CheckoutRemoteDataSource _remote;

  @override
  Future<Result<int?>> defaultLocationId() => _guard(() async {
        final int? id = await _remote.defaultLocationId();
        return Success<int?>(id);
      });

  @override
  Future<Result<ChairMap>> chairMap(int locationId) => _guard(() async {
        return Success<ChairMap>(await _remote.chairMap(locationId));
      });

  /// La ocupación se puede pedir a una silla que el backend ya no conoce (se dio de
  /// baja entre la apertura del mapa y el toque): eso NO es un fallo de la acción,
  /// es «no hay dato», así que devuelve `null` en vez de un `NotFoundFailure` que
  /// la pantalla tendría que distinguir de un error de red.
  @override
  Future<Result<ChairOccupancy?>> chairOccupancy(int chairId) => _guard(() async {
        return Success<ChairOccupancy?>(await _remote.chairOccupancy(chairId));
      });

  @override
  Future<Result<ChairQuote>> quote({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
    String? couponCode,
  }) =>
      _guard(() async => Success<ChairQuote>(await _remote.quote(
            chairId: chairId,
            startAt: startAt,
            endAt: endAt,
            couponCode: couponCode,
          )));

  @override
  Future<Result<PlacedOrder>> place(CheckoutRequest request) => _guard(() async {
        ReservationCreated? reservation;
        final int? chairId = request.chairId;

        // 1) Reserva, si hay silla. `CHAIR_RENTAL` la necesita sí o sí
        //    (`RENTAL_REQUIRES_CHAIR_AND_RESERVATION`); en `DINE_IN` con silla es
        //    lo que la APARTA para que nadie más la tome.
        if (chairId != null && request.startAt != null && request.endAt != null) {
          reservation = await _remote.createReservation(
            chairId: chairId,
            startAt: request.startAt!,
            endAt: request.endAt!,
            notes: request.customerNotes,
          );
        }

        // 2) El pedido, con los productos del carrito. Nunca se envían totales:
        //    el backend los calcula y rechaza el body con campos de total
        //    (`FIELD_NOT_EDITABLE`).
        final PlacedOrder order = await _remote.createOrder(
          type: request.type,
          items: _itemsOf(request.cart),
          chairId: request.type == 'TAKEAWAY' ? null : chairId,
          reservationId: reservation?.id,
          couponCode: request.couponCode,
          customerNotes: request.customerNotes,
        );
        return Success<PlacedOrder>(order);
      });

  // ----------------------------------------------------------------- Privados
  /// `items[]` de `POST /orders` (API.md §7.12).
  ///
  /// Solo ids y cantidades: `productId`, `variantId`, `quantity`, `addons[]` y
  /// `notes`. El precio NO viaja (el servidor lo resuelve con su catálogo y sus
  /// reglas), y por eso el carrito puede traer un precio de hace una hora sin que
  /// afecte al cobro.
  static List<Map<String, dynamic>> _itemsOf(CartState cart) =>
      <Map<String, dynamic>>[
        for (final CartLine line in cart.lines)
          <String, dynamic>{
            'productId': line.productId,
            if (line.variantId != null) 'variantId': line.variantId,
            'quantity': line.quantity,
            if (line.addons.isNotEmpty)
              'addons': <Map<String, dynamic>>[
                for (final CartAddonSelection addon in line.addons)
                  <String, dynamic>{
                    'productAddonId': addon.addonId,
                    'quantity': addon.quantity,
                  },
              ],
            if (line.notes.isNotEmpty) 'notes': line.notes,
          },
      ];

  /// Ejecuta [action]; cualquier excepción sale como `FailureResult`.
  ///
  /// Un `409` de silla ocupada o reservada conserva su `details.code`
  /// (`CHAIR_OCCUPIED`, `CHAIR_ALREADY_RESERVED`), que es lo que permite a la UI
  /// ofrecer "elegir otra silla" en vez de un error genérico.
  Future<Result<T>> _guard<T>(Future<Result<T>> Function() action) async {
    try {
      return await action();
    } on Object catch (error) {
      return FailureResult<T>(_translate(ApiException.toFailure(error)));
    }
  }

  /// Ajusta el mensaje de los conflictos de silla para que sea accionable.
  ///
  /// `ErrorMapper` conserva el mensaje del backend, que es correcto pero técnico
  /// ("La silla está ocupada"). Aquí se reescribe solo para esos dos códigos,
  /// añadiendo qué hacer; el resto de fallos se tocan lo menos posible.
  static Failure _translate(Failure failure) {
    final String? code = failure.code;
    if (code != 'CHAIR_OCCUPIED' && code != 'CHAIR_ALREADY_RESERVED') {
      return failure;
    }
    return ConflictFailure(
      message: code == 'CHAIR_OCCUPIED'
          ? 'Esa silla se acaba de ocupar. Elige otra y lo intentamos de nuevo.'
          : 'Esa silla ya está reservada para ese horario. Elige otra.',
      code: code,
      fieldErrors: failure.fieldErrors,
      requestId: failure.requestId,
    );
  }
}

/// Códigos de `error.details.code` con los que el checkout reacciona
/// específicamente (API.md §8.2). Se comparan por CONSTANTE y no por literal en
/// la pantalla, para que un cambio de nomenclatura en el backend se vea en un
/// solo sitio.
abstract final class CheckoutErrorCodes {
  const CheckoutErrorCodes._();

  /// `409` — la silla está ocupada ahora mismo.
  static const String chairOccupied = 'CHAIR_OCCUPIED';

  /// `409` — hay otra reserva en esa franja.
  static const String chairAlreadyReserved = 'CHAIR_ALREADY_RESERVED';

  /// `422` — la silla no admite reservas.
  static const String chairNotBookable = 'CHAIR_NOT_BOOKABLE';

  /// `422` — falta silla o reserva para un pedido de alquiler.
  static const String rentalRequiresChair = 'RENTAL_REQUIRES_CHAIR_AND_RESERVATION';

  /// `422` — la duración supera el máximo del negocio.
  static const String reservationTooLong = 'RESERVATION_TOO_LONG';

  /// `true` si el fallo se resuelve eligiendo otra silla.
  static bool isChairConflict(Failure failure) {
    final String? code = failure.code;
    return code == chairOccupied ||
        code == chairAlreadyReserved ||
        code == chairNotBookable;
  }
}
