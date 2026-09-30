// Formulario de reserva de una silla. Módulo `features/chair/presentation/widgets`.
//
// EL PRECIO NUNCA SE CALCULA AQUÍ
// -------------------------------
// Todo importe que se ve sale de `GET /reservations/quote` (BR-PRICE-008). El
// precio por hora de la silla se enseña como TASA, no como total, y el total es el
// que devuelve el servidor, con el mínimo de 30 min y el impuesto ya aplicados. Es
// exactamente lo que se cobra, porque quien calcula el total en el móvil es la
// razón habitual de que la caja y la app no cuadren.
//
// LA COTIZACIÓN SE VE ANTES DE CONFIRMAR
// El botón dice el importe: «Reservar por $7.140». Quien va a pagar tiene que ver la
// cifra en el botón, no debajo de él, ni después de confirmar.
//
// TODOS LOS ESTADOS, NINGUNA PANTALLA EN BLANCO
//   cargando  → el esqueleto de la fila de total, con el texto «Calculando…»
//   error     → `FormErrorBanner` con el motivo traducido y botón de reintento
//   conflicto → la misma franja, con el aviso de que hay otra reserva encima
//   enviado   → el botón en `isLoading` y bloqueado
//   creado    → tarjeta con el código de la reserva
//
// ACCESIBILIDAD
//   - Cada chip es un botón con `Semantics(selected:)`, no solo color.
//   - Los totales van en una lista con `Semantics(header:)` en el rótulo.
//   - El resultado del envío se anuncia con `liveRegion`, para que un lector de
//     pantalla diga el código en vez de dejar a la persona buscándolo.

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/confirm_dialog.dart';
import '../../../../shared/widgets/ui/form_error_banner.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/chair_booking.dart';
import '../../domain/entities/chair_capabilities.dart';
import '../chair_booking_controller.dart';
import '../chair_booking_state.dart';
import '../chair_controller.dart';

/// Formulario de reserva. Se embebe en el panel de la silla.
class ChairReserveForm extends ConsumerStatefulWidget {
  const ChairReserveForm({required this.chairId, super.key});

  final int chairId;

  @override
  ConsumerState<ChairReserveForm> createState() => _ChairReserveFormState();
}

class _ChairReserveFormState extends ConsumerState<ChairReserveForm> {
  late final TextEditingController _customMinutes = TextEditingController();
  bool _customFieldShown = false;

  @override
  void dispose() {
    // El `TextEditingController` es de ESTE widget: si no se libera, el `TextField`
    // que lo usa sigue registrado en el árbol al cerrar el panel y cada apertura
    // deja uno más. `dispose` es el sitio; no hay `ref.onDispose` que valga aquí
    // porque esto no es un provider.
    _customMinutes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<ChairBookingState> booking = ref.watch(
      chairBookingProvider(widget.chairId),
    );
    final ChairBookingController controller = ref.read(
      chairBookingProvider(widget.chairId).notifier,
    );
    final ChairCapabilities capabilities = ref.watch(chairCapabilitiesProvider);

    return booking.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(AppSpacing.lg),
        child: Center(child: CircularProgressIndicator()),
      ),
      error: (Object error, StackTrace _) => _BookingLoadError(
        message: '$error',
        onRetry: () => ref.invalidate(chairBookingProvider(widget.chairId)),
      ),
      data: (ChairBookingState state) {
        if (state.stage == ChairBookingStage.done) {
          return _BookingDone(
            state: state,
            capabilities: capabilities,
            controller: controller,
            onAnother: controller.startAnother,
            onClose: () => Navigator.of(context).maybePop(),
          );
        }
        return _BookingEditor(
          chairId: widget.chairId,
          state: state,
          controller: controller,
          customMinutes: _customMinutes,
          customFieldShown: _customFieldShown,
          onToggleCustom: () {
            setState(() {
              _customFieldShown = !_customFieldShown;
              if (!_customFieldShown) {
                _customMinutes.clear();
                controller.selectCustomDuration(null);
              }
            });
          },
          onCustomChanged: controller.selectCustomDuration,
        );
      },
    );
  }
}

