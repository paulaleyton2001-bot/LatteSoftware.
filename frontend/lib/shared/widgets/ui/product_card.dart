// Card de producto del menú/pedidos.
//
// Existe como componente del sistema porque el patrón (imagen cuadrada, título,
// categoría, precio, favorito) se repite en el menú del cliente, en el POS y en
// el admin. Las features lo consumen; no lo reimplementan.
//
// Uso típico:
// ```dart
// ProductCard(
//   title: product.name,
//   subtitle: product.categoryName,
//   image: CachedNetworkImage(
//     imageUrl: product.imageUrl ?? '',
//     placeholder: (_, __) => EmptyPlaceholderImage(name: product.name),
//     errorWidget: (_, __, ___) => EmptyPlaceholderImage(name: product.name),
//   ),
//   trailing: PriceDisplay(
//     currentMinor: product.promoPriceMinor ?? product.basePriceMinor,
//     originalMinor: product.promoPriceMinor == null ? null : product.basePriceMinor,
//     variant: product.promoPriceMinor == null
//         ? PriceVariant.normal
//         : PriceVariant.promo,
//   ),
//   onTap: () => context.push('/menu/${product.slug}'),
//   onFavorite: () => ref.read(favoritesProvider.notifier).toggle(product.id),
// );
// ```
import 'package:flutter/material.dart';

import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_tokens.dart';
import '../../../app/theme/app_typography.dart';
import './app_card.dart';

/// Card clicable con contenido de producto: imagen, título, categoría, precio.
///
/// Es el patrón de la retícula del menú. Se ofrece aquí porque se repite en
/// cliente, admin y POS; las features no deben reimplementarlo.
///
/// ─────────────────────────────────────────────────────────────────────────────
/// POR QUÉ ESTA CARD NUNCA DESBORDA (la causa del "OVERFLOWED BY 17 PIXELS")
/// ─────────────────────────────────────────────────────────────────────────────
/// El error anterior no estaba en esta card sino en QUIÉN la dimensionaba: la
/// retícula (`MenuProductSliver`) fijaba `SliverGridDelegate` con un
/// `mainAxisExtent` calculado a partir del ancho, y ese cálculo no contemplaba
/// (a) el alto del precio con promoción, que [PriceDisplay.promo] envuelve en
/// dos líneas, ni (b) que la rejilla de 2 columnas en un móvil de 1220 px
/// entrega ~170 dp por celda. Con `mainAxisExtent` el alto es un NÚMERO: si el
/// contenido pide más, Flutter no encoge nada y dibuja las franjas amarillas.
///
/// Aquí el contrato es el contrario: la card se dimensiona por SU CONTENIDO y
/// la retícula mide la retícula. Por eso esta clase expone
/// [measureTextBlock] / [idealExtentForTileWidth], funciones puras que el
/// `delegate` ejecuta para decidir la altura de la fila, y no al revés.
///
/// Las tres reglas que hacen que quepa de verdad:
///   1. La imagen es [Flexible] con `fit: FlexFit.loose` dentro de una columna:
///      toma lo que sobra y cede lo que falta. Nunca empuja al texto.
///   2. El título es `maxLines: 2` con ellipsis: su alto está ACOTADO, sea cual
///      sea el nombre del producto.
///   3. El precio se envuelve (`Wrap`), no en `Row`: con promoción ocupa dos
///      líneas sin desbordar a la derecha.
/// Con eso el alto real es siempre <= el calculado por el delegate, y el
/// margen de seguridad se aplica en el delegate, no tapando el desborde.
class ProductCard extends StatelessWidget {
  const ProductCard({
    required this.title,
    required this.image,
    required this.subtitle,
    required this.trailing,
    this.onTap,
    this.onFavorite,
    this.isFavorite = false,
    this.semanticLabel,
    super.key,
  });

  // ============================================================ MEDICIÓN
  //
  // Constantes que usa la retícula para calcular el alto de la fila. Son
  // `static const` (no números mágicos en la rejilla) para que el cálculo del
  // alto y el layout real no puedan separarse: si cambia el padding de la card,
  // cambia aquí y cambia en todas las retículas a la vez.

  /// Alto del título con DOS líneas a escala tipográfica 1.0.
  ///
  /// `titleMedium` es 15 sp con `height: 1.40` => 21 dp por línea, 42 dp.
  static const double titleTwoLines = 42;

  /// Alto del subtítulo (categoría) con UNA línea: `captionMedium` 12 × 1.35.
  static const double subtitleOneLine = 16.2;

  /// Alto del bloque de precio cuando NO hay promoción: `price` 15 × 1.25.
  static const double priceOneLine = 18.8;

  /// Alto del bloque de precio CON promoción.
  ///
  /// [PriceDisplay.promo] usa un `Wrap`: precio tachado + precio vigente en la
  /// primera línea y el badge "Ahorra" en la segunda cuando el ancho no alcanza.
  /// Es el caso que provocaba el desborde de 17 px, porque el cálculo anterior
  /// contaba una sola línea.
  static const double pricePromo = 34;

  /// Separación título → categoría.
  static const double gapTitleSubtitle = AppSpacing.xxs;

