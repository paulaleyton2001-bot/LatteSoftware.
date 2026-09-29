// Listado de clientes del panel.
//
// LA FICHA ES UNA PANTALLA COMPLETA
// Un cliente tiene pedidos, reservas, alquileres y pagos: meterlo todo en un
// `ExpansionTile` dentro de la lista produce una tabla gigante que hay que
// desplegar y replegar. La ficha va en su propia pantalla, que además sobrevive a
// un refresco porque tiene ruta.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/utils/currency_formatter.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../shared/constants/app_strings.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/price_display.dart';
import '../domain/entities/admin_accounts.dart';
import './admin_customer_detail_page.dart';
import './admin_customers_controller.dart';
import './widgets/admin_list_and_state.dart';
import './widgets/admin_table_scaffold.dart';

/// Listado de clientes.
class AdminCustomersPage extends ConsumerStatefulWidget {
  const AdminCustomersPage({super.key});

  @override
  ConsumerState<AdminCustomersPage> createState() => _AdminCustomersPageState();
}

class _AdminCustomersPageState extends ConsumerState<AdminCustomersPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<AdminCustomer>> customers =
        ref.watch(adminCustomersProvider);
    final List<AdminCustomer> visible =
        ref.watch(adminVisibleCustomersProvider);
    final String? status = ref.watch(adminCustomerStatusProvider);
    final double padding = context.breakpoint.screenPadding;

    return ListView(
      padding: EdgeInsets.fromLTRB(padding, AppSpacing.xl, padding, AppSpacing.xxl),
      children: <Widget>[
        const AdminPageHeader(
          title: AppStrings.navCustomers,
          subtitle: 'Fichas, historial de pedidos, reservas y pagos',
        ),
        AdminFilterBar(
          controller: _search,
          searchHint: 'Nombre, correo o teléfono…',
          onSearch: (String value) =>
              ref.read(adminCustomerSearchProvider.notifier).state = value,
          filters: <AdminFilterOption>[
            if (status != null)
              AdminFilterOption(
                id: 'status',
                label: status == 'ACTIVE' ? 'Activos' : 'Bloqueados',
                icon: Icons.person_outline_rounded,
                isActive: true,
                onTap: () =>
                    ref.read(adminCustomerStatusProvider.notifier).state = null,
              ),
          ],
        ),
        AsyncStateBuilder<List<AdminCustomer>>(
          value: customers,
          loadingMessage: 'Cargando clientes…',
          onRetry: () async => ref.invalidate(adminCustomersProvider),
          isEmpty: (List<AdminCustomer> data) => data.isEmpty,
          emptyIcon: Icons.people_outline_rounded,
          emptyTitle: AppStrings.adminEmptyCustomers,
          emptyMessage: 'Los clientes aparecen aquí cuando se registran desde '
              'la app o piden por primera vez.',
          builder: (BuildContext context, List<AdminCustomer> data) {
            if (visible.isEmpty) {
              return const AdminEmptyTable(
                icon: Icons.filter_alt_off_rounded,
                title: 'Ningún cliente coincide',
                message: 'Prueba con el correo o el teléfono.',
              );
            }
            return ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
              itemCount: visible.length,
              separatorBuilder: (BuildContext context, int index) =>
                  const SizedBox(height: AppSpacing.sm),
              itemBuilder: (BuildContext context, int index) =>
                  _CustomerCard(customer: visible[index]),
            );
          },
        ),
      ],
    );
  }
}

/// Tarjeta de un cliente en el listado.
class _CustomerCard extends StatelessWidget {
  const _CustomerCard({required this.customer});

  final AdminCustomer customer;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: const EdgeInsets.all(AppSpacing.md),
      onTap: () => openAdminCustomerDetail(context, customer.id),
      semanticLabel:
          '${customer.fullName}, ${customer.totalOrders} pedidos, gasto '
          '${CurrencyFormatter.formatMinor(customer.totalSpentMinor)}',
      child: Row(
        children: <Widget>[
          _Avatar(initials: customer.initials),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Flexible(
                      child: Text(
                        customer.fullName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTextStyles.titleSmall,
                      ),
                    ),
                    if (!customer.isActive) ...<Widget>[
                      const SizedBox(width: AppSpacing.sm),
                      Text(
                        customer.status == 'BLOCKED' ? 'Bloqueado' : 'Inactivo',
                        style: AppTextStyles.labelMedium
                            .copyWith(color: context.tokens.textError),
                      ),
                    ],
                  ],
                ),
                Text(
                  customer.email,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTextStyles.captionSmall
                      .copyWith(color: context.tokens.textTertiary),
                ),
                if (customer.lastOrderAt != null)
                  Text(
                    'Último pedido ${DateFormatter.relative(customer.lastOrderAt!)}',
                    style: AppTextStyles.captionSmall
                        .copyWith(color: context.tokens.textTertiary),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.md),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: <Widget>[
              Text('${customer.totalOrders} pedidos',
                  style: AppTextStyles.labelMedium),
              PriceDisplay(currentMinor: customer.totalSpentMinor),
            ],
          ),
        ],
      ),
    );
  }
}

/// Monograma del cliente. Iniciales, no foto: `GET /customers` no devuelve foto y
/// un avatar vacío con iniciales es mejor que un hueco.
class _Avatar extends StatelessWidget {
  const _Avatar({required this.initials});

  final String initials;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 44,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: context.tokens.surfaceGreenSubtle,
        shape: BoxShape.circle,
        border: Border.all(color: context.tokens.borderDefault),
      ),
      child: Text(
        initials,
        style: AppTextStyles.titleMedium.copyWith(color: context.tokens.textSuccess),
      ),
    );
  }
}

/// Abre la ficha del cliente [customerId].
Future<void> openAdminCustomerDetail(BuildContext context, int customerId) =>
    Navigator.of(context).push<void>(
      MaterialPageRoute<void>(
        builder: (BuildContext context) =>
            AdminCustomerDetailPage(customerId: customerId),
      ),
    );
