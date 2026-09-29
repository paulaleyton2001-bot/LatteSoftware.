// Selector de silla del mostrador. MÓDULO `pos/presentation/widgets`.
//
// REUTILIZA EL MAPA QUE YA EXISTE
// `ChairMapGrid` (de `features/checkout/presentation/widgets`) ya resuelve lo
// difícil: reescalar `gridX`/`gridY` normalizados (0-1000 en la API) al ancho
// disponible, pintar cada silla con color + ícono + TEXTO (WCAG 1.4.1) y poner un
// borde de 2 dp en la seleccionada. Escribir una segunda rejilla sería una copia
// que se quedaría vieja. Lo único que hace este archivo es FILTRAR: el cajero
// solo quiere las sillas que puede vender ahora, no el plano completo.
//
// EL FILTRO DEL CAJERO ES MÁS ESTRICTO QUE EL DEL CLIENTE
// `ChairInfo.isSelectable` acepta `RESERVED` (hay hueco para el cliente). El cajero
// NO: si una silla está reservada, otra persona viene por ella y el cobrarla es
// un conflicto. Se usa `isFreeNow` (activa y `AVAILABLE`).
//
// CUANDO FALTA LA RESERVA
// `type = CHAIR_RENTAL` exige `chairId` Y `reservationId` (API.md §7.12). El POS
// ofrece el alquiler "walk-in" (`POST /rentals`), que es el camino real del
// mostrador para un cliente sin reserva; el panel de aviso explica que hace falta
// la reserva cuando el cajero no la tiene, en vez de dejar que el backend responda
// `422`.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/customer/venue_providers.dart';
import '../../../../shared/widgets/chair_map_grid.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../../../shared/widgets/ui/empty_state.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/pos_draft.dart';
import '../pos_controller.dart';

/// Mapa de sillas del mostrador, filtrado a las libres.
class PosChairPicker extends ConsumerWidget {
  const PosChairPicker({this.onPicked, super.key});

  /// Avisa con la silla elegida. `null` = solo lectura (lo usa el resumen).
  final ValueChanged<ChairInfo>? onPicked;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ChairMap> map = ref.watch(venueMapProvider);
    final int? selectedId = ref.watch(posDraftProvider.select((PosDraft d) => d.chairId));

    return AsyncStateBuilder<ChairMap>(
      value: map,
      loadingMessage: 'Cargando el plano…',
      // `invalidateVenueMap` espera un `Ref` de provider, no un `WidgetRef`.
      onRetry: () async => ref.invalidate(venueMapProvider),
      isEmpty: (ChairMap data) => data.allChairs.isEmpty,
      emptyIcon: Icons.event_seat_outlined,
      emptyTitle: 'El local no tiene sillas',
      emptyMessage:
          'Crea zonas y sillas desde Administración · Sillas para poder asignarlas.',
      compactEmpty: true,
      builder: (BuildContext context, ChairMap data) {
        final ChairMap filtered = _onlyFree(data);
        if (filtered.allChairs.isEmpty) {
          return const EmptyState(
            icon: Icons.event_busy_rounded,
            title: 'No hay sillas libres',
            message: 'Todas están ocupadas, reservadas o fuera de servicio. '
                'Puedes cobrar para llevar mientras tanto.',
            compact: true,
          );
        }
        return ChairMapGrid(
          map: filtered,
          selectedId: selectedId,
          onSelect: onPicked == null
              ? null
              : (ChairInfo chair) {
                  ref.read(posDraftProvider.notifier).assignChair(
                        chairId: chair.id,
                        chairLabel: chair.cellLabel,
                      );
                  onPicked!(chair);
                },
        );
      },
    );
  }

  /// Copia del mapa con solo las sillas libres. Los ids y el resto no se tocan.
  static ChairMap _onlyFree(ChairMap map) => ChairMap(
        locationId: map.locationId,
        locationName: map.locationName,
        countsByStatus: map.countsByStatus,
        zones: <ZoneMap>[
          for (final ZoneMap zone in map.zones)
            ZoneMap(
              id: zone.id,
              name: zone.name,
              code: zone.code,
              colorHex: zone.colorHex,
              minX: zone.minX,
              minY: zone.minY,
              maxX: zone.maxX,
              maxY: zone.maxY,
              chairs: <ChairInfo>[
                for (final ChairInfo chair in zone.chairs)
                  if (chair.isFreeNow) chair,
              ],
            ),
        ],
      );
}

/// Resumen de la silla asignada, con su precio por hora.
class PosChairSummary extends ConsumerWidget {
  const PosChairSummary({this.onClear, super.key});

  final VoidCallback? onClear;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final PosDraft draft = ref.watch(posDraftProvider);
    // El plano puede no haber llegado: sin silla visible el chip se queda solo con
    // el código, que es justo para lo que sirve `chairLabel`.
    final ChairMap? map = ref.watch(venueMapProvider).valueOrNull;
    final int? chairId = draft.chairId;
    if (chairId == null) return const SizedBox.shrink();
    final ChairInfo? chair = map?.byId(chairId);
    final String label = draft.chairLabel ?? chair?.cellLabel ?? 'Silla $chairId';

    return Row(
      children: <Widget>[
        Icon(Icons.event_seat_rounded,
            size: 18, color: context.tokens.textSuccess),
        const SizedBox(width: AppSpacing.xs),
        Expanded(
          child: Text(
            chair == null ? label : '$label · ${chair.zoneName ?? 'sin zona'}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 14,
              color: context.tokens.textSuccess,
            ),
          ),
        ),
        if (chair != null)
          PriceDisplay(
            currentMinor: chair.pricePerHourMinor,
            variant: PriceVariant.costPerUnit,
            unitLabel: 'hora',
          ),
        if (onClear != null)
          IconButton(
            onPressed: onClear,
            icon: const Icon(Icons.close_rounded, size: 18),
            color: context.tokens.textSecondary,
            // El `tooltip` de `IconButton` ya da la etiqueta al lector de
            // pantalla; `IconButton` no admite `semanticLabel`.
            tooltip: 'Quitar la silla del pedido',
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          ),
      ],
    );
  }
}
