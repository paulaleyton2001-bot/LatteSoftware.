// Bloques de contenido de la pantalla de inicio: silla activa, destacados,
// categorías y acceso al carrito.
//
// Módulo `features/home/presentation/widgets`.
//
// Van aparte de `home_blocks.dart` (que tiene la cabecera) para que cada archivo
// tenga una responsabilidad y los dos se puedan leer de un vistazo.
//
// NADA DE ESTO HACE UNA SEGUNDA CONSULTA
// Los destacados y las categorías leen `menuProductsProvider` y
// `menuCategoriesProvider`, los mismos providers que la pantalla del menú. La
// silla activa lee `myRentalsProvider`, el mismo que la pestaña «Silla». La app no
// descarga dos veces lo mismo porque dos pantallas lo piden.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../app/routes.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_providers.dart';
import '../../../../shared/widgets/rental_countdown.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/app_card.dart';
import '../../../../shared/widgets/ui/category_chip.dart';
import '../../../../shared/widgets/ui/empty_state.dart';
import '../../../../shared/widgets/ui/shimmer.dart';
import '../../../menu/domain/entities/menu_category.dart';
import '../../../menu/domain/entities/menu_product.dart';
import '../../../menu/domain/repositories/menu_repository.dart';
import '../../../menu/presentation/widgets/product_grid.dart';
import '../../../orders/domain/entities/rental.dart';

/// Tarjeta de la silla activa con temporizador en vivo. `null` si no hay.
class HomeActiveChairCard extends StatelessWidget {
  const HomeActiveChairCard({required this.rental, super.key});

  final Rental? rental;

  @override
  Widget build(BuildContext context) {
    final Rental? current = rental;
    final DateTime? end = current?.endAt;
    if (current == null || end == null) return const SizedBox.shrink();

    return Semantics(
      container: true,
      label: 'Tu silla activa, ${current.chairCode ?? 'reservada'}',
      child: AppCard(
        variant: AppCardVariant.elevated,
        color: context.tokens.surfaceGreenSubtle,
        onTap: () => context.go(AppRoutes.chairs),
        semanticLabel: 'Ir a tu silla',
        child: Row(
          children: <Widget>[
            Icon(
              Icons.event_seat_rounded,
              size: 24,
              color: context.tokens.textSuccess,
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text(
                    'Tu silla ${current.chairCode ?? ''}'.trim(),
                    style: AppTextStyles.titleSmall
                        .copyWith(color: context.tokens.textSuccess),
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  RentalCountdown(endAt: end),
                ],
              ),
            ),
            Icon(
              Icons.chevron_right_rounded,
              size: 20,
              color: context.tokens.textSuccess,
            ),
          ],
        ),
      ),
    );
  }
}

/// Destacados del menú, con la misma rejilla del menú.
class HomeFeaturedSection extends StatelessWidget {
  const HomeFeaturedSection({required this.catalog, required this.categories, super.key});

  final AsyncValue<MenuCatalog> catalog;
  final AsyncValue<List<MenuCategory>> categories;