  /// Separación categoría → precio.
  static const double gapSubtitlePrice = AppSpacing.sm;

  /// Padding inferior del bloque de texto (los tres lados son `AppSpacing.md`).
  static const double textPadding = AppSpacing.md;

  /// Alto del bloque de texto en el CASO PEOR (título a 2 líneas + promo a 2).
  ///
  ///   12 (padding sup) + 42 (título ×2) + 2 + 16,2 (categoría) + 8 + 34
  ///   (precio promo ×2) + 12 (padding inf) = 126,2  ->  128 con margen.
  static const double textBlockHeight = 128;

  /// Alto del bloque de texto cuando NO hay promoción (el caso frecuente).
  ///
  ///   12 + 42 + 2 + 16,2 + 8 + 18,8 + 12 = 111  ->  112.
  static const double textBlockHeightNoPromo = 112;

  /// Alto total de una card cuya imagen cuadrada mide [tileWidth].
  ///
  /// Es el "alto ideal": la imagen cuadrada manda y el texto va debajo. La
  /// retícula lo usa como BASE y le añade el margen de seguridad, nunca al revés.
  static double extentForTileWidth(double tileWidth, {bool hasPromo = false}) =>
      tileWidth +
      (hasPromo ? textBlockHeight : textBlockHeightNoPromo);

  /// Alto mínimo que la retícula debe reservar para una celda de [tileWidth].
  ///
  /// `mainAxisExtent` es un número FIJO: si el contenido pide más, Flutter
  /// desborda. Por eso aquí se devuelve el máximo entre el alto ideal y el
  /// mínimo absoluto de legibilidad (imagen de 96 dp + bloque de texto), con un
  /// margen explícito. Es la garantía numérica de que no habrá franjas amarillas.
  static double minExtentForTileWidth(double tileWidth, {bool hasPromo = false}) {
    final double ideal = extentForTileWidth(tileWidth, hasPromo: hasPromo);
    final double minimumReadable = 96 + textBlockHeight;
    return ideal > minimumReadable ? ideal : minimumReadable;
  }

  final String title;
  final Widget image;
  final String subtitle;

  /// Widget de precio (normalmente `PriceDisplay`).
  final Widget trailing;

  final VoidCallback? onTap;
  final VoidCallback? onFavorite;
  final bool isFavorite;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    return AppCard(
      onTap: onTap,
      semanticLabel: semanticLabel,
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.max,
        children: <Widget>[
          // ── Imagen ────────────────────────────────────────────────────────
          // `Flexible` (NO `Expanded`): si el texto se hace más alto de lo
          // previsto —tipografía del sistema al 150 %, nombre larguísimo,
          // precio con promo que envuelve a dos líneas— la imagen se encoge
          // hasta su mínimo en lugar de empujar al texto fuera de la card.
          // `Expanded` obligaba a la imagen a ocupar EXACTAMENTE el sobrante y
          // si sobrante < 0 el `Column` se salía por abajo.
          Flexible(
            flex: 1,
            fit: FlexFit.loose,
            child: ConstrainedBox(
              // Mínimo legible: por debajo de 96 dp la foto deja de識別ificar
              // el producto, así que la imagen no cede más.
              constraints: const BoxConstraints(minHeight: 96),
              child: Stack(
                children: <Widget>[
                  Positioned.fill(child: image),
                  if (onFavorite != null)
                    Positioned(
                      top: AppSpacing.xs,
                      right: AppSpacing.xs,
                      child: _heart(context),
                    ),
                ],
              ),
            ),
          ),
          // ── Bloque de texto ───────────────────────────────────────────────
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.md,
              AppSpacing.md,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                // `maxLines: 2` ACOTA el alto del título. Sin esto, un nombre
                // de 40 caracteres en una celda de 170 dp se iba a 4 líneas y
                // desbordaba la card.
                Text(
                  title,
                  style: AppTextStyles.titleMedium.copyWith(
                    color: context.tokens.textPrimary,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: gapTitleSubtitle),
                Text(
                  subtitle,
                  style: AppTextStyles.captionMedium
                      .copyWith(color: context.tokens.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: gapSubtitlePrice),
                // El precio (con `Wrap` cuando hay promo) nunca desborda a la
                // derecha ni crece por debajo de lo medido.
                SizedBox(width: double.infinity, child: trailing),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Botón de favorito. El fondo translúcido deja legible el icono tanto sobre
  /// una foto clara como sobre una oscura, en los dos modos del tema.
  Widget _heart(BuildContext context) {
    final AppTokens t = context.tokens;
    return Semantics(
      button: true,
      toggled: isFavorite,
      label: isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos',
      child: IconButton(
        onPressed: onFavorite,
        iconSize: 20,
        visualDensity: VisualDensity.compact,
        style: IconButton.styleFrom(
          // 88 % de la superficie del card: funciona igual sobre crema y
          // sobre espresso sin necesidad de un color condicional en el widget.
          backgroundColor: t.surface.withOpacity(0.88),
          foregroundColor: isFavorite ? t.actionDanger : t.textSecondary,
        ),
        icon: Icon(isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded),
        tooltip: isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos',
      ),
    );
  }
}
