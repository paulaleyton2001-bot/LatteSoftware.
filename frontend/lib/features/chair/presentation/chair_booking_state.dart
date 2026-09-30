// Estado del flujo de RESERVA de una silla. Módulo `features/chair/presentation`.
//
// QUÉ RESUELVE
// Al tocar una silla libre se ofrece reservarla para una franja concreta. Eso son
// cuatro decisiones —día, hora de inicio, duración y confirmación— y un precio que
// SOLO puede dar el servidor. Este archivo es el estado de esas decisiones; el
// control está en `chair_booking_controller.dart`.
//
// POR QUÉ UN ESTADO INMUTABLE Y NO UN `StatefulWidget` CON SETSTATE
// Porque la cotización depende de la franja, y la franja la tocan tres controles
// distintos (día, hora, duración). Con `setState` el precio se pediría tres veces
// por cada cambio de minuto y habría que coordinar a mano "no cotizar mientras se
// arrastra el selector". Con un estado explícito, la cotización es una FUNCIÓN de la
// franja y el control la pide una vez, con retardo.
//
// EL DINERO NUNCA SE CALCULA AQUÍ
// `totalMinor` es el que devuelve `GET /reservations/quote` (BR-PRICE-008). El
// precio por hora de la silla sirve para pintar una expectativa, y la estimación que
// se muestra mientras se espera se rotula como tal. Al confirmar, el importe que se
// enseña es el del servidor, sin transformarlo.

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/failures.dart';
import '../domain/entities/chair_booking.dart';

/// Cómo se está eligiendo la franja.
enum ChairBookingStage {
  /// Eligiendo día, hora y duración.
  editing,

  /// Enviando `POST /reservations` (o un `confirm` / `cancel` posterior).
  submitting,

  /// Reserva creada. Estado terminal feliz: se muestra el código.
  done,
}

/// Fotografía de las decisiones del usuario.
@immutable
class ChairBookingState {
  /// El constructor NO es `const` a propósito.
  ///
  /// [quote] arranca con una cotización "en curso" construida a partir de [startAt],
  /// y `DateTime` no tiene constructor `const` (`DateTime.utc` es de fábrica). Con un
  /// valor por defecto constante habría que inventar un instante fijo, que es
  /// justamente el tipo de mentira que este estado pretende evitar: el panel
  /// mostraría una franja que no es la que ha elegido nadie.
  ChairBookingState({
    required this.startAt,
    this.durationMinutes = 60,
    this.customMinutes,
    AsyncValue<ChairBookingQuote>? quote,
    this.stage = ChairBookingStage.editing,
    this.booking,
    this.failure,
  }) : quote = quote ??
            AsyncValue<ChairBookingQuote>.data(
              ChairBookingQuote.pending(
                slot: ChairBookingSlot(startAt: startAt, endAt: startAt),
              ),
            );

  /// Inicio de la franja, en UTC (así es como lo almacena el backend, API.md §1).
  final DateTime startAt;

  /// Minutos elegidos. Con [customMinutes] a `null` sale de
  /// [kChairDurationPresets]; si no, es el valor escrito a mano.
  final int durationMinutes;

  /// Duración escrita a mano, o `null` si se eligió una de las fijas.
  final int? customMinutes;

  /// Cotización en curso. `loading` mientras el servidor responde, `error` si no
  /// pudo, `data` con `isAvailable = false` si la silla no está libre en esa franja.
  final AsyncValue<ChairBookingQuote> quote;

  final ChairBookingStage stage;

  /// La reserva creada, o `null` mientras no se ha enviado nada con éxito.
  ///
  /// Antes era un `bool created`, que era insuficiente: el panel de éxito NECESITA
  /// el código (`RES-900010`) para poder enseñárselo a quien acaba de reservar, y
  /// con un booleano ese dato se perdía en el camino. Es el mismo motivo por el que
  /// `_lastFailure` vivía en el controlador y no se pintaba nunca.
  final ChairBooking? booking;

  /// Fallo del ÚLTIMO envío, o `null` si el último intento tuvo éxito.
  ///
  /// Vive en el estado y no en el controlador a propósito: un `Failure` en un
  /// `Notifier` no dispara ninguna reconstrucción, así que el `FormErrorBanner`
  /// que lo pintaría nunca se enteraría de que ha cambiado. Con el estado
  /// inmutable, el panel se reconstruye y lo ve.
  final Failure? failure;

  /// `true` si la reserva ya se creó y ya no tiene sentido seguir editando.
  bool get created => booking != null;

  /// `true` si la duración viene del campo personalizado.
  bool get isCustomDuration => customMinutes != null;

  /// Minutos efectivos: el personalizado si está, si no el de la opción fija.
  int get effectiveMinutes => customMinutes ?? durationMinutes;

  /// Fin de la franja.
  DateTime get endAt => startAt.add(Duration(minutes: effectiveMinutes));

  /// La franja que se manda al servidor.
  ChairBookingSlot get slot => ChairBookingSlot(startAt: startAt, endAt: endAt);

