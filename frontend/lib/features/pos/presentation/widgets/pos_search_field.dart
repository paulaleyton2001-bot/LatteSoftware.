// Buscador del mostrador. MÓDULO `pos/presentation/widgets`.
//
// EL REQUISITO DE VELOCIDAD
// Es el control más importante del POS: el cajero teclea el producto y lo añade
// sin soltar el teclado. Por eso:
//   - El `FocusNode` lo inyecta la pantalla (que lo refocusa tras cada alta) y no
//     se pide el foco al montar: robarlo haría que en un móvil el teclado saltara
//     y tapara lo que está debajo.
//   - `F1` lo enfoca en cualquier momento (ver `pos_shortcuts.dart`).
//   - `textInputAction: search` y `onSubmitted` refocusan tras enviar.
//
// ACCESIBILIDAD
// `Semantics(textField: true, label: …)` nombra el campo para el lector de
// pantalla, y el atajo visible va en el `hint` para que quien no ve la pantalla
// sepa que existe F1.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../pos_controller.dart';

/// Campo de búsqueda del catálogo del mostrador.
class PosSearchField extends ConsumerStatefulWidget {
  const PosSearchField({required this.focusNode, super.key});

  /// Nodo de foco. Lo posee la pantalla del POS para poder devolver el foco
  /// aquí después de cada alta.
  final FocusNode focusNode;

  @override
  ConsumerState<PosSearchField> createState() => _PosSearchFieldState();
}

class _PosSearchFieldState extends ConsumerState<PosSearchField> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    // El controlador nace con el texto que YA tiene el provider: al volver de
    // una navegación el buscador conserva lo escrito en vez de vaciarse.
    _controller = TextEditingController(text: ref.read(posSearchProvider));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // `AppTextField` ya aporta su propio `Semantics(textField: true)`; aquí solo
    // se le da el nombre accesible y la pista del atajo de teclado.
    return AppTextField(
      controller: _controller,
      focusNode: widget.focusNode,
      label: 'Buscar',
      hint: 'Nombre o SKU…',
      helperText: 'Atajo ${AppStrings.shortcutSearch} para volver aquí',
      semanticLabel: 'Buscar producto del catálogo',
      prefixIcon: Icons.search_rounded,
      textInputAction: TextInputAction.search,
      onChanged: (String value) =>
          ref.read(posSearchProvider.notifier).state = value,
      // Enviar con el teclado no borra el texto: solo lo devuelve al catálogo,
      // que es lo que el cajero quiere (suele teclear el nombre corto).
      onSubmitted: (_) => widget.focusNode.requestFocus(),
      suffix: _clearButton(),
    );
  }

  /// Botón de limpiar. `IconButton` con 44 dp y `tooltip` (WCAG 2.5.5 y 4.1.2).
  Widget? _clearButton() {
    final String query = ref.watch(posSearchProvider);
    if (query.isEmpty) return null;
    return IconButton(
      onPressed: () {
        _controller.clear();
        ref.read(posSearchProvider.notifier).state = '';
        widget.focusNode.requestFocus();
      },
      icon: const Icon(Icons.close_rounded, size: 18),
      color: context.tokens.textSecondary,
      tooltip: 'Limpiar la búsqueda',
      constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
    );
  }
}

/// Fila de categorías del catálogo con su conteo.
///
/// Reutiliza el patrón pill + check de `CategoryChip` (que ya existe y trae
/// `Semantics(selected:)`), pero necesita dos cosas que aquel no tiene: mostrar
/// el conteo y un "Todos" inicial que no depende del catálogo. Se implementa
/// aquí, no en `CategoryChip`, para no ensuciar un widget del design system con
/// una necesidad de una sola pantalla.
class PosCategoryBar extends ConsumerWidget {
  const PosCategoryBar({this.showAllLabel = true, super.key});

  /// `false` para el panel estrecho, donde no cabe la fila completa.
  final bool showAllLabel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<PosCatalogCategory> categories = ref.watch(posCategoriesProvider);
    final int? selected = ref.watch(posCategoryProvider);
    if (categories.isEmpty) return const SizedBox.shrink();

    return Semantics(
      container: true,
      label: 'Filtrar por categoría',
      child: SizedBox(
        height: 44,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
          children: <Widget>[
            if (showAllLabel) ...<Widget>[
              _CategoryPill(
                label: AppStrings.allCategories,
                count: null,
                selected: selected == null,
                onTap: () =>
                    ref.read(posCategoryProvider.notifier).state = null,
              ),
              const SizedBox(width: AppSpacing.sm),
            ],
            for (final PosCatalogCategory category in categories) ...<Widget>[
              _CategoryPill(
                // El nombre viene de `meta.categories` de la misma respuesta del
                // catálogo (API.md §7.11). Antes se pintaba «Cat. <id>» porque se
                // asumía que la proyección `fields=basic` no lo traía: el nombre
                // no está en cada PRODUCTO, pero sí en el índice de categorías.
                label: category.label,
                count: category.count,
                selected: selected == category.id,
                onTap: () => ref.read(posCategoryProvider.notifier).state =
                    selected == category.id ? null : category.id,
              ),
              const SizedBox(width: AppSpacing.sm),
            ],
          ],
        ),
      ),
    );
  }
}

/// Pill de categoría. Alto mínimo 44 dp (WCAG 2.5.5).
class _CategoryPill extends StatelessWidget {
  const _CategoryPill({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int? count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color foreground =
        selected ? context.tokens.textSuccess : context.tokens.textSecondary;
    final String semantic = count == null
        ? label
        : '$label, $count producto${count == 1 ? '' : 's'}';

    return Semantics(
      button: true,
      selected: selected,
      label: semantic,
      excludeSemantics: true,
      child: Tooltip(
        message: semantic,
        child: Material(
          color: selected
              ? context.tokens.surfaceGreenSubtle
              : context.tokens.surfaceMuted,
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
                  color:
                      selected ? context.tokens.brandDark : context.tokens.borderDefault,
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  // El color NO basta para decir "seleccionado": check + fondo.
                  if (selected) ...<Widget>[
                    Icon(Icons.check_rounded,
                        size: 16, color: context.tokens.actionPrimary),
                    const SizedBox(width: AppSpacing.xs),
                  ],
                  Text(label, style: AppTextStyles.labelLarge.copyWith(color: foreground)),
                  if (count != null) ...<Widget>[
                    const SizedBox(width: AppSpacing.xs),
                    Text('$count',
                        style: AppTextStyles.labelMedium
                            .copyWith(color: foreground)),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
