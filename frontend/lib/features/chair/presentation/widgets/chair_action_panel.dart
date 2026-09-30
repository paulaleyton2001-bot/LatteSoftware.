// Panel de acción de una silla. Módulo `features/chair/presentation/widgets`.
//
// ESTE WIDGET ES LA RESPUESTA AL BUG QUE SE REPORTA
// ---------------------------------------------------
// Antes, tocar una silla en la pestaña «Silla` solo ejecutaba
// `setState(() => _selectedId = chair.id)`, y el `SelectedChairPanel` que consume
// ese id se pintaba únicamente si `context.breakpoint.usesSidebar` era `true`
// (`chair_tab_page.dart` L81). En un móvil —donde no hay sidebar— el resultado era
// un borde verde y nada más. El `logcat` no mostraba ninguna llamada porque la app
// NI LO INTENTABA: no había ningún `POST /rentals` ni `POST /reservations` en toda
// la feature (el `RentalRepository` solo declaraba `myRentals()`).
//
// Aquí vive el panel que falta. Se pinta en las dos formas del layout:
//   · ancho  → columna fija de la derecha (mismo sitio, ahora con contenido real)
//   · estrecho → hoja modal (`showModalBottomSheet`), que es lo que corresponde a
//     una acción que compite con el pulgar
// y el MISMO widget hace las dos cosas, para que no puedan divergir.
//
// QUÉ MUESTRA Y QUÉ PERMITE, POR ESTADO DE SILLA
// -----------------------------------------------
//   AVAILABLE / RESERVED  → precio/hora + «Reservar» (si hay permiso) y
//                           «Alquilar ahora» (si lo hay; si no, DESHABILITADO con
//                           el motivo, nunca escondido)
//   OCCUPIED             → quién, desde cuándo y hasta cuándo. SIN acciones: la
//                           specification lo pide así y además es lo correcto, porque
//                           tocar el alquiler de otra persona no es una operación de
//                           cliente.
//   CLEANING             → el personal está preparándola. Sin acciones para el
//                           cliente; «Liberar» para quien pueda.
//   BLOCKED / MAINTENANCE→ el motivo, y «Liberar» / «Cerrar mantenimiento» para
//                           quien tenga `chairs:status:update`.
//
// NINGUNA SILLA QUEDA SIN EXPLICACIÓN
// Para cada estado hay texto. Una celda apagada sin texto es un rompecabezas, y el
// enunciado es explícito: ninguna pantalla en blanco.
//
// LA PRIVACIDAD SE APLICA AQUÍ, EN LA PINTURA
// [ChairOccupancy.withOccupant] ya dejó el nombre vacío si el actor no tiene
// `rentals:read:any`. Aquí, además, se elige la frase: a la propia silla se le dice
// «Es tu alquiler» y a la de otro «Ocupada por otra persona», sin nombrar a nadie.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/empty_state.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../../../shared/widgets/ui/status_badge_resolver.dart';
import '../../domain/entities/chair_booking.dart';
import '../../domain/entities/chair_capabilities.dart';
import '../chair_action_controller.dart';
import '../chair_controller.dart';
import 'chair_reserve_form.dart';
import 'chair_state_actions.dart';

/// Vista interna del panel.
enum _PanelView {
  /// Ficha de la silla y sus acciones.
  detail,

  /// Formulario de reserva abierto.
  booking,
}

/// Panel de acción de la silla seleccionada.
class ChairActionPanel extends ConsumerStatefulWidget {
  const ChairActionPanel({
    required this.chairId,
    this.onClose,
    super.key,
  });

  /// Silla abierta. `0` = todavía no se ha tocado ninguna.
  final int chairId;

  /// Cierra el panel. `null` en la columna de escritorio, donde no hay nada que
  /// cerrar: la selección se cambia tocando otra silla.
  final VoidCallback? onClose;

