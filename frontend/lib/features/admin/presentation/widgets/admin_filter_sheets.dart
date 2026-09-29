// Hojas de filtro del panel. MÓDULO `features/admin/presentation/widgets`.
//
// POR QUÉ UN BOTTOM SHEET Y NO UN `DropdownButton`
// Un `DropdownButton` de 32 dp es un objetivo táctil por debajo del mínimo de 44
// (WCAG 2.5.5) y en escritorio abre un menú de 240 dp que tapa la lista. Una hoja
// con `ListTile` de 56 dp da fila grande, texto grande y se cierra deslizando, que
// es lo que se espera tanto con el dedo como con el ratón.
//
// CADA HOJA ESCRIVE EN UN PROVIDER
// La hoja no devuelve un valor: escribe en el `StateProvider` del filtro y cierra.
// Así el listado se reconstruye solo y no hay que propagar el resultado a mano
// desde tres sitios distintos.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../domain/entities/admin_products.dart';
import '../admin_orders_controller.dart';
import '../admin_products_controller.dart';

/// Hoja de estado de pedido.
Future<void> showAdminOrderStatusSheet(BuildContext context, WidgetRef ref) {
  final String? current = ref.read(adminOrderStatusFilterProvider);
  return _OptionSheet(
    title: 'Filtrar por estado',
    options: <_SheetOption<String>>[
      const _SheetOption<String>(value: null, label: 'Todos los estados'),
      for (final MapEntry<String, String> entry
          in kAdminOrderStatusLabels.entries)
        _SheetOption<String>(value: entry.key, label: entry.value),
    ],
    selected: current,
    onSelected: (String? value) =>
        ref.read(adminOrderStatusFilterProvider.notifier).state = value,
  ).show(context);
}

/// Hoja de tipo de pedido.
Future<void> showAdminOrderTypeSheet(BuildContext context, WidgetRef ref) {
  final String? current = ref.read(adminOrderTypeFilterProvider);
  return _OptionSheet<String>(
    title: 'Filtrar por tipo',
    options: const <_SheetOption<String>>[
      _SheetOption<String>(value: null, label: 'Todos los tipos'),
      _SheetOption<String>(value: 'TAKEAWAY', label: 'Para llevar'),
      _SheetOption<String>(value: 'DINE_IN', label: 'En el local'),
      _SheetOption<String>(value: 'CHAIR_RENTAL', label: 'Alquiler de silla'),
    ],
    selected: current,
    onSelected: (String? value) =>
        ref.read(adminOrderTypeFilterProvider.notifier).state = value,
  ).show(context);
}

/// Hoja de rango de fechas.
///
/// El preset `custom` NO se elige aquí: se elige en el diálogo de fechas, que va
/// detrás del botón. Esta hoja solo ofrece los presets fijos, y al elegir "otro
/// rango" se abre el selector.
Future<void> showAdminOrderRangeSheet(BuildContext context, WidgetRef ref) async {
  final String? current = ref.read(adminOrderPresetProvider);
  final String? picked = await _OptionSheet<String>(
    title: 'Rango de fechas',
    options: const <_SheetOption<String>>[
      _SheetOption<String>(value: 'today', label: AppStrings.presetToday),
      _SheetOption<String>(
        value: 'yesterday',
        label: AppStrings.presetYesterday,
      ),
      _SheetOption<String>(value: 'last7', label: AppStrings.presetLast7),
      _SheetOption<String>(value: 'last30', label: AppStrings.presetLast30),
      _SheetOption<String>(value: 'all', label: 'Cualquier fecha'),
    ],
    selected: current == 'custom' ? 'all' : current,
    onSelected: (String? value) {},
  ).show(context);

  if (picked == null || !context.mounted) return;
  if (picked == 'all') {
    ref.read(adminOrderPresetProvider.notifier).state = null;
    return;
  }
  ref.read(adminOrderPresetProvider.notifier).state = picked;
}

/// Hoja de categorías del catálogo.
Future<void> showAdminCategorySheet(
  BuildContext context,
  WidgetRef ref,
  List<AdminCategory> categories,
) async {
  final int? current = ref.read(adminProductCategoryProvider);
  final int? picked = await showModalBottomSheet<int?>(
    context: context,
    showDragHandle: true,
    builder: (BuildContext sheetContext) => SafeArea(
      child: ListView(
        shrinkWrap: true,
        children: <Widget>[
          ListTile(
            title: const Text('Todas las categorías'),
            trailing:
                current == null ? const Icon(Icons.check_rounded) : null,
            onTap: () => Navigator.of(sheetContext).pop(-1),
          ),
          for (final AdminCategory category in categories)
            ListTile(
              title: Text(category.name),
              subtitle: Text('${category.productCount} productos'),
              trailing: current == category.id
                  ? const Icon(Icons.check_rounded)
                  : null,
              onTap: () => Navigator.of(sheetContext).pop(category.id),
            ),
        ],
      ),
    ),
  );
  if (picked == null) return;
  ref.read(adminProductCategoryProvider.notifier).state =
      picked < 0 ? null : picked;
}

/// Opción de una hoja de filtro.
class _SheetOption<T> {
  const _SheetOption({required this.value, required this.label});

  final T? value;
  final String label;
}

/// Hoja genérica de opciones. Abajo para no repetir el `ListView`.
class _OptionSheet<T> {
  const _OptionSheet({
    required this.title,
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  final String title;
  final List<_SheetOption<T>> options;
  final T? selected;
  final ValueChanged<T?> onSelected;

  Future<T?> show(BuildContext context) => showModalBottomSheet<T?>(
        context: context,
        showDragHandle: true,
        builder: (BuildContext sheetContext) => SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg,
                  0,
                  AppSpacing.lg,
                  AppSpacing.sm,
                ),
                child: Semantics(
                  header: true,
                  child: Text(title, style: AppTextStyles.titleMedium),
                ),
              ),
              for (final _SheetOption<T> option in options)
                ListTile(
                  minVerticalPadding: 12,
                  title: Text(option.label),
                  trailing: option.value == selected
                      ? const Icon(Icons.check_rounded)
                      : null,
                  selected: option.value == selected,
                  onTap: () {
                    onSelected(option.value);
                    Navigator.of(sheetContext).pop(option.value);
                  },
                ),
            ],
          ),
        ),
      );
}



