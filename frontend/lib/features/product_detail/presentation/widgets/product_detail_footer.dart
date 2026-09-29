// Pie fijo de la ficha: total calculado + CTA "Añadir al pedido".
//
// POR QUÉ EL TOTAL SE CALCULA AQUÍ Y NO SE ENVÍA
// El precio se calcula en el cliente para dar FEEDBACK INMEDIATO (el usuario ve
// moverse la cifra al cambiar de tamaño o de extras, sin esperas). Pero al
// confirmar NO se manda ningún importe: `POST /orders` recibe solo
// `productId`, `variantId`, `quantity`, `addons[]` y `notes`, y el servidor
// recalcula el precio de línea con los snapshots que él controla
// (BR-PRICE-008, API.md §7.12 "enviar campos de total da 400
// FIELD_NOT_EDITABLE"). Esta cifra es una previsualización y la confirmación
// muestra las que devuelve el servidor.
//
// LAYOUT: fijo abajo (móvil y tablet) para que el CTA esté siempre alcanzable
// con el pulgar; en desktop va en la columna de la izquierda, que es donde está
// el contenido que genera el total. En ambos casos se respeta el `safe area`.


import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/theme/app_spacing.dart';
import '../../../../app/theme/app_tokens.dart';
import '../../../../app/theme/app_typography.dart';
import '../../../../shared/widgets/ui/app_button.dart';
import '../../../../shared/widgets/ui/price_display.dart';
import '../../../menu/domain/entities/menu_product.dart';
import '../add_to_cart_status.dart';
import '../product_detail_controller.dart';
import '../product_selection_state.dart';

/// Pie con el total y el botón de añadir al pedido.
class ProductDetailFooter extends ConsumerWidget {
  const ProductDetailFooter({
    required this.product,
    required this.onAdded,
    super.key,
  });

  final MenuProduct product;

  /// Se avisa al árbol para que la pantalla muestre la confirmación.
  final VoidCallback onAdded;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ProductSelectionState selection =
        ref.watch(productSelectionProvider(product));
    final ProductSelectionController controller =
        ref.read(productSelectionProvider(product).notifier);
    final int total = selection.totalMinor(product);
    final bool available = product.isAvailable;

    return Container(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.md,
      ),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        border: Border(
          top: BorderSide(color: Theme.of(context).colorScheme.outlineVariant),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    'Total (${selection.quantity} '
                    '${selection.quantity == 1 ? 'unidad' : 'unidades'})',
                    style: AppTextStyles.captionMedium
                        .copyWith(color: context.tokens.textSecondary),
                  ),
                  const SizedBox(height: AppSpacing.xxs),
                  PriceDisplay(
                    currentMinor: total,
                    variant: PriceVariant.large,
                    semanticLabel: 'Total estimado de la línea, sin impuestos',
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            AppButton(
              label: available ? 'Añadir al pedido' : 'Agotado',
              icon: available
                  ? Icons.add_shopping_cart_rounded
                  : Icons.block_rounded,
              variant: AppButtonVariant.espresso,
              size: AppButtonSize.large,
              // Un producto agotado no se puede pedir: el backend respondería
              // `422 PRODUCT_UNAVAILABLE` y el botón apagado lo explica antes.
              onPressed: available
                  ? () {
                      controller.addToCart(product);
                      ref
                          .read(addToCartStatusProvider.notifier)
                          .register(product.name);
                      onAdded();
                    }
                  : null,
              semanticLabel: available
                  ? 'Añadir ${product.name} al pedido'
                  : '${product.name} está agotado',
            ),
          ],
        ),
      ),
    );
  }
}
