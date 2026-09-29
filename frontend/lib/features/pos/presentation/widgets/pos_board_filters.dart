// Filtros del tablero de pedidos. MÓDULO `pos/presentation/widgets`.
//
// La búsqueda es por número, cliente o silla y el filtrado ocurre EN MEMORIA:
// `GET /orders` trae hasta 100 pedidos (el máximo del endpoint) y filtrar en
// servidor obligaría a una petición por tecla. Un tablero de cocina con la red
// lenta no puede permitirse eso.
//
// EL FILTRO POR ESTADO Y POR TIPO SE RESUELVE CON UN BOTTOM SHEET
// Las listas son cortas y cambian poco; un `DropdownButton` con nueve
// `OrderStatus` no cabe en 300 dp, y una hoja con `ListTile` da 44 dp por fila y
// un target cómodo con el dedo.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../pos_orders_controller.dart';
import './pos_board_card_actions.dart';

/// Barra de búsqueda y filtro por estado/tipo del tablero.
class PosBoardFilterBar extends ConsumerWidget {
  const PosBoardFilterBar({required this.controller, super.key});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String? status = ref.watch(posOrderStatusFilterProvider);
    final String? type = ref.watch(posOrderTypeFilterProvider);

    return Padding(
      padding: const EdgeInsets.all(AppSpacing.md),
      child: Row(
        children: <Widget>[
          Expanded(
            child: AppTextField(
              controller: controller,
              label: 'Buscar pedido',
              hint: 'Número, cliente o silla…',
              prefixIcon: Icons.search_rounded,
              textInputAction: TextInputAction.search,
              onChanged: (String value) =>
                  ref.read(posOrderSearchProvider.notifier).state = value,
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          _FilterButton(
            icon: Icons.tune_rounded,
            tooltip: 'Filtrar por estado',
            label: status == null ? 'Estado' : (kPosOrderStatusLabels[status] ?? status),
            active: status != null,
            onTap: () => _pickStatus(context, ref),
          ),
          const SizedBox(width: AppSpacing.sm),
          _FilterButton(
            icon: Icons.local_cafe_outlined,
            tooltip: 'Filtrar por tipo',
            label: type ?? 'Tipo',
            active: type != null,
            onTap: () => _pickType(context, ref),
          ),
        ],
      ),
    );
  }

  Future<void> _pickStatus(BuildContext context, WidgetRef ref) async {
    final String? picked = await showModalBottomSheet<String?>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            ListTile(
              title: const Text('Todos los estados'),
              onTap: () => Navigator.of(sheetContext).pop(''),
            ),
            for (final String value in kPosOrderStatusLabels.keys)
              ListTile(
                title: Text(kPosOrderStatusLabels[value] ?? value),
                trailing: value == ref.read(posOrderStatusFilterProvider)
                    ? const Icon(Icons.check_rounded)
                    : null,
                onTap: () => Navigator.of(sheetContext).pop(value),
              ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    ref.read(posOrderStatusFilterProvider.notifier).state =
        picked.isEmpty ? null : picked;
  }

  Future<void> _pickType(BuildContext context, WidgetRef ref) async {
    const Map<String, String> types = <String, String>{
      'TAKEAWAY': 'Para llevar',
      'DINE_IN': 'En el local',
      'CHAIR_RENTAL': 'Alquiler de silla',
    };
    final String? picked = await showModalBottomSheet<String?>(
      context: context,
      showDragHandle: true,
      builder: (BuildContext sheetContext) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: <Widget>[
            ListTile(
              title: const Text('Todos los tipos'),
              onTap: () => Navigator.of(sheetContext).pop(''),
            ),
            for (final MapEntry<String, String> entry in types.entries)
              ListTile(
                title: Text(entry.value),
                onTap: () => Navigator.of(sheetContext).pop(entry.key),
              ),
          ],
        ),
      ),
    );
    if (picked == null) return;
    ref.read(posOrderTypeFilterProvider.notifier).state =
        picked.isEmpty ? null : picked;
  }
}

/// Botón de filtro con etiqueta corta. 44 dp.
class _FilterButton extends StatelessWidget {
  const _FilterButton({
    required this.icon,
    required this.tooltip,
    required this.label,
    required this.active,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final String label;
  final bool active;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: '$tooltip: $label',
      excludeSemantics: true,
      child: Tooltip(
        message: tooltip,
        child: Material(
          color: active ? context.tokens.surfaceGreenSubtle : context.tokens.surfaceMuted,
          borderRadius: BorderRadius.circular(AppRadii.md),
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(AppRadii.md),
            child: Container(
              constraints: const BoxConstraints(minHeight: 44),
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(AppRadii.md),
                border: Border.all(
                  color: active ? context.tokens.brandDark : context.tokens.borderDefault,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(icon, size: 18, color: context.tokens.textSecondary),
                  const SizedBox(width: AppSpacing.xs),
                  ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 88),
                    child: Text(
                      label,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.labelMedium
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
