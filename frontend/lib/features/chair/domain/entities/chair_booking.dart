// Entidades del flujo de alquiler de sillas. Módulo `features/chair/domain/entities`.
//
// POR QUÉ NO SE REUSA `features/checkout/domain/entities/chair_quote.dart`
// ------------------------------------------------------------------------
// Las features no se importan entre sí (`docs/DESIGN.md` §2.3). La entidad
// `ChairQuote` del checkout está atada a su propio flujo (el checkout además crea
// un `POST /orders` con el carrito y usa `rentalTotalMinor` solo como
// previsualización). La cotización de la pestaña «Silla» tiene otro consumidor: un
// panel que muestra el precio ANTES de confirmar una reserva que va sola, sin
// pedido. Duplicar una entidad de 15 campos es barato; importar otra feature para
// evitarlo rompe la regla de capas y ata dos pantallas que evolucionan por motivos
// distintos.
//
// Contrato con el backend (verificado con peticiones reales, 2026-09-29):
//   GET  /reservations/quote → data: { chair, zone, startAt, endAt,
//        durationMinutes, billableMinutes, minApplied, pricePerHourMinor,
//        subtotalMinor, discountMinor, taxMinor, serviceFeeMinor, totalMinor,
//        taxRateBp, isAvailable, conflict, appliedRules }
//   POST /reservations       → data: Reservation (plana, con `code`)
//   GET  /chairs/:id          → data: { chair: {...}, currentReservation,
//                                        currentRental, stats }
//   POST /rentals             → data: { rental, chairStatus, chairStatusChangedAt }
//   POST /rentals/:id/extend  → data: { rental, extension, order }
//   POST /rentals/:id/complete→ data: { rental, order, chair, charge }
//
// DESVIACIONES DE `docs/API.md` QUE SÍ IMPORTAN (documentadas, no parcheadas)
//   · `POST /rentals`: API.md §7.9 dice que devuelve `{ rental, chair, order,
//     reservation }`. El backend real devuelve `{ rental, chairStatus,
//     chairStatusChangedAt }` (`rentals.controller.ts` L142). Se parsea la forma
//     REAL; `chair` y `order` no se leen porque no vienen.
//   · `GET /chairs/:id`: API.md §7.7 dice `{ ...Chair, zone, ... }` (aplanado).
//     El backend real anida la silla en `data.chair` (`spaces.controller.ts`).
//     Se parsea la anidada.

import 'package:flutter/foundation.dart';

import '../../../../core/customer/chair_map.dart';
import '../../../../core/utils/currency_formatter.dart';

/// Franja y duración elegidas para reservar. Lo que produce la interfaz antes de
/// cotizar.
@immutable
class ChairBookingSlot {
  const ChairBookingSlot({required this.startAt, required this.endAt});

  /// Inicio en UTC. El backend no acepta más de 5 min en el pasado
  /// (`PAST_DATE`, API.md §7.8).
  final DateTime startAt;

  /// Fin en UTC. Tiene que ser strictly posterior a [startAt].
  final DateTime endAt;

  int get durationMinutes => endAt.difference(startAt).inMinutes;

  bool get isValid => endAt.isAfter(startAt);

  /// `true` si la franja está en el pasado (o a punto de estarlo).
  ///
  /// El corte son los 5 minutos de tolerancia del servidor: se calcula igual que
  /// él para que el botón no se habilite y el `POST` devuelva `400 PAST_DATE`.
  bool isInPast({DateTime? now}) =>
      startAt.isBefore((now ?? DateTime.now().toUtc()).subtract(const Duration(minutes: 5)));

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChairBookingSlot &&
          other.startAt == startAt &&
          other.endAt == endAt;

  @override
  int get hashCode => Object.hash(startAt, endAt);

  @override
  String toString() =>
      'ChairBookingSlot(${startAt.toIso8601String()} → ${endAt.toIso8601String()})';
}

/// Opciones fijas de duración que ofrece el panel.
///
/// Cubren lo que la gente pide de verdad (una o dos horas con café) y el
/// personalizado cubre el resto. Los límites los impone el backend: `POST
/// /reservations` valida `durationMinutes <= maxReservationMinutes` y
/// `GET /reservations/quote` devuelve `400 RESERVATION_TOO_LONG` si se pasa.
const List<int> kChairDurationPresets = <int>[30, 60, 120, 180, 240];

/// Etiqueta legible de una duración en minutos: `30 min`, `1 h`, `2 h`.
String chairDurationLabel(int minutes) {
  if (minutes <= 0) return '—';
  if (minutes < 60) return '$minutes min';
  final int hours = minutes ~/ 60;
  final int rest = minutes % 60;
  if (rest == 0) return '$hours h';
  return '$hours h $rest min';
}