  @override
  ConsumerState<ChairActionPanel> createState() => _ChairActionPanelState();
}

class _ChairActionPanelState extends ConsumerState<ChairActionPanel> {
  _PanelView _view = _PanelView.detail;

  /// Al cambiar de silla se vuelve a la ficha.
  ///
  /// Sin esto, tocar la segunda silla dejaría abierto el formulario de reserva de la
  /// primera, con el precio de la otra. Es un fallo que cuesta dinero y no se ve a
  /// simple vista.
  @override
  void didUpdateWidget(ChairActionPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.chairId != widget.chairId && _view != _PanelView.detail) {
      setState(() => _view = _PanelView.detail);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.chairId <= 0) return const _NothingSelected();

    final AsyncValue<ChairOccupancy> occupancy =
        ref.watch(chairOccupancyProvider(widget.chairId));
    final ChairCapabilities caps = ref.watch(chairCapabilitiesProvider);

    return AsyncStateBuilder<ChairOccupancy>(
      value: occupancy,
      loadingMessage: 'Abriendo la silla…',
      onRetry: () async {
        ref.invalidate(chairOccupancyProvider(widget.chairId));
      },
      builder: (BuildContext context, ChairOccupancy data) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _PanelHeader(
            chair: data.chair,
            onClose: widget.onClose,
            onBack: _view == _PanelView.booking
                ? () => setState(() => _view = _PanelView.detail)
                : null,
          ),
          const SizedBox(height: AppSpacing.md),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                0,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              child: _view == _PanelView.booking
                  ? ChairReserveForm(chairId: widget.chairId)
                  : _ChairDetail(
                      occupancy: data,
                      capabilities: caps,
                      onReserve: () => setState(() => _view = _PanelView.booking),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

/// «No has tocado ninguna silla». Es un estado con contenido, no un hueco: en
/// escritorio es lo que se ve al abrir la pestaña.
class _NothingSelected extends StatelessWidget {
  const _NothingSelected();

  @override
  Widget build(BuildContext context) => const EmptyState(
        icon: Icons.touch_app_outlined,
        title: 'Toca una silla del mapa',
        message: 'Te enseñamos su estado, su precio por hora y qué puedes hacer '
            'con ella: reservarla para una hora concreta o, si el local lo permite, '
            'alquilarla ahora mismo.',
        compact: true,
      );
}

/// Cabecera del panel: código, nombre, zona y estado.
class _PanelHeader extends StatelessWidget {
  const _PanelHeader({
    required this.chair,
    this.onClose,
    this.onBack,
  });

  final ChairInfo chair;
  final VoidCallback? onClose;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    // El `code` es la etiqueta canónica de la silla (ver `ChairInfo.cellLabel`), y
    // el nombre comercial va debajo para quien no lo conozca.
    final String? businessName = chair.businessName;

    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.lg,
        AppSpacing.sm,
        0,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (onBack != null)
            IconButton(
              onPressed: onBack,
              icon: const Icon(Icons.arrow_back_rounded),
              tooltip: 'Volver a la ficha de la silla',
            )
          else if (onClose != null)
            IconButton(
              onPressed: onClose,
              icon: const Icon(Icons.close_rounded),
              tooltip: 'Cerrar',
            ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Semantics(
                  header: true,
                  child: Text(chair.cellLabel, style: AppTextStyles.titleLarge),
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  <String>[
                    if (businessName != null) businessName,
                    if (chair.zoneName != null) chair.zoneName!,
                  ].join(' · '),
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.xs, right: AppSpacing.sm),
            child: StatusBadge.chair(chair.status),
          ),
        ],
      ),
    );
  }
}

/// Ficha de la silla: precio, ocupación y acciones.
class _ChairDetail extends ConsumerWidget {
  const _ChairDetail({
    required this.occupancy,
    required this.capabilities,
    required this.onReserve,
  });