  /// `true` si se puede pedir la cotización y confirmar.
  ///
  /// Los cuatro guardas, en el orden en que se evalúan:
  ///   1. no estar ya creada;
  ///   2. la duración es válida (el backend rechaza `<= 0` y `> maxReservationMinutes`);
  ///   3. la franja no está en el pasado (tolerancia de 5 min, como el servidor);
  ///   4. no estar mientras se envía.
  bool get canSubmit {
    if (created) return false;
    if (effectiveMinutes <= 0) return false;
    if (slot.isInPast()) return false;
    if (stage != ChairBookingStage.editing) return false;
    return true;
  }

  /// Motivo por el que no se puede confirmar, o `null` si sí se puede.
  ///
  /// Se escribe junto a [canSubmit] para que los dos no puedan divergir: si
  /// [canSubmit] dice `false` sin motivo, el botón queda muerto y nadie sabe por qué.
  String? get blockedReason {
    if (created) return 'Esta reserva ya está creada.';
    if (effectiveMinutes <= 0) return 'Elige cuánto tiempo vas a usar la silla.';
    if (slot.isInPast()) {
      return 'Esa hora ya pasó. Elige un momento a partir de ahora.';
    }
    return null;
  }

  /// `true` si la cotización llegó y la silla NO está libre para esa franja.
  bool get quoteSaysUnavailable =>
      quote.valueOrNull?.isAvailable == false;

  /// `true` si la reserva creada se puede confirmar ahora mismo.
  ///
  /// `pending` es un parámetro y no un getter porque el permiso vive en la sesión y
  /// este estado no la conoce: el widget lee [ChairCapabilities] y lo pasa. Devolver
  /// un booleano sin argumento era la razón de que el botón quedara muerto sin
  /// explicación cuando faltaba el permiso.
  bool canConfirmReservation({
    required bool pending,
    required bool hasPermission,
  }) =>
      booking != null && pending && hasPermission;

