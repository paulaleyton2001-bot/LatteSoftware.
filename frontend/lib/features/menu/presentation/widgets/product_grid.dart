// Rejilla de productos del menú. Módulo `features/menu/presentation/widgets`.
//
// COLUMNAS POR BREAKPOINT (docs/DESIGN-TOKENS.md §5)
//   mobile  → 2   (1 sola columna deja la pantalla vacía y obliga a scroll largo)
//   tablet  → 3
//   desktop → 4
//   wide    → 4   (con ancho máximo de contenido, más columnas no aportan nada)
//
// Se usa `context.breakpoint` y NUNCA `MediaQuery` directo: el enum es la
//fuente de la retícula y del padding (DESIGN-TOKENS §5, regla transversal).
//
// LA RETÍCULA SE DECLARA UNA SOLA VEZ
// [MenuProductSliver] es el `SliverGrid`; [ProductGrid] lo envuelve para los
// casos que no viven dentro de un `CustomScrollView` (la home, por ejemplo). La
// aritmética de columnas y la altura están en un solo sitio: repetirla en dos
// widgets es la forma de que un día la home tenga 3 columnas y el menú 4 sin que
// nadie lo decida.
//
// `mainAxisExtent` en vez de `childAspectRatio`: con el precio wrapper en `promo`
// (precio tachado + badge "Ahorra") la altura de la card varía, y una altura
// fija calculada por ratio deja huecos o recorta texto.
//
// EL ALTO SE CALCULA, NO SE ESCRIBE
// `SliverLayoutBuilder` da el ancho REAL disponible y de ahí sale el ancho de la
// celda; el alto es ese ancho (la imagen es cuadrada) más el bloque de texto que
// reserva [ProductCard]. Con un `mainAxisExtent` fijo de 268 la card se salía
// 17 px por abajo en un móvil de 2 columnas, y en tablet (celda más ancha) el
// desbordimiento era mayor: el alto va ligado al ancho, como el de la imagen.


import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart' show SliverConstraints;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../../../app/routes.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/responsive/breakpoints.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/product_card.dart';
import '../../domain/entities/menu_product.dart';
import './product_image.dart';

/// Columnas de la rejilla para el breakpoint actual.
int menuGridColumns(Breakpoint breakpoint) => switch (breakpoint) {
      Breakpoint.mobile => 2,
      Breakpoint.tablet => 3,
      Breakpoint.desktop || Breakpoint.wide => 4,
    };

// EL ALTO SE CALCULA POR FILA, NO POR REJILLA
// ─────────────────────────────────────────────────────────────────────────────
// EL ERROR QUE PRODUJO "BOTTOM OVERFLOWED BY 17 PIXELS" (Y POR QUÉ EL
// `SliverLayoutBuilder` DEL AGENTE ANTERIOR NO LO ARREGLÓ)
// ─────────────────────────────────────────────────────────────────────────────
// `mainAxisExtent` es un ÚNICO número para TODAS las celdas de la rejilla. El
// intento anterior lo calculó con `SliverLayoutBuilder` (que es correcto y sigue
// aquí) pero lo dejó en `ProductCard.extentForTileWidth(tile)`, que asume el
// caso SIN promoción. El precio con promoción (`PriceDisplay.promo`) envuelve el
// badge "Ahorra" a una SEGUNDA línea: 34 dp en vez de 18,8 dp, es decir 15,2 dp
// más. 17 px de desbordamiento ≈ justo ese faltante (15,2 dp redondeados a
// píxeles lógicos por el escalado del Motorola).
//
// Agravante: el desbordamiento solo ocurre en las filas que AL MENOS tienen una
// promoción, así que es intermitente — se ve una franja amarilla bajo "Latte" y
// ninguna bajo "Postres", que es exactamente lo que reportó el usuario.
//
// La corrección NO es "dar más alto a todo" (dejaría huecos de 15 dp en cada
// celda sin promo y una rejilla con ritmo irregular), sino que el alto se mida
// POR FILA, con el caso peor de ESA fila. Para eso se usa
// `SliverGridDelegateWithMaxCrossAxisExtent`... no: se cambia el sliver a una
// `SliverList` de filas de altura propia, con `SliverGrid` dentro. Así cada fila
// mide la promoción que TIENE y el resultado es una rejilla sin franjas y sin
// huecos.
/// `SliverGrid` de productos. Es el widget de rejilla REAL; [ProductGrid] es su
/// envoltorio.
class MenuProductSliver extends ConsumerWidget {
  const MenuProductSliver({
    required this.products,
    required this.categoryNames,
    super.key,
  });

  final List<MenuProduct> products;

  /// `{ categoryId: nombre }` para el subtítulo de la card. La rejilla pide
  /// `fields=basic`, que no trae el nombre de la categoría (API.md §6.3), así
  /// que se resuelve con la lista de categorías que ya está en memoria.
  final Map<int, String> categoryNames;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (products.isEmpty) return const SliverToBoxAdapter(child: SizedBox.shrink());
    final Breakpoint breakpoint = context.breakpoint;
    final int columns = menuGridColumns(breakpoint);

