// Estado del checkout: pasos, selección y confirmación.
//
// SE SEPARA DEL CONTROLADOR POR TAMAÑO
// La clase `CheckoutState` (con todos sus derivados) ocupa casi la mitad del
// módulo. Separarla deja el controlador con lo que hace y el estado con lo que es,
// y permite que la pantalla y los widgets importen solo el estado sin arrastrar el
// controlador entero.
//
// POR QUÉ UN SOLO ESTADO Y NO VARIOS PROVIDERS
// El flujo es una MÁQUINA DE PASOS con dependencias: cambiar el tipo de pedido
// invalida la silla, cambiar la silla invalida la cotización, y el botón de
// confirmar depende de que todo lo anterior sea válido. Repartirlo en providers
// independientes produce estados imposibles (una cotización de una silla que ya no
// está seleccionada). Un solo estado hace que esas combinaciones no se puedan
// construir.
//
// EL CARRITO NO SE COPIA
// Se lee de `core/customer` (el mismo store que pinta la pantalla del carrito).
// Si la persona añade algo desde otra pestaña, el checkout lo ve sin sincronizar
// nada.

import 'package:flutter/foundation.dart';

import '../../../core/error/failures.dart';
import '../domain/entities/chair_quote.dart';
import '../domain/repositories/checkout_repository.dart';



/// Estado completo del checkout.
@immutable
class CheckoutState {
  const CheckoutState({
    this.step = CheckoutStep.orderType,
    this.type = 'TAKEAWAY',
    this.reserveChair = false,
    this.chairQuestionAnswered = false,
    this.chairId,
    this.durationMinutes = 60,
    this.customMinutes = 60,
    this.isCustomDuration = false,
    this.quote,
    this.quoteFailure,
    this.isQuoting = false,
    this.isPlacing = false,
    this.placedOrder,
    this.placeFailure,
    this.occupancy,
    this.notes = '',
  });

  /// Paso del flujo.
  final CheckoutStep step;

  /// `OrderType` elegido (`TAKEAWAY` | `DINE_IN` | `CHAIR_RENTAL`).
  final String type;

  /// Respuesta a «¿Quieres reservar una silla?». `null` = sin responder.
  final bool? reserveChair;

  /// `true` cuando el cliente ya respondió la pregunta (aunque sea "no").
  final bool chairQuestionAnswered;

  /// Silla elegida, o `null` si se continúa sin ella.
  final int? chairId;

  /// Duración efectiva en minutos (la de la opción fija o la personalizada).
  final int durationMinutes;

  /// Valor escrito en "otro tiempo". Se conserva aunque se vuelva a una opción
  /// fija, para no perder lo tecleado.
  final int customMinutes;

  final bool isCustomDuration;

  /// Última cotización del servidor para la silla y la franja actuales.
  final ChairQuote? quote;

  /// Fallo de la cotización (red, `404` de silla no reservable…).
  final Failure? quoteFailure;

  final bool isQuoting;

  final bool isPlacing;

  /// Pedido ya creado. `null` mientras no se confirma.
  final PlacedOrder? placedOrder;

  /// Fallo al confirmar (el `409` de silla ocupada llega por aquí).
  final Failure? placeFailure;

  /// Ocupación actual de la silla seleccionada.
  final ChairOccupancy? occupancy;

  /// Notas del cliente para el pedido.
  final String notes;

  // -------------------------------------------------------------- Derivados
  /// `true` si el tipo elegido implica la pregunta de la silla.
  bool get mustAskAboutChair => type == 'DINE_IN' || type == 'CHAIR_RENTAL';

  /// `true` si en este estado hay que elegir silla.
  bool get needsChair => mustAskAboutChair && reserveChair == true;

  /// `true` si el tipo es alquiler (obligatorio tener silla).
  bool get isRental => type == 'CHAIR_RENTAL';

  /// Inicio de la reserva. `null` si no hay silla.
  ///
  /// Se ancla al "ahora" redondeado al MINUTO, no al segundo: el backend acepta
  /// hasta 5 min en el pasado (`400 PAST_DATE`) y una ventana que cambia en cada
  /// rebuild del widget daría cotizaciones distintas para la misma elección.
  DateTime? get startAt {
    if (!needsChair || chairId == null) return null;
    final DateTime now = DateTime.now();
    return DateTime(now.year, now.month, now.day, now.hour, now.minute);
  }

  /// Fin de la reserva. `null` si no hay silla.
  DateTime? get endAt {
    final DateTime? start = startAt;
    if (start == null) return null;
    return start.add(Duration(minutes: durationMinutes));
  }

