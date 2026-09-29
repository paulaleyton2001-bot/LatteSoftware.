// Columnas del tablero Kanban. MÓDULO `pos/presentation/widgets`.
//
// Cada columna es un `ListView` dentro de un `ListView` horizontal: con pocas
// tarjetas y scroll propio por columna, quien busca "el pedido de la mesa 4"
// desplaza UNA columna y no el tablero entero.
//
// EL ANCHO DE COLUMNA SE REPARTE
// Si el ancho disponible da columnas de 220 dp o más, se reparte el ancho (en un
// monitor de 1920 caben las seis columnas sin scroll). Si no, la columna se fija
// en 260 dp y el tablero scrollea en horizontal, que es lo correcto en tablet.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/responsive/pos_breakpoints.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/error/failures.dart';
import '../../domain/entities/pos_order_card.dart';
import '../pos_orders_controller.dart';
import './pos_order_board_card.dart';
import './pos_receipt_dialog.dart';

/// Tablero: una columna por estado, con scroll horizontal si no caben.
class PosBoard extends ConsumerWidget {
  const PosBoard({required this.orders, required this.layout, super.key});

  final List<PosOrderCard> orders;
  final PosLayout layout;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int width = _columnWidth(context);

    return ListView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.all(AppSpacing.md),
      children: <Widget>[
        for (final PosBoardColumn column in kPosBoardColumns) ...<Widget>[
          PosBoardColumnView(
            column: column,
            width: width,
            orders: orders
                .where((PosOrderCard order) => _matches(order, column))
                .toList(growable: false),
            onAdvance: (PosOrderCard order) => _advance(context, ref, order),
            onReprint: (PosOrderCard order) =>
                PosReceiptDialog.show(context, order.id),
          ),
          SizedBox(width: layout.gutter),
        ],
      ],
    );
  }

  /// Ancho de columna: se reparte el ancho disponible si hay sitio, y si no se
  /// queda en un ancho fijo con scroll horizontal (que es lo correcto en tablet).
  int _columnWidth(BuildContext context) {
    final int count = kPosBoardColumns.length;
    final double available = MediaQuery.sizeOf(context).width - 2 * AppSpacing.md;
    final double share = available / count - layout.gutter;
    if (share >= 220) return share.floor();
    return 260;
  }

  static bool _matches(PosOrderCard order, PosBoardColumn column) {
    final String? target = kPosBoardColumnStatus[column.label];
    if (target == null) return false;
    if (target == 'COMPLETED') return order.status == 'COMPLETED';
    return order.status == target;
  }

  Future<void> _advance(
    BuildContext context,
    WidgetRef ref,
    PosOrderCard order,
  ) async {
    final bool ok =
        await ref.read(posOrderStatusProvider.notifier).advance(order);
    // `context.mounted` y no `ref.mounted`: lo que se desmonta mientras se
    // llama al backend es el WIDGET, no el provider.
    if (!ok && context.mounted) {
      final Object? failure = ref.read(posOrderStatusProvider).error;
      if (failure != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              failure is Failure ? failure.message : 'No se pudo cambiar el estado',
            ),
            behavior: SnackBarBehavior.floating,
          ),
        );
        ref.read(posOrderStatusProvider.notifier).acknowledge();
      }
    }
  }
}

/// Una columna del tablero.
class PosBoardColumnView extends StatelessWidget {
  const PosBoardColumnView({
    required this.column,
    required this.width,
    required this.orders,
    required this.onAdvance,
    required this.onReprint,
  });

  final PosBoardColumn column;
  final int width;
  final List<PosOrderCard> orders;
  final void Function(PosOrderCard order) onAdvance;
  final void Function(PosOrderCard order) onReprint;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width.toDouble(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Semantics(
              header: true,
              child: Row(
                children: <Widget>[
                  Icon(column.icon, size: 18, color: context.tokens.textSecondary),
                  const SizedBox(width: AppSpacing.xs),
                  Expanded(
                    child: Text(
                      column.label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.titleSmall,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.sm,
                      vertical: AppSpacing.xxs,
                    ),
                    decoration: BoxDecoration(
                      color: context.tokens.surfaceSunken,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '${orders.length}',
                      style: AppTextStyles.labelMedium
                          .copyWith(color: context.tokens.textStrong),
                    ),
                  ),
                ],
              ),
            ),
          ),
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: context.tokens.surfaceMuted,
                borderRadius: BorderRadius.circular(AppRadii.md),
              ),
              child: orders.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.md),
                        child: Text(
                          'Nada aquí',
                          style: AppTextStyles.captionSmall
                              .copyWith(color: context.tokens.textTertiary),
                        ),
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      itemCount: orders.length,
                      itemBuilder: (BuildContext context, int index) =>
                          PosOrderBoardCard(
                        order: orders[index],
                        onAdvance: orders[index].canAdvance
                            ? () => onAdvance(orders[index])
                            : null,
                        onReprint: () => onReprint(orders[index]),
                      ),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