  final ChairOccupancy occupancy;
  final ChairCapabilities capabilities;
  final VoidCallback onReserve;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ChairInfo chair = occupancy.chair;
    final String status = chair.status;
    final int? rentalId = occupancy.rentalId;
    final bool liveRental = occupancy.hasLiveRental;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _PriceRow(pricePerHourMinor: chair.pricePerHourMinor),
        const SizedBox(height: AppSpacing.md),
        _StatusExplanation(occupancy: occupancy),
        if (liveRental) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          _OccupancyCard(occupancy: occupancy),
        ],
        if (occupancy.hasFutureReservation) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          _FutureReservationCard(occupancy: occupancy),
        ],
        const SizedBox(height: AppSpacing.lg),
        // --- Acciones de cliente -------------------------------------------
        if (status == 'AVAILABLE' || status == 'RESERVED') ...<Widget>[
          _ReserveAction(
            capabilities: capabilities,
            chair: chair,
            onReserve: onReserve,
          ),
          const SizedBox(height: AppSpacing.sm),
          _WalkInAction(chair: chair, capabilities: capabilities),
        ] else if (status == 'OCCUPIED') ...<Widget>[
          const _OccupiedNotice(),
          // Extender y terminar sobre el alquiler VIVO de esta silla concreta.
          // Es el mismo camino que la tarjeta «Tu silla» pero con la silla a la
          // vista, que es justo lo que necesita quien está de pie en el local.
          // `rentalId` es `null` solo si el backend no lo trajo; sin él no se
          // ofrecen, en vez de ofrecer botones que no podrían llamar a nadie.
          if (rentalId != null && liveRental) ...<Widget>[
            const SizedBox(height: AppSpacing.lg),
            const Divider(height: 1),
            const SizedBox(height: AppSpacing.md),
            _LiveRentalActions(
              rentalId: rentalId,
              chair: chair,
              capabilities: capabilities,
            ),
          ],
        ] else ...<Widget>[
          const _NotOperableNotice(),
        ],
        // --- Acciones de personal ------------------------------------------
        if (capabilities.canChangeChairStatus) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          const Divider(height: 1),
          const SizedBox(height: AppSpacing.md),
          ChairStateActions(chair: chair),
        ],
        if (capabilities.isReadOnly) ...<Widget>[
          const SizedBox(height: AppSpacing.lg),
          _ReadOnlyNote(capabilities: capabilities),
        ],
      ],
    );
  }
}

/// Extender y terminar el alquiler VIVO de la silla que se está mirando.
///
/// LOS MISMOS PERMISOS Y LA MISMA EXPLICACIÓN QUE LA TARJETA «TU SILLA»
/// `POST /rentals/:id/extend` exige `rentals:extend` y `POST
/// /rentals/:id/complete` exige `rentals:complete`, y las dos están DENEGADAS a
/// `CUSTOMER` (verificado con `curl`: `403 INSUFFICIENT_PERMISSIONS
/// "rentals:extend"` y `"rentals:complete"`). Por eso, sin permiso, el botón se
/// pinta DESHABILITADO con el motivo debajo en lugar de esconderse: quien está
/// pagando por una silla tiene que poder leer por qué no puede ampliarla.
///
/// El texto es el MISMO que en `active_rental_card.dart` y en
/// `extend_rental_control.dart` a propósito: la respuesta a «¿por qué no puedo?» no
/// puede depender de la pantalla desde la que se pregunta.
class _LiveRentalActions extends ConsumerStatefulWidget {
  const _LiveRentalActions({
    required this.rentalId,
    required this.chair,
    required this.capabilities,
  });

  final int rentalId;
  final ChairInfo chair;
  final ChairCapabilities capabilities;

  @override
  ConsumerState<_LiveRentalActions> createState() => _LiveRentalActionsState();
}

class _LiveRentalActionsState extends ConsumerState<_LiveRentalActions> {
  /// Minutos de ampliación. 30 es el mínimo de cobro del local.
  static const List<int> _options = <int>[30, 60, 120];

