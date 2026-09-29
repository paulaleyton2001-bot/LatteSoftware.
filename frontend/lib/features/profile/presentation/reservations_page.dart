// Historial de reservas del cliente (`GET /customers/:id/reservations`).
//
// SEPARADA DE LOS PEDIDOS A PROPÓSITO
// Una reserva (silla apartada) y un pedido (lo que comiste) son cosas distintas:
// se pueden tener reservas sin pedidos, y un pedido de productos sin reserva. La
// API las expone en endpoints separados y por eso tienen pantallas separadas.
//
// LA SILLA Y LA FRANJA
// Se muestra la silla concreta (`chairCode`) y la franja completa con
// `DateFormatter.range`, que es el formato que el design system fija para
// "del día, a tal hora": `28/09/2026 14:35 – 16:45`.



import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/routes.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/price_display.dart';
import '../../../shared/widgets/ui/status_badge.dart';
import '../domain/entities/customer_stats.dart';
import './profile_controller.dart';

/// Historial de reservas.
class MyReservationsPage extends ConsumerWidget {
  const MyReservationsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<CustomerReservation>> reservations =
        ref.watch(myReservationsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Mis reservas')),
      body: SafeArea(
        child: AsyncStateBuilder<List<CustomerReservation>>(
          value: reservations,
          loadingMessage: 'Cargando tus reservas…',
          onRetry: () async => ref.invalidate(myReservationsProvider),
          isEmpty: (List<CustomerReservation> data) => data.isEmpty,
          emptyIcon: Icons.event_note_rounded,
          emptyTitle: 'No tienes reservas',
          emptyMessage: 'Cuando reserves una silla, aquí verás la fecha, la hora '
              'y cuánto te costó.',
          emptyActionLabel: 'Ver el menú',
          onEmptyAction: () => context.go(AppRoutes.menu),
          builder: (BuildContext context, List<CustomerReservation> data) =>
              ListView.separated(
            padding: const EdgeInsets.all(AppSpacing.lg),
            itemCount: data.length,
            separatorBuilder: (BuildContext context, int index) =>
                const SizedBox(height: AppSpacing.md),
            itemBuilder: (BuildContext context, int index) =>
                _ReservationCard(reservation: data[index]),
          ),
        ),
      ),
    );
  }
}

/// Tarjeta de una reserva.
class _ReservationCard extends StatelessWidget {
  const _ReservationCard({required this.reservation});

  final CustomerReservation reservation;

  @override
  Widget build(BuildContext context) {
    final DateTime? start = reservation.startAt;
    final DateTime? end = reservation.endAt;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Expanded(
                child: Text(
                  reservation.chairCode == null
                      ? 'Silla reservada'
                      : 'Silla ${reservation.chairCode}',
                  style: AppTextStyles.titleMedium,
                ),
              ),
              StatusBadge.reservation(reservation.status, compact: true),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          if (start != null && end != null)
            Text(
              DateFormatter.range(start, end),
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
          if (reservation.durationMinutes > 0) ...<Widget>[
            const SizedBox(height: AppSpacing.xxs),
            Text(
              'Duración: ${DateFormatter.durationLong(Duration(minutes: reservation.durationMinutes))}',
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textTertiary),
            ),
          ],
          if (reservation.rentalTotalMinor > 0) ...<Widget>[
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: <Widget>[
                Expanded(
                  child: Text('Coste estimado', style: AppTextStyles.bodySmall),
                ),
                PriceDisplay(currentMinor: reservation.rentalTotalMinor),
              ],
            ),
          ],
          if (reservation.code != null) ...<Widget>[
            const SizedBox(height: AppSpacing.xs),
            Text(
              reservation.code!,
              style: AppTextStyles.captionSmall
                  .copyWith(color: context.tokens.textTertiary),
            ),
          ],
        ],
      ),
    );
  }
}
