// Leyenda de estados del plano. MÓDULO `features/admin/presentation/widgets`.
//
// DOS WIDGETS, DOS FUENTES
//   - [AdminSpaceCountsLegend] lee `countsByStatus` de `GET /chairs/map` (un
//     `Map<String, int>`) y la usan la pantalla de Sillas y el panel del mapa.
//   - [AdminSpaceCountsCard] lee `SpaceCounts`, los campos anidados de
//     `currentSpaces` en `GET /reports/dashboard`.
// Son dos formas de lo mismo en endpoints distintos. Un widget que aceptara las dos
// terminaría lleno de ceros en uno de los dos, así que hay dos a propósito.
//
// DISTINTO DEL CONTADOR DEL DASHBOARD A PROPÓSITO
// Aquí los estados vienen de `countsByStatus` del propio `GET /chairs/map`, que es
// un `Map<String, int>`. En el dashboard vienen anidados en `currentSpaces`. Son
// dos formas de lo mismo en endpoints distintos; un widget que aceptara las dos
// terminaría lleno de `null` en uno de los dos sitios.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/progress_ring.dart';
import '../../../../shared/widgets/ui/status_badge.dart';
import '../admin_dashboard_view.dart';

/// Leyenda de los estados de silla, con su contador.
class AdminSpaceCountsLegend extends StatelessWidget {
  const AdminSpaceCountsLegend({required this.counts, super.key});

  /// `countsByStatus` de `GET /chairs/map`.
  final Map<String, int> counts;

  /// Orden fijo: el ciclo de vida de una silla, de libre a bloqueada.
  static const List<String> kOrder = <String>[
    'AVAILABLE',
    'OCCUPIED',
    'RESERVED',
    'CLEANING',
    'MAINTENANCE',
    'BLOCKED',
  ];

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: <Widget>[
        for (final String status in kOrder)
          _LegendChip(
            status: status,
            count: counts[status] ?? 0,
          ),
      ],
    );
  }
}

/// Tarjeta de ocupación de sillas del dashboard.
///
/// Toma [SpaceCounts] (los campos anidados de `currentSpaces`) y no un
/// `Map<String, int>`: son fuentes distintas y mezclarlas dejaría ceros.
/// Muestra el anillo de ocupación y el desglose por estado, que es la pregunta que
/// se hace quien abre el panel a las ocho de la mañana: "¿cuántas me quedan?".
class AdminSpaceCountsCard extends StatelessWidget {
  const AdminSpaceCountsCard({
    required this.counts,
    required this.kpis,
    super.key,
  });

  /// `currentSpaces` de `GET /reports/dashboard`.
  final SpaceCounts counts;

  /// Los KPIs crudos. Se pasan porque `chairOccupancyRate` (basis points) es la
  /// segunda fuente de ocupación y no siempre cuadra con el desglose: cuando no
  /// cuadran, el backend manda y se muestra el porcentaje oficial.
  final AdminDashboardKpis kpis;

  /// Orden del ciclo de vida de una silla, de libre a bloqueada.
  static const List<String> kOrder = <String>[
    'AVAILABLE',
    'OCCUPIED',
    'RESERVED',
    'CLEANING',
    'MAINTENANCE',
    'BLOCKED',
  ];

  int _countOf(String status) => switch (status) {
        'AVAILABLE' => counts.available,
        'OCCUPIED' => counts.occupied,
        'RESERVED' => counts.reserved,
        'CLEANING' => counts.cleaning,
        'MAINTENANCE' => counts.maintenance,
        'BLOCKED' => counts.blocked,
        _ => 0,
      };

  @override
  Widget build(BuildContext context) {
    // La ocupación OFICIAL es la del backend (`chairOccupancyRate` en basis
    // points): si el desglose no cuadra con ella, es el backend el que sabe
    // cuántas sillas hay. Ver la cabecera de `admin_dashboard_view.dart`.
    final double percent = bpToPercent(kpis.chairOccupancyRateBp);
    final bool hasChairs = counts.total > 0;

    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      semanticLabel: 'Ocupación de sillas: ${formatPercent(percent)} de '
          '${counts.total} sillas',
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          // El anillo es decorativo: el porcentaje ya está en el `semanticLabel`
          // del card, así que el lector no lo oye dos veces.
          ExcludeSemantics(
            child: hasChairs
                ? AppProgressRing(progress: percent / 100, size: 88)
                : SizedBox.square(
                    dimension: 88,
                    child: Icon(
                      Icons.event_seat_outlined,
                      size: 36,
                      color: context.tokens.stateNeutral,
                    ),
                  ),
          ),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  hasChairs
                      ? '${formatPercent(percent)} ocupadas'
                      : 'Sin sillas registradas',
                  style: AppTextStyles.titleSmall,
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  '${counts.bookable} disponibles de ${counts.total}',
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
                const SizedBox(height: AppSpacing.sm),
                Wrap(
                  spacing: AppSpacing.xs,
                  runSpacing: AppSpacing.xs,
                  children: <Widget>[
                    for (final String status in kOrder)
                      _LegendChip(status: status, count: _countOf(status)),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Chip de leyenda: `StatusBadge` compacto + contador.
class _LegendChip extends StatelessWidget {
  const _LegendChip({required this.status, required this.count});

  final String status;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${StatusBadge.chair(status).resolved.label}: $count',
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.xxs,
        ),
        decoration: BoxDecoration(
          color: context.tokens.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadii.pill),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            StatusBadge.chair(status, compact: true),
            const SizedBox(width: AppSpacing.xs),
            Text(
              '$count',
              style: AppTextStyles.labelMedium
                  .copyWith(color: context.tokens.textStrong),
            ),
          ],
        ),
      ),
    );
  }
}
