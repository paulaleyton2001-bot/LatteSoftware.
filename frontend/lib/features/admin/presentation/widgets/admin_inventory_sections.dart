// Movimientos recientes y proveedores. MÓDULO `features/admin/presentation/widgets`.
//
// DOS SECCIONES QUE NO SON UNA TABLA MÁS
// Los movimientos son un HISTORIAL: se leen, no se editan, y el signo (+/−) es la
// información principal. Los proveedores son un DERRIVE que calcula el backend a
// partir de `inventory_items.supplier`: no hay entidad "proveedor" que dar de
// alta, y por eso esta pantalla NO tiene un botón de "nuevo proveedor".
//
// EL SIGNO DEL MOVIMIENTO, EN PALABRAS
// "Entró", "Salió", "Ajuste", "Merma": el color del texto acompaña, pero la
// palabra es la que porta el significado (WCAG 1.4.1).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/async_state_builder.dart';
import '../../domain/entities/admin_inventory.dart';
import '../admin_inventory_controller.dart';

/// Tarjeta con los movimientos recientes.
class AdminInventoryMovementsCard extends ConsumerWidget {
  const AdminInventoryMovementsCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<AdminInventoryMovement>> movements =
        ref.watch(adminInventoryMovementsProvider);

    return AsyncStateBuilder<List<AdminInventoryMovement>>(
      value: movements,
      loadingMessage: 'Cargando movimientos…',
      onRetry: () async => ref.invalidate(adminInventoryMovementsProvider),
      isEmpty: (List<AdminInventoryMovement> data) => data.isEmpty,
      emptyIcon: Icons.swap_vert_rounded,
      emptyTitle: 'Sin movimientos',
      emptyMessage: 'Aquí aparecerán las entradas, salidas y ajustes de stock.',
      compactEmpty: true,
      builder: (BuildContext context, List<AdminInventoryMovement> data) {
        final List<AdminInventoryMovement> shown =
            data.length > 20 ? data.sublist(0, 20) : data;
        return AppCard(
          padding: EdgeInsets.zero,
          child: Column(
            children: <Widget>[
              for (int i = 0; i < shown.length; i++) ...<Widget>[
                if (i > 0) const Divider(height: 1),
                _MovementRow(movement: shown[i]),
              ],
            ],
          ),
        );
      },
    );
  }
}

/// Fila de un movimiento.
class _MovementRow extends StatelessWidget {
  const _MovementRow({required this.movement});

  final AdminInventoryMovement movement;

  /// Etiqueta legible del tipo de movimiento. El backend manda el literal.
  static String labelOf(String type) => switch (type) {
        'PURCHASE' => 'Compra',
        'SALE' => 'Venta',
        'ADJUSTMENT' => 'Ajuste',
        'WASTE' => 'Merma',
        'RETURN' => 'Devolución',
        'RESERVATION' => 'Reservado',
        'RELEASE' => 'Liberado',
        _ => type,
      };

  @override
  Widget build(BuildContext context) {
    final bool inbound = movement.isInbound;
    final Color color =
        inbound ? context.tokens.textSuccess : context.tokens.textWarning;
    final String sign = inbound ? '+' : '−';

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  movement.inventoryItemName ?? 'Ítem',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.bodyMedium,
                ),
                Text(
                  <String>[
                    labelOf(movement.movementType),
                    if (movement.reason != null) movement.reason!,
                    if (movement.createdAt != null)
                      DateFormatter.dateTime(movement.createdAt!),
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
              ],
            ),
          ),
          Text(
            '$sign${_qty(movement.quantity)} ${movement.unit ?? ''}',
            style: AppTextStyles.labelLarge.copyWith(color: color),
          ),
          if (movement.balanceAfter != null) ...<Widget>[
            const SizedBox(width: AppSpacing.md),
            SizedBox(
              width: 72,
              child: Text(
                'Saldo ${_qty(movement.balanceAfter!)}',
                textAlign: TextAlign.end,
                style: AppTextStyles.captionSmall
                    .copyWith(color: context.tokens.textTertiary),
              ),
            ),
          ],
        ],
      ),
    );
  }

  static String _qty(double value) => value == value.roundToDouble()
      ? value.toInt().toString()
      : value.toStringAsFixed(2);
}