/// Formulario en modo edición.
class _BookingEditor extends StatelessWidget {
  const _BookingEditor({
    required this.chairId,
    required this.state,
    required this.controller,
    required this.customMinutes,
    required this.customFieldShown,
    required this.onToggleCustom,
    required this.onCustomChanged,
  });

  /// Id de la silla que se está reservando. Viaja hasta el bloque de cotización para
  /// que el reintento sepa a qué provider pertenece.
  final int chairId;

  final ChairBookingState state;
  final ChairBookingController controller;
  final TextEditingController customMinutes;
  final bool customFieldShown;
  final VoidCallback onToggleCustom;
  final ValueChanged<int?> onCustomChanged;

  @override
  Widget build(BuildContext context) {
    final DateTime localStart = DateFormatter.toLocal(state.startAt);
    final List<DateTime> days = bookingDayChoices();
    final List<DateTime> times = bookingTimeChoices(
      DateTime(localStart.year, localStart.month, localStart.day),
    );

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const _SectionLabel('¿Qué día?'),
        _DayChips(
          days: days,
          selected: DateTime(localStart.year, localStart.month, localStart.day),
          onSelect: controller.selectDay,
        ),
        const SizedBox(height: AppSpacing.md),
        const _SectionLabel('¿A qué hora?'),
        _TimeChips(
          times: times,
          selected: localStart,
          onSelect: controller.selectTime,
        ),
        const SizedBox(height: AppSpacing.md),
        const _SectionLabel('¿Cuánto tiempo?'),
        _DurationChips(
          state: state,
          onSelect: controller.selectDuration,
          onToggleCustom: onToggleCustom,
        ),
        if (customFieldShown) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          AppTextField(
            controller: customMinutes,
            label: 'Otro tiempo (minutos)',
            hint: '90',
            textInputType: TextInputType.number,
            inputFormatters: <TextInputFormatter>[
              FilteringTextInputFormatter.digitsOnly,
              LengthLimitingTextInputFormatter(4),
            ],
            helperText: 'Entre 15 y 480 minutos. El mínimo de cobro son 30.',
            onChanged: (String value) =>
                onCustomChanged(int.tryParse(value)),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        _QuoteBlock(state: state, chairId: chairId),
        // EL FALLO DEL ENVÍO, QUE ANTES NO SE PINTABA NUNCA
        // `ChairBookingController` lo guardaba en un `_lastFailure` PRIVADO que
        // ningún widget leía, así que un `409 CHAIR_ALREADY_RESERVED` al pulsar
        // «Reservar» no pintaba absolutamente nada: el botón volvía a su estado y
        // no pasaba nada. Ahora vive en el estado y se pinta aquí, con el motivo
        // traducido al español que puede hacer algo con él.
        if (state.failure != null) ...<Widget>[
          const SizedBox(height: AppSpacing.md),
          FormErrorBanner(
            failure: explainBookingFailure(state.failure!),            title: 'No pudimos crear la reserva',
            compact: true,
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        _SubmitButton(state: state, controller: controller),
        if (state.blockedReason != null && !state.quoteSaysUnavailable) ...<Widget>[
          const SizedBox(height: AppSpacing.sm),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                Icons.info_outline_rounded,
                size: 16,
                color: context.tokens.textSecondary,
              ),
              const SizedBox(width: AppSpacing.xs),
              Expanded(
                child: Text(
                  state.blockedReason!,
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: AppSpacing.sm),
        const _PayAtStoreNote(),
      ],
    );
  }
}

/// Rótulo de sección. `Semantics(header:)` para que un lector de pantalla pueda
/// saltar entre bloques.
class _SectionLabel extends StatelessWidget {
  const _SectionLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Semantics(
        header: true,
        child: Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.xs),
          child: Text(text, style: AppTextStyles.titleSmall),
        ),
      );
}

/// Chips de día.
class _DayChips extends StatelessWidget {
  const _DayChips({
    required this.days,
    required this.selected,
    required this.onSelect,
  });

