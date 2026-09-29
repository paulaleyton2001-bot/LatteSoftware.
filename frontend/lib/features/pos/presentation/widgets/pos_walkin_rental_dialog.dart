// Reserva walk-in del mostrador. MÓDULO `pos/presentation/widgets`.
//
// POR QUÉ ESTO EXISTE
// `type = CHAIR_RENTAL` exige `chairId` Y `reservationId` en `POST /orders`
// (API.md §7.12). Sin reserva, el backend responde
// `422 RENTAL_REQUIRES_CHAIR_AND_RESERVATION`. O sea: un cliente que se sienta sin
// reserva no se puede cobrar por esta vía.
//
// EL CAMINO REAL ES `POST /rentals`
// El backend tiene un endpoint de alquiler WALK-IN para eso: abre el alquiler,
// pone la silla en `OCCUPIED`, congela el precio por hora y **materializa el pedido
// `CHAIR_RENTAL` en `PENDING` con el total ya calculado**. Es exactamente lo que
// necesita el mostrador, y es una llamada en vez de tres.
//
// POR QUÉ EL DIÁLOGO ES DE DURACIÓN FIJA
// `POST /rentals` no acepta fechas: usa `now` y `plannedMinutes`. Por eso el cajero
// elige cuántos minutos, no un rango. Si el cliente se queda más, la extensión
// posterior (`POST /rentals/:id/extend`) cobra la diferencia al precio CONGELADO.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/price_display.dart';

/// Diálogo para abrir un alquiler walk-in sobre una silla.
class PosWalkInRentalDialog extends StatefulWidget {
  const PosWalkInRentalDialog({required this.chair, super.key});

  final ChairInfo chair;

  /// Devuelve los minutos elegidos, o `null` si el cajero cancela.
  static Future<int?> show(BuildContext context, ChairInfo chair) =>
      showModalBottomSheet<int>(
        context: context,
        showDragHandle: true,
        builder: (BuildContext sheetContext) =>
            PosWalkInRentalDialog(chair: chair),
      );

  @override
  State<PosWalkInRentalDialog> createState() => _PosWalkInRentalDialogState();
}

class _PosWalkInRentalDialogState extends State<PosWalkInRentalDialog> {
  /// Duraciones habituales, en MINUTOS. Coinciden con las que se ofrecen en el
  /// alquiler: son múltiplos de 30 y cubren de una hora a media jornada.
  static const List<int> _presets = <int>[30, 60, 90, 120, 180, 240];
  int _minutes = 60;

  @override
  Widget build(BuildContext context) {
    final int pricePerHour = widget.chair.pricePerHourMinor;
    // Proyección del coste: `precio/hora × minutos/60`, redondeado a centavo. Es
    // una AYUDA para el cajero, no el total: el cobro lo calcula el servidor con
    // el mínimo de 30 minutos y el precio congelado (BR-RENTAL-001/003).
    final int estimate = (pricePerHour * _minutes / 60).round();

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg,
          AppSpacing.sm,
          AppSpacing.lg,
          AppSpacing.xl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Semantics(
              header: true,
              child: Text(
                'Abrir alquiler en ${widget.chair.cellLabel}',
                style: AppTextStyles.titleLarge,
              ),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Se cobra al cerrar el alquiler, con el precio congelado de ahora: '
              '${CurrencyFormatter.formatMinor(pricePerHour)} por hora.',
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
            const SizedBox(height: AppSpacing.lg),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: <Widget>[
                for (final int minutes in _presets)
                  _MinutesChip(
                    minutes: minutes,
                    selected: minutes == _minutes,
                    onTap: () => setState(() => _minutes = minutes),
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
            Container(
              padding: const EdgeInsets.all(AppSpacing.lg),
              decoration: BoxDecoration(
                color: context.tokens.surfaceMuted,
                borderRadius: BorderRadius.circular(AppRadii.md),
              ),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          '$_minutes min · hasta las '
                          '${DateFormatter.time(DateTime.now().add(Duration(minutes: _minutes)))}',
                          style: AppTextStyles.titleSmall,
                        ),
                        Text(
                          'Coste estimado',
                          style: AppTextStyles.captionSmall
                              .copyWith(color: context.tokens.textTertiary),
                        ),
                      ],
                    ),
                  ),
                  PriceDisplay(currentMinor: estimate, variant: PriceVariant.large),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            AppButton(
              label: 'Abrir alquiler',
              icon: Icons.meeting_room_rounded,
              variant: AppButtonVariant.espresso,
              size: AppButtonSize.large,
              isFullWidth: true,
              onPressed: () => Navigator.of(context).pop(_minutes),
              tooltip: 'Crea el alquiler y su pedido pendiente de cobro',
            ),
          ],
        ),
      ),
    );
  }
}

/// Chip de duración. 44 dp de alto y `Semantics(selected:)`.
class _MinutesChip extends StatelessWidget {
  const _MinutesChip({
    required this.minutes,
    required this.selected,
    required this.onTap,
  });

  final int minutes;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color foreground =
        selected ? context.tokens.textSuccess : context.tokens.textSecondary;
    return Semantics(
      button: true,
      selected: selected,
      label: '$minutes minutos',
      excludeSemantics: true,
      child: Material(
        color: selected ? context.tokens.surfaceGreenSubtle : context.tokens.surface,
        borderRadius: BorderRadius.circular(AppRadii.pill),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(AppRadii.pill),
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadii.pill),
              border: Border.all(
                color: selected ? context.tokens.brandDark : context.tokens.borderDefault,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (selected) ...<Widget>[
                  Icon(Icons.check_rounded,
                      size: 16, color: context.tokens.actionPrimary),
                  const SizedBox(width: AppSpacing.xs),
                ],
                Text(
                  '$minutes min',
                  style: AppTextStyles.labelLarge.copyWith(color: foreground),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
