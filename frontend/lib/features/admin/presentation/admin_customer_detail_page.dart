// Ficha de un cliente. MÓDULO `features/admin/presentation`.
//
// ⚠️ CÓMO SE COMPONE SU HISTORIAL
// `GET /customers/:id/orders`, `/:id/reservations`, `/:id/rentals` y
// `/:id/payments` están en `docs/API.md` §7.3 pero NO en el backend real (lo dice
// la cabecera de `customers.routes.ts`). El historial se compone con los listados
// por `customerId`, que sí existen. Cuando se expongan, cambia el datasource y no
// esta pantalla.
//
// LAS TRES SECCIONES SE PIDEN EN PARALELO
// El historial (tres endpoints) y los pagos (hasta 20 peticiones, una por pedido)
// se lanzan a la vez con `Future.wait`. Encadenarlos sumaría la latencia de todas.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';
import '../../../core/utils/date_formatter.dart';
import '../../../shared/widgets/ui/app_card.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/admin_accounts.dart';
import '../domain/entities/admin_catalog.dart';
import '../domain/entities/admin_history.dart';
import '../domain/entities/admin_payments.dart';
import './admin_customers_controller.dart';
import './widgets/admin_customer_sections.dart';
import './widgets/admin_detail_row.dart';

/// Ficha completa de un cliente.
class AdminCustomerDetailPage extends ConsumerStatefulWidget {
  const AdminCustomerDetailPage({required this.customerId, super.key});

  final int customerId;

  @override
  ConsumerState<AdminCustomerDetailPage> createState() =>
      _AdminCustomerDetailPageState();
}

class _AdminCustomerDetailPageState
    extends ConsumerState<AdminCustomerDetailPage> {
  /// Ids de pedido del cliente, de los que se piden los pagos.
  ///
  /// Vive en el ESTADO y no en un campo porque los pagos se piden con él: si fuera
  /// un campo asignado dentro de `build`, la primera vez se vería con la lista
  /// vacía y no se volvería a pedir hasta que la pantalla se reconstruyera por otro
  /// motivo. `ref.listen` lo actualiza en el momento en que llega el historial.
  List<int> _orderIds = const <int>[];

  @override
  Widget build(BuildContext context) {
    final AsyncValue<AdminCustomer?> customer =
        ref.watch(adminCustomerProvider(widget.customerId));
    final AsyncValue<CustomerHistory> history =
        ref.watch(adminCustomerHistoryProvider(widget.customerId));

    // `listen` dentro de `build` es correcto en Riverpod 2: se registra una vez por
    // dependencia y se limpia sola al invalidarse. Es la forma canónica de derivar
    // estado de un `AsyncValue` sin un provider intermedio.
    ref.listen<AsyncValue<CustomerHistory>>(
      adminCustomerHistoryProvider(widget.customerId),
      (AsyncValue<CustomerHistory>? previous, AsyncValue<CustomerHistory> next) {
        final CustomerHistory? data = next.valueOrNull;
        if (data == null || !mounted) return;
        final List<int> ids = <int>[
          for (final AdminOrder order in data.orders) order.id,
        ];
        if (ids.length == _orderIds.length) return;
        setState(() => _orderIds = ids);
      },
    );

    final AsyncValue<List<AdminPayment>> payments =
        ref.watch(adminCustomerPaymentsProvider(_orderIds));
    final double padding = context.breakpoint.screenPadding;

    return Scaffold(
      appBar: AppBar(title: const Text('Ficha del cliente')),
      body: SafeArea(
        child: AsyncStateBuilder<AdminCustomer?>(
          value: customer,
          loadingMessage: 'Cargando la ficha…',
          onRetry: () async =>
              ref.invalidate(adminCustomerProvider(widget.customerId)),
          builder: (BuildContext context, AdminCustomer? data) {
            if (data == null) {
              return const Center(child: Text('No se encontró el cliente'));
            }
            final CustomerHistory data2 =
                history.valueOrNull ?? CustomerHistory.empty;
            final AdminCustomerSummary summary = AdminCustomerSummary(
              customer: data,
              history: data2,
              payments: payments.valueOrNull ?? const <AdminPayment>[],
            );
            return ListView(
              padding: EdgeInsets.fromLTRB(
                padding,
                AppSpacing.lg,
                padding,
                AppSpacing.xxl,
              ),
              children: <Widget>[
                AdminCustomerKpis(summary: summary),
                const SizedBox(height: AppSpacing.lg),
                AppCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      AdminDetailRow(label: 'Nombre', value: data.fullName),
                      AdminDetailRow(label: 'Correo', value: data.email),
                      if (data.phone != null)
                        AdminDetailRow(label: 'Teléfono', value: data.phone!),
                      AdminDetailRow(label: 'Estado', value: data.status),
                      if (data.createdAt != null)
                        AdminDetailRow(
                          label: 'Cliente desde',
                          value: DateFormatter.date(data.createdAt!),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: AppSpacing.xl),
                const Text('Pedidos', style: AppTextStyles.titleMedium),
                const SizedBox(height: AppSpacing.sm),
                AdminCustomerOrders(orders: data2.orders),
                const SizedBox(height: AppSpacing.xl),
                const Text('Reservas', style: AppTextStyles.titleMedium),
                const SizedBox(height: AppSpacing.sm),
                AdminCustomerReservations(items: data2.reservations),
                const SizedBox(height: AppSpacing.xl),
                const Text('Pagos', style: AppTextStyles.titleMedium),
                const SizedBox(height: AppSpacing.sm),
                AdminCustomerPayments(payments: summary.payments),
              ],
            );
          },
        ),
      ),
    );
  }
}
