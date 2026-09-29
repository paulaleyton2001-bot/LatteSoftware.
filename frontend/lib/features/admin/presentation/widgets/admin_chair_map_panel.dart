// Panel del mapa de sillas del administrador.
// MÓDULO `features/admin/presentation/widgets`.
//
// REUTILIZA EL PLANO DEL CHECKOUT
// `ChairMapGrid` (de `shared/widgets/`) ya resuelve lo difícil: reescalar las
// coordenadas normalizadas de la API al ancho disponible, y comunicar cada estado
// con color + ícono + TEXTO (WCAG 1.4.1). Escribir una segunda rejilla sería una
// copia que se queda vieja.
//
// EL MAPA ES DE SOLO LECTURA AQUÍ
// Tocar una silla en el panel NO la asigna ni la abre: eso es del mostrador. En el
// panel, el plano sirve para ver, y las acciones están en la lista de al lado. Por eso
// `onSelect` es `null`: tocar no hace nada en vez de hacer algo inesperado.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/customer/venue_providers.dart';
import '../../../../shared/widgets/chair_map_grid.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../admin_spaces_controller.dart';
import './admin_space_counts.dart';

/// Plano del local con los contadores por estado.
class AdminChairMapPanel extends ConsumerWidget {
  const AdminChairMapPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ChairMap> map = ref.watch(venueMapProvider);
    final int? zoneFilter = ref.watch(adminZoneFilterProvider);

    return AppCard(
      child: AsyncStateBuilder<ChairMap>(
        value: map,
        loadingMessage: 'Cargando el plano…',
        // `invalidateVenueMap` espera un `Ref` de provider, no un `WidgetRef`: el
        // panel es un `ConsumerWidget` y solo tiene el segundo. Se invalida el
        // provider directamente, que es lo mismo que hace el helper.
        onRetry: () async => ref.invalidate(venueMapProvider),
        isEmpty: (ChairMap data) => data.isEmpty,
        emptyIcon: Icons.event_seat_outlined,
        emptyTitle: 'Sin plano',
        emptyMessage: 'Crea zonas y sillas para ver el local.',
        compactEmpty: true,
        builder: (BuildContext context, ChairMap data) => Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const Text('Plano del local', style: AppTextStyles.titleMedium),
            const SizedBox(height: AppSpacing.md),
            AdminSpaceCountsLegend(
              counts: data.countsByStatus,
            ),
            const SizedBox(height: AppSpacing.md),
            Flexible(
              child: ChairMapGrid(map: _onlyZone(data, zoneFilter)),
            ),
          ],
        ),
      ),
    );
  }

  /// Recorta el mapa a la zona seleccionada, o lo deja entero si no hay filtro.
  static ChairMap _onlyZone(ChairMap map, int? zoneId) {
    if (zoneId == null) return map;
    return ChairMap(
      locationId: map.locationId,
      locationName: map.locationName,
      countsByStatus: map.countsByStatus,
      zones: <ZoneMap>[
        for (final ZoneMap zone in map.zones)
          if (zone.id == zoneId) zone,
      ],
    );
  }
}
