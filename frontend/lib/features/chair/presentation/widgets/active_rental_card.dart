// Tarjeta de la silla activa con temporizador en vivo, y las acciones sobre ella.
// Módulo `features/chair/presentation/widgets`.
//
// Van aparte de la página porque la tarjeta se REUTILIZA: la home pinta una versión
// reducida de la misma información, y duplicarla haría que «mi silla» se viera
// distinto en dos pantallas (que es exactamente el tipo de bug que hace que alguien
// no sepa si su silla cambió).
//
// EL TEMPORIZADOR ES EL DEL RELOJ COMPARTIDO
// `RentalCountdown` se alimenta de `clockProvider`
// (`shared/widgets/rental_countdown.dart`), el mismo `Stream` de un segundo que
// usan el detalle del pedido y la home. Tres relojes independientes derivarían uno
// del otro y las cifras no coincidirían entre pantallas.
//
// ─────────────────────────────────────────────────────────────────────────────
// EXTENDER Y TERMINAR: LA DECISIÓN QUE ESTÁ EN ESTE ARCHIVO
//
// `POST /rentals/:id/extend` exige `rentals:extend` y `POST /rentals/:id/complete`
// exige `rentals:complete`. En la matriz de `backend/src/shared/domain/
// permissions.ts` las dos están DENEGADAS a `CUSTOMER` (marca `-`), y está
// comprobado con peticiones reales:
//
//   CUSTOMER → POST /rentals/5/extend
//   403 {"details":{"code":"INSUFFICIENT_PERMISSIONS","required":"rentals:extend"}}
//   CUSTOMER → POST /rentals/5/complete
//   403 {"details":{"code":"INSUFFICIENT_PERMISSIONS","required":"rentals:complete"}}
//
// QUÉ SE HACE CON ESO, Y POR QUÉ NO SE ESCONDE
// El botón se PINTA DESHABILITADO con el motivo escrito debajo. Las dos
// alternativas son peores:
//   · esconderlo  → quien está pagando por una silla ve una tarjeta sin ningún
//                   botón y no sabe si la app está rota, si le va a pasar algo, o
//                   si tiene que ir a preguntar al mostrador;
//   · ofrecerlo   → la app hace algo que no puede hacer y recibe un `403`; es
//                   peor que no ofrecerlo, porque ahora la app miente.
//
// Con el botón apagado y el motivo a la vista, la respuesta es la misma en las tres
// pantallas donde aparece esta tarjeta y no depende de quién la esté leyendo.
//
// ESTADOS: NUNCA «NO TIENES NINGUNA» EN VEZ DE UN ERROR
// La tarjeta vacía solo se pinta si la consulta TERMINÓ con éxito. Si falló, la
// pantalla muestra el error con reintento: decir «no tienes silla» cuando lo que
// falló fue la consulta sería una mentira que puede costar dinero.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../app/routes.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/rental_countdown.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/empty_state.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../../orders/domain/entities/rental.dart';
import '../chair_action_controller.dart';
import '../chair_controller.dart';
import '../../domain/entities/chair_capabilities.dart';

/// Estado vacío: no hay alquiler activo. Con salida al checkout.
class NoActiveRentalNotice extends StatelessWidget {
  const NoActiveRentalNotice({super.key});

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.event_seat_outlined,
      title: 'No tienes ninguna silla ahora',
      message: 'Toca una del mapa para ver su precio y reservarla para una hora '
          'concreta, o ven al checkout y paga al terminar.',
      actionLabel: 'Ir al checkout',
      onAction: () => context.push(AppRoutes.checkout),
    );
  }
}

/// Tarjeta de la silla activa, con temporizador y acciones.
class ActiveRentalCard extends ConsumerWidget {
  const ActiveRentalCard({required this.rental, super.key});

  final Rental rental;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final DateTime? end = rental.endAt;
    final DateTime? start = rental.startAt;
    final ChairCapabilities caps = ref.watch(chairCapabilitiesProvider);

    return AppCard(
      variant: AppCardVariant.elevated,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      'Tu silla',
                      style: AppTextStyles.labelMedium
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                    const SizedBox(height: AppSpacing.xxs),
                    Text(
                      rental.chairCode ?? 'Silla reservada',
                      style: AppTextStyles.headlineSmall,
                    ),
                  ],
                ),
              ),
              StatusBadge.rental(rental.status),
            ],
          ),
          if (end != null) ...<Widget>[
            const SizedBox(height: AppSpacing.lg),
            RentalCountdown(endAt: end, large: true),
            const SizedBox(height: AppSpacing.xxs),
            Text(
              start == null
                  ? 'Termina a las ${DateFormatter.time(end)}'
                  : 'De ${DateFormatter.time(start)} a ${DateFormatter.time(end)}',
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          _CostBreakdown(rental: rental),
          if (rental.code != null) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            Text(
              'Alquiler ${rental.code}',
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textTertiary),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          const Divider(height: 1),
          const SizedBox(height: AppSpacing.md),
          _RentalActions(rental: rental, capabilities: caps),
          const SizedBox(height: AppSpacing.sm),
          AppButton(
            label: 'Ver pedido',
            variant: AppButtonVariant.ghost,
            size: AppButtonSize.small,
            onPressed: () => context.push(AppRoutes.orders),
          ),
        ],
      ),
    );
  }
}

