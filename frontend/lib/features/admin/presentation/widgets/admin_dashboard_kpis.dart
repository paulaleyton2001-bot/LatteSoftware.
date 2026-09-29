// Rejilla de KPIs del dashboard. MÓDULO `features/admin/presentation/widgets`.
//
// ⚠️ AQUÍ SE PINTAN LOS BASIS POINTS, Y SOLO AQUÍ
// `chairOccupancyRate` llega en basis points (4567 = 45,67 %). El cálculo
// `kpis.chairOccupancyPercent / 100` que hace este widget parece redundante con
// `AdminDashboardKpis.chairOccupancyPercent`, y a propósito lo es: deja escrito en
// la línea donde se PINTA que la división por 100 tiene que ocurrir. Si alguien
// "optimiza" la llamada anterior creyendo que está de más, aparecerá un 4567 %.
//
// LOS COLORES SON TOKENS, NO LITERALES
// El acento de cada KPI sale de `AppColors`. Un `Color(0x...)` aquí no se puede
// ver en un diff legible, y el contraste verificado de §1.4 de DESIGN-TOKENS se
// perdería en el primer ajuste.

import 'package:flutter/material.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/kpi_tile.dart';
import '../admin_dashboard_page.dart';
import '../admin_dashboard_view.dart';

/// Rejilla de KPIs del día.
///
/// `childAspectRatio: 1.45` es el que hace que el número quepa sin recortarse: con
/// una cifra más estrecha, `KpiTile` cae en `FittedBox` y se lee peor.
class AdminDashboardKpiGrid extends StatelessWidget {
  const AdminDashboardKpiGrid({required this.summary, super.key});

  final AdminDashboardData summary;

  @override
  Widget build(BuildContext context) {
    final AdminDashboardKpis kpis = summary.kpis;
    final DashboardComparison comparison = summary.comparison;

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = (constraints.maxWidth / 220).floor().clamp(1, 4);
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: AppSpacing.md,
          crossAxisSpacing: AppSpacing.md,
          childAspectRatio: 1.45,
          children: <Widget>[
            KpiTile(
              label: 'Ventas de hoy',
              value: CurrencyFormatter.formatMinor(kpis.netSalesMinor),
              icon: Icons.point_of_sale_rounded,
              // `percentChange` es un número CON SIGNO (-12.5 = caída del 12,5 %),
              // no basis points. `KpiTile` ya pone flecha y color según el signo.
              delta: comparison.percentChange,
              deltaLabel: comparison.hasData
                  ? 'vs. periodo anterior'
                  : 'sin periodo anterior',
            ),
            KpiTile(
              label: 'Pedidos',
              value: '${kpis.totalOrders}',
              icon: Icons.receipt_long_rounded,
              accent: context.tokens.stateInfo,
            ),
            KpiTile(
              label: 'Ticket promedio',
              value: CurrencyFormatter.formatMinor(kpis.averageTicketMinor),
              icon: Icons.receipt_outlined,
              accent: context.tokens.stateInfo,
            ),
            KpiTile(
              label: 'Clientes nuevos',
              value: '${kpis.newCustomers}',
              icon: Icons.person_add_alt_rounded,
              accent: context.tokens.stateInfo,
            ),
            KpiTile(
              label: 'Sillas ocupadas',
              // BASIS POINTS DIVIDIDOS ENTRE 100. Ver la cabecera del archivo.
              value: formatPercent(kpis.chairOccupancyPercent),
              icon: Icons.event_seat_rounded,
              accent: context.tokens.stateWarningStrong,
            ),
            KpiTile(
              label: 'Alquileres en curso',
              value: '${kpis.activeRentals}',
              icon: Icons.hourglass_bottom_rounded,
              accent: context.tokens.stateWarningStrong,
            ),
            KpiTile(
              label: 'Ingresos por alquiler',
              value: formatCompactMoney(kpis.rentalRevenueMinor),
              icon: Icons.payments_rounded,
              accent: context.tokens.textSuccess,
            ),
            KpiTile(
              label: 'Alertas de stock',
              value: '${kpis.inventoryAlertsCount}',
              icon: Icons.inventory_2_outlined,
              accent: kpis.inventoryAlertsCount > 0
                  ? context.tokens.actionDanger
                  : context.tokens.textSuccess,
            ),
          ],
        );
      },
    );
  }
}
