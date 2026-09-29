// Tarjeta de pedido del tablero Kanban. MÓDULO `pos/presentation/widgets`.
//
// UNA TARJETA, UNA DECISIÓN
// La tarjeta lleva número, cliente/silla, importe, estado y UNA acción: avanzar al
// siguiente estado con un toque. Ese botón es el equivalente de arrastrar la
// tarjeta a la columna siguiente, sin la ambigüedad de soltar en la columna
// equivocada con el dedo lleno. `Draggable` queda para cuando haya tablet con
// stylus; hoy el botón de avance cumple el requisito y es más fiable.
//
// EL ESTADO NUNCA SE COMUNICA SOLO CON COLOR
// `StatusBadge.order` pone texto + ícono + color (docs/DESIGN-TOKENS §6.1), y el
// botón de avance dice a QUÉ estado lleva en texto, no solo con la flecha.
//
// EL SALDO PENDIENTE SE DICE EN PALABRAS
// Un pedido con `balanceMinor > 0` muestra "Sin cobrar" con un ícono de warning:
// es la información que evita el peor error de una caja (dar por pagado lo que no
// se pagó).

import 'package:flutter/material.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/pos_order_card.dart';
import './pos_board_card_actions.dart';
import './pos_board_card_meta.dart';

/// Tarjeta de un pedido en el tablero.
class PosOrderBoardCard extends StatelessWidget {
  const PosOrderBoardCard({
    required this.order,
    required this.onAdvance,
    required this.onReprint,
    this.isAdvancing = false,
    super.key,
  });

  final PosOrderCard order;

  /// Avanza al siguiente estado. `null` si el pedido ya no avanza.
  final VoidCallback? onAdvance;

  /// Reimprime el comprobante (`GET /orders/:id/receipt`).
  final VoidCallback onReprint;

  /// `true` mientras se llama a `POST /orders/:id/status`: el botón se apaga para
  /// que no se pulse dos veces.
  final bool isAdvancing;

  @override
  Widget build(BuildContext context) {
    final bool hasBalance = order.hasBalance;
    return Semantics(
      container: true,
      label: 'Pedido ${order.orderNumber}, '
          '${order.customerName ?? order.chairCode ?? 'sin cliente'}, '
          'estado ${order.status}',
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: Theme.of(context).colorScheme.surface,
          borderRadius: BorderRadius.circular(AppRadii.md),
          border: Border.all(color: context.tokens.borderSubtle),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    order.orderNumber,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.titleSmall,
                  ),
                ),
                PriceDisplay(currentMinor: order.totalMinor),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: <Widget>[
                StatusBadge.order(order.status, compact: true),
                if (order.customerName != null)
                if (order.customerName != null)
                  PosBoardMetaChip(
                    icon: Icons.person_outline_rounded,
                    text: order.customerName!,
                  ),
                if (order.chairCode != null)
                  PosBoardMetaChip(
                    icon: Icons.event_seat_outlined,
                    text: order.chairCode!,
                  ),
                if (order.itemCount > 0)
                  PosBoardMetaChip(
                    icon: Icons.shopping_basket_outlined,
                    text: '${order.itemCount}',
                  ),
                if (order.placedAt != null)
                  PosBoardMetaChip(
                    icon: Icons.schedule_rounded,
                    text: DateFormatter.time(order.placedAt!),
                  ),
              ],
            ),
            if (hasBalance) ...<Widget>[
              const SizedBox(height: AppSpacing.sm),
              _UnpaidNotice(balanceMinor: order.balanceMinor),
            ],
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: <Widget>[
                if (onAdvance != null)
                  Expanded(
                    child: PosBoardAdvanceButton(
                      nextStatus: order.nextStatus!,
                      isBusy: isAdvancing,
                      onTap: onAdvance,
                    ),
                  )
                else
                  Expanded(
                    child: PosBoardAdvanceButton(
                      nextStatus: order.status,
                      isBusy: isAdvancing,
                      onTap: null,
                    ),
                  ),
                const SizedBox(width: AppSpacing.sm),
                _IconAction(
                  icon: Icons.print_outlined,
                  tooltip: 'Reimprimir comprobante',
                  semanticLabel: 'Reimprimir el comprobante de ${order.orderNumber}',
                  onTap: onReprint,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// Aviso de pedido sin cobrar. Ícono + palabra, no solo color.
class _UnpaidNotice extends StatelessWidget {
  const _UnpaidNotice({required this.balanceMinor});

  final int balanceMinor;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Sin cobrar: quedan $balanceMinor centavos',
      excludeSemantics: true,
      child: Row(
        children: <Widget>[
          Icon(Icons.error_outline_rounded,
              size: 16, color: context.tokens.textWarning),
          const SizedBox(width: AppSpacing.xxs),
          Text(
            'Sin cobrar',
            style: AppTextStyles.labelMedium
                .copyWith(color: context.tokens.textWarning),
          ),
          const SizedBox(width: AppSpacing.xs),
          PriceDisplay(currentMinor: balanceMinor),
        ],
      ),
    );
  }
}

/// Botón de ícono de la tarjeta (imprimir). 44 dp + `tooltip`.
class _IconAction extends StatelessWidget {
  const _IconAction({
    required this.icon,
    required this.tooltip,
    required this.semanticLabel,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final String semanticLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: semanticLabel,
      excludeSemantics: true,
      child: Tooltip(
        message: tooltip,
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(AppRadii.md),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadii.md),
            child: SizedBox.square(
              dimension: 44,
              child: Icon(icon, size: 20, color: context.tokens.textSecondary),
            ),
          ),
        ),
      ),
    );
  }
}
