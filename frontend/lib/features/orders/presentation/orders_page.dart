// Pestaña «Pedidos»: lista con pestañas (Todos / En curso / Completados).
//
// POR QUÉ LAS PESTAÑAS FILTRAN EN CLIENTE Y NO EN EL SERVIDOR
// `GET /orders` acepta un único `status` por petición (API.md §7.12), así que
// filtrar por pestaña en el servidor obligaría a tres peticiones y a volver a
// paginar al cambiar de pestaña. El listado de un cliente cabe en una página
// (`pageSize: 100`, el máximo del endpoint), así que se trae una vez y se filtra
// en memoria: el cambio de pestaña es instantáneo y no consume cuota.
//
// ESTADOS
//   carga / sin red / error → `AsyncStateBuilder` con reintento
//   sin pedidos              → `EmptyState` con salida al menú
//   pestaña vacía            → `EmptyState` COMPACTO dentro de la lista, con un
//                             texto distinto del "no tienes pedidos": no es lo
//                             mismo no tener pedidos que no tener ninguno en
//                             "Completados".
//
// CABECERA ADAPTATIVA
// En móvil el buscador y los filtros son un scroll horizontal; en desktop, la
// lista se centra con ancho máximo para que las líneas no superen ~90
// caracteres (docs/DESIGN-TOKENS §5).


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../app/breakpoints.dart';
import '../../../app/routes.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../../../shared/widgets/ui/empty_state.dart';
import '../domain/entities/order_summary.dart';
import './orders_controller.dart';
import './widgets/order_card.dart';

/// Pantalla de pedidos del cliente.
class OrdersPage extends ConsumerWidget {
  const OrdersPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<OrderSummary>> orders = ref.watch(ordersProvider);
    final List<OrderSummary> visible = ref.watch(filteredOrdersProvider);
    final OrdersFilter filter = ref.watch(ordersFilterProvider);
    final OrdersCounts counts = ref.watch(ordersCountsProvider);
    final double padding = context.breakpoint.screenPadding;

    // El chrome (AppBar y navegación) es de `CustomerShell`; esta pantalla solo
    // devuelve su contenido.
    return AsyncStateBuilder<List<OrderSummary>>(
      value: orders,
      loadingMessage: 'Cargando tus pedidos…',
      onRetry: () async => ref.invalidate(ordersProvider),
      isEmpty: (List<OrderSummary> data) => data.isEmpty,
      emptyIcon: Icons.receipt_long_outlined,
      emptyTitle: 'Todavía no has pedido nada',
      emptyMessage: 'Cuando pidas algo, aquí verás el estado, la silla que '
          'reservaste y el comprobante.',
      emptyActionLabel: 'Ver el menú',
      onEmptyAction: () => context.go(AppRoutes.menu),
      builder: (BuildContext context, List<OrderSummary> data) => Column(
        children: <Widget>[
          SizedBox(
            height: 56,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: EdgeInsets.symmetric(
                horizontal: padding,
                vertical: AppSpacing.sm,
              ),
              children: <Widget>[
                for (final OrdersFilter option in OrdersFilter.values) ...<Widget>[
                  _FilterChip(
                    label: option.label,
                    count: _countOf(option, counts),
                    selected: option == filter,
                    onTap: () => ref
                        .read(ordersFilterProvider.notifier)
                        .state = option,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                ],
              ],
            ),
          ),
          Expanded(
            child: visible.isEmpty
                ? EmptyState(
                    icon: Icons.filter_alt_off_rounded,
                    title: 'Nada en "${filter.label}"',
                    message: 'Prueba con otra pestaña para ver el resto de tus '
                        'pedidos.',
                    compact: true,
                    actionLabel: 'Ver todos',
                    onAction: () =>
                        ref.read(ordersFilterProvider.notifier).state =
                            OrdersFilter.all,
                  )
                : ListView.separated(
                    padding: EdgeInsets.fromLTRB(
                      padding,
                      AppSpacing.sm,
                      padding,
                      AppSpacing.xxl,
                    ),
                    itemCount: visible.length,
                    separatorBuilder: (BuildContext context, int index) =>
                        const SizedBox(height: AppSpacing.md),
                    itemBuilder: (BuildContext context, int index) =>
                        OrderCard(order: visible[index]),
                  ),
          ),
        ],
      ),
    );
  }

  static int _countOf(OrdersFilter filter, OrdersCounts counts) =>
      switch (filter) {
        OrdersFilter.all => counts.all,
        OrdersFilter.inProgress => counts.inProgress,
        OrdersFilter.completed => counts.completed,
      };
}

/// Chip de filtro de pestaña, con el conteo entre paréntesis.
///
/// Reutiliza el patrón de `CategoryChip` (pill, check al activo, `Semantics`
/// con `selected`); el contador es la diferencia con las categorías del menú.
class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color foreground =
        selected ? context.tokens.textSuccess : context.tokens.textSecondary;

    return Semantics(
      button: true,
      selected: selected,
      label: '$label, $count',
      excludeSemantics: true,
      child: Material(
        color: selected ? context.tokens.surfaceGreenSubtle : context.tokens.surfaceMuted,
        borderRadius: BorderRadius.circular(999),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(999),
          child: Container(
            constraints: const BoxConstraints(minHeight: 40),
            padding: const EdgeInsets.symmetric(horizontal: AppSpacing.lg),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(999),
              border: Border.all(
                color: selected ? context.tokens.brandDark : context.tokens.borderDefault,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                if (selected) ...<Widget>[
                   Icon(Icons.check_rounded, size: 16, color: context.tokens.actionPrimary),
                  const SizedBox(width: AppSpacing.xs),
                ],
                Text(label, style: AppTextStyles.labelLarge.copyWith(color: foreground)),
                const SizedBox(width: AppSpacing.xs),
                Text(
                  '$count',
                  style: AppTextStyles.labelMedium.copyWith(color: foreground),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
