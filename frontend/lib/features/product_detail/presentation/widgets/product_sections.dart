// Secciones de la ficha de producto: foto con precio y opciones de compra.
// Módulo `features/product_detail/presentation/widgets`.
//
// Van aparte de la página porque son las dos MITADES de la ficha y cada una tiene su
// propia lógica (la primera es información, la segunda es un formulario), y porque
// juntas obligaban a un archivo de 350 líneas donde no se distinguía qué se pinta y
// qué se decide.
//
// LA FOTO ES UNA GALERÍA CON FALLBACK, NO UN `Image.network`
// El producto puede no tener foto, y el 100 % de los productos nuevos nace así. Se
// usa la misma `ProductImage` del menú (con caché en disco y `EmptyPlaceholderImage`
// de respaldo) para que una foto se vea igual en la rejilla, en la ficha y en la
// home, y para que el fallo nunca aparezca como una imagen rota.
//
// LOS PRECIOS SON PREVISUALIZACIÓN
// Se calculan en cliente para que el total se mueva al instante, pero al añadir al
// carrito solo viajan ids y cantidad: el servidor recalcula (BR-PRICE-008).


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_text_field.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../../shared/widgets/ui/quantity_stepper.dart';
import '../../../menu/domain/entities/menu_product.dart';
import '../../../menu/presentation/widgets/product_image.dart';
import '../product_detail_controller.dart';
import '../product_selection_state.dart';
import './addon_selector.dart';
import './variant_selector.dart';

/// Foto, nombre, descripción y precio.
class ProductInfoSection extends StatelessWidget {
  const ProductInfoSection({required this.product, required this.padding});

  final MenuProduct product;
  final double padding;

  @override
  Widget build(BuildContext context) {
    final bool promo = product.hasActivePromo;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        AspectRatio(
          aspectRatio: 16 / 10,
          child: ProductImage(
            name: product.name,
            url: product.imageUrl,
            borderRadius: 0,
          ),
        ),
        Padding(
          padding: EdgeInsets.fromLTRB(padding, AppSpacing.lg, padding, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Semantics(
                header: true,
                child: Text(
                  product.name,
                  style: AppTextStyles.headlineMedium,
                ),
              ),
              if (product.shortDescription != null) ...<Widget>[
                const SizedBox(height: AppSpacing.xs),
                Text(
                  product.shortDescription!,
                  style: AppTextStyles.bodyMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ],
              const SizedBox(height: AppSpacing.md),
              PriceDisplay(
                currentMinor: product.currentPriceMinor,
                originalMinor: promo ? product.basePriceMinor : null,
                variant: promo ? PriceVariant.promo : PriceVariant.large,
              ),
              if (!product.isAvailable) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                const _UnavailableNotice(),
              ],
              if (product.preparationMinutes > 0) ...<Widget>[
                const SizedBox(height: AppSpacing.md),
                Row(
                  children: <Widget>[
                    Icon(
                      Icons.schedule_rounded,
                      size: 16,
                      color: context.tokens.textSecondary,
                    ),
                    const SizedBox(width: AppSpacing.xs),
                    Text(
                      'Listo en unos ${product.preparationMinutes} min',
                      style: AppTextStyles.captionMedium
                          .copyWith(color: context.tokens.textSecondary),
                    ),
                  ],
                ),
              ],
              if (product.description != null &&
                  product.description != product.shortDescription) ...<Widget>[
                const SizedBox(height: AppSpacing.lg),
                Text(
                  product.description!,
                  style: AppTextStyles.bodyMedium
                      .copyWith(color: context.tokens.textSecondary),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Aviso de producto agotado: texto + ícono + color, nunca solo el color.
class _UnavailableNotice extends StatelessWidget {
  const _UnavailableNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: context.tokens.surfaceWarningSubtle,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: <Widget>[
           Icon(Icons.info_rounded, size: 18, color: context.tokens.textWarning),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              'Agotado por hoy. Vuelve más tarde, a veces reponemos.',
              style: AppTextStyles.bodySmall
                  .copyWith(color: context.tokens.textWarning),
            ),
          ),
        ],
      ),
    );
  }
}

/// Variantes, extras, cantidad y notas.
class ProductOptionsSection extends ConsumerWidget {
  const ProductOptionsSection({required this.product, required this.padding});

  final MenuProduct product;
  final double padding;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ProductSelectionState selection =
        ref.watch(productSelectionProvider(product));
    final ProductSelectionController controller =
        ref.read(productSelectionProvider(product).notifier);

    return Padding(
      padding: EdgeInsets.fromLTRB(padding, 0, padding, AppSpacing.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          VariantSelector(product: product),
          if (product.variants.isNotEmpty) const SizedBox(height: AppSpacing.xl),
          AddonSelector(product: product),
          if (product.activeAddons.isNotEmpty) const SizedBox(height: AppSpacing.xl),
          Semantics(
            container: true,
            label: 'Cantidad',
            child: Row(
              children: <Widget>[
                Text('Cantidad', style: AppTextStyles.titleMedium),
                const Spacer(),
                QuantityStepper(
                  quantity: selection.quantity,
                  semanticLabel: product.name,
                  onChanged: controller.setQuantity,
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.lg),
          AppTextField(
            label: 'Notas para la barra',
            hint: 'Sin azúcar, con leche de avena…',
            helperText: 'Opcional. Lo lee quien prepara tu pedido.',
            maxLines: 3,
            maxLength: 300,
            textCapitalization: TextCapitalization.sentences,
            onChanged: controller.setNotes,
            semanticLabel: 'Notas para la preparación de ${product.name}',
          ),
        ],
      ),
    );
  }
}
