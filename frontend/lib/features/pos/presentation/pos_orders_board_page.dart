// Tablero Kanban de pedidos (`pos_orders_board`). MÓDULO `pos/presentation`.
//
// COLUMNAS
// Nuevos / Confirmados / Preparando / Listos / Entregados / Cancelados, que son
// los estados del ciclo de vida de `OrderStatus` (API.md §6.3) más el ya cerrado.
// `kPosBoardColumns` es la lista y `kPosBoardColumnStatus` el mapa columna →
// estado: los dos viven en `pos_orders_controller.dart` para que añadir un estado
// sea tocar UN sitio, no dos pantallas.
//
// AVANCE RÁPIDO, NO ARRASTRE
// Cada tarjeta trae un botón que la pasa al siguiente estado
// (`POST /orders/:id/status`). Es lo que el enunciado pide como mínimo y es más
// fiable que arrastrar con el dedo lleno: soltar en la columna equivocada mueve
// un pedido que ya estaba listo, y en una cocina eso no se deshace.
//
// EL FILTRO ES COMPARTIDO CON LA BÚSQUEDA
// Una sola lista de pedidos en memoria (`posOrdersProvider`) y dos vistas: este
// tablero y la lista con buscador. Cambiar de vista no vuelve a pedir datos.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/responsive/pos_breakpoints.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import '../../../shared/widgets/ui/app_button.dart';
import '../../../shared/widgets/ui/async_state_builder.dart';
import '../domain/entities/pos_order_card.dart';
import './pos_orders_controller.dart';
import './widgets/pos_board_columns.dart';
import './widgets/pos_board_filters.dart';

/// Tablero de pedidos del mostrador.
class PosOrdersBoardPage extends ConsumerStatefulWidget {
  const PosOrdersBoardPage({super.key});

  @override
  ConsumerState<PosOrdersBoardPage> createState() => _PosOrdersBoardPageState();
}

class _PosOrdersBoardPageState extends ConsumerState<PosOrdersBoardPage> {
  final TextEditingController _search = TextEditingController();

  @override
  void initState() {
    super.initState();
    _search.text = ref.read(posOrderSearchProvider);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<PosOrderCard>> orders = ref.watch(posOrdersProvider);
    final PosLayout layout = context.posLayout;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tablero de pedidos'),
        titleTextStyle: AppTextStyles.headlineSmall,
        actions: <Widget>[
          IconButton(
            onPressed: () => ref.invalidate(posOrdersProvider),
            icon: const Icon(Icons.refresh_rounded),
            // El `tooltip` de `IconButton` ya da la etiqueta al lector de
            // pantalla; `IconButton` no admite `semanticLabel`.
            tooltip: 'Actualizar el tablero de pedidos',
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
          ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            PosBoardFilterBar(controller: _search),
            const Divider(height: 1),
            Expanded(
              child: AsyncStateBuilder<List<PosOrderCard>>(
                value: orders,
                loadingMessage: 'Cargando pedidos…',
                onRetry: () async => ref.invalidate(posOrdersProvider),
                isEmpty: (List<PosOrderCard> data) => data.isEmpty,
                emptyIcon: Icons.receipt_long_outlined,
                emptyTitle: 'No hay pedidos',
                emptyMessage: 'En cuanto se registre una venta aparecerá aquí.',
                builder: (BuildContext context, List<PosOrderCard> data) {
                  final List<PosOrderCard> visible =
                      ref.watch(posVisibleOrdersProvider);
                  if (visible.isEmpty) {
                    return const _NoMatchesInBoard();
                  }
                  return PosBoard(orders: visible, layout: layout);
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Sin coincidencias con el filtro activo dentro del tablero.
class _NoMatchesInBoard extends ConsumerWidget {
  const _NoMatchesInBoard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.filter_alt_off_rounded,
                size: 32, color: context.tokens.textTertiary),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Ningún pedido coincide con el filtro',
              textAlign: TextAlign.center,
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
            const SizedBox(height: AppSpacing.md),
            AppButton(
              label: 'Quitar filtros',
              variant: AppButtonVariant.secondary,
              size: AppButtonSize.small,
              onPressed: () {
                ref.read(posOrderSearchProvider.notifier).state = '';
                ref.read(posOrderStatusFilterProvider.notifier).state = null;
                ref.read(posOrderTypeFilterProvider.notifier).state = null;
              },
            ),
          ],
        ),
      ),
    );
  }
}