  int _minutes = 30;

  @override
  Widget build(BuildContext context) {
    final ChairCapabilities caps = widget.capabilities;
    final AsyncValue<void> busy =
        ref.watch(rentalActionProvider(widget.rentalId));
    final bool sending = busy.isLoading;
    final Object? error = busy.error;
    final bool canExtend = caps.canExtendRental && !sending;
    final bool canComplete = caps.canCompleteRental && !sending;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Semantics(
          header: true,
          child: Text(
            'Alquiler en curso · ${widget.chair.cellLabel}',
            style: AppTextStyles.titleSmall,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        if (canExtend) ...<Widget>[
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: <Widget>[
              for (final int option in _options)
                ChoiceChip(
                  label: Text(chairDurationLabel(option)),
                  selected: _minutes == option,
                  onSelected: sending
                      ? null
                      : (bool selected) => setState(() => _minutes = option),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
        ],
        AppButton(
          key: const Key('chair-extend'),
          label: canExtend
              ? 'Ampliar ${chairDurationLabel(_minutes)}'
              : 'Ampliar tiempo',
          icon: Icons.more_time_rounded,
          variant: AppButtonVariant.secondary,
          isFullWidth: true,
          isLoading: sending,
          onPressed: canExtend ? _extend : null,
          semanticLabel: canExtend
              ? 'Ampliar ${chairDurationLabel(_minutes)} el alquiler de '
                  '${widget.chair.cellLabel}'
              : 'Ampliar el alquiler de ${widget.chair.cellLabel}. No '
                  'disponible: ${caps.extendBlockedReason ?? ''}',
        ),
        if (!canExtend) _BlockedReason(caps.extendBlockedReason),
        const SizedBox(height: AppSpacing.sm),
        AppButton(
          key: const Key('chair-complete'),
          label: 'Terminar y cobrar en el local',
          icon: Icons.stop_circle_outlined,
          variant: AppButtonVariant.danger,
          isFullWidth: true,
          onPressed: canComplete ? _complete : null,
          semanticLabel: canComplete
              ? 'Terminar el alquiler de ${widget.chair.cellLabel}'
              : 'Terminar el alquiler de ${widget.chair.cellLabel}. No '
                  'disponible: ${caps.completeBlockedReason ?? ''}',
        ),
        if (!canComplete) _BlockedReason(caps.completeBlockedReason),
        if (error != null) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          _ActionError(
            error: error,
            onRefresh: () => refreshChairMap(ref),
          ),
        ],
      ],
    );
  }

  Future<void> _extend() async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Ampliar $_minutes minutos más?',
      message: 'Se suman a la cuenta del local, al precio congelado de esta silla. '
          'Aquí no se hace ningún cargo.',
      confirmLabel: 'Ampliar',
      action: DialogAction.confirm,
      icon: Icons.more_time_rounded,
    );
    if (action != DialogAction.confirm || !mounted) return;
    final ActionResult result = await ref
        .read(rentalActionProvider(widget.rentalId).notifier)
        .extend(_minutes);
    if (!mounted) return;
    _report(result, 'Alquiler ampliado $_minutes minutos.');
  }

  Future<void> _complete() async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Terminar el alquiler de ${widget.chair.cellLabel}?',
      message: 'Se cobra el tiempo que se haya usado, con un mínimo de 30 '
          'minutos. Paga en el local y la silla queda en «limpieza».',
      confirmLabel: 'Terminar',
      action: DialogAction.cancel,
      icon: Icons.stop_circle_outlined,
    );
    if (action != DialogAction.confirm || !mounted) return;
    final ActionResult result = await ref
        .read(rentalActionProvider(widget.rentalId).notifier)
        .complete();
    if (!mounted) return;
    _report(result, 'Alquiler cerrado. Se paga en el mostrador.');
  }

  void _report(ActionResult result, String success) {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    switch (result.outcome) {
      case ActionOutcome.done:
        messenger
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(success)));
      case ActionOutcome.conflict:
        messenger
          ..hideCurrentSnackBar()
          ..showSnackBar(
            const SnackBar(
              content: Text('La silla cambió mientras tanto. Ya está actualizado.'),
            ),
          );
      case ActionOutcome.forbidden:
      case ActionOutcome.failed:
        break;
    }
  }
}