  final List<DateTime> days;
  final DateTime selected;
  final ValueChanged<DateTime> onSelect;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      child: Row(
        children: <Widget>[
          for (final DateTime day in days) ...<Widget>[
            _SelectChip(
              label: _dayLabel(day),
              selected: _sameDay(day, selected),
              onTap: () => onSelect(day),
            ),
            const SizedBox(width: AppSpacing.sm),
          ],
        ],
      ),
    );
  }

  /// `Hoy`, `Mañana`, `mié 01`. Los dos primeros en palabras y el resto con la
  /// fecha corta: es lo que la gente dice de viva voz.
  static String _dayLabel(DateTime day) {
    final DateTime today = DateTime.now();
    if (_sameDay(day, today)) return 'Hoy';
    if (_sameDay(day, today.add(const Duration(days: 1)))) return 'Mañana';
    return DateFormatter.dayMonth(day.toUtc());
  }

  static bool _sameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;
}

/// Chips de hora de inicio.
class _TimeChips extends StatelessWidget {
  const _TimeChips({
    required this.times,
    required this.selected,
    required this.onSelect,
  });

  final List<DateTime> times;
  final DateTime selected;
  final ValueChanged<DateTime> onSelect;

  @override
  Widget build(BuildContext context) {
    if (times.isEmpty) {
      return Text(
        'No quedan horas libres hoy para reservar. Elige otro día.',
        style: AppTextStyles.bodySmall
            .copyWith(color: context.tokens.textSecondary),
      );
    }
    return SizedBox(
      height: 48,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: times.length,
        separatorBuilder: (BuildContext context, int index) =>
            const SizedBox(width: AppSpacing.sm),
        itemBuilder: (BuildContext context, int index) {
          final DateTime time = times[index];
          return _SelectChip(
            label: DateFormatter.time(time.toUtc()),
            selected: time.hour == selected.hour && time.minute == selected.minute,
            onTap: () => onSelect(time),
          );
        },
      ),
    );
  }
}

/// Chips de duración, con la opción de escribirla a mano.
class _DurationChips extends StatelessWidget {
  const _DurationChips({
    required this.state,
    required this.onSelect,
    required this.onToggleCustom,
  });

  final ChairBookingState state;
  final ValueChanged<int> onSelect;
  final VoidCallback onToggleCustom;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: <Widget>[
        for (final int minutes in kChairDurationPresets) ...<Widget>[
          _SelectChip(
            label: chairDurationLabel(minutes),
            selected: !state.isCustomDuration && state.effectiveMinutes == minutes,
            onTap: () => onSelect(minutes),
          ),
        ],
        _SelectChip(
          label: 'Otro',
          icon: Icons.tune_rounded,
          selected: state.isCustomDuration,
          onTap: onToggleCustom,
        ),
      ],
    );
  }
}

/// Chip seleccionable. Se reutiliza para día, hora y duración, así que el patrón de
/// pulsación y el de semántica están escritos UNA vez.
class _SelectChip extends StatelessWidget {
  const _SelectChip({
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final Color accent =
        selected ? context.tokens.actionPrimary : context.tokens.textSecondary;

    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: selected
            ? Theme.of(context).colorScheme.primaryContainer
            : Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48, minWidth: 64),
            padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.lg,
              vertical: AppSpacing.sm,
            ),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: selected
                    ? Theme.of(context).colorScheme.primary
                    : context.tokens.borderDefault,
                width: selected ? 2 : 1,
              ),
            ),
            // El check además del color y del texto: con ~8 % de hombres con
            // daltonismo rojo/verde, el borde solo no basta (DESIGN-TOKENS §6.1).
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (selected) ...<Widget>[
                  Icon(Icons.check_rounded, size: 16, color: accent),
                  const SizedBox(width: AppSpacing.xs),
                ],
                if (icon != null) ...<Widget>[
                  Icon(icon, size: 16, color: accent),
                  const SizedBox(width: AppSpacing.xs),
                ],
                Text(label, style: AppTextStyles.labelLarge),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Bloque de cotización: estados de carga, error, conflicto y éxito.
