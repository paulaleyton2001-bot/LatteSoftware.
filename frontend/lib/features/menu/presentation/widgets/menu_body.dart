// Cuerpo del menú: saludo, buscador, chips y secciones de productos.
//
// QUÉ HACE ESTE ARCHIVO Y QUÉ NO
// `MenuPage` carga `MenuCatalog` y calcula los nombres de categoría; esto solo
// DECIDE QUÉ SECCIONES SE PINTAN: destacados, promociones y el resto, con sus
// encabezados. La ordenación y el filtrado son de `MenuSelection` (el
// presentation controller), no de los widgets.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../app/theme/responsive/breakpoints.dart';
import '../../../../shared/constants/app_strings.dart';
// El saludo es el MISMO texto que el de Inicio: mismo módulo, mismo criterio
// (momento del día + nombre). Ver `shared/constants/greeting.dart`.
import '../../../../shared/constants/greeting.dart';
import '../../../../shared/widgets/ui/empty_state.dart';
import '../../../../shared/widgets/ui/section_header.dart';
// `currentUserProvider` es de la feature de auth: el saludo de la cabecera del
// menú necesita el nombre del cliente y no hay provider equivalente en `core/`.
// Misma excepción que `home_page.dart` y `admin_users_page.dart`.
import '../../../auth/presentation/auth_controller.dart';
import '../../domain/entities/menu_category.dart';
import '../menu_controller.dart';
import './menu_category_chips.dart';
import './menu_search_field.dart';
import './product_grid.dart';

/// Cuerpo de la pantalla: saludos + buscador + chips + secciones.
///
/// Vive en su propio archivo porque `MenuPage` solo carga los datos y delega
/// el árbol: así la página se lee de un vistazo y la composición slivers se
/// toca sin riesgo de romper la carga.
class MenuBody extends ConsumerWidget {
  const MenuBody({
    required this.selection,
    required this.categories,
    required this.categoryNames,
    required this.isStale,
  });

  final MenuSelection selection;
  final List<MenuCategory> categories;
  final Map<int, String> categoryNames;
  final bool isStale;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final double padding = context.breakpoint.screenPadding;

    if (selection.isEmpty) {
      return _NoResults(query: ref.watch(menuFilterProvider).query);
    }

    return CustomScrollView(
      slivers: <Widget>[
        SliverToBoxAdapter(
          child: Padding(
            padding: EdgeInsets.fromLTRB(padding, AppSpacing.md, padding, AppSpacing.sm),
            child: const _Greeting(),
          ),
        ),
        if (isStale)
          SliverToBoxAdapter(
            child: Padding(
              padding: EdgeInsets.fromLTRB(padding, 0, padding, AppSpacing.sm),
              child: const _StaleCatalogNotice(),
            ),
          ),
        SliverToBoxAdapter(
          child: Padding(
            padding: EdgeInsets.symmetric(horizontal: padding),
            child: const MenuSearchField(),
          ),
        ),
        if (categories.isNotEmpty)
          SliverToBoxAdapter(
            child: MenuCategoryChips(categories: categories),
          ),
        if (selection.featured.isNotEmpty) ...<Widget>[
          SliverToBoxAdapter(
            child: SectionHeader(
              title: AppStrings.sectionFeatured,
              subtitle: 'Los favoritos de la casa',
              padding: EdgeInsets.fromLTRB(padding, AppSpacing.lg, padding, 0),
              // La separación hacia la rejilla la pone `SectionHeader` con su
              // `bottomSpacing`: antes era 0 y el subtítulo quedaba pegado a la
              // primera tarjeta ("Destacados / Los favoritos de la casa / [card]").
              bottomSpacing: AppSpacing.md,
            ),
          ),
          MenuProductSliver(
            products: selection.featured,
            categoryNames: categoryNames,
            padding: EdgeInsets.symmetric(horizontal: padding),
          ),
        ],
        if (selection.promos.isNotEmpty) ...<Widget>[
          SliverToBoxAdapter(
            child: SectionHeader(
              title: AppStrings.sectionPromos,
              subtitle: 'Precio especial por tiempo limitado',
              padding: EdgeInsets.fromLTRB(padding, AppSpacing.lg, padding, 0),
              bottomSpacing: AppSpacing.md,
            ),
          ),
          MenuProductSliver(
            products: selection.promos,
            categoryNames: categoryNames,
            padding: EdgeInsets.symmetric(horizontal: padding),
          ),
        ],
        SliverToBoxAdapter(
          child: SectionHeader(
            title: selection.isFiltered ? 'Resultados' : AppStrings.sectionAll,
            subtitle: '${selection.total} producto'
                '${selection.total == 1 ? '' : 's'}',
            padding: EdgeInsets.fromLTRB(padding, AppSpacing.lg, padding, 0),
            bottomSpacing: AppSpacing.md,
          ),
        ),
        MenuProductSliver(
          products: selection.rest,
          categoryNames: categoryNames,
          padding: EdgeInsets.symmetric(horizontal: padding),
        ),
        const SliverToBoxAdapter(child: SizedBox(height: AppSpacing.xxl)),
      ],
    );
  }
}

/// Saludo con el nombre del cliente. `Semantics(header: true)`: es el único
/// `H1` de la pantalla (WCAG 2.4.1).
///
/// El texto sale de `shared/constants/greeting.dart`, el MISMO módulo que pinta
/// la cabecera de Inicio: las dos pantallas dicen "Buenos días, Ana" con el
/// criterio del momento del día. Antes esta decía "Hola, Ana" y se veía como un
/// error aunque las dos tuvieran el nombre correcto.
class _Greeting extends ConsumerWidget {
  const _Greeting();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final String name = ref.watch(currentUserProvider)?.displayName ?? '';

    return Semantics(
      header: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            greetingWithName(greeting: ref.watch(greetingProvider), name: name),
            style: AppTextStyles.headlineLarge,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            AppStrings.menuPrompt,
            style: AppTextStyles.bodyMedium
                .copyWith(color: context.tokens.textSecondary),
          ),
        ],
      ),
    );
  }
}

/// Aviso de que el menú mostrado es el ÚLTIMO CONOCIDO (el backend no respondió).
class _StaleCatalogNotice extends StatelessWidget {
  const _StaleCatalogNotice();

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      container: true,
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: context.tokens.surfaceWarningSubtle,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: context.tokens.stateWarning),
        ),
        child: Row(
          children: <Widget>[
             Icon(Icons.cloud_off_rounded, size: 20, color: context.tokens.textWarning),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                'Sin conexión: te enseñamos el menú guardado. Los precios pueden '
                'haber cambiado.',
                style: AppTextStyles.captionMedium
                    .copyWith(color: context.tokens.textWarning),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Búsqueda sin resultados: `EmptyState` con salida (volver a ver todo).
class _NoResults extends ConsumerWidget {
  const _NoResults({required this.query});

  final String query;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return EmptyState(
      icon: Icons.search_off_rounded,
      title: 'Sin coincidencias',
      message: query.isEmpty
          ? 'No hay productos disponibles en esta categoría ahora mismo.'
          : 'No encontramos nada para «$query». Prueba con otra palabra o quita '
              'los filtros.',
      actionLabel: 'Quitar filtros',
      onAction: () => ref.read(menuFilterProvider.notifier).clear(),
    );
  }
}
