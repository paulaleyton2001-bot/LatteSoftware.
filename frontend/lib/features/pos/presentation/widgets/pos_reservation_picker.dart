// Selector de reserva del alquiler, en el panel de cobro del mostrador.
// MÓDULO `pos/presentation/widgets`.
//
// POR QUÉ ESTE WIDGET EXISTE (es lo que faltaba para poder cobrar un alquiler)
// `POST /orders` con `type = CHAIR_RENTAL` exige `chairId` Y `reservationId`:
// el backend devuelve `422 RENTAL_REQUIRES_CHAIR_AND_RESERVATION` (BR-ORDER-008)
// sin la reserva. `PosDraft.needsReservation` comprobaba eso, pero NINGUNA
// pantalla llamaba a `PosDraftController.attachReservation`: el método existía
// como código muerto. El efecto en pantalla era que el botón de cobrar quedaba
// deshabilitado para siempre en «Alquiler de silla», y el cajero no tenía forma
// de desbloquearlo. Este widget es quien le da una reserva que pulsar.
//
// SÓLO RESERVAS QUE EL MOSTRADOR PUEDE ARRANCAR
// Se listan todas las de la silla en las próximas 12 h, pero solo son elegibles
// las `PENDING` y las `CONFIRMED`. Las `CANCELLED` o `COMPLETED` se muestran
// apagadas y con el motivo, porque una franja ocupada que ya no está explica por
// qué el plano dice «libre» y la reserva dice otra cosa. `ACTIVE` tampoco se
// puede arrancar: ya hay un alquiler abierto, y el segundo cobraría doble.
//
// LO QUE PASA DESPUÉS
// Elegir una reserva NO abre el alquiler ni cobra nada: deja el borrador listo
// para que el botón de Cobrar haga `POST /orders` y `POST /payments` en un solo
// paso. Si además hay productos en el carrito, se cobra el alquiler aparte
// (el backend prohíbe mezclar: `422 MIXED_ORDER_TYPE_NOT_ALLOWED`).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/pos_draft.dart';
import '../../domain/repositories/pos_repository_models.dart';
import '../pos_controller.dart';
import './pos_order_type_selector.dart';

/// Lista de reservas de la silla elegida, para vincularla al alquiler.
///
/// Devuelve `null` si el cajero no ha elegido silla: el panel decide si cabe.
class PosReservationPicker extends ConsumerWidget {
  const PosReservationPicker({required this.chairId, super.key});

  final int chairId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<PosReservation>> reservations =
        ref.watch(posChairReservationsProvider(chairId));
    final PosDraft draft = ref.watch(posDraftProvider);
    // El mismo `AsyncNotifier` que el alquiler sin reserva: tocar una reserva
    // también arranca el alquiler, y así un solo indicador de carga para los dos
    // caminos.
    final bool starting = ref.watch(posWalkInProvider).isLoading;