    return SliverLayoutBuilder(
      builder: (BuildContext context, SliverConstraints constraints) {
        final double available = constraints.crossAxisExtent;
        final double tile = _tileWidth(available, columns);

        // Se parte en filas de `columns` productos y cada fila se mide con la
        // altura que necesita SU contenido (con promoción o sin ella). Ese es
        // el cambio de fondo: la rejilla deja de tener una altura única.
        final List<MenuProduct> items = products;
        final int rowCount = (items.length / columns).ceil();

        return SliverList.builder(
          itemCount: rowCount,
          itemBuilder: (BuildContext context, int row) {
            final int start = row * columns;
            final int end = (start + columns) < items.length
                ? start + columns
                : items.length;
            final List<MenuProduct> slice = items.sublist(start, end);
            // ¿Alguna de las celdas de esta fila lleva promoción? Solo entonces
            // el precio ocupa dos líneas y la card necesita el alto extra.
            final bool rowHasPromo = slice.any((MenuProduct p) => p.hasActivePromo);
            final double height =
                ProductCard.minExtentForTileWidth(tile, hasPromo: rowHasPromo);

            return Padding(
              padding: EdgeInsets.only(
                bottom: row == rowCount - 1 ? 0 : AppSpacing.md,
              ),
              child: SizedBox(
                height: height,
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (int i = 0; i < slice.length; i++) ...<Widget>[
                      if (i > 0) const SizedBox(width: AppSpacing.md),
                      Expanded(
                        child: MenuProductTile(
                          product: slice[i],
                          categoryNames: categoryNames,
                        ),
                      ),
                    ],
                    // Relleno de la última fila incompleta: sin él las celdas
                    // sueltas se estirarían hasta el ancho completo.
                    for (int i = slice.length; i < columns; i++) ...<Widget>[
                      if (i > 0) const SizedBox(width: AppSpacing.md),
                      const SizedBox.shrink(),
                    ],
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }
}

/// Ancho de una celda: el disponible menos los separadores, repartido.
double _tileWidth(double crossAxisExtent, int columns) =>
    (crossAxisExtent - AppSpacing.md * (columns - 1)) / columns;

/// Rejilla de productos en un contenedor propio, para pantallas que no usan
/// slivers (home, secciones fijas). Delega en [MenuProductSliver].
class ProductGrid extends StatelessWidget {
  const ProductGrid({
    required this.products,
    required this.categoryNames,
    this.padding = EdgeInsets.zero,
    this.shrinkWrap = false,
    this.physics,
    super.key,
  });

  final List<MenuProduct> products;
  final Map<int, String> categoryNames;
  final EdgeInsetsGeometry padding;

  /// `true` cuando la rejilla va DENTRO de otro scroll (la home): el
  /// `CustomScrollView` se ajusta al contenido en vez de ocupar el espacio
  /// restante. Sin esto, una rejilla anidada en un `ListView` se dibuja con la
  /// altura infinita del padre o se recorta en una caja de altura fija.
  final bool shrinkWrap;

  /// Física del scroll propio. `null` = la que corresponde al viewport.
  final ScrollPhysics? physics;

  @override
  Widget build(BuildContext context) {
    // `CustomScrollView` no tiene `padding` en Flutter 3.24: el relleno de un
    // sliver va en `SliverPadding`, que aplica el `padding` en el propio sliver en
    // vez de envolverlo en un `Padding` de caja (que rompería el scroll).
    return CustomScrollView(
      shrinkWrap: shrinkWrap,
      physics: physics,
      slivers: <Widget>[
        SliverPadding(
          padding: padding,
          sliver: MenuProductSliver(
            products: products,
            categoryNames: categoryNames,
          ),
        ),
      ],
    );
  }
}

/// Una celda de la rejilla.
///
/// `StatelessWidget` y NO `ConsumerWidget`: no mira ningún provider. Al ser
/// `StatelessWidget` la celda no se suscribe a cambios de estado ajenos, así que
/// un rebuild del carrito o del filtro de categorías no repinta 20 productos
/// uno por uno. Además evita el aviso `discarded_futures` de `context.push`.
class MenuProductTile extends StatelessWidget {
  const MenuProductTile({
    required this.product,
    required this.categoryNames,
    super.key,
  });

  final MenuProduct product;
  final Map<int, String> categoryNames;

  @override
  Widget build(BuildContext context) {
    final bool hasPromo = product.hasActivePromo;
    final int categoryId = product.categoryId ?? 0;
    final String category = categoryNames[categoryId] ?? 'Café y comida';
    final String price = _pricePhrase(product);

    return Opacity(
      // Un producto agotado sigue en el catálogo (el backend lo mantiene y
      // puede volver a estar disponible) pero se ve apagado y NO es pulsable:
      // ofrecer "añadir" algo que devolverá `422 PRODUCT_UNAVAILABLE` es peor que
      // no ofrecerlo.
      opacity: product.isAvailable ? 1 : 0.55,
      child: ProductCard(
        title: product.name,
        subtitle: product.isAvailable ? category : 'Agotado por hoy',
        semanticLabel: '${product.name}, $category, $price',
        image: ProductImage(name: product.name, url: product.imageUrl),
        trailing: PriceDisplay(
          currentMinor: product.currentPriceMinor,
          originalMinor: hasPromo ? product.basePriceMinor : null,
          variant: hasPromo ? PriceVariant.promo : PriceVariant.normal,
          semanticLabel: price,
        ),
        onTap: product.isAvailable
            // `push` y NO `go`: `/producto/:id` es una pantalla de SEGUNDO NIVEL
            // (fuera del shell, `app/router.dart`) y con `go` se sustituye la
            // rama del menú, así que el botón «atrás» cerraba la app en vez de
            // volver a la carta. El resto de pantallas de segundo nivel
            // (ficha de pedido, carrito, subpáginas de perfil) ya usan `push`.
            ? () => context.push(AppRoutes.productFor(product.id))
            : null,
      ),
    );
  }

  /// Frase corta para el lector de pantalla (el precio exacto lo da
  /// `PriceDisplay`, con su propia etiqueta).
  static String _pricePhrase(MenuProduct product) =>
      product.hasActivePromo ? 'con promoción activa' : 'precio normal';
}