/// Desglose del coste: base, extensiones y total.
///
/// Las extensiones se muestran EN SU PROPIA LÍNEA porque son el efecto visible de
/// haber pulsado «Ampliar»: si todo se sumara en un único total, quien pulsara el
/// botón no vería de dónde salió el cambio.
class _CostBreakdown extends StatelessWidget {
  const _CostBreakdown({required this.rental});

  final Rental rental;

  @override
  Widget build(BuildContext context) {
    if (rental.totalMinor <= 0) {
      return Text(
        'El importe se calcula al cerrar el alquiler, a lo que hayas usado de '
        'verdad.',
        style: AppTextStyles.bodySmall
            .copyWith(color: context.tokens.textSecondary),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        if (rental.extensionsMinor > 0) ...<Widget>[
          _CostRow(
            label: 'Tiempo contratado',
            amountMinor: rental.subtotalMinor,
          ),
          _CostRow(
            label: 'Ampliaciones',
            amountMinor: rental.extensionsMinor,
          ),
        ],
        _CostRow(
          label: 'Alquiler hasta ahora',
          amountMinor: rental.totalMinor,
          emphasise: true,
        ),
        if (rental.billedMinutes > 0) ...<Widget>[
          const SizedBox(height: AppSpacing.xxs),
          Text(
            'Facturados: ${DateFormatter.durationLong(Duration(minutes: rental.billedMinutes))}',
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
          ),
        ],
      ],
    );
  }
}

/// Una fila del desglose.
class _CostRow extends StatelessWidget {
  const _CostRow({
    required this.label,
    required this.amountMinor,
    this.emphasise = false,
  });

  final String label;
  final int amountMinor;
  final bool emphasise;

  @override
  Widget build(BuildContext context) {
    final TextStyle style =
        emphasise ? AppTextStyles.titleMedium : AppTextStyles.bodySmall;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: <Widget>[
          Expanded(child: Text(label, style: style)),
          Text(
            CurrencyFormatter.formatMinor(amountMinor),
            style: style.copyWith(
              fontWeight: emphasise ? FontWeight.w700 : FontWeight.w400,
            ),
          ),
        ],
      ),
    );
  }
}

/// Acciones sobre el alquiler en curso: AMPLIAR y TERMINAR.
class _RentalActions extends ConsumerStatefulWidget {
  const _RentalActions({required this.rental, required this.capabilities});

  final Rental rental;
  final ChairCapabilities capabilities;

  @override
  ConsumerState<_RentalActions> createState() => _RentalActionsState();
}

