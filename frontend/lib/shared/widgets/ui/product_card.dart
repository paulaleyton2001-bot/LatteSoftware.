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

import '../../../app/theme/app_colors.dart';
import '../../../app/theme/app_spacing.dart';
import '../../../app/theme/app_typography.dart';
import 'app_card.dart';

/// Card clicable con contenido de producto: imagen, título, categoría, precio.
///
/// Es el patrón de la retícula del menú. Se ofrece aquí porque se repite en
/// cliente, admin y POS; las features no deben reimplementarlo.
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

  final String title;
  final Widget image;
  final String subtitle;

  /// Widget de precio (normalmente [PriceDisplay]).
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
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Stack(
            children: <Widget>[
              AspectRatio(aspectRatio: 1, child: image),
              if (onFavorite != null)
                Positioned(top: AppSpacing.xs, right: AppSpacing.xs, child: _heart()),
            ],
          ),
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
                Text(
                  title,
                  style: AppTextStyles.titleMedium,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSpacing.xxs),
                Text(
                  subtitle,
                  style: AppTextStyles.captionMedium
                      .copyWith(color: AppColors.textSecondary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: AppSpacing.sm),
                trailing,
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _heart() {
    return Semantics(
      button: true,
      toggled: isFavorite,
      label: isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos',
      child: IconButton(
        onPressed: onFavorite,
        iconSize: 20,
        visualDensity: VisualDensity.compact,
        style: IconButton.styleFrom(
          backgroundColor: AppColors.surface.withOpacity(0.88),
          foregroundColor: isFavorite ? AppColors.actionDanger : AppColors.textSecondary,
        ),
        icon: Icon(isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded),
        tooltip: isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos',
      ),
    );
  }
}
