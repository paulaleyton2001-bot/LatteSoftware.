// Contrato de datos del mostrador. Capa de dominio: no sabe de HTTP.
//
// El POS necesita exactamente seis operaciones. Cada una devuelve `Result<T>` y
// NUNCA lanza: el mostrador no puede romperse a mitad de un cobro, así que el
// fallo travels como valor y la UI decide qué hacer con él.
//
// Lo que NO está aquí y por qué:
//   - La cola offline. `core/storage/offline_queue.dart` existe y se puede
//     encolar un `PendingOperation`, pero NO se reenvía automáticamente
//     (`NoopSyncEngine`): el POS avisa de que no hay red y sugiere el cobro
//     manual. Prometer una sincronización que no existe es peor que no
//     mencionarla.
//   - La pasarela de pagos. No existe.

import '../../../../core/result/result.dart';
import '../entities/pos_charge.dart';
import './pos_repository_models.dart';

/// Datos del mostrador (catálogo y cobro).
abstract interface class PosRepository {
  /// `GET /products?fields=basic` — catálogo compacto para la rejilla.
  ///
  /// Se pide `fields=basic` porque el endpoint lo ofrece "pensado para la
  /// pantalla del POS con catálogo grande" (API.md §7.11). `pageSize` es el
  /// máximo del endpoint (100) y `includeInactive=false` para que no aparezcan
  /// productos dados de baja. La MISMA respuesta trae `meta.categories`, que es
  /// de donde salen los nombres de los filtros.
  Future<Result<PosCatalog>> catalog();

  /// `POST /orders` — materializa el pedido y devuelve sus totales REALES.
  ///
  /// Los totales del servidor sustituyen a los previsualizados del cliente
  /// (BR-PRICE-008): el cajero ve lo que se va a cobrar de verdad, con el
  /// descuento del cupón y los impuestos ya aplicados.
  Future<Result<PosOrderResult>> createOrder(PosOrderDraftRequest request);

  /// `POST /payments` — registra el cobro con cabecera `Idempotency-Key`.
  ///
  /// [idempotencyKey] es OBLIGATORIO: sin él el backend responde `400`
  /// `IDEMPOTENCY_KEY_REQUIRED`. Se genera una vez por intento de cobro y se
  /// reutiliza en los reintentos del MISMO intento.
  Future<Result<PosChargeResult>> charge({
    required PosChargeRequest request,
    required int orderId,
    required String idempotencyKey,
  });

  /// `POST /orders/:id/status` — transición rápida del tablero.
  ///
  /// Devuelve el `orderNumber` para que la UI pueda anunciarlo al cajero.
  Future<Result<PosOrderTransitionResult>> changeOrderStatus({
    required int orderId,
    required String toStatus,
    String? reason,
  });

  /// `GET /payments/methods` — métodos habilitados y si exigen referencia.
  Future<Result<List<PosPaymentMethodOption>>> paymentMethods();

  /// `POST /rentals` — arranca el alquiler sobre una silla.
  ///
  /// Es el camino del mostrador cuando un cliente se sienta: abre el alquiler,
  /// pone la silla en `OCCUPIED` y congela el precio por hora. [reservationId]
  /// es OBLIGATORIO en la práctica, no por capricho: `POST /orders` no admite un
  /// pedido `CHAIR_RENTAL` sin reserva (`422
  /// RENTAL_REQUIRES_CHAIR_AND_RESERVATION`), así que un alquiler sin reserva
  /// sería un alquiler que no se puede cobrar.
  ///
  /// Y hay una trampa: la reserva debe estar `CONFIRMED` o el backend responde
  /// `422 RESERVATION_NOT_ACTIVE` con la pista «Confirme la reserva antes de
  /// abrir el alquiler». [createReservation] + [confirmReservation] son el
  /// atajo para el cliente sin reserva previa.
  ///
  /// Da `409 CHAIR_OCCUPIED` si la silla se ocupó entre medias.
  Future<Result<PosRentalStart>> startRental({
    required int chairId,
    required int plannedMinutes,
    required int reservationId,
  });

  /// `GET /reservations?chairId=&from=&to=` — las reservas de UNA silla.
  ///
  /// Es lo que el mostrador necesita para ofrecer «el cliente reservó esta
  /// silla» con un toque, en vez de dejar que el cajero teclee un id que no
  /// conoce. Se acota en el tiempo porque una silla tiene un puñado de reservas
  /// futuras, no su historial entero.
  Future<Result<List<PosReservation>>> chairReservations({
    required int chairId,
    required DateTime from,
    required DateTime to,
  });

  /// `POST /reservations` — reserva inmediata, para el cliente que llega sin
  /// haber reservado.
  ///
  /// Devuelve la reserva en `PENDING`; hay que [confirmReservation] antes de
  /// arrancar el alquiler.
  Future<Result<PosReservation>> createReservation({
    required int chairId,
    required DateTime startAt,
    required DateTime endAt,
  });

  /// `POST /reservations/:id/confirm` — `PENDING -> CONFIRMED`.
  ///
  /// Idempotente si ya está `CONFIRMED` (API.md §7.8), que es justo lo que
  /// necesita el mostrador: si el cajero pulsa dos veces, no se rompe nada.
  Future<Result<PosReservation>> confirmReservation(int reservationId);

  /// `GET /orders/:id/receipt` — comprobante para reimprimir.
  Future<Result<PosReceipt>> receipt(int orderId);
}
/// Cuerpo de `POST /orders` ya aplanado (el dominio no conoce `Dio`).
class PosOrderDraftRequest {
  const PosOrderDraftRequest({
    required this.items,
    required this.type,
    this.chairId,
    this.reservationId,
    this.rentalId,
    this.tableLabel,
    this.notes,
    this.couponCode,
    this.channel = 'POS',
  });

  /// Líneas del pedido, en el orden en que las ve el cajero.
  final List<PosOrderLineRequest> items;

  /// `OrderType` (`TAKEAWAY`, `DINE_IN`, `CHAIR_RENTAL`).
  final String type;

  final int? chairId;
  final int? reservationId;
  final int? rentalId;
  final String? tableLabel;
  final String? notes;
  final String? couponCode;

  /// `OrderChannel`. El mostrador ES `POS` por definición.
  final String channel;

  Map<String, dynamic> toBody() => <String, dynamic>{
        'type': type,
        'channel': channel,
        'items': <Map<String, dynamic>>[
          for (final PosOrderLineRequest line in items) line.toBody(),
        ],
        if (chairId != null) 'chairId': chairId,
        if (reservationId != null) 'reservationId': reservationId,
        if (rentalId != null) 'rentalId': rentalId,
        if (tableLabel != null && tableLabel!.isNotEmpty) 'tableLabel': tableLabel,
        if (notes != null && notes!.isNotEmpty) 'notes': notes,
        if (couponCode != null && couponCode!.isNotEmpty) 'couponCode': couponCode,
      };
}

/// Una línea del pedido en curso.
class PosOrderLineRequest {
  const PosOrderLineRequest({
    required this.productId,
    required this.quantity,
    this.variantId,
    this.notes,
  });

  final int productId;
  final double quantity;
  final int? variantId;

  /// Instrucciones de preparación (máx. 300).
  final String? notes;

  Map<String, dynamic> toBody() => <String, dynamic>{
        'productId': productId,
        'quantity': quantity,
        if (variantId != null) 'variantId': variantId,
        if (notes != null && notes!.isNotEmpty) 'notes': notes,
      };
}
