// Dashboard: KPIs, series, ocupación de sillas y alertas de inventario.
//
// EL DASHBOARD SON CUATRO PREGUNTAS, EN ESTE ORDEN
//   1. ¿Cuánto vendimos hoy?       → KPIs + serie por hora
//   2. ¿Cómo va respecto a ayer?   → comparación del backend
//   3. ¿Cuántas sillas hay libres? → `currentSpaces` + anillo de ocupación
//   4. ¿Falta algo para producir?  → alertas de inventario
// Ese orden decide qué va arriba: los números grandes se leen de un vistazo y
// bajando se llega al detalle.
//
// PRESET FIJO: `today`
// El resumen es de HOY. Los rangos largos (7, 30 días) son de la pantalla de
// Reportes, que tiene su propio selector. Meter un selector aquí haría que
// "ventas del día" pudiera dejar de ser del día, que es justo lo que se comprueba
// al abrir la app.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../core/error/failures.dart';
import '../../../core/result/result.dart';
import '../../../data/models/json_reader.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/section_header.dart';
import './admin_dashboard_series.dart';
import './admin_dashboard_view.dart';
import './admin_providers.dart';
import './charts/admin_daily_chart.dart';
import './charts/admin_hour_chart.dart';
import './widgets/admin_dashboard_kpis.dart';
import './widgets/admin_inventory_alerts.dart';
import './widgets/admin_space_counts.dart';
import './widgets/admin_top_products.dart';

/// Datos del dashboard ya agrupados para pintar.
class AdminDashboardData {
  const AdminDashboardData({
    required this.kpis,
    required this.spaces,
    required this.comparison,
    required this.hours,
    required this.days,
    required this.topProducts,
    required this.alerts,
  });

  final AdminDashboardKpis kpis;
  final SpaceCounts spaces;
  final DashboardComparison comparison;

  /// `GET /reports/sales-by-hour` con `preset: today`: las 24 horas.
  final List<HourPoint> hours;

  /// `GET /reports/sales-by-day` con `preset: last7`: la última semana.
  ///
  /// El dashboard NO envía `from`/`to` porque el backend los exige en ISO-8601
  /// con offset y el navegador solo tiene zona local; el preset es la vía que no
  /// necesita esa conversión. Los dos presets se eligen aquí y no en la pantalla
  /// porque son parte del CONTRATO del widget, no una preferencia de quien mira.
  final List<DailyPoint> days;

  final List<TopProduct> topProducts;

  /// Alertas de inventario (`GET /inventory/alerts`).
  final List<Map<String, dynamic>> alerts;

  /// `true` si no hay nada que enseñar (local recién abierto o cerrado).
  bool get isEmpty =>
      kpis.totalOrders == 0 && kpis.activeRentals == 0 && alerts.isEmpty;
}

/// `GET /reports/dashboard` + `/reports/sales-by-hour` + `/reports/sales-by-day`
/// + `/inventory/alerts`.
///
/// Las cuatro se piden a la vez con `Future.wait` porque son independientes:
/// encadenarlas sumaría cuatro idas y vueltas de red en el primer frame, que es
/// justo lo que el cajero o el gerente nota al abrir el panel.
final FutureProvider<AdminDashboardData> adminDashboardProvider =
    FutureProvider<AdminDashboardData>(
  (Ref ref) async {
    final Result<Map<String, dynamic>> dashboard =
        await ref.watch(adminOpsRepositoryProvider).dashboard();
    if (dashboard case FailureResult<Map<String, dynamic>>(:final Failure failure)) {
      throw failure;
    }

    final List<Object> rest = await Future.wait<Object>(<Future<Object>>[
      _readHours(ref),
      _readDays(ref),
      _readAlerts(ref),
    ]);

    final Map<String, dynamic> data =
        (dashboard as Success<Map<String, dynamic>>).value;
    return AdminDashboardData(
      kpis: AdminDashboardKpis.fromJson(
        JsonReader.map(data['kpis']) ?? const <String, dynamic>{},
      ),
      spaces: AdminDashboardKpis.spacesFrom(
        JsonReader.map(data['currentSpaces']) ?? const <String, dynamic>{},
      ),
      comparison: DashboardComparison.fromJson(
        JsonReader.map(JsonReader.map(data['comparison'])?['vsPreviousPeriod']) ??
            const <String, dynamic>{},
      ),
      hours: rest[0] as List<HourPoint>,
      days: rest[1] as List<DailyPoint>,
      topProducts: TopProduct.fromRows(
        JsonReader.mapList(data['topProducts']),
      ),
      alerts: rest[2] as List<Map<String, dynamic>>,
    );
  },
  name: 'adminDashboard',
);

