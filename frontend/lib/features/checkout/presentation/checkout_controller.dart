// Controlador del flujo de checkout. Módulo `features/checkout/presentation`.
//
// El ESTADO (clase `CheckoutState`) vive en `checkout_state.dart`; aquí solo están
// las TRANSICIONES y las llamadas al repositorio.
//
// CADA TRANSICIÓN INVALIDA LO QUE DEPENDE DE ELLA
// Cambiar el tipo de pedido reinicia silla, cotización y respuesta; cambiar la
// silla invalida la cotización; cambiar la duración vuelve a cotizar. Hacerlo
// explícito en cada método (y no centralizar la lógica en un `copyWith` gigante)
// es lo que evita el estado imposible más común: una cotización de una silla que
// ya no está seleccionada.
//
// EL 409 DE SILLA OCUPADA NO DEJA EL CHECKOUT A MEDIAS
// Se guarda el fallo, se vuelve al paso de la silla y se recarga el mapa, para que
// el siguiente gesto sea "elegir otra" y no "reintentar a ciegas".



import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/customer/cart_providers.dart';
import '../../../core/customer/cart_state.dart';
import '../../../core/customer/chair_map.dart';
import '../../../core/customer/venue_providers.dart';
import '../../../core/di/providers.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../data/datasources/remote/checkout_remote_datasource.dart';
import '../data/repositories/checkout_repository_impl.dart';
import '../domain/entities/chair_quote.dart';
import '../domain/entities/checkout_options.dart';
import '../domain/repositories/checkout_repository.dart';
import './checkout_state.dart';

/// Repositorio del checkout. Punto de inyección de la feature.
final Provider<CheckoutRepository> checkoutRepositoryProvider =
    Provider<CheckoutRepository>(
  (Ref ref) => CheckoutRepositoryImpl(
    CheckoutRemoteDataSource(ref.watch(apiClientProvider)),
  ),
  name: 'checkoutRepository',
);

/// Mapa de sillas del local, para el selector.
///
/// Delega en `core/customer/venue_providers.dart`: el checkout y la pestaña
/// «Silla» leen EXACTAMENTE el mismo mapa, así que el precio y el estado que se ven
/// al elegir son los mismos que se ven después. Dos mapas serían dos verdades y la
/// primera señal de que la app está rota sería "se veía libre y al reservar no".
final FutureProvider<ChairMap> checkoutChairMapProvider = venueMapProvider;

/// Estado del checkout.
final NotifierProvider<CheckoutController, CheckoutState> checkoutProvider =
    NotifierProvider<CheckoutController, CheckoutState>(CheckoutController.new);

/// Controlador del flujo de checkout.
class CheckoutController extends Notifier<CheckoutState> {
  @override
  CheckoutState build() => const CheckoutState();

  // ------------------------------------------------------- 1. Tipo de pedido

  /// Elige el tipo de pedido y reinicia lo que dependía del anterior.
  ///
  /// La pregunta de la silla se VUELVE a preguntar: pasar de "consumir aquí" a
  /// "reservar silla" no puede arrastrar una respuesta que se dio en otro
  /// contexto.
  void selectType(String type) {
    state = CheckoutState(type: type, notes: state.notes);
  }

  // ----------------------------------------- 2. La pregunta de la silla

  /// Responde «¿Quieres reservar una silla?».
  ///
  /// Un "no" NO bloquea el checkout: el cliente pidió que se pudiera continuar sin
  /// silla. En `DINE_IN` eso es un pedido válido sin `chairId` (API.md §7.12 lo
  /// marca como opcional). En `CHAIR_RENTAL` no tiene sentido, así que la UI no
  /// ofrece el botón y aquí se fuerza a `true`.
  void answerChairQuestion({required bool reserve}) {
    final bool effective = state.type == 'CHAIR_RENTAL' ? true : reserve;
    state = state.copyWith(
      reserveChair: effective,
      chairQuestionAnswered: true,
      step: effective ? CheckoutStep.chair : CheckoutStep.review,
      clearChair: true,
      clearQuote: true,
      clearQuoteFailure: true,
    );
  }

  /// Selecciona una silla del mapa y cotiza.
  Future<void> selectChair(int chairId) async {
    state = state.copyWith(
      chairId: chairId,
      clearPlaceFailure: true,
      step: CheckoutStep.duration,
    );
    await refreshQuote();
  }

  /// Libera la silla (vuelve al paso de la pregunta).
  void clearChair() {
    state = state.copyWith(
      clearChair: true,
      clearQuote: true,
      clearQuoteFailure: true,
      step: CheckoutStep.chair,
    );
  }

  // -------------------------------------------------------- 3. Duración

  /// Fija la duración a una de las opciones (o activa la personalizada).
  void selectDuration(DurationOption option) {
    if (option.custom) {
      state = state.copyWith(
        isCustomDuration: true,
        durationMinutes: state.customMinutes,
        clearQuote: true,
      );
      unawaited(refreshQuote());
      return;
    }
    state = state.copyWith(
      isCustomDuration: false,
      durationMinutes: option.minutes ?? state.durationMinutes,
      clearQuote: true,
    );
    unawaited(refreshQuote());
  }

  /// Fija la duración personalizada (minutos). Se recorta a los topes para no dejar
  /// escribir algo que el servidor va a rechazar con `422 RESERVATION_TOO_LONG`.
  void setCustomMinutes(int minutes) {
    final int safe = minutes < kMinRentalMinutes
        ? kMinRentalMinutes
        : (minutes > kMaxRentalMinutes ? kMaxRentalMinutes : minutes);
    state = state.copyWith(
      isCustomDuration: true,
      customMinutes: safe,
      durationMinutes: safe,
      clearQuote: true,
    );
    unawaited(refreshQuote());
  }

