// Pantalla de Pagos del panel.
//
// LO QUE HACE DIFERENTE A ESTA PANTALLA
// El reembolso. Todo lo demás es un listado con filtros, y el resto del panel ya
// tiene piezas para eso. El reembolso parcial con motivo obligatorio y
// `ConfirmDialog` destructivo va en su propio archivo (`admin_refund_dialog.dart`)
// porque es la única acción de la app que mueve dinero hacia atrás.
//
// LOS MÉTODOS VIENEN DEL BACKEND
// `GET /payments/methods` refleja `businesses` y los adaptadores registrados. El
// filtro de la lista usa los cuatro `PaymentMethod` de la API, pero la etiqueta de
// "Tarjeta" lleva el matiz importante: el registro es manual, con la referencia que
// anotó el cajero.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../core/utils/currency_formatter.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/kpi_tile.dart';
import '../domain/entities/admin_payments.dart';
import './admin_payments_controller.dart';
import './widgets/admin_list_and_state.dart';
import './widgets/admin_payment_row.dart';
import './widgets/admin_table_scaffold.dart';

/// Listado de pagos del negocio.
class AdminPaymentsPage extends ConsumerStatefulWidget {
  const AdminPaymentsPage({super.key});

  @override
  ConsumerState<AdminPaymentsPage> createState() => _AdminPaymentsPageState();
}

class _AdminPaymentsPageState extends ConsumerState<AdminPaymentsPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminPayment>> payments =
        ref.watch(adminPaymentsProvider);
    final List<AdminPayment> visible = ref.watch(adminVisiblePaymentsProvider);
    final AdminPaymentsTotals totals = ref.watch(adminPaymentsTotalsProvider);
    final String? method = ref.watch(adminPaymentMethodFilterProvider);
    final String? status = ref.watch(adminPaymentStatusFilterProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        const AdminPageHeader(
          title: AppStrings.navPayments,
          subtitle: 'Cobros registrados en el local, en efectivo o con datáfono',
        ),
        _TotalsRow(totals: totals),
        const SizedBox(height: AppSpacing.lg),
        AdminFilterBar(
          controller: _search,
          searchHint: 'Número, referencia o pedido…',
          onSearch: (String value) =>
              ref.read(adminPaymentSearchProvider.notifier).state = value,
          filters: <AdminFilterOption>[
            AdminFilterOption(
              id: 'method',
              label: method == null
                  ? 'Método'
                  : (kAdminPaymentMethodLabels[method] ?? method),
              icon: Icons.payments_outlined,
              isActive: method != null,
              onTap: () => _pick(context, ref, 'method'),
            ),
            AdminFilterOption(
              id: 'status',
              label: status == null
                  ? 'Estado'
                  : (kAdminPaymentStatusLabels[status] ?? status),
              icon: Icons.flag_outlined,
              isActive: status != null,
              onTap: () => _pick(context, ref, 'status'),
            ),
          ],
        ),
        AsyncStateBuilder<List<AdminPayment>>(
          value: payments,
          loadingMessage: 'Cargando pagos…',
          onRetry: () async => ref.invalidate(adminPaymentsProvider),
          isEmpty: (List<AdminPayment> data) => data.isEmpty,
          emptyIcon: Icons.payments_outlined,
          emptyTitle: AppStrings.adminEmptyPayments,
          emptyMessage: 'Cambia el método o el estado para ver otros cobros.',
          builder: (BuildContext context, List<AdminPayment> data) {
            if (visible.isEmpty) {
              return const AdminEmptyTable(
                icon: Icons.filter_alt_off_rounded,
                title: 'Ningún pago coincide con la búsqueda',
                message: 'Prueba con el número de pago o la referencia del '
                    'datáfono.',
              );
            }
            return ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: visible.length,
              separatorBuilder: (BuildContext context, int index) =>
                  const SizedBox(height: AppSpacing.sm),
              itemBuilder: (BuildContext context, int index) =>
                  AdminPaymentRow(payment: visible[index]),
            );
          },
        ),
      ],
    );
  }

  /// Hoja de filtro de método o de estado.
  Future<void> _pick(
    BuildContext context,
    WidgetRef ref,
    String which,
  ) async {
    final bool isMethod = which == 'method';
    final Map<String, String> labels =
        isMethod ? kAdminPaymentMethodLabels : kAdminPaymentStatusLabels;
    final StateProvider<String?> provider = isMethod
        ? adminPaymentMethodFilterProvider
        : adminPaymentStatusFilterProvider;

    final String? picked = await showModalBottomSheet<String?>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            ListTile(
              title: const Text('Todos'),
              trailing: ref.read(provider) == null
                  ? const Icon(Icons.check_rounded)
                  : null,
              onTap: () => Navigator.of(sheetContext).pop(''),
            ),
            for (final MapEntry<String, String> entry in labels.entries)
              ListTile(
                title: Text(entry.value),
                trailing: ref.read(provider) == entry.key
                    ? const Icon(Icons.check_rounded)
                    : null,
                onTap: () => Navigator.of(sheetContext).pop(entry.key),
              ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    ref.read(provider.notifier).state = picked.isEmpty ? null : picked;
  }
}

/// Fila de totales: cobrado, reembolsado y neto.
class _TotalsRow extends StatelessWidget {
  const _TotalsRow({required this.totals});

  final AdminPaymentsTotals totals;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final int columns = (constraints.maxWidth / 220).floor().clamp(1, 3);
        return GridView.count(
          crossAxisCount: columns,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: AppSpacing.md,
          crossAxisSpacing: AppSpacing.md,
          childAspectRatio: 1.8,
          children: <Widget>[
            KpiTile(
              label: 'Cobrado (${totals.count} pagos)',
              value: CurrencyFormatter.formatMinor(totals.approvedMinor),
              icon: Icons.trending_up_rounded,
            ),
            KpiTile(
              label: 'Reembolsado',
              value: CurrencyFormatter.formatMinor(totals.refundedMinor),
              icon: Icons.undo_rounded,
            ),
            KpiTile(
              label: 'Neto en caja',
              value: CurrencyFormatter.formatMinor(totals.netMinor),
              icon: Icons.account_balance_wallet_outlined,
            ),
          ],
        );
      },
    );
  }
}