/// `GET /reports/sales-by-hour?preset=today`.
///
/// Si falla se devuelve una lista vacía: el gráfico se oculta y el resto del
/// dashboard sigue siendo útil. Un 500 en un gráfico no puede tapar los KPIs.
Future<List<HourPoint>> _readHours(Ref ref) async {
  final Result<List<Map<String, dynamic>>> result =
      await ref.read(adminOpsRepositoryProvider).salesByHour(preset: 'today');
  return switch (result) {
    Success<List<Map<String, dynamic>>>(:final List<Map<String, dynamic>> value) =>
      HourPoint.fromRows(value),
    FailureResult<List<Map<String, dynamic>>>() => const <HourPoint>[],
  };
}

/// `GET /reports/sales-by-day?preset=last7`.
///
/// `last7` y no `last30`: en el dashboard la pregunta es «cómo van los días» y
/// siete puntos se leen de un vistazo; un mes necesita un gráfico de barras
/// aparte, que es lo que hay en Reportes.
Future<List<DailyPoint>> _readDays(Ref ref) async {
  final Result<List<Map<String, dynamic>>> result =
      await ref.read(adminOpsRepositoryProvider).salesByDay(preset: 'last7');
  return switch (result) {
    Success<List<Map<String, dynamic>>>(:final List<Map<String, dynamic>> value) =>
      DailyPoint.fromRows(value),
    FailureResult<List<Map<String, dynamic>>>() => const <DailyPoint>[],
  };
}

/// `GET /inventory/alerts`. Mismo criterio: si falla, la sección se oculta.
Future<List<Map<String, dynamic>>> _readAlerts(Ref ref) async {
  final Result<List<Map<String, dynamic>>> result =
      await ref.read(adminInventoryRepositoryProvider).alerts();
  return switch (result) {
    Success<List<Map<String, dynamic>>>(:final value) => value,
    FailureResult<List<Map<String, dynamic>>>() => const <Map<String, dynamic>>[],
  };
}

/// Pantalla de resumen del negocio.
class AdminDashboardPage extends ConsumerWidget {
  const AdminDashboardPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AdminDashboardData> data = ref.watch(adminDashboardProvider);
    final double padding = context.breakpoint.screenPadding;

    return AsyncStateBuilder<AdminDashboardData>(
      value: data,
      loadingMessage: 'Cargando el resumen del negocio…',
      onRetry: () async => ref.invalidate(adminDashboardProvider),
      builder: (BuildContext context, AdminDashboardData summary) {
        if (summary.isEmpty) return const _ClosedBusiness();
        return ListView(
          padding: EdgeInsets.fromLTRB(
            padding,
            AppSpacing.xl,
            padding,
            AppSpacing.xxl,
          ),
          children: <Widget>[
            AdminDashboardKpiGrid(summary: summary),
            const SizedBox(height: AppSpacing.xl),
            const SectionHeader(
              title: 'Ventas por hora',
              subtitle: 'Hoy, en la zona horaria del negocio',
            ),
            AdminSalesByHourChart(points: summary.hours),
            const SizedBox(height: AppSpacing.xl),
            const SectionHeader(
              title: 'Ventas por día',
              subtitle: 'Últimos 7 días, agrupados por día',
            ),
            AdminSalesByDayChart(points: summary.days),
            const SizedBox(height: AppSpacing.xl),
            const SectionHeader(title: 'Ocupación de sillas'),
            AdminSpaceCountsCard(counts: summary.spaces, kpis: summary.kpis),
            const SizedBox(height: AppSpacing.xl),
            const SectionHeader(title: 'Productos más vendidos'),
            AdminTopProductsCard(products: summary.topProducts),
            if (summary.alerts.isNotEmpty) ...<Widget>[
              const SizedBox(height: AppSpacing.xl),
              const SectionHeader(
                title: 'Alertas de inventario',
                subtitle: 'Lo que está por acabarse o ya se acabó',
              ),
              AdminInventoryAlertsCard(alerts: summary.alerts),
            ],
          ],
        );
      },
    );
  }
}

/// Local sin actividad: no es un error, es un martes a las 8 de la mañana.
class _ClosedBusiness extends StatelessWidget {
  const _ClosedBusiness();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.storefront_outlined,
                size: 40, color: context.tokens.stateNeutral),
            const SizedBox(height: AppSpacing.sm),
            Text('Todavía no hay actividad hoy',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'En cuanto se registre la primera venta, aquí verás las ventas por '
              'hora y por día, la ocupación y los productos más pedidos.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}