/// Cotización de `GET /reservations/quote`.
///
/// ES UNA CONSULTA, NO UN ERROR: si la silla no está libre para la franja el
/// servidor responde `200` con `isAvailable = false` y la reserva que estorba en
/// `conflict` (API.md §7.8). Por eso la disponibilidad es un CAMPO del modelo y no
/// una excepción: un `409` aquí sería un error de diseño del cliente.
@immutable
class ChairBookingQuote {
  const ChairBookingQuote({
    required this.slot,
    required this.isAvailable,
    required this.pricePerHourMinor,
    required this.durationMinutes,
    required this.billableMinutes,
    required this.subtotalMinor,
    required this.totalMinor,
    this.minimumApplied = false,
    this.discountMinor = 0,
    this.taxMinor = 0,
    this.serviceFeeMinor = 0,
    this.taxRateBp = 0,
    this.conflictCode,
    this.chairName,
    this.chairCode,
    this.zoneName,
  });

  final ChairBookingSlot slot;

  /// `false` si hay otra reserva o alquiler en esa franja.
  final bool isAvailable;

  final int pricePerHourMinor;
  final int durationMinutes;

  /// Minutos que se cobran: el servidor ya aplicó el mínimo de 30 min.
  final int billableMinutes;

  final int subtotalMinor;
  final int discountMinor;
  final int taxMinor;
  final int serviceFeeMinor;

  /// Total según el servidor. Es el ÚNICO válido (BR-PRICE-008).
  final int totalMinor;

  /// `true` si se aplicó el mínimo de 30 min.
  final bool minimumApplied;

  /// `taxRateBp` en puntos básicos (1900 = 19 %).
  final int taxRateBp;

  /// Código de la reserva que estorba, si la hay.
  final String? conflictCode;

  final String? chairName;
  final String? chairCode;
  final String? zoneName;

  /// Motivo legible de por qué no se puede reservar, o `null` si sí se puede.
  String? get unavailableReason {
    if (isAvailable) return null;
    if (conflictCode != null) {
      return 'Esa franja ya está ocupada (reserva $conflictCode). Elige otra hora '
          'u otra silla.';
    }
    return 'Esa silla no está libre en esa franja. Elige otra hora u otra silla.';
  }

  /// `true` si hay algo que explicar antes de confirmar (mínimo, impuestos…).
  bool get hasAdjustments =>
      minimumApplied || taxMinor > 0 || serviceFeeMinor > 0 || discountMinor > 0;

  /// Resumen de una línea para el panel: `$6.000 / hora · 1 h`.
  String describeRate() {
    final StringBuffer buffer =
        StringBuffer('${CurrencyFormatter.formatMinor(pricePerHourMinor)} / hora');
    if (billableMinutes > 0) {
      buffer.write(' · ${chairDurationLabel(billableMinutes)}');
    }
    return buffer.toString();
  }

  /// Cotización "en curso" mientras se espera al servidor: conserva la franja y el
  /// precio por hora para que el panel no parpadee a vacío en cada cambio.
  factory ChairBookingQuote.pending({
    required ChairBookingSlot slot,
    int pricePerHourMinor = 0,
    String? chairCode,
  }) =>
      ChairBookingQuote(
        slot: slot,
        isAvailable: true,
        pricePerHourMinor: pricePerHourMinor,
        durationMinutes: slot.durationMinutes,
        billableMinutes: slot.durationMinutes,
        subtotalMinor: 0,
        totalMinor: 0,
        chairCode: chairCode,
      );

  @override
  String toString() =>
      'ChairBookingQuote(${slot.durationMinutes} min, $totalMinor, '
      'disponible: $isAvailable)';
}

/// Reserva creada o leída (`Reservation`, API.md §6.3).
///
/// Entidad mínima a propósito: el panel necesita el código (para enseñarlo) y el
/// estado (para decir si quedó `PENDING` o `CONFIRMED`). El resto se vuelve a pedir
/// si alguna vez hace falta.
@immutable
class ChairBooking {
  const ChairBooking({
    required this.id,
    required this.code,
    required this.status,
    this.chairId,
    this.chairCode,
    this.startAt,
    this.endAt,
    this.durationMinutes = 0,
    this.pricePerHourMinor = 0,
    this.rentalTotalMinor = 0,
  });

  final int id;

  /// `RES-` + 6-12 dígitos.
  final String code;

  /// `ReservationStatus`: `PENDING`, `CONFIRMED`, `ACTIVE`, `COMPLETED`,
  /// `CANCELLED`, `EXPIRED`.
  final String status;

  final int? chairId;
  final String? chairCode;
  final DateTime? startAt;
  final DateTime? endAt;
  final int durationMinutes;