    return AsyncStateBuilder<List<PosReservation>>(
      value: reservations,
      loadingMessage: 'Buscando reservas de la silla…',
      onRetry: () async => ref.invalidate(posChairReservationsProvider(chairId)),
      // El mensaje de sin conexión NO promete reenvío: el mostrador no encola
      // nada (`NoopSyncEngine`). Dice lo único cierto: sin red no se puede
      // consultar si el cliente tenía reserva.
      offlineTitle: 'Sin conexión',
      offlineMessage: 'No se pueden consultar las reservas de la silla sin red. '
          'Si el cliente no tiene reserva, puedes abrir un alquiler sin reserva.',
      isEmpty: (List<PosReservation> data) => data.isEmpty,
      emptyIcon: Icons.event_available_outlined,
      emptyTitle: 'Esta silla no tiene reservas',
      emptyMessage: 'Si el cliente vino sin reservar, abre un alquiler sin '
          'reserva con el botón de abajo.',
      compactEmpty: true,
      builder: (BuildContext context, List<PosReservation> data) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          for (final PosReservation reservation in data) ...<Widget>[
            _ReservationRow(
              reservation: reservation,
              selected: reservation.id == draft.reservationId,
              busy: starting,
              onTap: (!reservation.isStartable || starting)
                  ? null
                  : () => _start(context, ref, reservation),
            ),
            const SizedBox(height: AppSpacing.xs),
          ],
        ],
      ),
    );
  }

  /// Elige la reserva Y arranca su alquiler en un solo gesto.
  ///
  /// No es un adorno: sin el alquiler arrancado el servidor crea el pedido
  /// `CHAIR_RENTAL` con `totalMinor = 0`, porque el importe sale del alquiler
  /// `ACTIVE` y no de la reserva. Cobrar eso sería cobrar cero por una hora de
  /// silla, así que elegir la reserva y abrir el alquiler son la misma acción
  /// desde el punto de vista del cajero.
  Future<void> _start(
    BuildContext context,
    WidgetRef ref,
    PosReservation reservation,
  ) async {
    // Aviso optimista: la reserva queda marcada mientras va la llamada, y si
    // falla se revierte. `PosDraftController` es la verdad, así que el
    // `attachReservation` se hace al FINAL, cuando el alquiler está abierto.
    ref.read(posDraftProvider.notifier).attachReservation(reservation.id);
    final Object? error = await ref
        .read(posWalkInProvider.notifier)
        .startFromReservation(chairId: chairId, reservation: reservation)
        .then<Object?>((PosWalkInResult? value) => null)
        .onError<Object>((Object error, StackTrace _) => error);
    if (!context.mounted) return;
    if (error != null) {
      // La reserva elegida no sirve sin alquiler: se suelta para que el botón de
      // cobrar no se habilite con un pedido que valdría cero.
      ref.read(posDraftProvider.notifier).clearReservation();
      // El estado de error NO se borra: el aviso rojo tiene que quedarse hasta
      // que el cajero cambie de silla o de reserva. Borrarlo aquí dejaba la
      // pantalla idéntica a como estaba, que es indistinguible de que el botón
      // no haga nada.
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(posRentalFailureMessage(error)),
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 6),
        ),
      );
    }
  }
}

/// Una reserva como botón. 44 dp de alto, `Semantics(selected:)`.
class _ReservationRow extends StatelessWidget {
  const _ReservationRow({
    required this.reservation,
    required this.selected,
    required this.busy,
    required this.onTap,
  });

  final PosReservation reservation;
  final bool selected;

  /// `true` mientras se arranca el alquiler de ESTA reserva. Se apaga el botón
  /// para que dos toques seguidos no abran dos alquileres de la misma silla.
  final bool busy;

  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onTap != null;
    final String when = _when();

