// Bloques de silla, duración y cotización dentro del checkout.
// Módulo `features/checkout/presentation/widgets`.
//
// Se extraen del `checkout_page.dart` para que la página se limite a la
// ESTRUCTURA (indicador + pasos + resumen + CTA) y no tenga que conocer el mapa, la
// cotización ni el panel de detalle.
//
// CADA BLOQUE ES UN `AsyncStateBuilder` O UNA SECCIÓN CON ESTADO PROPIO
//   - El mapa se pide por red y tiene sus estados (carga / sin red / vacío).
//   - La cotización se pide por red y tiene los suyos.
//   - La duración es local y no tiene red detrás.
//
// LOS CONFLICTOS DE SILLA NO SON ERRORES FATALES
// `GET /reservations/quote` devuelve `200` con `isAvailable: false` y la reserva
// que estorba. Se pinta como aviso con la acción de elegir otra, no como un error
// que deja la pantalla sin salida.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/customer/venue_providers.dart';
import '../../../../shared/widgets/chair_map_grid.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../checkout_controller.dart';
import '../checkout_state.dart';
import './chair_detail_panel.dart';
import './chair_map_legend.dart';
import './duration_selector.dart';

/// Selector de silla: mapa + leyenda + panel de detalle de la elegida.
class CheckoutChairPicker extends ConsumerWidget {
  const CheckoutChairPicker({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ChairMap> map = ref.watch(checkoutChairMapProvider);
    final CheckoutState state = ref.watch(checkoutProvider);
    final int? selectedId = state.chairId;

    return Semantics(
      container: true,
      header: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text('Elige tu silla', style: AppTextStyles.titleLarge),
              ),
              TextButton.icon(
                onPressed: () => ref.invalidate(venueMapProvider),
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Actualizar'),
                style: TextButton.styleFrom(
                  foregroundColor: context.tokens.actionPrimary,
                  minimumSize: const Size(0, 44),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          AsyncStateBuilder<ChairMap>(
            value: map,
            loadingMessage: 'Cargando el mapa del local…',
            onRetry: () async => ref.invalidate(checkoutChairMapProvider),
            isEmpty: (ChairMap data) => data.isEmpty,
            emptyIcon: Icons.event_seat_outlined,
            emptyTitle: 'El local no tiene sillas cargadas',
            emptyMessage: 'No hay mapa que mostrar. Avisa al personal del local.',
            builder: (BuildContext context, ChairMap data) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  '${data.availableCount} libres ahora'
                  '${data.locationName == null ? '' : ' en ${data.locationName}'}',
                  style: AppTextStyles.bodyMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
                const SizedBox(height: AppSpacing.md),
                ChairMapGrid(
                  map: data,
                  selectedId: selectedId,
                  onSelect: (ChairInfo chair) => ref
                      .read(checkoutProvider.notifier)
                      .selectChair(chair.id),
                ),
                const SizedBox(height: AppSpacing.md),
                // La leyenda cuenta por estado, así que necesita el plano: sin él
                // dibujaría los seis estados con 0 y mentiría sobre el local.
                ChairMapLegend(map: data),
                if (selectedId != null) ...<Widget>[
                  const SizedBox(height: AppSpacing.md),
                  if (data.byId(selectedId) case final ChairInfo chair)
                    ChairDetailPanel(chair: chair),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Bloque de duración. Solo tiene sentido con silla.
class CheckoutDurationBlock extends ConsumerWidget {
  const CheckoutDurationBlock({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CheckoutState state = ref.watch(checkoutProvider);
    return DurationSelector(
      pricePerHourMinor: state.quote?.pricePerHourMinor ?? 0,
    );
  }
}
