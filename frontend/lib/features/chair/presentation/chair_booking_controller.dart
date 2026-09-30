// Control del flujo de reserva. Módulo `features/chair/presentation`.
//
// LAS CUATRO COSAS QUE HACE Y QUE HAY QUE MIRAR EN EL CÓDIGO
// -----------------------------------------------------------
// 1. COTIZA CON RETARDO (`_debounce`).
//    `GET /reservations/quote` se llama en cada cambio de franja. Si se pidiera en
//    cada cambio, tocar tres duraciones seguidas haría tres peticiones y la
//    respuesta de la primera podría llegar después de la tercera y pintar el
//    precio de una franja que ya no es la elegida. Aquí se espera a que la persona
//    pare 350 ms, y además se COMPRUEBA que la respuesta corresponde a la franja
//    pedida antes de publicarla.
//
// 2. EL TEMPORIZADOR SE CANCELA AL DESTRUIRSE.
//    Un `Timer` vivo en un notifier que se cierra es una fuga: sigue disparando. Y si
//    su callback tocara `state` de un notifier ya liberado, Riverpod 2.x lanza
//    `StateError: Cannot use ref after dispose` y la pantalla se cae al cerrarla.
//    `ref.onDispose(_onDispose)` cancela el temporizador y levanta [_disposed].
//
//    POR QUÉ UN BOOLEANO Y NO `ref.mounted`
//    `Ref.mounted` no existe en Riverpod 2.5 (llegó en la 3.x). El patrón correcto
//    en esta versión es el que ya usa `AuthController` de `features/auth`: una
//    bandera puesta en `ref.onDispose`, que además se puede alterar desde un test.
//
// 3. NADA TOCA EL ESTADO TRAS DESTRUIRSE.
//    Cada vuelta de red comprueba [_disposed] antes de escribir. Una respuesta que
//    llega tarde (por ejemplo al cerrar el panel justo después de cotizar) se
//    descarta en silencio.
//
// 4. TRAS CREAR, SE AVISA A LA PANTALLA.
//    La reserva cambia el estado de la silla en el mapa y aparece en «Mis
//    reservas». Quien la acaba de hacer tiene que verlo sin tirar de la pantalla
//    hacia atrás, así que el controlador invalida el mapa y los alquileres él mismo.
//
// POR QUÉ UN CONTROL POR APERTURA DE PANEL
// `autoDispose` hace que al cerrar el panel desaparezca el estado. Un controlador
// único para la app dejaría la última franja cotizada pegada al panel siguiente, que
// es lo que haría parecer que el precio no cambia al cambiar de silla.

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../domain/entities/chair_booking.dart';
import 'chair_booking_state.dart';
import 'chair_controller.dart';

/// Retardo antes de pedir la cotización tras un cambio de franja.
const Duration kQuoteDebounce = Duration(milliseconds: 350);

/// Tolerancia para considerar que dos franjas son la misma.
///
/// Un segundo de grano. Es más fino que el paso más pequeño de los selectores (media
/// hora) y más grueso que el jitter del reloj, así que no hace falta ni repetir
/// peticiones ni perder una si el reloj se mueve un instante.
const Duration kQuoteSlotTolerance = Duration(seconds: 1);

/// Estado del flujo de reserva. Se destruye al cerrar el panel.
final AutoDisposeAsyncNotifierProviderFamily<ChairBookingController,
    ChairBookingState, int> chairBookingProvider =
    AutoDisposeAsyncNotifierProvider.family<ChairBookingController,
        ChairBookingState, int>(ChairBookingController.new);