  /// Precio por hora CONGELADO al crear la reserva.
  final int pricePerHourMinor;

  /// Proyección del coste que devuelve la reserva. ORIENTATIVA: el importe con
  /// impuestos lo fija el cobro, y aquí no hay pasarela.
  final int rentalTotalMinor;

  /// `true` si todavía se puede cancelar (`PENDING` o `CONFIRMED`).
  bool get isOpen => status == 'PENDING' || status == 'CONFIRMED';

  /// `true` mientras la reserva no se haya confirmado.
  ///
  /// IMPORTANTE, Y NO ES UN DETALLE: una reserva `PENDING` NO aparta la silla.
  /// Verificado con `curl` el 2026-09-29: tras `POST /reservations` la silla sigue
  /// en `AVAILABLE` y el `quote` de esa misma franja devuelve
  /// `isAvailable: false` con la `PENDING` en `conflict`. Solo `POST
  /// /reservations/:id/confirm` la pasa a `CONFIRMED` y pone la silla en
  /// `RESERVED`. Decir «la silla ya está reservada» con una `PENDING` sería
  /// mentira, y es justo lo que hace el texto que se quitó.
  bool get isPending => status == 'PENDING';

  @override
  String toString() => 'ChairBooking($code, $status)';
}

/// Ocupación actual de una silla (`GET /chairs/:id` + alquiler activo).
///
/// LA FUENTE DE LA VERDAD ES `GET /chairs/:id`
/// Trae `currentRental` y `currentReservation` con sus horas, y NO trae datos de la
/// persona que ocupa la silla. Es lo que hay que pintar por defecto.
///
/// `GET /rentals/chair/:id/active` SÍ trae `customerId`/`customerName`, pero NO está
/// acotado al actor: `rentals.service.ts#getActiveByChair` llama a
/// `findActiveByChair` sin filtrar por `customerId`, así que un `CUSTOMER` puede
/// leer el nombre de quien está sentado en cualquier silla. Verificado:
///
///   CUSTOMER (id 12) → GET /rentals/chair/16/active
///   {"customerId": 8, "customerName": "Julián Cardona", ...}
///   (PR-A1 la ocupa el usuario 8, Julián Cardona)
///
/// No se arregla aquí (el backend es de otro agente). La mitigación es de cliente y
/// está en DOS sitios, por si uno se queda corto:
///   1. [occupantName] devuelve `null` salvo que [isOccupantVisible] sea `true`.
///   2. Para un cliente, `isMine` se deduce de SUS PROPIOS alquileres
///      (`Rental.chairId`), sin llamar a ese endpoint en absoluto.
@immutable
class ChairOccupancy {
  const ChairOccupancy({
    required this.chair,
    this.rentalId,
    this.rentalCode,
    this.rentalStartAt,
    this.rentalEndAt,
    this.rentalStatus,
    this.reservationId,
    this.reservationCode,
    this.reservationStartAt,
    this.reservationEndAt,
    this.reservationStatus,
    this.occupantCustomerId,
    this.occupantName,
    this.isMine = false,
  });

  /// La silla tal como la devolvió `GET /chairs/:id` (estado, precio, zona…).
  final ChairInfo chair;

  /// `id` del alquiler vivo. Es lo que necesitan `POST /rentals/:id/extend` y
  /// `POST /rentals/:id/complete`, así que sin él el panel de una silla ocupada no
  /// puede ofrecer esas acciones ni al personal que sí las tiene.
  final int? rentalId;

  final String? rentalCode;
  final DateTime? rentalStartAt;
  final DateTime? rentalEndAt;
  final String? rentalStatus;

  /// `id` de la reserva en curso. Necesario para `POST /reservations/:id/confirm`
  /// y para `POST /reservations/:id/cancel`.
  final int? reservationId;

  final String? reservationCode;
  final DateTime? reservationStartAt;
  final DateTime? reservationEndAt;
  final String? reservationStatus;

  /// `customerId` de quien ocupa la silla. Solo se rellena para personal con
  /// `rentals:read:any`; para un cliente se deduce de sus propios alquileres.
  final int? occupantCustomerId;

  /// Nombre de quien ocupa la silla, o `null` si no se debe mostrar.
  final String? occupantName;

  /// `true` si el alquiler vivo de esta silla es del actor.
  final bool isMine;

  /// `true` si hay un alquiler cobrando ahora mismo.
  bool get hasLiveRental => rentalCode != null && rentalStartAt != null;

  /// `true` si hay una reserva para una franja posterior o en curso.
  bool get hasFutureReservation => reservationCode != null;

  /// `true` si la reserva en curso sigue sin confirmar, es decir, si la silla
  /// todavía NO está apartada. Ver [ChairBooking.isPending].
  bool get hasPendingReservation =>
      reservationStatus == 'PENDING' && reservationId != null;