class _RentalActionsState extends ConsumerState<_RentalActions> {
  /// Minutos de la ampliación elegida. 30 es el valor por defecto porque es el
  /// mínimo de cobro del local y el que más se pide.
  int _minutes = 30;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<void> busy = ref.watch(
      rentalActionProvider(widget.rental.id),
    );
    final bool sending = busy.isLoading;
    final Object? error = busy.error;
    final ChairCapabilities caps = widget.capabilities;
    // `canExtend` del modelo: un alquiler ya cerrado no se amplía aunque el permiso
    // exista. Se combinan las dos condiciones.
    final bool canExtend = caps.canExtendRental && widget.rental.canExtend;
    final bool canComplete = caps.canCompleteRental && widget.rental.isLive;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        // --- Ampliar ---------------------------------------------------------
        // El selector solo aparece si la acción es posible. Si no lo es, la razón
        // se explica debajo del botón, que sigue visible y apagado.
        if (canExtend) ...<Widget>[
          const Text('¿Cuánto más quieres?', style: AppTextStyles.titleSmall),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: <Widget>[
              for (final int option in kExtendOptions)
                ChoiceChip(
                  label: Text(
                    DateFormatter.durationLong(Duration(minutes: option)),
                  ),
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
          label: canExtend
              ? 'Ampliar ${DateFormatter.durationLong(Duration(minutes: _minutes))}'
              : 'Ampliar tiempo',
          icon: Icons.more_time_rounded,
          variant: AppButtonVariant.secondary,
          isFullWidth: true,
          isLoading: sending,
          onPressed: canExtend && !sending ? () => _extend(context) : null,
          semanticLabel: canExtend
              ? 'Ampliar mi silla ${DateFormatter.durationLong(Duration(minutes: _minutes))}'
              : 'Ampliar el tiempo de mi silla. No disponible: '
                  '${caps.extendBlockedReason ?? 'el alquiler ya no admite cambios'}',
        ),
        if (!canExtend) _BlockedNote(caps.extendBlockedReason),
        const SizedBox(height: AppSpacing.sm),
        // --- Terminar -------------------------------------------------------
        AppButton(
          label: 'Terminar y pagar en el local',
          icon: Icons.stop_circle_outlined,
          variant: AppButtonVariant.danger,
          isFullWidth: true,
          isLoading: sending,
          onPressed: canComplete && !sending ? () => _complete(context) : null,
          semanticLabel: canComplete
              ? 'Terminar el alquiler de mi silla y pagar en el local'
              : 'Terminar el alquiler de mi silla. No disponible: '
                  '${caps.completeBlockedReason ?? 'el alquiler ya está cerrado'}',
        ),
        if (!canComplete) _BlockedNote(caps.completeBlockedReason),
        if (error != null) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          FormErrorBanner(
            // Los providers de esta feature solo publican `Failure`, pero el
            // `AsyncValue` es genérico: si el tipo cambiara, el banner muestra el
            // texto del error en vez de romperse.
            failure: error is Failure ? error : UnknownFailure(details: '$error'),
            compact: true,
          ),
        ],
      ],
    );
  }

  Future<void> _extend(BuildContext context) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Ampliar $_minutes minutos más?',
      message: 'Se suman a tu cuenta del local, al precio de tu silla. Aquí no se '
          'hace ningún cargo.',
      confirmLabel: 'Ampliar',
      action: DialogAction.confirm,
      icon: Icons.more_time_rounded,
    );
    if (action != DialogAction.confirm || !context.mounted) return;
    final ActionResult result = await ref
        .read(rentalActionProvider(widget.rental.id).notifier)
        .extend(_minutes);
    if (!context.mounted) return;
    _report(context, result, 'Silla ampliada $_minutes minutos.');
  }

  Future<void> _complete(BuildContext context) async {
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Terminar el alquiler?',
      // El backend cobra lo que se ha usado de verdad, con un mínimo de 30 min, y
      // deja la silla en «limpieza». Decirlo ANTES evita la sorpresa en el mostrador.
      message: 'Se cobra el tiempo que hayas usado, con un mínimo de 30 minutos. '
          'Pagas en el local y la silla queda lista para el siguiente.',
      confirmLabel: 'Terminar',
      action: DialogAction.cancel,
      icon: Icons.stop_circle_outlined,
    );
    if (action != DialogAction.confirm || !context.mounted) return;
    final ActionResult result = await ref
        .read(rentalActionProvider(widget.rental.id).notifier)
        .complete();
    if (!context.mounted) return;
    _report(context, result, 'Alquiler cerrado. Se paga en el mostrador.');
  }

  /// Aviso breve para los desenlaces que no se leen en el banner.
  void _report(BuildContext context, ActionResult result, String success) {
    final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
    switch (result.outcome) {
      case ActionOutcome.done:
        messenger
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(success)));
      case ActionOutcome.conflict:
        // `409`: alguien se adelantó. El controlador ya refrescó el mapa.
        messenger
          ..hideCurrentSnackBar()
          ..showSnackBar(
            const SnackBar(
              content: Text('La silla cambió mientras tanto. Ya está actualizado.'),
            ),
          );
      // `forbidden` y `failed` se leen en el banner: son fallos que necesitan más de
      // dos segundos en pantalla.
      case ActionOutcome.forbidden:
      case ActionOutcome.failed:
        break;
    }
  }
}

/// Minutos de ampliación que se ofrecen.
///
/// El backend admite de 5 a 1440 (API.md §7.9); estos son los tres valores que la
/// gente pide de verdad. La lista es la misma que usa `features/orders`, y vive aquí
/// duplicada a propósito: importarla de otra feature para cuatro enteros costaría más
/// que mantenerla, y esta tarjeta se monta en un contexto distinto (la pestaña
/// «Silla», no el detalle del pedido).
const List<int> kExtendOptions = <int>[30, 60, 120];

/// Motivo por el que una acción está apagada.
///
/// Se pinta SIEMPRE debajo del botón y no en un `Tooltip`: el motivo tiene que estar
/// a la vista para quien no va a descubrir tooltips con el dedo ni con un lector de
/// pantalla.
class _BlockedNote extends StatelessWidget {
  const _BlockedNote(this.reason);

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