  /// Copia con cambios. `AsyncValue` no se reconstruye: se pasa entero, porque
  /// mezclar dos `AsyncLoading` distintos perdería el error anterior.
  ChairBookingState copyWith({
    DateTime? startAt,
    int? durationMinutes,
    int? customMinutes,
    bool clearCustom = false,
    AsyncValue<ChairBookingQuote>? quote,
    ChairBookingStage? stage,
    ChairBooking? booking,
    bool clearBooking = false,
    Failure? failure,
    bool clearFailure = false,
  }) {
    return ChairBookingState(
      startAt: startAt ?? this.startAt,
      durationMinutes: durationMinutes ?? this.durationMinutes,
      customMinutes: clearCustom ? null : (customMinutes ?? this.customMinutes),
      quote: quote ?? this.quote,
      stage: stage ?? this.stage,
      booking: clearBooking ? null : (booking ?? this.booking),
      failure: clearFailure ? null : (failure ?? this.failure),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ChairBookingState &&
          other.startAt == startAt &&
          other.durationMinutes == durationMinutes &&
          other.customMinutes == customMinutes &&
          other.stage == stage &&
          other.booking?.code == booking?.code &&
          other.booking?.status == booking?.status &&
          other.failure?.code == failure?.code &&
          other.failure?.message == failure?.message &&
          other.quote == quote;

  @override
  int get hashCode => Object.hash(
        startAt,
        durationMinutes,
        customMinutes,
        stage,
        booking?.code,
        booking?.status,
        failure?.code,
        failure?.message,
        quote,
      );

  @override
  String toString() => 'ChairBookingState($startAt, $effectiveMinutes min, '
      '$stage)';
}

/// Franja por defecto al abrir el panel: la próxima media hora en punto.
///
/// Se redondea HACIA ARRIBA a los 30 min siguientes porque el backend tolera 5 min
/// de retraso (`PAST_DATE`) y una franja que empieza "ahora mismo" se quedaría
/// inválida mientras la persona lee el panel. Media hora es la unidad que ya usa el
/// resto de la app (mínimo de cobro) y la que menos sorprende a nadie.
DateTime defaultBookingStart([DateTime? now]) {
  final DateTime reference = (now ?? DateTime.now().toUtc()).toUtc();
  final int minutes = reference.minute;
  final int remainder = minutes % 30;
  final int toAdd = remainder == 0 ? 30 - 1 : 30 - remainder;
  final DateTime next = reference.add(Duration(minutes: toAdd));
  return DateTime.utc(
    next.year,
    next.month,
    next.day,
    next.hour,
    next.minute,
  );
}

/// Días ofrecidos en el selector: hoy y los cuatro siguientes.
///
/// Cinco es el máximo que cabe en una fila sin scroll en un móvil de 360 dp con
/// etiquetas del tipo «mié 01», y cubre de sobra «hoy, mañana o pasado mañana». Para
/// más lejos hay un botón de calendario.
List<DateTime> bookingDayChoices([DateTime? now]) {
  final DateTime reference = now ?? DateTime.now();
  final DateTime today = DateTime(reference.year, reference.month, reference.day);
  return <DateTime>[
    for (int offset = 0; offset < 5; offset++)
      DateTime(today.year, today.month, today.day + offset),
  ];
}

/// Franjas horarias ofrecidas para [day], en media hora, de 08:00 a 22:00.
///
/// El rango NO sale del horario del negocio: leerlo exigiría `GET /business/hours` y
/// sumarle el parsing de las franjas, y el servidor ya valida (`INVALID_ADVANCE_TIME`
//  si se reserva fuera de horario). Acotarlo a un rango razonable solo evita que se
//  ofrezcan las 4 de la mañana, que es donde el error es evidente; el resto lo
///  decide el servidor, que es quien manda.
///
/// Para el día de HOY, las horas ya pasadas se omiten: ofrecer las 09:00 a las 14:00
/// a las 15:00 es ofrecer algo que va a fallar.
List<DateTime> bookingTimeChoices(DateTime day, [DateTime? now]) {
  final DateTime reference = now ?? DateTime.now();
  final bool isToday = day.year == reference.year &&
      day.month == reference.month &&
      day.day == reference.day;
  final DateTime earliest =
      isToday ? reference.add(const Duration(minutes: 10)) : DateTime(1970);

  final List<DateTime> choices = <DateTime>[];
  for (int hour = 8; hour <= 22; hour++) {
    for (int minute in const <int>[0, 30]) {
      if (minute == 0 && hour == 22) continue; // 22:30 se sale del rango legible
      final DateTime candidate = DateTime(day.year, day.month, day.day, hour, minute);
      if (candidate.isBefore(earliest)) continue;
      choices.add(candidate);
    }
  }
  return choices;
}

/// Traduce un [Failure] de esta pantalla a otro con el mensaje en español que se
/// pueda hacer algo con él.
///
/// NO devuelve un `String`: devuelve un `Failure` del MISMO subtipo que el original,
/// para que [FormErrorBanner] siga eligiendo el icono y el título que le
/// corresponden (un `409` es un conflicto, no un error desconocido) y para que
/// `isRetryable` no cambie: un fallo de red tiene que poder reintentarse y uno de
/// validación no.
///
/// Códigos cubiertos, todos verificados con `curl` el 2026-09-29:
///   `CHAIR_ALREADY_RESERVED` → 409 al crear o confirmar sobre una franja ocupada
///   `PAST_DATE`             → 400 `startAt` más de 5 min en el pasado
///   `INVALID_ADVANCE_TIME`   → 422 fuera del horario del negocio
///   `RESERVATION_TOO_LONG`   → 422 duración por encima del máximo
///   `CHAIR_NOT_BOOKABLE`     → 422 silla marcada como no reservable
///   `INVALID_DATE_RANGE`     → 400 `endAt` no posterior a `startAt`
///   `INVALID_RESERVATION_TRANSITION` → 422 cancelar algo ya cerrado
Failure explainBookingFailure(Failure failure) {
  final String message = switch (failure.code) {
    'CHAIR_ALREADY_RESERVED' =>
      'Otra persona se ha adelantado y ya reservó esa franja. Elige otra hora u '
          'otra silla.',
    'PAST_DATE' =>
      'Esa hora ya pasó. Elige un momento a partir de ahora.',
    'INVALID_ADVANCE_TIME' =>
      'El local no permite reservar a esa hora. Prueba con otra franja.',
    'RESERVATION_TOO_LONG' =>
      'Esa duración es demasiado larga para una sola reserva.',
    'CHAIR_NOT_BOOKABLE' => 'Esta silla no admite reservas.',
    'INVALID_DATE_RANGE' =>
      'La franja no es válida: el final tiene que ser posterior al inicio.',
    'INVALID_RESERVATION_TRANSITION' =>
      'Esta reserva ya no admite cambios. Cancélala y hazla de nuevo.',
    _ => failure.message,
  };
  if (message == failure.message) return failure;

  return switch (failure) {
    ConflictFailure() => ConflictFailure(
        message: message,
        code: failure.code,
        requestId: failure.requestId,
      ),
    BusinessRuleFailure() => BusinessRuleFailure(
        message: message,
        code: failure.code,
        requestId: failure.requestId,
      ),
    ValidationFailure() => ValidationFailure(
        message: message,
        code: failure.code,
        fieldErrors: failure.fieldErrors,
        requestId: failure.requestId,
      ),
    ForbiddenFailure() => ForbiddenFailure(
        message: message,
        code: failure.code,
        requestId: failure.requestId,
      ),
    NetworkFailure() => NetworkFailure(
        message: message,
        code: failure.code,
        requestId: failure.requestId,
      ),
    OfflineFailure() => OfflineFailure(message: message, code: failure.code),
    _ => UnknownFailure(
        message: message,
        code: failure.code,
        requestId: failure.requestId,
      ),
  };
}