/// Fila del precio por hora.
class _PriceRow extends StatelessWidget {
  const _PriceRow({required this.pricePerHourMinor});

  final int pricePerHourMinor;

  @override
  Widget build(BuildContext context) {
    if (pricePerHourMinor <= 0) {
      return Text(
        'El local no tiene precio configurado para esta silla.',
        style: AppTextStyles.bodySmall
            .copyWith(color: context.tokens.textSecondary),
      );
    }
    return Semantics(
      label: 'Precio: ${CurrencyFormatter.formatMinor(pricePerHourMinor)} '
          'por hora',
      excludeSemantics: true,
      child: Row(
        children: <Widget>[
          Icon(
            Icons.sell_outlined,
            size: 18,
            color: context.tokens.textSecondary,
          ),
          const SizedBox(width: AppSpacing.xs),
          Text(
            '${CurrencyFormatter.formatMinor(pricePerHourMinor)} / hora',
            style: AppTextStyles.titleMedium,
          ),
        ],
      ),
    );
  }
}

/// Explicación en una frase del estado actual.
///
/// Es lo que garantiza que ninguna silla quede como un bloque sin lectura: los seis
/// estados de `ChairStatus` tienen su frase.
class _StatusExplanation extends StatelessWidget {
  const _StatusExplanation({required this.occupancy});

  final ChairOccupancy occupancy;

  @override
  Widget build(BuildContext context) {
    final AppStatusVisual visual = forChair(occupancy.chair.status);
    final StatusColors colors = statusColorsOf(context, visual.palette);
    final String reason = switch (occupancy.chair.status) {
      'AVAILABLE' => 'Está libre ahora mismo. Puedes reservarla para una hora '
          'concreta.',
      'RESERVED' => 'Está reservada para otra franja. Puedes mirarla y, si te '
          'apeta otra hora, probarla con el cotizador.',
      'OCCUPIED' => 'Alguien la está usando ahora mismo.',
      'BLOCKED' => 'El personal la ha retirado del servicio.',
      'MAINTENANCE' => 'Está averiada o en reparación.',
      'CLEANING' => 'La están preparando. En unos minutos vuelve a estar libre.',
      _ => visual.label,
    };
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(visual.icon, size: 20, color: colors.text),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              reason,
              style: AppTextStyles.bodySmall.copyWith(color: colors.text),
            ),
          ),
        ],
      ),
    );
  }
}

/// Datos del alquiler en curso de la silla.
class _OccupancyCard extends StatelessWidget {
  const _OccupancyCard({required this.occupancy});

  final ChairOccupancy occupancy;

  @override
  Widget build(BuildContext context) {
    final DateTime? start = occupancy.rentalStartAt;
    final DateTime? end = occupancy.rentalEndAt;
    final bool mine = occupancy.isMine;
    // El nombre del ocupante solo existe si el actor tiene `rentals:read:any`
    // (`ChairOccupancy.withOccupant` lo borró en caso contrario), así que aquí no
    // hay que volver a comprobar el permiso.
    final String? name = occupancy.displayOccupantName;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _InfoRow(
          icon: mine ? Icons.person_rounded : Icons.groups_rounded,
          label: 'Ocupante',
          value: mine
              ? 'Es tu alquiler'
              : (name ?? 'Otra persona'),
        ),
        if (start != null)
          _InfoRow(
            icon: Icons.play_arrow_rounded,
            label: 'Desde',
            value: DateFormatter.dateTime(start),
          ),
        if (end != null)
          _InfoRow(
            icon: Icons.stop_rounded,
            label: 'Hasta',
            value: DateFormatter.time(end),
          ),
        if (occupancy.rentalCode != null)
          _InfoRow(
            icon: Icons.confirmation_number_outlined,
            label: 'Alquiler',
            value: occupancy.rentalCode!,
          ),
      ],
    );
  }
}