/// Controlador de la reserva de UNA silla.
class ChairBookingController
    extends AutoDisposeFamilyAsyncNotifier<ChairBookingState, int> {
  Timer? _debounce;

  /// Franja para la que se está cotizando, o `null` si todavía no se ha pedido.
  ///
  /// Se compara en la respuesta para descartar la de una franja que ya no está
  /// seleccionada. Sin esto, cambiar rápido de duración deja el precio de la
  /// anterior pegado al panel, que es un error que cuesta dinero.
  ChairBookingSlot? _pendingSlot;

  /// `true` en cuanto el notifier se libera. Riverpod 2.5 no tiene `ref.mounted`.
  bool _disposed = false;

  @override
  Future<ChairBookingState> build(int chairId) async {
    ref.onDispose(_onDispose);
    // La cotización inicial se pide al abrir: el panel tiene que mostrar un precio
    // desde el primer frame, no un hueco que se rellene un segundo después.
    final ChairBookingState initial = ChairBookingState(
      startAt: defaultBookingStart(),
      durationMinutes: 60,
    );
    final ChairBookingState quoted = await _quoteNow(initial);
    return _disposed ? initial : quoted;
  }

  /// Limpieza. Único sitio donde se toca [_disposed] y el temporizador.
  void _onDispose() {
    _disposed = true;
    _debounce?.cancel();
    _debounce = null;
  }

  // ------------------------------------------------------------- Selectores

  /// Cambia el DÍA conservando la hora de inicio elegida.
  ///
  /// Si la hora no existe en el nuevo día (porque ya pasó) se usa la primera
  /// disponible de ese día, en vez de dejar una franja inválida.
  Future<void> selectDay(DateTime day) async {
    final ChairBookingState? current = state.valueOrNull;
    if (current == null || _disposed) return;
    final DateTime keepTime = DateTime(
      day.year,
      day.month,
      day.day,
      current.startAt.hour,
      current.startAt.minute,
    );
    final List<DateTime> choices = bookingTimeChoices(day);
    final DateTime resolved = choices.contains(keepTime)
        ? keepTime
        : (choices.isNotEmpty
            ? choices.first
            : DateTime(day.year, day.month, day.day, 12));

    state = AsyncData<ChairBookingState>(current.copyWith(startAt: resolved.toUtc()));
    _scheduleQuote();
  }

  /// Cambia la HORA de inicio en el día ya elegido.
  Future<void> selectTime(DateTime localTime) async {
    final ChairBookingState? current = state.valueOrNull;
    if (current == null || _disposed) return;
    // El selector trabaja en la hora local del negocio (que es la que ve la
    // persona); al backend se manda UTC (API.md §1).
    final DateTime next = DateTime(
      localTime.year,
      localTime.month,
      localTime.day,
      localTime.hour,
      localTime.minute,
    ).toUtc();
    if (next == current.startAt) return;
    state = AsyncData<ChairBookingState>(current.copyWith(startAt: next));
    _scheduleQuote();
  }

  /// Elige una de las duraciones fijas ([kChairDurationPresets]).
  Future<void> selectDuration(int minutes) async {
    final ChairBookingState? current = state.valueOrNull;
    if (current == null || _disposed || minutes <= 0) return;
    state = AsyncData<ChairBookingState>(
      current.copyWith(durationMinutes: minutes, clearCustom: true),
    );
    _scheduleQuote();
  }

  /// Elige una duración escrita a mano.
  ///
  /// `null` o `0` vuelve a las duraciones fijas, para que el campo no pueda dejar la
  /// reserva en un estado imposible de confirmar.
  Future<void> selectCustomDuration(int? minutes) async {
    final ChairBookingState? current = state.valueOrNull;
    if (current == null || _disposed) return;
    if (minutes == null || minutes <= 0) {
      state = AsyncData<ChairBookingState>(current.copyWith(clearCustom: true));
    } else {
      state = AsyncData<ChairBookingState>(
        current.copyWith(customMinutes: minutes, durationMinutes: minutes),
      );
    }
    _scheduleQuote();
  }

  // ------------------------------------------------------------- Cotización

  /// Cotiza con retardo. Es el camino que usan TODOS los selectores.
  void _scheduleQuote() {
    _debounce?.cancel();
    if (state.valueOrNull == null || _disposed) return;
    _debounce = Timer(kQuoteDebounce, () {
      _debounce = null;
      unawaited(refreshQuote());
    });
  }

  /// Pide la cotización de la franja actual, sin retardo.
  Future<void> refreshQuote() async {
    final ChairBookingState? current = state.valueOrNull;
    if (current == null || _disposed) return;
    final ChairBookingState next = await _quoteNow(current);
    if (_disposed) return;
    state = AsyncData<ChairBookingState>(next);
  }

  /// Traduce el resultado de la cotización y lo publica SOLO si sigue siendo la
  /// franja elegida.
  Future<ChairBookingState> _quoteNow(ChairBookingState snapshot) async {
    final ChairBookingSlot slot = snapshot.slot;
    _pendingSlot = slot;
    final Result<ChairBookingQuote> result = await ref
        .read(rentalRepositoryProvider)
        .quote(chairId: arg, slot: slot);
    if (_disposed) return snapshot;

    // Respuesta obsoleta: mientras esperaba llegó otro cambio y la franja pedida ya
    // no es la seleccionada. Se descarta en lugar de pintar un precio ajeno.
    final ChairBookingSlot? pending = _pendingSlot;
    if (pending == null ||
        slot.startAt.difference(pending.startAt).abs() > kQuoteSlotTolerance ||
        slot.endAt.difference(pending.endAt).abs() > kQuoteSlotTolerance) {
      return snapshot;
    }

    return snapshot.copyWith(
      quote: switch (result) {
        Success<ChairBookingQuote>(:final ChairBookingQuote value) =>
          AsyncValue<ChairBookingQuote>.data(value),
        FailureResult<ChairBookingQuote>(:final Failure failure) =>
          AsyncValue<ChairBookingQuote>.error(failure, StackTrace.current),
      },
    );
  }

  // ------------------------------------------------------------------ Envío

  /// `POST /reservations`. Devuelve `true` si se creó.
  ///
  /// Publica el fallo en el ESTADO, no en una variable del notifier, para que el
  /// `FormErrorBanner` se reconstruya y lo pinte. Antes el fallo se guardaba en
  /// `_lastFailure`, que ningún widget leía: un `409 CHAIR_ALREADY_RESERVED` al
  /// reservar no pintaba absolutely nada y el botón parecía muerto.
  Future<bool> submit() async {
    final ChairBookingState? current = state.valueOrNull;
    if (current == null || _disposed || !current.canSubmit) return false;

    state = AsyncData<ChairBookingState>(
      current.copyWith(stage: ChairBookingStage.submitting, clearFailure: true),
    );

    final Result<ChairBooking> result = await ref
        .read(rentalRepositoryProvider)
        .createReservation(chairId: arg, slot: current.slot);
    if (_disposed) return false;

    switch (result) {
      case FailureResult<ChairBooking>(:final Failure failure):
        state = AsyncData<ChairBookingState>(
          current.copyWith(
            stage: ChairBookingStage.editing,
            failure: failure,
          ),
        );
        // El `409 CHAIR_ALREADY_RESERVED` se explica con el mapa al día: la franja
        // la acaba de ganar alguien y lo más útil es enseñarle el estado nuevo.
        if (failure.code == 'CHAIR_ALREADY_RESERVED') _refreshEverything();
        return false;
      case Success<ChairBooking>(:final ChairBooking value):
        // Éxito: estado terminal y refresco de mapa y alquileres, para que la silla
        // aparezca ya con el estado que le corresponda y la reserva, en «Mis
        // reservas», sin que nadie recargue a mano.
        state = AsyncData<ChairBookingState>(
          current.copyWith(
            stage: ChairBookingStage.done,
            booking: value,
            clearFailure: true,
          ),
        );
        _refreshEverything();
        return true;
    }
  }

  /// `POST /reservations/:id/confirm` — `PENDING -> CONFIRMED`.
  ///
  /// POR QUÉ LA PIDE EL PANEL Y NO EL SERVIDOR AUTOMÁTICAMENTE
  /// Crear la reserva la deja en `PENDING`, y una `PENDING` no aparta la silla
  /// (verificado: `GET /chairs/:id` → `status: "AVAILABLE"` tras el `POST`). Sin este
  /// paso, quien reservara desde el móvil se iría pensando que tiene la silla y otro
  /// podría reservarla o sentarse. El permiso es `reservations:update`, que el
  /// `CUSTOMER` tiene (`POST /reservations/6/confirm` → `200` con su token).
  Future<bool> confirm() async {
    final ChairBookingState? current = state.valueOrNull;
    final ChairBooking? booking = current?.booking;
    if (current == null || booking == null || _disposed) return false;
    if (!current.canConfirmReservation(
      pending: booking.isPending,
      hasPermission: ref.read(chairCapabilitiesProvider).canConfirmReservation,
    )) {
      return false;
    }

    state = AsyncData<ChairBookingState>(
      current.copyWith(stage: ChairBookingStage.submitting, clearFailure: true),
    );
    final Result<ChairBooking> result = await ref
        .read(rentalRepositoryProvider)
        .confirmReservation(booking.id);
    if (_disposed) return false;

    switch (result) {
      case FailureResult<ChairBooking>(:final Failure failure):
        state = AsyncData<ChairBookingState>(
          current.copyWith(
            stage: ChairBookingStage.done,
            failure: failure,
          ),
        );
        if (failure.code == 'CHAIR_ALREADY_RESERVED') _refreshEverything();
        return false;
      case Success<ChairBooking>(:final ChairBooking value):
        state = AsyncData<ChairBookingState>(
          current.copyWith(
            stage: ChairBookingStage.done,
            booking: value,
            clearFailure: true,
          ),
        );
        // La silla pasa a `RESERVED`: el plano tiene que reflejarlo YA.
        _refreshEverything();
        return true;
    }
  }

  /// `POST /reservations/:id/cancel` — libera la silla.
  Future<bool> cancel({required String reason}) async {
    final ChairBookingState? current = state.valueOrNull;
    final ChairBooking? booking = current?.booking;
    if (current == null || booking == null || _disposed) return false;
    if (!booking.isOpen) return false;

    state = AsyncData<ChairBookingState>(
      current.copyWith(stage: ChairBookingStage.submitting, clearFailure: true),
    );
    final Result<ChairBooking> result = await ref
        .read(rentalRepositoryProvider)
        .cancelReservation(booking.id, reason: reason);
    if (_disposed) return false;

    switch (result) {
      case FailureResult<ChairBooking>(:final Failure failure):
        state = AsyncData<ChairBookingState>(
          current.copyWith(
            stage: ChairBookingStage.done,
            failure: failure,
          ),
        );
        return false;
      case Success<ChairBooking>(:final ChairBooking value):
        state = AsyncData<ChairBookingState>(
          current.copyWith(
            stage: ChairBookingStage.done,
            booking: value,
            clearFailure: true,
          ),
        );
        _refreshEverything();
        return true;
    }
  }

  /// Vuelve a la edición para pedir OTRA reserva desde el mismo panel.
  Future<void> startAnother() async {
    if (_disposed) return;
    final ChairBookingState fresh = ChairBookingState(
      startAt: defaultBookingStart(),
      durationMinutes: 60,
    );
    state = AsyncData<ChairBookingState>(fresh);
    final ChairBookingState quoted = await _quoteNow(fresh);
    if (_disposed) return;
    state = AsyncData<ChairBookingState>(quoted);
  }

  void _refreshEverything() {
    ref.invalidate(chairTabMapProvider);
    ref.invalidate(myRentalsProvider);
    // El panel abierto es un `chairOccupancyProvider(chairId)`: sin invalidarlo,
    // seguiría enseñando la silla como libre después de reservarla o confirmarla.
    ref.invalidate(chairOccupancyProvider(arg));
  }
}