  @override
  Widget build(BuildContext context) {
    final MenuCatalog? data = catalog.valueOrNull;
    if (catalog.isLoading && data == null) {
      return const ShimmerBox(height: 180, borderRadius: 16);
    }
    if (data == null) {
      return EmptyState(
        icon: Icons.cloud_off_rounded,
        title: 'No pudimos cargar el menú',
        message: 'Vuelve a intentarlo cuando tengas conexión. Tus pedidos y tu '
            'silla siguen aquí.',
        actionLabel: 'Ir al menú',
        onAction: () => context.go(AppRoutes.menu),
        compact: true,
      );
    }

    final Map<int, String> names = _categoryNames(categories);
    final List<MenuProduct> featured = <MenuProduct>[
      for (final MenuProduct item in data.items)
        if (item.isFeatured && item.isAvailable) item,
    ];
    // Sin destacados se muestran los primeros disponibles: una sección vacía haría
    // que la home pareciera rota.
    final List<MenuProduct> shown = featured.isNotEmpty
        ? featured.take(4).toList(growable: false)
        : <MenuProduct>[
            for (final MenuProduct item in data.items)
              if (item.isAvailable) item,
          ].take(4).toList(growable: false);

    if (shown.isEmpty) {
      return const EmptyState(
        icon: Icons.local_cafe_outlined,
        title: 'El menú está vacío',
        message: 'Todavía no hay productos publicados.',
        compact: true,
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // POR QUÉ YA NO HAY UNA ALTURA FIJA DE 268
    // ─────────────────────────────────────────────────────────────────────────
    // `SizedBox(height: 268)` + `ProductGrid` era la combinación que pintaba las
    // franjas amarillas en la HOME (no solo en el menú): la rejilla calculaba su
    // alto con `mainAxisExtent` = ancho de celda + bloque de texto, y en un móvil
    // de 2 columnas esa suma se pasaba de 268. Como el `SizedBox` no cede, el
    // `SliverGrid` se salía por abajo y el `RenderFlex` pintaba el aviso.
    //
    // La altura la pone ahora `MenuProductSliver`, que mide la fila que contiene;
    // y en la home, en vez de recortarla con una caja, se deja que CREZCA: los
    // destacados son un adelanto, no el contenido principal, y 4 productos en 2
    // columnas son 2 filas (lo que ya se veía en el diseño original). Meter 8 en
    // una caja de altura fija obligaba a una rejilla más pequeña que la del menú
    // y era la fuente de los textos diminutos de "la categoría bajo Latte".
    return ProductGrid(
      products: shown,
      categoryNames: names,
      padding: EdgeInsets.zero,
      // `shrinkWrap` a propósito: la home mete esta rejilla dentro de un
      // `ListView`, y sin esto el `CustomScrollView` interno pediría altura
      // infinita.
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
    );
  }

  static Map<int, String> _categoryNames(AsyncValue<List<MenuCategory>> value) =>
      <int, String>{
        for (final MenuCategory category
            in value.valueOrNull ?? const <MenuCategory>[])
          category.id: category.name,
      };
}

/// Categorías como accesos rápidos al menú.
class HomeCategoriesSection extends StatelessWidget {
  const HomeCategoriesSection({required this.categories, super.key});

  final AsyncValue<List<MenuCategory>> categories;

  @override
  Widget build(BuildContext context) {
    final List<MenuCategory> all =
        categories.valueOrNull ?? const <MenuCategory>[];
    if (all.isEmpty) {
      return const SizedBox(
        height: 44,
        child: ShimmerBox(height: 40, borderRadius: 999),
      );
    }
    // ─────────────────────────────────────────────────────────────────────────
    // POR QUÉ LOS CHIPS NO SE RECORTAN AHORA
    // ─────────────────────────────────────────────────────────────────────────
    // El síntoma era "Postres recortado" en la home. `CategoryChip` es un `Row`
    // con `mainAxisSize.min`, así que en un `Wrap` con dos columnas justa
    // significa que el chip recibía un ancho FORZADO por la rejilla y su `Text` se
    // salía del `Row`. Aquí el `Wrap` deja que cada chip mida su texto, y
    // `CategoryChip` acota el nombre a una línea con ellipsis (`maxLines: 1`)
    // para que un nombre muy largo ceda espacio en vez de empujar al vecino.
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: <Widget>[
        for (final MenuCategory category in all)
          if (category.isActive && category.selectableCount > 0)
            CategoryChip(
              label: category.name,
              count: category.selectableCount,
              onTap: () => context.go(AppRoutes.menu),
              semanticLabel: 'Ver ${category.name}, '
                  '${category.selectableCount} productos',
            ),
      ],
    );
  }
}

/// Acceso rápido al carrito con su número de artículos.
class HomeCartShortcut extends ConsumerWidget {
  const HomeCartShortcut({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int count = ref.watch(cartBadgeCountProvider);
    return AppCard(
      onTap: count == 0 ? null : () => context.push(AppRoutes.cart),
      semanticLabel:
          count == 0 ? 'Tu pedido está vacío' : 'Tu pedido, $count artículos',
      child: Row(
        children: <Widget>[
          const Icon(Icons.shopping_basket_rounded, size: 22),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Text(
              count == 0
                  ? 'Tu pedido está vacío'
                  : '$count ${count == 1 ? 'artículo' : 'artículos'} en el pedido',
              style: AppTextStyles.titleSmall,
            ),
          ),
          if (count > 0)
            const Icon(Icons.chevron_right_rounded, size: 20)
          else
            AppButton(
              label: 'Ver el menú',
              size: AppButtonSize.small,
              onPressed: () => context.go(AppRoutes.menu),
            ),
        ],
      ),
    );
  }
}
