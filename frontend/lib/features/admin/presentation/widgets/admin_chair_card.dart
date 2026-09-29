// Tarjeta de silla en el mapa del panel. MÓDULO `features/admin/presentation/widgets`.
//
// REUTILIZA EL PLANO QUE YA EXISTE
// `ChairMapGrid` (de `shared/widgets/`) ya resuelve el escalado de `gridX`/`gridY`
// y el requisito de no comunicar el estado solo con color. Esta pantalla lo usa
// para el mapa y añade, al lado, la lista de sillas con sus acciones, que es lo
// que el mostrador necesita para hacer cambios.
//
// LAS CUATRO ACCIONES, NO UN DESPLEGABLE
// Bloquear, desbloquear, mantenimiento y cerrar mantenimiento. Son las cuatro rutas
// que el backend acepta. `OCCUPIED` y `RESERVED` NO se ofrecen: las pone el flujo de
// alquileres y mandarlas da `422 INVALID_CHAIR_STATUS_TRANSITION` (BR-CHAIR-003).
// Un desplegable con seis estados sería una lista de errores previsibles.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/admin_spaces.dart';
import '../admin_spaces_controller.dart';
import './admin_chair_actions.dart';
import './admin_zone_edit_dialog.dart';

/// Tarjeta de una silla con su estado, precio y acciones.
class AdminChairCard extends ConsumerWidget {
  const AdminChairCard({required this.chair, super.key});

  final AdminChair chair;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<void> busy = ref.watch(adminChairStatusProvider(chair.id));

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  chair.cellLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.titleSmall,
                ),
              ),
              StatusBadge.chair(chair.status, compact: true),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            '${chair.code}${chair.zoneName == null ? '' : ' · ${chair.zoneName}'}',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.captionSmall
                .copyWith(color: context.tokens.textTertiary),
          ),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: <Widget>[
              PriceDisplay(
                currentMinor: chair.pricePerHourMinor,
                variant: PriceVariant.costPerUnit,
                unitLabel: 'hora',
              ),
              const Spacer(),
              if (chair.statusChangedAt != null)
                Text(
                  DateFormatter.relative(chair.statusChangedAt!),
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          AdminChairActions(chair: chair, isBusy: busy.isLoading),
        ],
      ),
    );
  }
}

/// Zona de una lista de sillas. Se usa como cabecera de grupo.
class AdminZoneHeader extends StatelessWidget {
  const AdminZoneHeader({required this.zone, super.key});

  final AdminZone zone;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Semantics(
              header: true,
              child: Text(zone.name, style: AppTextStyles.titleMedium),
            ),
          ),
          Text(
            '${zone.availableCount} de ${zone.chairCount} libres',
            style: AppTextStyles.captionMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(width: AppSpacing.sm),
          // Botón de reordenar: `POST /zones/reorder` es transaccional y acepta
          // actualización parcial; aquí se edita nombre y código, que van por PATCH.
          IconButton(
            onPressed: () => AdminZoneEditDialog.show(context, zone),
            icon: const Icon(Icons.edit_outlined, size: 18),
            tooltip: 'Editar la zona ${zone.name}',
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          ),
        ],
      ),
    );
  }
}
