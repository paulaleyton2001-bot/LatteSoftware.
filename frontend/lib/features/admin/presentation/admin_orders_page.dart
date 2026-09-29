// Pantalla de Órdenes del panel.
//
// QUÉ SE VE
// Una lista de todos los pedidos con filtros por estado, tipo, texto y rango de
// fechas. Cada fila abre el detalle, que trae líneas, pagos, reembolsos y
// comprobante.
//
// LOS FILTROS VIAJAN AL SERVIDOR, NO EN MEMORIA
// A diferencia del POS (que trae 100 pedidos y los filtra en local para que el
// teclado responda al instante), aquí el rango de fechas puede abarcar meses: traer
// todo y filtrar en el cliente gastaría cuota de red y tardaría más cuanto más
// antiguo se mire. Cada cambio de filtro dispara una petición nueva.
//
// EL SALDO PENDIENTE SE MARCA
// Un pedido con `balanceMinor > 0` muestra "Sin cobrar" con icono. Es la
// información que evita el peor error de una caja: dar por pagado lo que no se
// pagó.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/admin_catalog.dart';
import './admin_order_detail_page.dart';
import './admin_orders_controller.dart';
import './widgets/admin_filter_sheets.dart';
import './widgets/admin_order_row.dart';
import './widgets/admin_table_scaffold.dart';

/// Listado de todos los pedidos del negocio.
class AdminOrdersPage extends ConsumerStatefulWidget {
  const AdminOrdersPage({super.key});

  @override
  ConsumerState<AdminOrdersPage> createState() => _AdminOrdersPageState();
}

class _AdminOrdersPageState extends ConsumerState<AdminOrdersPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminOrder>> orders = ref.watch(adminOrdersProvider);
    final double padding = context.breakpoint.screenPadding;
    final String? status = ref.watch(adminOrderStatusFilterProvider);
    final String? type = ref.watch(adminOrderTypeFilterProvider);
    final String? preset = ref.watch(adminOrderPresetProvider);

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        AdminPageHeader(
          title: AppStrings.navOrders,
          subtitle: 'Todos los pedidos del negocio, con su estado y su cobro',
        ),
        AdminFilterBar(
          controller: _search,
          searchHint: 'Número de pedido o nota…',
          onSearch: (String value) =>
              ref.read(adminOrderSearchProvider.notifier).state = value,
          filters: <AdminFilterOption>[
            AdminFilterOption(
              id: 'status',
              label: status == null
                  ? 'Estado'
                  : (kAdminOrderStatusLabels[status] ?? status),
              icon: Icons.flag_outlined,
              isActive: status != null,
              onTap: () => showAdminOrderStatusSheet(context, ref),
            ),
            AdminFilterOption(
              id: 'type',
              label: type == null ? 'Tipo' : _typeLabel(type),
              icon: Icons.local_cafe_outlined,
              isActive: type != null,
              onTap: () => showAdminOrderTypeSheet(context, ref),
            ),
            AdminFilterOption(
              id: 'range',
              label: _rangeLabel(preset),
              icon: Icons.date_range_rounded,
              isActive: preset != null,
              onTap: () => showAdminOrderRangeSheet(context, ref),
            ),
          ],
        ),
        AsyncStateBuilder<List<AdminOrder>>(
          value: orders,
          loadingMessage: 'Cargando pedidos…',
          onRetry: () async => ref.invalidate(adminOrdersProvider),
          isEmpty: (List<AdminOrder> data) => data.isEmpty,
          emptyIcon: Icons.receipt_long_outlined,
          emptyTitle: AppStrings.adminEmptyOrders,
          emptyMessage: 'Cambia los filtros o amplía el rango de fechas.',
          builder: (BuildContext context, List<AdminOrder> data) =>
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
            itemCount: data.length,
            separatorBuilder: (BuildContext context, int index) =>
                const SizedBox(height: AppSpacing.sm),
            itemBuilder: (BuildContext context, int index) => AdminOrderRow(
              order: data[index],
              onTap: () => openAdminOrderDetail(context, data[index].id),
            ),
          ),
        ),
      ],
    );
  }

  /// Etiqueta del filtro de rango. Es método de instancia (y no estático) porque
  /// con `preset = 'custom'` hay que leer el rango del provider.
  String _rangeLabel(String? preset) => switch (preset) {
        'today' => AppStrings.presetToday,
        'yesterday' => AppStrings.presetYesterday,
        'last7' => AppStrings.presetLast7,
        'last30' => AppStrings.presetLast30,
        'custom' => ref.read(adminOrderRangeProvider).label,
        null => 'Cualquier fecha',
        _ => preset,
      };

  static String _typeLabel(String type) => switch (type) {
        'TAKEAWAY' => 'Para llevar',
        'DINE_IN' => 'En el local',
        'CHAIR_RENTAL' => 'Alquiler',
        _ => type,
      };
}
