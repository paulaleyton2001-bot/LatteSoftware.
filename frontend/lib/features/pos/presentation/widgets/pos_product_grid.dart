// Rejilla de productos del mostrador. MÓDULO `pos/presentation/widgets`.
//
// EL REQUISITO DE ESTA PANTALLA
// Un clic = una unidad añadida. Ni menú contextual, ni confirmación, ni arrastre:
// el cajero tiene las dos manos ocupadas y el producto es lo que vende. Por eso la
// celda es grande (objetivo táctil ≥ 44 dp, en la práctica ~110 dp) y el toque va
// directo a `posAddProduct`.
//
// AGOTADOS SE SIGUEN VIENDO
// Un producto con `isAvailable = false` no se oculta: se pinta atenuado, con
// etiqueta "Agotado" y sin acción. El cajero necesita VER que algo se acabó para
// ofrecer otra cosa; si desapareciera, creería que el catálogo no lo tiene.
//
// EL ESTADO SE COMUNICA CON TEXTO, NO SOLO CON COLOR
// La celda atenuada lleva además un ícono y una palabra (WCAG 1.4.1): el mismo
// criterio que exige `docs/DESIGN-TOKENS.md` §6.1 para las sillas.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_radii.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../core/customer/cart_providers.dart';
import '../../../../core/utils/currency_formatter.dart';
import '../../../../shared/widgets/ui/empty_placeholder_image.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../domain/entities/pos_catalog_item.dart';
import '../pos_cart_controller.dart';
import '../pos_controller.dart';

/// Rejilla de productos del catálogo, filtrada por el controlador.
class PosProductGrid extends ConsumerWidget {
  const PosProductGrid({required this.minTileWidth, this.padding, super.key});

  /// Ancho mínimo de celda (dp). Lo decide `PosLayout.productTileMinWidth`.
  final double minTileWidth;

  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final List<PosCatalogItem> items = ref.watch(posVisibleCatalogProvider);
    if (items.isEmpty) return const _NoMatches();

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double available = constraints.maxWidth;
        // Menos de 150 dp por celda daría un texto ilegible: mejor menos
        // columnas que celdas estrechas.
        final int columns = (available / minTileWidth).floor().clamp(1, 8);
        // El ancho de celda es un NÚMERO, no un ratio: se calcula una vez y de él
        // sale también el alto. Con `childAspectRatio` el alto dependía del ancho
        // de una forma implícita, y al cambiar el número de columnas (al girar
        // el móvil) el texto se salía. Con ancho Y alto explícitos, más el
        // mínimo de texto de [PosProductTile], la celda siempre cabe.
        final double tileWidth =
            (available - AppSpacing.sm * (columns - 1)) / columns;

        return GridView.builder(
          padding: padding ??
              const EdgeInsets.fromLTRB(
                AppSpacing.md,
                AppSpacing.sm,
                AppSpacing.md,
                AppSpacing.xxl,
              ),
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            mainAxisSpacing: AppSpacing.sm,
            crossAxisSpacing: AppSpacing.sm,
            // La celda es: bloque de texto (2 líneas de nombre + precio, ~76 dp)
            // + imagen cuadrada de ~62 % del ancho. El mínimo de 190 dp impide
            // que con muchas columnas la imagen quede en 20 dp.
            childAspectRatio:
                tileWidth / (tileWidth * 0.62 + _tileTextBlockHeight),
          ),
          itemCount: items.length,
          itemBuilder: (BuildContext context, int index) {
            final PosCatalogItem item = items[index];
            return RepaintBoundary(
              child: PosProductTile(
                item: item,
                onTap: () => posAddProduct(ref.read(cartStoreProvider), item),
              ),
            );
          },
        );
      },
    );
  }

  /// Alto reservado al bloque de texto bajo la imagen: 2 líneas de `titleSmall`
  /// (13 × 1.40 = 18,2 → 36,4) + separador 2 + precio (15 × 1.25 = 18,8) +
  /// padding vertical 2 × 8 = 81. Se redondea a 82.
  static const double _tileTextBlockHeight = 82;
}

/// Celda de producto del mostrador.
class PosProductTile extends StatelessWidget {
  const PosProductTile({required this.item, required this.onTap, super.key});

  final PosCatalogItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final bool sellable = item.isSellable;
    final String price =
        CurrencyFormatter.formatMinor(item.effectivePriceMinor);
    final String semantic = sellable
        ? '${item.name}, $price. Añadir al pedido.'
        : '${item.name}, agotado. No se puede añadir.';