class _QuoteBlock extends ConsumerWidget {
  const _QuoteBlock({required this.state, required this.chairId});

  final ChairBookingState state;
  final int chairId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ChairBookingQuote> quote = state.quote;

    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: context.tokens.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
      ),
      child: quote.when(
        loading: () => const _QuoteSkeleton(),
        error: (Object error, StackTrace _) => _QuoteError(
          // El repositorio publica `Failure` en el `AsyncValue`; si algún día
          // llegara otra cosa, se muestra como fallo desconocido en vez de romper
          // el banner.
          failure: error is Failure
              ? error
              : UnknownFailure(details: '$error'),
          // El reintento pide la MISMA cotización otra vez: el fallo suele ser de
          // red, y la franja no ha cambiado, así que no hace falta recargar todo.
          onRetry: () =>
              ref.read(chairBookingProvider(chairId).notifier).refreshQuote(),
        ),
        data: (ChairBookingQuote data) => _QuoteTotals(quote: data, state: state),
      ),
    );
  }
}

/// Marcador de "calculando": conserva la altura para que el panel no dé un salto
/// cuando llega el número.
class _QuoteSkeleton extends StatelessWidget {
  const _QuoteSkeleton();

  @override
  Widget build(BuildContext context) => Semantics(
        liveRegion: true,
        label: 'Calculando el precio',
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(
              'Calculando el precio…',
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            for (int i = 0; i < 3; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: AppSpacing.xs),
                child: Container(
                  height: 14,
                  width: i == 2 ? 120 : double.infinity,
                  decoration: BoxDecoration(
                    color: context.tokens.surfaceSunken,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
              ),
          ],
        ),
      );
}

/// Error de cotización con su motivo traducido y reintento.
class _QuoteError extends StatelessWidget {
  const _QuoteError({required this.failure, required this.onRetry});

  /// Ya normalizado: quien lo construye se encarga de convertir lo que llegue.
  final Failure failure;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => FormErrorBanner(
        failure: failure,
        title: 'No pudimos calcular el precio',
        onRetry: onRetry,
        compact: true,
      );
}

/// Desglose de la cotización con el total destacado.
class _QuoteTotals extends StatelessWidget {
  const _QuoteTotals({required this.quote, required this.state});

  final ChairBookingQuote quote;
  final ChairBookingState state;

  @override
  Widget build(BuildContext context) {
    // Conflicto: hay otra reserva encima de esa franja. Se explica y NO se ofrece
    // confirmar, porque el `POST` solo devolvería `409`.
    if (!quote.isAvailable) {
      return Semantics(
        liveRegion: true,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Icon(
              Icons.event_busy_rounded,
              size: 20,
              color: context.tokens.textWarning,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                quote.unavailableReason!,
                style: AppTextStyles.bodyMedium
                    .copyWith(color: context.tokens.textWarning),
              ),
            ),
          ],
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Semantics(
          liveRegion: true,
          label: 'Precio: ${CurrencyFormatter.formatMinor(quote.totalMinor)} '
              'por ${chairDurationLabel(state.effectiveMinutes)}',
          excludeSemantics: true,
          child: Text(
            quote.describeRate(),
            style: AppTextStyles.bodyMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
        ),
        if (quote.minimumApplied) ...<Widget>[
          const SizedBox(height: AppSpacing.xxs),
          Text(
            'Mínimo de 30 min aplicado',
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textSecondary),
          ),
        ],
        const SizedBox(height: AppSpacing.sm),
        _TotalRow(label: 'Subtotal', amountMinor: quote.subtotalMinor),
        if (quote.taxMinor > 0)
          _TotalRow(
            label: 'Impuestos',
            amountMinor: quote.taxMinor,
          ),
        if (quote.serviceFeeMinor > 0)
          _TotalRow(label: 'Servicio', amountMinor: quote.serviceFeeMinor),
        if (quote.discountMinor > 0)
          _TotalRow(label: 'Descuento', amountMinor: -quote.discountMinor),
        const Padding(
          padding: EdgeInsets.symmetric(vertical: AppSpacing.xs),
          child: Divider(height: 1),
        ),
        _TotalRow(
          label: 'Total',
          amountMinor: quote.totalMinor,
          emphasise: true,
        ),
      ],
    );
  }
}

