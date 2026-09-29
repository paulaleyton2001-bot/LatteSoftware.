// Secciones de la ficha de cliente. MÓDULO `features/admin/presentation/widgets`.
//
// Pedidos, reservas y pagos del cliente. Se separan de la página porque son tres
// listas con el mismo esqueleto (columna de widgets apilados) y agrupadas llegaban a
// 330 líneas. Todas comparten dos reglas:
//
//   - LÍMITE DE 20. Un cliente con 200 pedidos no se lee en la ficha; para eso está
//     la búsqueda de la lista. Truncar y decirlo es mejor que renderizar 200 filas
//     que nadie va a recorrer.
//   - VACÍO CON PALABRA. "Sin pedidos todavía" y no un hueco en blanco: quien
//     pregunta por un cliente necesita distinguir "no ha pedido" de "no se pudo
//     cargar".

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/utils/date_formatter.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/kpi_tile.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../../domain/entities/admin_catalog.dart';
import '../../domain/entities/admin_payments.dart';
import '../../domain/entities/admin_spaces.dart';
import '../admin_customers_controller.dart';

/// KPIs de la ficha: pedidos, gasto, ticket promedio y minutos de silla.
class AdminCustomerKpis extends StatelessWidget {
  const AdminCustomerKpis({required this.summary, super.key});

  final AdminCustomerSummary summary;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = (constraints.maxWidth / 200).floor().clamp(1, 4);
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: AppSpacing.md,
          crossAxisSpacing: AppSpacing.md,
          childAspectRatio: 1.4,
          children: <Widget>[
            KpiTile(
              label: 'Pedidos',
              value: '${summary.history.totalOrders}',
              icon: Icons.receipt_long_rounded,
            ),
            KpiTile(
              label: 'Gasto total',
              value: '\$${summary.spentMinor ~/ 100}',
              icon: Icons.account_balance_wallet_outlined,
            ),
            KpiTile(
              label: 'Ticket promedio',
              value: '\$${summary.averageTicketMinor ~/ 100}',
              icon: Icons.receipt_outlined,
            ),
            KpiTile(
              label: 'Minutos de silla',
              value: '${summary.rentalMinutes}',
              icon: Icons.event_seat_rounded,
            ),
          ],
        );
      },
    );
  }
}

/// Lista de pedidos del cliente.
class AdminCustomerOrders extends StatelessWidget {
  const AdminCustomerOrders({required this.orders, super.key});

  final List<AdminOrder> orders;

  @override
  Widget build(BuildContext context) {
    if (orders.isEmpty) return const _EmptyHint('Sin pedidos todavía');
    return Column(
      children: <Widget>[
        for (final AdminOrder order in orders.take(20))
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: AppCard(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(order.orderNumber, style: AppTextStyles.titleSmall),
                        if (order.createdAt != null)
                          Text(
                            DateFormatter.dateTime(order.createdAt!),
                            style: AppTextStyles.captionSmall
                                .copyWith(color: context.tokens.textTertiary),
                          ),
                      ],
                    ),
                  ),
                  StatusBadge.order(order.status, compact: true),
                  const SizedBox(width: AppSpacing.md),
                  PriceDisplay(currentMinor: order.totalMinor),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Lista de reservas del cliente.
class AdminCustomerReservations extends StatelessWidget {
  const AdminCustomerReservations({required this.items, super.key});

  final List<AdminReservation> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const _EmptyHint('Sin reservas');
    return Column(
      children: <Widget>[
        for (final AdminReservation reservation in items.take(10))
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: AppCard(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      '${reservation.code} · ${reservation.chairCode ?? '—'}',
                      style: AppTextStyles.bodyMedium,
                    ),
                  ),
                  StatusBadge.reservation(reservation.status, compact: true),
                  const SizedBox(width: AppSpacing.md),
                  PriceDisplay(currentMinor: reservation.rentalTotalMinor),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Lista de pagos del cliente, con la referencia del datáfono cuando la hay.
class AdminCustomerPayments extends StatelessWidget {
  const AdminCustomerPayments({required this.payments, super.key});

  final List<AdminPayment> payments;

  @override
  Widget build(BuildContext context) {
    if (payments.isEmpty) return const _EmptyHint('Sin pagos registrados');
    return Column(
      children: <Widget>[
        for (final AdminPayment payment in payments.take(20))
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: AppCard(
              padding: const EdgeInsets.all(AppSpacing.md),
              child: Row(
                children: <Widget>[
                  Icon(
                    payment.method == 'CASH'
                        ? Icons.payments_rounded
                        : Icons.credit_card_rounded,
                    size: 18,
                    color: context.tokens.textSecondary,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      payment.paymentNumber ?? 'Pago #${payment.id}',
                      style: AppTextStyles.bodyMedium,
                    ),
                  ),
                  if (payment.providerReference != null)
                    Text(
                      'Ref. ${payment.providerReference}',
                      style: AppTextStyles.captionSmall
                          .copyWith(color: context.tokens.textInfo),
                    ),
                  const SizedBox(width: AppSpacing.md),
                  PriceDisplay(currentMinor: payment.amountMinor),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

/// Mensaje de lista vacía, con la palabra que explica el "por qué".
class _EmptyHint extends StatelessWidget {
  const _EmptyHint(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Text(
        text,
        style: AppTextStyles.bodySmall.copyWith(color: context.tokens.textTertiary),
      ),
    );
  }
}
