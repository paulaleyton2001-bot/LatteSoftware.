// Panel de detalle de la silla seleccionada.
//
// MUESTRA, EN ESTE ORDEN Y CON ESTA FUENTE
//   1. Estado actual (`StatusBadge.chair`): texto + ícono + color.
//   2. Precio por hora (`PriceDisplay.costPerUnit`).
//   3. Si está ocupada: hasta cuándo, y de quién. `GET /chairs/map` NO trae esa
//      información, así que se pide `GET /chairs/:id`, que sí trae
//      `currentReservation` y `currentRental`.
//   4. Características de la silla (`wifi`, `outlet`, `view`…).
//
// SOBRE «QUIÉN» OCUPA LA SILLA
// `GET /chairs/:id` devuelve la reserva y el alquiler SIN el nombre del cliente, y
// un `CUSTOMER` no tiene por qué saberlo: no es información que necesite para
// elegir hora. Se dice "otro cliente" y se da lo que sí sirve (hasta cuándo), que
// es lo que le permite elegir otra franja. Inventar un nombre o suponerlo sería
// peor que no decirlo.
//
// RESPONSIVE
// En móvil es una tarjeta apilada bajo el mapa; en desktop, un panel fijo a la
// derecha (docs/DESIGN-TOKENS §5). El mismo widget sirve para los dos: lo que
// cambia es dónde lo coloca la pantalla.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/loading_state.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/repositories/checkout_repository.dart';
import '../checkout_controller.dart';
import '../checkout_state.dart';

/// Detalle de la silla seleccionada.
class ChairDetailPanel extends ConsumerWidget {
  const ChairDetailPanel({required this.chair, super.key});

  final ChairInfo chair;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CheckoutState state = ref.watch(checkoutProvider);
    final ChairOccupancy? occupancy = state.occupancy;

    return Semantics(
      container: true,
      label: 'Detalle de la silla ${chair.cellLabel}',
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(chair.cellLabel, style: AppTextStyles.titleLarge),
                      if (chair.zoneName != null)
                        Text(
                          chair.zoneName!,
                          style: AppTextStyles.captionMedium
                              .copyWith(color: context.tokens.textSecondary),
                        ),
                    ],
                  ),
                ),
                StatusBadge.chair(chair.status),
              ],
            ),
            const SizedBox(height: AppSpacing.md),
            PriceDisplay(
              currentMinor: chair.pricePerHourMinor,
              variant: PriceVariant.costPerUnit,
              unitLabel: 'hora',
            ),
            if (chair.capacity > 1) ...<Widget>[
              const SizedBox(height: AppSpacing.xs),
              Text(
                'Capacidad: ${chair.capacity} personas',
                style: AppTextStyles.bodySmall
                    .copyWith(color: context.tokens.textSecondary),
              ),
            ],
            if (chair.features.isNotEmpty) ...<Widget>[
              const SizedBox(height: AppSpacing.md),
              Wrap(
                spacing: AppSpacing.xs,
                runSpacing: AppSpacing.xs,
                children: <Widget>[
                  for (final String feature in chair.features)
                    _FeatureChip(feature: feature),
                ],
              ),
            ],
            if (!chair.isBookable) ...<Widget>[
              const SizedBox(height: AppSpacing.md),
              _Note(
                icon: Icons.block_rounded,
                text: 'Esta silla no admite reservas. Elige otra.',
                color: context.tokens.textError,
                background: context.tokens.surfaceErrorSubtle,
              ),
            ],
            const SizedBox(height: AppSpacing.md),
            _OccupancyBlock(chair: chair, occupancy: occupancy),
          ],
        ),
      ),
    );
  }
}

/// Bloque de ocupación: hasta cuándo y quién.
class _OccupancyBlock extends ConsumerWidget {
  const _OccupancyBlock({required this.chair, required this.occupancy});

  final ChairInfo chair;
  final ChairOccupancy? occupancy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Mientras se consulta, se muestra un spinner pequeño en lugar de ocultar la sección:
    // aparecer y desaparecer salta el layout.
    if (occupancy == null && (chair.isOccupiedNow || chair.status == 'RESERVED')) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: AppSpacing.sm),
        child: AppSpinner(size: 18),
      );
    }

    final ChairOccupancy? current = occupancy;
    if (current == null || current.occupiedUntil == null) {
      if (chair.isOccupiedNow) {
        return _Note(
          icon: Icons.event_seat_rounded,
          text: 'Ocupada ahora mismo. Elige otra o cambia de hora.',
          color: context.tokens.textWarning,
          background: context.tokens.surfaceWarningSubtle,
        );
      }
      return _Note(
        icon: Icons.event_available_rounded,
        text: 'Libre en el horario que has elegido.',
        color: context.tokens.textSuccess,
        background: context.tokens.surfaceSuccessSubtle,
      );
    }

    final bool past = current.occupiedUntil!.isBefore(DateTime.now().toUtc());
    return _Note(
      icon: past ? Icons.event_available_rounded : Icons.event_busy_rounded,
      text: past
          ? 'Se libera ${DateFormatter.time(current.occupiedUntil!)}.'
          : '${current.occupiedByLabel ?? 'Ocupada'} hasta las '
              '${DateFormatter.time(current.occupiedUntil!)}.',
      color: past ? context.tokens.textSuccess : context.tokens.textWarning,
      background:
          past ? context.tokens.surfaceSuccessSubtle : context.tokens.surfaceWarningSubtle,
    );
  }
}

/// Aviso con ícono + texto + color (nunca solo color).
class _Note extends StatelessWidget {
  const _Note({
    required this.icon,
    required this.text,
    required this.color,
    required this.background,
  });

  final IconData icon;
  final String text;
  final Color color;
  final Color background;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 18, color: color),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.bodySmall.copyWith(color: color),
            ),
          ),
        ],
      ),
    );
  }
}

/// Característica de la silla (`wifi`, `outlet`, `view`, `accessible`, `tv`,
/// `quiet`). El vocabulario es cerrado (API.md §8.3) y un valor desconocido cae en
/// un ícono genérico en vez de romper.
class _FeatureChip extends StatelessWidget {
  const _FeatureChip({required this.feature});

  final String feature;

  @override
  Widget build(BuildContext context) {
    final (IconData icon, String label) = switch (feature) {
      'wifi' => (Icons.wifi_rounded, 'Wifi'),
      'outlet' => (Icons.power_rounded, 'Enchufe'),
      'view' => (Icons.visibility_rounded, 'Con vista'),
      'accessible' => (Icons.accessible_rounded, 'Accesible'),
      'tv' => (Icons.tv_rounded, 'Pantalla'),
      'quiet' => (Icons.volume_off_rounded, 'Silenciosa'),
      _ => (Icons.chair_rounded, feature),
    };
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.sm,
        vertical: AppSpacing.xxs,
      ),
      decoration: BoxDecoration(
        color: context.tokens.surfaceMuted,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 14, color: context.tokens.textSecondary),
          const SizedBox(width: AppSpacing.xs),
          Text(
            label,
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textSecondary),
          ),
        ],
      ),
    );
  }
}
