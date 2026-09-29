// Pantalla de Reportes del panel.
//
// EL SELECTOR DE PRESET MANDA TODAS LAS CONSULTAS
// Un solo control (Hoy / Ayer / 7 / 30 / este mes / mes anterior / personalizado)
// alimenta los cuatro reportes de golpe. Es lo que evita el error clásico de una
// pantalla donde el gráfico dice "últimos 7 días" y la tabla dice "mes": si hubiera
// un selector por gráfico, acabarían mostrando periodos distintos sin que nadie se
// entere.
//
// EL CSV SE MUESTRA, NO SE GUARDA EN UN ARCHIVO
// `POST /reports/export` devuelve `text/csv`. La app lo muestra en un diálogo con
// las primeras líneas y lo deja COPIAR al portapapeles, en vez de inventar una
// descarga que requeriría una dependencia de archivos que `pubspec.yaml` no tiene.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/utils/currency_formatter.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/kpi_tile.dart';
import '../../../shared/widgets/ui/section_header.dart';
import './admin_dashboard_series.dart';
import './admin_dashboard_view.dart';
import './admin_reports_controller.dart';
import './charts/admin_daily_chart.dart';
import './charts/admin_hour_chart.dart';
import './charts/admin_top_products_chart.dart';
import './widgets/admin_custom_range_bar.dart';
import './widgets/admin_detail_row.dart';
import './widgets/admin_export_dialog.dart';
import './widgets/admin_table_scaffold.dart';

/// Reportes del negocio con selector de rango y exportación.
class AdminReportsPage extends ConsumerWidget {
  const AdminReportsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String preset = ref.watch(adminReportPresetProvider);
    final AsyncValue<AdminReportsData> reports = ref.watch(adminReportsProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        AdminPageHeader(
          title: 'Reportes',
          subtitle: 'Ventas, ocupación y productos del periodo elegido',
          actions: <Widget>[
            AdminHeaderAction(
              icon: Icons.download_outlined,
              tooltip: 'Exportar a CSV',
              onPressed: () => showAdminExportDialog(context, ref),
            ),
          ],
        ),
        _PresetBar(preset: preset),
        // La barra de fechas solo aparece con «Personalizado»: con un preset el
        // rango ya lo decide el servidor, y enseñarlo sugeriría que se puede
        // cambiar sin cambiar de preset.
        if (preset == 'custom') const AdminCustomRangeBar(),
        AsyncStateBuilder<AdminReportsData>(
          value: reports,
          loadingMessage: 'Calculando el informe…',
          onRetry: () async => ref.invalidate(adminReportsProvider),
          builder: (BuildContext context, AdminReportsData data) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              _SummaryRow(data: data),
              const SizedBox(height: AppSpacing.xl),
              const SectionHeader(title: 'Ventas por día'),
              AdminSalesByDayChart(points: data.byDay),
              const SizedBox(height: AppSpacing.xl),
              const SectionHeader(title: 'Ventas por hora'),
              AdminSalesByHourChart(points: data.byHour),
              const SizedBox(height: AppSpacing.xl),
              const SectionHeader(title: 'Productos más vendidos'),
              AdminTopProductsChart(products: data.topProducts),
            ],
          ),
        ),
      ],
    );
  }
}

/// Barra de presets. Un `Wrap` de chips, no un `DropdownButton`: son siete
/// opciones y se elige viendo los nombres, no por memoria.
class _PresetBar extends ConsumerWidget {
  const _PresetBar({required this.preset});

  final String preset;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: <Widget>[
          for (final (String, String) option in kAdminReportPresets)
            _PresetChip(
              label: option.$2,
              selected: option.$1 == preset,
              onTap: () =>
                  ref.read(adminReportPresetProvider.notifier).state = option.$1,
            ),
          _PresetChip(
            label: 'Personalizado',
            selected: preset == 'custom',
            onTap: () => ref.read(adminReportPresetProvider.notifier).state = 'custom',
          ),
        ],
      ),
    );
  }
}

/// Chip de preset, con `Semantics(selected:)` y alto ≥ 44 dp.
class _PresetChip extends StatelessWidget {
  const _PresetChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      label: label,
      excludeSemantics: true,
      child: Material(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: selected ? context.tokens.brandDark : context.tokens.borderDefault,
                width: selected ? 2 : 1,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (selected) ...<Widget>[
                  Icon(Icons.check_rounded,
                      size: 16, color: context.tokens.brandDark),
                  const SizedBox(width: AppSpacing.xs),
                ],
                Text(
                  label,
                  style: AppTextStyles.labelLarge
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Resumen del periodo: total, pedidos, ocupación y ticket promedio.
class _SummaryRow extends StatelessWidget {
  const _SummaryRow({required this.data});

  final AdminReportsData data;

  @override
  Widget build(BuildContext context) {
    final int totalMinor = data.byDay.fold<int>(
      0,
      (int acc, DailyPoint point) => acc + point.totalMinor,
    );
    final int orders = data.byDay.fold<int>(
      0,
      (int acc, DailyPoint point) => acc + point.orders,
    );

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = (constraints.maxWidth / 220).floor().clamp(1, 4);
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: AppSpacing.md,
          crossAxisSpacing: AppSpacing.md,
          childAspectRatio: 1.5,
          children: <Widget>[
            KpiTile(
              label: 'Ventas del periodo',
              value: CurrencyFormatter.formatCompactMinor(totalMinor),
              icon: Icons.point_of_sale_rounded,
            ),
            KpiTile(
              label: 'Pedidos',
              value: '$orders',
              icon: Icons.receipt_long_rounded,
            ),
            KpiTile(
              label: 'Ticket promedio',
              value: orders == 0
                  ? r'$0'
                  : CurrencyFormatter.formatCompactMinor(totalMinor ~/ orders),
              icon: Icons.receipt_outlined,
            ),
            KpiTile(
              label: 'Ocupación de sillas',
              // YA VIENE COMO PORCENTAJE (no basis points) en este reporte.
              value: formatPercent(data.utilizationPercent),
              icon: Icons.event_seat_rounded,
            ),
          ],
        );
      },
    );
  }
}