/// Datos de la reserva en curso de la silla.
///
/// DIFERENCIA ENTRE `PENDING` Y `CONFIRMED`, QUE NO ES UN DETALLE DE PINTURA
/// Verificado con `curl` el 2026-09-29: tras `POST /reservations` la silla sigue en
/// `AVAILABLE` y su reserva está en `PENDING`; solo `POST /reservations/:id/confirm`
/// la pasa a `CONFIRMED` y pone la silla en `RESERVED`. Decir «Reservada» con una
/// `PENDING` sería mentir sobre algo que cuesta dinero, así que aquí se nombra el
/// estado literal y se explica qué significa.
class _FutureReservationCard extends StatelessWidget {
  const _FutureReservationCard({required this.occupancy});

  final ChairOccupancy occupancy;

  @override
  Widget build(BuildContext context) {
    final DateTime? start = occupancy.reservationStartAt;
    final DateTime? end = occupancy.reservationEndAt;
    final bool pending = occupancy.hasPendingReservation;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        _InfoRow(
          icon: pending ? Icons.pending_actions_rounded : Icons.event_rounded,
          label: 'Reserva',
          value: occupancy.reservationCode ?? 'Sí',
        ),
        if (start != null && end != null)
          _InfoRow(
            icon: Icons.schedule_rounded,
            label: 'Franja',
            value: DateFormatter.range(start, end),
          ),
        if (pending)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.xs, left: 24),
            child: Text(
              'Está pendiente de confirmar: la silla todavía puede ocuparla '
              'alguien.',
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textWarning),
            ),
          ),
      ],
    );
  }
}

/// Una fila etiqueta / valor del panel.
class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(
          children: <Widget>[
            Icon(icon, size: 16, color: context.tokens.textSecondary),
            const SizedBox(width: AppSpacing.sm),
            SizedBox(
              width: 92,
              child: Text(
                label,
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textSecondary),
              ),
            ),
            Expanded(
              child: Text(value, style: AppTextStyles.bodySmall),
            ),
          ],
        ),
      );
}

/// Botón de reservar.
///
/// Con `reservations:create` abre el cotizador. Sin él, se muestra DESHABILITADO con
/// el motivo debajo: esconderlo dejaría a la persona pensando que la app está rota,
/// y ofrecerlo y recibir un `403` sería peor.
class _ReserveAction extends StatelessWidget {
  const _ReserveAction({
    required this.capabilities,
    required this.chair,
    required this.onReserve,
  });

  final ChairCapabilities capabilities;
  final ChairInfo chair;
  final VoidCallback onReserve;

  @override
  Widget build(BuildContext context) {
    final String? blocked = capabilities.canReserve
        ? null
        : 'Crear reservas («reservations:create») no está en tu cuenta.';
    final bool enabled = capabilities.canReserve && chair.isBookable;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        AppButton(
          key: const Key('chair-reserve'),
          label: 'Reservar para una hora',
          icon: Icons.event_available_rounded,
          variant: AppButtonVariant.espresso,
          isFullWidth: true,
          onPressed: enabled ? onReserve : null,
          semanticLabel: enabled
              ? 'Reservar ${chair.cellLabel} para una hora concreta'
              : 'Reservar ${chair.cellLabel}. No disponible: $blocked',
        ),
        if (blocked != null) _BlockedReason(blocked),
        if (capabilities.canReserve && !chair.isBookable)
          const _BlockedReason(
            'El local tiene esta silla marcada como no reservable.',
          ),
      ],
    );
  }
}

