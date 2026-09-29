// Bloques del detalle de un pedido. Módulo `features/orders/presentation/widgets`.
//
// Se extraen del `order_detail_page.dart` por TAMAÑO y por responsabilidad: cada
// bloque es una sección independiente de la ficha y puede probarse sin montar la
// pantalla entera.
//
// COMPARTEN UNA CONVENCIÓN
//   - Todo importe entra como centavos y sale por `PriceDisplay` o
//     `CurrencyFormatter` (docs/DESIGN-TOKENS §9.1).
//   - Todo estado se pinta con `StatusBadge` (texto + ícono + color).
//   - Los datos del pedido son SNAPSHOTS del servidor (`nameSnapshot`,
//     `unitPriceMinor`): se pinta lo que se pidió, no el catálogo actual
//     (BR-PRICE-004).


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/rental_countdown.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/order_detail.dart';
import '../../domain/entities/order_summary.dart';
// `currentUserProvider` es de la feature de auth: el permiso `rentals:extend` se
// comprueba contra el usuario de la sesión ANTES de pintar el botón (misma
// excepción que `admin_users_page.dart` y `chair_controller.dart`).
import '../../../auth/presentation/auth_controller.dart';
import '../../domain/entities/rental.dart';
import '../orders_controller.dart';
import './extend_rental_control.dart';

/// Fila etiqueta/valor de un total.
class OrderTotalRow extends StatelessWidget {
  const OrderTotalRow({
    required this.label,
    required this.value,
    this.color,
    super.key,
  });

  final String label;

  /// Importe en CENTAVOS. Negativo = descuento.
  final int value;

  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xxs),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Text(
              label,
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
          Text(
            value < 0
                ? '−${CurrencyFormatter.formatMinor(value.abs())}'
                : CurrencyFormatter.formatMinor(value),
            style: AppTextStyles.price
                .copyWith(color: color ?? context.tokens.textPrimary),
          ),
        ],
      ),
    );
  }
}

/// Nota informativa con ícono + texto.
class OrderNote extends StatelessWidget {
  const OrderNote({required this.icon, required this.text, super.key});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: context.tokens.surfaceMuted,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Icon(icon, size: 18, color: context.tokens.textSecondary),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textSecondary),
            ),
          ),
        ],
      ),
    );
  }
}

/// Cabecera del pedido: número, estado, fecha, tipo y notas del cliente.
class OrderHeaderCard extends StatelessWidget {
  const OrderHeaderCard({required this.order, super.key});

  final OrderDetail order;

  @override
  Widget build(BuildContext context) {
    final OrderSummary summary = order.summary;
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: SelectableText(
                  summary.orderNumber,
                  style: AppTextStyles.headlineSmall,
                ),
              ),
              StatusBadge.order(summary.status),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          if (summary.placedAt != null)
            Text(
              'Pedido el ${DateFormatter.dateTime(summary.placedAt!)}',
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          const SizedBox(height: AppSpacing.xs),
          Wrap(
            spacing: AppSpacing.md,
            runSpacing: AppSpacing.xs,
            children: <Widget>[
              Text(
                summary.typeLabel,
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textSecondary),
              ),
              if (summary.chairCode != null)
                Text(
                  'Silla ${summary.chairCode}',
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              if (order.reservationCode != null)
                Text(
                  'Reserva ${order.reservationCode}',
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
            ],
          ),
          if (order.customerNotes != null && order.customerNotes!.isNotEmpty) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            OrderNote(
              text: order.customerNotes!,
              icon: Icons.sticky_note_2_outlined,
            ),
          ],
        ],
      ),
    );
  }
}

/// Panel del alquiler: temporizador en vivo y extensión.
class RentalPanel extends ConsumerWidget {
  const RentalPanel({required this.order, super.key});

  final OrderDetail order;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Rental? rental = order.rental;
    final DateTime? end = rental?.endAt;
    if (rental == null || end == null) return const SizedBox.shrink();

    final bool canExtend =
        ref.watch(currentUserProvider)?.hasPermission('rentals:extend') ?? false;
    final AsyncValue<Duration?> extending = ref.watch(
      extendRentalProvider(rental),
    );

    return AppCard(
      variant: AppCardVariant.elevated,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text('Tu silla', style: AppTextStyles.titleLarge),
              ),
              StatusBadge.rental(rental.status),
            ],
          ),
          const SizedBox(height: AppSpacing.lg),
          RentalCountdown(endAt: end, large: true),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'Termina a las ${DateFormatter.time(end)}'
            '${rental.plannedMinutes > 0 ? ' · pediste ${DateFormatter.durationLong(Duration(minutes: rental.plannedMinutes))}' : ''}',
            style: AppTextStyles.captionMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          if (rental.extraMinutesMinor > 0) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Minutos extra: ${CurrencyFormatter.formatMinor(rental.extraMinutesMinor)}',
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textWarning),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          if (canExtend)
            ExtendRentalControl(rental: rental, state: extending)
          else
            const OrderNote(
              icon: Icons.storefront_rounded,
              text: '¿Necesitas más tiempo? Pídeselo al personal: lo amplían al '
                  'instante y te lo suman a la cuenta.',
            ),
        ],
      ),
    );
  }
}
