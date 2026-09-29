// Bloque del mapa del local en la pestaña «Silla». Módulo
// `features/chair/presentation/widgets`.
//
// REUTILIZA LA REJILLA DEL CHECKOUT A PROPÓSITO
// La celda de silla, su leyenda y su catálogo de estados son los mismos. Si esta
// pantalla pintara su propia rejilla, el estado de una silla podría verse distinto
// aquí y en el checkout, y quien eligiera desde aquí vería una silla libre que al
// reservar ya no lo está.
//
// EL BOTÓN "ACTUALIZAR" NO ES DECORATIVO
// `GET /chairs/map` tiene rate limit de 120 por minuto, así que recargar a mano es
// legítimo y necesario: el plano cambia cuando alguien se sienta o se va, y quien
// está mirando en el local lo ve antes que el servidor si pulsa.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/chair_map.dart';
import '../../../../core/customer/venue_providers.dart';
import '../../../../shared/widgets/chair_map_grid.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../../../shared/widgets/ui/shimmer.dart';
import '../../../checkout/presentation/widgets/chair_map_legend.dart';

/// Mapa del local con leyenda y estado de recarga.
class ChairMapBlock extends ConsumerWidget {
  const ChairMapBlock({
    required this.map,
    this.selectedId,
    this.onSelect,
    super.key,
  });

  final AsyncValue<ChairMap> map;
  final int? selectedId;

  /// `null` = el mapa es de SOLO LECTURA. `ChairMapGrid` entrega un
  /// `ChairInfo` completo, no un id suelto, y quien elige necesita el código y el
  /// estado para confirmar: por eso el tipo del callback es el de la rejilla y no
  /// un `ValueChanged<int>`.
  final ValueChanged<ChairInfo>? onSelect;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Semantics(
      container: true,
      header: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text('Mapa del local', style: AppTextStyles.titleLarge),
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
          const SizedBox(height: AppSpacing.sm),
          AsyncStateBuilder<ChairMap>(
            value: map,
            loadingMessage: 'Cargando el mapa…',
            onRetry: () async => ref.invalidate(venueMapProvider),
            isEmpty: (ChairMap data) => data.isEmpty,
            emptyIcon: Icons.event_seat_outlined,
            emptyTitle: 'El local no tiene sillas cargadas',
            emptyMessage: 'No hay plano que mostrar. Avisa al personal del local.',
            builder: (BuildContext context, ChairMap data) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  '${data.availableCount} de ${data.allChairs.length} libres'
                  '${data.locationName == null ? '' : ' · ${data.locationName}'}',
                  style: AppTextStyles.bodyMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
                const SizedBox(height: AppSpacing.md),
                ChairMapGrid(
                  map: data,
                  selectedId: selectedId,
                  onSelect: onSelect,
                ),
                const SizedBox(height: AppSpacing.md),
                // La leyenda cuenta por estado, así que necesita el plano: sin él
                // dibujaría los seis estados con 0 y mentiría sobre el local.
                ChairMapLegend(map: data),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Skeleton del mapa, para el primer frame mientras llega la respuesta.
class ChairMapSkeleton extends StatelessWidget {
  const ChairMapSkeleton({super.key});

  @override
  Widget build(BuildContext context) =>
      const ShimmerBox(height: 220, borderRadius: 16);
}