/// Alquiler sin cita (`POST /rentals`).
///
/// DENEGADO A `CUSTOMER` — y así se demuestra, no se esconde: el botón aparece
/// apagado y debajo está el motivo. Verificado con `curl`:
///
///   CUSTOMER → POST /rentals
///   403 {"details":{"code":"INSUFFICIENT_PERMISSIONS","required":"rentals:create"}}
///
/// La duración se elige con los mismos chips que la reserva, y el alquiler se abre
/// con lo que elijó el personal, que es quien tiene el permiso.
class _WalkInAction extends ConsumerStatefulWidget {
  const _WalkInAction({required this.chair, required this.capabilities});

  final ChairInfo chair;
  final ChairCapabilities capabilities;

  @override
  ConsumerState<_WalkInAction> createState() => _WalkInActionState();
}

class _WalkInActionState extends ConsumerState<_WalkInAction> {
  int _minutes = 60;

  @override
  Widget build(BuildContext context) {
    final bool allowed = widget.capabilities.canOpenWalkIn;
    final AsyncValue<void> busy =
        ref.watch(walkInProvider(widget.chair.id));
    final bool sending = busy.isLoading;
    final Object? error = busy.error;
    final bool enabled = allowed && !sending;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (allowed) ...<Widget>[
          const Text(
            '¿Y si me siento ahora?',
            style: AppTextStyles.titleSmall,
          ),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: <Widget>[
              for (final int minutes in kChairDurationPresets)
                ChoiceChip(
                  label: Text(chairDurationLabel(minutes)),
                  selected: _minutes == minutes,
                  onSelected: sending
                      ? null
                      : (bool selected) =>
                          setState(() => _minutes = minutes),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
        ],
        AppButton(
          key: const Key('chair-walk-in'),
          label: allowed
              ? 'Alquilar ahora por ${chairDurationLabel(_minutes)}'
              : 'Alquilar ahora',
          icon: Icons.play_circle_outline_rounded,
          variant: AppButtonVariant.primary,
          isFullWidth: true,
          isLoading: sending,
          onPressed: enabled ? _confirm : null,
          semanticLabel: allowed
              ? 'Alquilar ${widget.chair.cellLabel} ahora mismo'
              : 'Alquilar ${widget.chair.cellLabel} ahora. No disponible para tu '
                  'cuenta.',
        ),
        if (allowed && error != null)
          _ActionError(
            error: error,
            onRefresh: () => refreshChairMap(ref),
          )
        else if (!allowed)
          _BlockedReason(widget.capabilities.walkInBlockedReason ?? ''),
      ],
    );
  }

  /// Abre el alquiler y explica el desenlace.
  ///
  /// NO recibe `BuildContext` como parámetro a propósito: usa el del `State`. Pasarlo
  /// por parámetro hacía que el `mounted` que guarda el hueco fuese «de otro
  /// widget» y el analizador no lo aceptara como guarda real
  /// (`use_build_context_synchronously`), que es la forma en que un `ScaffoldMessenger`
  /// toca un contexto ya liberado.
  Future<void> _confirm() async {
    final ActionResult result = await ref
        .read(walkInProvider(widget.chair.id).notifier)
        .open(plannedMinutes: _minutes);
    if (!mounted) return;
    switch (result.outcome) {
      // `409 CHAIR_OCCUPIED`: se acaba de sentar alguien. El controlador ya refrescó
      // el mapa; aquí lo que se explica es que el plano ya no era cierto.
      case ActionOutcome.conflict:
        _toast('Alguien se ha sentado en esa silla mientras mirabas. '
            'El plano ya está actualizado.');
      case ActionOutcome.done:
        // Se queda en la misma hoja, que es donde se ha abierto: el panel se
        // invalida y ya muestra la ficha del alquiler con «Ampliar» y «Terminar».
        // Antes decía «desde «Tu silla»», y para un CUSTOMER eso no era cierto:
        // `rentals:extend` y `rentals:complete` están denegadas y la tarjeta no
        // aparece, así que el aviso mandaba a un sitio donde no se podía hacer.
        _toast('Silla ${widget.chair.cellLabel} abierta. Abajo tienes '
            'para ampliarla o terminarla.');
      // `forbidden` y `failed` los muestra el banner de error de arriba: son fallos
      // que necesitan LEERSE, no un aviso que desaparece a los dos segundos.
      case ActionOutcome.forbidden:
      case ActionOutcome.failed:
        break;
    }
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message)));
  }
}