  /// `true` si se puede pasar al resumen.
  ///
  ///   - `TAKEAWAY`: siempre.
  ///   - `DINE_IN`: hay que haber RESPONDIDO la pregunta; si se dijo sí, hace
  ///     falta silla.
  ///   - `CHAIR_RENTAL`: siempre hace falta silla (el backend lo exige con
  ///     `422 RENTAL_REQUIRES_CHAIR_AND_RESERVATION`).
  bool get canReview {
    if (isRental) return chairId != null;
    if (type == 'DINE_IN') {
      if (!chairQuestionAnswered) return false;
      if (reserveChair == true) return chairId != null;
      return true;
    }
    return true;
  }

  /// `true` si la cotización disponible es utilizable.
  ///
  /// Una cotización con `isAvailable: false` (hay conflicto) NO habilita el botón
  /// de confirmar aunque haya datos: el servidor la devolvió como
  /// informative, no como válida.
  bool get hasUsableQuote => quote != null && quote!.isAvailable;

  /// `true` si se puede confirmar (todo listo y nada en curso).
  bool get canConfirm =>
      canReview && !isPlacing && (chairId == null || hasUsableQuote);

  /// Texto del paso actual, para el indicador de progreso.
  String get stepLabel => switch (step) {
        CheckoutStep.orderType => 'Tipo de pedido',
        CheckoutStep.chair => 'Silla',
        CheckoutStep.duration => 'Duración',
        CheckoutStep.review => 'Resumen',
      };

  CheckoutState copyWith({
    CheckoutStep? step,
    String? type,
    bool? reserveChair,
    bool? chairQuestionAnswered,
    int? chairId,
    bool clearChair = false,
    int? durationMinutes,
    int? customMinutes,
    bool? isCustomDuration,
    ChairQuote? quote,
    bool clearQuote = false,
    Failure? quoteFailure,
    bool clearQuoteFailure = false,
    bool? isQuoting,
    bool? isPlacing,
    PlacedOrder? placedOrder,
    Failure? placeFailure,
    bool clearPlaceFailure = false,
    ChairOccupancy? occupancy,
    String? notes,
  }) =>
      CheckoutState(
        step: step ?? this.step,
        type: type ?? this.type,
        reserveChair: reserveChair ?? this.reserveChair,
        chairQuestionAnswered: chairQuestionAnswered ?? this.chairQuestionAnswered,
        chairId: clearChair ? null : (chairId ?? this.chairId),
        durationMinutes: durationMinutes ?? this.durationMinutes,
        customMinutes: customMinutes ?? this.customMinutes,
        isCustomDuration: isCustomDuration ?? this.isCustomDuration,
        quote: clearQuote ? null : (quote ?? this.quote),
        quoteFailure: clearQuoteFailure ? null : (quoteFailure ?? this.quoteFailure),
        isQuoting: isQuoting ?? this.isQuoting,
        isPlacing: isPlacing ?? this.isPlacing,
        placedOrder: placedOrder ?? this.placedOrder,
        placeFailure: clearPlaceFailure ? null : (placeFailure ?? this.placeFailure),
        occupancy: occupancy ?? this.occupancy,
        notes: notes ?? this.notes,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CheckoutState &&
          other.step == step &&
          other.type == type &&
          other.reserveChair == reserveChair &&
          other.chairQuestionAnswered == chairQuestionAnswered &&
          other.chairId == chairId &&
          other.durationMinutes == durationMinutes &&
          other.isCustomDuration == isCustomDuration &&
          other.isQuoting == isQuoting &&
          other.isPlacing == isPlacing &&
          other.notes == notes;

  @override
  int get hashCode => Object.hash(
        step,
        type,
        reserveChair,
        chairQuestionAnswered,
        chairId,
        durationMinutes,
        isCustomDuration,
        isQuoting,
        isPlacing,
        notes,
      );
}

/// Pasos del checkout, en el orden que pidió el cliente.
enum CheckoutStep {
  /// 1. Tipo de pedido (para llevar / consumir aquí / reservar silla).
  orderType,

  /// 2. Pregunta de la silla y selección en el mapa.
  chair,

  /// 3. Duración del alquiler o de la reserva.
  duration,

  /// 4. Resumen y confirmación.
  review,
}

/// Tope de caracteres de las notas del cliente (`customerNotes`, API.md §7.12).
const int kCheckoutNotesMaxLength = 500;

