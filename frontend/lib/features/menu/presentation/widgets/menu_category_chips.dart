// Fila de filtros por categoría del menú.
//
// USA `CategoryChip` (el chip del design system) y no reimplementa el pill: la
// diferencia con `CategoryChipRow` es que aquí hace falta el `categoryId` para
// filtrar y el contador de productos disponibles en la categoría, que no cabe en
// la versión de solo etiquetas.
//
// ACCESIBILIDAD: cada chip ya expone `Semantics(selected:)`; el contenedor es un
// grupo con nombre ("Categorías del menú") para que el lector anuncie el campo
// antes de los pills. Alto de 52 dp como en `CategoryChipRow`, y scroll
// horizontal en móvil: con 8 categorías no caben en pantalla y esconderlas tras
// un desplegable sería peor.
//
// ESPACIADO: hereda [kCategoryChipSpacing] (12 dp) de `CategoryChipRow`, que es
// donde vive la decisión. El usuario reportó los chips «tocándose entre sí»
// ("Todo | Cafés 7 | Bebidas 4 | Comidas 4"): con 8 dp de separación y el borde
// que lleva cada pill, cinco seguidas se leen como una sola barra. Aquí además se
// separa la fila del buscador y del primer título con `verticalPadding`, que no
// venía en absoluto.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/responsive/breakpoints.dart';
import '../../../../shared/constants/app_strings.dart';
import '../../../../shared/widgets/ui/category_chip.dart';
import '../../../../shared/widgets/ui/category_chip_row.dart';
import '../../domain/entities/menu_category.dart';
import '../menu_controller.dart';

/// Fila horizontal de categorías del menú.
class MenuCategoryChips extends ConsumerWidget {
  const MenuCategoryChips({
    required this.categories,
    this.spacing = kCategoryChipSpacing,
    this.verticalPadding = AppSpacing.sm,
    super.key,
  });

  final List<MenuCategory> categories;

  /// Separación entre pills. Ver [kCategoryChipSpacing].
  final double spacing;

  /// Aire vertical respecto al buscador (arriba) y al primer título (abajo).
  final double verticalPadding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int? selected = ref.watch(menuFilterProvider).categoryId;
    final MenuFilterController controller = ref.read(menuFilterProvider.notifier);
    final double padding = context.breakpoint.screenPadding;

    // Categorías con al menos un producto disponible. Un filtro que lleva a una
    // pantalla vacía es una trampa, no una opción.
    final List<MenuCategory> usable = <MenuCategory>[
      for (final MenuCategory category in categories)
        if (category.isActive && category.selectableCount > 0) category,
    ];

    return Semantics(
      container: true,
      label: 'Categorías del menú',
      child: Padding(
        padding: EdgeInsets.symmetric(vertical: verticalPadding),
        child: SizedBox(
          height: 52,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: padding),
            itemCount: usable.length + 1,
            separatorBuilder: (BuildContext context, int index) =>
                SizedBox(width: spacing),
            itemBuilder: (BuildContext context, int index) {
              if (index == 0) {
                return Center(
                  child: CategoryChip(
                    label: AppStrings.allCategories,
                    selected: selected == null,
                    onTap: () => controller.selectCategory(null),
                    semanticLabel: 'Ver todas las categorías',
                  ),
                );
              }
              final MenuCategory category = usable[index - 1];
              return Center(
                child: CategoryChip(
                  label: category.name,
                  selected: selected == category.id,
                  count: category.selectableCount,
                  onTap: () => controller.selectCategory(
                    selected == category.id ? null : category.id,
                  ),
                  semanticLabel:
                      'Filtrar por ${category.name}, ${category.selectableCount} productos',
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}
