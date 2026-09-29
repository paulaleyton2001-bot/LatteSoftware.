// Pantalla de Inventario del panel.
//
// CUATRO SECCIONES EN UN SOLO SCROLL
// Totales, ítems, movimientos recientes y proveedores. Están en una sola pantalla
// porque el usuario va de una a otra: "este insumo está bajo → ¿cuándo entró? → ¿de
// quién lo compré?". Saltar de pestaña en pestaña lo haría sudar.
//
// EL AJUSTE ES LA ACCIÓN PRINCIPAL DE CADA ÍTEM
// Un `+10` o un `−5` con motivo obligatorio. Deliberadamente más simple que un
// formulario con saldo final y coste: en un almacén se corrigen DESCUADRES, no se
// inventan saldos. Quien necesite fijar un saldo exacto lo tiene en el mismo
// diálogo, en un campo aparte.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../core/utils/currency_formatter.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/kpi_tile.dart';
import '../../../shared/widgets/ui/section_header.dart';
import '../domain/entities/admin_inventory_item.dart';
import './admin_inventory_controller.dart';
import './widgets/admin_inventory_row.dart';
import './widgets/admin_inventory_sections.dart';
import './widgets/admin_list_and_state.dart';
import './widgets/admin_suppliers_card.dart';
import './widgets/admin_table_scaffold.dart';

/// Listado de inventario con movimientos y proveedores.
class AdminInventoryPage extends ConsumerStatefulWidget {
  const AdminInventoryPage({super.key});

  @override
  ConsumerState<AdminInventoryPage> createState() => _AdminInventoryPageState();
}

class _AdminInventoryPageState extends ConsumerState<AdminInventoryPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminInventoryItem>> items =
        ref.watch(adminInventoryProvider);
    final List<AdminInventoryItem> visible =
        ref.watch(adminVisibleInventoryProvider);
    final AdminInventoryTotals totals =
        ref.watch(adminInventoryTotalsProvider);
    final bool? lowOnly = ref.watch(adminLowStockOnlyProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        const AdminPageHeader(
          title: AppStrings.navInventory,
          subtitle: 'Insumos, movimientos, ajustes y proveedores',
        ),
        _TotalsGrid(totals: totals),
        const SizedBox(height: AppSpacing.lg),
        AdminFilterBar(
          controller: _search,
          searchHint: 'Nombre, SKU o proveedor…',
          onSearch: (String value) =>
              ref.read(adminInventorySearchProvider.notifier).state = value,
          filters: <AdminFilterOption>[
            AdminFilterOption(
              id: 'low',
              label: lowOnly == true ? 'Solo stock bajo' : 'Todo el stock',
              icon: Icons.warning_amber_rounded,
              isActive: lowOnly == true,
              onTap: () => ref
                  .read(adminLowStockOnlyProvider.notifier)
                  .state = lowOnly == true ? null : true,
            ),
          ],
        ),
        AsyncStateBuilder<List<AdminInventoryItem>>(
          value: items,
          loadingMessage: 'Cargando el inventario…',
          onRetry: () async => ref.invalidate(adminInventoryProvider),
          isEmpty: (List<AdminInventoryItem> data) => data.isEmpty,
          emptyIcon: Icons.inventory_2_outlined,
          emptyTitle: AppStrings.adminEmptyInventory,
          emptyMessage: 'Crea ítems de inventario para controlar los insumos.',
          builder: (BuildContext context, List<AdminInventoryItem> data) {
            if (visible.isEmpty) {
              return const AdminEmptyTable(
                icon: Icons.filter_alt_off_rounded,
                title: 'Ningún ítem coincide',
                message: 'Cambia la búsqueda o el filtro de stock bajo.',
              );
            }
            return ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: visible.length,
              separatorBuilder: (BuildContext context, int index) =>
                  const SizedBox(height: AppSpacing.sm),
              itemBuilder: (BuildContext context, int index) =>
                  AdminInventoryRow(item: visible[index]),
            );
          },
        ),
        const SizedBox(height: AppSpacing.xxl),
        const SectionHeader(
          title: 'Movimientos recientes',
          subtitle: 'Los últimos 30 días',
        ),
        const SizedBox(height: AppSpacing.md),
        const AdminInventoryMovementsCard(),
        const SizedBox(height: AppSpacing.xl),
        const SectionHeader(title: 'Proveedores'),
        const SizedBox(height: AppSpacing.md),
        const AdminSuppliersCard(),
      ],
    );
  }
}

/// Rejilla de totales de inventario.
class _TotalsGrid extends StatelessWidget {
  const _TotalsGrid({required this.totals});

  final AdminInventoryTotals totals;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = (constraints.maxWidth / 220).floor().clamp(1, 4);
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: AppSpacing.md,
          crossAxisSpacing: AppSpacing.md,
          childAspectRatio: 1.6,
          children: <Widget>[
            KpiTile(
              label: 'Valorizado (${totals.itemCount} ítems)',
              value: CurrencyFormatter.formatCompactMinor(totals.valueMinor),
              icon: Icons.savings_outlined,
            ),
            KpiTile(
              label: 'Stock bajo',
              value: '${totals.lowStockCount}',
              icon: Icons.warning_amber_rounded,
              accent: totals.lowStockCount > 0
                  ? context.tokens.stateWarningStrong
                  : context.tokens.textSuccess,
            ),
            KpiTile(
              label: 'Agotados',
              value: '${totals.outOfStockCount}',
              icon: Icons.error_outline_rounded,
              accent: totals.outOfStockCount > 0
                  ? context.tokens.actionDanger
                  : context.tokens.textSuccess,
            ),
          ],
        );
      },
    );
  }
}