    return Semantics(
      button: true,
      enabled: enabled,
      selected: selected,
      label: '${reservation.label}, $when, ${_statusLabel()}',
      excludeSemantics: true,
      child: Tooltip(
        message: enabled
            ? 'Vincular ${reservation.code} al alquiler'
            : '${reservation.code} no se puede usar: ${_statusLabel()}',
        child: Material(
          color: selected
              ? context.tokens.surfaceGreenSubtle
              : context.tokens.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadii.md),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadii.md),
            child: Opacity(
              // Sin this.opacity no se distinguiría una reserva no elegible de
              // una elegible, y el único canal sería el color del texto.
              opacity: enabled ? 1 : 0.6,
              child: Container(
                constraints: const BoxConstraints(minHeight: 44),
                padding: const EdgeInsets.symmetric(
                  horizontal: AppSpacing.md,
                  vertical: AppSpacing.sm,
                ),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppRadii.md),
                  border: Border.all(
                    color: selected
                        ? context.tokens.brandDark
                        : context.tokens.borderDefault,
                    width: selected ? 2 : 1,
                  ),
                ),
                child: Row(
                  children: <Widget>[
                    if (busy)
                      const SizedBox.square(
                        dimension: 14,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    else if (selected) ...<Widget>[
                      Icon(Icons.check_rounded,
                          size: 16, color: context.tokens.actionPrimary),
                      const SizedBox(width: AppSpacing.xs),
                    ],
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(
                            reservation.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.labelLarge,
                          ),
                          Text(
                            '$when · ${_statusLabel()}',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.captionSmall
                                .copyWith(color: context.tokens.textTertiary),
                          ),
                        ],
                      ),
                    ),
                    if (reservation.totalMinor > 0)
                      PriceDisplay(
                        currentMinor: reservation.totalMinor,
                        variant: PriceVariant.costPerUnit,
                        unitLabel: 'alquiler',
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// "hoy 18:30 – 19:30", o solo la hora si cruza el día.
  String _when() {
    final DateTime? from = reservation.startAt?.toLocal();
    final DateTime? to = reservation.endAt?.toLocal();
    if (from == null) return reservation.code;
    final String start = DateFormatter.time(from);
    if (to == null) return start;
    return '$start – ${DateFormatter.time(to)}';
  }

  /// Motivo por el que no se puede arrancar, en lenguaje de cajero.
  String _statusLabel() => switch (reservation.status) {
        'CONFIRMED' => 'confirmada',
        'PENDING' => 'por confirmar',
        'ACTIVE' => 'ya en curso',
        'COMPLETED' => 'ya usada',
        'CANCELLED' => 'cancelada',
        'EXPIRED' => 'caducada',
        'NO_SHOW' => 'no asistió',
        _ => reservation.status,
      };
}

/// Aviso de que el alquiler NO incluye los productos del carrito.
///
/// El backend no permite mezclarlos (`422 MIXED_ORDER_TYPE_NOT_ALLOWED`,
/// BR-ORDER-012), así que decirlo aquí evita que el cajero lo descubra al cobrar.
/// Se muestra solo si HAY productos: sin ellos el aviso sobra.
///
/// El número que se cuenta son LÍNEAS, no unidades, y el texto lo dice así: el
/// carrito fusiona dos cafés iguales en una sola línea, así que «2 productos» era
/// una cuenta falsa para quien tiene 3 cafés en el carrito.
class PosRentalProductsNotice extends StatelessWidget {
  const PosRentalProductsNotice({required this.lineCount, super.key});

  /// Líneas del carrito, tal como las pinta el panel de pedido.
  final int lineCount;

  @override
  Widget build(BuildContext context) {
    if (lineCount <= 0) return const SizedBox.shrink();
    return PosInlineNotice(
      icon: Icons.info_outline_rounded,
      text: 'El alquiler se cobra aparte: las $lineCount línea'
          '${lineCount == 1 ? '' : 's'} del carrito se cobran en su propio '
          'pedido, porque el sistema no permite mezclar ambos.',
    );
  }
}

/// Traduce un fallo del flujo de alquiler a algo accionable.
///
/// El mensaje crudo del backend («Un pedido de alquiler necesita la reserva
/// asociada») describe la regla, no lo que tiene que hacer el cajero. Este texto
/// se muestra junto al botón y dice el siguiente paso.
String posRentalFailureMessage(Object? error) {
  // EL TIPO SE MIRA ANTES QUE EL CÓDIGO, Y POR QUÉ
  // `ErrorMapper` traduce un fallo de transporte a `OfflineFailure` y un timeout
  // a `NetworkFailure`: los dos son «no se pudo hablar con el servidor», y
  // ninguno de los dos lleva un código de negocio que matchee el `switch` de
  // abajo. Si se mirara el código primero, un `NetworkFailure` caería en el
  // `default` y saldría el texto genérico del mapper, perdiendo la única
  // información que el cajero necesita: que no se ha cobrado nada.
  if (error is OfflineFailure ||
      error is NetworkFailure ||
      (error is Failure && error.isRetryable && error.code == 'TIMEOUT')) {
    return 'No hay conexión con el servidor. El alquiler NO se ha abierto: no se '
        'ha cobrado nada y la silla sigue libre.';
  }
  if (error is Failure && error.code != null) {
    return switch (error.code) {
      'RENTAL_REQUIRES_CHAIR_AND_RESERVATION' =>
        'Vuelve a elegir la reserva de esta silla. Si el cliente no tenía '
            'reserva, abre un alquiler sin reserva.',
      'RESERVATION_NOT_ACTIVE' =>
        'La reserva no estaba confirmada. Ábrela otra vez: el mostrador la '
            'confirma por ti.',
      'CHAIR_ALREADY_RESERVED' =>
        'Esa franja ya está reservada. Elige otra silla o abre el alquiler con '
            'otra duración.',
      'CHAIR_NOT_BOOKABLE' =>
        'Esa silla no admite alquiler. Elige otra del plano.',
      'CHAIR_OCCUPIED' || 'CHAIR_IN_USE' =>
        'La silla se ocupó mientras tanto. Elige otra del plano.',
      'INVALID_DATE_RANGE' || 'PAST_DATE' =>
        'La duración elegida no es válida. Elige otra.',
      _ => error.message,
    };
  }
  return 'No se pudo abrir el alquiler. No se ha cobrado nada.';
}