/// Aviso de que la silla está ocupada y no se puede actuar sobre ella.
class _OccupiedNotice extends StatelessWidget {
  const _OccupiedNotice();

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.info_outline_rounded,
            size: 18,
            color: context.tokens.textSecondary,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'No se puede reservar ni alquilar una silla que está ocupada. '
              'Si necesitas otra, elige cualquiera libre del mapa.',
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
        ],
      );
}

/// Aviso genérico para `BLOCKED`, `MAINTENANCE` y `CLEANING`.
class _NotOperableNotice extends StatelessWidget {
  const _NotOperableNotice();

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.info_outline_rounded,
            size: 18,
            color: context.tokens.textSecondary,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Mientras la silla esté en este estado no se puede reservar. Si '
              'crees que es un error, dilo al personal del local.',
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
        ],
      );
}

/// Motivo por el que un botón está apagado.
///
/// Va SIEMPRE debajo del botón, y no en un tooltip: el motivo tiene que estar a la
/// vista para quien no va a descubrir tooltips con el dedo ni con un lector de
/// pantalla.
class _BlockedReason extends StatelessWidget {
  const _BlockedReason(this.reason);

  /// `null` = no hay motivo que explicar (o sea, la acción SÍ está disponible), y
  /// entonces no se pinta nada. Acepta `null` para que quien lo use no tenga que
  /// decidir si la capacidad existe o no solo para decidir si pinta o no.
  final String? reason;

  @override
  Widget build(BuildContext context) {
    if (reason == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.lock_outline_rounded,
            size: 14,
            color: context.tokens.textTertiary,
          ),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Text(
              reason!,
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textTertiary),
            ),
          ),
        ],
      ),
    );
  }
}

/// Error de una acción, con reintento si procede.
class _ActionError extends StatelessWidget {
  const _ActionError({required this.error, this.onRefresh});

  final Object error;
  final VoidCallback? onRefresh;

  @override
  Widget build(BuildContext context) {
    // El campo es `Object` y los campos finales private no se promocionan de tipo en
    // esta versión de Dart, así que la normalización va en una local.
    final Object cause = error;
    final Failure failure =
        cause is Failure ? cause : UnknownFailure(details: '$cause');
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: FormErrorBanner(failure: failure, onRetry: onRefresh, compact: true),
    );
  }
}

/// Nota final para quien no tiene ningún permiso de sala.
///
/// Se pinta UNA vez, al pie, y no repetido bajo cada botón: el detalle de cada acción
/// va bajo su propio botón, y esto es el resumen de por qué no hay ninguno.
class _ReadOnlyNote extends StatelessWidget {
  const _ReadOnlyNote({required this.capabilities});

  final ChairCapabilities capabilities;

  @override
  Widget build(BuildContext context) {
    // Con `reservations:create` este aviso no aporta nada: ya se puede reservar.
    if (capabilities.canReserve) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: context.tokens.surfaceInfoSubtle,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.info_outline_rounded,
            size: 18,
            color: context.tokens.textInfo,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Tu cuenta puede ver el plano, pero no reservarlo ni gestionarlo. '
              'Pídeselo al personal del mostrador.',
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textInfo),
            ),
          ),
        ],
      ),
    );
  }
}