  /// Devuelve la misma ocupación con la IDENTIDAD del ocupante rellenada.
  ///
  /// Existe para que el nombre de otra persona solo pueda entrar en el modelo por
  /// aquí, y quien llame tenga que pasar [allowed] explícitamente. Un
  /// `if (puede) modelo.occupantName = ...` en un widget es el sitio donde ese
  /// filtro se olvidaría sin que nada se rompiera.
  ///
  /// Con [allowed] en `false` devuelve el mismo objeto con la identidad vacía: la
  /// mitigación no depende de que quien llama se acuerde de limpiar.
  ChairOccupancy withOccupant(
    ChairRental rental, {
    required bool allowed,
    int? currentUserId,
  }) {
    if (!allowed) {
      return ChairOccupancy(
        chair: chair,
        rentalId: rentalId,
        rentalCode: rentalCode,
        rentalStartAt: rentalStartAt,
        rentalEndAt: rentalEndAt,
        rentalStatus: rentalStatus,
        reservationId: reservationId,
        reservationCode: reservationCode,
        reservationStartAt: reservationStartAt,
        reservationEndAt: reservationEndAt,
        reservationStatus: reservationStatus,
      );
    }
    return ChairOccupancy(
      chair: chair,
      rentalId: rentalId,
      rentalCode: rentalCode,
      rentalStartAt: rentalStartAt,
      rentalEndAt: rentalEndAt,
      rentalStatus: rentalStatus,
      reservationId: reservationId,
      reservationCode: reservationCode,
      reservationStartAt: reservationStartAt,
      reservationEndAt: reservationEndAt,
      reservationStatus: reservationStatus,
      occupantCustomerId: rental.customerId,
      occupantName: rental.customerName,
      isMine: currentUserId != null &&
          rental.customerId != null &&
          rental.customerId == currentUserId,
    );
  }

  /// Nombre a PINTAR de quien ocupa la silla, o `null` si no se debe mostrar.
  ///
  /// Se expone como getter y no como campo para que sea imposible saltarse el
  /// filtro por accidente desde la interfaz: hay que pasar por aquí.
  String? get displayOccupantName => occupantName;

  @override
  String toString() =>
      'ChairOccupancy(${chair.code}, ${chair.status}, alquiler: $rentalCode)';
}

/// Alquiler vivo y sus cifras, tal como lo devuelve `POST /rentals`,
/// `POST /rentals/:id/extend` y `POST /rentals/:id/complete`.
///
/// Se traduce aquí y no se reutiliza `features/orders/.../rental.dart` por la misma
/// razón que [ChairBookingQuote`: las features no se importan entre sí. Los campos
/// son los mismos, no la dependencia.
@immutable
class ChairRental {
  const ChairRental({
    required this.id,
    required this.code,
    required this.status,
    this.chairId,
    this.chairCode,
    this.startAt,
    this.endAt,
    this.plannedMinutes = 0,
    this.billedMinutes = 0,
    this.pricePerHourMinor = 0,
    this.subtotalMinor = 0,
    this.extensionsMinor = 0,
    this.extraMinutesMinor = 0,
    this.totalMinor = 0,
    this.customerId,
    this.customerName,
    this.isMine = false,
  });

  final int id;
  final String code;

  /// `RentalStatus`: `ACTIVE`, `EXTENDED`, `COMPLETED`, `CANCELLED`.
  final String status;

  final int? chairId;
  final String? chairCode;
  final DateTime? startAt;
  final DateTime? endAt;
  final int plannedMinutes;
  final int billedMinutes;

  /// Precio por hora CONGELADO al abrir el alquiler (BR-PRICE-003).
  final int pricePerHourMinor;

  final int subtotalMinor;
  final int extensionsMinor;
  final int extraMinutesMinor;
  final int totalMinor;

  final int? customerId;
  final String? customerName;

  /// `true` si el alquiler es del actor.
  final bool isMine;

  /// `true` si está cobrando ahora mismo.
  bool get isLive => status == 'ACTIVE' || status == 'EXTENDED';

  /// `true` si ya no admite cambios.
  bool get isClosed => status == 'COMPLETED' || status == 'CANCELLED';

  /// Tiempo restante. Negativo = excedente, que se cobra al precio congelado y NO
  /// es un error: hay que mostrarlo en positivo, no como fallo.
  Duration remainingAt([DateTime? now]) {
    final DateTime? end = endAt;
    if (end == null) return Duration.zero;
    return end.difference(now ?? DateTime.now().toUtc());
  }

  @override
  String toString() => 'ChairRental($code, $status, total: $totalMinor)';
}