/// Una fila del desglose.
class _TotalRow extends StatelessWidget {
  const _TotalRow({
    required this.label,
    required this.amountMinor,
    this.emphasise = false,
  });

  final String label;
  final int amountMinor;
  final bool emphasise;

  @override
  Widget build(BuildContext context) {
    final TextStyle style = emphasise
        ? AppTextStyles.titleMedium
        : AppTextStyles.bodySmall;
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

/// Botón de confirmar, con el importe en la propia etiqueta.
class _SubmitButton extends StatelessWidget {
  const _SubmitButton({required this.state, required this.controller});

  final ChairBookingState state;
  final ChairBookingController controller;

  @override
  Widget build(BuildContext context) {
    final bool busy = state.stage == ChairBookingStage.submitting;
    final ChairBookingQuote? quote = state.quote.valueOrNull;
    final bool canConfirm = state.canSubmit &&
        state.quote.hasValue &&
        (quote?.isAvailable ?? false);

    // El importe va EN el botón: es lo que la persona va a pagar y tiene que poder
    // leerlo sin apartar la vista del objetivo del toque.
    final String label = busy
        ? 'Reservando…'
        : quote != null && quote.totalMinor > 0
            ? 'Reservar por ${CurrencyFormatter.formatMinor(quote.totalMinor)}'
            : 'Reservar';

    return AppButton(
      label: label,
      icon: Icons.event_available_rounded,
      variant: AppButtonVariant.espresso,
      isFullWidth: true,
      isLoading: busy,
      onPressed: canConfirm ? controller.submit : null,
      semanticLabel: canConfirm
          ? 'Confirmar la reserva por ${CurrencyFormatter.formatMinor(quote!.totalMinor)}'
          : 'Confirmar la reserva. No disponible todavía.',
    );
  }
}

/// Aviso de que el pago es en el local.
class _PayAtStoreNote extends StatelessWidget {
  const _PayAtStoreNote();

  @override
  Widget build(BuildContext context) => Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(
            Icons.storefront_outlined,
            size: 16,
            color: context.tokens.textTertiary,
          ),
          const SizedBox(width: AppSpacing.xs),
          Expanded(
            child: Text(
              'Se paga en el local al terminar. La app no cobra nada.',
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textTertiary),
            ),
          ),
        ],
      );
}

/// Estado final: la reserva existe.
///
/// TRES COSAS QUE ANTES FALTABAN Y QUE SON EL FIN DEL FLUJO
/// 1. **El código.** Sin `RES-900010` quien acaba de reservar no tiene nada que
///    decir en el mostrador ni con qué encontrar la reserva. Antes el estado solo
///    guardaba un `bool created` y el código se perdía.
/// 2. **Confirmar.** `POST /reservations` deja la reserva en `PENDING` y una
///    `PENDING` NO aparta la silla (verificado: `GET /chairs/:id` sigue en
///    `AVAILABLE`). El permiso `reservations:update` lo tiene el `CUSTOMER`
///    (`POST /reservations/6/confirm` → `200`), así que confirmar desde aquí es
///    legal y es lo que convierte la reserva en algo que de verdad sujeta la silla.
/// 3. **Cancelar.** `reservations:cancel` también lo tiene el `CUSTOMER`, y una
///    reserva que se puede crear pero no deshacer desde el mismo sitio donde se
///    creó es un callejón sin salida.
class _BookingDone extends ConsumerStatefulWidget {
  const _BookingDone({
    required this.state,
    required this.capabilities,
    required this.controller,
    required this.onAnother,
    required this.onClose,
  });

  final ChairBookingState state;
  final ChairCapabilities capabilities;
  final ChairBookingController controller;
  final Future<void> Function() onAnother;
  final VoidCallback onClose;