    return Semantics(
      button: true,
      enabled: sellable,
      label: semantic,
      excludeSemantics: true,
      child: Tooltip(
        message: item.name,
        child: Opacity(
          opacity: sellable ? 1 : 0.72,
          child: Material(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: BorderRadius.circular(AppRadii.lg),
            child: InkWell(
              onTap: sellable ? onTap : null,
              borderRadius: BorderRadius.circular(AppRadii.lg),
              splashColor: context.tokens.focusRingSurface,
              child: Container(
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(AppRadii.lg),
                  border: Border.all(color: context.tokens.borderDefault),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Expanded(
                      child: ClipRRect(
                        borderRadius: const BorderRadius.vertical(
                          top: Radius.circular(AppRadii.lg - 1),
                        ),
                        child: item.imageUrl == null
                            ? EmptyPlaceholderImage(name: item.name)
                            : Image.network(
                                item.imageUrl!,
                                fit: BoxFit.cover,
                                // RENDIMIENTO: sin `cacheWidth`, el decodificador
                                // crea un mapa de bits del tamaño NATURAL de la
                                // foto (a menudo 2000-4000 px) para pintar un
                                // hueco de ~110 dp. Con una rejilla de 20
                                // productos eso son decenas de MB de RAM y un
                                // jank largo en cada scroll: el cuello de botella
                                // más caro de esta pantalla. `cacheWidth` limita
                                // el decodificado al tamaño real en píxeles
                                // físicos (3x de densidad en el Motorola).
                                cacheWidth: _decodeWidth(context, 220),
                                // `errorBuilder` evita el icono roto: sin foto
                                // se cae al placeholder, que además reserva el
                                // mismo tamaño (no hay CLS).
                                errorBuilder: (
                                  BuildContext context,
                                  Object error,
                                  StackTrace? stack,
                                ) => EmptyPlaceholderImage(name: item.name),
                              ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.all(AppSpacing.sm),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          Text(
                            item.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.titleSmall,
                          ),
                          const SizedBox(height: AppSpacing.xxs),
                          if (!sellable)
                            const _SoldOutLabel()
                          else
                            _priceRow(),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Ancho de decodificado en píxeles para una imagen que ocupa [dp] lógicos.
  ///
  /// Se traduce con la densidad real del dispositivo: pedir 220 px en un móvil
  /// de 3x son 73 dp (borrosa) y pedir 220 dp serían 660 px por celda (y 20
  /// celdas) — 9 veces más memoria de la necesaria.
  static int _decodeWidth(BuildContext context, double dp) {
    final double ratio = MediaQuery.maybeDevicePixelRatioOf(context) ?? 3;
    return (dp * ratio).round();
  }

  /// Precio: tachado el original si hay promoción, y el vigente debajo.
  Widget _priceRow() {
    if (!item.hasPromo) {
      return PriceDisplay(currentMinor: item.effectivePriceMinor);
    }
    return Row(
      children: <Widget>[
        Flexible(
          child: PriceDisplay(
            currentMinor: item.promoPriceMinor!,
            originalMinor: item.basePriceMinor,
            variant: PriceVariant.normal,
          ),
        ),
      ],
    );
  }

}

/// Etiqueta de producto agotado: ícono + palabra, nunca solo el color.
class _SoldOutLabel extends StatelessWidget {
  const _SoldOutLabel();

  @override
  Widget build(BuildContext context) {
    return Row(
      children: <Widget>[
        Icon(Icons.remove_circle_outline_rounded,
            size: 16, color: context.tokens.textError),
        const SizedBox(width: AppSpacing.xs),
        Text(
          'Agotado',
          style: AppTextStyles.labelMedium.copyWith(
            color: context.tokens.textError,
          ),
        ),
      ],
    );
  }
}

/// Estado sin coincidencias del catálogo. No es el `EmptyState` grande: dentro de
/// una rejilla ocuparía media pantalla y taparía el buscador.
class _NoMatches extends StatelessWidget {
  const _NoMatches();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(Icons.search_off_rounded,
                size: 32, color: context.tokens.textTertiary),
            const SizedBox(height: AppSpacing.sm),
            Text(
              'Ningún producto coincide con el filtro',
              textAlign: TextAlign.center,
              style: AppTextStyles.bodyMedium
                  .copyWith(color: context.tokens.textSecondary),
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              'Prueba con otra palabra o quita el filtro de categoría.',
              textAlign: TextAlign.center,
              style: AppTextStyles.captionMedium
                  .copyWith(color: context.tokens.textTertiary),
            ),
          ],
        ),
      ),
    );
  }
}
