// Tarjetas de la pantalla de confirmación. Módulo
// `features/checkout/presentation/widgets`.
//
// ESTA ES LA PANTALLA DONDE LAS CIFRAS SON LA VERDAD
// Todo lo que se pinta aquí viene de `POST /reservations` y `POST /orders`, sin
// transformar (BR-PRICE-008). Si el "total estimado" del paso anterior difiere (por
// impuestos, por el mínimo de 30 min o por el cupón), estos son los números buenos
// y por eso llevan la etiqueta de servidor en lugar de "estimado".
//
// EL AVISO DE PAGO VA AL FINAL
// Sin pasarela: no hay tarjeta, no hay redirección. Se paga en el local. El aviso
// es lo último que se lee, justo antes de cerrar, para que nadie salga buscando una
// pantalla de pago que no existe.



import 'package:flutter/material.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/chair_quote.dart';

/// Número de pedido, estado y datos de la reserva.
class OrderConfirmationCard extends StatelessWidget {
  const OrderConfirmationCard({required this.order, super.key});

  final PlacedOrder order;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            'Número de pedido',
            style: AppTextStyles.labelMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
          const SizedBox(height: AppSpacing.xxs),
          // `SelectableText`: el número es lo que hay que decir en el mostrador y
          // hay que poder copiarlo con dos dedos.
          SelectableText(
            order.orderNumber,
            style: AppTextStyles.displaySmall
                .copyWith(color: context.tokens.textPrimary),
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: <Widget>[
              StatusBadge.order(order.status),
              if (order.itemCount > 0) ...<Widget>[
                const SizedBox(width: AppSpacing.sm),
                Text(
                  '${order.itemCount} '
                  '${order.itemCount == 1 ? 'producto' : 'productos'}',
                  style: AppTextStyles.bodySmall
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ],
            ],
          ),
          if (order.chairCode != null) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            _Row(icon: Icons.event_seat_rounded, text: 'Silla ${order.chairCode}'),
          ],
          if (order.reservationCode != null) ...<Widget>[
            const SizedBox(height: AppSpacing.xs),
            _Row(
              icon: Icons.event_note_rounded,
              text: 'Reserva ${order.reservationCode}',
            ),
          ],
          if (order.placedAt != null) ...<Widget>[
            const SizedBox(height: AppSpacing.xs),
            _Row(
              icon: Icons.schedule_rounded,
              text: DateFormatter.dateTime(order.placedAt!),
            ),
          ],
          // ── Lo que se compró ───────────────────────────────────────────────
          // Este bloque es la respuesta directa a "los productos no aparecen al
          // hacer el pedido": sin él, la confirmación daba el número y el total
          // pero no decía qué se había pedido. Los nombres y los importes son
          // los del SERVIDOR (`nameSnapshot` / `lineTotalMinor`), no los del
          // carrito local (BR-PRICE-008).
          if (order.lines.isNotEmpty) ...<Widget>[
            const SizedBox(height: AppSpacing.md),
            Divider(color: context.tokens.borderSubtle, height: 1),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Tu pedido',
              style: AppTextStyles.labelMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
            const SizedBox(height: AppSpacing.xs),
            for (final PlacedOrderLine line in order.lines)
              _PurchasedLineRow(line: line),
          ],
        ],
      ),
    );
  }
}

/// Importes que devolvió el servidor.
class OrderConfirmationTotals extends StatelessWidget {
  const OrderConfirmationTotals({required this.order, super.key});

  final PlacedOrder order;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text('Importes', style: AppTextStyles.titleMedium),
          const SizedBox(height: AppSpacing.md),
          _TotalRow(label: 'Subtotal', value: order.subtotalMinor),
          if (order.discountMinor > 0)
            _TotalRow(
              label: 'Descuento',
              value: -order.discountMinor,
              color: context.tokens.textSuccess,
            ),
          if (order.taxMinor > 0)
            _TotalRow(label: 'Impuestos', value: order.taxMinor),
          if (order.serviceFeeMinor > 0)
            _TotalRow(label: 'Cargo por servicio', value: order.serviceFeeMinor),
          const SizedBox(height: AppSpacing.sm),
          Divider(color: context.tokens.borderSubtle, height: 1),
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: <Widget>[
              Expanded(child: Text('Total', style: AppTextStyles.titleMedium)),
              PriceDisplay(
                currentMinor: order.totalMinor,
                variant: PriceVariant.large,
                semanticLabel: 'Total del pedido: '
                    '${CurrencyFormatter.formatMinor(order.totalMinor, withDecimals: true)}',
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Una línea comprada: cantidad, nombre y importe de la línea.
///
/// Nombre con `Flexible` + ellipsis: en un móvil estrecho un nombre de producto
/// largo ("Frappado de maracuyá con leche de avena") se salía por la derecha
/// con `Row`. Aquí cede espacio al precio, que es el dato que no puede recortarse.
class _PurchasedLineRow extends StatelessWidget {
  const _PurchasedLineRow({required this.line});

  final PlacedOrderLine line;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: line.semanticLabel,
      excludeSemantics: true,
      child: Padding(
        padding: const EdgeInsets.only(bottom: AppSpacing.xs),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            // Cantidad en una píldora: se lee de un vistazo cuántos artículos
            // hay sin tener que contar.
            Container(
              constraints: const BoxConstraints(minWidth: 24),
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.xs,
                vertical: 1,
              ),
              decoration: BoxDecoration(
                color: context.tokens.surfaceMuted,
                borderRadius: BorderRadius.circular(AppRadii.sm),
              ),
              child: Text(
                '${line.quantity}×',
                textAlign: TextAlign.center,
                style: AppTextStyles.labelMedium
                    .copyWith(color: context.tokens.textSecondary),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                line.variantName == null
                    ? line.name
                    : '${line.name} · ${line.variantName}',
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.bodyMedium
                    .copyWith(color: context.tokens.textPrimary),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            PriceDisplay(currentMinor: line.lineTotalMinor),
          ],
        ),
      ),
    );
  }
}

/// Fila con ícono y texto.
class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Icon(icon, size: 16, color: context.tokens.textSecondary),
        const SizedBox(width: AppSpacing.sm),
        Text(
          text,
          style: AppTextStyles.bodySmall
              .copyWith(color: context.tokens.textSecondary),
        ),
      ],
    );
  }
}

/// Fila de importe. Negativo = descuento.
class _TotalRow extends StatelessWidget {
  const _TotalRow({required this.label, required this.value, this.color});

  final String label;
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