  @override
  ConsumerState<_BookingDone> createState() => _BookingDoneState();
}

class _BookingDoneState extends ConsumerState<_BookingDone> {
  bool _working = false;

  ChairBookingState get _state => widget.state;

  ChairBooking? get _booking => _state.booking;

  @override
  Widget build(BuildContext context) {
    final ChairBooking? booking = _booking;
    if (booking == null) {
      // Estado imposible: `done` sin reserva. Se muestra el editor para que la
      // pantalla nunca se quede en un hueco sin explicación.
      return Text(
        'No pudimos leer la reserva que acabas de crear. Cierra y vuelve a abrir '
        'la silla para intentarlo de nuevo.',
        style: AppTextStyles.bodySmall
            .copyWith(color: context.tokens.textSecondary),
      );
    }

    final bool pending = booking.isPending;
    final bool cancelled = booking.status == 'CANCELLED';
    final bool canConfirm = pending &&
        widget.capabilities.canConfirmReservation &&
        !_working;
    final bool canCancel = booking.isOpen &&
        widget.capabilities.canCancelReservation &&
        !_working;

    return Semantics(
      liveRegion: true,
      container: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Icon(
                cancelled
                    ? Icons.event_busy_rounded
                    : Icons.check_circle_rounded,
                color: cancelled
                    ? context.tokens.textWarning
                    : context.tokens.textSuccess,
                size: 28,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  cancelled ? 'Reserva cancelada' : 'Reserva creada',
                  style: AppTextStyles.titleMedium.copyWith(
                    color: cancelled
                        ? context.tokens.textWarning
                        : context.tokens.textSuccess,
                  ),
                ),
              ),
              StatusBadge.reservation(booking.status, compact: true),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          // ── El código, que es lo que se dice en el mostrador ──────────────
          Semantics(
            label: 'Código de la reserva: ${booking.code}',
            excludeSemantics: true,
            child: Container(
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: context.tokens.surfaceMuted,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          'Tu código de reserva',
                          style: AppTextStyles.captionSmall
                              .copyWith(color: context.tokens.textSecondary),
                        ),
                        const SizedBox(height: AppSpacing.xxs),
                        Text(booking.code, style: AppTextStyles.titleLarge),
                      ],
                    ),
                  ),
                  if (booking.chairCode != null)
                    Text(
                      booking.chairCode!,
                      style: AppTextStyles.titleMedium
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          _TotalRow(
            label: 'Importe de la franja',
            amountMinor: _state.quote.valueOrNull?.totalMinor ??
                booking.rentalTotalMinor,
          ),
          const SizedBox(height: AppSpacing.xxs),
          Text(
            DateFormatter.range(_state.startAt, _state.endAt),
            style: AppTextStyles.bodySmall
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          // ── El aviso que corresponde al estado REAL ────────────────────────
          // Se dice exactamente lo que es verdad. Con `PENDING` la silla NO está
          // apartada: lo dice el texto, y el botón de confirmar está justo debajo.
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Icon(
                cancelled
                    ? Icons.info_outline_rounded
                    : pending
                        ? Icons.pending_actions_rounded
                        : Icons.verified_rounded,
                size: 18,
                color: pending
                    ? context.tokens.textWarning
                    : context.tokens.textSuccess,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  _explanation(cancelled: cancelled, pending: pending),
                  style: AppTextStyles.captionMedium.copyWith(
                    color: pending
                        ? context.tokens.textWarning
                        : context.tokens.textSuccess,
                  ),
                ),
              ),
            ],
          ),
          if (_state.failure != null) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            FormErrorBanner(
              failure: explainBookingFailure(_state.failure!),
              title: 'No pudimos completar la operación',
              compact: true,
            ),
          ],
          // ── Acciones ─────────────────────────────────────────────────────
          if (!cancelled) ...<Widget>[
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: pending ? 'Confirmar mi reserva' : 'Reserva confirmada',
              icon: pending
                  ? Icons.verified_rounded
                  : Icons.check_circle_outline_rounded,
              variant: AppButtonVariant.espresso,
              isFullWidth: true,
              isLoading: _working,
              onPressed: canConfirm ? _confirm : null,
              semanticLabel: canConfirm
                  ? 'Confirmar la reserva ${booking.code} y apartar la silla'
                  : pending
                      ? 'Confirmar la reserva. No disponible: '
                          '${widget.capabilities.confirmReservationBlockedReason ?? ''}'
                      : 'La reserva ya está confirmada',
            ),
            if (pending && !widget.capabilities.canConfirmReservation)
              _BlockedNote(
                widget.capabilities.confirmReservationBlockedReason,
              ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: <Widget>[
                Expanded(
                  child: AppButton(
                    label: 'Reservar otra',
                    variant: AppButtonVariant.secondary,
                    onPressed: _working ? null : () => widget.onAnother(),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: AppButton(
                    label: 'Listo',
                    variant: AppButtonVariant.primary,
                    onPressed: _working ? null : widget.onClose,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            AppButton(
              label: 'Cancelar esta reserva',
              icon: Icons.delete_outline_rounded,
              variant: AppButtonVariant.ghost,
              size: AppButtonSize.small,
              isFullWidth: true,
              onPressed: canCancel ? _cancel : null,
              semanticLabel: canCancel
                  ? 'Cancelar la reserva ${booking.code}'
                  : 'Cancelar la reserva. No disponible para tu cuenta.',
            ),
            if (!widget.capabilities.canCancelReservation)
              const _BlockedNote(
                'Cancelar una reserva («reservations:cancel») no está en tu cuenta.',
              ),
          ] else ...<Widget>[
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Listo',
              variant: AppButtonVariant.espresso,
              isFullWidth: true,
              onPressed: widget.onClose,
            ),
          ],
        ],
      ),
    );
  }

  /// Lo que se dice depende del estado REAL de la reserva.
  static String _explanation({required bool cancelled, required bool pending}) {
    if (cancelled) {
      return 'La silla vuelve a estar libre. Puedes reservar otra cuando quieras.';
    }
    if (pending) {
      return 'Todavía no está confirmada: mientras no la confirmes, la silla puede '
          'ocuparla alguien. Confírmala ahora y te la guardamos.';
    }
    return 'La silla ya está apartada para ti. Te avisamos cuando se acerque tu hora.';
  }

  Future<void> _confirm() async {
    setState(() => _working = true);
    final bool ok = await widget.controller.confirm();
    if (!mounted) return;
    setState(() => _working = false);
    if (!ok) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(content: Text('Reserva confirmada. La silla es tuya.')),
      );
  }

  Future<void> _cancel() async {
    final ChairBooking? booking = _booking;
    if (booking == null) return;
    final DialogAction action = await ConfirmDialog.show(
      context,
      title: '¿Cancelar la reserva ${booking.code}?',
      message: 'La silla vuelve a estar libre para cualquiera. Si lo que querías '
          'era cambiarla de hora, cancela y reserva otra.',
      confirmLabel: 'Cancelar reserva',
      action: DialogAction.cancel,
      icon: Icons.delete_outline_rounded,
    );
    if (action != DialogAction.confirm || !mounted) return;
    setState(() => _working = true);
    // El motivo es obligatorio en el backend (`400` sin él) y es lo que verá el
    // personal: se manda uno legible, no un código.
    final bool ok = await widget.controller.cancel(
      reason: 'Cancelada por el cliente desde la app',
    );
    if (!mounted) return;
    setState(() => _working = false);
    if (!ok) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(content: Text('Reserva cancelada. La silla está libre.')),
      );
  }
}

/// Motivo por el que una acción está apagada. Se pinta debajo del botón, nunca en
/// un `Tooltip`: el motivo tiene que estar a la vista.
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

/// Fallo al cargar el estado inicial del formulario.
class _BookingLoadError extends StatelessWidget {
  const _BookingLoadError({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => FormErrorBanner(
        failure: UnknownFailure(details: message),
        title: 'No pudimos abrir la reserva',
        onRetry: onRetry,
      );
}