  // ------------------------------------------------------------ 4. Resumen

  /// Avanza al resumen. No hace nada si el paso anterior no está completo.
  void goToReview() {
    if (!state.canReview) return;
    state = state.copyWith(step: CheckoutStep.review);
  }

  /// Notas del cliente, recortadas al máximo que acepta la API.
  void setNotes(String notes) => state = state.copyWith(
        notes: notes.length <= kCheckoutNotesMaxLength
            ? notes
            : notes.substring(0, kCheckoutNotesMaxLength),
      );

  /// Vuelve al paso indicado (el indicador de progreso es pulsable).
  void goToStep(CheckoutStep step) {
    if (step == CheckoutStep.chair && !state.needsChair) return;
    if (step == CheckoutStep.duration && !state.needsChair) return;
    state = state.copyWith(step: step);
  }

  // ------------------------------------------------------------ Cotización

  /// Vuelve a pedir el precio al servidor para la silla y la franja actuales.
  ///
  /// `GET /reservations/quote` es una CONSULTA: no crea nada y responde `200`
  /// incluso si hay conflicto (con `isAvailable: false` y la reserva que estorba).
  /// Por eso un conflicto NO es un error: se muestra la silla como no disponible y
  /// se ofrece otra.
  Future<void> refreshQuote() async {
    final int? chairId = state.chairId;
    final DateTime? start = state.startAt;
    final DateTime? end = state.endAt;
    if (chairId == null || start == null || end == null) return;

    state = state.copyWith(isQuoting: true, clearQuoteFailure: true);
    final Result<ChairQuote> result = await ref.read(checkoutRepositoryProvider).quote(
          chairId: chairId,
          startAt: start,
          endAt: end,
          // El cupón se propaga a la cotización para que el cliente vea el
          // descuento aplicado al alquiler ANTES de confirmar, no después.
          couponCode: ref.read(cartStoreProvider).state.couponCode,
        );
    // Sin guarda de disposal: `checkoutProvider` no es `autoDispose`, así que el
    // notifier sobrevive a la cotización.
    state = switch (result) {
      Success<ChairQuote>(:final ChairQuote value) => state.copyWith(
          isQuoting: false,
          quote: value,
          clearQuoteFailure: true,
        ),
      FailureResult<ChairQuote>(:final Failure failure) => state.copyWith(
          isQuoting: false,
          clearQuote: true,
          quoteFailure: failure,
        ),
    };
    // Si la cotización ni siquiera se pudo hacer, se pregunta por la ocupación
    // para poder decir "ocupada hasta las 16:40" en el panel de detalle.
    if (!result.isSuccess) await loadOccupancy(chairId);
  }

  /// Pide la ocupación actual de una silla para el panel de detalle.
  ///
  /// Un fallo aquí NO interrumpe el flujo: la cotización es la que importa y el
  /// panel de detalle puede quedarse con la información del mapa.
  Future<void> loadOccupancy(int chairId) async {
    final Result<ChairOccupancy?> result =
        await ref.read(checkoutRepositoryProvider).chairOccupancy(chairId);
    if (result case Success<ChairOccupancy>(:final ChairOccupancy value)) {
      state = state.copyWith(occupancy: value);
    }
  }

  // ------------------------------------------------------------ Confirmación

  /// Ejecuta el checkout: reserva (si hay silla) + `POST /orders`.
  ///
  /// Devuelve `true` si el pedido quedó creado. Un `false` deja el estado con
  /// [CheckoutState.placeFailure] publicado y, si es un conflicto de silla, vuelve
  /// al paso de la silla con el mapa recargado.
  Future<bool> confirm(CartState cart) async {
    if (!state.canConfirm) return false;
    state = state.copyWith(isPlacing: true, clearPlaceFailure: true);

    final Result<PlacedOrder> result = await ref.read(checkoutRepositoryProvider).place(
          CheckoutRequest(
            type: state.type,
            cart: cart,
            chairId: state.chairId,
            startAt: state.startAt,
            endAt: state.endAt,
            couponCode: cart.couponCode,
            customerNotes: state.notes.trim().isEmpty ? null : state.notes.trim(),
          ),
        );
    // Sin guarda de disposal: `checkoutProvider` no es `autoDispose`, así que el
    // notifier sobrevive al pedido.

    return switch (result) {
      Success<PlacedOrder>(:final PlacedOrder value) => () {
          state = state.copyWith(isPlacing: false, placedOrder: value);
          return true;
        }(),
      FailureResult<PlacedOrder>(:final Failure failure) => () {
          final bool chairConflict = CheckoutErrorCodes.isChairConflict(failure);
          state = state.copyWith(
            isPlacing: false,
            placeFailure: failure,
            // Vuelve al paso de la silla para que "elige otra" sea el siguiente
            // gesto natural, y no un botón de reintentar a ciegas.
            step: chairConflict ? CheckoutStep.chair : state.step,
            clearChair: chairConflict,
            clearQuote: chairConflict,
          );
          if (chairConflict) ref.invalidate(venueMapProvider);
          return false;
        }(),
    };
  }

  /// Descarta el fallo de confirmación sin cambiar de paso.
  void dismissPlaceFailure() => state = state.copyWith(clearPlaceFailure: true);
}
